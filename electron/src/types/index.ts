/**
 * Shared types ported from backend/app/models/page.py and models/job.py.
 */

export interface PageData {
  pageId: string;
  title: string;
  spaceKey: string;
  bodyHtml: string;
  translatedHtml?: string;
  url: string;
  parentId?: string;
  children: PageData[];
  depth: number;
}

export interface PageTreeNode {
  pageId: string;
  title: string;
  translatedTitle?: string;
  url: string;
  children: PageTreeNode[];
}

export type JobStatus =
  | 'pending'
  | 'authenticating'
  | 'crawling'
  | 'translating'
  | 'generating_pdf'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface JobRequest {
  confluenceUrl: string;
  includeChildren: boolean;
  maxDepth: number; // -1 = unlimited
  targetLanguage: string;
  exportPdf: boolean;
}

export interface JobProgress {
  jobId: string;
  status: JobStatus;
  totalPages: number;
  pagesCrawled: number;
  pagesTranslated: number;
  currentPage?: string;
  error?: string;
}

export interface Job {
  jobId: string;
  request: JobRequest;
  progress: JobProgress;
}

export interface CookieJar {
  name: string;
  value: string;
  domain: string;
  path: string;
}
