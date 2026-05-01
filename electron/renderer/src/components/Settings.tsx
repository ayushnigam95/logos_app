import { useCallback, useEffect, useRef, useState } from 'react';
import { getSettings, saveSettings, listOllamaModels } from '../services/api';

interface OllamaStatus {
  online: boolean;
  models: string[];
  loading: boolean;
}

interface FormState {
  CONFLUENCE_BASE_URL: string;
  LLM_API_KEY: string;
  LLM_BASE_URL: string;
  LLM_MODEL: string;
  LLM_VISION_MODEL: string;
  TARGET_LANGUAGE: string;
  MAX_CONCURRENT_PAGES: string;
}

const DEFAULTS: FormState = {
  CONFLUENCE_BASE_URL: '',
  LLM_API_KEY: 'ollama',
  LLM_BASE_URL: 'http://localhost:11434/v1',
  LLM_MODEL: '',
  LLM_VISION_MODEL: '',
  TARGET_LANGUAGE: 'en',
  MAX_CONCURRENT_PAGES: '5',
};

interface Props {
  onClose: () => void;
}

export function Settings({ onClose }: Props) {
  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [ollama, setOllama] = useState<OllamaStatus>({ online: false, models: [], loading: true });
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load saved settings on mount
  useEffect(() => {
    getSettings()
      .then((s) =>
        setForm((f) => ({
          ...f,
          ...Object.fromEntries(
            Object.entries(s).filter(([, v]) => v !== ''),
          ),
        })),
      )
      .catch(() => {/* use defaults */});
  }, []);

  const refreshOllama = useCallback(async () => {
    setOllama((o) => ({ ...o, loading: true }));
    try {
      const result = await listOllamaModels();
      setOllama({ ...result, loading: false });
    } catch {
      setOllama({ online: false, models: [], loading: false });
    }
  }, []);

  // Poll Ollama status every 5 seconds
  useEffect(() => {
    refreshOllama();
    pollRef.current = setInterval(refreshOllama, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [refreshOllama]);

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSavedPath(null);
    try {
      const result = await saveSettings(form);
      setSavedPath(result.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const modelOptions = ollama.models.length > 0 ? ollama.models : (form.LLM_MODEL ? [form.LLM_MODEL] : []);
  const visionOptions = ollama.models.length > 0 ? ollama.models : (form.LLM_VISION_MODEL ? [form.LLM_VISION_MODEL] : []);

  return (
    <div className="settings-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings-panel">
        <div className="settings-header">
          <h2>⚙️ Settings</h2>
          <button className="settings-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSave} className="settings-form">

          {/* Confluence */}
          <section className="settings-section">
            <h3>Confluence</h3>
            <label>
              <span>Base URL</span>
              <input
                type="url"
                value={form.CONFLUENCE_BASE_URL}
                onChange={set('CONFLUENCE_BASE_URL')}
                placeholder="https://your-org.atlassian.net"
                required
              />
            </label>
          </section>

          {/* LLM / Ollama */}
          <section className="settings-section">
            <div className="settings-section-header">
              <h3>LLM / Ollama</h3>
              <div className="ollama-status">
                <span className={`ollama-dot ${ollama.loading ? 'loading' : ollama.online ? 'online' : 'offline'}`} />
                <span className="ollama-label">
                  {ollama.loading ? 'Checking…' : ollama.online ? `Online · ${ollama.models.length} model${ollama.models.length !== 1 ? 's' : ''}` : 'Offline'}
                </span>
                <button type="button" className="ollama-refresh" onClick={refreshOllama} title="Refresh">↻</button>
              </div>
            </div>

            <label>
              <span>Base URL</span>
              <input
                type="url"
                value={form.LLM_BASE_URL}
                onChange={set('LLM_BASE_URL')}
                placeholder="http://localhost:11434/v1"
              />
            </label>

            <label>
              <span>API Key</span>
              <input
                type="text"
                value={form.LLM_API_KEY}
                onChange={set('LLM_API_KEY')}
                placeholder="ollama (or your API key)"
              />
            </label>

            <label>
              <span>Text Model</span>
              <div className="model-select-row">
                <select value={form.LLM_MODEL} onChange={set('LLM_MODEL')}>
                  {form.LLM_MODEL && !modelOptions.includes(form.LLM_MODEL) && (
                    <option value={form.LLM_MODEL}>{form.LLM_MODEL}</option>
                  )}
                  {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                  {modelOptions.length === 0 && <option value="">— start Ollama to list models —</option>}
                </select>
                {!ollama.online && (
                  <input
                    type="text"
                    className="model-manual-input"
                    value={form.LLM_MODEL}
                    onChange={set('LLM_MODEL')}
                    placeholder="or type model name"
                  />
                )}
              </div>
            </label>

            <label>
              <span>Vision Model</span>
              <div className="model-select-row">
                <select value={form.LLM_VISION_MODEL} onChange={set('LLM_VISION_MODEL')}>
                  {form.LLM_VISION_MODEL && !visionOptions.includes(form.LLM_VISION_MODEL) && (
                    <option value={form.LLM_VISION_MODEL}>{form.LLM_VISION_MODEL}</option>
                  )}
                  {visionOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                  {visionOptions.length === 0 && <option value="">— same as text model —</option>}
                </select>
                {!ollama.online && (
                  <input
                    type="text"
                    className="model-manual-input"
                    value={form.LLM_VISION_MODEL}
                    onChange={set('LLM_VISION_MODEL')}
                    placeholder="or type model name"
                  />
                )}
              </div>
            </label>
          </section>

          {/* Translation */}
          <section className="settings-section">
            <h3>Translation</h3>
            <label>
              <span>Target Language</span>
              <input
                type="text"
                value={form.TARGET_LANGUAGE}
                onChange={set('TARGET_LANGUAGE')}
                placeholder="en"
                maxLength={10}
              />
              <small>BCP-47 language code, e.g. <code>en</code>, <code>es</code>, <code>fr</code></small>
            </label>
            <label>
              <span>Max Concurrent Pages</span>
              <input
                type="number"
                min={1}
                max={20}
                value={form.MAX_CONCURRENT_PAGES}
                onChange={set('MAX_CONCURRENT_PAGES')}
              />
            </label>
          </section>

          {error && <p className="settings-error">{error}</p>}
          {savedPath && (
            <p className="settings-saved">✓ Settings saved and applied — new values will be used for the next request.</p>
          )}

          <div className="settings-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
