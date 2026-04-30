export interface JobRequest {
  confluence_url: string;
  include_children: boolean;
  max_depth: number;
  target_language: string;
  export_pdf: boolean;
}

export type JobStatusType =
  | 'pending'
  | 'authenticating'
  | 'crawling'
  | 'translating'
  | 'generating_pdf'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface JobProgress {
  job_id: string;
  status: JobStatusType;
  total_pages: number;
  pages_crawled: number;
  pages_translated: number;
  current_page: string | null;
  error: string | null;
}

export interface PageNode {
  page_id: string;
  title: string;
  translated_html: string | null;
  body_html: string;
  url: string;
  children: PageNode[];
}

export interface TranslatedPage {
  page_id: string;
  title: string;
  translated_html: string;
  url: string;
}
