import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PdfDownload } from '../components/PdfDownload';

describe('PdfDownload', () => {
  it('renders export heading', () => {
    render(<PdfDownload jobId="abc-123" />);
    expect(screen.getByText('Export')).toBeInTheDocument();
  });

  it('renders combined PDF download link', () => {
    render(<PdfDownload jobId="abc-123" />);
    const link = screen.getByText('Download Combined PDF');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/api/export/jobs/abc-123/pdf?mode=combined');
  });

  it('renders ZIP download link', () => {
    render(<PdfDownload jobId="abc-123" />);
    const link = screen.getByText('Download as ZIP (individual PDFs)');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/api/export/jobs/abc-123/pdf?mode=zip');
  });
});
