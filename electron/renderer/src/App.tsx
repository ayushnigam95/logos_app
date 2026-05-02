import { useState, useEffect, useRef } from 'react';
import { UrlInput } from './components/UrlInput';
import { ProgressTracker } from './components/ProgressTracker';
import { PageTree } from './components/PageTree';
import { PageViewer } from './components/PageViewer';
import { PdfDownload } from './components/PdfDownload';
import { Settings } from './components/Settings';
import { useWebSocket } from './hooks/useWebSocket';
import { createJob, getJobPages, listOllamaModels } from './services/api';
import type { JobRequest, PageNode } from './types';

export default function App() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageTree, setPageTree] = useState<PageNode | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [ollamaOnline, setOllamaOnline] = useState<boolean | null>(null);
  const fetchedJobRef = useRef<string | null>(null);

  const { progress } = useWebSocket(jobId);

  // Poll Ollama status for header indicator
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const { online } = await listOllamaModels();
        if (!cancelled) setOllamaOnline(online);
      } catch {
        if (!cancelled) setOllamaOnline(false);
      }
    };
    poll();
    const id = setInterval(poll, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const handleSubmit = async (request: JobRequest) => {
    setLoading(true);
    setError(null);
    setPageTree(null);
    setSelectedPageId(null);
    fetchedJobRef.current = null;
    try {
      const jobProgress = await createJob(request);
      setJobId(jobProgress.job_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start job');
      setLoading(false);
    }
  };

  // Clear stale errors once the new job starts making progress
  useEffect(() => {
    if (progress && progress.status !== 'completed' && progress.status !== 'failed') {
      setError(null);
    }
  }, [progress]);

  // When job completes, fetch the page tree
  useEffect(() => {
    if (
      progress?.status === 'completed' &&
      jobId &&
      fetchedJobRef.current !== jobId &&
      progress.job_id === jobId
    ) {
      fetchedJobRef.current = jobId;
      getJobPages(jobId)
        .then((tree) => {
          setPageTree(tree);
          setSelectedPageId(tree.page_id);
          setError(null);
          setLoading(false);
        })
        .catch((e) => {
          setError(e.message);
          setLoading(false);
        });
    }
    if (progress?.status === 'failed') {
      setLoading(false);
    }
  }, [progress?.status, jobId]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-title">
          <h1>🌐 Logos</h1>
          <p>Translate Confluence pages to English — including nested children and images</p>
        </div>
        <div className="app-header-actions">
          {ollamaOnline !== null && (
            <span className={`header-status-dot ${ollamaOnline ? 'online' : 'offline'}`} title={ollamaOnline ? 'Ollama online' : 'Ollama offline'} />
          )}
          <button
            className="header-settings-btn"
            onClick={() => setShowSettings(true)}
            title="Settings"
          >
            ⚙️
          </button>
        </div>
      </header>

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}

      <main>
        <UrlInput onSubmit={handleSubmit} loading={loading} />

        {error && <div className="error-banner">{error}</div>}

        {progress && <ProgressTracker progress={progress} />}

        {pageTree && jobId && (
          <div className="results-layout">
            <aside className="sidebar">
              <PageTree
                tree={pageTree}
                selectedPageId={selectedPageId}
                onSelectPage={setSelectedPageId}
              />
              <PdfDownload jobId={jobId} />
            </aside>
            <section className="main-content">
              {selectedPageId && (
                <PageViewer jobId={jobId} pageId={selectedPageId} />
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
