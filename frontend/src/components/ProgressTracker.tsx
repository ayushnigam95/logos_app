import type { JobProgress } from '../types';

interface Props {
  progress: JobProgress;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Queued',
  authenticating: 'Logging in to Confluence...',
  crawling: 'Discovering pages...',
  translating: 'Translating pages...',
  generating_pdf: 'Generating PDFs...',
  completed: 'Done!',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function ProgressTracker({ progress }: Props) {
  const { status, total_pages, pages_crawled, pages_translated, current_page, error } = progress;

  const isActive = ['authenticating', 'crawling', 'translating', 'generating_pdf'].includes(status);
  const isDone = status === 'completed';
  const isFailed = status === 'failed';

  // Calculate overall progress percentage
  let percent = 0;
  if (status === 'authenticating') percent = 5;
  else if (status === 'crawling') percent = 10 + (total_pages > 0 ? (pages_crawled / total_pages) * 30 : 0);
  else if (status === 'translating') percent = 40 + (total_pages > 0 ? (pages_translated / total_pages) * 55 : 0);
  else if (status === 'generating_pdf') percent = 95;
  else if (isDone) percent = 100;

  return (
    <div className={`progress-tracker ${isFailed ? 'error' : ''}`}>
      <div className="progress-header">
        <span className="status-label">{STATUS_LABELS[status] || status}</span>
        {isActive && <span className="spinner" />}
        {isDone && <span className="checkmark">✓</span>}
      </div>

      <div className="progress-bar-container">
        <div className="progress-bar" style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>

      <div className="progress-details">
        {total_pages > 0 && (
          <span>
            Pages: {pages_crawled} found · {pages_translated} translated / {total_pages} total
          </span>
        )}
        {current_page && <span className="current-page">Current: {current_page}</span>}
        {error && <span className="error-message">{error}</span>}
      </div>
    </div>
  );
}
