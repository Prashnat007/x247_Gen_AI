import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Presentation, ExternalLink, Download, Loader2, Maximize2, Sparkles, Trophy, Brain, Zap } from 'lucide-react';

const DECK_URL = 'https://storage.googleapis.com/vision-hack2skill-production/innovator/USER01192712/1775672728991-PrototypeSubmissionDeckGenAIAcademyAPACEdition.pdf';
const VIEWER_URL = `https://docs.google.com/viewer?url=${encodeURIComponent(DECK_URL)}&embedded=true`;

const DeckPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [useFallback, setUseFallback] = useState(false);

  const openFullscreen = () => {
    const iframe = document.getElementById('deck-iframe') as HTMLIFrameElement | null;
    if (iframe?.requestFullscreen) iframe.requestFullscreen();
  };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 0' }}>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
        className="view-card" style={{ padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ width: 46, height: 46, borderRadius: 12, background: 'linear-gradient(135deg,#3b82f6,#22d3ee)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 8px 22px rgba(59,130,246,0.35)' }}>
          <Presentation size={22} color="#fff" />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ padding: '2px 8px', background: 'var(--primary-bg)', border: '1px solid var(--primary-border)', borderRadius: 999, color: 'var(--primary)', fontSize: 10, fontWeight: 800, letterSpacing: '0.5px' }}>
              GEN AI APAC 2026
            </span>
            <span style={{ padding: '2px 8px', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.35)', borderRadius: 999, color: '#f59e0b', fontSize: 10, fontWeight: 800, letterSpacing: '0.5px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Trophy size={10} /> SUBMISSION
            </span>
          </div>
          <h2 style={{ fontSize: 'clamp(18px,2.6vw,22px)', fontWeight: 800, color: 'var(--text-1)', margin: '0 0 2px', fontFamily: "'Alegreya Sans SC',system-ui" }}>
            Recall X247 — Prototype Pitch Deck
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>
            Hackathon submission deck · Hosted on Google Cloud Storage
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={openFullscreen}
            style={{ padding: '8px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-1)', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
            <Maximize2 size={13} /> Fullscreen
          </button>
          <a href={DECK_URL} target="_blank" rel="noopener noreferrer"
            style={{ padding: '8px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-1)', fontSize: 12, fontWeight: 700, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
            <ExternalLink size={13} /> Open in tab
          </a>
          <a href={DECK_URL} download
            className="btn-premium" style={{ padding: '8px 14px', fontSize: 12, gap: 6 }}>
            <Download size={13} /> Download
          </a>
        </div>
      </motion.div>

      {/* Embedded viewer */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="view-card" style={{ overflow: 'hidden', position: 'relative' }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, background: 'var(--surface)', zIndex: 2 }}>
            <Loader2 size={28} color="var(--primary)" style={{ animation: 'spin 1s linear infinite' }} />
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>Loading deck…</p>
          </div>
        )}
        <iframe id="deck-iframe"
          src={useFallback ? DECK_URL : VIEWER_URL}
          title="Recall X247 Pitch Deck"
          onLoad={() => setLoading(false)}
          onError={() => { setUseFallback(true); setLoading(false); }}
          style={{ width: '100%', height: 640, border: 'none', display: 'block', background: '#1a1a1a' }}
          allow="autoplay; fullscreen"
        />
        {!loading && (
          <div style={{ position: 'absolute', bottom: 8, right: 12, padding: '4px 10px', background: 'rgba(0,0,0,0.55)', borderRadius: 999, color: '#fff', fontSize: 10, fontWeight: 600, letterSpacing: '0.5px', backdropFilter: 'blur(6px)' }}>
            {useFallback ? 'Native PDF viewer' : 'Google Docs viewer'}
          </div>
        )}
      </motion.div>

      {/* Project highlight strip */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {[
          { icon: Brain,     label: '7 AI Agents',         val: 'Capture → Recall',    color: '#3b82f6' },
          { icon: Zap,       label: '8 Input Sources',     val: 'Web · YT · PDF · …',  color: '#22d3ee' },
          { icon: Sparkles,  label: 'AI engine',           val: 'Multi-model',         color: '#a78bfa' },
          { icon: Trophy,    label: 'APAC 2026 Submission', val: 'Live demo ready',    color: '#fbbf24' },
        ].map((s, i) => (
          <div key={i} style={{ padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: `color-mix(in srgb,${s.color} 14%,transparent)`, border: `1px solid color-mix(in srgb,${s.color} 30%,transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <s.icon size={16} color={s.color} />
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', margin: 0, letterSpacing: '0.5px', textTransform: 'uppercase' }}>{s.label}</p>
              <p style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.val}</p>
            </div>
          </div>
        ))}
      </motion.div>
    </div>
  );
};

export default DeckPage;
