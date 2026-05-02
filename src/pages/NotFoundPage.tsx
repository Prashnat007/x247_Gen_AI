import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertTriangle, Home, RotateCw, ArrowLeft } from 'lucide-react';

const card: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  boxShadow: '0 6px 28px rgba(0,0,0,0.10)',
};

const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const attempted = location.pathname + location.search;

  return (
    <div style={{ minHeight: 'calc(100vh - 5rem)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px', maxWidth: 980, margin: '0 auto', width: '100%' }}>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        style={{ ...card, width: '100%', maxWidth: 560, padding: '36px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, textAlign: 'center' }}>

        <motion.div initial={{ scale: 0.85 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200 }}
          style={{ width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg, rgba(245,158,11,0.22), rgba(239,68,68,0.14)) ', border: '1px solid rgba(245,158,11,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 28px rgba(245,158,11,0.22)' }}>
          <AlertTriangle size={28} color="#f59e0b" />
        </motion.div>

        <div>
          <div style={{ color: 'var(--text-3)', fontSize: 12, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase' }}>
            Error 404
          </div>
          <div style={{ color: 'var(--text-1)', fontSize: 24, fontWeight: 800, lineHeight: 1.2, letterSpacing: '-0.4px', marginTop: 6 }}>
            We couldn't find that page
          </div>
          <div style={{ color: 'var(--text-3)', fontSize: 13.5, marginTop: 8, maxWidth: 420, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.5 }}>
            The link may be broken, the page may have moved, or it didn't load correctly. Try refreshing — if that doesn't help, head back to your dashboard.
          </div>
        </div>

        {attempted && attempted !== '/' && (
          <div style={{ width: '100%', maxWidth: 420, padding: '8px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-3)', fontSize: 11.5, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {attempted}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginTop: 6 }}>
          <button onClick={() => window.location.reload()}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', background: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', boxShadow: '0 2px 12px rgba(99,102,241,0.35)' }}>
            <RotateCw size={14} /> Refresh page
          </button>
          <button onClick={() => navigate('/dashboard')}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}>
            <Home size={14} /> Go to dashboard
          </button>
          <button onClick={() => navigate(-1)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', background: 'transparent', color: 'var(--text-2)', border: '1px solid var(--border)', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}>
            <ArrowLeft size={14} /> Go back
          </button>
        </div>

        <div style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 4 }}>
          Still seeing this? Try a hard refresh — Ctrl/Cmd + Shift + R.
        </div>
      </motion.div>
    </div>
  );
};

export default NotFoundPage;
