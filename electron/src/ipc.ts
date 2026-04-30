/**
 * IPC handlers — replaces the FastAPI router endpoints.
 * Mounted from main.ts after app.whenReady().
 *
 * Channel naming:   <noun>:<verb>     e.g. job:create, page:get
 * Pushed events:    <noun>:<verb>     e.g. job:progress (sent via webContents.send)
 */

import { ipcMain, BrowserWindow, dialog } from 'electron';
import { promises as fsp } from 'fs';
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
}

function flattenTree(tree: PageData): PageData[] {
  const out = [tree];
  for (const c of tree.children) out.push(...flattenTree(c));
  return out;
}
