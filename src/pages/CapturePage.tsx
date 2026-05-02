import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Globe, StickyNote, FileText, Sparkles, Loader2, CheckCircle2, X, Brain,
  Tag, ExternalLink, Save, Upload, Mic, MicOff, Code2, Twitter, Clipboard,
  Youtube, Link2, Zap, Shield, Network, Search, Layers,
  AlertCircle, Eye, FileDigit, Target, BookOpen, HelpCircle, ListChecks,
  Clock, FolderOpen, Star, ArrowRight, GitBranch, ChevronUp, ChevronDown,
  Pencil, Trash2, BookmarkPlus, Wand2, ShieldCheck, Check, Plus,
  Database, ChevronRight, Mail, MessageSquare,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { YouTubeEmbed, YouTubeThumbnail, getYouTubeId } from '../lib/utils';
import { showToast } from '../App';
import type { Memory } from '../lib/types';
import { RevisitScheduler } from '../components/RevisitScheduler';
import AutoGrowTextarea from '../components/AutoGrowTextarea';
import EnrichPanel, { type EnrichState } from '../components/capture/EnrichPanel';
import { useCaptureSuggestions } from '../contexts/CaptureSuggestionsContext';
import {
  saveCaptureBundle, type CaptureBundlePayload,
  getNotionStatus, listNotionDatabases, listNotionDatabasePages, importNotionPage,
  type NotionDatabase,
  getGmailStatus, searchGmail, importGmailMessage,
  type GmailMessageRow,
  getSlackStatus, importSlackThread,
} from '../lib/api';

// EditableText is defined below — it depends on AutoGrowTextarea + lucide icons
// imported above and is used throughout the capture preview panel.

/* ── Helpers ───────────────────────────────────────────────────── */
const safeHostname = (raw: string): string | null => {
  try {
    const u = new URL(raw.trim());
    return u.hostname.replace(/^www\./, '');
  } catch { return null; }
};
const faviconUrl = (host: string) => `https://www.google.com/s2/favicons?domain=${host}&sz=64`;

/* Accept .pdf / .txt / .md / .markdown for the document upload pipeline.
 * Some browsers report a blank `type` for text files dragged from the
 * filesystem, so we fall back to extension matching. */
const isAcceptedDoc = (f: File): boolean => {
  const t = (f.type || '').toLowerCase();
  if (t === 'application/pdf' || t === 'text/plain' || t === 'text/markdown') return true;
  return /\.(pdf|txt|md|markdown)$/i.test(f.name);
};

/* ── Source types ───────────────────────────────────────────────── */
const SOURCES = [
  { id: 'web',       label: 'Web Article', icon: Globe,         color: '#3b82f6', hint: 'Any URL — news, blogs, docs' },
  { id: 'youtube',   label: 'YouTube',     icon: Youtube,       color: '#ef4444', hint: 'Video summary + transcript' },
  { id: 'pdf',       label: 'PDF / Doc',   icon: FileText,      color: '#f59e0b', hint: 'PDF, TXT or MD — extracted by AI' },
  { id: 'note',      label: 'Quick Note',  icon: StickyNote,    color: '#22d3ee', hint: 'Ideas, meeting notes, thoughts' },
  { id: 'code',      label: 'Code',        icon: Code2,         color: '#a78bfa', hint: 'Snippets with AI explanation' },
  { id: 'twitter',   label: 'X / Thread',  icon: Twitter,       color: '#60a5fa', hint: 'Tweet or thread URL' },
  { id: 'voice',     label: 'Voice Memo',  icon: Mic,           color: '#34d399', hint: 'Record & auto-transcribe' },
  { id: 'clipboard', label: 'Clipboard',   icon: Clipboard,     color: '#fb7185', hint: 'Paste anything instantly' },
];

/* ── 7-Agent pipeline ───────────────────────────────────────────── */
const AGENTS = [
  { id: 'capture',   label: 'Capture',      icon: Layers,    color: '#3b82f6', desc: 'Fetching & ingesting raw content' },
  { id: 'summarize', label: 'Summarizer',   icon: Brain,     color: '#22d3ee', desc: 'Generating structured summary' },
  { id: 'insights',  label: 'Insight',      icon: Sparkles,  color: '#a78bfa', desc: 'Extracting key points & actions' },
  { id: 'graph',     label: 'Graph',        icon: Network,   color: '#f472b6', desc: 'Linking to your knowledge graph' },
  { id: 'tags',      label: 'Tagger',       icon: Tag,       color: '#fbbf24', desc: 'Auto-generating smart tags' },
  { id: 'vector',    label: 'Recall',       icon: Search,    color: '#34d399', desc: 'Embedding for semantic search' },
  { id: 'guardian',  label: 'Guardian',     icon: Shield,    color: '#60a5fa', desc: 'Privacy check & validation' },
];

type AgentStatus = 'idle' | 'active' | 'done' | 'error';

/* ── EditableText ────────────────────────────────────────────────
   Tiny inline editor used across the capture preview so the user can
   tweak the AI's output (title, summary, each key insight, each
   action item, each study question) before clicking "Save to Vault".
   Single-line uses <input>; multiline uses AutoGrowTextarea so the
   box grows with content. Enter saves (single-line); Cmd/Ctrl+Enter
   saves (multiline); Escape always cancels. Empty save-attempts are
   ignored — to remove an item the user clicks the trash icon, not
   "Save with empty value", which prevents accidental loss. */
const EditableText: React.FC<{
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  display?: React.ReactNode;
  inputStyle?: React.CSSProperties;
  iconSize?: number;
}> = ({ value, onChange, multiline, placeholder, display, inputStyle, iconSize = 11 }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  // Re-sync the draft if the parent value changes while we're not editing
  // (e.g. a different preview is loaded).
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  const commit = () => {
    const next = (draft || '').trim();
    if (next && next !== value) onChange(next);
    setEditing(false);
  };
  const cancel = () => { setDraft(value); setEditing(false); };

  if (editing) {
    const commonProps = {
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
      autoFocus: true,
      placeholder,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') { e.preventDefault(); cancel(); return; }
        if (e.key === 'Enter') {
          if (!multiline) { e.preventDefault(); commit(); return; }
          if (e.metaKey || e.ctrlKey) { e.preventDefault(); commit(); }
        }
      },
      style: { width: '100%', padding: '7px 10px', borderRadius: 8, border: '1.5px solid var(--primary-border)', background: 'var(--surface)', color: 'var(--text-1)', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const, ...inputStyle },
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0, width: '100%' }}>
        {multiline
          ? <AutoGrowTextarea {...(commonProps as any)} maxHeight={260} rows={3} />
          : <input type="text" {...(commonProps as any)} />}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button type="button" onClick={cancel}
            style={{ padding: '4px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, cursor: 'pointer', color: 'var(--text-2)', fontSize: 11, fontWeight: 600, fontFamily: 'inherit' }}>
            Cancel
          </button>
          <button type="button" onClick={commit}
            style={{ padding: '4px 10px', background: 'var(--primary)', border: 'none', borderRadius: 7, cursor: 'pointer', color: '#fff', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Check size={11} /> Save
          </button>
        </div>
      </div>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 6, flex: 1, minWidth: 0, width: '100%' }}>
      <span style={{ flex: 1, minWidth: 0 }}>{display ?? (value || <span style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>{placeholder || 'Empty'}</span>)}</span>
      <button type="button" onClick={() => setEditing(true)} aria-label="Edit"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 3, color: 'var(--text-3)', display: 'inline-flex', flexShrink: 0, borderRadius: 6, alignSelf: 'flex-start', marginTop: 2 }}>
        <Pencil size={iconSize} />
      </button>
    </span>
  );
};

/* ── Voice recording helper ─────────────────────────────────────── */
function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>('audio/webm');

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mimeRef.current = mr.mimeType || 'audio/webm';
      chunksRef.current = [];
      setTranscript('');
      mr.ondataavailable = e => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeRef.current });
        if (blob.size === 0) { showToast('No audio captured'); return; }
        setTranscribing(true);
        setTranscript('Transcribing audio…');
        try {
          const fd = new FormData();
          const ext = mimeRef.current.includes('mp4') ? 'm4a' : mimeRef.current.includes('ogg') ? 'ogg' : 'webm';
          fd.append('file', blob, `voice.${ext}`);
          const r = await fetch('/capture/voice', { method: 'POST', body: fd });
          const data = await r.json();
          if (data.transcript && !String(data.transcript).startsWith('[Transcription failed')) {
            setTranscript(data.transcript);
          } else {
            setTranscript('');
            showToast(data.error || 'Transcription failed — try again');
          }
        } catch (e: any) {
          setTranscript('');
          showToast(e.message || 'Voice upload failed');
        } finally {
          setTranscribing(false);
        }
      };
      mr.start();
      mediaRef.current = mr;
      setRecording(true);
    } catch { showToast('Microphone access denied'); }
  };

  const stop = () => {
    mediaRef.current?.stop();
    setRecording(false);
  };

  return { recording, transcribing, transcript, setTranscript, start, stop };
}

