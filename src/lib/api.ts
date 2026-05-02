/**
 * Typed client helpers for the W1 capture-enrichment endpoints.
 * Wraps the bare /workspace/folders/flat, /memories/related and
 * /capture/save-bundle backend routes so capture-page components
 * stay free of fetch/JSON noise.
 */
import type {
  CaptureEnrichmentPrefs,
  FlatFolder,
  Memory,
  RelatedMemoryHit,
  MemoryFolderRef,
  SuggestedTask,
  SuggestedEvent,
} from './types';

export interface CaptureBundleEvent {
  title: string;
  date: string;
  time: string;
  duration_minutes?: number;
  topic?: string;
  description?: string;
}

export interface CaptureBundleRevisit {
  frequency: 'once' | 'daily' | 'weekly' | 'monthly';
  interval_days?: number;
  specific_date?: string;
}

/**
 * Task slot in the bundle payload. Wider than the AI's SuggestedTask
 * because the user can edit a due_date inline before saving.
 */
export interface BundleTask {
  title: string;
  priority: 'low' | 'medium' | 'high';
  due_date?: string;
}

export interface CaptureBundlePayload {
  memory: Partial<Memory>;
  folder_ref?: MemoryFolderRef | null;
  tasks?: BundleTask[];
  event?: CaptureBundleEvent | null;
  revisit?: CaptureBundleRevisit | null;
  habit_link?: { habit_id: string } | null;
  linked_memory_ids?: string[];
}

export interface AutoFiledInfo {
  folder_id: string;
  folder_name: string;
  project_id: string;
  project_name?: string;
  score: number;
  hint: string;
}

export interface BundleResult {
  memory: Memory;
  memory_id: string;
  created_task_ids: string[];
  created_event_ids: string[];
  created_revisit_ids: string[];
  linked_habit_ids: string[];
  linked_memory_ids: string[];
  errors: string[];
  /** P4B — present when the W4 auto-folder layer silently filed this
   *  memory into an existing folder above the 0.7 confidence bar. The
   *  capture page surfaces an "AI filed this in X — Undo" toast. */
  auto_filed?: AutoFiledInfo | null;
}

/**
 * Returns every folder across every workspace project as a flat,
 * recency-sorted list. Powers the capture-enrichment Folder chip
 * dropdown.
 */
export async function fetchFlatFolders(): Promise<FlatFolder[]> {
  const res = await fetch('/workspace/folders/flat');
  if (!res.ok) throw new Error(`flat folders failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.folders) ? (data.folders as FlatFolder[]) : [];
}

/**
 * Find memories similar to the given draft text + optional tag set.
 * Used by the Related chip on the capture preview BEFORE the new
 * memory has a stable id.
 */
export async function fetchRelatedMemories(
  text: string,
  tags?: string[],
  excludeId?: string,
  limit: number = 5,
): Promise<RelatedMemoryHit[]> {
  const res = await fetch('/memories/related', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      tags: tags ?? [],
      exclude_id: excludeId ?? '',
      limit,
    }),
  });
  if (!res.ok) throw new Error(`related memories failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.items) ? (data.items as RelatedMemoryHit[]) : [];
}

/**
 * Save a captured memory plus all user-accepted enrichments in a
 * single round trip. Each enrichment is best-effort on the server —
 * the memory is the source of truth, side-effect failures surface in
 * `result.errors` so the UI can show a partial-success toast.
 */
export async function saveCaptureBundle(
  payload: CaptureBundlePayload,
): Promise<BundleResult> {
  const res = await fetch('/capture/save-bundle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.detail || ''; } catch { /* ignore */ }
    throw new Error(detail || `save bundle failed: ${res.status}`);
  }
  return (await res.json()) as BundleResult;
}

export interface HabitOption {
  id: string;
  name: string;
  color?: string;
}

/**
 * Lightweight habit list for the capture-enrichment Habit chip.
 * Maps the full /habits payload down to what the dropdown needs.
 * Throws on non-OK so HabitChip's error path can render a real
 * message instead of silently showing "no habits".
 */
