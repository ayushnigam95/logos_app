/**
 * Preload bridge — exposes IPC methods to the renderer.
 *
 * Frontend types use snake_case (kept unchanged from their FastAPI origins);
 * the Electron main process uses camelCase. This file converts at the
 * boundary so neither side has to change its conventions.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const SNAKE_RE = /_([a-z0-9])/g;
const CAMEL_RE = /([a-z0-9])([A-Z])/g;

function snakeToCamel(s: string): string {
  return s.replace(SNAKE_RE, (_, c: string) => c.toUpperCase());
}
function camelToSnake(s: string): string {
  return s.replace(CAMEL_RE, '$1_$2').toLowerCase();
}

function convertKeys(value: unknown, fn: (k: string) => string): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => convertKeys(v, fn));
  if (typeof value === 'object') {
    if (value instanceof Uint8Array || ArrayBuffer.isView(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[fn(k)] = convertKeys(v, fn);
    }
    return out;
  }
  return value;
}

const toCamel = <T = unknown>(v: unknown): T => convertKeys(v, snakeToCamel) as T;
const toSnake = <T = unknown>(v: unknown): T => convertKeys(v, camelToSnake) as T;

type ImageChatMessage = { role: 'user' | 'assistant'; content: string };

const api = {
  createJob: async (request: unknown) => {
    const res = await ipcRenderer.invoke('job:create', toCamel(request));
    return toSnake(res);
  },
  getJobStatus: async (jobId: string) => {
    const res = await ipcRenderer.invoke('job:get', jobId);
    return toSnake(res);
  },
  getJobPages: async (jobId: string) => {
    const res = await ipcRenderer.invoke('job:pages', jobId);
    return toSnake(res);
  },
  cancelJob: (jobId: string) => ipcRenderer.invoke('job:cancel', jobId),

  getTranslatedPage: async (jobId: string, pageId: string) => {
    const res = await ipcRenderer.invoke('page:get', jobId, pageId);
    return toSnake(res);
  },
  getPageSummary: (jobId: string, pageId: string) =>
    ipcRenderer.invoke('page:summary', jobId, pageId) as Promise<string>,
  getPageNotes: (jobId: string, pageId: string) =>
    ipcRenderer.invoke('page:notes', jobId, pageId) as Promise<string>,

  analyzeImage: (
    jobId: string,
    url: string,
    options?: { question?: string; history?: ImageChatMessage[] },
  ) =>
    ipcRenderer.invoke('image:analyze', {
      jobId,
      url,
      question: options?.question,
      history: options?.history,
    }) as Promise<{ analysis: string; model: string }>,

  exportPagePdf: (jobId: string, pageId: string, suggestedName?: string) =>
    ipcRenderer.invoke('export:pagePdf:save', jobId, pageId, suggestedName) as Promise<{
      saved: boolean;
      path?: string;
    }>,
  exportJobPdf: (jobId: string, mode: 'combined' | 'zip', suggestedName?: string) =>
    ipcRenderer.invoke('export:jobPdf:save', jobId, mode, suggestedName) as Promise<{
      saved: boolean;
      path?: string;
    }>,

  onJobProgress: (cb: (progress: unknown) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, progress: unknown) => {
      cb(toSnake(progress));
    };
    ipcRenderer.on('job:progress', listener);
    return () => ipcRenderer.removeListener('job:progress', listener);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
