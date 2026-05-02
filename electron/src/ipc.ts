/**
 * IPC handlers — replaces the FastAPI router endpoints.
 * Mounted from main.ts after app.whenReady().
 *
 * Channel naming:   <noun>:<verb>     e.g. job:create, page:get
 * Pushed events:    <noun>:<verb>     e.g. job:progress (sent via webContents.send)
 */

import { ipcMain, BrowserWindow, dialog } from 'electron';
import { promises as fsp } from 'fs';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { settings, buildSettings } from './config';
import type {
  JobRequest,
  PageData,
} from './types';
import {
  startJob,
  listJob,
  getResults,
  getJobAuth,
  findPage,
  buildBreadcrumbs,
  cancelJob,
  jobEvents,
} from './services/jobs';
import {
  convertConfluenceImages,
  rewriteImageUrlsForViewer,
  embedImagesAsBase64,
} from './services/imageHelpers';
import { preprocessConfluenceHtml } from './utils/confluenceMacros';
import {
  generatePageSummary,
  generatePageNotes,
  analyzeImage,
} from './services/llmHelpers';
import {
  generatePdfFromPage,
  generateCombinedPdf,
  generatePdfZip,
  type PdfPage,
} from './services/pdfGenerator';

function bcMap(jobId: string): Map<string, string[]> | null {
  const tree = getResults(jobId);
  return tree ? buildBreadcrumbs(tree) : null;
}

async function preparePageHtmlForViewer(
  jobId: string,
  page: PageData,
): Promise<string> {
  const auth = getJobAuth(jobId);
  const baseUrl = auth?.baseUrl ?? '';
  let html = page.translatedHtml || page.bodyHtml;
  html = preprocessConfluenceHtml(html, jobId, page.pageId, baseUrl);
  html = rewriteImageUrlsForViewer(html, jobId);
  return html;
}

async function preparePageHtmlForPdf(
  jobId: string,
  page: PageData,
): Promise<string> {
  const auth = getJobAuth(jobId);
  let html = page.translatedHtml || page.bodyHtml;
  html = convertConfluenceImages(html, jobId, page.pageId, auth?.baseUrl ?? '');
  if (auth) {
    html = await embedImagesAsBase64(html, auth.baseUrl, auth.cookies);
  }
  return html;
}

