import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, Plus, Bot, ArrowRight, ArrowLeft, X,
  LayoutDashboard, Library, Cpu, Kanban, Target, Calendar as CalendarIcon,
  GraduationCap, Compass, BarChart2, Plug, Settings,
} from 'lucide-react';

// Single neon green accent
const NEON = '#c5f82a';

const STEPS = [
  {
    eyebrow: 'WELCOME TO RECALL X247',
    title: 'Your AI-powered Second Brain',
    description:
      'Seven specialist AI agents capture, link, and recall everything you learn — so every idea is one question away. Forever.',
    icon: Sparkles,
    accent: NEON,
    chips: [
      { icon: LayoutDashboard, label: 'Dashboard' },
      { icon: Library,         label: 'Library' },
      { icon: Bot,             label: 'Recall AI' },
      { icon: Cpu,             label: 'Agent Hub' },
    ],
  },
  {
    eyebrow: 'YOUR DAILY HOME',
    title: 'Four pinned hubs at the top',
    description:
      'Dashboard for your daily overview. Library now holds Vault, Notes, Bookmarks, Files and your Inbox as tabs in one place. Recall AI answers questions in plain English. Agent Hub runs multi-agent workflows.',
    icon: Library,
    accent: NEON,
    chips: [
      { icon: LayoutDashboard, label: 'Dashboard' },
      { icon: Library,         label: 'Library' },
      { icon: Bot,             label: 'Recall AI' },
      { icon: Cpu,             label: 'Agent Hub' },
    ],
  },
  {
    eyebrow: 'WORKSPACE',
    title: 'Plan your week in one place',
    description:
      'The Workspace group keeps Projects, Focus and Calendar one click apart. Tasks and Habits now live as sections inside Focus, so your daily rituals and to-dos share a single screen.',
    icon: Kanban,
    accent: NEON,
    chips: [
      { icon: Kanban,       label: 'Projects' },
      { icon: Target,       label: 'Focus' },
      { icon: CalendarIcon, label: 'Calendar' },
      { icon: Sparkles,     label: 'Tasks + Habits' },
    ],
  },
  {
    eyebrow: 'LEARN, DISCOVER, INSIGHTS',
    title: 'See your knowledge from every angle',
    description:
      'Learn brings Study Plan, Flashcards and Revisits together as tabs. Discover surfaces fresh ideas based on what you save. Insights merges Timeline, Mind Graph and Analytics into one hub. Integrations and Settings sit quietly in the footer when you need them.',
    icon: GraduationCap,
    accent: NEON,
    chips: [
      { icon: GraduationCap, label: 'Learn' },
      { icon: Compass,       label: 'Discover' },
      { icon: BarChart2,     label: 'Insights' },
      { icon: Plug,          label: 'Integrations' },
    ],
  },
  {
    eyebrow: 'PICK ONE TO START',
    title: 'Where do you want to begin?',
    description:
      'Capture something, ask a question, or just take a look around. You can re-open this tour any time from Settings.',
    icon: Sparkles,
    accent: NEON,
    chips: [
      { icon: Plus,     label: 'Capture' },
      { icon: Bot,      label: 'Recall AI' },
      { icon: Library,  label: 'Library' },
      { icon: Settings, label: 'Settings' },
    ],
  },
];