export async function fetchHabits(): Promise<HabitOption[]> {
  const res = await fetch('/habits');
  if (!res.ok) throw new Error(`habits failed: ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data
    .filter((h: any) => h && h.id && h.name)
    .map((h: any) => ({ id: String(h.id), name: String(h.name), color: h.color }));
}

/**
 * Fetch the current user's per-source-type "don't suggest again"
 * preferences for the capture-enrichment chips. Soft-fails to a
 * fully-empty prefs object so the EnrichPanel always renders chips
 * even when the prefs endpoint is briefly unavailable.
 */
export async function getCaptureEnrichmentPrefs(): Promise<CaptureEnrichmentPrefs> {
  const empty: CaptureEnrichmentPrefs = {
    disable_tasks: [], disable_events: [], disable_habits: [],
    disable_revisits: [], disable_folders: [], disable_related: [],
  };
  try {
    const res = await fetch('/preferences/capture_enrichment');
    if (!res.ok) return empty;
    const data = await res.json();
    return {
      user_id: data?.user_id,
      disable_tasks:    Array.isArray(data?.disable_tasks)    ? data.disable_tasks    : [],
      disable_events:   Array.isArray(data?.disable_events)   ? data.disable_events   : [],
      disable_habits:   Array.isArray(data?.disable_habits)   ? data.disable_habits   : [],
      disable_revisits: Array.isArray(data?.disable_revisits) ? data.disable_revisits : [],
      disable_folders:  Array.isArray(data?.disable_folders)  ? data.disable_folders  : [],
      disable_related:  Array.isArray(data?.disable_related)  ? data.disable_related  : [],
      updated_at: data?.updated_at,
    };
  } catch {
    return empty;
  }
}

/**
 * Replace the saved capture-enrichment prefs. Backend strips unknown
 * keys + unknown source_type strings, so the response is the truthy
 * persisted shape — caller should store that, not the request body.
 */
export async function setCaptureEnrichmentPrefs(
  prefs: CaptureEnrichmentPrefs,
): Promise<CaptureEnrichmentPrefs> {
  const res = await fetch('/preferences/capture_enrichment', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  });
  if (!res.ok) throw new Error(`set prefs failed: ${res.status}`);
  return (await res.json()) as CaptureEnrichmentPrefs;
}

/**
 * Re-run the capture-enrichment suggestion pipeline against an
 * existing saved memory. Returns the fresh suggested_* block which
 * the caller should both apply locally and warm into the
 * CaptureSuggestionsContext cache so subsequent reads are instant.
 */
export interface ResuggestResult {
  id: string;
  suggested_folder_hint?: string;
  suggested_tasks?: SuggestedTask[];
  suggested_event?: SuggestedEvent | null;
  suggested_habit_link?: { habit_id: string; reason?: string } | null;
  suggested_revisit?: { frequency: 'once' | 'daily' | 'weekly' | 'monthly'; next_due?: string } | null;
}

export async function reanalyzeMemorySuggestions(memoryId: string): Promise<ResuggestResult> {
  const res = await fetch(`/memories/${memoryId}/re-suggest`, { method: 'POST' });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.detail || ''; } catch { /* ignore */ }
    throw new Error(detail || `re-suggest failed: ${res.status}`);
  }
  return (await res.json()) as ResuggestResult;
}

export type { FlatFolder, RelatedMemoryHit, SuggestedTask, SuggestedEvent };

// ─── Memory cross-links (W2 P2 — detail-page command center) ──────────
import type { MemoryLinks, MemoryLinkKind } from './types';

/**
 * Hydrate every cross-link for a memory in one round trip. The backend
 * resolves folder_ref + linked_*_ids into full mini-records and also
 * reverse-scans to surface entities that point at this memory but
 * aren't yet listed in linked_*_ids (so the panel never silently
 * drops links that were created from the other side).
 */
export async function fetchMemoryLinks(memoryId: string): Promise<MemoryLinks> {
  const res = await fetch(`/memories/${encodeURIComponent(memoryId)}/links`);
  if (!res.ok) throw new Error(`fetch links failed: ${res.status}`);
  const data = await res.json();
  return {
    folder: data?.folder ?? null,
    tasks: Array.isArray(data?.tasks) ? data.tasks : [],
    events: Array.isArray(data?.events) ? data.events : [],
    revisits: Array.isArray(data?.revisits) ? data.revisits : [],
    habits: Array.isArray(data?.habits) ? data.habits : [],
    flashcards: Array.isArray(data?.flashcards) ? data.flashcards : [],
    related_memories: Array.isArray(data?.related_memories) ? data.related_memories : [],
    external_refs: Array.isArray(data?.external_refs) ? data.external_refs : [],
  };
}

/**
 * Add a cross-link from this memory to another entity. Backend writes
 * BOTH sides (memory.linked_*_ids + the target's reverse pointer) so
 * either side stays consistent without a second round trip.
 */
export async function linkMemory(
  memoryId: string,
  kind: MemoryLinkKind,
  ref_id: string,
): Promise<{ success: boolean; kind: string; ref_id: string }> {
  const res = await fetch(`/memories/${encodeURIComponent(memoryId)}/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, ref_id }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.detail || ''; } catch { /* ignore */ }
    throw new Error(detail || `link failed: ${res.status}`);
  }
  return await res.json();
}

