import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Plug, Search, Filter, CheckCircle2, ExternalLink, Settings as SettingsIcon,
  Mail, Calendar as CalendarIcon, FileText, MessageSquare, Cloud, Database,
  Github, Slack, Trello, Chrome, Zap, Bot, Globe, Youtube, BookOpen,
  Twitter, Linkedin, Music, Camera, Folder, HardDrive, Activity,
  Sparkles, Star, Shield, Layers, Plus, ArrowRight, Lock, Send, Pin,
  Hash, Cpu, Brain, RefreshCw, Loader2, Trash2, Power
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  getNotionStatus,
  listNotionDatabases,
  importNotionDatabase,
  disconnectNotion,
  type NotionStatus,
  type NotionDatabase,
  getGmailStatus,
  listGmailLabels,
  searchGmail,
  importGmailMessage,
  disconnectGmail,
  type GmailStatus,
  type GmailLabel,
  type GmailMessageRow,
  getSlackStatus,
  listSlackChannels,
  importSlackThread,
  disconnectSlack,
  type SlackStatus,
  type SlackChannel,
} from '../lib/api';
import { showToast } from '../App';

type IntCategory = 'productivity' | 'google' | 'communication' | 'developer' | 'social' | 'storage' | 'media' | 'ai';

interface Integration {
  id: string;
  name: string;
  desc: string;
  category: IntCategory;
  color: string;
  icon: any;
  status: 'connected' | 'available' | 'coming-soon';
  popular?: boolean;
  capabilities: string[];
}

const INTEGRATIONS: Integration[] = [
  // Google
  { id: 'gmail', name: 'Gmail', desc: 'Capture important emails as memories, summarise threads with AI', category: 'google', color: '#ea4335', icon: Mail, status: 'available', popular: true, capabilities: ['capture', 'summarise', 'reply'] },
  { id: 'gcal', name: 'Google Calendar', desc: 'Sync events, get briefings, schedule study sessions', category: 'google', color: '#4285f4', icon: CalendarIcon, status: 'available', popular: true, capabilities: ['sync', 'schedule', 'remind'] },
  { id: 'gdrive', name: 'Google Drive', desc: 'Auto-capture docs, sheets and slides into your brain', category: 'google', color: '#0f9d58', icon: HardDrive, status: 'available', popular: true, capabilities: ['capture', 'index', 'search'] },
  { id: 'gdocs', name: 'Google Docs', desc: 'Pull in documents, get summaries and key insights', category: 'google', color: '#4285f4', icon: FileText, status: 'available', capabilities: ['capture', 'summarise'] },
  { id: 'gphotos', name: 'Google Photos', desc: 'OCR text from photos, capture memorable moments', category: 'google', color: '#fbbc04', icon: Camera, status: 'coming-soon', capabilities: ['ocr', 'capture'] },
  { id: 'gkeep', name: 'Google Keep', desc: 'Sync notes and todos across your knowledge graph', category: 'google', color: '#fbbc04', icon: BookOpen, status: 'coming-soon', capabilities: ['sync', 'capture'] },
  { id: 'youtube', name: 'YouTube', desc: 'Auto-capture videos, transcribe and summarise content', category: 'google', color: '#ff0000', icon: Youtube, status: 'connected', popular: true, capabilities: ['transcribe', 'summarise', 'capture'] },

  // Productivity
  { id: 'notion', name: 'Notion', desc: 'Two-way sync with Notion pages and databases', category: 'productivity', color: '#fff', icon: FileText, status: 'available', popular: true, capabilities: ['sync', 'capture', 'organise'] },
  { id: 'obsidian', name: 'Obsidian', desc: 'Import vaults, build knowledge graphs', category: 'productivity', color: '#7c3aed', icon: Brain, status: 'available', capabilities: ['import', 'graph'] },
  { id: 'evernote', name: 'Evernote', desc: 'Migrate notes from Evernote into your second brain', category: 'productivity', color: '#00a82d', icon: BookOpen, status: 'available', capabilities: ['import', 'capture'] },
  { id: 'todoist', name: 'Todoist', desc: 'Sync tasks across both apps with smart prioritisation', category: 'productivity', color: '#e44332', icon: CheckCircle2, status: 'available', capabilities: ['sync', 'prioritise'] },
  { id: 'trello', name: 'Trello', desc: 'Mirror boards into your workspace with agent automation', category: 'productivity', color: '#0079bf', icon: Trello, status: 'available', capabilities: ['sync', 'automate'] },

  // Communication
  { id: 'slack', name: 'Slack', desc: 'Save important threads, get briefings in channels', category: 'communication', color: '#4a154b', icon: Slack, status: 'available', popular: true, capabilities: ['capture', 'briefing'] },
  { id: 'discord', name: 'Discord', desc: 'Capture server messages and bookmark resources', category: 'communication', color: '#5865f2', icon: MessageSquare, status: 'available', capabilities: ['capture', 'bookmark'] },
  { id: 'telegram', name: 'Telegram', desc: 'Send notes via bot, capture forwarded messages', category: 'communication', color: '#0088cc', icon: Send, status: 'available', capabilities: ['capture', 'bot'] },
  { id: 'whatsapp', name: 'WhatsApp', desc: 'Save important chats as searchable memories', category: 'communication', color: '#25d366', icon: MessageSquare, status: 'coming-soon', capabilities: ['capture'] },

  // Developer
  { id: 'github', name: 'GitHub', desc: 'Capture issues, PRs, and code snippets with context', category: 'developer', color: '#fff', icon: Github, status: 'available', popular: true, capabilities: ['capture', 'review', 'sync'] },
  { id: 'gitlab', name: 'GitLab', desc: 'Sync GitLab projects, MRs and pipeline events', category: 'developer', color: '#fc6d26', icon: Github, status: 'available', capabilities: ['sync', 'capture'] },
  { id: 'linear', name: 'Linear', desc: 'Bidirectional sync with Linear issues and cycles', category: 'developer', color: '#5e6ad2', icon: Activity, status: 'available', capabilities: ['sync', 'automate'] },
  { id: 'jira', name: 'Jira', desc: 'Mirror Jira tickets, get AI summaries on epics', category: 'developer', color: '#0052cc', icon: Layers, status: 'available', capabilities: ['sync', 'summarise'] },

  // Social
  { id: 'twitter', name: 'X (Twitter)', desc: 'Save bookmarks, threads and important tweets', category: 'social', color: '#1da1f2', icon: Twitter, status: 'available', popular: true, capabilities: ['capture', 'bookmarks'] },
  { id: 'linkedin', name: 'LinkedIn', desc: 'Capture posts, save articles and contacts', category: 'social', color: '#0a66c2', icon: Linkedin, status: 'available', capabilities: ['capture', 'sync'] },
  { id: 'reddit', name: 'Reddit', desc: 'Save posts, comments and subreddit highlights', category: 'social', color: '#ff4500', icon: MessageSquare, status: 'coming-soon', capabilities: ['capture'] },

  // Storage
  { id: 'dropbox', name: 'Dropbox', desc: 'Auto-capture documents from Dropbox folders', category: 'storage', color: '#0061ff', icon: Cloud, status: 'available', capabilities: ['capture', 'sync'] },
  { id: 'onedrive', name: 'OneDrive', desc: 'Pull in Office files and PDFs for AI processing', category: 'storage', color: '#0078d4', icon: Cloud, status: 'available', capabilities: ['capture', 'sync'] },
  { id: 's3', name: 'AWS S3', desc: 'Connect S3 buckets for large-scale data ingestion', category: 'storage', color: '#ff9900', icon: Database, status: 'coming-soon', capabilities: ['ingest'] },

  // Media
  { id: 'spotify', name: 'Spotify', desc: 'Capture podcast episodes, transcribe and summarise', category: 'media', color: '#1db954', icon: Music, status: 'available', capabilities: ['transcribe', 'capture'] },
  { id: 'pocket', name: 'Pocket', desc: 'Import saved articles into your knowledge graph', category: 'media', color: '#ee4056', icon: BookOpen, status: 'available', capabilities: ['import', 'summarise'] },
  { id: 'instapaper', name: 'Instapaper', desc: 'Sync read-later articles with AI summaries', category: 'media', color: '#fff', icon: BookOpen, status: 'available', capabilities: ['sync', 'summarise'] },

  // AI / Browser
  { id: 'chrome', name: 'Chrome Extension', desc: 'One-click capture from any webpage', category: 'ai', color: '#4285f4', icon: Chrome, status: 'connected', popular: true, capabilities: ['capture', 'highlight'] },
  { id: 'zapier', name: 'Zapier', desc: 'Connect to 5000+ apps via Zapier automations', category: 'ai', color: '#ff4a00', icon: Zap, status: 'available', popular: true, capabilities: ['automate', 'webhook'] },
  { id: 'make', name: 'Make.com', desc: 'Visual automation with no-code workflows', category: 'ai', color: '#6d00cc', icon: Activity, status: 'available', capabilities: ['automate'] },
  { id: 'openai', name: 'OpenAI API', desc: 'Bring your own key for unlimited AI processing', category: 'ai', color: '#10a37f', icon: Bot, status: 'connected', capabilities: ['llm', 'embed'] },
  { id: 'webhook', name: 'Generic Webhooks', desc: 'POST any payload to capture endpoints', category: 'ai', color: '#a78bfa', icon: Globe, status: 'available', capabilities: ['ingest', 'webhook'] },
];

