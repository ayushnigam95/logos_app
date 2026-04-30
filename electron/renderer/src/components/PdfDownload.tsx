import { useState } from 'react';
import { exportJobPdf } from '../services/api';

interface Props {
  jobId: string;
}

export function PdfDownload({ jobId }: Props) {
  const [busy, setBusy] = useState<'combined' | 'zip' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const handleExport = async (mode: 'combined' | 'zip') => {
    setBusy(mode);
    setError(null);
    setSavedPath(null);
    try {
      const result = await exportJobPdf(jobId, mode);
      if (result.saved && result.path) setSavedPath(result.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="pdf-download">
      <h3>Export</h3>
      <div className="export-buttons">
        <button
          type="button"
          className="btn"
          onClick={() => handleExport('combined')}
          disabled={busy !== null}
        >
          {busy === 'combined' ? 'Generating...' : 'Download Combined PDF'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => handleExport('zip')}
          disabled={busy !== null}
        >
          {busy === 'zip' ? 'Generating...' : 'Download as ZIP (individual PDFs)'}
        </button>
      </div>
      {error && <div className="error-message">{error}</div>}
      {savedPath && <div className="success-message">Saved: {savedPath}</div>}
    </div>
  );
}