/**
 * Drop a cross-link. Mirrors linkMemory — clears both pointers so the
 * UI doesn't see a half-dead reference on next refresh. ref_id is path-
 * encoded so values like "project_id/folder_id" survive route parsing.
 */
export async function unlinkMemory(
  memoryId: string,
  kind: MemoryLinkKind,
  ref_id: string,
): Promise<{ success: boolean }> {
  const res = await fetch(
    `/memories/${encodeURIComponent(memoryId)}/link/${encodeURIComponent(kind)}/${ref_id.split('/').map(encodeURIComponent).join('/')}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.detail || ''; } catch { /* ignore */ }
    throw new Error(detail || `unlink failed: ${res.status}`);
  }
  return await res.json();
}

/* ─── P4B — AI auto-link layer (W4 frontend surface) ──────────────── */

export interface AISuggestion {
  id: string;
  user_id?: string;
  /** task | event | revisit | habit | memory | folder | external_ref | folder_bundle */
  kind: string;
  /** Target id for the proposed link. Empty for `folder_bundle` —
   *  cluster suggestions don't auto-create, the UI hands the user
   *  the memory_ids in the payload to use in the workspace creator. */
  ref_id: string;
  for_memory_id: string;
  reason: string;
  confidence: number;
  signature: string;
  status: 'pending' | 'accepted' | 'rejected';
  source: string;
  payload?: Record<string, any>;
  created_at: string;
}

/**
 * Pending AI suggestions tied to a specific memory. Powers the
 * MemoryLinksPanel "AI thinks this also relates to" sub-section.
 * Soft-fails to [] so a backend hiccup never blocks the panel render.
 */
export async function fetchSuggestionsForMemory(memoryId: string): Promise<AISuggestion[]> {
  if (!memoryId) return [];
  try {
    const res = await fetch(`/suggestions/links?for_memory=${encodeURIComponent(memoryId)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.suggestions) ? (data.suggestions as AISuggestion[]) : [];
  } catch {
    return [];
  }
}

/**
 * All pending AI suggestions for the current user, newest first.
 * Powers the daily briefing's "AI Suggestions" side card. Caps at
 * 50 by default to keep the briefing payload bounded.
 */
export async function fetchSuggestionsInbox(limit: number = 50): Promise<AISuggestion[]> {
  try {
    const res = await fetch(`/suggestions/inbox?limit=${Math.max(1, Math.min(200, limit))}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.suggestions) ? (data.suggestions as AISuggestion[]) : [];
  } catch {
    return [];
  }
}

/**
 * Apply the suggested link and mark the suggestion accepted. Throws
 * on backend errors so the caller can show a "couldn't accept" toast
 * instead of silently dropping the click.
 */
export async function acceptSuggestion(suggestionId: string): Promise<{ success: boolean; applied?: any; kind?: string }> {
  const res = await fetch(`/suggestions/${encodeURIComponent(suggestionId)}/accept`, { method: 'POST' });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.detail || ''; } catch { /* ignore */ }
    throw new Error(detail || `accept failed: ${res.status}`);
  }
  return await res.json();
}

/**
 * Mark a suggestion rejected. Backend also writes a dismissal so the
 * same signature won't resurface in future scanner runs.
 */
export async function rejectSuggestion(suggestionId: string): Promise<{ success: boolean }> {
  const res = await fetch(`/suggestions/${encodeURIComponent(suggestionId)}/reject`, { method: 'POST' });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.detail || ''; } catch { /* ignore */ }
    throw new Error(detail || `reject failed: ${res.status}`);
  }
  return await res.json();
}

/**
 * Set or clear the folder link on a memory. `folderRef = null`
 * undoes an auto-fill (capture page Undo button), set replaces.
 * Returns the backend success payload.
 */
export async function setMemoryFolder(
  memoryId: string,
  folderRef: { project_id: string; folder_id: string; section_id?: string } | null,
): Promise<{ success: boolean }> {
  const res = await fetch(`/memories/${encodeURIComponent(memoryId)}/folder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder_ref: folderRef }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.detail || ''; } catch { /* ignore */ }
    throw new Error(detail || `set folder failed: ${res.status}`);
  }
  return await res.json();
}

/**
 * Per-user opt-out toggles for the W4 auto-link layer. All default
 * to true server-side so a fresh user keeps the feature on.
 */