export function registerIpcHandlers(): void {
  // -------- jobs --------

  ipcMain.handle('job:create', (_e, request: JobRequest) => {
    return startJob(request);
  });

  ipcMain.handle('job:get', (_e, jobId: string) => {
    const job = listJob(jobId);
    return job?.progress ?? null;
  });

  ipcMain.handle('job:pages', (_e, jobId: string) => {
    return getResults(jobId) ?? null;
  });

  ipcMain.handle('job:cancel', (_e, jobId: string) => {
    return cancelJob(jobId);
  });

  // -------- pages --------

  ipcMain.handle('page:get', async (_e, jobId: string, pageId: string) => {
    const tree = getResults(jobId);
    if (!tree) throw new Error('Job not found');
    const page = findPage(tree, pageId);
    if (!page) throw new Error('Page not found');
    const html = await preparePageHtmlForViewer(jobId, page);
    return {
      pageId: page.pageId,
      title: page.title,
      translatedHtml: html,
      url: page.url,
    };
  });

  ipcMain.handle('page:raw', (_e, jobId: string, pageId: string) => {
    const tree = getResults(jobId);
    if (!tree) throw new Error('Job not found');
    const page = findPage(tree, pageId);
    if (!page) throw new Error('Page not found');
    return {
      pageId: page.pageId,
      title: page.title,
      bodyHtml: page.bodyHtml,
      translatedHtml: page.translatedHtml,
    };
  });

  ipcMain.handle('page:summary', async (_e, jobId: string, pageId: string) => {
    const tree = getResults(jobId);
    if (!tree) throw new Error('Job not found');
    const page = findPage(tree, pageId);
    if (!page) throw new Error('Page not found');
    const job = listJob(jobId);
    const lang = job?.request.targetLanguage ?? 'en';
    return generatePageSummary(page.translatedHtml || page.bodyHtml, lang);
  });

  ipcMain.handle('page:notes', async (_e, jobId: string, pageId: string) => {
    const tree = getResults(jobId);
    if (!tree) throw new Error('Job not found');
    const page = findPage(tree, pageId);
    if (!page) throw new Error('Page not found');
    const job = listJob(jobId);
    const lang = job?.request.targetLanguage ?? 'en';
    return generatePageNotes(page.translatedHtml || page.bodyHtml, lang);
  });

  // -------- vision --------

  ipcMain.handle(
    'image:analyze',
    async (
      _e,
      args: {
        jobId: string;
        url: string;
        question?: string;
        history?: { role: 'user' | 'assistant'; content: string }[];
      },
    ) => {
      const auth = getJobAuth(args.jobId);
      if (!auth) throw new Error('Job not found or expired');
      return analyzeImage({
        url: args.url,
        baseUrl: auth.baseUrl,
        cookies: auth.cookies,
        question: args.question,
        history: args.history,
      });
    },
  );

  // -------- PDF export (native save dialog) --------

  function safeFilename(s: string, fallback: string): string {
    const cleaned = s
      .split('')
      .filter((c) => /[A-Za-z0-9 \-_]/.test(c))
      .join('')
      .trim()
      .slice(0, 80);
    return cleaned || fallback;
  }

  async function promptSave(
    defaultName: string,
    filters: { name: string; extensions: string[] }[],
  ): Promise<string | null> {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showSaveDialog(win!, { defaultPath: defaultName, filters });
    return result.canceled || !result.filePath ? null : result.filePath;
  }

  ipcMain.handle(
    'export:pagePdf:save',
    async (_e, jobId: string, pageId: string, suggested?: string) => {
      const tree = getResults(jobId);
      if (!tree) throw new Error('Job results not found');
      const page = findPage(tree, pageId);
      if (!page) throw new Error('Page not found');
      const breadcrumbs = bcMap(jobId)?.get(pageId) ?? [];
      const defaultName = `${suggested ?? safeFilename(page.title, 'page')}.pdf`;
      const target = await promptSave(defaultName, [{ name: 'PDF', extensions: ['pdf'] }]);
      if (!target) return { saved: false };
      const body = await preparePageHtmlForPdf(jobId, page);
      const pdf = await generatePdfFromPage({ title: page.title, bodyHtml: body, breadcrumbs });
      await fsp.writeFile(target, pdf);
      return { saved: true, path: target };
    },
  );

  ipcMain.handle(
    'export:jobPdf:save',
    async (
      _e,
      jobId: string,
      mode: 'combined' | 'zip' = 'combined',
      suggested?: string,
    ) => {
      const tree = getResults(jobId);
      if (!tree) throw new Error('Job results not found');
      const bcMapInst = buildBreadcrumbs(tree);
      const allPages = flattenTree(tree);

      const ext = mode === 'zip' ? 'zip' : 'pdf';
      const filterName = mode === 'zip' ? 'ZIP archive' : 'PDF';
      const defaultName = `${suggested ?? safeFilename(tree.title, 'translation')}${
        mode === 'zip' ? '_pdfs' : '_combined'
      }.${ext}`;
      const target = await promptSave(defaultName, [{ name: filterName, extensions: [ext] }]);
      if (!target) return { saved: false };

      const pages: PdfPage[] = await Promise.all(
        allPages.map(async (p) => ({
          title: p.title,
          bodyHtml: await preparePageHtmlForPdf(jobId, p),
          breadcrumbs: bcMapInst.get(p.pageId) ?? [],
        })),
      );
      const buf = mode === 'zip' ? await generatePdfZip(pages) : await generateCombinedPdf(pages);
      await fsp.writeFile(target, buf);
      return { saved: true, path: target };
    },
  );

  // -------- progress events: forward EventEmitter → renderer --------

  jobEvents.on('progress', (progress) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('job:progress', progress);
    }
  });

  // -------- settings --------

  const SETTINGS_KEYS = [
    'CONFLUENCE_BASE_URL',
    'LLM_API_KEY',
    'LLM_BASE_URL',
    'LLM_MODEL',
    'LLM_VISION_MODEL',
    'TARGET_LANGUAGE',
    'MAX_CONCURRENT_PAGES',
  ] as const;

  function resolveEnvFilePath(): string {
    // Same logic as loadEnv: project root .env (dev), then userData .env (packaged)
    const appPath = (() => { try { return app.getAppPath(); } catch { return process.cwd(); } })();
    const projectRoot = path.resolve(appPath, '..', '..');
    const projectEnv = path.join(projectRoot, '.env');
    if (fs.existsSync(projectEnv)) return projectEnv;
    return path.join(app.getPath('userData'), '.env');
  }

  function parseEnvFile(content: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const raw of content.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key) out[key] = val;
    }
    return out;
  }

  ipcMain.handle('settings:get', () => {
    const result: Record<string, string> = {};
    for (const k of SETTINGS_KEYS) result[k] = process.env[k] ?? '';
    return result;
  });

  ipcMain.handle('settings:save', async (_e, updates: Record<string, string>) => {
    const envPath = resolveEnvFilePath();
    let existing: Record<string, string> = {};
    let rawLines: string[] = [];
    try {
      const content = await fsp.readFile(envPath, 'utf-8');
      rawLines = content.split(/\r?\n/);
      existing = parseEnvFile(content);
    } catch {
      // file doesn't exist yet — start fresh
    }

    // Merge updates into the parsed map
    const merged = { ...existing, ...updates };

    // Rebuild file: keep comments + blank lines from original, update/append keys
    const handledKeys = new Set<string>();
    const newLines: string[] = [];

    for (const raw of rawLines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) {
        newLines.push(raw);
        continue;
      }
      const eq = line.indexOf('=');
      if (eq < 0) { newLines.push(raw); continue; }
      const key = line.slice(0, eq).trim();
      if (key in merged) {
        newLines.push(`${key}=${merged[key]}`);
        handledKeys.add(key);
      } else {
        newLines.push(raw);
      }
    }

    // Append any new keys not already in file
    for (const [k, v] of Object.entries(updates)) {
      if (!handledKeys.has(k)) newLines.push(`${k}=${v}`);
    }

    const content = newLines.join('\n') + '\n';
    await fsp.writeFile(envPath, content, 'utf-8');

    // Apply to current process.env immediately
    for (const [k, v] of Object.entries(updates)) {
      process.env[k] = v;
    }

    // Refresh the in-memory settings object so new values take effect for
    // subsequent calls without requiring a restart.
    const fresh = buildSettings();
    Object.assign(settings, fresh);

    return { saved: true, path: envPath };
  });

  ipcMain.handle('settings:listOllamaModels', async () => {
    const base = (process.env.LLM_BASE_URL ?? 'http://localhost:11434/v1')
      .replace(/\/v1\/?$/, '');
    const url = `${base}/api/tags`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return { online: false, models: [] };
      const data = (await res.json()) as { models?: { name: string }[] };
      return {
        online: true,
        models: (data.models ?? []).map((m) => m.name),
      };
    } catch {
      return { online: false, models: [] };
    }
  });
}

function flattenTree(tree: PageData): PageData[] {
  const out = [tree];
  for (const c of tree.children) out.push(...flattenTree(c));
  return out;
}
