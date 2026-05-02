import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Loader2, Settings, Zap, CheckCircle2, AlertCircle, Shield, RefreshCw, Presentation, ArrowRight, Bell, BellOff, Send, Key, ChevronDown, ChevronUp, RotateCcw, PlayCircle, FolderOpen, Flame, Network } from 'lucide-react';
import { motion } from 'motion/react';
import { showToast } from '../App';
import { getAutoLinkPrefs, setAutoLinkPrefs, type AutoLinkPrefs } from '../lib/api';
import { DISMISSED_PREFIX as REDIRECT_BANNER_DISMISSED_PREFIX } from '../components/LegacyRedirectBanner';

const SettingsView = () => {
  const navigate = useNavigate();
  const [cfg, setCfg] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: 'success' | 'error'; message: string } | null>(null);

  const loadConfig = () => {
    setIsLoading(true);
    setLoadError(false);
    // Use /config (pure API endpoint) to avoid the SPA route conflict with /settings
    fetch('/config')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        setCfg(data);
        setIsLoading(false);
      })
      .catch(() => {
        setLoadError(true);
        setIsLoading(false);
      });
  };

  useEffect(() => { loadConfig(); }, []);

  // ── Daily briefing notification preferences ────────────────────────────
  const [briefPrefs, setBriefPrefs] = useState<{ notifications_enabled: boolean; send_hour: number; tz_offset_minutes: number } | null>(null);
  const [briefSaving, setBriefSaving] = useState(false);
  const [briefStatus, setBriefStatus] = useState<{ kind: 'ok' | 'err' | 'sent'; msg: string } | null>(null);
  const [browserPerm, setBrowserPerm] = useState<NotificationPermission | 'unsupported'>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  );

  useEffect(() => {
    fetch('/briefing/settings')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) setBriefPrefs({
          notifications_enabled: !!data.notifications_enabled,
          send_hour: typeof data.send_hour === 'number' ? data.send_hour : 8,
          tz_offset_minutes: typeof data.tz_offset_minutes === 'number' ? data.tz_offset_minutes : -new Date().getTimezoneOffset(),
        });
      })
      .catch(() => {});
  }, []);

  // ── P4B — Auto-link opt-out toggles ────────────────────────────────
  // Three booleans (default true) controlling the W4 AI auto-link layer:
  //   • Auto-folder: silent file-into-existing-folder on capture save
  //   • Habit suggestions: briefing scanner that proposes habit links
  //   • Cluster suggestions: weekly topic-cluster bundle proposals
  const [autoLinkPrefs, setAutoLinkPrefsState] = useState<AutoLinkPrefs>({
    auto_folder_enabled: true,
    habit_suggestions_enabled: true,
    cluster_suggestions_enabled: true,
  });
  const [autoLinkSaving, setAutoLinkSaving] = useState<keyof AutoLinkPrefs | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const prefs = await getAutoLinkPrefs();
        setAutoLinkPrefsState(prefs);
      } catch { /* defaults stand */ }
    })();
  }, []);

  const toggleAutoLink = async (key: keyof AutoLinkPrefs) => {
    if (autoLinkSaving) return;
    const next = { ...autoLinkPrefs, [key]: !autoLinkPrefs[key] };
    setAutoLinkPrefsState(next); // optimistic
    setAutoLinkSaving(key);
    try {
      const saved = await setAutoLinkPrefs(next);
      setAutoLinkPrefsState(saved);
    } catch (err: any) {
      // Revert on failure so the switch matches reality.
      setAutoLinkPrefsState(autoLinkPrefs);
      showToast(`Couldn't save: ${err?.message || err}`, 'error');
    } finally {
      setAutoLinkSaving(null);
    }
  };

  const saveBriefPrefs = async (next: { notifications_enabled?: boolean; send_hour?: number }) => {
    if (!briefPrefs) return;
    const merged = { ...briefPrefs, ...next };
    setBriefPrefs(merged);
    setBriefSaving(true);
    setBriefStatus(null);

    // If the user is turning notifications ON and the browser hasn't granted
    // permission yet, ask now. We still save the preference either way so the
    // in-app banner works even when system notifications are blocked.
    if (next.notifications_enabled && browserPerm === 'default' && 'Notification' in window) {
      try {
        const result = await Notification.requestPermission();
        setBrowserPerm(result);
      } catch {}
    }

    try {
      const res = await fetch('/briefing/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notifications_enabled: merged.notifications_enabled,
          send_hour: merged.send_hour,
          tz_offset_minutes: -new Date().getTimezoneOffset(),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setBriefPrefs({
        notifications_enabled: !!data.notifications_enabled,
        send_hour: data.send_hour ?? merged.send_hour,
        tz_offset_minutes: data.tz_offset_minutes ?? merged.tz_offset_minutes,
      });
      setBriefStatus({ kind: 'ok', msg: 'Saved.' });
    } catch (e) {
      setBriefStatus({ kind: 'err', msg: 'Could not save preferences. Try again.' });
    } finally {
      setBriefSaving(false);
    }
  };

  const sendNow = async () => {
    setBriefSaving(true);
    setBriefStatus(null);
    try {
      const res = await fetch('/briefing/notify-now', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setBriefStatus({ kind: 'sent', msg: "Today's briefing is on its way — watch for the banner." });
      // Nudge the in-app notifier so the banner shows up immediately
      // instead of waiting for the next 60-second poll.
      try { window.dispatchEvent(new CustomEvent('recall-briefing-poll')); } catch {}
    } catch {
      setBriefStatus({ kind: 'err', msg: 'Could not send briefing right now.' });
    } finally {
      setBriefSaving(false);
    }
  };

  const handleReplayTour = () => {
    try {
      localStorage.removeItem('recall-x247-onboarded');
    } catch {}
    try {
      window.dispatchEvent(new CustomEvent('recall-replay-tour'));
    } catch {}
    showToast('Replaying the tour from the start');
  };

  const handleResetRedirectBanners = () => {
    let cleared = 0;
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(REDIRECT_BANNER_DISMISSED_PREFIX)) {
          keysToRemove.push(key);
        }
      }
      for (const key of keysToRemove) {
        localStorage.removeItem(key);
      }
      cleared = keysToRemove.length;
    } catch {
      showToast('Could not reset onboarding hints', 'error');
      return;
    }
    showToast(
      cleared > 0
        ? `Onboarding hints reset — ${cleared} banner${cleared === 1 ? '' : 's'} will reappear on their pages`
        : 'Onboarding hints already cleared — banners will appear next time you visit a moved page'
    );
  };

  const handleTestAI = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/test-ai');
      const data = await res.json();
      if (res.ok) setTestResult({ status: 'success', message: `${data.message} (Model: ${data.model})` });
      else setTestResult({ status: 'error', message: data.detail || 'Test failed' });
    } catch {
      setTestResult({ status: 'error', message: 'Network error — backend may be restarting' });
    } finally {
      setIsTesting(false);
    }
  };

  const [apiKeysOpen, setApiKeysOpen] = useState(true);

  const hasAiKey = cfg?.openai_api_key_set || cfg?.gen_apac_api_key_set || cfg?.gemini_api_key_set;

  const badge = (val: boolean) => (
    <span style={{
      fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 6, letterSpacing: '0.3px',
      background: val ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.1)',
      color: val ? '#10b981' : '#ef4444',
    }}>
      {val ? '✓ CONFIGURED' : '✗ MISSING'}
    </span>
  );

  const row = (label: string, val: boolean, extra?: string) => (
    <div className="settings-config-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ minWidth: 0, flex: '1 1 auto' }}>
        <span style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 500 }}>{label}</span>
        {extra && <span className="settings-config-extra" style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 6, wordBreak: 'break-all' }}>{extra}</span>}
      </div>
      {badge(val)}
    </div>
  );

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 24 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 14px', background: 'var(--primary-bg)', border: '1px solid var(--primary-border)', borderRadius: 999, marginBottom: 12 }}>
          <Settings size={11} color="var(--primary)" />
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', letterSpacing: '0.5px' }}>SYSTEM SETTINGS</span>
        </div>
        <h2 style={{ fontSize: 26, fontWeight: 900, color: 'var(--text-1)', margin: '0 0 6px', letterSpacing: '-0.5px', fontFamily: "'Alegreya Sans SC',system-ui" }}>Settings & Status</h2>
        <p style={{ color: 'var(--text-3)', fontSize: 14, margin: 0 }}>Configure AI models and monitor system health.</p>
      </motion.div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 20 }}>
        {/* AI Configuration Card */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="view-card" style={{ padding: 'var(--space-md)' }}>
          <h3 style={{ fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, fontSize: 15 }}>
            <Sparkles size={16} color="var(--primary)" />AI Configuration
          </h3>

          {isLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '28px 0', color: 'var(--text-3)' }}>
              <Loader2 size={22} style={{ animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: 12 }}>Loading configuration…</span>
            </div>
          ) : loadError ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '24px 0', textAlign: 'center' }}>
              <AlertCircle size={22} color="#ef4444" />
              <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0 }}>Could not load configuration.<br />The backend may be starting up.</p>
              <button onClick={loadConfig} className="btn-secondary" style={{ fontSize: 12, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {/* Active provider banner */}
              <div style={{ padding: '12px 14px', background: 'var(--primary-bg)', borderRadius: 12, border: '1px solid var(--primary-border)', marginBottom: 14 }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 3 }}>Active AI Engine</p>
                <p style={{ fontSize: 15, fontWeight: 800, color: 'var(--primary)', margin: '0 0 2px' }}>{cfg?.ai_provider_name || 'Neural AI'}</p>
                {cfg?.fallback_provider && (
                  <p style={{ fontSize: 11, color: 'var(--primary)', opacity: 0.7, margin: 0 }}>
                    Fallback: {cfg.fallback_provider} · Auto-activates on quota
                  </p>
                )}
              </div>

              {row('Google Gemini Key', cfg?.gemini_api_key_set, cfg?.gemini_model)}
              {row('OpenAI / Fallback Key', cfg?.openai_api_key_set)}
              {row('OpenRouter / GEN APAC Key', cfg?.gen_apac_api_key_set)}
              <div className="settings-config-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 500 }}>Google Calendar</span>
                {badge(cfg?.google_calendar_configured)}
              </div>
              <div className="settings-config-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingTop: 10 }}>
                <span style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 500, flexShrink: 0 }}>GCP Project</span>
                <span className="settings-config-value" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-1)', fontFamily: 'monospace', wordBreak: 'break-all', textAlign: 'right', minWidth: 0 }}>{cfg?.gcp_project_id || 'N/A'}</span>
              </div>
            </div>
          )}

          <div style={{ paddingTop: 16, marginTop: 16, borderTop: '1px solid var(--border)' }}>
            <button onClick={handleTestAI} disabled={isTesting || (!hasAiKey && !isLoading)}
              className={hasAiKey || isLoading ? 'btn-premium' : 'btn-secondary'}
              style={{ width: '100%' }}>
              {isTesting ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Zap size={15} />}
              Test Neural AI Connection
            </button>
            {testResult && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                style={{
                  marginTop: 12, padding: '12px 14px', borderRadius: 10, fontSize: 12,
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                  background: testResult.status === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                  border: `1px solid ${testResult.status === 'success' ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
                  color: testResult.status === 'success' ? '#10b981' : '#ef4444',
                }}>
                {testResult.status === 'success'
                  ? <CheckCircle2 size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  : <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />}
                <p style={{ margin: 0, lineHeight: 1.5 }}>{testResult.message}</p>
              </motion.div>
            )}
          </div>
        </motion.div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* System Status */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="view-card" style={{ padding: 'var(--space-md)' }}>
            <h3 style={{ fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 15 }}>
              <Shield size={16} color="var(--primary)" />System Status
            </h3>
            <div>
              {[
                { label: 'Backend Server', value: 'HEALTHY', color: '#10b981', pulse: true },
                { label: 'Firestore Database', value: 'CONNECTED', color: '#10b981', pulse: false },
                { label: 'AI Engine', value: cfg?.ai_provider_name || 'Neural AI · Active', color: 'var(--primary)', pulse: false },
                { label: 'Fallback AI', value: cfg?.fallback_provider ? `${cfg.fallback_provider} · Ready` : 'Not configured', color: cfg?.fallback_provider ? '#10b981' : 'var(--text-3)', pulse: false },
                { label: 'App Version', value: 'v2.0.0 HACKATHON', color: 'var(--text-3)', pulse: false },
              ].map((item, idx, arr) => (
                <div key={item.label} className="settings-config-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 0', borderBottom: idx < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 500, flexShrink: 0 }}>{item.label}</span>
                  <span className="settings-config-value" style={{ fontSize: 11, fontWeight: 700, color: item.color, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, wordBreak: 'break-word', textAlign: 'right', justifyContent: 'flex-end' }}>
                    {item.pulse && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', animation: 'pulse 2s ease-in-out infinite', display: 'inline-block', flexShrink: 0 }} />}
                    <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{item.value}</span>
                  </span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Hackathon Features */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
            style={{ background: 'linear-gradient(135deg,#6366f1 0%,#4f46e5 40%,#7c3aed 100%)', padding: 'var(--space-md)', borderRadius: 'var(--radius)', color: '#fff' }}>
            <h3 style={{ fontWeight: 800, fontSize: 15, marginBottom: 14 }}>
              Hackathon Features
            </h3>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                'Multi-agent Neural AI orchestration',
                'YouTube transcript extraction',
                'Web scraping & summarization',
                'PDF knowledge capture',
                'AI flashcard generation (spaced repetition)',
                'Personalized study plan AI',
                'Daily AI briefing',
                'Semantic recall search',
                'Google Firestore persistence',
                'Google Calendar integration',
                'Auto-fallback on API quota',
              ].map(f => (
                <li key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>
                  <CheckCircle2 size={13} color="rgba(255,255,255,0.6)" style={{ flexShrink: 0 }} />
                  {f}
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
      </div>

      {/* ── API Keys reference panel ─────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.17 }}
        className="view-card" style={{ marginTop: 20 }}>

        {/* header / toggle */}
        <button
          onClick={() => setApiKeysOpen(v => !v)}
          style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 'var(--space-md)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: 'inherit' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Key size={16} color="var(--primary)" />
            <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-1)' }}>API Keys &amp; Configuration</span>
          </span>
          {apiKeysOpen ? <ChevronUp size={15} color="var(--text-3)" /> : <ChevronDown size={15} color="var(--text-3)" />}
        </button>

        {apiKeysOpen && (
          <div style={{ padding: '0 var(--space-md) var(--space-md)' }}>
            {isLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 0', color: 'var(--text-3)', fontSize: 13 }}>
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading…
              </div>
            ) : (
              <>
                {/* intro */}
                <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 16px', lineHeight: 1.6 }}>
                  All secrets are set as environment variables on the server — never exposed to the browser.
                  Each row shows the env var name, what feature it unlocks, and what the app falls back to when it is missing.
                </p>

                {/* table */}
                {[
                  {
                    group: 'AI — Primary',
                    rows: [
                      {
                        name: 'GOOGLE_API_KEY / GEMINI_API_KEY',
                        set: cfg?.gemini_api_key_set,
                        model: cfg?.gemini_model,
                        powers: 'All AI agents — Recall, Capture, Library, Learn, Insights, Daily Briefing',
                        fallback: cfg?.fallback_key_set ? `Auto-falls back to OPENAI_API_KEY (${cfg?.fallback_ai_model})` : 'No fallback configured — set OPENAI_API_KEY for resilience',
                        fallbackOk: cfg?.fallback_key_set,
                      },
                    ],
                  },
                  {
                    group: 'AI — Fallback',
                    rows: [
                      {
                        name: 'OPENAI_API_KEY',
                        set: cfg?.fallback_key_set,
                        model: cfg?.fallback_ai_model || undefined,
                        powers: 'Automatic fallback when Gemini hits its rate limit (429 / quota exceeded)',
                        fallback: 'No further fallback — requests fail gracefully if both providers are unavailable',
                        fallbackOk: false,
                      },
                    ],
                  },
                  {
                    group: 'AI — Live Voice',
                    rows: [
                      {
                        name: 'GEMINI_LIVE_API_KEY',
                        set: cfg?.gemini_live_key_set,
                        model: cfg?.gemini_live_model,
                        powers: 'Real-time voice chat (Live mode) — bidirectional audio with Gemini',
                        fallback: cfg?.gemini_api_key_set ? 'Falls back to GOOGLE_API_KEY if unset' : 'No fallback — voice mode disabled when missing',
                        fallbackOk: cfg?.gemini_api_key_set,
                      },
                    ],
                  },
                  {
                    group: 'Third-party',
                    rows: [
                      {
                        name: 'YOUTUBE_API_KEY / YT_API_KEY',
                        set: cfg?.youtube_api_key_set,
                        model: undefined,
                        powers: 'YouTube video capture — fetches video metadata and extracts transcripts',
                        fallback: cfg?.youtube_fallback ? 'Falls back to GOOGLE_API_KEY (limited quota)' : cfg?.gemini_api_key_set ? 'Falls back to GOOGLE_API_KEY (limited quota)' : 'No fallback — YouTube capture disabled',
                        fallbackOk: !!(cfg?.youtube_fallback || cfg?.gemini_api_key_set),
                      },
                      {
                        name: 'GOOGLE_CALENDAR_ID',
                        set: cfg?.google_calendar_configured,
                        model: undefined,
                        powers: 'Calendar agent — reads and writes Google Calendar events',
                        fallback: 'No fallback — calendar features are skipped when unset',
                        fallbackOk: false,
                      },
                    ],
                  },
                  {
                    group: 'Infrastructure',
                    rows: [
                      {
                        name: 'GCP_PROJECT_ID / FIREBASE_PROJECT_ID',
                        set: !!(cfg?.gcp_project_id && cfg.gcp_project_id !== 'demo-project'),
                        model: cfg?.gcp_project_id,
                        powers: 'Firestore database — all memories, notes, tasks, habits, flashcards',
                        fallback: 'Defaults to "demo-project" (in-process mock DB — no persistence)',
                        fallbackOk: false,
                      },
                      {
                        name: 'FIREBASE_DATABASE_ID',
                        set: !!(cfg?.firestore_database_id),
                        model: cfg?.firestore_database_id || '(default)',
                        powers: 'Selects which Firestore database instance to use',
                        fallback: 'Defaults to "(default)" — the standard Firestore instance',
                        fallbackOk: true,
                      },
                    ],
                  },
                ].map(group => (
                  <div key={group.group} style={{ marginBottom: 20 }}>
                    <div style={{
                      fontSize: 10, fontWeight: 800, letterSpacing: '0.6px', textTransform: 'uppercase',
                      color: 'var(--text-3)', padding: '0 0 6px', borderBottom: '1px solid var(--border)', marginBottom: 8,
                    }}>
                      {group.group}
                    </div>
                    {group.rows.map(r => (
                      <div key={r.name} style={{
                        padding: '12px 0', borderBottom: '1px solid var(--border)',
                        display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 12px',
                        alignItems: 'start',
                      }}>
                        {/* left: name + powers + fallback */}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                            <code style={{
                              fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 5,
                              background: 'var(--surface-2)', color: 'var(--text-1)', letterSpacing: '0.3px',
                              wordBreak: 'break-all',
                            }}>
                              {r.name}
                            </code>
                            {r.model && (
                              <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'monospace' }}>
                                {r.model}
                              </span>
                            )}
                          </div>
                          <p style={{ fontSize: 12, color: 'var(--text-2)', margin: '0 0 4px', lineHeight: 1.5 }}>
                            {r.powers}
                          </p>
                          <p style={{
                            fontSize: 11, margin: 0, lineHeight: 1.4,
                            color: r.fallbackOk ? '#10b981' : 'var(--text-3)',
                          }}>
                            Fallback: {r.fallback}
                          </p>
                        </div>
                        {/* right: status badge */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', paddingTop: 2 }}>
                          <span style={{
                            fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 6,
                            whiteSpace: 'nowrap',
                            background: r.set ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.1)',
                            color: r.set ? '#10b981' : '#ef4444',
                          }}>
                            {r.set ? '✓ SET' : '✗ MISSING'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}

                {/* active provider summary */}
                <div style={{
                  marginTop: 8, padding: '12px 14px', borderRadius: 10,
                  background: 'var(--primary-bg)', border: '1px solid var(--primary-border)',
                  fontSize: 12, color: 'var(--primary)', lineHeight: 1.6,
                }}>
                  <span style={{ fontWeight: 700 }}>Active route:</span>{' '}
                  {cfg?.ai_provider_name || 'Unknown'}{cfg?.fallback_key_set ? ` → fallback: ${cfg.fallback_ai_model}` : ''}
                </div>
              </>
            )}
          </div>
        )}
      </motion.div>

      {/* Daily Briefing notifications */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
        className="view-card" style={{ marginTop: 20, padding: 'var(--space-md)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {briefPrefs?.notifications_enabled ? <Bell size={16} color="#8b5cf6" /> : <BellOff size={16} color="#8b5cf6" />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', margin: '0 0 3px' }}>Daily Briefing notifications</h3>
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>
              Get a heads-up each morning with today's executive summary — no need to open the page.
            </p>
          </div>
          {/* Toggle */}
          <button
            disabled={briefSaving || !briefPrefs}
            onClick={() => saveBriefPrefs({ notifications_enabled: !briefPrefs!.notifications_enabled })}
            aria-pressed={!!briefPrefs?.notifications_enabled}
            aria-label="Toggle daily briefing notifications"
            style={{
              width: 44, height: 24, borderRadius: 999,
              background: briefPrefs?.notifications_enabled ? '#8b5cf6' : 'var(--surface-3)',
              border: '1px solid var(--border)', cursor: briefSaving || !briefPrefs ? 'wait' : 'pointer',
              padding: 0, position: 'relative', transition: 'background 0.18s', flexShrink: 0,
            }}>
            <span style={{
              position: 'absolute', top: 2, left: briefPrefs?.notifications_enabled ? 22 : 2,
              width: 18, height: 18, borderRadius: '50%', background: '#fff',
              transition: 'left 0.18s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
          </button>
        </div>

        {briefPrefs?.notifications_enabled && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <label htmlFor="briefing-hour" style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 600 }}>Deliver at</label>
              <select
                id="briefing-hour"
                value={briefPrefs.send_hour}
                disabled={briefSaving}
                onChange={(e) => saveBriefPrefs({ send_hour: parseInt(e.target.value, 10) })}
                style={{ padding: '6px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{h.toString().padStart(2, '0')}:00</option>
                ))}
              </select>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                your local time ({Intl.DateTimeFormat().resolvedOptions().timeZone || 'browser timezone'})
              </span>
            </div>
            <button onClick={sendNow} disabled={briefSaving} className="btn-secondary"
              style={{ alignSelf: 'flex-start', fontSize: 12, padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Send size={12} /> Send me a test notification now
            </button>
            {browserPerm === 'denied' && (
              <p style={{ fontSize: 11, color: '#f59e0b', margin: 0 }}>
                Browser notifications are blocked. You'll still see the in-app banner — to also get a system notification, allow notifications for this site in your browser settings.
              </p>
            )}
            {browserPerm === 'default' && (
              <p style={{ fontSize: 11, color: 'var(--text-3)', margin: 0 }}>
                We'll ask permission to show a system notification the next time you save these settings.
              </p>
            )}
          </div>
        )}

        {briefStatus && (
          <p style={{
            margin: '10px 0 0', fontSize: 11, fontWeight: 600,
            color: briefStatus.kind === 'err' ? '#ef4444' : (briefStatus.kind === 'sent' ? '#06b6d4' : '#10b981'),
          }}>
            {briefStatus.msg}
          </p>
        )}
      </motion.div>

      {/* P4B — AI auto-link toggles. All on by default; per-user
          opt-out for each layer of the W4 auto-link feature. Each
          toggle triggers a save and the backend gate kicks in
          immediately on the next scanner / save-bundle pass. */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="view-card" style={{ marginTop: 20, padding: 'var(--space-md)' }}
        data-testid="settings-auto-link-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Sparkles size={16} color="#a78bfa" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', margin: '0 0 3px' }}>AI auto-link</h3>
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>
              Pick which AI suggestions Recall makes for you. Each layer can be turned off independently.
            </p>
          </div>
        </div>

        {([
          {
            key: 'auto_folder_enabled' as const,
            Icon: FolderOpen,
            label: 'Auto-file into folders',
            blurb: 'On capture, silently file new memories into the best-matching folder when AI is confident. Surfaces an Undo toast for 10s.',
            testid: 'auto-link-toggle-folder',
          },
          {
            key: 'habit_suggestions_enabled' as const,
            Icon: Flame,
            label: 'Habit suggestions',
            blurb: 'Daily scan that proposes linking new memories to your existing habits when they look related.',
            testid: 'auto-link-toggle-habits',
          },
          {
            key: 'cluster_suggestions_enabled' as const,
            Icon: Network,
            label: 'Cluster suggestions',
            blurb: 'Weekly scan that surfaces clusters of related memories and offers to bundle them into a workspace.',
            testid: 'auto-link-toggle-clusters',
          },
        ]).map(({ key, Icon, label, blurb, testid }) => {
          const on = autoLinkPrefs[key];
          const saving = autoLinkSaving === key;
          return (
            <div
              key={key}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 0', borderTop: '1px solid var(--border)',
              }}
            >
              <div style={{
                width: 30, height: 30, borderRadius: 8,
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <Icon size={14} color="var(--text-2)" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{label}</p>
                <p style={{ margin: '3px 0 0', fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.4 }}>
                  {blurb}
                </p>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => void toggleAutoLink(key)}
                aria-pressed={on}
                aria-label={`Toggle ${label}`}
                data-testid={testid}
                style={{
                  width: 44, height: 24, borderRadius: 999,
                  background: on ? '#a78bfa' : 'var(--surface-3)',
                  border: '1px solid var(--border)', cursor: saving ? 'wait' : 'pointer',
                  padding: 0, position: 'relative', transition: 'background 0.18s', flexShrink: 0,
                }}>
                <span style={{
                  position: 'absolute', top: 2, left: on ? 22 : 2,
                  width: 18, height: 18, borderRadius: '50%', background: '#fff',
                  transition: 'left 0.18s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }} />
              </button>
            </div>
          );
        })}
      </motion.div>

      {/* Replay onboarding tour — clears the first-login gate and reopens from step 1 */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
        className="view-card" style={{ marginTop: 20, padding: 'var(--space-md)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ width: 42, height: 42, borderRadius: 11, background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <PlayCircle size={18} color="#3b82f6" />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', margin: '0 0 3px' }}>Replay onboarding tour</h3>
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>
              Walk through the five-step tour again from the beginning — handy if you skipped it on first login or want a refresher after sidebar changes.
            </p>
          </div>
          <button
            onClick={handleReplayTour}
            data-testid="button-replay-onboarding-tour"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', border: '1px solid rgba(37,99,235,0.4)', borderRadius: 9, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(37,99,235,0.3), inset 0 1px 0 rgba(255,255,255,0.15)' }}>
            <PlayCircle size={13} /> Replay tour
          </button>
        </div>
      </motion.div>

      {/* Reset onboarding hints — clears dismissed legacy redirect banners */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.19 }}
        className="view-card" style={{ marginTop: 20, padding: 'var(--space-md)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ width: 42, height: 42, borderRadius: 11, background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <RotateCcw size={18} color="#6366f1" />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', margin: '0 0 3px' }}>Reset onboarding hints</h3>
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>
              Bring back the "now part of Library / Focus / Learn / Insights" banners on legacy pages — handy if you dismissed them too quickly or are showing the app to someone new.
            </p>
          </div>
          <button
            onClick={handleResetRedirectBanners}
            data-testid="button-reset-onboarding-hints"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-1)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            <RotateCcw size={13} /> Reset hints
          </button>
        </div>
      </motion.div>

      {/* Pitch Deck — promoted from sidebar to a Settings entry */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="view-card" style={{ marginTop: 20, padding: 'var(--space-md)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ width: 42, height: 42, borderRadius: 11, background: 'rgba(34,211,238,0.12)', border: '1px solid rgba(34,211,238,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Presentation size={18} color="#22d3ee" />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', margin: '0 0 3px' }}>Pitch Deck</h3>
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>The hackathon-ready story of x247 — open it in a new tab.</p>
          </div>
          <button onClick={() => navigate('/deck')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'linear-gradient(135deg,#06b6d4,#0891b2)', border: 'none', borderRadius: 9, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            Open Pitch Deck <ArrowRight size={13} />
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default SettingsView;
