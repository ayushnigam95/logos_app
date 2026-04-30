import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProgressTracker } from '../components/ProgressTracker';
import type { JobProgress } from '../types';

function makeProgress(overrides: Partial<JobProgress> = {}): JobProgress {
  return {
    job_id: 'test-123',
    status: 'pending',
    total_pages: 0,
    pages_crawled: 0,
    pages_translated: 0,
    current_page: null,
    error: null,
    ...overrides,
  };
}

describe('ProgressTracker', () => {
  it('shows pending status', () => {
    render(<ProgressTracker progress={makeProgress({ status: 'pending' })} />);
    expect(screen.getByText('Queued')).toBeInTheDocument();
  });

  it('shows authenticating status', () => {
    render(<ProgressTracker progress={makeProgress({ status: 'authenticating' })} />);
    expect(screen.getByText('Logging in to Confluence...')).toBeInTheDocument();
  });

  it('shows crawling status with page count', () => {
    render(
      <ProgressTracker
        progress={makeProgress({
          status: 'crawling',
          total_pages: 10,
          pages_crawled: 5,
        })}
      />
    );
    expect(screen.getByText('Discovering pages...')).toBeInTheDocument();
    expect(screen.getByText(/5 found/)).toBeInTheDocument();
  });

  it('shows translating status', () => {
    render(
      <ProgressTracker
        progress={makeProgress({
          status: 'translating',
          total_pages: 10,
          pages_translated: 3,
          current_page: 'Some Page',
        })}
      />
    );
    expect(screen.getByText('Translating pages...')).toBeInTheDocument();
    expect(screen.getByText(/3 translated/)).toBeInTheDocument();
    expect(screen.getByText(/Some Page/)).toBeInTheDocument();
  });

  it('shows completed status with checkmark', () => {
    render(<ProgressTracker progress={makeProgress({ status: 'completed' })} />);
    expect(screen.getByText('Done!')).toBeInTheDocument();
    expect(screen.getByText('✓')).toBeInTheDocument();
  });

  it('shows failed status with error message', () => {
    render(
      <ProgressTracker
        progress={makeProgress({ status: 'failed', error: 'Connection timeout' })}
      />
    );
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Connection timeout')).toBeInTheDocument();
  });

  it('shows spinner for active states', () => {
    const { container } = render(
      <ProgressTracker progress={makeProgress({ status: 'translating' })} />
    );
    expect(container.querySelector('.spinner')).toBeInTheDocument();
  });

  it('does not show spinner for completed state', () => {
    const { container } = render(
      <ProgressTracker progress={makeProgress({ status: 'completed' })} />
    );
    expect(container.querySelector('.spinner')).not.toBeInTheDocument();
  });
});
