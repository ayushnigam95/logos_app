/**
 * Job orchestration — ported from backend/app/routers/pages.py run_translation_job.
 *
 * In-memory job store + the auth → crawl → preprocess → translate pipeline.
 * Progress events are emitted via an EventEmitter; the IPC layer (main.ts)
 * subscribes and forwards them to the renderer via webContents.send.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

import type {
  CookieJar,
  Job,
  JobProgress,
  JobRequest,
  JobStatus,
  PageData,
} from '../types';
import { settings } from '../config';
import { parseConfluenceUrl } from '../utils/urlParser';
import { preprocessConfluenceHtml } from '../utils/confluenceMacros';
import { SamlAuthenticator } from './auth';
import { ConfluenceClient } from './confluence';
import { PageTreeCrawler, countPages, flattenPages } from './crawler';
import { TranslationService } from './translator';
import { TranslationCache } from './cache';

// In-memory state
const jobs = new Map<string, Job>();
const jobResults = new Map<string, PageData>();
/** jobId → (baseUrl, cookies) for the image protocol handler. */
const jobCookies = new Map<string, { baseUrl: string; cookies: CookieJar[] }>();
/** Cache authenticated sessions per base_url to avoid re-login. */
const sessionCache = new Map<string, CookieJar[]>();

export const jobEvents = new EventEmitter();

function emitProgress(job: Job): void {
  jobEvents.emit('progress', { ...job.progress });
}

function setStatus(job: Job, status: JobStatus, error?: string): void {
  job.progress.status = status;
  if (error !== undefined) job.progress.error = error;
  emitProgress(job);
}

function createJobRecord(request: JobRequest): Job {
  const jobId = randomUUID();
  return {
    jobId,
    request,
    progress: {
      jobId,
      status: 'pending',
      totalPages: 0,
      pagesCrawled: 0,
      pagesTranslated: 0,
    },
  };
}

export function listJob(jobId: string): Job | undefined {
  return jobs.get(jobId);
}

export function getResults(jobId: string): PageData | undefined {
  return jobResults.get(jobId);
}

export function getJobAuth(jobId: string): { baseUrl: string; cookies: CookieJar[] } | undefined {
  return jobCookies.get(jobId);
}

export function findPage(tree: PageData, pageId: string): PageData | null {
  if (tree.pageId === pageId) return tree;
  for (const c of tree.children) {
    const found = findPage(c, pageId);
    if (found) return found;
  }
  return null;
}

export function buildBreadcrumbs(tree: PageData): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const walk = (node: PageData, path: string[]): void => {
    const next = [...path, node.title];
    out.set(node.pageId, next);
    for (const c of node.children) walk(c, next);
  };
  walk(tree, []);
  return out;
}

export function cancelJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job) return false;
  setStatus(job, 'cancelled');
  return true;
}

/** Verify cached cookies still authenticate; returns the cookies if valid. */
async function validateCachedSession(
  baseUrl: string,
  cookies: CookieJar[],
): Promise<CookieJar[] | null> {
  try {
    const test = new ConfluenceClient(baseUrl, cookies);
    // page id "0" → 404 if authed, 401 if not
    await test.getPage('0').catch((e: Error) => {
      const m = /→ (\d+)/.exec(e.message);
      const status = m ? Number(m[1]) : 0;
      if (status === 401) throw new Error('UNAUTHORIZED');
      // 404 (or other) means we got past auth — accept.
    });
    return cookies;
  } catch (e) {
    if (e instanceof Error && e.message === 'UNAUTHORIZED') return null;
    return cookies; // network glitch — assume valid, will fail later if not
  }
}

async function runTranslationJob(job: Job): Promise<void> {
  const { request } = job;
  const progress = job.progress;

  try {
    setStatus(job, 'authenticating');
    const parsed = parseConfluenceUrl(request.confluenceUrl);
    const baseUrl = parsed.baseUrl;

    // Reuse cached session if possible.
    let cookies: CookieJar[] | null = null;
    const cached = sessionCache.get(baseUrl);
    if (cached) {
      cookies = await validateCachedSession(baseUrl, cached);
      if (!cookies) {
        console.info('[job] Cached session expired, re-authenticating');
        sessionCache.delete(baseUrl);
      } else {
        console.info('[job] Reusing cached session cookies');
      }
    }

    if (!cookies) {
      const auth = new SamlAuthenticator(baseUrl);
      cookies = await auth.authenticate(true);
      await auth.close();
      sessionCache.set(baseUrl, cookies);
    }

    jobCookies.set(job.jobId, { baseUrl, cookies });
    const client = new ConfluenceClient(baseUrl, cookies);

    // Resolve page id (cloud URLs always have it; display URLs need title lookup).
    let pageId = parsed.pageId;
    if (!pageId && parsed.spaceKey && parsed.pageTitle) {
      const found = await client.getPageByTitle(parsed.spaceKey, parsed.pageTitle);
      if (!found) throw new Error('Page not found');
      pageId = String(found.id);
    }
    if (!pageId) throw new Error('Could not determine page ID from URL');

    // Crawl.
    setStatus(job, 'crawling');
    const crawler = new PageTreeCrawler(
      client,
      request.maxDepth,
      settings.maxConcurrentPages,
      async (title, total) => {
        progress.pagesCrawled = total;
        progress.currentPage = title;
        emitProgress(job);
      },
    );

    let pageTree: PageData;
    if (request.includeChildren) {
      pageTree = await crawler.crawl(pageId);
    } else {
      // Single-page mode — call crawl with depth limit 0
      const single = new PageTreeCrawler(client, 0, settings.maxConcurrentPages);
      pageTree = await single.crawl(pageId);
    }

    progress.totalPages = countPages(pageTree);
    progress.pagesCrawled = progress.totalPages;

    // Translate.
    setStatus(job, 'translating');
    const translator = new TranslationService(request.targetLanguage);
    const cache = new TranslationCache();
    cache.initialize();
    void cache; // reserved for future cache-aware translation; behavior matches Python (cache present but unused by translator)

    const allPages = flattenPages(pageTree);
    for (let i = 0; i < allPages.length; i++) {
      if (progress.status === 'cancelled') return;
      const page = allPages[i];
      progress.pagesTranslated = i;
      progress.currentPage = page.title;
      emitProgress(job);

      const preprocessed = preprocessConfluenceHtml(
        page.bodyHtml,
        job.jobId,
        page.pageId,
        baseUrl,
      );
      page.translatedHtml = await translator.translateHtml(preprocessed);
      page.title = await translator.translate(page.title);
    }

    progress.pagesTranslated = allPages.length;
    progress.currentPage = undefined;

    jobResults.set(job.jobId, pageTree);
    setStatus(job, 'completed');
  } catch (e) {
    console.error(`[job] ${job.jobId} failed:`, e);
    setStatus(job, 'failed', e instanceof Error ? e.message : String(e));
  }
}

/** Public entrypoint: register a new job and kick off processing. Returns initial progress. */
export function startJob(request: JobRequest): JobProgress {
  const job = createJobRecord(request);
  jobs.set(job.jobId, job);
  // Fire-and-forget — progress emitted via jobEvents.
  void runTranslationJob(job);
  return { ...job.progress };
}
