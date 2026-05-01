/// <reference types="vite/client" />

type ImageChatMessage = { role: 'user' | 'assistant'; content: string };

interface ElectronAPI {
  createJob: (request: unknown) => Promise<unknown>;
  getJobStatus: (jobId: string) => Promise<unknown>;
  getJobPages: (jobId: string) => Promise<unknown>;
  cancelJob: (jobId: string) => Promise<boolean>;

  getTranslatedPage: (jobId: string, pageId: string) => Promise<unknown>;
  getPageSummary: (jobId: string, pageId: string) => Promise<string>;
  getPageNotes: (jobId: string, pageId: string) => Promise<string>;

  analyzeImage: (
    jobId: string,
    url: string,
    options?: { question?: string; history?: ImageChatMessage[] },
  ) => Promise<{ analysis: string; model: string }>;

  exportPagePdf: (
    jobId: string,
    pageId: string,
    suggestedName?: string,
  ) => Promise<{ saved: boolean; path?: string }>;
  exportJobPdf: (
    jobId: string,
    mode: 'combined' | 'zip',
    suggestedName?: string,
  ) => Promise<{ saved: boolean; path?: string }>;

  getSettings: () => Promise<Record<string, string>>;
  saveSettings: (updates: Record<string, string>) => Promise<{ saved: boolean; path: string }>;
  listOllamaModels: () => Promise<{ online: boolean; models: string[] }>;

  onJobProgress: (cb: (progress: unknown) => void) => () => void;
}

interface Window {
  electronAPI?: ElectronAPI;
}
