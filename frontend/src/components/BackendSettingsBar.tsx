import { CheckCircle2, Loader2, Server, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  checkHealth,
  getCustomApiBase,
  isGitHubPagesHost,
  setCustomApiBase,
} from '../api/client';

interface BackendSettingsBarProps {
  onClose: () => void;
  onConnected: (online: boolean) => void;
}

export function BackendSettingsBar({
  onClose,
  onConnected,
}: BackendSettingsBarProps) {
  const [inputUrl, setInputUrl] = useState(getCustomApiBase());
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'error';
    text: string;
  } | null>(null);

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    setTesting(true);
    setFeedback(null);

    const saved = setCustomApiBase(inputUrl);
    setInputUrl(saved);
    const ok = await checkHealth(saved);
    onConnected(ok);
    setTesting(false);

    if (ok) {
      setFeedback({
        type: 'ok',
        text: saved
          ? `Connected to ${saved}`
          : 'Connected to same-origin FlipDown API.',
      });
    } else {
      setFeedback({
        type: 'error',
        text: saved
          ? `Could not reach ${saved}/api/health. Check that the server is running and allows HTTPS/CORS.`
          : 'No same-origin backend detected. Enter a deployed FlipDown Backend URL (e.g. Render, Railway, or localhost).',
      });
    }
  };

  const handleClear = async () => {
    setInputUrl('');
    setCustomApiBase('');
    setFeedback(null);
    const ok = await checkHealth('');
    onConnected(ok);
  };

  return (
    <section className="settings-drawer" aria-label="Backend API configuration">
      <div className="settings-drawer-inner">
        <div className="settings-header">
          <div className="settings-title-group">
            <Server size={16} aria-hidden="true" />
            <strong>FlipDown Backend API Connection</strong>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            aria-label="Close backend settings"
          >
            <X size={16} />
          </button>
        </div>

        <p className="settings-desc">
          {isGitHubPagesHost()
            ? 'GitHub Pages serves static web files only. To scrape FlipHTML5 URLs directly without browser CORS restrictions, connect a deployed FlipDown Node.js backend (or run it locally on http://localhost:3001).'
            : 'Leave blank to use the built-in local server (/api), or enter a remote FlipDown backend URL.'}
        </p>

        <form className="settings-form" onSubmit={handleSave}>
          <input
            id="backend-url-input"
            type="url"
            className="field-input settings-input"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="https://your-flipdown-api.onrender.com or http://localhost:3001"
          />
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={testing}
          >
            {testing ? (
              <>
                <Loader2 size={14} className="spin" />
                <span>Testing...</span>
              </>
            ) : (
              <span>Test &amp; Save</span>
            )}
          </button>
          {inputUrl && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleClear}
            >
              Reset
            </button>
          )}
        </form>

        {feedback && (
          <p
            className={`settings-feedback ${
              feedback.type === 'ok' ? 'ok' : 'error'
            }`}
          >
            {feedback.type === 'ok' && <CheckCircle2 size={14} />}
            <span>{feedback.text}</span>
          </p>
        )}
      </div>
    </section>
  );
}