export interface AutoLinkPrefs {
  auto_folder_enabled: boolean;
  habit_suggestions_enabled: boolean;
  cluster_suggestions_enabled: boolean;
  user_id?: string;
  updated_at?: string;
}

const AUTO_LINK_DEFAULTS: AutoLinkPrefs = {
  auto_folder_enabled: true,
  habit_suggestions_enabled: true,
  cluster_suggestions_enabled: true,
};

export async function getAutoLinkPrefs(): Promise<AutoLinkPrefs> {
  try {
    const res = await fetch('/preferences/auto_link');
    if (!res.ok) return { ...AUTO_LINK_DEFAULTS };
    const data = await res.json();
    return {
      auto_folder_enabled: data?.auto_folder_enabled !== false,
      habit_suggestions_enabled: data?.habit_suggestions_enabled !== false,
      cluster_suggestions_enabled: data?.cluster_suggestions_enabled !== false,
      user_id: data?.user_id,
      updated_at: data?.updated_at,
    };
  } catch {
    return { ...AUTO_LINK_DEFAULTS };
  }
}

export async function setAutoLinkPrefs(prefs: Partial<AutoLinkPrefs>): Promise<AutoLinkPrefs> {
  const body: AutoLinkPrefs = {
    auto_folder_enabled: prefs.auto_folder_enabled !== false,
    habit_suggestions_enabled: prefs.habit_suggestions_enabled !== false,
    cluster_suggestions_enabled: prefs.cluster_suggestions_enabled !== false,
  };
  const res = await fetch('/preferences/auto_link', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`set auto-link prefs failed: ${res.status}`);
  return (await res.json()) as AutoLinkPrefs;
}

/* ──────────────────────── P5A: Notion integration ─────────────────────────
 * Thin client over the four /integrations/notion/* endpoints. The status
 * helper never throws — a network blip or 401 just collapses to
 * `{connected:false}` so callers (IntegrationsPage card, CapturePage source
 * picker) can render their not-connected state without try/catching every
 * call site. The other helpers do throw on non-2xx so the IntegrationsPage
 * import action can surface the error toast with the real backend reason.
 */

export interface NotionSyncedDatabase {
  database_id: string;
  mode: 'sync' | 'one-time' | string;
  last_synced_at: string | null;
  last_synced_count: number;
}

export interface NotionStatus {
  connected: boolean;
  source?: 'replit_oauth' | 'manual_token';
  workspace_name?: string;
  scopes?: string[];
  last_synced_at?: string | null;
  synced_databases?: NotionSyncedDatabase[];
  hint?: string;
}

export interface NotionDatabase {
  id: string;
  title: string;
  last_edited_time: string;
}

export interface NotionImportResult {
  imported: number;
  updated: number;
  failed: number;
  total_pages: number;
  sample_ids: string[];
  mode: 'one-time' | 'sync' | string;
}

export interface NotionImportPageResult {
  memory_id: string;
  page_id: string;
  title: string;
  url: string;
  created: boolean;
  updated: boolean;
}

export async function getNotionStatus(): Promise<NotionStatus> {
  try {
    const res = await fetch('/integrations/notion/status');
    if (!res.ok) return { connected: false };
    return (await res.json()) as NotionStatus;
  } catch {
    return { connected: false };
  }
}

export async function listNotionDatabases(): Promise<NotionDatabase[]> {
  const res = await fetch('/integrations/notion/databases');
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`list notion databases failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data?.databases ?? []) as NotionDatabase[];
}

export async function importNotionDatabase(
  databaseId: string,
  mode: 'one-time' | 'sync' = 'one-time',
): Promise<NotionImportResult> {
  const res = await fetch('/integrations/notion/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ database_id: databaseId, mode }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`notion import failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as NotionImportResult;
}

export async function listNotionDatabasePages(
  databaseId: string,
  limit = 50,
): Promise<Array<{ page_id: string; title: string; url: string; last_edited_time?: string }>> {
  const res = await fetch(`/integrations/notion/databases/${encodeURIComponent(databaseId)}/pages?limit=${limit}`);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`list notion pages failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data?.pages ?? []) as Array<{ page_id: string; title: string; url: string; last_edited_time?: string }>;
}

export async function importNotionPage(pageId: string): Promise<NotionImportPageResult> {
  const res = await fetch('/integrations/notion/import-page', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page_id: pageId }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`notion import-page failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as NotionImportPageResult;
}

export async function disconnectNotion(): Promise<{ disconnected: boolean; hint?: string; removed_sync_rows?: number }> {
  const res = await fetch('/integrations/notion/disconnect', { method: 'POST' });
  if (!res.ok) throw new Error(`notion disconnect failed: ${res.status}`);
  return await res.json();
}

