import { getExportPdfUrl } from '../services/api';

interface Props {
  jobId: string;
}

export function PdfDownload({ jobId }: Props) {
  return (
    <div className="pdf-download">
      <h3>Export</h3>
      <div className="export-buttons">
        <a href={getExportPdfUrl(jobId, 'combined')} className="btn" download>
          Download Combined PDF
        </a>
        <a href={getExportPdfUrl(jobId, 'zip')} className="btn btn-secondary" download>
          Download as ZIP (individual PDFs)
        </a>
      </div>
    </div>
  );
}
