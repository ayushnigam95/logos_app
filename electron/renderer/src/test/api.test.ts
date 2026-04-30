import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  exportJobPdf,
  exportPagePdf,
  createJob,
  getJobPages,
} from '../services/api';

function mockApi() {
  const api = {
    createJob: vi.fn().mockResolvedValue({ job_id: 'job-1', status: 'pending' }),
    getJobStatus: vi.fn(),
    getJobPages: vi.fn().mockResolvedValue({ page_id: 'p1', children: [] }),
    cancelJob: vi.fn(),
    getTranslatedPage: vi.fn(),
    getPageSummary: vi.fn(),
    getPageNotes: vi.fn(),
    analyzeImage: vi.fn(),
    exportPagePdf: vi.fn().mockResolvedValue({ saved: true, path: '/tmp/p.pdf' }),
    exportJobPdf: vi.fn().mockResolvedValue({ saved: true, path: '/tmp/j.pdf' }),
    onJobProgress: vi.fn().mockReturnValue(() => undefined),
  };
  (window as unknown as { electronAPI: typeof api }).electronAPI = api;
  return api;
}

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('api wrapper', () => {
  it('createJob delegates to electronAPI', async () => {
    const api = mockApi();
    const res = await createJob({
      confluence_url: 'https://x',
      include_children: true,
      max_depth: -1,
      target_language: 'en',
      export_pdf: true,
    });
    expect(api.createJob).toHaveBeenCalled();
    expect(res).toEqual({ job_id: 'job-1', status: 'pending' });
  });

  it('getJobPages delegates', async () => {
    const api = mockApi();
    await getJobPages('job-1');
    expect(api.getJobPages).toHaveBeenCalledWith('job-1');
  });

  it('exportPagePdf forwards args', async () => {
    const api = mockApi();
    const res = await exportPagePdf('job-1', 'page-42', 'doc');
    expect(api.exportPagePdf).toHaveBeenCalledWith('job-1', 'page-42', 'doc');
    expect(res.saved).toBe(true);
  });

  it('exportJobPdf forwards mode', async () => {
    const api = mockApi();
    await exportJobPdf('job-1', 'zip');
    expect(api.exportJobPdf).toHaveBeenCalledWith('job-1', 'zip', undefined);
  });
});
