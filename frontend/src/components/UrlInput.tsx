import { useState } from 'react';
import type { JobRequest } from '../types';

interface Props {
  onSubmit: (request: JobRequest) => void;
  loading: boolean;
}

export function UrlInput({ onSubmit, loading }: Props) {
  const [url, setUrl] = useState('');
  const [includeChildren, setIncludeChildren] = useState(true);
  const [maxDepth, setMaxDepth] = useState(-1);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    onSubmit({
      confluence_url: url.trim(),
      include_children: includeChildren,
      max_depth: maxDepth,
      target_language: 'en',
      export_pdf: true,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="url-input">
      <div className="input-group">
        <label htmlFor="confluence-url">Confluence Page URL</label>
        <input
          id="confluence-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://yourcompany.atlassian.net/wiki/spaces/SPACE/pages/12345/Page+Title"
          required
          disabled={loading}
        />
      </div>

      <div className="options">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={includeChildren}
            onChange={(e) => setIncludeChildren(e.target.checked)}
            disabled={loading}
          />
          Include child pages
        </label>

        {includeChildren && (
          <div className="input-group inline">
            <label htmlFor="max-depth">Max depth</label>
            <select
              id="max-depth"
              value={maxDepth}
              onChange={(e) => setMaxDepth(Number(e.target.value))}
              disabled={loading}
            >
              <option value={-1}>Unlimited</option>
              <option value={1}>1 level</option>
              <option value={2}>2 levels</option>
              <option value={3}>3 levels</option>
              <option value={5}>5 levels</option>
            </select>
          </div>
        )}
      </div>

      <button type="submit" disabled={loading || !url.trim()}>
        {loading ? 'Translating...' : 'Translate'}
      </button>
    </form>
  );
}
