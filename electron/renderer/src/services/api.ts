/**
 * API layer — thin wrapper around window.electronAPI exposed by preload.ts.
 *
 * The preload bridge handles snake_case ↔ camelCase conversion, so frontend
 * types can stay in their original snake_case form.
 */
import type { JobRequest, JobProgress, PageNode, TranslatedPage } from '../types';

function api() {
  if (typeof window === 'undefined' || !window.electronAPI) {
    throw new Error('electronAPI is not available — preload script did not load');
  }
  return window.electronAPI;
}

export async function createJob(request: JobRequest): Promise<JobProgress> {
  return api().createJob(request) as Promise<JobProgress>;
}

export async function getJobStatus(jobId: string): Promise<JobProgress> {
  return api().getJobStatus(jobId) as Promise<JobProgress>;
}

export async function getJobPages(jobId: string): Promise<PageNode> {
  return api().getJobPages(jobId) as Promise<PageNode>;
}

export async function getTranslatedPage(jobId: string, pageId: string): Promise<TranslatedPage> {
  return api().getTranslatedPage(jobId, pageId) as Promise<TranslatedPage>;
}

export async function getPageSummary(jobId: string, pageId: string): Promise<string> {
  return api().getPageSummary(jobId, pageId);
}

export async function getPageNotes(jobId: string, pageId: string): Promise<string> {
  return api().getPageNotes(jobId, pageId);
}

export type ImageChatMessage = { role: 'user' | 'assistant'; content: string };

export async function analyzeImage(
  jobId: string,
  imageUrl: string,
  options?: { question?: string; history?: ImageChatMessage[] },
): Promise<{ analysis: string; model: string }> {
  return api().analyzeImage(jobId, imageUrl, options);
}

/** Triggers the native save dialog and writes the PDF to disk. */
export async function exportPagePdf(
  jobId: string,
  pageId: string,
  suggestedName?: string,
): Promise<{ saved: boolean; path?: string }> {
  return api().exportPagePdf(jobId, pageId, suggestedName);
}

export async function exportJobPdf(
  jobId: string,
  mode: 'combined' | 'zip' = 'combined',
  suggestedName?: string,
): Promise<{ saved: boolean; path?: string }> {
  return api().exportJobPdf(jobId, mode, suggestedName);
}

export async function cancelJob(jobId: string): Promise<boolean> {
  return api().cancelJob(jobId);
}
