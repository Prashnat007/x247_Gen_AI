import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Layers, ArrowLeft, FileText, AlertCircle, Loader2, ExternalLink, Tag } from 'lucide-react';

type SessionMemory = {
  id: string;
  title: string;
  summary: string;
  source_type: string;
  source_url: string;
  tags: string[];
};

type SessionDoc = {
  id: string;
  summary: string;
  folder_name: string;
  project_id: string;
  memory_ids: string[];
  created_at?: any;
  memories: SessionMemory[];
};

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<SessionDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError('');
    fetch(`/research-sessions/${id}`)
      .then(async r => {
        if (!r.ok) {
          const detail = await r.json().catch(() => null);
          throw new Error(detail?.detail || `Could not load session (${r.status})`);
        }
        return r.json();
      })
      .then((d: SessionDoc) => setData(d))
      .catch(e => setError(e?.message || 'Could not load session'))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Link to="/library?tab=inbox" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--text-2)', textDecoration: 'none' }}>
        <ArrowLeft size={12} /> Back to Library
      </Link>

      <header style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Layers size={22} color="var(--primary)" />
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text-1)' }}>
            {data?.folder_name || 'Research session'}
          </h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-3)' }}>
            Captured as one bundle — {data?.memory_ids?.length || 0} item{(data?.memory_ids?.length || 0) === 1 ? '' : 's'}
          </p>
        </div>
      </header>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-3)', fontSize: 13 }}>
          <Loader2 size={14} className="spin" /> Loading session…
        </div>
      )}

      {error && !loading && (
        <div className="view-card" style={{ padding: '14px 16px', borderColor: '#dc2626', display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertCircle size={16} color="#dc2626" />
          <div style={{ fontSize: 13, color: 'var(--text-1)' }}>{error}</div>
        </div>
      )}

      {data && !loading && (
        <>
          {data.summary && (
            <div className="view-card" style={{ padding: '14px 18px' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-3)', letterSpacing: '0.5px', marginBottom: 6 }}>
                BUNDLE OVERVIEW
              </div>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-1)' }}>
                {data.summary}
              </p>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-3)', letterSpacing: '0.5px' }}>
              ITEMS IN THIS SESSION
            </div>
            {data.project_id && (
              <Link to={`/workspace?project=${encodeURIComponent(data.project_id)}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 700, color: 'var(--primary)', textDecoration: 'none' }}>
                Open folder <ExternalLink size={11} />
              </Link>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.memories.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-3)', fontStyle: 'italic' }}>
                The memories from this session were deleted or moved.
              </div>
            ) : (
              data.memories.map(m => (
                <Link key={m.id} to={`/memory/${m.id}`}
                  className="view-card"
                  style={{ padding: '12px 14px', textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FileText size={14} color="var(--text-3)" />
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-1)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.title}
                    </div>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' }}>
                      {m.source_type || 'note'}
                    </span>
                  </div>
                  {m.summary && (
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {m.summary}
                    </p>
                  )}
                  {m.tags && m.tags.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                      <Tag size={10} color="var(--text-3)" />
                      {m.tags.slice(0, 6).map(t => (
                        <span key={t} style={{ fontSize: 10.5, color: 'var(--text-3)', background: 'var(--surface-2)', padding: '2px 6px', borderRadius: 999 }}>
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