const CATEGORIES: { key: IntCategory | 'all'; label: string; icon: any; color: string }[] = [
  { key: 'all', label: 'All', icon: Layers, color: '#a78bfa' },
  { key: 'google', label: 'Google', icon: Chrome, color: '#4285f4' },
  { key: 'productivity', label: 'Productivity', icon: CheckCircle2, color: '#10b981' },
  { key: 'communication', label: 'Communication', icon: MessageSquare, color: '#06b6d4' },
  { key: 'developer', label: 'Developer', icon: Github, color: '#a78bfa' },
  { key: 'social', label: 'Social', icon: Twitter, color: '#1da1f2' },
  { key: 'storage', label: 'Storage', icon: Cloud, color: '#3b82f6' },
  { key: 'media', label: 'Media', icon: Music, color: '#ec4899' },
  { key: 'ai', label: 'AI & Automation', icon: Bot, color: '#f59e0b' },
];

/* P5A — relative-time helper for "Last synced X ago". Local to this page;
 * we don't need a project-wide util for one card. */
function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  try {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return 'just now';
    const diff = Date.now() - t;
    if (diff < 60_000) return 'just now';
    const m = Math.floor(diff / 60_000);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  } catch {
    return 'just now';
  }
}

const IntegrationsPage: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState<IntCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showOnlyConnected, setShowOnlyConnected] = useState(false);
  const [showPopularOnly, setShowPopularOnly] = useState(false);
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null);

  // P5A — Real Notion connection state. Fetched on mount and after
  // every action (import / disconnect / refresh). When connected we
  // also lazy-load the database list once the user expands the card.
  const [notionStatus, setNotionStatus] = useState<NotionStatus | null>(null);
  const [notionDbs, setNotionDbs] = useState<NotionDatabase[] | null>(null);
  const [notionDbsLoading, setNotionDbsLoading] = useState(false);
  const [importingDbId, setImportingDbId] = useState<string | null>(null);
  const [showNotionModal, setShowNotionModal] = useState(false);

  const refreshNotionStatus = useCallback(async () => {
    const s = await getNotionStatus();
    setNotionStatus(s);
  }, []);

  useEffect(() => {
    void refreshNotionStatus();
  }, [refreshNotionStatus]);

  const loadNotionDatabases = useCallback(async () => {
    setNotionDbsLoading(true);
    try {
      const dbs = await listNotionDatabases();
      setNotionDbs(dbs);
    } catch (e) {
      showToast(`Couldn't load Notion databases: ${(e as Error).message}`, 'error');
      setNotionDbs([]);
    } finally {
      setNotionDbsLoading(false);
    }
  }, []);

  const handleNotionImport = useCallback(
    async (dbId: string, mode: 'one-time' | 'sync') => {
      setImportingDbId(dbId);
      try {
        const res = await importNotionDatabase(dbId, mode);
        const verb = mode === 'sync' ? 'synced' : 'imported';
        const updatedFrag = res.updated > 0 ? `, ${res.updated} updated` : '';
        const failedFrag = res.failed > 0 ? `, ${res.failed} failed` : '';
        showToast(
          `Notion ${verb}: ${res.imported} new${updatedFrag}${failedFrag} (${res.total_pages} pages)`,
          'success',
        );
        await refreshNotionStatus();
      } catch (e) {
        showToast(`Notion import failed: ${(e as Error).message}`, 'error');
      } finally {
        setImportingDbId(null);
      }
    },
    [refreshNotionStatus],
  );

  const handleNotionDisconnect = useCallback(async () => {
    try {
      const res = await disconnectNotion();
      showToast(
        `Notion sync schedules cleared.${res.removed_sync_rows ? ` Removed ${res.removed_sync_rows} entries.` : ''}`,
        'success',
      );
      setNotionDbs(null);
      await refreshNotionStatus();
    } catch (e) {
      showToast(`Notion disconnect failed: ${(e as Error).message}`, 'error');
    }
  }, [refreshNotionStatus]);

  // P5B — Real Gmail connection state. Same pattern as Notion: probe on
  // mount, lazy-load labels + message previews when the modal opens, and
  // expose a bulk-import action that loops over the per-message endpoint.
  // Bulk import is intentionally frontend-driven so we can show progress
  // per row and let the user cancel partway without leaving the backend
  // in a half-imported state.
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [gmailLabels, setGmailLabels] = useState<GmailLabel[] | null>(null);
  const [gmailLabelsLoading, setGmailLabelsLoading] = useState(false);
  const [gmailLabelId, setGmailLabelId] = useState<string>('STARRED');
  const [gmailMessages, setGmailMessages] = useState<GmailMessageRow[] | null>(null);
  const [gmailMessagesLoading, setGmailMessagesLoading] = useState(false);
  const [gmailSelected, setGmailSelected] = useState<Record<string, boolean>>({});
  const [gmailBulkProgress, setGmailBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [showGmailModal, setShowGmailModal] = useState(false);

  const refreshGmailStatus = useCallback(async () => {
    const s = await getGmailStatus();
    setGmailStatus(s);
  }, []);

  useEffect(() => {
    void refreshGmailStatus();
  }, [refreshGmailStatus]);

  const loadGmailLabels = useCallback(async () => {
    setGmailLabelsLoading(true);
    try {
      const labs = await listGmailLabels();
      setGmailLabels(labs);
    } catch (e) {
      showToast(`Couldn't load Gmail labels: ${(e as Error).message}`, 'error');
      setGmailLabels([]);
    } finally {
      setGmailLabelsLoading(false);
    }
  }, []);

  const loadGmailMessagesForLabel = useCallback(
    async (labelId: string) => {
      setGmailMessagesLoading(true);
      // Reset selection whenever we re-query so a stale row id can never
      // sneak into a bulk import after the user changes labels.
      setGmailSelected({});
      try {
        const msgs = await searchGmail({ labelId, limit: 20 });
        setGmailMessages(msgs);
        // Pre-select all results so "Save messages with label X" is a
        // one-click action — the user can untick anything they don't want.
        const next: Record<string, boolean> = {};
        for (const m of msgs) next[m.id] = true;
        setGmailSelected(next);
      } catch (e) {
        showToast(`Couldn't load Gmail messages: ${(e as Error).message}`, 'error');
        setGmailMessages([]);
      } finally {
        setGmailMessagesLoading(false);
      }
    },
    [],
  );

  const handleGmailBulkImport = useCallback(async () => {
    const ids = Object.entries(gmailSelected).filter(([, v]) => v).map(([k]) => k);
    if (ids.length === 0) {
      showToast('Pick at least one message to import.', 'error');
      return;
    }
    setGmailBulkProgress({ done: 0, total: ids.length });
    let imported = 0;
    let updated = 0;
    let failed = 0;
    for (let i = 0; i < ids.length; i++) {
      try {
        const res = await importGmailMessage(ids[i]);
        if (res.created) imported += 1;
        else if (res.updated) updated += 1;
      } catch (e) {
        failed += 1;
        console.warn('gmail bulk import row failed', ids[i], e);
      }
      setGmailBulkProgress({ done: i + 1, total: ids.length });
    }
    const updatedFrag = updated > 0 ? `, ${updated} updated` : '';
    const failedFrag = failed > 0 ? `, ${failed} failed` : '';
    showToast(
      `Gmail import: ${imported} new${updatedFrag}${failedFrag} (${ids.length} messages)`,
      failed > 0 ? 'error' : 'success',
    );
    setGmailBulkProgress(null);
  }, [gmailSelected]);

  // P5C — Real Slack connection state. Same pattern as Gmail/Notion: probe
  // status on mount, lazy-load channels when the modal opens, and accept a
  // pasted thread URL for the actual import. We deliberately skip a
  // bulk-import-by-channel flow because Slack channels can have thousands
  // of threads and "import all" rarely matches user intent for a chat tool.
  const [slackStatus, setSlackStatus] = useState<SlackStatus | null>(null);
  const [slackChannels, setSlackChannels] = useState<SlackChannel[] | null>(null);
  const [slackChannelsLoading, setSlackChannelsLoading] = useState(false);
  const [slackThreadUrl, setSlackThreadUrl] = useState<string>('');
  const [slackImporting, setSlackImporting] = useState(false);
  const [showSlackModal, setShowSlackModal] = useState(false);

  const refreshSlackStatus = useCallback(async () => {
    const s = await getSlackStatus();
    setSlackStatus(s);
  }, []);

  useEffect(() => {
    void refreshSlackStatus();
  }, [refreshSlackStatus]);

  const loadSlackChannels = useCallback(async () => {
    setSlackChannelsLoading(true);
    try {
      const chans = await listSlackChannels();
      setSlackChannels(chans);
    } catch (e) {
      showToast(`Couldn't load Slack channels: ${(e as Error).message}`, 'error');
      setSlackChannels([]);
    } finally {
      setSlackChannelsLoading(false);
    }
  }, []);

  const handleSlackImportUrl = useCallback(async () => {
    const url = slackThreadUrl.trim();
    if (!url) {
      showToast('Paste a Slack thread URL first.', 'error');
      return;
    }
    setSlackImporting(true);
    try {
      const res = await importSlackThread({ url });
      const verb = res.created ? 'Imported' : res.updated ? 'Refreshed' : 'Saved';
      showToast(`${verb} Slack thread (${res.message_count} messages)`, 'success');
      setSlackThreadUrl('');
    } catch (e) {
      showToast(`Slack import failed: ${(e as Error).message}`, 'error');
    } finally {
      setSlackImporting(false);
    }
  }, [slackThreadUrl]);

  const handleSlackDisconnect = useCallback(async () => {
    try {
      await disconnectSlack();
      showToast('Slack disconnected on this server.', 'success');
      setSlackChannels(null);
      setSlackThreadUrl('');
      await refreshSlackStatus();
    } catch (e) {
      showToast(`Slack disconnect failed: ${(e as Error).message}`, 'error');
    }
  }, [refreshSlackStatus]);

  const handleGmailDisconnect = useCallback(async () => {
    try {
      await disconnectGmail();
      showToast('Gmail disconnected on this server.', 'success');
      setGmailLabels(null);
      setGmailMessages(null);
      setGmailSelected({});
      await refreshGmailStatus();
    } catch (e) {
      showToast(`Gmail disconnect failed: ${(e as Error).message}`, 'error');
    }
  }, [refreshGmailStatus]);

  // P5A/P5B — We override the static INTEGRATIONS list at render time so
  // the Notion + Gmail cards flip between connected/available based on
  // real backend state without rewriting the whole list.
  const integrationsView = useMemo(() => {
    return INTEGRATIONS.map((int) => {
      if (int.id === 'notion') {
        return {
          ...int,
          status: notionStatus?.connected ? 'connected' : 'available',
        } as Integration;
      }
      if (int.id === 'gmail') {
        return {
          ...int,
          status: gmailStatus?.connected ? 'connected' : 'available',
        } as Integration;
      }
      if (int.id === 'slack') {
        return {
          ...int,
          status: slackStatus?.connected ? 'connected' : 'available',
        } as Integration;
      }
      return int;
    });
  }, [notionStatus, gmailStatus, slackStatus]);

  const filtered = useMemo(() => {
    return integrationsView.filter(int => {
      if (activeCategory !== 'all' && int.category !== activeCategory) return false;
      if (showOnlyConnected && int.status !== 'connected') return false;
      if (showPopularOnly && !int.popular) return false;
      if (searchQuery && !int.name.toLowerCase().includes(searchQuery.toLowerCase()) && !int.desc.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  }, [integrationsView, activeCategory, showOnlyConnected, showPopularOnly, searchQuery]);

  const connectedCount = integrationsView.filter(i => i.status === 'connected').length;
  const availableCount = integrationsView.filter(i => i.status === 'available').length;
  const comingSoonCount = integrationsView.filter(i => i.status === 'coming-soon').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '14px 0 28px', minHeight: 'calc(100vh - 5rem)' }}>

      {/* HERO HEADER */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg, rgba(34,211,238,0.25), rgba(6,182,212,0.18))', border: '1px solid rgba(34,211,238,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 28px rgba(34,211,238,0.2)' }}>
              <Plug size={24} color="#22d3ee" />
            </div>
            <div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 12px', background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.3)', borderRadius: 20, marginBottom: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
                <span style={{ fontSize: 10.5, fontWeight: 700, color: '#22d3ee', letterSpacing: '0.5px' }}>{INTEGRATIONS.length} INTEGRATIONS · GOOGLE + 3RD PARTY APPS</span>
              </div>
              <h2 style={{ fontSize: 'clamp(22px,3.5vw,30px)', fontWeight: 900, color: 'var(--text-1)', margin: 0, letterSpacing: '-0.6px', lineHeight: 1.05 }}>
                Integrations <span style={{ color: '#22d3ee' }}>✦</span>
              </h2>
              <p style={{ color: 'var(--text-3)', fontSize: 13.5, margin: '4px 0 0' }}>
                Capture and organise everything from Gmail, Drive, Slack, GitHub, Notion and 30+ more
              </p>
            </div>
          </div>
        </div>

        {/* Stats strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          {[
            { icon: CheckCircle2, color: '#10b981', label: 'Connected', value: connectedCount, sub: 'syncing now' },
            { icon: Sparkles, color: '#3b82f6', label: 'Available', value: availableCount, sub: 'ready to connect' },
            { icon: Star, color: '#f59e0b', label: 'Popular', value: INTEGRATIONS.filter(i => i.popular).length, sub: 'most used' },
            { icon: Layers, color: '#a78bfa', label: 'Coming Soon', value: comingSoonCount, sub: 'in development' },
          ].map(stat => (
            <div key={stat.label} style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 13 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: `${stat.color}15`, border: `1px solid ${stat.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <stat.icon size={18} color={stat.color} />
              </div>
              <div>
                <div style={{ color: 'var(--text-3)', fontSize: 10.5, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>{stat.label}</div>
                <div style={{ color: 'var(--text-1)', fontSize: 20, fontWeight: 800, lineHeight: 1.1 }}>{stat.value}</div>
                <div style={{ color: 'var(--text-3)', fontSize: 10.5, marginTop: 2 }}>{stat.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* SEARCH + FILTERS */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 280px', position: 'relative', minWidth: 220 }}>
            <Search size={14} color="var(--text-3)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search 30+ integrations..."
              style={{ width: '100%', padding: '10px 14px 10px 36px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
          </div>
          <button onClick={() => setShowOnlyConnected(!showOnlyConnected)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', background: showOnlyConnected ? 'rgba(16,185,129,0.12)' : 'var(--surface-2)', border: `1px solid ${showOnlyConnected ? 'rgba(16,185,129,0.4)' : 'var(--border)'}`, borderRadius: 10, color: showOnlyConnected ? '#10b981' : 'var(--text-2)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            <CheckCircle2 size={13} /> Connected only
          </button>
          <button onClick={() => setShowPopularOnly(!showPopularOnly)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', background: showPopularOnly ? 'rgba(245,158,11,0.12)' : 'var(--surface-2)', border: `1px solid ${showPopularOnly ? 'rgba(245,158,11,0.4)' : 'var(--border)'}`, borderRadius: 10, color: showPopularOnly ? '#f59e0b' : 'var(--text-2)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            <Star size={13} /> Popular
          </button>
        </div>

        {/* Category pills */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CATEGORIES.map(cat => (
            <button key={cat.key} onClick={() => setActiveCategory(cat.key)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', background: activeCategory === cat.key ? `${cat.color}15` : 'transparent', border: `1px solid ${activeCategory === cat.key ? cat.color + '50' : 'var(--border)'}`, borderRadius: 20, color: activeCategory === cat.key ? cat.color : 'var(--text-2)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' }}>
              <cat.icon size={12} /> {cat.label}
              <span style={{ padding: '1px 6px', background: activeCategory === cat.key ? `${cat.color}20` : 'var(--surface-3)', borderRadius: 8, fontSize: 9.5, color: activeCategory === cat.key ? cat.color : 'var(--text-3)' }}>
                {cat.key === 'all' ? INTEGRATIONS.length : INTEGRATIONS.filter(i => i.category === cat.key).length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* INTEGRATIONS GRID */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {filtered.map(int => {
          const isConnected = int.status === 'connected';
          const isComingSoon = int.status === 'coming-soon';
          return (
            <motion.div key={int.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} whileHover={{ y: -2 }}
              style={{ background: 'var(--surface)', border: `1px solid ${isConnected ? int.color + '40' : 'var(--border)'}`, borderRadius: 14, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, transition: 'all 0.2s', cursor: isComingSoon ? 'default' : 'pointer', position: 'relative', overflow: 'hidden' }}
              onClick={() => {
                if (isComingSoon) return;
                if (int.id === 'notion') {
                  setShowNotionModal(true);
                  if (notionStatus?.connected && notionDbs === null && !notionDbsLoading) {
                    void loadNotionDatabases();
                  }
                  return;
                }
                if (int.id === 'gmail') {
                  setShowGmailModal(true);
                  if (gmailStatus?.connected) {
                    if (gmailLabels === null && !gmailLabelsLoading) void loadGmailLabels();
                    if (gmailMessages === null && !gmailMessagesLoading) {
                      void loadGmailMessagesForLabel(gmailLabelId);
                    }
                  }
                  return;
                }
                if (int.id === 'slack') {
                  setShowSlackModal(true);
                  if (slackStatus?.connected && slackChannels === null && !slackChannelsLoading) {
                    void loadSlackChannels();
                  }
                  return;
                }
                setSelectedIntegration(int);
              }}>
              {isConnected && (
                <div style={{ position: 'absolute', top: 0, right: 0, padding: '3px 10px', background: int.color, color: '#fff', fontSize: 9.5, fontWeight: 800, letterSpacing: '0.5px', borderRadius: '0 14px 0 8px' }}>
                  CONNECTED
                </div>
              )}
              {int.popular && !isConnected && (
                <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', alignItems: 'center', gap: 3, padding: '2px 7px', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, color: '#f59e0b', fontSize: 9, fontWeight: 700 }}>
                  <Star size={8} /> POPULAR
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
                <div style={{ width: 42, height: 42, borderRadius: 11, background: `${int.color}15`, border: `1px solid ${int.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <int.icon size={20} color={int.color} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h4 style={{ margin: '2px 0 4px', color: 'var(--text-1)', fontSize: 14, fontWeight: 800, letterSpacing: '-0.2px' }}>{int.name}</h4>
                  <p style={{ margin: 0, color: 'var(--text-3)', fontSize: 11.5, lineHeight: 1.45 }}>{int.desc}</p>
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {int.capabilities.map(cap => (
                  <span key={cap} style={{ padding: '2px 8px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-3)', fontSize: 9.5, fontWeight: 600 }}>{cap}</span>
                ))}
              </div>
              <button disabled={isComingSoon}
                style={{ marginTop: 4, padding: '8px 12px', background: isConnected ? 'var(--surface-2)' : isComingSoon ? 'var(--surface-3)' : `${int.color}15`, border: `1px solid ${isConnected ? 'var(--border)' : isComingSoon ? 'var(--border)' : int.color + '40'}`, borderRadius: 9, color: isConnected ? 'var(--text-1)' : isComingSoon ? 'var(--text-3)' : int.color, fontSize: 11.5, fontWeight: 700, cursor: isComingSoon ? 'default' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, transition: 'all 0.15s' }}>
                {isConnected ? <><SettingsIcon size={11} /> Configure</> : isComingSoon ? <><Lock size={11} /> Coming soon</> : <><Plus size={11} /> Connect</>}
              </button>
            </motion.div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-3)', fontSize: 13 }}>
          <Search size={36} color="var(--border-2)" style={{ margin: '0 auto 12px' }} />
          <p style={{ margin: 0, fontWeight: 600 }}>No integrations match your filters</p>
          <p style={{ margin: '4px 0 0', fontSize: 12 }}>Try a different category or clear search</p>
        </div>
      )}

      {/* P5A — Real Notion modal (databases + import + disconnect). */}
      {showNotionModal && (
        <div onClick={() => setShowNotionModal(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000, padding: 20 }}>
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} onClick={e => e.stopPropagation()}
            data-testid="notion-modal"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '22px 24px', maxWidth: 560, width: '100%', maxHeight: '80vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
              <div style={{ width: 52, height: 52, borderRadius: 13, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <FileText size={24} color="#fff" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ margin: '2px 0 4px', color: 'var(--text-1)', fontSize: 18, fontWeight: 800, letterSpacing: '-0.3px' }}>Notion</h3>
                <p style={{ margin: 0, color: 'var(--text-3)', fontSize: 12.5, lineHeight: 1.5 }}>
                  Two-way sync with Notion pages and databases. Imports preserve the page URL so you can jump back any time.
                </p>
              </div>
              <button onClick={() => setShowNotionModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
            </div>

            {!notionStatus?.connected ? (
              <div data-testid="notion-modal-disconnected">
                <div style={{ padding: '14px 16px', background: 'var(--surface-2)', borderRadius: 12, marginBottom: 14 }}>
                  <div style={{ color: 'var(--text-1)', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>How to connect</div>
                  <ol style={{ color: 'var(--text-2)', fontSize: 12.5, lineHeight: 1.65, paddingLeft: 18, margin: 0 }}>
                    <li><strong>OAuth (recommended)</strong> — your assistant will hand you a one-click Replit OAuth flow at the end of the build. Approve once and Notion stays connected.</li>
                    <li style={{ marginTop: 6 }}><strong>Manual token</strong> — create an integration at <a href="https://www.notion.so/my-integrations" target="_blank" rel="noreferrer" style={{ color: '#22d3ee' }}>notion.so/my-integrations</a>, share the databases you want to import with that integration, then save the token as the <code style={{ background: 'var(--surface-3)', padding: '1px 5px', borderRadius: 4 }}>NOTION_INTEGRATION_TOKEN</code> secret.</li>
                  </ol>
                </div>
                {notionStatus?.hint && (
                  <div style={{ padding: '10px 12px', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, color: 'var(--text-2)', fontSize: 11.5, marginBottom: 14 }}>
                    {notionStatus.hint}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setShowNotionModal(false)}
                    style={{ flex: 1, padding: '11px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-2)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Close
                  </button>
                  <button onClick={() => void refreshNotionStatus()}
                    data-testid="notion-modal-refresh-status"
                    style={{ flex: 1, padding: '11px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-1)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <RefreshCw size={13} /> Recheck
                  </button>
                </div>
              </div>
            ) : (
              <div data-testid="notion-modal-connected">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 10, marginBottom: 12 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'var(--text-1)', fontSize: 12.5, fontWeight: 700 }}>
                      Connected{notionStatus.workspace_name ? ` to ${notionStatus.workspace_name}` : ''}
                      <span style={{ marginLeft: 8, padding: '1px 7px', background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 9.5, color: 'var(--text-3)', fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase' }}>
                        {notionStatus.source === 'replit_oauth' ? 'OAuth' : 'Token'}
                      </span>
                    </div>
                    <div style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 2 }}>
                      Last synced {formatRelativeTime(notionStatus.last_synced_at)}
                    </div>
                  </div>
                  <button onClick={() => void refreshNotionStatus()}
                    title="Refresh"
                    data-testid="notion-modal-refresh"
                    style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, padding: 5, cursor: 'pointer', color: 'var(--text-2)', display: 'flex', alignItems: 'center' }}>
                    <RefreshCw size={12} />
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ color: 'var(--text-3)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                    Databases ({notionDbs?.length ?? '…'})
                  </div>
                  <button onClick={() => void loadNotionDatabases()}
                    data-testid="notion-modal-reload-dbs"
                    style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, padding: '3px 9px', cursor: 'pointer', color: 'var(--text-2)', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <RefreshCw size={11} /> Reload
                  </button>
                </div>

                {notionDbsLoading ? (
                  <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>
                    <Loader2 size={16} className="spin" /> Loading databases...
                  </div>
                ) : notionDbs && notionDbs.length === 0 ? (
                  <div style={{ padding: '20px 14px', textAlign: 'center', background: 'var(--surface-2)', borderRadius: 10, color: 'var(--text-3)', fontSize: 12 }}>
                    No databases visible. Share a database with your Notion integration and reload.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflow: 'auto' }} data-testid="notion-modal-db-list">
                    {(notionDbs || []).map((db) => {
                      const synced = (notionStatus.synced_databases || []).find(s => s.database_id === db.id);
                      const isImporting = importingDbId === db.id;
                      return (
                        <div key={db.id}
                          data-testid={`notion-modal-db-${db.id}`}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9 }}>
                          <Database size={14} color="#a78bfa" style={{ flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: 'var(--text-1)', fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {db.title}
                            </div>
                            {synced && (
                              <div style={{ color: 'var(--text-3)', fontSize: 10.5, marginTop: 1 }}>
                                {synced.mode === 'sync' ? 'Auto-syncing' : 'Imported'} · {formatRelativeTime(synced.last_synced_at)}
                              </div>
                            )}
                          </div>
                          <button
                            disabled={isImporting}
                            onClick={() => void handleNotionImport(db.id, 'one-time')}
                            data-testid={`notion-modal-import-${db.id}`}
                            style={{ padding: '5px 9px', background: isImporting ? 'var(--surface-3)' : 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.3)', borderRadius: 7, color: '#22d3ee', fontSize: 10.5, fontWeight: 700, cursor: isImporting ? 'wait' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}>
                            {isImporting ? <Loader2 size={11} className="spin" /> : <Plus size={11} />} Import
                          </button>
                          <button
                            disabled={isImporting}
                            onClick={() => void handleNotionImport(db.id, 'sync')}
                            data-testid={`notion-modal-sync-${db.id}`}
                            style={{ padding: '5px 9px', background: isImporting ? 'var(--surface-3)' : 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.3)', borderRadius: 7, color: '#a78bfa', fontSize: 10.5, fontWeight: 700, cursor: isImporting ? 'wait' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <RefreshCw size={11} /> Sync
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
                  <button onClick={() => setShowNotionModal(false)}
                    style={{ flex: 1, padding: '10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-2)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Close
                  </button>
                  <button onClick={() => void handleNotionDisconnect()}
                    data-testid="notion-modal-disconnect"
                    style={{ flex: 1, padding: '10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, color: '#ef4444', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <Power size={12} /> Disconnect
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}

      {/* P5B — Real Gmail modal (label picker + message preview + bulk import). */}
      {showGmailModal && (
        <div onClick={() => setShowGmailModal(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000, padding: 20 }}>
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} onClick={e => e.stopPropagation()}
            data-testid="gmail-modal"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '22px 24px', maxWidth: 620, width: '100%', maxHeight: '85vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
              <div style={{ width: 52, height: 52, borderRadius: 13, background: 'rgba(234,67,53,0.1)', border: '1px solid rgba(234,67,53,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Mail size={24} color="#ea4335" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ margin: '2px 0 4px', color: 'var(--text-1)', fontSize: 18, fontWeight: 800, letterSpacing: '-0.3px' }}>Gmail</h3>
                <p style={{ margin: 0, color: 'var(--text-3)', fontSize: 12.5, lineHeight: 1.5 }}>
                  Capture important emails as memories. Each import preserves sender + subject and back-links to the original Gmail thread.
                </p>
              </div>
              <button onClick={() => setShowGmailModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
            </div>

            {!gmailStatus?.connected ? (
              <div data-testid="gmail-modal-disconnected">
                <div style={{ padding: '14px 16px', background: 'var(--surface-2)', borderRadius: 12, marginBottom: 14 }}>
                  <div style={{ color: 'var(--text-1)', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>How to connect</div>
                  <ol style={{ color: 'var(--text-2)', fontSize: 12.5, lineHeight: 1.65, paddingLeft: 18, margin: 0 }}>
                    <li><strong>OAuth (recommended)</strong> — your assistant will hand you a one-click Replit OAuth flow at the end of the build. Approve once and Gmail stays connected.</li>
                    <li style={{ marginTop: 6 }}><strong>Manual token</strong> — paste a Google OAuth access token (with the <code style={{ background: 'var(--surface-3)', padding: '1px 5px', borderRadius: 4 }}>gmail.readonly</code> scope) into the <code style={{ background: 'var(--surface-3)', padding: '1px 5px', borderRadius: 4 }}>GMAIL_ACCESS_TOKEN</code> secret. Note: Google access tokens expire in about an hour, so OAuth is strongly preferred.</li>
                  </ol>
                </div>
                {gmailStatus?.hint && (
                  <div style={{ padding: '10px 12px', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, color: 'var(--text-2)', fontSize: 11.5, marginBottom: 14 }}>
                    {gmailStatus.hint}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setShowGmailModal(false)}
                    style={{ flex: 1, padding: '11px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-2)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Close
                  </button>
                  <button onClick={() => void refreshGmailStatus()}
                    data-testid="gmail-modal-refresh-status"
                    style={{ flex: 1, padding: '11px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-1)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <RefreshCw size={13} /> Recheck
                  </button>
                </div>
              </div>
            ) : (
              <div data-testid="gmail-modal-connected">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'rgba(234,67,53,0.08)', border: '1px solid rgba(234,67,53,0.25)', borderRadius: 10, marginBottom: 12 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ea4335', boxShadow: '0 0 8px #ea4335' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'var(--text-1)', fontSize: 12.5, fontWeight: 700 }}>
                      Connected{gmailStatus.email ? ` as ${gmailStatus.email}` : ''}
                      <span style={{ marginLeft: 8, padding: '1px 7px', background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 9.5, color: 'var(--text-3)', fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase' }}>
                        {gmailStatus.source === 'replit_oauth' ? 'OAuth' : 'Token'}
                      </span>
                    </div>
                  </div>
                  <button onClick={() => void refreshGmailStatus()}
                    title="Refresh"
                    data-testid="gmail-modal-refresh"
                    style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, padding: 5, cursor: 'pointer', color: 'var(--text-2)', display: 'flex', alignItems: 'center' }}>
                    <RefreshCw size={12} />
                  </button>
                </div>

                {/* Label picker — defaults to STARRED so the spec'd
                    "Save all starred" is one click away. Falls back to
                    a text input if labels haven't loaded yet so the
                    picker stays usable on slow networks. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <div style={{ color: 'var(--text-3)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase' }}>Label</div>
                  <select
                    value={gmailLabelId}
                    onChange={(e) => {
                      const next = e.target.value;
                      setGmailLabelId(next);
                      void loadGmailMessagesForLabel(next);
                    }}
                    data-testid="gmail-modal-label-select"
                    disabled={gmailLabelsLoading || gmailMessagesLoading}
                    style={{ flex: 1, padding: '7px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}
                  >
                    {(gmailLabels || [{ id: 'STARRED', name: 'Starred', type: 'system' }, { id: 'INBOX', name: 'Inbox', type: 'system' }]).map(l => (
                      <option key={l.id} value={l.id}>
                        {l.name}{l.type === 'system' ? '' : ' (label)'}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => void loadGmailMessagesForLabel(gmailLabelId)}
                    disabled={gmailMessagesLoading}
                    data-testid="gmail-modal-reload"
                    style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, padding: '5px 9px', cursor: gmailMessagesLoading ? 'wait' : 'pointer', color: 'var(--text-2)', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <RefreshCw size={11} /> Reload
                  </button>
                </div>

                {gmailMessagesLoading ? (
                  <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>
                    <Loader2 size={16} className="spin" /> Loading messages...
                  </div>
                ) : gmailMessages && gmailMessages.length === 0 ? (
                  <div style={{ padding: '20px 14px', textAlign: 'center', background: 'var(--surface-2)', borderRadius: 10, color: 'var(--text-3)', fontSize: 12 }}>
                    No messages match this label.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflow: 'auto' }} data-testid="gmail-modal-message-list">
                    {(gmailMessages || []).map((m) => {
                      const checked = !!gmailSelected[m.id];
                      return (
                        <label key={m.id}
                          data-testid={`gmail-modal-msg-${m.id}`}
                          style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            data-testid={`gmail-modal-msg-${m.id}-check`}
                            onChange={(e) => setGmailSelected(prev => ({ ...prev, [m.id]: e.target.checked }))}
                            style={{ marginTop: 2, accentColor: '#ea4335', cursor: 'pointer' }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ color: 'var(--text-1)', fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                {m.subject || '(no subject)'}
                              </div>
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
                        </label>
                      );
                    })}
                  </div>
                )}

                {gmailBulkProgress && (
                  <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.25)', borderRadius: 9, color: 'var(--text-1)', fontSize: 11.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Loader2 size={12} className="spin" /> Importing {gmailBulkProgress.done}/{gmailBulkProgress.total}...
                  </div>
                )}

                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
                  <button onClick={() => setShowGmailModal(false)}
                    style={{ flex: 1, padding: '10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-2)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Close
                  </button>
                  <button
                    disabled={!!gmailBulkProgress || !gmailMessages || Object.values(gmailSelected).every(v => !v)}
                    onClick={() => void handleGmailBulkImport()}
                    data-testid="gmail-modal-bulk-import"
                    style={{ flex: 2, padding: '10px', background: gmailBulkProgress ? 'var(--surface-3)' : 'rgba(234,67,53,0.12)', border: '1px solid rgba(234,67,53,0.3)', borderRadius: 10, color: '#ea4335', fontSize: 12.5, fontWeight: 800, cursor: gmailBulkProgress ? 'wait' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    {gmailBulkProgress ? <Loader2 size={12} className="spin" /> : <Plus size={12} />}
                    Import selected ({Object.values(gmailSelected).filter(Boolean).length})
                  </button>
                  <button onClick={() => void handleGmailDisconnect()}
                    data-testid="gmail-modal-disconnect"
                    style={{ flex: 1, padding: '10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, color: '#ef4444', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <Power size={12} /> Disconnect
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}

      {/* P5C — Real Slack modal (channel picker + paste-URL import).
          Slack is a chat tool, so the bulk-import-by-folder pattern we use
          for Notion/Gmail doesn't fit — pasting a thread URL is the
          natural unit of capture. Channels list is shown for context
          (so the user knows the bot is in the right channels) but
          imports always go through the URL paste box. */}
      {showSlackModal && (
        <div onClick={() => setShowSlackModal(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000, padding: 20 }}>
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} onClick={e => e.stopPropagation()}
            data-testid="slack-modal"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '22px 24px', maxWidth: 620, width: '100%', maxHeight: '85vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
              <div style={{ width: 52, height: 52, borderRadius: 13, background: 'rgba(74,21,75,0.12)', border: '1px solid rgba(74,21,75,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <MessageSquare size={24} color="#4a154b" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ margin: '2px 0 4px', color: 'var(--text-1)', fontSize: 18, fontWeight: 800, letterSpacing: '-0.3px' }}>Slack</h3>
                <p style={{ margin: 0, color: 'var(--text-3)', fontSize: 12.5, lineHeight: 1.5 }}>
                  Save important threads as memories. Paste any Slack thread URL and the full conversation gets captured with a permalink back to Slack.
                </p>
              </div>
              <button onClick={() => setShowSlackModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
            </div>

            {!slackStatus?.connected ? (
              <div data-testid="slack-modal-disconnected">
                <div style={{ padding: '14px 16px', background: 'var(--surface-2)', borderRadius: 12, marginBottom: 14 }}>
                  <div style={{ color: 'var(--text-1)', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>How to connect</div>
                  <ol style={{ color: 'var(--text-2)', fontSize: 12.5, lineHeight: 1.65, paddingLeft: 18, margin: 0 }}>
                    <li><strong>OAuth (recommended)</strong> — your assistant will hand you a one-click Replit OAuth flow at the end of the build. Approve once and Slack stays connected.</li>
                    <li style={{ marginTop: 6 }}><strong>Manual token</strong> — paste a Slack bot token (<code style={{ background: 'var(--surface-3)', padding: '1px 5px', borderRadius: 4 }}>xoxb-...</code>) with <code style={{ background: 'var(--surface-3)', padding: '1px 5px', borderRadius: 4 }}>channels:read</code>, <code style={{ background: 'var(--surface-3)', padding: '1px 5px', borderRadius: 4 }}>groups:read</code>, <code style={{ background: 'var(--surface-3)', padding: '1px 5px', borderRadius: 4 }}>channels:history</code>, <code style={{ background: 'var(--surface-3)', padding: '1px 5px', borderRadius: 4 }}>groups:history</code> scopes into the <code style={{ background: 'var(--surface-3)', padding: '1px 5px', borderRadius: 4 }}>SLACK_BOT_TOKEN</code> secret.</li>
                  </ol>
                </div>
                {slackStatus?.hint && (
                  <div style={{ padding: '10px 12px', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, color: 'var(--text-2)', fontSize: 11.5, marginBottom: 14 }}>
                    {slackStatus.hint}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setShowSlackModal(false)}
                    style={{ flex: 1, padding: '11px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-2)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Close
                  </button>
                  <button onClick={() => void refreshSlackStatus()}
                    data-testid="slack-modal-refresh-status"
                    style={{ flex: 1, padding: '11px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-1)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <RefreshCw size={13} /> Recheck
                  </button>
                </div>
              </div>
            ) : (
              <div data-testid="slack-modal-connected">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'rgba(74,21,75,0.12)', border: '1px solid rgba(74,21,75,0.35)', borderRadius: 10, marginBottom: 12 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#4a154b', boxShadow: '0 0 8px #4a154b' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'var(--text-1)', fontSize: 12.5, fontWeight: 700 }}>
                      Connected{slackStatus.team ? ` to ${slackStatus.team}` : ''}{slackStatus.user ? ` as ${slackStatus.user}` : ''}
                      <span style={{ marginLeft: 8, padding: '1px 7px', background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 9.5, color: 'var(--text-3)', fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase' }}>
                        {slackStatus.source === 'replit_oauth' ? 'OAuth' : 'Token'}
                      </span>
                    </div>
                  </div>
                  <button onClick={() => void refreshSlackStatus()}
                    title="Refresh"
                    data-testid="slack-modal-refresh"
                    style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, padding: 5, cursor: 'pointer', color: 'var(--text-2)', display: 'flex', alignItems: 'center' }}>
                    <RefreshCw size={12} />
                  </button>
                </div>

                {/* Paste-URL import — the primary action. The channel
                    list below is informational so the user can confirm
                    the bot is where they expect, but they can't import
                    by clicking a channel (no clear "which thread"
                    semantics for that). */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ color: 'var(--text-3)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 6 }}>
                    Import a thread
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      value={slackThreadUrl}
                      onChange={(e) => setSlackThreadUrl(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleSlackImportUrl(); }}
                      placeholder="https://workspace.slack.com/archives/C0123ABCD/p1234567890123456"
                      data-testid="slack-modal-url"
                      disabled={slackImporting}
                      style={{ flex: 1, padding: '8px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text-1)', fontSize: 12, fontFamily: 'inherit' }}
                    />
                    <button
                      disabled={slackImporting || !slackThreadUrl.trim()}
                      onClick={() => void handleSlackImportUrl()}
                      data-testid="slack-modal-import"
                      style={{ padding: '8px 14px', background: slackImporting ? 'var(--surface-3)' : 'rgba(74,21,75,0.12)', border: '1px solid rgba(74,21,75,0.35)', borderRadius: 9, color: '#a78bfa', fontSize: 12, fontWeight: 700, cursor: slackImporting ? 'wait' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5 }}>
                      {slackImporting ? <Loader2 size={11} className="spin" /> : <Plus size={11} />} Import
                    </button>
                  </div>
                  <div style={{ color: 'var(--text-3)', fontSize: 10.5, marginTop: 6 }}>
                    Tip: in Slack, hover any message → click ⋮ → Copy link.
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ color: 'var(--text-3)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                    Channels visible to the bot ({slackChannels?.length ?? '…'})
                  </div>
                  <button onClick={() => void loadSlackChannels()}
                    data-testid="slack-modal-reload-channels"
                    style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, padding: '3px 9px', cursor: 'pointer', color: 'var(--text-2)', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <RefreshCw size={11} /> Reload
                  </button>
                </div>

                {slackChannelsLoading ? (
                  <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>
                    <Loader2 size={16} className="spin" /> Loading channels...
                  </div>
                ) : slackChannels && slackChannels.length === 0 ? (
                  <div style={{ padding: '20px 14px', textAlign: 'center', background: 'var(--surface-2)', borderRadius: 10, color: 'var(--text-3)', fontSize: 12 }}>
                    No channels visible. Invite the bot to a channel and reload.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflow: 'auto' }} data-testid="slack-modal-channel-list">
                    {(slackChannels || []).map((ch) => (
                      <div key={ch.id}
                        data-testid={`slack-modal-channel-${ch.id}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8 }}>
                        <Hash size={11} color="#a78bfa" style={{ flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: 'var(--text-1)', fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {ch.name}
                            {ch.is_private && (
                              <span style={{ marginLeft: 6, padding: '1px 6px', background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 9, color: 'var(--text-3)', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>
                                Private
                              </span>
                            )}
                          </div>
                          {ch.topic && (
                            <div style={{ color: 'var(--text-3)', fontSize: 10.5, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {ch.topic}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
                  <button onClick={() => setShowSlackModal(false)}
                    style={{ flex: 1, padding: '10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-2)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Close
                  </button>
                  <button onClick={() => void handleSlackDisconnect()}
                    data-testid="slack-modal-disconnect"
                    style={{ flex: 1, padding: '10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, color: '#ef4444', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <Power size={12} /> Disconnect
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}

      {/* CONNECT MODAL */}
      {selectedIntegration && (
        <div onClick={() => setSelectedIntegration(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000, padding: 20 }}>
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} onClick={e => e.stopPropagation()}
            style={{ background: 'var(--surface)', border: `1px solid ${selectedIntegration.color}50`, borderRadius: 16, padding: '24px 26px', maxWidth: 480, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 16 }}>
              <div style={{ width: 56, height: 56, borderRadius: 13, background: `${selectedIntegration.color}15`, border: `1px solid ${selectedIntegration.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <selectedIntegration.icon size={26} color={selectedIntegration.color} />
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: '2px 0 4px', color: 'var(--text-1)', fontSize: 18, fontWeight: 800, letterSpacing: '-0.3px' }}>{selectedIntegration.name}</h3>
                <p style={{ margin: 0, color: 'var(--text-3)', fontSize: 12.5, lineHeight: 1.5 }}>{selectedIntegration.desc}</p>
              </div>
            </div>
            <div style={{ padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 11, marginBottom: 14 }}>
              <div style={{ color: 'var(--text-3)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 8 }}>Capabilities</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {selectedIntegration.capabilities.map(cap => (
                  <span key={cap} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px', background: `${selectedIntegration.color}12`, border: `1px solid ${selectedIntegration.color}30`, borderRadius: 12, color: selectedIntegration.color, fontSize: 10.5, fontWeight: 700 }}>
                    <Hash size={9} /> {cap}
                  </span>
                ))}
              </div>
            </div>
            <div style={{ padding: '12px 14px', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 11, marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <Shield size={14} color="#a78bfa" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
                Recall X247 only requests minimal scopes needed for capture. Your data stays in your brain — we never share or sell it.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setSelectedIntegration(null)} style={{ flex: 1, padding: '11px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-2)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button style={{ flex: 2, padding: '11px', background: `linear-gradient(135deg, ${selectedIntegration.color}, ${selectedIntegration.color}cc)`, border: 'none', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, boxShadow: `0 4px 16px ${selectedIntegration.color}50` }}>
                Authorise {selectedIntegration.name} <ArrowRight size={13} />
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default IntegrationsPage;
