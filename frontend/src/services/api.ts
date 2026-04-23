import type { JobRequest, JobProgress, PageNode, TranslatedPage } from '../types';

const API_BASE = '/api';

export async function createJob(request: JobRequest): Promise<JobProgress> {
  const resp = await fetch(`${API_BASE}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: 'Request failed' }));
    throw new Error(err.detail || 'Failed to create job');
  }
  return resp.json();
}

export async function getJobStatus(jobId: string): Promise<JobProgress> {
  const resp = await fetch(`${API_BASE}/jobs/${jobId}`);
  if (!resp.ok) throw new Error('Failed to get job status');
  return resp.json();
}

export async function getJobPages(jobId: string): Promise<PageNode> {
  const resp = await fetch(`${API_BASE}/jobs/${jobId}/pages`);
  if (!resp.ok) throw new Error('Failed to get pages');
  return resp.json();
}

export async function getTranslatedPage(jobId: string, pageId: string): Promise<TranslatedPage> {
  const resp = await fetch(`${API_BASE}/pages/${jobId}/${pageId}`);
  if (!resp.ok) throw new Error('Failed to get page');
  return resp.json();
}

export function getExportPdfUrl(jobId: string, mode: 'combined' | 'zip' = 'combined'): string {
  return `${API_BASE}/export/jobs/${jobId}/pdf?mode=${mode}`;
}

export function getPagePdfUrl(jobId: string, pageId: string): string {
  return `${API_BASE}/export/pages/${jobId}/${pageId}/pdf`;
}

export async function getPageSummary(jobId: string, pageId: string): Promise<string> {
  const resp = await fetch(`${API_BASE}/pages/${jobId}/${pageId}/summary`);
  if (!resp.ok) throw new Error('Failed to generate summary');
  const data = await resp.json();
  return data.summary;
}

export async function getPageNotes(jobId: string, pageId: string): Promise<string> {
  const resp = await fetch(`${API_BASE}/pages/${jobId}/${pageId}/notes`);
  if (!resp.ok) throw new Error('Failed to generate notes');
  const data = await resp.json();
  return data.notes;
}

export type ImageChatMessage = { role: 'user' | 'assistant'; content: string };

export async function analyzeImage(
  jobId: string,
  imageUrl: string,
  options?: { question?: string; history?: ImageChatMessage[] },
): Promise<{ analysis: string; model: string }> {
  const resp = await fetch(`${API_BASE}/pages/${jobId}/analyze-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: imageUrl,
      question: options?.question,
      history: options?.history,
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: 'Analysis failed' }));
    throw new Error(err.detail || 'Failed to analyze image');
  }
  return resp.json();
}