/* ── Main component ─────────────────────────────────────────────── */
interface CaptureViewProps { embedded?: boolean }
const CaptureView: React.FC<CaptureViewProps> = ({ embedded = false }) => {
  const navigate = useNavigate();
  const [source, setSource]             = useState<string>('web');
  const [input, setInput]               = useState('');
  // P5A — Notion source picker. We only flip the chip on once we've
  // confirmed connection so the picker can never open into a guaranteed
  // 401. The picker itself lazy-loads databases on first open and pages
  // on first database expansion to avoid surprising the user with two
  // upfront network calls just for visiting the Capture page.
  const [notionConnected, setNotionConnected]     = useState(false);
  const [notionPickerOpen, setNotionPickerOpen]   = useState(false);
  const [notionDbList, setNotionDbList]           = useState<NotionDatabase[] | null>(null);
  const [notionDbsLoading, setNotionDbsLoading]   = useState(false);
  const [notionExpandedDb, setNotionExpandedDb]   = useState<string | null>(null);
  const [notionPagesByDb, setNotionPagesByDb]     = useState<Record<string, Array<{ page_id: string; title: string; url: string }>>>({});
  const [notionPagesLoadingDb, setNotionPagesLoadingDb] = useState<string | null>(null);
  const [notionImportingPage, setNotionImportingPage] = useState<string | null>(null);
  // P5B — Gmail source picker. Same chip-only-when-connected guard as
  // Notion above. The picker uses Gmail search syntax (`is:starred` by
  // default so the chip behaves like the spec's "from inbox" entry, but
  // the user can type any query like `from:boss@x.com` or `subject:invoice`).
  const [gmailConnected, setGmailConnected]       = useState(false);
  const [gmailPickerOpen, setGmailPickerOpen]     = useState(false);
  const [gmailQuery, setGmailQuery]               = useState<string>('is:starred');
  const [gmailMsgList, setGmailMsgList]           = useState<GmailMessageRow[] | null>(null);
  const [gmailMsgsLoading, setGmailMsgsLoading]   = useState(false);
  const [gmailImportingId, setGmailImportingId]   = useState<string | null>(null);
  // P5C — Slack source picker. Same chip-only-when-connected guard as
  // the Notion/Gmail chips above. Slack capture is a single textarea
  // accepting a Slack thread URL; no search/list flow because Slack
  // doesn't expose a useful "list all my recent threads" surface.
  const [slackConnected, setSlackConnected]       = useState(false);
  const [slackPickerOpen, setSlackPickerOpen]     = useState(false);
  const [slackUrl, setSlackUrl]                   = useState<string>('');
  const [slackImporting, setSlackImporting]       = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [preview, setPreview]           = useState<Memory | null>(null);
  const [previewUrl, setPreviewUrl]     = useState('');
  // W1 capture-enrichment state — what the user accepted from the
  // EnrichPanel chips. Reset whenever the preview itself is reset so
  // a stale folder/task selection from a previous capture can never
  // leak into the next save.
  const [enrichState, setEnrichState]   = useState<EnrichState>({});
  // Monotonic counter bumped on every successful capture preview. Used
  // as the EnrichPanel `key` so React fully unmounts/remounts even when
  // two captures share a title (or both have an empty id pre-save) —
  // guaranteeing chip state never leaks across captures.
  const [captureEpoch, setCaptureEpoch] = useState(0);
  const [pdfFile, setPdfFile]           = useState<File | null>(null);
  const [pdfObjectUrl, setPdfObjectUrl] = useState<string>('');
  const [textPreview, setTextPreview]   = useState<string>('');
  const [dragOver, setDragOver]         = useState(false);
  const runButtonRef = useRef<HTMLDivElement | null>(null);
  const [justSavedId, setJustSavedId]   = useState<string | null>(null);
  const [justSaved, setJustSaved]       = useState<{ id: string; title: string; url: string } | null>(null);
  const [showRevisit, setShowRevisit]   = useState(false);
  const [agentState, setAgentState]     = useState<Record<string, AgentStatus>>({});
  const [activeAgentDesc, setActiveAgentDesc] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const voice = useVoiceRecorder();
  // 60 s cache hook so a fresh capture preview's suggested_* block is
  // warmed instantly — re-opening the same memory's chips later (or
  // navigating back from another tab within a minute) avoids flashing
  // a loader while suggestions repopulate.
  const { setCached: setCachedSuggestions } = useCaptureSuggestions();

  // ── Preview mutation helpers ────────────────────────────────────
  // The preview panel lets the user tweak / prune the AI's output
  // before saving. Edits flow through `setPreview` so the (possibly
  // modified) preview is what gets POSTed in handleSave.
  const updatePreviewField = <K extends keyof Memory>(key: K, val: Memory[K]) =>
    setPreview(p => p ? ({ ...p, [key]: val }) : p);
  const removeListItem = (
    key: 'key_points' | 'action_items' | 'study_questions' | 'glossary' | 'tags',
    idx: number,
  ) => setPreview(p => {
    if (!p) return p;
    const arr = (p as any)[key];
    if (!Array.isArray(arr)) return p;
    return { ...p, [key]: arr.filter((_: any, i: number) => i !== idx) };
  });
  const updateStringListItem = (
    key: 'key_points' | 'action_items' | 'study_questions',
    idx: number,
    val: string,
  ) => setPreview(p => {
    if (!p) return p;
    const arr = (p as any)[key] as string[] | undefined;
    if (!Array.isArray(arr)) return p;
    return { ...p, [key]: arr.map((it, i) => i === idx ? val : it) };
  });
  const [tagDraft, setTagDraft] = useState('');
  const addTag = (raw: string) => {
    const t = raw.trim().replace(/^#/, '').toLowerCase();
    if (!t) return;
    setPreview(p => {
      if (!p) return p;
      const tags = Array.isArray(p.tags) ? p.tags : [];
      if (tags.includes(t)) return p;
      return { ...p, tags: [...tags, t] };
    });
    setTagDraft('');
  };

  // ── Time Capture (capture-my-last-N-hours bundle) ───────────────
  const [bundling, setBundling] = useState<null | number>(null); // hours we're bundling, or null
  const [bundleResult, setBundleResult] = useState<any>(null);
  // Synchronous lock — React state updates are async, so a rapid double-click
  // can otherwise pass the `bundling !== null` check twice and fire two requests.
  const bundlingLock = useRef(false);
  const runTimeBundle = async (hours: number) => {
    if (bundlingLock.current || bundling !== null) return;
    bundlingLock.current = true;
    setBundling(hours);
    setBundleResult(null);
    try {
      const r = await fetch('/capture/time-bundle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hours }),
      });
      const data = await r.json();
      setBundleResult(data);
      if (data?.ok) {
        showToast(`Bundled ${data.stats?.captured || 0} captures into "${data.project?.name || 'workspace'}"`);
      } else if (data?.reason === 'no_recent') {
        showToast(`No captures in the last ${hours}h yet`);
      } else if (data?.reason === 'all_bundled') {
        showToast('All recent captures already in a workspace');
      } else {
        showToast(data?.message || data?.detail || 'Time bundle failed');
      }
    } catch (e: any) {
      showToast(e?.message || 'Time bundle failed');
    } finally {
      setBundling(null);
      bundlingLock.current = false;
    }
  };

  // ── Multi-Source Capture Session (tray of mixed inputs → 1 workspace) ──
  type SessionItem =
    | { id: string; kind: 'note';  content: string }
    | { id: string; kind: 'link';  url: string }
    | { id: string; kind: 'voice'; transcript: string }
    | { id: string; kind: 'image'; data_url: string; caption: string;
        // OCR pipeline state — set when the image is first picked, then
        // updated as the /capture/ocr-image round-trip progresses.
        ocr_status?: 'reading' | 'done' | 'empty' | 'error';
        ocr_text?: string };

  const [sessionMode, setSessionMode] = useState(false);
  const [sessionItems, setSessionItems] = useState<SessionItem[]>([]);
  const [sessionDraftKind, setSessionDraftKind] = useState<'note' | 'link' | 'voice' | 'image'>('note');
  const [sessionDraftText, setSessionDraftText] = useState('');
  const [sessionFolderMode, setSessionFolderMode] = useState<'auto' | 'create' | 'existing'>('auto');
  const [sessionFolderName, setSessionFolderName] = useState('');
  const [sessionExistingId, setSessionExistingId] = useState('');
  const [sessionHint, setSessionHint] = useState('');
  const [sessionProjects, setSessionProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [sessionSubmitting, setSessionSubmitting] = useState(false);
  const [sessionResult, setSessionResult] = useState<any>(null);
  const sessionImageInputRef = useRef<HTMLInputElement>(null);
  const sessionVoice = useVoiceRecorder();
  const sessionSubmitLock = useRef(false);

  // ── Tray persistence (localStorage) + resume banner ─────────────────
  // Saved + resumed across reloads so multi-source research isn't lost.
  const SESSION_LS_KEY = 'recall:capture:session:v1';
  const [sessionResume, setSessionResume] = useState<null | { count: number }>(null);
  const sessionLoadedRef = useRef(false);

  useEffect(() => {
    // First-mount: peek at storage and offer to resume if there's anything saved.
    if (sessionLoadedRef.current) return;
    sessionLoadedRef.current = true;
    try {
      const raw = localStorage.getItem(SESSION_LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const savedItems = Array.isArray(parsed?.items) ? parsed.items : [];
      if (savedItems.length === 0) return;
      setSessionResume({ count: savedItems.length });
    } catch {}
  }, []);

  // P5A — Probe Notion connection once on mount; the chip is hidden when
  // disconnected. Failure (network blip / 401) collapses to disconnected
  // silently — the user can still capture from any other source.
  useEffect(() => {
    let cancelled = false;
    void getNotionStatus().then(s => {
      if (!cancelled) setNotionConnected(!!s.connected);
    });
    return () => { cancelled = true; };
  }, []);

  const openNotionPicker = async () => {
    setNotionPickerOpen(true);
    if (notionDbList === null && !notionDbsLoading) {
      setNotionDbsLoading(true);
      try {
        const dbs = await listNotionDatabases();
        setNotionDbList(dbs);
      } catch (e) {
        showToast(`Couldn't load Notion databases: ${(e as Error).message}`, 'error');
        setNotionDbList([]);
      } finally {
        setNotionDbsLoading(false);
      }
    }
  };

  const expandNotionDb = async (dbId: string) => {
    if (notionExpandedDb === dbId) {
      setNotionExpandedDb(null);
      return;
    }
    setNotionExpandedDb(dbId);
    if (notionPagesByDb[dbId]) return; // cached
    setNotionPagesLoadingDb(dbId);
    try {
      const pages = await listNotionDatabasePages(dbId, 50);
      setNotionPagesByDb(prev => ({ ...prev, [dbId]: pages }));
    } catch (e) {
      showToast(`Couldn't load Notion pages: ${(e as Error).message}`, 'error');
      setNotionPagesByDb(prev => ({ ...prev, [dbId]: [] }));
    } finally {
      setNotionPagesLoadingDb(prev => (prev === dbId ? null : prev));
    }
  };

  // P5B — Gmail picker handlers. Probe connection on mount, lazy-load
  // messages on first open + after every search. Importing a message
  // navigates the user to the freshly-saved memory just like the Notion
  // flow above, so capture from Gmail feels identical to capture from
  // a URL or PDF.
  useEffect(() => {
    let cancelled = false;
    void getGmailStatus().then(s => {
      if (!cancelled) setGmailConnected(!!s.connected);
    });
    return () => { cancelled = true; };
  }, []);

  const runGmailSearch = async (query: string) => {
    setGmailMsgsLoading(true);
    try {
      const msgs = await searchGmail({ query: query || 'is:starred', limit: 20 });
      setGmailMsgList(msgs);
    } catch (e) {
      showToast(`Couldn't search Gmail: ${(e as Error).message}`, 'error');
      setGmailMsgList([]);
    } finally {
      setGmailMsgsLoading(false);
    }
  };

  const openGmailPicker = async () => {
    setGmailPickerOpen(true);
    if (gmailMsgList === null && !gmailMsgsLoading) {
      await runGmailSearch(gmailQuery);
    }
  };

  // P5C — Slack picker handlers. Probe connection on mount, importing
  // a pasted thread URL navigates to the freshly-saved memory just
  // like the Notion/Gmail flows above.
  useEffect(() => {
    let cancelled = false;
    void getSlackStatus().then(s => {
      if (!cancelled) setSlackConnected(!!s.connected);
    });
    return () => { cancelled = true; };
  }, []);

  const openSlackPicker = () => {
    setSlackPickerOpen(true);
  };

  const importSlackThreadAndOpen = async () => {
    const url = slackUrl.trim();
    if (!url) {
      showToast('Paste a Slack thread URL first.', 'error');
      return;
    }
    setSlackImporting(true);
    try {
      const res = await importSlackThread({ url });
      const verb = res.created ? 'Saved' : res.updated ? 'Refreshed' : 'Imported';
      showToast(`${verb} from Slack: ${res.title || 'thread'} (${res.message_count} msgs)`, 'success');
      setSlackPickerOpen(false);
      setSlackUrl('');
      if (res.memory_id) {
        navigate(`/memory/${res.memory_id}`);
      }
    } catch (e) {
      showToast(`Slack import failed: ${(e as Error).message}`, 'error');
    } finally {
      setSlackImporting(false);
    }
  };

  const importGmailMessageAndOpen = async (messageId: string) => {
    setGmailImportingId(messageId);
    try {
      const res = await importGmailMessage(messageId);
      const verb = res.created ? 'Saved' : res.updated ? 'Refreshed' : 'Imported';
      showToast(`${verb} from Gmail: ${res.subject || '(no subject)'}`, 'success');
      setGmailPickerOpen(false);
      if (res.memory_id) {
        navigate(`/memory/${res.memory_id}`);
      }
    } catch (e) {
      showToast(`Gmail import failed: ${(e as Error).message}`, 'error');
    } finally {
      setGmailImportingId(null);
    }
  };

  const importNotionPageAndOpen = async (pageId: string) => {
    setNotionImportingPage(pageId);
    try {
      const res = await importNotionPage(pageId);
      const verb = res.created ? 'Imported' : 'Updated';
      showToast(`${verb} from Notion: ${res.title || 'Untitled'}`, 'success');
      setNotionPickerOpen(false);
      // Land the user on the freshly imported memory so they can refine
      // tags/folder right away. Same UX as a fresh web/youtube capture.
      navigate(`/memory/${res.memory_id}`);
    } catch (e) {
      showToast(`Notion import failed: ${(e as Error).message}`, 'error');
    } finally {
      setNotionImportingPage(null);
    }
  };

  const resumeSession = () => {
    try {
      const raw = localStorage.getItem(SESSION_LS_KEY);
      if (!raw) { setSessionResume(null); return; }
      const parsed = JSON.parse(raw);
      const savedItems = Array.isArray(parsed?.items) ? parsed.items : [];
      setSessionItems(savedItems as SessionItem[]);
      if (parsed?.folderMode) setSessionFolderMode(parsed.folderMode);
      if (typeof parsed?.folderName === 'string') setSessionFolderName(parsed.folderName);
      if (typeof parsed?.hint === 'string') setSessionHint(parsed.hint);
      setSessionMode(true);
      setSessionResume(null);
      showToast(`Resumed ${savedItems.length} item${savedItems.length === 1 ? '' : 's'} from your last session`);
      // Re-trigger OCR for any image items whose run was interrupted
      // (status='reading') or failed previously (status='error') so the
      // "Reading text…" pip resolves on its own without user action.
      for (const it of savedItems as SessionItem[]) {
        if (it.kind === 'image' && (it.ocr_status === 'reading' || it.ocr_status === 'error') && it.data_url) {
          void runOcrForImage(it.id, it.data_url, it.caption);
        }
      }
    } catch { setSessionResume(null); }
  };
  const discardSavedSession = () => {
    try { localStorage.removeItem(SESSION_LS_KEY); } catch {}
    setSessionResume(null);
  };

  // Persist tray to localStorage whenever it has content. We deliberately
  // only WRITE here (never delete) — a "skip-first-render" ref pattern is
  // unreliable in React StrictMode (double-mount fires the effect twice and
  // wipes the saved tray right after Resume reads it). Explicit clears live
  // in submitSession/Clear-tray/discardSavedSession instead.
  useEffect(() => {
    if (sessionItems.length === 0) return;
    try {
      localStorage.setItem(SESSION_LS_KEY, JSON.stringify({
        items: sessionItems,
        folderMode: sessionFolderMode,
        folderName: sessionFolderName,
        hint: sessionHint,
        savedAt: new Date().toISOString(),
      }));
    } catch {}
  }, [sessionItems, sessionFolderMode, sessionFolderName, sessionHint]);

  // Lazily fetch existing workspaces when user picks the Existing mode.
  useEffect(() => {
    if (!sessionMode || sessionFolderMode !== 'existing' || sessionProjects.length > 0) return;
    fetch('/workspace/projects')
      .then(r => r.json())
      .then((d: { projects?: Array<{ id: string; name: string }> }) =>
        setSessionProjects((d?.projects || []).map(p => ({ id: p.id, name: p.name }))))
      .catch(() => {});
  }, [sessionMode, sessionFolderMode, sessionProjects.length]);

  // ── Tray reorder + edit ──────────────────────────────────────────────
  const moveSessionItem = (id: string, dir: -1 | 1) => {
    setSessionItems(prev => {
      const idx = prev.findIndex(x => x.id === id);
      if (idx < 0) return prev;
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const startEditItem = (it: SessionItem) => {
    setEditingItemId(it.id);
    if (it.kind === 'note')  setEditingDraft(it.content);
    else if (it.kind === 'link')  setEditingDraft(it.url);
    else if (it.kind === 'voice') setEditingDraft(it.transcript);
    else setEditingDraft(it.caption);
  };
  const cancelEditItem = () => { setEditingItemId(null); setEditingDraft(''); };
  const saveEditItem = () => {
    const txt = editingDraft.trim();
    if (!txt) { showToast('Cannot be empty'); return; }
    setSessionItems(prev => prev.map(it => {
      if (it.id !== editingItemId) return it;
      if (it.kind === 'note')  return { ...it, content: txt };
      if (it.kind === 'link')  {
        if (!/^https?:\/\//i.test(txt)) { showToast('Enter a valid URL'); return it; }
        return { ...it, url: txt };
      }
      if (it.kind === 'voice') return { ...it, transcript: txt };
      return { ...it, caption: txt };
    }));
    setEditingItemId(null);
    setEditingDraft('');
  };

  // ── AI bundle preview (summary + 3 folder name candidates) ──────────
  const [bundlePreview, setBundlePreview] = useState<null | { summary: string; folder_names: string[] }>(null);
  const [bundleLoading, setBundleLoading] = useState(false);
  const fetchBundlePreview = async () => {
    if (sessionItems.length < 2) { showToast('Add at least 2 items first'); return; }
    setBundleLoading(true);
    setBundlePreview(null);
    try {
      const r = await fetch('/capture/session/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: sessionItems.map(it => {
            if (it.kind === 'note')  return { kind: 'note',  content: it.content };
            if (it.kind === 'link')  return { kind: 'link',  url: it.url };
            if (it.kind === 'voice') return { kind: 'voice', transcript: it.transcript };
            return { kind: 'image', caption: it.caption, ocr_text: it.ocr_text || '' };
          }),
        }),
      });
      const data = await r.json();
      if (data?.ok) {
        setBundlePreview({ summary: data.summary || '', folder_names: data.folder_names || [] });
      } else {
        showToast(data?.error || data?.message || 'AI preview failed');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'AI preview failed';
      showToast(msg);
    } finally {
      setBundleLoading(false);
    }
  };
  // Auto-trigger bundle preview the first time the tray reaches 2+ items
  // (debounced 800ms so adding several items in quick succession only fires
  // one request). Manual Refresh still works any time after.
  const autoBundleFiredRef = useRef(false);
  useEffect(() => {
    if (sessionItems.length < 2) return;
    if (autoBundleFiredRef.current) return;
    if (bundlePreview || bundleLoading) { autoBundleFiredRef.current = true; return; }
    const t = window.setTimeout(() => {
      if (autoBundleFiredRef.current) return;
      autoBundleFiredRef.current = true;
      fetchBundlePreview();
    }, 800);
    return () => window.clearTimeout(t);
  }, [sessionItems.length, bundlePreview, bundleLoading]);

  const applyBundleFolder = (name: string) => {
    setSessionFolderMode('create');
    setSessionFolderName(name);
    showToast(`Folder set: ${name}`);
  };

  const newSessionId = () => Math.random().toString(36).slice(2, 10);

  const addSessionItem = (item: SessionItem) => setSessionItems(prev => [...prev, item]);
  const removeSessionItem = (id: string) => setSessionItems(prev => {
    const next = prev.filter(x => x.id !== id);
    // If the user emptied the tray manually (one-by-one removal), clear the
    // saved snapshot so a stale Resume banner can't resurrect it on next visit.
    if (next.length === 0) {
      try { localStorage.removeItem(SESSION_LS_KEY); } catch {}
    }
    return next;
  });

  const commitDraftItem = () => {
    const text = sessionDraftText.trim();
    if (sessionDraftKind === 'note') {
      if (!text) { showToast('Note is empty'); return; }
      addSessionItem({ id: newSessionId(), kind: 'note', content: text });
    } else if (sessionDraftKind === 'link') {
      if (!text || !/^https?:\/\//i.test(text)) { showToast('Enter a valid URL'); return; }
      addSessionItem({ id: newSessionId(), kind: 'link', url: text });
    } else {
      return;
    }
    setSessionDraftText('');
  };

  const commitVoiceToSession = () => {
    const t = (sessionVoice.transcript || '').trim();
    if (!t || t.startsWith('Transcribing')) { showToast('No transcript yet'); return; }
    addSessionItem({ id: newSessionId(), kind: 'voice', transcript: t });
    sessionVoice.setTranscript('');
  };

  // Patch a single image session item by id (no-op if id is missing or the
  // item is not an image kind). Used by the OCR round-trip to flip status
  // and store the recognized text once the backend responds.
  const patchSessionImage = (id: string, patch: Partial<Extract<SessionItem, { kind: 'image' }>>) => {
    setSessionItems(prev => prev.map(it => (it.id === id && it.kind === 'image') ? { ...it, ...patch } : it));
  };

  // Kick off OCR for an image item. Best-effort — failures flip the pip to
  // 'error' but never block the user from committing the session (the backend
  // will OCR again as a safety net inside process_capture_session).
  const runOcrForImage = async (id: string, dataUrl: string, caption: string) => {
    try {
      const r = await fetch('/capture/ocr-image', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data_url: dataUrl, caption }),
      });
      if (!r.ok) throw new Error(`OCR failed (${r.status})`);
      const data = await r.json();
      const text = (data?.ocr_text || '').trim();
      patchSessionImage(id, {
        ocr_text: text,
        ocr_status: text ? 'done' : 'empty',
      });
    } catch {
      patchSessionImage(id, { ocr_status: 'error' });
    }
  };

  const handleSessionImagePick = (file: File | null) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showToast('Image too large (max 2MB)'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (!dataUrl) return;
      const id = newSessionId();
      const caption = file.name.replace(/\.[^.]+$/, '');
      addSessionItem({ id, kind: 'image', data_url: dataUrl, caption, ocr_status: 'reading', ocr_text: '' });
      // Fire-and-forget OCR — UI shows a "Reading text…" pip until it returns.
      void runOcrForImage(id, dataUrl, caption);
    };
    reader.readAsDataURL(file);
  };

  const submitSession = async () => {
    if (sessionSubmitLock.current || sessionSubmitting) return;
    if (sessionItems.length === 0) { showToast('Add at least one item'); return; }
    if (sessionFolderMode === 'create' && !sessionFolderName.trim()) { showToast('Folder name required'); return; }
    if (sessionFolderMode === 'existing' && !sessionExistingId) { showToast('Pick an existing folder'); return; }
    sessionSubmitLock.current = true;
    setSessionSubmitting(true);
    setSessionResult(null);
    try {
      const r = await fetch('/capture/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: sessionItems.map(it => {
            if (it.kind === 'note')  return { kind: 'note',  content: it.content };
            if (it.kind === 'link')  return { kind: 'link',  url: it.url };
            if (it.kind === 'voice') return { kind: 'voice', transcript: it.transcript };
            return { kind: 'image', data_url: it.data_url, caption: it.caption, ocr_text: it.ocr_text || '' };
          }),
          folder_mode: sessionFolderMode,
          folder_name: sessionFolderName.trim(),
          project_id: sessionExistingId,
          hint: sessionHint.trim(),
        }),
      });
      const data = await r.json();
      setSessionResult(data);
      if (data?.ok) {
        showToast(`Session saved · ${data.stats?.captured || 0} items → "${data.project?.name || 'workspace'}"`);
        setSessionItems([]);
        setSessionFolderName('');
        setSessionHint('');
        // Explicit clear — the persist effect no longer auto-deletes on empty state.
        try { localStorage.removeItem(SESSION_LS_KEY); } catch {}
      } else {
        showToast(data?.message || data?.detail || 'Session save failed');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Session save failed';
      showToast(msg);
    } finally {
      setSessionSubmitting(false);
      sessionSubmitLock.current = false;
    }
  };

  const sessionItemLabel = (it: SessionItem) => {
    if (it.kind === 'note')  return it.content.slice(0, 80);
    if (it.kind === 'link')  return it.url;
    if (it.kind === 'voice') return it.transcript.slice(0, 80);
    return it.caption || 'image';
  };

  // ── Capture templates (starter scaffolds + user-saved) ───────────────
  type Template = { id: string; label: string; source: string; body: string; tags?: string[] };
  const TEMPLATES_LS_KEY = 'recall:capture:templates:v1';
  const STARTER_TEMPLATES: Template[] = [
    {
      id: 'starter:meeting',
      label: 'Meeting Note',
      source: 'note',
      body: 'Meeting:\nDate:\nAttendees:\n\nDecisions:\n- \n\nAction items:\n- \n\nOpen questions:\n- \n',
      tags: ['meeting', 'notes'],
    },
    {
      id: 'starter:article',
      label: 'Article + My Take',
      source: 'note',
      body: 'Article:\nLink:\n\nWhat the article says:\n- \n- \n\nMy take:\n\nWhy it matters to me:\n',
      tags: ['article', 'reading'],
    },
    {
      id: 'starter:code',
      label: 'Code Snippet + Why-it-matters',
      source: 'code',
      body: '// What this does:\n//\n// Why it matters:\n//\n// When to reach for it:\n//\n// Code:\n',
      tags: ['code', 'snippet'],
    },
    {
      id: 'starter:book',
      label: 'Book Quote + Reflection',
      source: 'note',
      body: 'Book:\nAuthor:\nPage:\n\nQuote:\n"\n"\n\nReflection:\n\nHow I want to use this:\n',
      tags: ['book', 'quote'],
    },
  ];
  const [userTemplates, setUserTemplates] = useState<Template[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TEMPLATES_LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const valid: Template[] = (parsed as Partial<Template>[])
            .filter((t): t is Template => typeof t?.id === 'string' && typeof t?.body === 'string' && typeof t?.label === 'string' && typeof t?.source === 'string');
          setUserTemplates(valid);
        }
      }
    } catch {}
  }, []);
  const persistUserTemplates = (next: Template[]) => {
    setUserTemplates(next);
    try { localStorage.setItem(TEMPLATES_LS_KEY, JSON.stringify(next)); } catch {}
  };
  const applyTemplate = (t: Template) => {
    setSource(t.source);
    // Tag prefill: append template tags as hashtags at the end of the body so
    // the backend tagger picks them up alongside its auto-generated tags. They
    // stay editable in the input — the user can delete or rewrite freely.
    const hashtagLine = (t.tags && t.tags.length > 0)
      ? `\n\nTags: ${t.tags.map(tg => '#' + tg.replace(/\s+/g, '-')).join(' ')}\n`
      : '';
    setInput(t.body + hashtagLine);
    setTemplatesOpen(false);
    showToast(`Loaded template: ${t.label}`);
  };
  const saveCurrentAsTemplate = () => {
    const body = input.trim();
    if (!body) { showToast('Nothing to save — fill the input first'); return; }
    const label = window.prompt('Name this template (e.g. "Daily standup")');
    if (!label || !label.trim()) return;
    const next: Template = {
      id: `user:${Date.now()}`,
      label: label.trim().slice(0, 48),
      source,
      body,
    };
    persistUserTemplates([...userTemplates, next]);
    showToast(`Saved template: ${next.label}`);
  };
  const removeUserTemplate = (id: string) => {
    persistUserTemplates(userTemplates.filter(t => t.id !== id));
  };

  // ── Batch URL paste (multi-URL queue → sequential captures) ─────────
  // Detect 2+ URLs in one paste; show a queue dialog; process them one at a
  // time, auto-saving each (no preview), with live progress.
  const [batchQueue, setBatchQueue] = useState<string[] | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [batchResults, setBatchResults] = useState<Array<{ url: string; ok: boolean; title?: string; error?: string; duplicate?: boolean }>>([]);

  const extractUrls = (text: string): string[] => {
    const urls = (text.match(/https?:\/\/[^\s<>"']+/gi) || [])
      .map(u => u.replace(/[)\].,;]+$/, '').trim());
    return Array.from(new Set(urls));
  };

  const handleUrlPaste = (text: string) => {
    const urls = extractUrls(text);
    if (urls.length >= 2) {
      setBatchQueue(urls);
      setBatchResults([]);
      setBatchProgress(null);
      // Don't replace input — let the user see what was pasted
      setInput(text);
      return true;
    }
    return false;
  };

  const runBatchCapture = async () => {
    if (!batchQueue || batchQueue.length === 0) return;
    setBatchRunning(true);
    setBatchResults([]);
    const results: typeof batchResults = [];
    for (let i = 0; i < batchQueue.length; i++) {
      const url = batchQueue[i];
      setBatchProgress({ done: i, total: batchQueue.length, current: url });
      try {
        const isYt = url.includes('youtube.com') || url.includes('youtu.be');
        const isTw = url.includes('twitter.com') || url.includes('x.com');
        const source_type = isYt ? 'youtube' : 'web';
        // Capture (no preview)
        const cap = await fetch('/capture', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ source_type, url, content: '', preview: true }),
        });
        if (!cap.ok) throw new Error(`HTTP ${cap.status}`);
        const previewData = await cap.json();
        if (previewData?.error) throw new Error(previewData.error);
        if (!previewData.source_url) previewData.source_url = url;
        // Save
        const sav = await fetch('/memories', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(previewData),
        });
        if (!sav.ok) throw new Error('Save failed');
        const saved = await sav.json().catch(() => null);
        results.push({
          url,
          ok: true,
          title: saved?.title || previewData.title || url,
          duplicate: !!saved?.duplicate,
        });
        // Mark twitter (treated as web)
        void isTw;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Failed';
        results.push({ url, ok: false, error: msg });
      }
      setBatchResults([...results]);
    }
    setBatchProgress({ done: batchQueue.length, total: batchQueue.length, current: '' });
    setBatchRunning(false);
    const ok = results.filter(r => r.ok).length;
    showToast(`Batch done: ${ok}/${results.length} captured`);
  };
  const cancelBatch = () => {
    setBatchQueue(null);
    setBatchResults([]);
    setBatchProgress(null);
  };

  // ── Pre-save dedup check on preview arrival ──────────────────────────
  // Single source of truth: every preview goes through /capture/dedup-check.
  // - URL-bearing previews (web / youtube / pdf / etc.) check by normalized URL.
  // - Note-like previews (note / voice / clipboard / code) check by content-hash
  //   of (title + summary), since they have no canonical URL to match on.
  // We skip content-hash on web/youtube/pdf to avoid false positives where two
  // different articles share thematically similar AI-written summaries.
  const NOTE_LIKE_SOURCES = new Set(['note', 'voice', 'clipboard', 'code']);
  const [preSaveDup, setPreSaveDup] = useState<null | { id: string; title: string; by: string }>(null);
  // User chose "Save anyway" on the duplicate banner — let the next save go
  // through as a new memory and reset the override after.
  const [dupOverride, setDupOverride] = useState(false);
  useEffect(() => {
    if (!preview) { setPreSaveDup(null); return; }
    if (preview.duplicate_of) return; // URL match already surfaced by /capture
    const previewSource = String(preview.source_type || '').toLowerCase();
    const isNoteLike = NOTE_LIKE_SOURCES.has(previewSource) || NOTE_LIKE_SOURCES.has(source);
    const url = (preview.source_url || previewUrl || '').trim();
    const title = preview.title || '';
    const summary = preview.summary || '';
    // Build the request: always include the URL when we have one (cheap exact
    // match), and include title/summary only for note-like sources where the
    // content-hash check is appropriate.
    const body: { url: string; title?: string; summary?: string } = { url };
    if (isNoteLike) {
      body.title = title;
      body.summary = summary;
    }
    if (!body.url && !body.title) return; // nothing to check
    let cancelled = false;
    fetch('/capture/dedup-check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (d?.duplicate?.id) {
          setPreSaveDup({ id: d.duplicate.id, title: d.duplicate.title || 'Existing memory', by: d.by || 'match' });
        } else {
          setPreSaveDup(null);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [preview, previewUrl, source]);

  // ── Preview metadata (word count + read time + tag count + language + guardian) ─
  const previewMeta = useMemo(() => {
    if (!preview) return null;
    const parts = [
      preview.summary || '',
      preview.executive_summary || '',
      ...(Array.isArray(preview.key_points) ? preview.key_points : []),
    ];
    const text = parts.join(' ').trim();
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    const readMinutes = words > 0 ? Math.max(1, Math.round(words / 200)) : 0;
    // Lightweight script-based language detection — covers the common scripts
    // Recall users actually paste (Latin / Devanagari / CJK / Cyrillic / Arabic).
    // The backend can override by setting preview.language directly later.
    const detectLang = (s: string): string => {
      if (!s) return '';
      if (/[\u0900-\u097F]/.test(s)) return 'Hindi';
      if (/[\u4E00-\u9FFF]/.test(s)) return 'Chinese';
      if (/[\u3040-\u30FF]/.test(s)) return 'Japanese';
      if (/[\uAC00-\uD7AF]/.test(s)) return 'Korean';
      if (/[\u0600-\u06FF]/.test(s)) return 'Arabic';
      if (/[\u0400-\u04FF]/.test(s)) return 'Russian';
      if (/[a-zA-Z]/.test(s)) return 'English';
      return '';
    };
    const language = String(preview.language || detectLang(text) || '');
    // Guardian agent confidence — surfaced if the backend included it in the
    // preview payload (any of: guardian_confidence, guardian_score, quality_score).
    const rawGuardian = preview.guardian_confidence
      ?? preview.guardian_score
      ?? preview.quality_score;
    let guardianPct: number | null = null;
    if (typeof rawGuardian === 'number' && isFinite(rawGuardian)) {
      guardianPct = rawGuardian > 1 ? Math.round(rawGuardian) : Math.round(rawGuardian * 100);
      if (guardianPct < 0) guardianPct = 0;
      if (guardianPct > 100) guardianPct = 100;
    }
    return {
      words,
      readMinutes,
      tagCount: Array.isArray(preview.tags) ? preview.tags.length : 0,
      keyPoints: Array.isArray(preview.key_points) ? preview.key_points.length : 0,
      language,
      guardianPct,
    };
  }, [preview]);

  /* Local file preview.
   *   - PDFs render as an object URL inside an <iframe>.
   *   - Text files (.txt/.md) get the first ~4kB inlined as a code block
   *     so the user can sanity-check the contents before running the
   *     7-agent pipeline.
   * Also auto-scrolls the Run-Pipeline button into view, since users
   * kept missing it below the fold (especially on shorter laptops). */
  useEffect(() => {
    if (!pdfFile) {
      if (pdfObjectUrl) URL.revokeObjectURL(pdfObjectUrl);
      setPdfObjectUrl('');
      setTextPreview('');
      return;
    }
    // Clear stale preview from the previous file BEFORE the async read
    // so the user never sees File-A's content under File-B's filename.
    setTextPreview('');
    const isPdf = /\.pdf$/i.test(pdfFile.name);
    if (isPdf) {
      const u = URL.createObjectURL(pdfFile);
      setPdfObjectUrl(u);
      // Bring the Run button into view on the next paint
      requestAnimationFrame(() => {
        runButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      return () => URL.revokeObjectURL(u);
    }
    // Text file → read first 4kB for the inline preview.
    // `cancelled` flag + reader.abort() in the cleanup prevents a stale
    // onload from a previous file landing in the new file's preview
    // (race when the user picks two files in quick succession).
    setPdfObjectUrl('');
    const reader = new FileReader();
    let cancelled = false;
    reader.onload = () => {
      if (cancelled) return;
      const txt = String(reader.result || '');
      setTextPreview(txt.slice(0, 4000));
      requestAnimationFrame(() => {
        runButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    };
    reader.onerror = () => {
      if (cancelled) return;
      setTextPreview('');
      showToast('Could not read file', 'error');
    };
    reader.readAsText(pdfFile.slice(0, 4000));
    return () => {
      cancelled = true;
      try { reader.abort(); } catch { /* readyState already DONE — no-op */ }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfFile]);

  /* Live previews for URL inputs */
  const ytId = useMemo(() => (source === 'youtube' ? getYouTubeId(input) : null), [source, input]);
  const urlHost = useMemo(() => (source === 'web' && input.startsWith('http') ? safeHostname(input) : null), [source, input]);

  const currentSource = SOURCES.find(s => s.id === source)!;

  /* Auto-detect source from URL */
  const handleInputChange = (val: string) => {
    setInput(val);
    if (val.includes('youtube.com') || val.includes('youtu.be')) setSource('youtube');
    else if (val.includes('twitter.com') || val.includes('x.com'))  setSource('twitter');
    else if (val.startsWith('http') && source === 'note')            setSource('web');
  };

  /* Paste from clipboard */
  const pasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setInput(text);
      handleInputChange(text);
    } catch { showToast('Clipboard access denied'); }
  };

  /* Animate agents sequentially */
  const runAgentPipeline = async (totalMs = 3200) => {
    const stepMs = totalMs / AGENTS.length;
    for (let i = 0; i < AGENTS.length; i++) {
      const a = AGENTS[i];
      setAgentState(s => ({ ...s, [a.id]: 'active' }));
      setActiveAgentDesc(a.desc);
      await new Promise(r => setTimeout(r, stepMs));
      setAgentState(s => ({ ...s, [a.id]: 'done' }));
    }
    setActiveAgentDesc('');
  };

  /* Capture handler */
  const handleCapture = async () => {
    if (source === 'pdf' && pdfFile) {
      setIsProcessing(true);
      setAgentState({});
      const pipelinePromise = runAgentPipeline(2800);
      try {
        const formData = new FormData();
        formData.append('file', pdfFile);
        const res = await fetch('/capture/upload?preview=true', { method: 'POST', body: formData });
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try { const j = await res.json(); detail = j.error || j.detail || detail; } catch {}
          throw new Error(detail);
        }
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        if (!data.title || data.title === 'PDF Document') {
          data.title = pdfFile.name.replace(/\.(pdf|txt|md|markdown)$/i, '');
        }
        // Mark as 'pdf' for the source-type badge only when the original
        // file was a PDF — text files are saved as 'note' on the backend
        // and we don't want to mislabel the badge.
        if (/\.pdf$/i.test(pdfFile.name)) data.source_type = 'pdf';
        await pipelinePromise;
        setEnrichState({});
        setCaptureEpoch(n => n + 1);
        setPreview(data);
        // Warm the 60 s suggestions cache so re-opening the EnrichPanel
        // (or hitting Re-analyze on the saved memory page within a
        // minute) repaints chips instantly without re-fetching.
        if (data?.id) {
          setCachedSuggestions(data.id, {
            suggested_folder_hint: data.suggested_folder_hint,
            suggested_tasks:       data.suggested_tasks,
            suggested_event:       data.suggested_event ?? null,
            suggested_habit_link:  data.suggested_habit_link ?? null,
            suggested_revisit:     data.suggested_revisit ?? null,
          });
        }
      } catch (err: any) {
        await pipelinePromise.catch(() => {});
        AGENTS.forEach(a => setAgentState(s => ({ ...s, [a.id]: s[a.id] === 'active' ? 'error' : s[a.id] })));
        showToast(err.message || 'Failed to process PDF.');
      } finally { setIsProcessing(false); }
      return;
    }

    const content = source === 'voice' ? voice.transcript : input;
    if (!content.trim()) return;

    setIsProcessing(true);
    setAgentState({});
    const pipelinePromise = runAgentPipeline(3200);

    try {
      const isYoutube = source === 'youtube' || content.includes('youtube.com') || content.includes('youtu.be');
      const source_type =
        ['web', 'youtube', 'twitter'].includes(source) ? (isYoutube ? 'youtube' : 'web') : 'note';

      const res = await fetch('/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_type,
          url: ['web', 'youtube', 'twitter'].includes(source) ? content : '',
          content: ['note', 'code', 'voice', 'clipboard'].includes(source) ? content : '',
          preview: true,
        }),
      });
      if (res.status === 401) throw new Error('Unauthorized — check API config.');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.source_url && ['web', 'youtube', 'twitter'].includes(source)) data.source_url = content;

      await pipelinePromise;
      setPreviewUrl(['web', 'youtube', 'twitter'].includes(source) ? content : '');
      setEnrichState({});
      setCaptureEpoch(n => n + 1);
      setPreview(data);
      // Warm the suggestions cache (see PDF branch above for rationale).
      if (data?.id) {
        setCachedSuggestions(data.id, {
          suggested_folder_hint: data.suggested_folder_hint,
          suggested_tasks:       data.suggested_tasks,
          suggested_event:       data.suggested_event ?? null,
          suggested_habit_link:  data.suggested_habit_link ?? null,
          suggested_revisit:     data.suggested_revisit ?? null,
        });
      }
    } catch (err: any) {
      await pipelinePromise;
      showToast(err.message || 'Capture failed.');
    } finally { setIsProcessing(false); }
  };

  const handleSave = async () => {
    if (!preview) return;
    setIsProcessing(true);
    try {
      // If the user chose "Save anyway" on the duplicate banner, strip the
      // duplicate_of hint and pass force_new=true so the backend skips its
      // own dedup short-circuit and creates a fresh memory.
      const { duplicate_of, ...rest } = preview;
      void duplicate_of;
      const memoryBody: Partial<Memory> = dupOverride
        ? { ...rest, force_new: true }
        : preview;

      // Translate the EnrichPanel chip selections into the bundle
      // payload shape the backend expects. Empty / null fields are
      // omitted so the server treats the call as a plain memory save.
      // section_id: 'notes' is the default destination section every
      // workspace folder ships with — captures land there until we
      // expose a per-folder section picker (P1C).
      const folderRef = enrichState.folder?.kind === 'existing'
        ? {
            project_id: enrichState.folder.project_id,
            folder_id: enrichState.folder.folder_id,
            section_id: 'notes',
          }
        : null;
      const tasks = (enrichState.tasks || []).filter(t => t.title.trim());
      const ev = enrichState.calendar;
      const event = ev && ev.title.trim() && ev.date && ev.time ? ev : null;
      const revisit = enrichState.revisit?.frequency
        ? {
            frequency: enrichState.revisit.frequency,
            // Omit specific_date when blank so the backend applies its
            // frequency-default cadence instead of receiving an empty string.
            ...(enrichState.revisit.next_due
              ? { specific_date: enrichState.revisit.next_due }
              : {}),
          }
        : null;
      const habitLink = enrichState.habit?.habit_id
        ? { habit_id: enrichState.habit.habit_id }
        : null;
      const linkedMemoryIds = enrichState.related || [];

      const payload: CaptureBundlePayload = {
        memory: memoryBody,
        folder_ref: folderRef,
        tasks: tasks.length ? tasks : undefined,
        event: event ? {
          title: event.title,
          date: event.date,
          time: event.time,
          duration_minutes: event.duration_minutes,
        } : null,
        revisit,
        habit_link: habitLink,
        linked_memory_ids: linkedMemoryIds.length ? linkedMemoryIds : undefined,
      };

      // Clear override regardless of outcome — it only applies to one save.
      setDupOverride(false);

      const result = await saveCaptureBundle(payload);
      const saved = result.memory;
      const memId = result.memory_id || saved?.id || '';
      const isDup = !!(saved as any)?.duplicate;

      setPreview(null);
      setInput('');
      setPdfFile(null);
      voice.setTranscript('');
      setAgentState({});
      setEnrichState({});

      // Build a one-line summary of what got created for the toast.
      // Counts >0 are joined into a friendly trailer with deep links.
      const taskN  = result.created_task_ids.length;
      const evN    = result.created_event_ids.length;
      const revN   = result.created_revisit_ids.length;
      const folderName = enrichState.folder?.kind === 'existing'
        ? enrichState.folder.folder_name
        : '';
      const parts: string[] = [];
      if (taskN > 0)  parts.push(`${taskN} task${taskN === 1 ? '' : 's'}`);
      if (evN > 0)    parts.push(`${evN} event${evN === 1 ? '' : 's'}`);
      if (revN > 0)   parts.push(`${revN} revisit`);
      if (folderName) parts.push(`linked to ${folderName}`);
      const tail = parts.length ? ` + ${parts.join(' + ')}` : '';

      if (isDup) {
        showToast('Already in your Vault — opened existing entry');
      } else if (parts.length === 0) {
        showToast('Saved to Vault!');
      } else {
        // Pick a single deep link target for the toast action — tasks
        // win, then calendar, then workspace. Users can re-open the
        // page from the navbar if they need a different one.
        const navTo = taskN > 0
          ? '/library?tab=tasks'
          : evN > 0
            ? '/calendar'
            : folderName
              ? '/workspace'
              : '';
        showToast(`Saved${tail}`, 'success', navTo
          ? { label: 'Open', onClick: () => { window.location.href = navTo; } }
          : undefined);
      }

      // P4B — AI auto-folder placement: when the W4 layer silently filed
      // this memory into an existing folder (no user-picked folder, AI
      // confidence > 0.7), surface an "AI filed → Undo" toast so the
      // action is reversible. Only fires when the user did NOT pick a
      // folder themselves (folderName empty) — otherwise the placement
      // was explicit and there's nothing to undo.
      const autoFiled = (result as any).auto_filed as
        | { folder_id: string; folder_name: string; project_id: string; score: number; hint: string }
        | null
        | undefined;
      if (autoFiled && autoFiled.folder_id && memId && !folderName && !isDup) {
        const undoFile = async () => {
          try {
            const { setMemoryFolder } = await import('../lib/api');
            await setMemoryFolder(memId, null);
            showToast(`Removed from ${autoFiled.folder_name}`, 'info');
          } catch (e: any) {
            showToast(`Couldn't undo: ${e?.message || e}`, 'error');
          }
        };
        showToast(
          `AI filed this in ${autoFiled.folder_name}`,
          'info',
          { label: 'Undo', onClick: undoFile, testId: 'capture-autofiled-undo' },
        );
      }

      // Surface partial-success errors gently — the memory still saved,
      // but one or more side-effects failed and we owe the user a heads up.
      if (result.errors && result.errors.length > 0) {
        showToast(`Saved, but ${result.errors.length} link${result.errors.length === 1 ? '' : 's'} failed`, 'info');
      }

      if (memId) {
        setJustSavedId(memId);
        setJustSaved({
          id: memId,
          title: saved?.title || preview?.title || 'Captured item',
          url: saved?.source_url || preview?.source_url || '',
        });
        setShowRevisit(true);
        setTimeout(() => setJustSavedId(prev => prev === memId ? null : prev), 15000);
      }
      // Skip auto-tag for duplicates (entry already tagged)
      if (memId && !isDup) {
        fetch(`/memories/${memId}/auto-tag`, { method: 'POST' })
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            const added: string[] = Array.isArray(d?.added) ? d.added : [];
            if (added.length > 0) {
              showToast(`AI added: ${added.slice(0, 3).map(t => `#${t}`).join(' ')}`);
            }
          })
          .catch(() => {});
      }
    } catch (e) {
      console.error(e);
      showToast(`Failed to save: ${e instanceof Error ? e.message : 'unknown error'}`, 'error');
    }
    finally { setIsProcessing(false); }
  };

  const inputLabel = {
    web: 'Web article URL', youtube: 'YouTube URL', twitter: 'Tweet or thread URL',
    note: 'Thoughts, ideas, or meeting notes', code: 'Code snippet',
    clipboard: 'Pasted content', voice: 'Voice transcript',
  }[source] || 'Content';

  const inputPlaceholder = {
    web: 'https://example.com/article...',
    youtube: 'https://youtube.com/watch?v=...',
    twitter: 'https://twitter.com/user/status/...',
    note: 'Type or paste anything — meeting notes, ideas, research snippets...',
    code: '// Paste your code snippet here...',
    clipboard: 'Click "Paste" or type content...',
    voice: 'Press the mic button to start recording...',
  }[source] || '';

  const isUrl = ['web', 'youtube', 'twitter'].includes(source);
  const isMultiline = ['note', 'code', 'clipboard', 'voice'].includes(source);
  const canSubmit = source === 'pdf'
    ? !!pdfFile
    : source === 'voice'
    ? !!voice.transcript.trim()
    : !!input.trim();

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Just-saved pill (jump into timeline) ───────────────── */}
      <AnimatePresence>
        {justSavedId && (
          <motion.div
            key={justSavedId}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
              background: 'linear-gradient(90deg, rgba(167,139,250,0.10), rgba(244,114,182,0.10))',
              border: '1px solid rgba(167,139,250,0.35)', borderRadius: 10,
            }}>
            <CheckCircle2 size={15} color="#10b981" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)' }}>Saved to your Vault.</span>
            <span style={{ flex: 1 }} />
            <button onClick={() => navigate(`/memory/${justSavedId}`)}
              style={{ padding: '5px 11px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Eye size={11} /> Open
            </button>
            <button onClick={() => navigate('/timeline')}
              style={{ padding: '5px 11px', background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <GitBranch size={11} /> View Timeline
            </button>
            <button onClick={() => setJustSavedId(null)}
              style={{ padding: 4, background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
              title="Dismiss">
              <X size={13} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Inline Revisit Scheduler — shown right after a save ───── */}
      <AnimatePresence>
        {showRevisit && justSaved && (
          <RevisitScheduler
            key={justSaved.id}
            defaultTitle={justSaved.title}
            defaultUrl={justSaved.url}
            memoryId={justSaved.id}
            hintText={`${justSaved.title} ${justSaved.url}`}
            onCreated={() => { setShowRevisit(false); setJustSaved(null); }}
            onCancel={() => { setShowRevisit(false); setJustSaved(null); }}
          />
        )}
      </AnimatePresence>

      {/* ── Header ─────────────────────────────────────────────── */}
      {!embedded && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          style={{ textAlign: 'center', paddingTop: 4 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 14px',
            background: 'var(--primary-bg)', border: '1px solid var(--primary-border)', borderRadius: 999, marginBottom: 10 }}>
            <Zap size={11} color="var(--primary)" />
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', letterSpacing: '0.5px' }}>
              7-AGENT CAPTURE ENGINE
            </span>
          </div>
          <h2 style={{ fontSize: 'clamp(20px,3.5vw,28px)', fontWeight: 900, color: 'var(--text-1)',
            margin: '0 0 6px', fontFamily: "'Alegreya Sans SC',system-ui" }}>
            Smart Capture
          </h2>
          <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>
            8 input modes · 7 AI agents · Full pipeline visibility
          </p>
        </motion.div>
      )}

      {/* ── Time Capture: bundle the last N hours into one workspace ──── */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="view-card"
        style={{
          padding: '14px 16px',
          background: 'linear-gradient(135deg, rgba(34,211,238,0.06) 0%, rgba(168,85,247,0.06) 100%)',
          border: '1px solid var(--primary-border)',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'rgba(34,211,238,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Clock size={18} color="#22d3ee" />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-1)', lineHeight: 1.2 }}>
              Capture my recent activity
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>
              Bundle scattered captures into one AI-organized workspace · skips already-bundled items
            </div>
          </div>
          <div style={{
            display: 'flex', gap: 8, flexWrap: 'wrap',
            // Hard-disable the entire button group at the DOM level when a bundle
            // is in flight — pointer-events:none beats React's async state updates
            // and stops rapid double-clicks before JS event handlers even fire.
            pointerEvents: bundling !== null ? 'none' : 'auto',
          }} aria-busy={bundling !== null}>
            {[{ h: 6, label: 'Last 6 hours' }, { h: 24, label: 'Full day (24h)' }].map(opt => (
              <button key={opt.h}
                type="button"
                onClick={() => runTimeBundle(opt.h)}
                disabled={bundling !== null}
                aria-disabled={bundling !== null}
                style={{
                  padding: '8px 14px', fontSize: 12, fontWeight: 700,
                  borderRadius: 999,
                  border: '1px solid var(--primary-border)',
                  background: bundling === opt.h ? 'var(--primary)' : 'var(--surface-2)',
                  color: bundling === opt.h ? '#fff' : 'var(--text-1)',
                  cursor: bundling !== null ? 'wait' : 'pointer',
                  opacity: bundling !== null && bundling !== opt.h ? 0.55 : 1,
                  display: 'flex', alignItems: 'center', gap: 6,
                  transition: 'all 0.15s',
                }}>
                {bundling === opt.h ? <Loader2 size={12} className="spin" /> : <Sparkles size={12} />}
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <AnimatePresence>
          {bundleResult && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              style={{ overflow: 'hidden' }}>
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                {bundleResult.ok ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {/* Title + counters */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                      <FolderOpen size={16} color="var(--primary)" style={{ marginTop: 2, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text-1)', lineHeight: 1.3 }}>
                          {bundleResult.project?.name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                          {bundleResult.stats?.captured} captures · {bundleResult.stats?.folders} folders
                          {bundleResult.stats?.skipped_already_bundled > 0 && ` · ${bundleResult.stats.skipped_already_bundled} skipped (dedup)`}
                        </div>
                      </div>
                      <a href="/workspace"
                        style={{
                          padding: '6px 12px', fontSize: 11, fontWeight: 700, borderRadius: 8,
                          background: 'var(--primary)', color: '#fff', textDecoration: 'none',
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                        }}>
                        Open <ArrowRight size={11} />
                      </a>
                    </div>

                    {/* Summary */}
                    {bundleResult.summary && (
                      <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
                        {bundleResult.summary}
                      </div>
                    )}

                    {/* Folders */}
                    {bundleResult.project?.folders?.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {bundleResult.project.folders.map((f: any) => (
                          <span key={f.id} style={{
                            padding: '3px 9px', fontSize: 10.5, fontWeight: 700,
                            background: 'var(--surface-2)', border: '1px solid var(--border)',
                            borderRadius: 999, color: 'var(--text-2)',
                          }}>
                            {f.name}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Key learnings */}
                    {bundleResult.key_learnings?.length > 0 && (
                      <div>
                        <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text-3)', letterSpacing: '0.5px', marginBottom: 4 }}>
                          KEY LEARNINGS
                        </div>
                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55 }}>
                          {bundleResult.key_learnings.slice(0, 5).map((l: string, i: number) => (
                            <li key={i}>{l}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Highlights */}
                    {bundleResult.highlights?.length > 0 && (
                      <div>
                        <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text-3)', letterSpacing: '0.5px', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Star size={10} /> HIGHLIGHTS
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {bundleResult.highlights.map((h: any, i: number) => (
                            <div key={i} style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.4 }}>
                              <span style={{ fontWeight: 700, color: 'var(--text-1)' }}>{h.title}</span>
                              {h.why && <span style={{ color: 'var(--text-3)' }}> — {h.why}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: 'var(--text-3)' }}>
                    <AlertCircle size={14} color="var(--text-3)" />
                    <span>{bundleResult.message || 'Nothing to bundle right now.'}</span>
                    <button onClick={() => setBundleResult(null)} style={{
                      marginLeft: 'auto', padding: '4px 8px', fontSize: 11, background: 'transparent',
                      border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-3)', cursor: 'pointer',
                    }}>Dismiss</button>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ── Capture Session: tray of mixed inputs → ONE workspace folder ── */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="view-card"
        style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'rgba(168,85,247,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Layers size={18} color="#a855f7" />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-1)', lineHeight: 1.2 }}>
              Capture Session — multi-source bundle
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>
              Add notes, links, voice, images — commit them all into one folder
            </div>
          </div>
          <button type="button" onClick={() => setSessionMode(v => !v)}
            style={{
              padding: '7px 14px', fontSize: 12, fontWeight: 700, borderRadius: 999,
              border: '1px solid var(--primary-border)',
              background: sessionMode ? 'var(--primary)' : 'var(--surface-2)',
              color: sessionMode ? '#fff' : 'var(--text-1)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            }}>
            {sessionMode ? 'Session ON' : 'Start session'}
          </button>
        </div>

        <AnimatePresence>
          {sessionMode && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              style={{ overflow: 'hidden' }}>
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>

                {/* ── Add-item area (kind picker + draft input) ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {(['note', 'link', 'voice', 'image'] as const).map(k => {
                      const Icon = k === 'note' ? StickyNote : k === 'link' ? Link2 : k === 'voice' ? Mic : FileDigit;
                      return (
                        <button key={k} type="button" onClick={() => setSessionDraftKind(k)}
                          style={{
                            padding: '6px 12px', fontSize: 11.5, fontWeight: 700, borderRadius: 8,
                            border: '1px solid var(--border)',
                            background: sessionDraftKind === k ? 'var(--primary-bg)' : 'var(--surface-2)',
                            color: sessionDraftKind === k ? 'var(--primary)' : 'var(--text-2)',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                          }}>
                          <Icon size={11} /> {k}
                        </button>
                      );
                    })}
                  </div>

                  {(sessionDraftKind === 'note' || sessionDraftKind === 'link') && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input type="text"
                        value={sessionDraftText}
                        onChange={e => setSessionDraftText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitDraftItem(); } }}
                        placeholder={sessionDraftKind === 'note' ? 'Type a note and press Enter…' : 'Paste a URL and press Enter…'}
                        style={{
                          flex: 1, padding: '8px 12px', fontSize: 13, borderRadius: 8,
                          border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)',
                        }} />
                      <button type="button" onClick={commitDraftItem}
                        style={{
                          padding: '8px 14px', fontSize: 12, fontWeight: 700, borderRadius: 8,
                          border: 'none', background: 'var(--primary)', color: '#fff', cursor: 'pointer',
                        }}>Add</button>
                    </div>
                  )}

                  {sessionDraftKind === 'voice' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        {!sessionVoice.recording ? (
                          <button type="button" onClick={sessionVoice.start} disabled={sessionVoice.transcribing}
                            style={{ padding: '8px 14px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: 'none',
                              background: '#10b981', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Mic size={12} /> Record
                          </button>
                        ) : (
                          <button type="button" onClick={sessionVoice.stop}
                            style={{ padding: '8px 14px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: 'none',
                              background: '#ef4444', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <MicOff size={12} /> Stop
                          </button>
                        )}
                        {sessionVoice.transcribing && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Transcribing…</span>}
                        {sessionVoice.transcript && !sessionVoice.transcribing && (
                          <button type="button" onClick={commitVoiceToSession}
                            style={{ padding: '6px 12px', fontSize: 11.5, fontWeight: 700, borderRadius: 8,
                              border: '1px solid var(--primary-border)', background: 'var(--primary-bg)', color: 'var(--primary)', cursor: 'pointer' }}>
                            Add transcript to session
                          </button>
                        )}
                      </div>
                      {sessionVoice.transcript && !sessionVoice.transcribing && (
                        <div style={{ fontSize: 12, color: 'var(--text-2)', padding: 10, background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border)', maxHeight: 100, overflowY: 'auto' }}>
                          {sessionVoice.transcript}
                        </div>
                      )}
                    </div>
                  )}

                  {sessionDraftKind === 'image' && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input ref={sessionImageInputRef} type="file" accept="image/*"
                        onChange={e => { handleSessionImagePick(e.target.files?.[0] || null); if (e.target) e.target.value = ''; }}
                        style={{ display: 'none' }} />
                      <button type="button" onClick={() => sessionImageInputRef.current?.click()}
                        style={{ padding: '8px 14px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: '1px solid var(--border)',
                          background: 'var(--surface-2)', color: 'var(--text-1)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Upload size={12} /> Pick image (max 2MB)
                      </button>
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Stored in session as captioned data URL</span>
                    </div>
                  )}
                </div>

                {/* ── Tray of staged items ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text-3)', letterSpacing: '0.5px' }}>
                    SESSION TRAY · {sessionItems.length} item{sessionItems.length === 1 ? '' : 's'}
                  </div>
                  {sessionItems.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic', padding: '8px 0' }}>
                      Nothing added yet — pick a kind above and add your first item.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 280, overflowY: 'auto' }}>
                      {sessionItems.map((it, idx) => {
                        const Icon = it.kind === 'note' ? StickyNote : it.kind === 'link' ? Link2 : it.kind === 'voice' ? Mic : FileDigit;
                        const isFirst = idx === 0;
                        const isLast = idx === sessionItems.length - 1;
                        const isEditing = editingItemId === it.id;
                        // All four item kinds (note / link / voice / image) expose an
                        // editable text field — keep this explicit in case we later
                        // add a kind that should be read-only.
                        const editable = true;
                        return (
                          <div key={it.id} style={{
                            display: 'flex', alignItems: isEditing ? 'flex-start' : 'center', gap: 8, padding: '6px 10px',
                            background: isEditing ? 'var(--primary-bg)' : 'var(--surface-2)',
                            border: '1px solid ' + (isEditing ? 'var(--primary-border)' : 'var(--border)'),
                            borderRadius: 8,
                          }}>
                            {/* Reorder controls */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                              <button type="button" onClick={() => moveSessionItem(it.id, -1)} disabled={isFirst} aria-label="Move up"
                                style={{ padding: 1, background: 'transparent', border: 'none', cursor: isFirst ? 'not-allowed' : 'pointer', opacity: isFirst ? 0.3 : 1, color: 'var(--text-3)', display: 'inline-flex' }}>
                                <ChevronUp size={11} />
                              </button>
                              <button type="button" onClick={() => moveSessionItem(it.id, 1)} disabled={isLast} aria-label="Move down"
                                style={{ padding: 1, background: 'transparent', border: 'none', cursor: isLast ? 'not-allowed' : 'pointer', opacity: isLast ? 0.3 : 1, color: 'var(--text-3)', display: 'inline-flex' }}>
                                <ChevronDown size={11} />
                              </button>
                            </div>

                            <Icon size={12} color="var(--text-3)" />
                            <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.4px', flexShrink: 0 }}>{it.kind}</span>

                            {/* Inline label or editor */}
                            {isEditing ? (
                              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                                {it.kind === 'note' || it.kind === 'voice' ? (
                                  <AutoGrowTextarea value={editingDraft} onChange={e => setEditingDraft(e.target.value)} rows={3}
                                    maxHeight={300}
                                    style={{ width: '100%', padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-1)', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                                ) : (
                                  <input type={it.kind === 'link' ? 'url' : 'text'} value={editingDraft} onChange={e => setEditingDraft(e.target.value)}
                                    style={{ width: '100%', padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-1)', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                                )}
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button type="button" onClick={saveEditItem}
                                    style={{ padding: '4px 10px', fontSize: 10.5, fontWeight: 700, borderRadius: 6, border: 'none', background: 'var(--primary)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
                                    Save
                                  </button>
                                  <button type="button" onClick={cancelEditItem}
                                    style={{ padding: '4px 10px', fontSize: 10.5, fontWeight: 700, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', fontFamily: 'inherit' }}>
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <span style={{ flex: 1, fontSize: 12, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {sessionItemLabel(it)}
                              </span>
                            )}

                            {/* OCR pip (image kind only) — surfaces the
                                background "Reading text…" round-trip and the
                                resulting word count once it returns. */}
                            {!isEditing && it.kind === 'image' && it.ocr_status && (() => {
                              const tone = it.ocr_status === 'reading'
                                ? { color: 'var(--primary)', bg: 'var(--primary-bg)', border: 'var(--primary-border)' }
                                : it.ocr_status === 'done'
                                ? { color: '#10b981', bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.30)' }
                                : it.ocr_status === 'empty'
                                ? { color: 'var(--text-3)', bg: 'var(--surface)', border: 'var(--border)' }
                                : { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.30)' };
                              const wordCount = (it.ocr_text || '').trim().split(/\s+/).filter(Boolean).length;
                              const label = it.ocr_status === 'reading' ? 'Reading text…'
                                : it.ocr_status === 'done' ? `Text · ${wordCount}w`
                                : it.ocr_status === 'empty' ? 'No text'
                                : 'OCR retry';
                              const title = it.ocr_status === 'done' && it.ocr_text
                                ? it.ocr_text.slice(0, 400)
                                : it.ocr_status === 'reading'
                                ? 'Vision OCR is extracting text from this image.'
                                : it.ocr_status === 'empty'
                                ? 'Vision OCR found no readable text in this image.'
                                : 'OCR failed. The backend will retry when the session is committed.';
                              return (
                                <span title={title}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
                                    color: tone.color, background: tone.bg, border: `1px solid ${tone.border}`, flexShrink: 0 }}>
                                  {it.ocr_status === 'reading' && <Loader2 size={9} className="spin" />}
                                  {label}
                                </span>
                              );
                            })()}

                            {/* Action buttons (hidden while editing) */}
                            {!isEditing && editable && (
                              <button type="button" onClick={() => startEditItem(it)}
                                aria-label="Edit item"
                                style={{ padding: 4, background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer' }}>
                                <Pencil size={11} />
                              </button>
                            )}
                            {!isEditing && (
                              <button type="button" onClick={() => removeSessionItem(it.id)}
                                aria-label="Remove item"
                                style={{ padding: 4, background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer' }}>
                                <X size={12} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* ── AI bundle overview (≥2 items) ─────────────────────────── */}
                {sessionItems.length >= 2 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <button type="button" onClick={fetchBundlePreview} disabled={bundleLoading}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', fontSize: 11.5, fontWeight: 700, borderRadius: 8, border: '1px solid var(--primary-border)', background: bundleLoading ? 'var(--surface-2)' : 'var(--primary-bg)', color: 'var(--primary)', cursor: bundleLoading ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                        {bundleLoading ? <Loader2 size={12} className="spin" /> : <Wand2 size={12} />}
                        {bundleLoading ? 'Thinking…' : 'Get AI overview + folder ideas'}
                      </button>
                      {bundlePreview && (
                        <button type="button" onClick={() => setBundlePreview(null)}
                          style={{ padding: '5px 8px', fontSize: 10.5, fontWeight: 700, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', fontFamily: 'inherit' }}>
                          Hide
                        </button>
                      )}
                    </div>
                    {bundlePreview && (
                      <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                        style={{ padding: 12, background: 'var(--primary-bg)', border: '1px solid var(--primary-border)', borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {bundlePreview.summary && (
                          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-1)', lineHeight: 1.5 }}>
                            {bundlePreview.summary}
                          </p>
                        )}
                        {bundlePreview.folder_names.length > 0 && (
                          <div>
                            <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text-3)', letterSpacing: '0.5px', marginBottom: 6 }}>
                              SUGGESTED FOLDER NAMES (CLICK TO USE)
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {bundlePreview.folder_names.map((name, i) => (
                                <button key={i} type="button" onClick={() => applyBundleFolder(name)}
                                  style={{ padding: '6px 10px', fontSize: 11.5, fontWeight: 700, borderRadius: 8, border: '1px solid var(--primary-border)', background: 'var(--surface)', color: 'var(--text-1)', cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                  <FolderOpen size={11} /> {name}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </div>
                )}

                {/* ── Folder picker (auto / create / existing) ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text-3)', letterSpacing: '0.5px' }}>
                    DESTINATION FOLDER
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {([
                      { id: 'auto',     label: 'AI auto-folder', hint: 'AI names a new folder from your captures' },
                      { id: 'create',   label: 'New folder',     hint: 'Pick a name yourself' },
                      { id: 'existing', label: 'Existing…',      hint: 'Add into a workspace you already have' },
                    ] as const).map(opt => (
                      <button key={opt.id} type="button" onClick={() => setSessionFolderMode(opt.id)}
                        title={opt.hint}
                        style={{
                          padding: '6px 12px', fontSize: 11.5, fontWeight: 700, borderRadius: 8,
                          border: '1px solid var(--border)',
                          background: sessionFolderMode === opt.id ? 'var(--primary-bg)' : 'var(--surface-2)',
                          color: sessionFolderMode === opt.id ? 'var(--primary)' : 'var(--text-2)',
                          cursor: 'pointer',
                        }}>
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {sessionFolderMode === 'auto' && (
                    <>
                      <input type="text" value={sessionHint}
                        onChange={e => setSessionHint(e.target.value)}
                        placeholder="Optional hint to steer the AI naming (e.g. 'morning research')"
                        style={{ marginTop: 4, padding: '7px 10px', fontSize: 12, borderRadius: 6,
                          border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)' }} />
                      {/* 3 AI-suggested folder names — pick one now or rename later from the saved folder */}
                      {sessionItems.length >= 2 && (
                        <div style={{ marginTop: 6, padding: '8px 10px', background: 'var(--surface-2)', border: '1px dashed var(--border)', borderRadius: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                            <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text-3)', letterSpacing: '0.5px' }}>
                              SUGGESTED FOLDER NAMES
                            </div>
                            <button type="button" onClick={fetchBundlePreview} disabled={bundleLoading}
                              title="Ask the AI for 3 folder name options"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 10.5, fontWeight: 700, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-2)', cursor: bundleLoading ? 'wait' : 'pointer' }}>
                              {bundleLoading ? <Loader2 size={10} className="spin" /> : <Wand2 size={10} />}
                              {bundlePreview?.folder_names?.length ? 'Refresh' : 'Suggest'}
                            </button>
                          </div>
                          {bundlePreview?.folder_names && bundlePreview.folder_names.length > 0 ? (
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {bundlePreview.folder_names.slice(0, 3).map((name, i) => (
                                <button key={i} type="button" onClick={() => applyBundleFolder(name)}
                                  style={{ padding: '5px 10px', fontSize: 11.5, fontWeight: 700, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-1)', cursor: 'pointer' }}>
                                  {name}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div style={{ fontSize: 11, color: 'var(--text-3)', fontStyle: 'italic' }}>
                              {bundleLoading ? 'Asking the AI…' : 'Click Suggest to see 3 folder name ideas. You can also rename the folder later from the workspace view.'}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {sessionFolderMode === 'create' && (
                    <input type="text" value={sessionFolderName}
                      onChange={e => setSessionFolderName(e.target.value)}
                      placeholder="New folder name (required)"
                      style={{ marginTop: 4, padding: '7px 10px', fontSize: 12, borderRadius: 6,
                        border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)' }} />
                  )}

                  {sessionFolderMode === 'existing' && (
                    <select value={sessionExistingId}
                      onChange={e => setSessionExistingId(e.target.value)}
                      style={{ marginTop: 4, padding: '7px 10px', fontSize: 12, borderRadius: 6,
                        border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)' }}>
                      <option value="">— pick a workspace —</option>
                      {sessionProjects.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* ── Submit ── */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, pointerEvents: sessionSubmitting ? 'none' : 'auto' }}
                  aria-busy={sessionSubmitting}>
                  <button type="button" onClick={() => {
                    setSessionItems([]); setSessionResult(null);
                    try { localStorage.removeItem(SESSION_LS_KEY); } catch {}
                  }}
                    disabled={sessionSubmitting || sessionItems.length === 0}
                    style={{ padding: '8px 14px', fontSize: 12, fontWeight: 700, borderRadius: 8,
                      border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)',
                      cursor: sessionItems.length === 0 ? 'not-allowed' : 'pointer', opacity: sessionItems.length === 0 ? 0.5 : 1 }}>
                    Clear tray
                  </button>
                  <button type="button" onClick={submitSession}
                    disabled={sessionSubmitting || sessionItems.length === 0}
                    aria-disabled={sessionSubmitting || sessionItems.length === 0}
                    style={{ padding: '8px 16px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: 'none',
                      background: sessionItems.length > 0 ? 'var(--primary)' : 'var(--surface-3)',
                      color: '#fff', cursor: sessionSubmitting ? 'wait' : (sessionItems.length === 0 ? 'not-allowed' : 'pointer'),
                      display: 'flex', alignItems: 'center', gap: 6 }}>
                    {sessionSubmitting ? <Loader2 size={12} className="spin" /> : <CheckCircle2 size={12} />}
                    {sessionSubmitting ? 'Committing…' : 'Finish session'}
                  </button>
                </div>

                {/* ── Result card ── */}
                <AnimatePresence>
                  {sessionResult && sessionResult.ok && (
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      style={{ marginTop: 4, padding: 12, background: 'var(--primary-bg)', border: '1px solid var(--primary-border)', borderRadius: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <FolderOpen size={14} color="var(--primary)" style={{ marginTop: 2 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-1)' }}>{sessionResult.project?.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                            {sessionResult.stats?.captured} item{sessionResult.stats?.captured === 1 ? '' : 's'} saved · folder mode: {sessionResult.stats?.folder_mode}
                          </div>
                          {sessionResult.summary && (
                            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6, lineHeight: 1.5 }}>
                              {sessionResult.summary}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                          <a href="/workspace" style={{
                            padding: '5px 10px', fontSize: 11, fontWeight: 700, borderRadius: 6,
                            background: 'var(--primary)', color: '#fff', textDecoration: 'none',
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                          }}>
                            Open folder <ArrowRight size={10} />
                          </a>
                          {sessionResult.session_id && (
                            <a href={`/session/${sessionResult.session_id}`} style={{
                              padding: '5px 10px', fontSize: 11, fontWeight: 700, borderRadius: 6,
                              background: 'transparent', color: 'var(--primary)',
                              border: '1px solid var(--primary-border)', textDecoration: 'none',
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                            }}>
                              <Layers size={10} /> View session
                            </a>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ── Duplicate-memory warning banner (URL match from /capture, OR
            content-hash match from pre-save dedup-check). Three explicit
            actions: Open existing / Save anyway / Cancel. ─────────────── */}
      {(() => {
        const dup = preview?.duplicate_of
          ? { id: preview.duplicate_of.id, title: preview.duplicate_of.title, by: 'url' }
          : preSaveDup;
        if (!dup) return null;
        if (dupOverride) return null; // user chose "save anyway"
        const reason = dup.by === 'url'
          ? 'This URL is already in your Vault.'
          : 'A very similar memory is already in your Vault.';
        return (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
            className="view-card"
            style={{ padding: '12px 16px', borderColor: '#f59e0b', background: 'color-mix(in srgb, #f59e0b 8%, var(--surface))', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <AlertCircle size={16} color="#f59e0b" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)' }}>
                {reason}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                "{dup.title}" — choose what to do below.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button onClick={() => { window.location.href = `/memory/${dup.id}`; }}
                title="Open the existing entry — your new capture will be discarded"
                style={{ padding: '6px 10px', background: '#f59e0b', border: 'none', borderRadius: 6, cursor: 'pointer', color: '#fff', fontSize: 11, fontWeight: 700, fontFamily: 'inherit' }}>
                Open existing
              </button>
              <button onClick={() => { setDupOverride(true); showToast('Will save as a new entry'); }}
                title="Save this as a new memory anyway"
                style={{ padding: '6px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-1)', fontSize: 11, fontWeight: 700, fontFamily: 'inherit' }}>
                Save anyway
              </button>
              <button onClick={() => {
                  // Cancel — drop the preview and clear any draft state so the
                  // page returns to its empty/start state.
                  setPreview(null);
                  setInput('');
                  setPreSaveDup(null);
                  setDupOverride(false);
                  showToast('Capture cancelled');
                }}
                title="Discard this capture"
                style={{ padding: '6px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-2)', fontSize: 11, fontWeight: 700, fontFamily: 'inherit' }}>
                Cancel
              </button>
            </div>
          </motion.div>
        );
      })()}

      {/* ── Resume-session banner (saved tray from previous visit) ────── */}
      <AnimatePresence>
        {sessionResume && !sessionMode && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="view-card"
            style={{ padding: '12px 16px', borderColor: 'var(--primary-border)', background: 'var(--primary-bg)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Layers size={16} color="var(--primary)" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)' }}>
                Unfinished session: {sessionResume.count} item{sessionResume.count === 1 ? '' : 's'} waiting
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-3)' }}>
                Pick up where you left off, or discard it.
              </p>
            </div>
            <button onClick={resumeSession}
              style={{ padding: '6px 12px', background: 'var(--primary)', border: 'none', borderRadius: 6, cursor: 'pointer', color: '#fff', fontSize: 11.5, fontWeight: 700, fontFamily: 'inherit', flexShrink: 0 }}>
              Resume
            </button>
            <button onClick={discardSavedSession}
              style={{ padding: '6px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-2)', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', flexShrink: 0 }}>
              Discard
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Batch URL queue dialog (paste 2+ URLs → sequential capture) ── */}
      <AnimatePresence>
        {batchQueue && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="view-card"
            style={{ padding: '14px 16px', borderColor: '#22d3ee', background: 'color-mix(in srgb, #22d3ee 6%, var(--surface))' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <Layers size={16} color="#22d3ee" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: 'var(--text-1)' }}>
                  Detected {batchQueue.length} URLs in your paste
                </p>
                <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--text-3)' }}>
                  {batchRunning
                    ? `Capturing ${batchProgress?.done || 0} of ${batchProgress?.total || batchQueue.length}…`
                    : 'Run the 7-agent pipeline on each one and save them all to your Vault.'}
                </p>
              </div>
              {!batchRunning && (
                <>
                  <button onClick={runBatchCapture}
                    style={{ padding: '7px 14px', background: '#22d3ee', border: 'none', borderRadius: 6, cursor: 'pointer', color: '#06283d', fontSize: 11.5, fontWeight: 800, fontFamily: 'inherit', flexShrink: 0 }}>
                    Capture all
                  </button>
                  <button onClick={cancelBatch}
                    style={{ padding: '7px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-2)', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', flexShrink: 0 }}>
                    Dismiss
                  </button>
                </>
              )}
              {batchRunning && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--primary)', fontWeight: 700 }}>
                  <Loader2 size={12} className="spin" /> Running…
                </span>
              )}
            </div>

            {/* Progress bar */}
            {batchProgress && batchProgress.total > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 3, overflow: 'hidden' }}>
                  <motion.div
                    animate={{ width: `${(batchProgress.done / batchProgress.total) * 100}%` }}
                    transition={{ type: 'tween', duration: 0.3 }}
                    style={{ height: '100%', background: 'linear-gradient(90deg,#22d3ee,#a855f7)' }} />
                </div>
                {batchProgress.current && batchRunning && (
                  <p style={{ margin: '6px 0 0', fontSize: 10.5, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Now: {batchProgress.current}
                  </p>
                )}
              </div>
            )}

            {/* URL list with per-item status */}
            {batchQueue.length > 0 && (
              <div style={{ marginTop: 10, maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {batchQueue.map((u, i) => {
                  const r = batchResults[i];
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }}>
                      <span style={{ width: 16, flexShrink: 0, color: 'var(--text-3)', fontWeight: 700 }}>{i + 1}.</span>
                      <span style={{ flex: 1, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u}</span>
                      {!r && batchProgress?.done === i && batchRunning && <Loader2 size={11} className="spin" color="var(--primary)" />}
                      {r?.ok && <CheckCircle2 size={12} color="#10b981" />}
                      {r?.ok && r.duplicate && <span style={{ fontSize: 9.5, fontWeight: 700, color: '#f59e0b' }}>DUP</span>}
                      {r && !r.ok && <span title={r.error} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#ef4444', fontWeight: 700 }}><AlertCircle size={11} /> Failed</span>}
                    </div>
                  );
                })}
              </div>
            )}

            {!batchRunning && batchResults.length > 0 && batchResults.length === batchQueue.length && (
              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button onClick={() => navigate('/vault')}
                  style={{ padding: '6px 12px', background: 'var(--primary)', border: 'none', borderRadius: 6, cursor: 'pointer', color: '#fff', fontSize: 11.5, fontWeight: 700, fontFamily: 'inherit' }}>
                  Open Vault
                </button>
                <button onClick={cancelBatch}
                  style={{ padding: '6px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-2)', fontSize: 11, fontWeight: 700, fontFamily: 'inherit' }}>
                  Done
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {!preview ? (
        <>
          {/* ── Source Selector Grid ────────────────────────────── */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
            className="view-card" style={{ padding: '16px 16px 12px' }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '1px',
              textTransform: 'uppercase', margin: '0 0 12px' }}>Select source</p>
            <div className="capture-source-grid">
              {SOURCES.map(s => {
                const active = source === s.id;
                return (
                  <button key={s.id} onClick={() => setSource(s.id)}
                    title={s.hint}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                      padding: '10px 6px', borderRadius: 12, border: `1.5px solid ${active ? s.color : 'var(--border)'}`,
                      background: active ? `color-mix(in srgb,${s.color} 12%,transparent)` : 'var(--surface-2)',
                      cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit',
                    }}>
                    <s.icon size={18} color={active ? s.color : 'var(--text-3)'} />
                    <span style={{ fontSize: 10.5, fontWeight: active ? 700 : 500,
                      color: active ? s.color : 'var(--text-3)', lineHeight: 1.2, textAlign: 'center' }}>
                      {s.label}
                    </span>
                  </button>
                );
              })}
              {/* P5A — From Notion chip. Hidden when not connected so we
                  never advertise a 401-bound action. Acts as an action,
                  not a source mode — clicking opens the page picker
                  immediately and on import lands the user on the
                  imported memory. */}
              {notionConnected && (
                <button
                  onClick={() => void openNotionPicker()}
                  title="Pick a page from your Notion workspace"
                  data-testid="capture-source-notion"
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    padding: '10px 6px', borderRadius: 12,
                    border: '1.5px solid rgba(255,255,255,0.15)',
                    background: 'var(--surface-2)',
                    cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit',
                  }}>
                  <FileText size={18} color="#e2e8f0" />
                  <span style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--text-3)', lineHeight: 1.2, textAlign: 'center' }}>
                    From Notion
                  </span>
                </button>
              )}
              {/* P5B — From Gmail chip. Same shown-only-when-connected
                  guard as the Notion chip above. Acts as an action,
                  not a source mode — clicking opens the message picker
                  and on import lands the user on the imported memory. */}
              {gmailConnected && (
                <button
                  onClick={() => void openGmailPicker()}
                  title="Pick an email from your Gmail inbox"
                  data-testid="capture-source-gmail"
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    padding: '10px 6px', borderRadius: 12,
                    border: '1.5px solid rgba(234,67,53,0.25)',
                    background: 'var(--surface-2)',
                    cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit',
                  }}>
                  <Mail size={18} color="#ea4335" />
                  <span style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--text-3)', lineHeight: 1.2, textAlign: 'center' }}>
                    From Gmail
                  </span>
                </button>
              )}
              {/* P5C — From Slack chip. Shown only when connected,
                  same gating as Notion/Gmail above. Opens a tiny modal
                  with one URL textbox + Import; the user pastes any
                  Slack thread URL and on import lands on the new
                  memory in the same flow as a fresh capture. */}
              {slackConnected && (
                <button
                  onClick={() => openSlackPicker()}
                  title="Paste a Slack thread URL to import"
                  data-testid="capture-source-slack"
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    padding: '10px 6px', borderRadius: 12,
                    border: '1.5px solid rgba(74,21,75,0.35)',
                    background: 'var(--surface-2)',
                    cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit',
                  }}>
                  <MessageSquare size={18} color="#a78bfa" />
                  <span style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--text-3)', lineHeight: 1.2, textAlign: 'center' }}>
                    From Slack
                  </span>
                </button>
              )}
            </div>
            {currentSource && (
              <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '10px 0 0', textAlign: 'center' }}>
                {currentSource.hint}
              </p>
            )}
          </motion.div>

          {/* ── Input Panel ─────────────────────────────────────── */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="view-card" style={{ overflow: 'hidden' }}>

            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Capture templates dropdown — quick-fill the input from a saved scaffold */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setTemplatesOpen(v => !v)}
                  aria-expanded={templatesOpen}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', fontSize: 11, fontWeight: 700, borderRadius: 8, border: '1px solid var(--border)', background: templatesOpen ? 'var(--primary-bg)' : 'var(--surface-2)', color: templatesOpen ? 'var(--primary)' : 'var(--text-2)', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <BookOpen size={11} /> Templates {templatesOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </button>
                {(isMultiline) && (
                  <button type="button" onClick={saveCurrentAsTemplate}
                    title="Save the current input as a reusable template"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', fontSize: 11, fontWeight: 700, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)', cursor: 'pointer', fontFamily: 'inherit' }}>
                    <BookmarkPlus size={11} /> Save as template
                  </button>
                )}
              </div>
              <AnimatePresence>
                {templatesOpen && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                    style={{ overflow: 'hidden' }}>
                    <div style={{ marginTop: -6, padding: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text-3)', letterSpacing: '0.5px' }}>STARTERS</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {STARTER_TEMPLATES.map(t => (
                          <button key={t.id} type="button" onClick={() => applyTemplate(t)}
                            style={{ padding: '6px 12px', fontSize: 11.5, fontWeight: 700, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-1)', cursor: 'pointer', fontFamily: 'inherit' }}>
                            {t.label}
                          </button>
                        ))}
                      </div>
                      {userTemplates.length > 0 && (
                        <>
                          <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text-3)', letterSpacing: '0.5px', marginTop: 4 }}>YOUR TEMPLATES</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {userTemplates.map(t => (
                              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 }}>
                                <button type="button" onClick={() => applyTemplate(t)}
                                  style={{ flex: 1, textAlign: 'left', padding: 0, fontSize: 11.5, fontWeight: 700, background: 'transparent', border: 'none', color: 'var(--text-1)', cursor: 'pointer', fontFamily: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {t.label}
                                </button>
                                <span style={{ fontSize: 9.5, color: 'var(--text-3)', fontWeight: 700, letterSpacing: '0.4px' }}>{t.source.toUpperCase()}</span>
                                <button type="button" onClick={() => removeUserTemplate(t.id)}
                                  aria-label={`Delete template ${t.label}`}
                                  style={{ padding: 4, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'inline-flex' }}>
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* URL input */}
              {(isUrl) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                    {inputLabel}
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Link2 size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }} />
                    <input type="url" value={input} onChange={e => handleInputChange(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleCapture()}
                      onPaste={e => {
                        const txt = e.clipboardData?.getData('text') || '';
                        if (txt && handleUrlPaste(txt)) {
                          e.preventDefault();
                        }
                      }}
                      placeholder={inputPlaceholder}
                      style={{ width: '100%', padding: '11px 14px 11px 36px', borderRadius: 11, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)', fontSize: 13.5, outline: 'none', fontFamily: 'inherit', transition: 'all 0.15s', boxSizing: 'border-box' }}
                      onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-bg)'; }}
                      onBlur={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none'; }}
                    />
                  </div>

                  {/* Live YouTube thumbnail */}
                  <AnimatePresence>
                    {ytId && (
                      <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        style={{ marginTop: 8, borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(239,68,68,0.25)', boxShadow: '0 6px 20px rgba(239,68,68,0.10)' }}>
                        <YouTubeThumbnail url={input} />
                        <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-2)', borderTop: '1px solid var(--border)' }}>
                          <Eye size={12} color="var(--text-3)" />
                          <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>Live preview · video ID</span>
                          <code style={{ fontSize: 10.5, color: 'var(--text-2)', background: 'var(--surface-3)', padding: '2px 6px', borderRadius: 4, fontFamily: "'JetBrains Mono',monospace" }}>{ytId}</code>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Live web URL preview (favicon + host) */}
                  <AnimatePresence>
                    {!ytId && urlHost && (
                      <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        style={{ marginTop: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, borderRadius: 11, border: '1px solid var(--primary-border)', background: 'var(--primary-bg)' }}>
                        <img src={faviconUrl(urlHost)} alt="" width={20} height={20} style={{ borderRadius: 4, flexShrink: 0 }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', lineHeight: 1.2 }}>{urlHost}</div>
                          <div style={{ fontSize: 10.5, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{input}</div>
                        </div>
                        <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--primary)', letterSpacing: '0.5px', padding: '2px 6px', background: 'var(--surface)', borderRadius: 4, border: '1px solid var(--primary-border)' }}>READY</span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Multiline text input */}
              {isMultiline && source !== 'voice' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                      {inputLabel}
                    </label>
                    {source === 'clipboard' && (
                      <button onClick={pasteClipboard}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: 'var(--primary)', background: 'var(--primary-bg)', border: '1px solid var(--primary-border)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontFamily: 'inherit' }}>
                        <Clipboard size={11} /> Paste
                      </button>
                    )}
                  </div>
                  <AutoGrowTextarea value={input} onChange={e => setInput(e.target.value)}
                    placeholder={inputPlaceholder} rows={source === 'code' ? 8 : 6}
                    maxHeight={420}
                    style={{ width: '100%', padding: '11px 14px', borderRadius: 11, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)', fontSize: source === 'code' ? 12.5 : 14, fontFamily: source === 'code' ? "'JetBrains Mono',monospace" : 'inherit', outline: 'none', transition: 'all 0.15s', boxSizing: 'border-box', lineHeight: 1.65 }}
                    onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-bg)'; }}
                    onBlur={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none'; }}
                  />
                  {source === 'code' && (
                    <p style={{ fontSize: 11, color: 'var(--text-3)', margin: 0 }}>
                      AI will explain the code, detect language, and extract concepts
                    </p>
                  )}
                </div>
              )}

              {/* Voice recorder */}
              {source === 'voice' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px',
                    background: voice.recording ? 'rgba(239,68,68,0.06)' : 'var(--surface-2)',
                    border: `1.5px solid ${voice.recording ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`,
                    borderRadius: 14 }}>
                    <button onClick={voice.recording ? voice.stop : voice.start}
                      style={{ width: 48, height: 48, borderRadius: '50%', border: 'none', cursor: 'pointer',
                        background: voice.recording ? '#ef4444' : 'var(--primary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        boxShadow: voice.recording ? '0 0 0 6px rgba(239,68,68,0.18)' : '0 4px 14px rgba(37,99,235,0.4)',
                        transition: 'all 0.2s', animation: voice.recording ? 'pulse 1.4s ease infinite' : 'none' }}>
                      {voice.recording ? <MicOff size={20} color="#fff" /> : <Mic size={20} color="#fff" />}
                    </button>
                    <div>
                      <p style={{ fontWeight: 700, color: voice.recording ? '#ef4444' : voice.transcribing ? 'var(--primary)' : 'var(--text-1)', margin: '0 0 2px', fontSize: 14 }}>
                        {voice.recording ? '● Recording…' : voice.transcribing ? '◌ Transcribing…' : 'Press to record'}
                      </p>
                      <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>
                        {voice.recording ? 'Click again to stop and transcribe' : voice.transcribing ? 'Converting your audio…' : 'Audio is transcribed automatically'}
                      </p>
                    </div>
                  </div>
                  {voice.transcript && (
                    <AutoGrowTextarea value={voice.transcript} onChange={e => voice.setTranscript(e.target.value)}
                      rows={5} placeholder="Transcript appears here..."
                      maxHeight={420}
                      style={{ width: '100%', padding: '11px 14px', borderRadius: 11, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)', fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
                  )}
                </div>
              )}

              {/* PDF drop zone */}
              {source === 'pdf' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {!pdfFile ? (
                    <div
                      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={e => {
                        e.preventDefault();
                        setDragOver(false);
                        const f = e.dataTransfer.files[0];
                        if (!f) return;
                        const ok = isAcceptedDoc(f);
                        if (!ok) { showToast('Please drop a PDF, .txt, or .md file', 'error'); return; }
                        if (f.size > 25 * 1024 * 1024) { showToast('File too large (max 25MB)', 'error'); return; }
                        setPdfFile(f);
                      }}
                      onClick={() => fileInputRef.current?.click()}
                      style={{ border: `2px dashed ${dragOver ? 'var(--primary)' : 'var(--border-2)'}`, borderRadius: 16, padding: '36px 24px', textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s', background: dragOver ? 'var(--primary-bg)' : 'var(--surface-2)' }}>
                      <input ref={fileInputRef} type="file"
                        accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
                        style={{ display: 'none' }}
                        onChange={e => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          if (!isAcceptedDoc(f)) { showToast('Unsupported file type. Use .pdf, .txt, or .md', 'error'); e.target.value = ''; return; }
                          if (f.size > 25 * 1024 * 1024) { showToast('File too large (max 25MB)', 'error'); e.target.value = ''; return; }
                          setPdfFile(f);
                          e.target.value = '';
                        }} />
                      <div style={{ width: 52, height: 52, background: 'var(--surface-3)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                        <Upload size={26} color="var(--text-3)" />
                      </div>
                      <p style={{ fontWeight: 700, color: 'var(--text-1)', margin: '0 0 4px' }}>Drop file or click to upload</p>
                      <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>PDF, TXT, MD · AI extracts &amp; structures all content · Max 25 MB</p>
                      <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '8px auto 0', maxWidth: 460, lineHeight: 1.5, padding: '7px 11px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.30)', borderRadius: 8 }}
                        title="Firestore caps each document at 1 MiB. PDFs are stored base64 (~33% inflation), so ~700 KB raw is the largest that fits with the rest of the metadata.">
                        <b style={{ color: '#f59e0b' }}>Heads up:</b> only PDFs <b>under ~700 KB</b> get the inline viewer on the memory page. Bigger PDFs are still parsed &amp; their text saved (so search/agents work), but the binary won&apos;t be embedded — host it on Drive/Dropbox if you want to view the original later.
                      </p>
                    </div>
                  ) : (
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                      style={{ borderRadius: 14, border: '1.5px solid #10b981', overflow: 'hidden', background: 'var(--surface-2)' }}>
                      {/* File header */}
                      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--border)', background: 'rgba(16,185,129,0.06)' }}>
                        <div style={{ width: 38, height: 38, borderRadius: 8, background: 'rgba(16,185,129,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <FileDigit size={18} color="#10b981" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontWeight: 700, color: 'var(--text-1)', margin: 0, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pdfFile.name}</p>
                          <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '2px 0 0' }}>
                            {(pdfFile.size / 1024 / 1024).toFixed(2)} MB · ready — click <b>Run Pipeline</b> below
                          </p>
                          {/.pdf$/i.test(pdfFile.name) && pdfFile.size > 700 * 1024 && (
                            <p style={{ fontSize: 10.5, color: '#f59e0b', margin: '4px 0 0', fontWeight: 600 }}
                              title="Inline-embed cap is ~700 KB raw (Firestore 1 MiB doc limit, base64 inflation). Bigger PDFs still parse and save their text.">
                                Above 700 KB — text will be saved &amp; searchable, but inline PDF viewer will be skipped.
                            </p>
                          )}
                        </div>
                        <button onClick={() => setPdfFile(null)}
                          style={{ padding: '6px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, cursor: 'pointer', color: 'var(--text-2)', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <X size={11} /> Remove
                        </button>
                      </div>
                      {/* Inline preview: PDFs render in iframe; text files show first chars */}
                      {pdfObjectUrl && /\.pdf$/i.test(pdfFile.name) && (
                        <div className="capture-pdf-frame" style={{ background: '#1a1a1a' }}>
                          <iframe src={pdfObjectUrl} title="PDF preview"
                            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }} />
                        </div>
                      )}
                      {!/\.pdf$/i.test(pdfFile.name) && (
                        <div className="capture-text-preview"
                          style={{ padding: '14px 16px', maxHeight: 240, overflow: 'auto', fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.55, background: 'var(--surface)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace' }}>
                          {textPreview || <span style={{ color: 'var(--text-3)' }}>Reading file…</span>}
                        </div>
                      )}
                    </motion.div>
                  )}
                </div>
              )}

              {/* Capture button — morphs into the live agent pipeline while running */}
              {(isProcessing || Object.keys(agentState).length > 0) ? (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                  style={{
                    width: '100%', borderRadius: 14, padding: '14px 16px 12px',
                    background: 'linear-gradient(135deg, color-mix(in srgb,var(--primary) 12%, var(--surface)) 0%, color-mix(in srgb,var(--primary) 4%, var(--surface)) 100%)',
                    border: '1.5px solid color-mix(in srgb,var(--primary) 30%, transparent)',
                    boxShadow: '0 4px 18px color-mix(in srgb,var(--primary) 12%, transparent)',
                  }}>
                  {/* Header row: title + live status / COMPLETE badge */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                    {isProcessing
                      ? <Loader2 size={14} color="var(--primary)" style={{ animation: 'spin 1s linear infinite' }} />
                      : <Layers size={14} color="var(--primary)" />}
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)', letterSpacing: '0.3px' }}>
                      {isProcessing ? '7-Agent Capture Pipeline running' : '7-Agent Capture Pipeline'}
                    </span>
                    {activeAgentDesc && (
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>— {activeAgentDesc}</span>
                    )}
                    {!isProcessing && Object.keys(agentState).length > 0 && (
                      <span style={{ fontSize: 10.5, color: 'var(--success, #16a34a)', marginLeft: 'auto', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <CheckCircle2 size={11} /> COMPLETE
                      </span>
                    )}
                  </div>
                  {/* Agents row — see .capture-pipeline-row in pages.css for
                      the mobile shrink + right-edge fade that prevents the
                      7th agent ("Guardian") from being clipped on phones. */}
                  <div className="capture-pipeline-row scroll-custom"
                    style={{ display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto', paddingBottom: 4 }}>
                    {AGENTS.map((ag, i) => {
                      const st = agentState[ag.id] || 'idle';
                      return (
                        <React.Fragment key={ag.id}>
                          <div className="capture-pipeline-step"
                            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 64, flexShrink: 0 }}>
                            <motion.div
                              animate={st === 'active' ? { scale: [1, 1.15, 1], boxShadow: [`0 0 0 0 ${ag.color}44`, `0 0 0 8px ${ag.color}22`, `0 0 0 0 ${ag.color}00`] } : {}}
                              transition={{ repeat: Infinity, duration: 1.2 }}
                              className="capture-pipeline-bubble"
                              style={{ width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${st === 'idle' ? 'var(--border)' : ag.color}`, background: st === 'idle' ? 'var(--surface-2)' : st === 'done' ? `color-mix(in srgb,${ag.color} 18%,transparent)` : `color-mix(in srgb,${ag.color} 14%,transparent)`, transition: 'all 0.3s' }}>
                              {st === 'done'
                                ? <CheckCircle2 size={16} color={ag.color} />
                                : st === 'error'
                                ? <AlertCircle size={16} color="#ef4444" />
                                : <ag.icon size={15} color={st === 'active' ? ag.color : 'var(--text-3)'} />}
                            </motion.div>
                            <span className="capture-pipeline-label"
                              style={{ fontSize: 9.5, fontWeight: st === 'active' ? 700 : 500, color: st === 'idle' ? 'var(--text-3)' : ag.color, textAlign: 'center', lineHeight: 1.2 }}>
                              {ag.label}
                            </span>
                          </div>
                          {i < AGENTS.length - 1 && (
                            <div className="capture-pipeline-connector"
                              style={{ flex: 1, height: 2, background: agentState[AGENTS[i + 1].id] && agentState[AGENTS[i + 1].id] !== 'idle' ? AGENTS[i].color : 'var(--border)', transition: 'background 0.4s', minWidth: 8 }} />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </motion.div>
              ) : (
                <div ref={runButtonRef} style={{ scrollMarginTop: 80 }}>
                  <button onClick={handleCapture} disabled={!canSubmit}
                    className="btn-premium" style={{ width: '100%', fontSize: 14.5, gap: 10 }}>
                    <Zap size={17} /> Run 7-Agent Capture Pipeline
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </>
      ) : (
        /* ── Preview Panel ───────────────────────────────────────── */
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
          className="view-card" style={{ overflow: 'hidden' }}>

          {/* Header */}
          <div style={{ background: 'linear-gradient(135deg,#060b18 0%,#0d1f3c 60%,#0c2a6e 100%)', padding: '20px 24px', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                <span style={{ padding: '3px 8px', background: 'var(--primary)', borderRadius: 5, fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>
                  ✦ 7-Agent Processed
                </span>
                <span style={{ padding: '3px 8px', background: 'rgba(255,255,255,0.12)', borderRadius: 5, fontSize: 10, fontWeight: 700 }}>{preview.domain}</span>
                <span style={{ padding: '3px 8px', background: 'rgba(255,255,255,0.12)', borderRadius: 5, fontSize: 10, fontWeight: 700 }}>{preview.source_type}</span>
              </div>
              <div className="capture-preview-title-wrap" style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <EditableText
                  value={preview.title}
                  onChange={v => updatePreviewField('title', v)}
                  placeholder="Untitled capture"
                  iconSize={13}
                  display={<h3 style={{ fontSize: 'clamp(15px,2.8vw,20px)', fontWeight: 800, margin: 0, lineHeight: 1.3, color: '#fff' }}>{preview.title}</h3>}
                  inputStyle={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}
                />
              </div>
            </div>
            <button onClick={() => { setPreview(null); setAgentState({}); }}
              style={{ padding: 8, background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%', cursor: 'pointer', color: '#fff', display: 'flex', flexShrink: 0 }}>
              <X size={16} />
            </button>
          </div>

          {/* Completed agent pipeline */}
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {AGENTS.map(ag => (
              <div key={ag.id} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', background: `color-mix(in srgb,${ag.color} 10%,transparent)`, border: `1px solid color-mix(in srgb,${ag.color} 25%,transparent)`, borderRadius: 20 }}>
                <CheckCircle2 size={10} color={ag.color} />
                <span style={{ fontSize: 10, fontWeight: 600, color: ag.color }}>{ag.label}</span>
              </div>
            ))}
          </div>

          {/* Preview metadata strip — at-a-glance signal density */}
          {previewMeta && (previewMeta.words > 0 || previewMeta.tagCount > 0 || previewMeta.keyPoints > 0 || previewMeta.language || previewMeta.guardianPct !== null) && (
            <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', background: 'var(--surface-2)' }}>
              {previewMeta.readMinutes > 0 && (
                <span title="Estimated read time at 200 wpm" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, color: 'var(--text-2)', padding: '3px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 999 }}>
                  <Clock size={11} /> {previewMeta.readMinutes} min read
                </span>
              )}
              {previewMeta.words > 0 && (
                <span title="Approximate word count of summary + key points" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, color: 'var(--text-2)', padding: '3px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 999 }}>
                  <FileDigit size={11} /> {previewMeta.words.toLocaleString()} words
                </span>
              )}
              {previewMeta.language && (
                <span title="Detected language of the captured content" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, color: 'var(--text-2)', padding: '3px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 999 }}>
                  <Globe size={11} /> {previewMeta.language}
                </span>
              )}
              {previewMeta.guardianPct !== null && (
                <span
                  title="Guardian agent confidence in this capture's quality and trustworthiness"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    fontSize: 10.5, fontWeight: 700, padding: '3px 8px',
                    background: previewMeta.guardianPct >= 80 ? 'color-mix(in srgb, #16a34a 12%, transparent)' : previewMeta.guardianPct >= 50 ? 'color-mix(in srgb, #f59e0b 12%, transparent)' : 'color-mix(in srgb, #dc2626 12%, transparent)',
                    color: previewMeta.guardianPct >= 80 ? '#16a34a' : previewMeta.guardianPct >= 50 ? '#b45309' : '#dc2626',
                    border: previewMeta.guardianPct >= 80 ? '1px solid color-mix(in srgb, #16a34a 30%, transparent)' : previewMeta.guardianPct >= 50 ? '1px solid color-mix(in srgb, #f59e0b 30%, transparent)' : '1px solid color-mix(in srgb, #dc2626 30%, transparent)',
                    borderRadius: 999,
                  }}>
                  <ShieldCheck size={11} /> Guardian {previewMeta.guardianPct}%
                </span>
              )}
              {previewMeta.keyPoints > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, color: 'var(--text-2)', padding: '3px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 999 }}>
                  <ListChecks size={11} /> {previewMeta.keyPoints} insights
                </span>
              )}
              {previewMeta.tagCount > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, color: 'var(--text-2)', padding: '3px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 999 }}>
                  <Tag size={11} /> {previewMeta.tagCount} tags
                </span>
              )}
            </div>
          )}

          {preview.source_type === 'youtube' && (previewUrl || preview.source_url) && (
            <div style={{ padding: '16px 20px 0' }}>
              <YouTubeEmbed url={previewUrl || preview.source_url!} />
            </div>
          )}

          {preview.source_type === 'pdf' && (preview.pdf_data || pdfObjectUrl) && (
            <div style={{ padding: '16px 20px 0' }}>
              {/* Use the same .capture-pdf-frame class as the upload-stage iframe so
                  this post-processing PDF preview also shrinks 540 → 360px on phones
                  instead of dominating the viewport. The class default is 420px;
                  we override desktop here to keep the existing larger 540px feel. */}
              <div className="capture-pdf-frame capture-pdf-frame-large" style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)', background: '#1a1a1a' }}>
                <iframe src={preview.pdf_data || pdfObjectUrl} title="PDF preview" style={{ width: '100%', height: '100%', border: 'none', display: 'block' }} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, margin: '10px 0 0' }}>
                <span style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <FileDigit size={11} /> {pdfFile?.name || 'Document.pdf'}
                </span>
                {preview.pdf_pages != null && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: '#10b981', padding: '2px 8px', background: 'rgba(16,185,129,0.10)', borderRadius: 999, border: '1px solid rgba(16,185,129,0.25)' }}>
                    {preview.pdf_pages} {preview.pdf_pages === 1 ? 'page' : 'pages'}
                  </span>
                )}
                {preview.pdf_size_kb != null && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-2)', padding: '2px 8px', background: 'var(--surface-2)', borderRadius: 999, border: '1px solid var(--border)' }}>
                    {preview.pdf_size_kb < 1024 ? `${Math.round(preview.pdf_size_kb)} KB` : `${(preview.pdf_size_kb / 1024).toFixed(2)} MB`}
                  </span>
                )}
                {preview.pdf_word_count != null && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-2)', padding: '2px 8px', background: 'var(--surface-2)', borderRadius: 999, border: '1px solid var(--border)' }}>
                    ~{preview.pdf_word_count.toLocaleString()} words
                  </span>
                )}
                {preview.pdf_data && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--primary)', padding: '2px 8px', background: 'var(--primary-bg)', borderRadius: 999, border: '1px solid var(--primary-border)', letterSpacing: 0.4 }}>
                    EMBEDDED IN VAULT
                  </span>
                )}
              </div>
            </div>
          )}

          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
            {preview.ai_analysis_pending && (
              <section style={{
                padding: '12px 14px',
                borderRadius: 12,
                background: 'rgba(251, 191, 36, 0.08)',
                border: '1px solid rgba(251, 191, 36, 0.32)',
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
              }}>
                <Sparkles size={16} color="#fbbf24" style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--text-1)', marginBottom: 2 }}>
                    AI analysis unavailable right now
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
                    {preview.ai_error_reason || 'AI provider temporarily unreachable.'}
                    {' '}Saved with the raw text — you can edit it inline below or click Save and re-analyze later from Vault.
                  </div>
                </div>
              </section>
            )}

            {/* W1 — Enrich & connect: AI-suggested folder, tasks, related,
                event, habit, revisit chips. State bubbles into enrichState
                and the Save handler bundles it into one /capture/save-bundle
                call. The `key` forces a fresh mount whenever a new preview
                arrives so chip state can never leak across captures. */}
            <EnrichPanel
              key={`enrich-${captureEpoch}`}
              preview={preview}
              onChange={setEnrichState}
            />

            {preview.executive_summary && preview.executive_summary.trim() && (
              <section style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--primary-bg)', border: '1px solid var(--primary-border)' }}>
                <h4 style={{ fontWeight: 800, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 11.5, letterSpacing: 0.6, textTransform: 'uppercase' }}>
                  <Sparkles size={13} color="var(--primary)" /> Executive Summary
                </h4>
                <EditableText
                  value={preview.executive_summary}
                  onChange={v => updatePreviewField('executive_summary', v)}
                  multiline
                  placeholder="Add an executive summary…"
                  display={<p style={{ color: 'var(--text-1)', lineHeight: 1.7, fontSize: 13.5, margin: 0, fontWeight: 500 }}>{preview.executive_summary}</p>}
                />
              </section>
            )}

            <section>
              <h4 style={{ fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 13 }}>
                <Brain size={14} color="var(--primary)" /> Summary
              </h4>
              <EditableText
                value={preview.summary}
                onChange={v => updatePreviewField('summary', v)}
                multiline
                placeholder="Add a summary…"
                display={<p style={{ color: 'var(--text-2)', lineHeight: 1.75, fontSize: 13.5, margin: 0 }}>{preview.summary}</p>}
              />
            </section>

            <section>
              <h4 style={{ fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 13 }}>
                <CheckCircle2 size={14} color="#10b981" /> Key Insights
              </h4>
              <ul style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 8, padding: 0, listStyle: 'none', margin: 0 }}>
                {(Array.isArray(preview.key_points) ? preview.key_points : []).map((point, i) => (
                  <li key={i} style={{ display: 'flex', gap: 10, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 10, fontSize: 12.5, color: 'var(--text-2)', border: '1px solid var(--border)', alignItems: 'flex-start' }}>
                    <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--primary-bg)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, flexShrink: 0, border: '1px solid var(--primary-border)', marginTop: 1 }}>{i + 1}</span>
                    <EditableText
                      value={point}
                      onChange={v => updateStringListItem('key_points', i, v)}
                      multiline
                      placeholder="Edit insight…"
                    />
                    <button type="button" onClick={() => removeListItem('key_points', i)}
                      aria-label={`Remove insight ${i + 1}`}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 3, color: 'var(--text-3)', display: 'inline-flex', flexShrink: 0, borderRadius: 6, marginTop: 2 }}>
                      <Trash2 size={11} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            {preview.action_items && preview.action_items.length > 0 && (
              <section>
                <h4 style={{ fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 13 }}>
                  <Target size={14} color="#f97316" /> Action Items
                </h4>
                <ul style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 0, listStyle: 'none', margin: 0 }}>
                  {preview.action_items.map((item, i) => (
                    <li key={i} style={{ display: 'flex', gap: 10, padding: '10px 12px', background: 'rgba(249,115,22,0.06)', borderRadius: 10, fontSize: 13, color: 'var(--text-1)', border: '1px solid rgba(249,115,22,0.18)', alignItems: 'flex-start' }}>
                      <ListChecks size={14} color="#f97316" style={{ flexShrink: 0, marginTop: 3 }} />
                      <EditableText
                        value={item}
                        onChange={v => updateStringListItem('action_items', i, v)}
                        multiline
                        placeholder="Edit action item…"
                        display={<span style={{ lineHeight: 1.55 }}>{item}</span>}
                      />
                      <button type="button" onClick={() => removeListItem('action_items', i)}
                        aria-label={`Remove action item ${i + 1}`}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 3, color: 'var(--text-3)', display: 'inline-flex', flexShrink: 0, borderRadius: 6, marginTop: 2 }}>
                        <Trash2 size={11} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {preview.glossary && preview.glossary.length > 0 && (
              <section>
                <h4 style={{ fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 13 }}>
                  <BookOpen size={14} color="#a78bfa" /> Glossary
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 8 }}>
                  {preview.glossary.map((g, i) => (
                    <div key={i} style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)', position: 'relative' }}>
                      <button type="button" onClick={() => removeListItem('glossary', i)}
                        aria-label={`Remove glossary entry ${g.term}`}
                        style={{ position: 'absolute', top: 6, right: 6, background: 'transparent', border: 'none', cursor: 'pointer', padding: 3, color: 'var(--text-3)', display: 'inline-flex', borderRadius: 6 }}>
                        <Trash2 size={11} />
                      </button>
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#a78bfa', marginBottom: 3, letterSpacing: 0.2, paddingRight: 18 }}>{g.term}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>{g.definition}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {preview.study_questions && preview.study_questions.length > 0 && (
              <section>
                <h4 style={{ fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 13 }}>
                  <HelpCircle size={14} color="#22d3ee" /> Study Questions
                </h4>
                <ol style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 0, margin: 0, listStyle: 'none' }}>
                  {preview.study_questions.map((q, i) => (
                    <li key={i} style={{ display: 'flex', gap: 10, padding: '10px 12px', background: 'rgba(34,211,238,0.06)', borderRadius: 10, fontSize: 13, color: 'var(--text-1)', border: '1px solid rgba(34,211,238,0.18)', alignItems: 'flex-start' }}>
                      <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(34,211,238,0.18)', color: '#0e7490', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, flexShrink: 0, marginTop: 1 }}>Q{i + 1}</span>
                      <EditableText
                        value={q}
                        onChange={v => updateStringListItem('study_questions', i, v)}
                        multiline
                        placeholder="Edit question…"
                        display={<span style={{ lineHeight: 1.55 }}>{q}</span>}
                      />
                      <button type="button" onClick={() => removeListItem('study_questions', i)}
                        aria-label={`Remove question ${i + 1}`}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 3, color: 'var(--text-3)', display: 'inline-flex', flexShrink: 0, borderRadius: 6, marginTop: 2 }}>
                        <Trash2 size={11} />
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <section>
              <h4 style={{ fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 13 }}>
                <Tag size={14} color="#fbbf24" /> Smart Tags
              </h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>
                {(Array.isArray(preview.tags) ? preview.tags : []).map((tag, i) => (
                  <span key={tag + i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 6px 4px 10px', background: 'var(--primary-bg)', color: 'var(--primary)', borderRadius: 8, fontSize: 12, fontWeight: 700, border: '1px solid var(--primary-border)' }}>
                    #{tag}
                    <button type="button" onClick={() => removeListItem('tags', i)}
                      aria-label={`Remove tag ${tag}`}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--primary)', opacity: 0.55, display: 'inline-flex', borderRadius: 4 }}>
                      <X size={10} />
                    </button>
                  </span>
                ))}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 4px 2px 8px', background: 'var(--surface-2)', borderRadius: 8, border: '1px dashed var(--border)' }}>
                  <input
                    value={tagDraft}
                    onChange={e => setTagDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
                        e.preventDefault();
                        addTag(tagDraft);
                      } else if (e.key === 'Escape') {
                        setTagDraft('');
                      }
                    }}
                    placeholder="add tag"
                    aria-label="Add a new tag"
                    className="bare-input"
                    style={{ width: 80, padding: '2px 4px', color: 'var(--text-1)', fontSize: 12, fontWeight: 600, fontFamily: 'inherit' }}
                  />
                  <button type="button" onClick={() => addTag(tagDraft)} disabled={!tagDraft.trim()}
                    aria-label="Add tag"
                    style={{ background: 'transparent', border: 'none', cursor: tagDraft.trim() ? 'pointer' : 'default', padding: 2, color: 'var(--text-3)', display: 'inline-flex', borderRadius: 4, opacity: tagDraft.trim() ? 1 : 0.4 }}>
                    <Plus size={11} />
                  </button>
                </span>
              </div>
            </section>

            {preview.source_url && (
              <a href={preview.source_url} target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: 'var(--primary)', textDecoration: 'none' }}>
                <ExternalLink size={12} /> View Original Source
              </a>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <button onClick={() => { setPreview(null); setAgentState({}); }} className="btn-secondary" style={{ flex: 1, minWidth: 100 }}>Discard</button>
              <button onClick={handleSave} disabled={isProcessing} className="btn-premium" style={{ flex: 2, minWidth: 140 }}>
                {isProcessing ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={15} />}
                Save to Vault
              </button>
            </div>
          </div>
        </motion.div>
      )}
      {/* P5A — From Notion picker. Two-level: databases → pages.
          Lazy-loads on open + on database expand to keep page-load light.
          On import, navigates to the new memory so it lands in the same
          flow as a fresh web/youtube capture. */}
      {notionPickerOpen && (
        <div onClick={() => setNotionPickerOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000, padding: 20 }}>
          <motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            onClick={e => e.stopPropagation()}
            data-testid="notion-picker"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 540, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <FileText size={18} color="#fff" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ margin: 0, color: 'var(--text-1)', fontSize: 15, fontWeight: 800, letterSpacing: '-0.2px' }}>Capture from Notion</h3>
                <p style={{ margin: '2px 0 0', color: 'var(--text-3)', fontSize: 11.5 }}>Pick a database, then a page to import.</p>
              </div>
              <button onClick={() => setNotionPickerOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: 4 }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
              {notionDbsLoading && notionDbList === null ? (
                <div style={{ padding: '32px 12px', textAlign: 'center', color: 'var(--text-3)', fontSize: 12.5 }}>
                  <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading databases...
                </div>
              ) : notionDbList && notionDbList.length === 0 ? (
                <div style={{ padding: '24px 14px', textAlign: 'center', background: 'var(--surface-2)', borderRadius: 10, color: 'var(--text-3)', fontSize: 12.5 }}>
                  No databases visible. Share a database with your Notion integration and try again.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {(notionDbList || []).map(db => {
                    const expanded = notionExpandedDb === db.id;
                    const pages = notionPagesByDb[db.id];
                    const pagesLoading = notionPagesLoadingDb === db.id;
                    return (
                      <div key={db.id} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, overflow: 'hidden' }}>
                        <button
                          onClick={() => void expandNotionDb(db.id)}
                          data-testid={`notion-picker-db-${db.id}`}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'transparent', border: 'none', color: 'var(--text-1)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                          {expanded ? <ChevronDown size={13} color="var(--text-3)" /> : <ChevronRight size={13} color="var(--text-3)" />}
                          <Database size={13} color="#a78bfa" />
                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{db.title}</span>
                        </button>
                        {expanded && (
                          <div style={{ padding: '4px 10px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {pagesLoading ? (
                              <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-3)', fontSize: 11.5 }}>
                                <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Loading pages...
                              </div>
                            ) : pages && pages.length === 0 ? (
                              <div style={{ padding: '10px 12px', color: 'var(--text-3)', fontSize: 11.5, fontStyle: 'italic' }}>
                                No pages in this database.
                              </div>
                            ) : (
                              (pages || []).map(p => {
                                const importing = notionImportingPage === p.page_id;
                                return (
                                  <button
                                    key={p.page_id}
                                    disabled={importing}
                                    onClick={() => void importNotionPageAndOpen(p.page_id)}
                                    data-testid={`notion-picker-page-${p.page_id}`}
                                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-2)', fontSize: 11.5, fontWeight: 500, cursor: importing ? 'wait' : 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                                    {importing ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <FileText size={11} color="var(--text-3)" />}
                                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {p.title || 'Untitled'}
                                    </span>
                                    {!importing && <ArrowRight size={11} color="var(--text-3)" />}
                                  </button>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
      {/* P5B — From Gmail picker. Single-level: search → pick.
          Lazy-loads messages on open + after every search. On import,
          navigates to the new memory so it lands in the same flow as a
          fresh web/youtube capture. */}
      {gmailPickerOpen && (
        <div onClick={() => setGmailPickerOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000, padding: 20 }}>
          <motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            onClick={e => e.stopPropagation()}
            data-testid="gmail-picker"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 580, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(234,67,53,0.1)', border: '1px solid rgba(234,67,53,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Mail size={18} color="#ea4335" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ margin: 0, color: 'var(--text-1)', fontSize: 15, fontWeight: 800, letterSpacing: '-0.2px' }}>Capture from Gmail</h3>
                <p style={{ margin: '2px 0 0', color: 'var(--text-3)', fontSize: 11.5 }}>Use Gmail search syntax (e.g. <code>is:starred</code>, <code>from:alice@x.com</code>).</p>
              </div>
              <button onClick={() => setGmailPickerOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: 4 }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={gmailQuery}
                onChange={(e) => setGmailQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void runGmailSearch(gmailQuery); }}
                placeholder="is:starred"
                data-testid="gmail-picker-query"
                style={{ flex: 1, padding: '8px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-1)', fontSize: 12.5, fontFamily: 'inherit' }}
              />
              <button onClick={() => void runGmailSearch(gmailQuery)}
                disabled={gmailMsgsLoading}
                data-testid="gmail-picker-search"
                style={{ padding: '7px 14px', background: 'rgba(234,67,53,0.1)', border: '1px solid rgba(234,67,53,0.3)', borderRadius: 9, color: '#ea4335', fontSize: 11.5, fontWeight: 700, cursor: gmailMsgsLoading ? 'wait' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5 }}>
                {gmailMsgsLoading ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={11} />} Search
              </button>
            </div>

            <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
              {gmailMsgsLoading && gmailMsgList === null ? (
                <div style={{ padding: '32px 12px', textAlign: 'center', color: 'var(--text-3)', fontSize: 12.5 }}>
                  <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading messages...
                </div>
              ) : gmailMsgList && gmailMsgList.length === 0 ? (
                <div style={{ padding: '24px 14px', textAlign: 'center', background: 'var(--surface-2)', borderRadius: 10, color: 'var(--text-3)', fontSize: 12.5 }}>
                  No messages match this search.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {(gmailMsgList || []).map(m => {
                    const importing = gmailImportingId === m.id;
                    return (
                      <button
                        key={m.id}
                        disabled={importing}
                        onClick={() => void importGmailMessageAndOpen(m.id)}
                        data-testid={`gmail-picker-msg-${m.id}`}
                        style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 11px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-1)', fontSize: 12, cursor: importing ? 'wait' : 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                        {importing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite', flexShrink: 0, marginTop: 2 }} /> : <Mail size={13} color="#ea4335" style={{ flexShrink: 0, marginTop: 2 }} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {m.subject || '(no subject)'}
                          </div>
                          <div style={{ color: 'var(--text-3)', fontSize: 10.5, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {m.from || 'unknown sender'}
                          </div>
                          {m.snippet && (
                            <div style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 3, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                              {m.snippet}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
      {/* P5C — From Slack picker. Just one URL textbox. We don't
          search Slack for "recent threads" because Slack has no clean
          API surface for that across channels — pasting a URL is the
          intentional unit of capture. On import, navigates to the
          new memory just like the Gmail/Notion flows. */}
      {slackPickerOpen && (
        <div onClick={() => setSlackPickerOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000, padding: 20 }}>
          <motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            onClick={e => e.stopPropagation()}
            data-testid="slack-picker"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(74,21,75,0.12)', border: '1px solid rgba(74,21,75,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <MessageSquare size={18} color="#a78bfa" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ margin: 0, color: 'var(--text-1)', fontSize: 15, fontWeight: 800, letterSpacing: '-0.2px' }}>Capture from Slack</h3>
                <p style={{ margin: '2px 0 0', color: 'var(--text-3)', fontSize: 11.5 }}>
                  In Slack, hover any message → click ⋮ → Copy link, then paste it here.
                </p>
              </div>
              <button onClick={() => setSlackPickerOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: 4 }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <textarea
                value={slackUrl}
                onChange={(e) => setSlackUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void importSlackThreadAndOpen();
                  }
                }}
                placeholder="https://workspace.slack.com/archives/C0123ABCD/p1234567890123456"
                data-testid="slack-picker-url"
                disabled={slackImporting}
                rows={3}
                style={{ width: '100%', padding: '10px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-1)', fontSize: 12, fontFamily: 'inherit', resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setSlackPickerOpen(false)}
                  style={{ padding: '8px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-2)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Cancel
                </button>
                <button
                  disabled={slackImporting || !slackUrl.trim()}
                  onClick={() => void importSlackThreadAndOpen()}
                  data-testid="slack-picker-import"
                  style={{ padding: '8px 16px', background: slackImporting ? 'var(--surface-3)' : 'rgba(74,21,75,0.12)', border: '1px solid rgba(74,21,75,0.35)', borderRadius: 9, color: '#a78bfa', fontSize: 12, fontWeight: 700, cursor: slackImporting ? 'wait' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {slackImporting ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={11} />}
                  Import thread
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default CaptureView;
