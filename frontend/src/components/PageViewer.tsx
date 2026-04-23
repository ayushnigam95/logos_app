import { useEffect, useRef, useState } from 'react';
import { getTranslatedPage, getPagePdfUrl, getPageSummary, getPageNotes, analyzeImage } from '../services/api';
import type { ImageChatMessage } from '../services/api';
import type { TranslatedPage } from '../types';

interface Props {
  jobId: string;
  pageId: string;
}

type PanelType = 'summary' | 'notes';

export function PageViewer({ jobId, pageId }: Props) {
  const [page, setPage] = useState<TranslatedPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<PanelType | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [panelContent, setPanelContent] = useState<Record<PanelType, string | null>>({
    summary: null, notes: null,
  });
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [imageChat, setImageChat] = useState<{
    src: string;
    messages: ImageChatMessage[];
    loading: boolean;
    error: string | null;
    model: string | null;
  } | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [imageFit, setImageFit] = useState(false); // false = natural (full) resolution, true = fit to pane
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setActivePanel(null);
    setPanelContent({ summary: null, notes: null });
    getTranslatedPage(jobId, pageId)
      .then(setPage)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [jobId, pageId]);

  const handlePanelClick = async (type: PanelType) => {
    if (activePanel === type) {
      setActivePanel(null);
      return;
    }
    setActivePanel(type);
    if (panelContent[type]) return;

    setPanelLoading(true);
    try {
      const fetchers = { summary: getPageSummary, notes: getPageNotes };
      const result = await fetchers[type](jobId, pageId);
      setPanelContent((prev) => ({ ...prev, [type]: result }));
    } catch {
      setPanelContent((prev) => ({ ...prev, [type]: 'Failed to generate content.' }));
    } finally {
      setPanelLoading(false);
    }
  };

  const handleAnalyzeImage = async (src: string) => {
    const initialQuestion =
      'Describe this image in detail. If it is a diagram, explain its structure, components, and relationships. If it contains text, transcribe the key text. Be concise and use plain text (no markdown).';
    const initialHistory: ImageChatMessage[] = [{ role: 'user', content: initialQuestion }];
    setChatInput('');
    setImageFit(false);
    setImageChat({ src, messages: initialHistory, loading: true, error: null, model: null });
    try {
      const result = await analyzeImage(jobId, src, { history: initialHistory });
      setImageChat({
        src,
        messages: [...initialHistory, { role: 'assistant', content: result.analysis }],
        loading: false,
        error: null,
        model: result.model,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to analyze image';
      setImageChat({ src, messages: initialHistory, loading: false, error: msg, model: null });
    }
  };

  const handleSendChat = async () => {
    if (!imageChat || imageChat.loading) return;
    const text = chatInput.trim();
    if (!text) return;
    const newMessages: ImageChatMessage[] = [...imageChat.messages, { role: 'user', content: text }];
    setChatInput('');
    setImageChat({ ...imageChat, messages: newMessages, loading: true, error: null });
    try {
      const result = await analyzeImage(jobId, imageChat.src, { history: newMessages });
      setImageChat({
        src: imageChat.src,
        messages: [...newMessages, { role: 'assistant', content: result.analysis }],
        loading: false,
        error: null,
        model: result.model,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to get response';
      setImageChat({ ...imageChat, messages: newMessages, loading: false, error: msg });
    }
  };

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    if (imageChat) {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [imageChat?.messages.length, imageChat?.loading]);

  // After page HTML renders, wrap each <img> with a hoverable container that includes
  // an "Analyze" button. Images that are already wrapped are skipped.
  useEffect(() => {
    if (!page || !contentRef.current) return;
    const root = contentRef.current;
    const imgs = Array.from(root.querySelectorAll('img'));
    const cleanups: Array<() => void> = [];

    imgs.forEach((img) => {
      if (img.parentElement?.classList.contains('analyzable-image')) return;
      const wrapper = document.createElement('span');
      wrapper.className = 'analyzable-image';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'analyze-image-btn';
      btn.textContent = '🔍 Analyze with AI';
      const onClick = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        const src = img.getAttribute('src') || '';
        if (src) handleAnalyzeImage(src);
      };
      btn.addEventListener('click', onClick);
      img.parentNode?.insertBefore(wrapper, img);
      wrapper.appendChild(img);
      wrapper.appendChild(btn);
      cleanups.push(() => btn.removeEventListener('click', onClick));
    });

    return () => {
      cleanups.forEach((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  if (loading) return <div className="page-viewer loading">Loading page...</div>;
  if (error) return <div className="page-viewer error">Error: {error}</div>;
  if (!page) return null;

  const panelLabels: Record<PanelType, { icon: string; label: string }> = {
    summary: { icon: '📋', label: 'Summary' },
    notes: { icon: '📝', label: 'Important Notes' },
  };

  return (
    <div className="page-viewer">
      <div className="page-viewer-header">
        <h2>{page.title}</h2>
        <div className="page-viewer-actions">
          {(['summary', 'notes'] as PanelType[]).map((type) => (
            <button
              key={type}
              className={`btn btn-small ${activePanel === type ? 'btn-active' : 'btn-secondary'}`}
              onClick={() => handlePanelClick(type)}
            >
              {panelLabels[type].icon} {activePanel === type ? `Hide ${panelLabels[type].label}` : panelLabels[type].label}
            </button>
          ))}
          <a href={getPagePdfUrl(jobId, pageId)} className="btn btn-small" download>
            Download PDF
          </a>
        </div>
      </div>
      {activePanel && (
        <div className={`page-panel page-panel-${activePanel}`}>
          <h3>{panelLabels[activePanel].icon} {panelLabels[activePanel].label}</h3>
          {panelLoading && !panelContent[activePanel] ? (
            <p className="panel-loading">Generating...</p>
          ) : (
            <pre className="panel-text">{panelContent[activePanel]}</pre>
          )}
        </div>
      )}
      <div
        ref={contentRef}
        className="page-content"
        dangerouslySetInnerHTML={{ __html: page.translated_html }}
      />
      {imageChat && (
        <div className="image-analysis-overlay" onClick={() => setImageChat(null)}>
          <div className="image-analysis-modal" onClick={(e) => e.stopPropagation()}>
            <div className="image-analysis-header">
              <h3>🔍 Image Analysis {imageChat.model && <span className="image-analysis-model-badge">({imageChat.model})</span>}</h3>
              <button
                type="button"
                className="image-analysis-close"
                onClick={() => setImageChat(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="image-analysis-body">
              <div className={`image-analysis-image-pane${imageFit ? ' fit' : ''}`}>
                <div className="image-analysis-toolbar">
                  <button
                    type="button"
                    onClick={() => setImageFit((f) => !f)}
                    title={imageFit ? 'Show full resolution' : 'Fit to pane'}
                  >
                    {imageFit ? '🔍 Full size' : '🗜 Fit'}
                  </button>
                  <a href={imageChat.src} target="_blank" rel="noopener noreferrer">
                    ↗ Open in new tab
                  </a>
                </div>
                <img
                  src={imageChat.src}
                  alt="Analyzed"
                  className="image-analysis-preview"
                  onClick={() => setImageFit((f) => !f)}
                />
              </div>
              <div className="image-analysis-chat-pane">
                <div className="image-chat-messages">
                  {imageChat.messages.map((m, i) => (
                    <div key={i} className={`chat-msg chat-msg-${m.role}`}>
                      <div className="chat-msg-role">{m.role === 'user' ? 'You' : 'AI'}</div>
                      <div className="chat-msg-content">{m.content}</div>
                    </div>
                  ))}
                  {imageChat.loading && (
                    <div className="chat-msg chat-msg-assistant">
                      <div className="chat-msg-role">AI</div>
                      <div className="chat-msg-content panel-loading">Thinking...</div>
                    </div>
                  )}
                  {imageChat.error && (
                    <div className="image-analysis-error">{imageChat.error}</div>
                  )}
                  <div ref={chatBottomRef} />
                </div>
                <form
                  className="image-chat-input-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendChat();
                  }}
                >
                  <input
                    type="text"
                    className="image-chat-input"
                    placeholder="Ask a follow-up question..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    disabled={imageChat.loading}
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="btn btn-small"
                    disabled={imageChat.loading || !chatInput.trim()}
                  >
                    Send
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
