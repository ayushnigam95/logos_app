import { describe, it, expect } from 'vitest';
import { getExportPdfUrl, getPagePdfUrl } from '../services/api';

describe('API helpers', () => {
  it('getExportPdfUrl returns correct combined URL', () => {
    expect(getExportPdfUrl('job-1', 'combined')).toBe('/api/export/jobs/job-1/pdf?mode=combined');
  });

  it('getExportPdfUrl returns correct zip URL', () => {
    expect(getExportPdfUrl('job-1', 'zip')).toBe('/api/export/jobs/job-1/pdf?mode=zip');
  });

  it('getExportPdfUrl defaults to combined', () => {
    expect(getExportPdfUrl('job-1')).toBe('/api/export/jobs/job-1/pdf?mode=combined');
  });

  it('getPagePdfUrl returns correct URL', () => {
    expect(getPagePdfUrl('job-1', 'page-42')).toBe('/api/export/pages/job-1/page-42/pdf');
  });
});
