import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PdfDownload } from '../components/PdfDownload';

const exportJobPdf = vi.fn();

beforeEach(() => {
  exportJobPdf.mockReset().mockResolvedValue({ saved: true, path: '/tmp/x.pdf' });
  (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
    exportJobPdf,
  };
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('PdfDownload', () => {
  it('renders export heading', () => {
    render(<PdfDownload jobId="abc-123" />);
    expect(screen.getByText('Export')).toBeInTheDocument();
  });

  it('triggers combined export via IPC on click', async () => {
    render(<PdfDownload jobId="abc-123" />);
    fireEvent.click(screen.getByText('Download Combined PDF'));
    await waitFor(() => expect(exportJobPdf).toHaveBeenCalledWith('abc-123', 'combined', undefined));
  });

  it('triggers zip export via IPC on click', async () => {
    render(<PdfDownload jobId="abc-123" />);
    fireEvent.click(screen.getByText('Download as ZIP (individual PDFs)'));
    await waitFor(() => expect(exportJobPdf).toHaveBeenCalledWith('abc-123', 'zip', undefined));
  });
});