export default function OnboardingTour({
  open, onClose,
}: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
      if (e.key === 'ArrowRight' && step < STEPS.length - 1) setStep(s => s + 1);
      if (e.key === 'ArrowLeft' && step > 0) setStep(s => s - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, step]);

  const handleClose = () => {
    try { localStorage.setItem('recall-x247-onboarded', '1'); } catch {}
    onClose();
  };

  const handleFinish = () => {
    handleClose();
  };

  if (!open) return null;
  const s = STEPS[step];
  const Icon = s.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={handleClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(3, 8, 15, 0.78)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16,
          fontFamily: "'Poppins', system-ui, sans-serif",
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ type: 'spring', damping: 22, stiffness: 220 }}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'relative',
            width: '100%', maxWidth: 540,
            maxHeight: '92vh',
            overflowY: 'auto',
            overflowX: 'hidden',
            background: 'linear-gradient(180deg, rgba(13,13,13,0.98) 0%, rgba(10,10,11,0.99) 100%)',
            border: '1px solid rgba(197,248,42,0.2)',
            borderRadius: 20,
            padding: '28px 28px 22px',
            boxShadow: '0 30px 80px -20px rgba(0,0,0,0.8), 0 0 60px -10px rgba(197,248,42,0.12), inset 0 1px 0 rgba(255,255,255,0.03)',
            color: '#f4f6fb',
          }}
        >
          {/* Glowing accent corner */}
          <div aria-hidden style={{
            position: 'absolute', top: -80, right: -80, width: 240, height: 240,
            background: `radial-gradient(circle, ${s.accent}33 0%, transparent 70%)`,
            pointerEvents: 'none', transition: 'background 0.4s',
          }} />

          {/* Top: skip + step counter */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, position: 'relative', zIndex: 2 }}>
            <span style={{ fontSize: 10.5, letterSpacing: '0.18em', color: '#6b7388', fontWeight: 600 }}>
              {step + 1} / {STEPS.length}
            </span>
            <button onClick={handleClose}
              aria-label="Skip tour"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'transparent', border: 0, color: '#8a93a8',
                fontSize: 12, fontWeight: 500, cursor: 'pointer',
                fontFamily: 'inherit', padding: '4px 8px', borderRadius: 6,
                transition: 'color 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#f4f6fb'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#8a93a8'; }}
            >
              Skip tour <X size={12} />
            </button>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -14 }}
              transition={{ duration: 0.22 }}
              style={{ position: 'relative', zIndex: 2 }}
            >
              {/* Animated icon disc */}
              <motion.div
                initial={{ scale: 0.8, rotate: -8 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', damping: 14, stiffness: 200 }}
                style={{
                  width: 64, height: 64, borderRadius: 18,
                  background: `linear-gradient(135deg, ${s.accent}22, ${s.accent}11)`,
                  border: `1px solid ${s.accent}44`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 18,
                  boxShadow: `0 0 36px ${s.accent}33`,
                }}
              >
                <Icon size={28} color={s.accent} strokeWidth={2.2} />
              </motion.div>

              <div style={{
                fontSize: 10.5, letterSpacing: '0.22em', color: s.accent,
                fontWeight: 700, marginBottom: 8,
              }}>
                {s.eyebrow}
              </div>

              <h2 style={{
                margin: 0,
                fontFamily: "'Instrument Serif', 'Cormorant Garamond', serif",
                fontStyle: 'italic',
                fontSize: 32, fontWeight: 400, lineHeight: 1.12,
                letterSpacing: '-0.01em',
                background: 'linear-gradient(170deg, #ffffff 0%, #c8cdd9 100%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>
                {s.title}
              </h2>

              <p style={{
                margin: '12px 0 18px', fontSize: 13.5, lineHeight: 1.6,
                color: '#a3acc2', maxWidth: '95%',
              }}>
                {s.description}
              </p>

              {/* Feature chips (or actionable cards on the last step) */}
              {!isLast ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 22 }}>
                  {s.chips.map((c, i) => {
                    const ChipIcon = c.icon;
                    return (
                      <motion.div
                        key={c.label}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.05 + i * 0.06 }}
                        style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'center',
                          gap: 6, padding: '10px 6px',
                          background: 'rgba(255,255,255,0.03)',
                          border: '1px solid rgba(255,255,255,0.06)',
                          borderRadius: 10,
                        }}
                      >
                        <ChipIcon size={16} color={s.accent} strokeWidth={2.1} />
                        <span style={{ fontSize: 10.5, color: '#c2c9dd', fontWeight: 500, letterSpacing: '0.02em' }}>
                          {c.label}
                        </span>
                      </motion.div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
                  {[
                    { icon: Plus,     label: 'Capture your first item',  desc: 'Paste a link, video or note — lands in Library Inbox', color: NEON, path: '/library?tab=inbox' },
                    { icon: Bot,      label: 'Try Recall AI',            desc: 'Ask a question in plain English',                      color: NEON, path: '/recall' },
                    { icon: Library,  label: 'Browse your Library',      desc: 'Vault, Notes, Bookmarks, Files — all in one place',    color: NEON, path: '/library' },
                  ].map((q, i) => {
                    const QIcon = q.icon;
                    return (
                      <motion.button
                        key={q.label}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.05 + i * 0.06 }}
                        onClick={() => { try { localStorage.setItem('recall-x247-onboarded', '1'); } catch {} onClose(); navigate(q.path); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '11px 14px',
                          background: 'rgba(255,255,255,0.03)',
                          border: `1px solid ${q.color}33`,
                          borderRadius: 11,
                          cursor: 'pointer', fontFamily: 'inherit',
                          textAlign: 'left', width: '100%',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = `${q.color}10`; (e.currentTarget as HTMLButtonElement).style.borderColor = `${q.color}66`; (e.currentTarget as HTMLButtonElement).style.transform = 'translateX(2px)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.03)'; (e.currentTarget as HTMLButtonElement).style.borderColor = `${q.color}33`; (e.currentTarget as HTMLButtonElement).style.transform = ''; }}
                      >
                        <div style={{ width: 34, height: 34, borderRadius: 9, background: `${q.color}1a`, border: `1px solid ${q.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <QIcon size={15} color={q.color} strokeWidth={2.2} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#f4f6fb', lineHeight: 1.2 }}>{q.label}</div>
                          <div style={{ fontSize: 11, color: '#8a93a8', marginTop: 2 }}>{q.desc}</div>
                        </div>
                        <ArrowRight size={14} color={q.color} style={{ flexShrink: 0 }} />
                      </motion.button>
                    );
                  })}
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Footer: progress + actions */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)',
            position: 'relative', zIndex: 2,
          }}>
            {/* Progress dots */}
            <div style={{ display: 'flex', gap: 6 }}>
              {STEPS.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setStep(i)}
                  aria-label={`Go to step ${i + 1}`}
                  style={{
                    width: i === step ? 22 : 7, height: 7,
                    borderRadius: 999,
                    background: i === step ? s.accent : 'rgba(255,255,255,0.14)',
                    border: 0, padding: 0, cursor: 'pointer',
                    transition: 'all 0.25s',
                  }}
                />
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {step > 0 && (
                <button
                  onClick={() => setStep(s => s - 1)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '8px 14px',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 10,
                    color: '#c2c9dd', fontSize: 12.5, fontWeight: 500,
                    cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.07)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; }}
                >
                  <ArrowLeft size={13} /> Back
                </button>
              )}
              <button
                onClick={() => isLast ? handleFinish() : setStep(s => s + 1)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '10px 20px',
                  background: NEON,
                  border: `1px solid ${NEON}`,
                  borderRadius: 10,
                  color: '#0a0a0a', fontSize: 12.5, fontWeight: 700, letterSpacing: '0.02em',
                  cursor: 'pointer', fontFamily: 'inherit',
                  boxShadow: `0 4px 16px rgba(197,248,42,0.35)`,
                  transition: 'all 0.18s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 6px 22px rgba(197,248,42,0.5)`; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = ''; (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 4px 16px rgba(197,248,42,0.35)`; }}
              >
                {isLast ? <>I'll explore on my own <Sparkles size={13} /></> : <>Next <ArrowRight size={13} /></>}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
