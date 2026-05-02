import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Brain, Sparkles, Tag, Calendar as CalendarIcon, Globe, ArrowLeft,
  AlertTriangle, Link2, Check, Copy, Clock, FileText, Eye, ArrowUpRight,
} from 'lucide-react';
import x247Logo from '../assets/x247-logo.webp';

interface SharedMemory {
  id: string;
  title: string;
  summary: string;
  key_points: string[];
  tags: string[];
  domain: string;
  source_type: string;
  source_url: string;
  created_at: string;
  shared_at: string;
}

const SharePage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [memory, setMemory] = useState<SharedMemory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/share/${token}`).then(async r => {
      if (!r.ok) {
        setError(r.status === 404 ? 'This link has expired or no longer exists.' : 'Could not load shared memory.');
        setLoading(false);
        return;
      }
      const data = await r.json();
      setMemory(data);
      setLoading(false);
    }).catch(() => { setError('Network error'); setLoading(false); });
  }, [token]);

  // Lightweight reading-time estimate from summary + key points (~220 wpm).
  const readingMinutes = useMemo(() => {
    if (!memory) return 0;
    const text = [memory.summary || '', ...(memory.key_points || [])].join(' ');
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 220));
  }, [memory]);

  // Only render a clickable source link if it's a safe http(s) URL —
  // otherwise we silently drop it to avoid javascript:/data: scheme XSS.
  const safeSourceUrl = useMemo(() => {
    if (!memory?.source_url) return '';
    try {
      const u = new URL(memory.source_url);
      return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : '';
    } catch { return ''; }
  }, [memory]);
  const sourceHost = useMemo(() => {
    if (!safeSourceUrl) return '';
    try { return new URL(safeSourceUrl).hostname.replace(/^www\./, ''); }
    catch { return ''; }
  }, [safeSourceUrl]);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* ignore */ }
  };

  return (
    <div className="share-page">
      {/* Ambient gradient glow behind the hero */}
      <div className="share-glow" aria-hidden="true" />

      {/* Top bar */}
      <header className="share-topbar">
        <Link to="/" className="share-brand" data-testid="link-share-brand">
          <img src={x247Logo} alt="" className="share-brand-logo" draggable={false} />
          <span className="share-brand-text">Recall <span>X247</span></span>
        </Link>
        <div className="share-topbar-actions">
          <button
            type="button"
            onClick={handleCopyLink}
            className="share-copy-btn"
            data-testid="button-copy-link"
            aria-label={copied ? 'Link copied to clipboard' : 'Copy share link'}
          >
            {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy link</>}
          </button>
          <span className="sr-only" role="status" aria-live="polite">
            {copied ? 'Link copied to clipboard' : ''}
          </span>
          <Link to="/login" className="share-cta-btn" data-testid="link-get-app">
            Get Recall X247 <ArrowUpRight size={13} />
          </Link>
        </div>
      </header>

      <main className="share-main">
        {loading ? (
          <div className="share-loading">
            <div className="share-spinner" />
            <p>Loading shared memory…</p>
          </div>
        ) : error ? (
          <div className="share-error" data-testid="share-error">
            <AlertTriangle size={36} color="#ef4444" />
            <h2>Memory not found</h2>
            <p>{error}</p>
            <Link to="/" className="share-back-btn">
              <ArrowLeft size={12} /> Back to home
            </Link>
          </div>
        ) : memory && (
          <>
            {/* HERO */}
            <section className="share-hero">
              <div className="share-pill" data-testid="badge-shared">
                <Sparkles size={11} />
                <span>SHARED MEMORY · PUBLIC VIEW</span>
              </div>
              <h1 className="share-title">{memory.title}</h1>

              <div className="share-meta">
                <span className="share-meta-item">
                  <CalendarIcon size={12} />
                  {new Date(memory.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </span>
                {memory.domain && (
                  <span className="share-meta-item">
                    <Globe size={12} /> {memory.domain}
                  </span>
                )}
                <span className="share-meta-item">
                  <Clock size={12} /> {readingMinutes} min read
                </span>
                <span className="share-meta-tag">{memory.source_type}</span>
              </div>

              {safeSourceUrl && (
                <a
                  href={safeSourceUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="share-source"
                  data-testid="link-source"
                >
                  <Link2 size={12} />
                  <span className="share-source-host">{sourceHost || 'View source'}</span>
                  <span className="share-source-path">{safeSourceUrl.length > 80 ? `${safeSourceUrl.slice(0, 80)}…` : safeSourceUrl}</span>
                  <ArrowUpRight size={11} />
                </a>
              )}
            </section>

            <div className="share-grid">
              {/* MAIN COLUMN */}
              <div className="share-main-col">
                {/* AI Summary */}
                <section className="share-card share-card-summary">
                  <div className="share-card-head">
                    <span className="share-card-icon"><Brain size={14} /></span>
                    <h2>AI Summary</h2>
                  </div>
                  <p className="share-summary-text">{memory.summary}</p>
                </section>

                {/* Key insights */}
                {memory.key_points?.length > 0 && (
                  <section className="share-card">
                    <div className="share-card-head">
                      <span className="share-card-icon"><Sparkles size={14} /></span>
                      <h2>Key Insights</h2>
                      <span className="share-card-count">{memory.key_points.length}</span>
                    </div>
                    <ol className="share-keys" data-testid="list-key-points">
                      {memory.key_points.map((pt, i) => (
                        <li key={i} className="share-key">
                          <span className="share-key-num">{String(i + 1).padStart(2, '0')}</span>
                          <span className="share-key-text">{pt}</span>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
              </div>

              {/* SIDEBAR */}
              <aside className="share-side">
                {/* Tags */}
                {memory.tags?.length > 0 && (
                  <section className="share-side-card">
                    <div className="share-side-head">
                      <Tag size={11} /> <span>TAGS</span>
                    </div>
                    <div className="share-tags" data-testid="list-tags">
                      {memory.tags.map(t => (
                        <span key={t} className="share-tag">#{t}</span>
                      ))}
                    </div>
                  </section>
                )}

                {/* Stats */}
                <section className="share-side-card">
                  <div className="share-side-head">
                    <Eye size={11} /> <span>AT A GLANCE</span>
                  </div>
                  <div className="share-stats">
                    <div className="share-stat">
                      <FileText size={12} />
                      <div>
                        <div className="share-stat-val">{memory.source_type}</div>
                        <div className="share-stat-lab">Source type</div>
                      </div>
                    </div>
                    <div className="share-stat">
                      <Clock size={12} />
                      <div>
                        <div className="share-stat-val">{readingMinutes} min</div>
                        <div className="share-stat-lab">Reading time</div>
                      </div>
                    </div>
                    {memory.shared_at && (
                      <div className="share-stat">
                        <CalendarIcon size={12} />
                        <div>
                          <div className="share-stat-val">{new Date(memory.shared_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                          <div className="share-stat-lab">Shared on</div>
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              </aside>
            </div>

            {/* CTA */}
            <section className="share-cta">
              <div className="share-cta-glow" aria-hidden="true" />
              <img src={x247Logo} alt="" className="share-cta-logo" draggable={false} />
              <h3>Build your own second brain</h3>
              <p>Capture, summarise, and recall everything that matters — with AI agents that remember for you.</p>
              <Link to="/login" className="share-cta-link" data-testid="link-cta-signup">
                Try Recall X247 free <ArrowUpRight size={14} />
              </Link>
              <div className="share-cta-perks">
                <span><Check size={11} /> Free to start</span>
                <span><Check size={11} /> No card required</span>
                <span><Check size={11} /> Guest mode available</span>
              </div>
            </section>

            <footer className="share-footer">
              Powered by <Link to="/" className="share-footer-link">Recall X247</Link>
            </footer>
          </>
        )}
      </main>
    </div>
  );
};

export default SharePage;