/* ──────────────────────── P5B: Gmail integration ──────────────────────────
 * Same shape as the Notion helpers above. `getGmailStatus` collapses errors
 * to `{connected:false}` so callers (IntegrationsPage card, CapturePage
 * source picker) can render the not-connected state without try/catching.
 * The other helpers throw on non-2xx so the modal can show the real
 * backend error in a toast.
 */

export interface GmailStatus {
  connected: boolean;
  source?: 'replit_oauth' | 'manual_token';
  email?: string;
  scopes?: string[];
  hint?: string;
}

export interface GmailLabel {
  id: string;
  name: string;
  type: 'system' | 'user' | string;
}

export interface GmailMessageRow {
  id: string;
  thread_id: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  label_ids: string[];
}

export interface GmailImportResult {
  memory_id: string;
  message_id: string;
  subject: string;
  url: string;
  created: boolean;
  updated: boolean;
  attachments_count: number;
}

export async function getGmailStatus(): Promise<GmailStatus> {
  try {
    const res = await fetch('/integrations/gmail/status');
    if (!res.ok) return { connected: false };
    return (await res.json()) as GmailStatus;
  } catch {
    return { connected: false };
  }
}

export async function listGmailLabels(): Promise<GmailLabel[]> {
  const res = await fetch('/integrations/gmail/labels');
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`list gmail labels failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data?.labels ?? []) as GmailLabel[];
}

export async function searchGmail(opts: {
  query?: string;
  labelId?: string;
  limit?: number;
}): Promise<GmailMessageRow[]> {
  const params = new URLSearchParams();
  if (opts.query) params.set('q', opts.query);
  if (opts.labelId) params.set('label_id', opts.labelId);
  if (opts.limit) params.set('limit', String(opts.limit));
  const res = await fetch(`/integrations/gmail/search?${params.toString()}`);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`gmail search failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data?.messages ?? []) as GmailMessageRow[];
}

export async function importGmailMessage(messageId: string): Promise<GmailImportResult> {
  const res = await fetch('/integrations/gmail/import-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message_id: messageId }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`gmail import-message failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as GmailImportResult;
}

export async function disconnectGmail(): Promise<{ disconnected: boolean; hint?: string }> {
  const res = await fetch('/integrations/gmail/disconnect', { method: 'POST' });
  if (!res.ok) throw new Error(`gmail disconnect failed: ${res.status}`);
  return await res.json();
}

/* ──────────────────────── P5C: Slack integration ──────────────────────────
 * Same shape as the Notion + Gmail helpers above. `getSlackStatus` collapses
 * errors to `{connected:false}` so the IntegrationsPage card and the
 * CapturePage chip can render the not-connected state without try/catching.
 * The other helpers throw on non-2xx so the modal can show the real backend
 * error in a toast.
 */

export interface SlackStatus {
  connected: boolean;
  source?: 'replit_oauth' | 'manual_token';
  team?: string;
  team_id?: string;
  user?: string;
  user_id?: string;
  url?: string;
  scopes?: string[];
  hint?: string;
}

export interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
  topic: string;
}

export interface SlackImportResult {
  memory_id: string;
  channel_id: string;
  thread_ts: string;
  title: string;
  url: string;
  created: boolean;
  updated: boolean;
  message_count: number;
}

export async function getSlackStatus(): Promise<SlackStatus> {
  try {
    const res = await fetch('/integrations/slack/status');
    if (!res.ok) return { connected: false };
    return (await res.json()) as SlackStatus;
  } catch {
    return { connected: false };
  }
}

export async function listSlackChannels(): Promise<SlackChannel[]> {
  const res = await fetch('/integrations/slack/channels');
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`list slack channels failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data?.channels ?? []) as SlackChannel[];
}

export async function importSlackThread(opts: {
  url?: string;
  channelId?: string;
  threadTs?: string;
}): Promise<SlackImportResult> {
  const body: Record<string, string> = {};
  if (opts.url) body.url = opts.url;
  if (opts.channelId) body.channel_id = opts.channelId;
  if (opts.threadTs) body.thread_ts = opts.threadTs;
  const res = await fetch('/integrations/slack/import-thread', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`slack import-thread failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as SlackImportResult;
}

export async function disconnectSlack(): Promise<{ disconnected: boolean; hint?: string }> {
  const res = await fetch('/integrations/slack/disconnect', { method: 'POST' });
  if (!res.ok) throw new Error(`slack disconnect failed: ${res.status}`);
  return await res.json();
}
