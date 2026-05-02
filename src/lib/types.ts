export type View = 'dashboard' | 'capture' | 'vault' | 'recall' | 'tasks' | 'calendar' | 'flashcards' | 'settings' | 'timeline' | 'graph' | 'workspace' | 'analytics' | 'agent';

export interface GlossaryTerm {
  term: string;
  definition: string;
}

export interface Memory {
  id: string;
  title: string;
  summary: string;
  key_points: string[];
  tags: string[];
  domain: string;
  source_type: 'youtube' | 'web' | 'pdf' | 'note';
  source_url?: string;
  created_at: string;
  duplicate?: boolean;
  duplicate_of?: {
    id: string;
    title: string;
    domain?: string;
    source_type?: string;
    source_url?: string;
    created_at?: string;
  };
  // True when AI analysis failed (rate limit / out of credits / bad key)
  // and the memory was saved with raw-text fallback. UI should show a
  // gentle notice and may offer a "Re-analyze with AI" action later.
  ai_analysis_pending?: boolean;
  // Short, human-friendly reason the AI step was skipped.
  ai_error_reason?: string;
  // Rich analysis (optional — populated by capture agent)
  executive_summary?: string;
  action_items?: string[];
  glossary?: GlossaryTerm[];
  study_questions?: string[];
  notes?: string;
  // PDF-specific (optional)
  pdf_data?: string;        // data:application/pdf;base64,...
  pdf_pages?: number;
  pdf_size_kb?: number;
  pdf_word_count?: number;
  // Image-specific (optional, populated for memories created from a
  // session-tray image). `image_data` is the original
  // base64 data URL so vault detail can render the picture inline;
  // `ocr_text` is the recognized text body extracted by vision OCR.
  image_data?: string;      // data:image/...;base64,... — full quality, only on /memories/{id}
  // Pre-downscaled thumbnail (~320 px long edge) returned by /memories
  // list responses. Vault list/grid cards prefer this so list payloads
  // stay tiny even for users with many captured frames.
  image_thumbnail?: string;
  image_caption?: string;
  ocr_text?: string;
  // Inbox triage flags
  reviewed?: boolean;
  archived?: boolean;
  // Library power-ups (Task #18)
  pinned?: boolean;
  trashed_at?: string;
  project_id?: string;
  // Optional preview-only metadata surfaced by the capture preview pipeline
  // (none of these are persisted on the saved memory document — they're
  // displayed in the Capture page metadata strip).
  language?: string;
  guardian_confidence?: number;
  guardian_score?: number;
  quality_score?: number;
  // Override flag sent by the frontend's "Save anyway" path so the backend
  // skips its URL/content-hash dedup guards. Server-side only.
  force_new?: boolean;
  // ─── Cross-link slots (W1 capture-enrichment) ────────────────────
  // Set on save via /capture/save-bundle or later via the memory-detail
  // command center (W2). Empty arrays / null when no links exist — the
  // memory itself is the source of truth, the linked entities live in
  // their own collections (workspace_projects, tasks, calendar_events,
  // habits, revisits) and are dereferenced when the detail page loads.
  folder_ref?: MemoryFolderRef | null;
  linked_memory_ids?: string[];
  linked_task_ids?: string[];
  linked_event_ids?: string[];
  linked_habit_ids?: string[];
  linked_revisit_ids?: string[];
  // ─── AI suggestion chips (preview-only, never persisted) ────────────
  // Surfaced by /capture (preview=true) so the capture page can render
  // ready-to-accept enrichment suggestions next to the analysis output.
  // The backend strips these before saving; whatever the user accepts
  // becomes a real link via /capture/save-bundle.
  suggested_folder_hint?: string;
  suggested_tasks?: SuggestedTask[];
  suggested_event?: SuggestedEvent | null;
  suggested_habit_link?: SuggestedHabitLink | null;
  suggested_revisit?: SuggestedRevisit | null;
}

export interface MemoryFolderRef {
  project_id: string;
  folder_id: string;
  section_id?: string;
}

export interface SuggestedTask {
  title: string;
  priority: 'low' | 'medium' | 'high';
}

export interface SuggestedEvent {
  title: string;
  date: string;            // YYYY-MM-DD
  time: string;            // HH:MM (24h)
  duration_minutes: number;
}

export interface SuggestedHabitLink {
  habit_id: string;
  reason?: string;
}

/**
 * Per-source-type "don't suggest again" preferences, keyed by chip
 * dimension. Each list holds source_type strings ("note", "url",
 * "pdf", "youtube", "voice", "image", "session", "manual"). When a
 * source_type appears in a list, the corresponding chip suppresses
 * its AI pre-fill on the next capture of that type — the chip itself
 * stays visible so the user can still add manually.
 */
export interface CaptureEnrichmentPrefs {
  user_id?: string;
  disable_tasks: string[];
  disable_events: string[];
  disable_habits: string[];
  disable_revisits: string[];
  disable_folders: string[];
  disable_related: string[];
  updated_at?: string;
}

export interface SuggestedRevisit {
  frequency: 'once' | 'daily' | 'weekly' | 'monthly';
  next_due?: string;       // YYYY-MM-DD
}

export interface FlatFolder {
  project_id: string;
  project_name: string;
  folder_id: string;
  folder_name: string;
  color: string;
  recent_use_at: string;
  item_count: number;
}

export interface RelatedMemoryHit {
  id: string;
  title: string;
  snippet: string;
  score: number;
  reason: string;
}

// ─── Memory cross-link payload (W2 P2) ────────────────────────────────
// Hydrated by GET /memories/{id}/links so the detail-page links panel
// can render every related entity in one request. Each entity type has
// just the few fields the panel needs — full records still live in
// their own collection and are reachable via the per-item Open button.
export interface MemoryLinkFolderItem {
  project_id: string;
  project_name: string;
  folder_id: string;
  folder_name: string;
  color?: string;
}
export interface MemoryLinkTaskItem {
  id: string;
  title: string;
  status?: string;
  priority?: string;
  due_date?: string;
}
export interface MemoryLinkEventItem {
  id: string;
  title: string;
  date?: string;
  time?: string;
  duration_minutes?: number;
}
export interface MemoryLinkRevisitItem {
  id: string;
  title?: string;
  frequency?: string;
  next_due?: string;
  status?: string;
}
export interface MemoryLinkHabitItem {
  id: string;
  name: string;
  color?: string;
  streak?: number;
}
export interface MemoryLinkRelatedItem {
  id: string;
  title: string;
  source_type?: string;
  score?: number;
}
export interface MemoryLinkExternalItem {
  id?: string;
  source: string;
  source_id?: string;
  title?: string;
  url?: string;
}
export interface MemoryLinks {
  folder: MemoryLinkFolderItem | null;
  tasks: MemoryLinkTaskItem[];
  events: MemoryLinkEventItem[];
  revisits: MemoryLinkRevisitItem[];
  habits: MemoryLinkHabitItem[];
  flashcards: any[];
  related_memories: MemoryLinkRelatedItem[];
  external_refs: MemoryLinkExternalItem[];
}

// Mirrors backend `_LINK_KINDS` in app/library_agent.py — adding a new
// kind here without a backend match will 400 on POST /memories/{id}/link.
// Note: 'flashcard' is intentionally absent — flashcard decks aren't a
// real collection yet, so the UI hides unlink for that section.
export type MemoryLinkKind =
  | 'folder' | 'task' | 'event' | 'revisit'
  | 'habit'  | 'memory' | 'external_ref';

export interface Flashcard {
  question: string;
  answer: string;
}

export interface AgentMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  type: 'text' | 'thinking' | 'steps' | 'welcome' | 'streaming' | 'nav' | 'clarification';
  steps?: AgentStepData[];
  agents?: string[];
  workflow_id?: string;
  ts: string;
  // For type:'clarification' — orchestrator stopped the loop and is
  // asking the user to disambiguate before proceeding. Rendered as a
  // card with the question and 2-4 option chips.
  clarification?: AgentClarification;
  // For type:'nav' — pre-redirect notice card. Shows the user a short
  // explanation, an inline preview of the top-N matching items, and an
  // explicit "Open" button so they confirm the route change instead of
  // being yanked there silently.
  nav?: {
    path: string;            // e.g. "/focus", "/calendar"
    query?: string;          // optional ?q= for the destination page's search box
    pageLabel: string;       // human label for the destination ("Focus", "Calendar")
    reason: string;          // one-line explainer ("Showing top 3 — open Focus for the full list")
    preview?: NavPreviewItem[];
    autoNavigated?: boolean; // becomes true after the soft auto-redirect fires
  };
}

export interface NavPreviewItem {
  id?: string;
  title: string;
  subtitle?: string;
  icon?: 'task' | 'event' | 'memory' | 'note';
}

export interface AgentStepData {
  step_id: string;
  agent: string;
  tool: string;
  name: string;
  status: 'running' | 'completed' | 'failed';
  input?: string | Record<string, unknown>;
  output_summary?: string;
  error?: string;
  duration_ms?: number;
  // Optional entity-level audit info, populated by the backend after a tool
  // returns. Used by the assistant's "done" chip to render concrete counts
  // like "checked 3 memories, created 1 task". May be absent for stats /
  // unknown tools, in which case the chip falls back to the agent path.
  entity_count?: number | null;
  entity_noun?: string;
  entity_verb?: string;
  // Up to 3 inline preview rows for list-type tools (list_schedule,
  // list_tasks, list_memories, recall_knowledge). Lets the chat surface
  // the actual top items alongside the "X events" chip. Populated by
  // _build_inline_preview on the backend; absent for non-list tools.
  inline_preview?: NavPreviewItem[];
  // Set when this step belongs to a parallel-execution batch — multiple
  // read-only sub-agents fanned out concurrently (e.g. list_tasks +
  // get_daily_briefing in a single user turn). The UI groups all steps
  // sharing a batch_id into a single "parallel" row with a "running in
  // parallel" badge instead of rendering them stacked vertically.
  batch_id?: string;
  parallel?: boolean;
}

// Clarification request — emitted by the backend's `clarification_needed`
// SSE event when the orchestrator decides the user's message is genuinely
// ambiguous and needs a one-tap follow-up before any action runs. Rendered
// inline in the agent chat as a card with the question text + chips for
// each option; clicking an option dispatches it as the next user message.
export interface AgentClarification {
  question: string;
  options: string[];
  reason?: string;
  step_id?: string;
  workflow_id?: string;
}

// ─── Workspace (project / folder / section / item / group) ────────────────────
export type WorkspaceSectionId = 'notes' | 'tasks' | 'ideas' | 'resources';

export interface WorkspaceSection {
  id: WorkspaceSectionId | string;
  name: string;
  icon?: string;
  description?: string;
}

export interface WorkspaceGroup {
  id: string;
  title: string;
  summary?: string;
}

export interface WorkspaceFolder {
  id: string;
  name: string;
  description?: string;
  weight?: number;
  sections?: WorkspaceSection[];
}

export interface WorkspaceItem {
  id: string;
  kind: string;
  ref_id?: string;
  title: string;
  url?: string;
  folder_id?: string;
  section_id?: WorkspaceSectionId | string;
  tags?: string[];
  group_id?: string;
  added_at?: string;
  meta?: {
    type?: 'video' | 'article';
    thumbnail?: string;
    youtube_id?: string;
    channel_title?: string;
    duration_display?: string;
    domain?: string;
    summary?: string;
    source_type?: string;
    tags?: string[];
  };
}

export interface WorkspaceProject {
  id: string;
  name: string;
  description?: string;
  color: string;
  goal_type?: string;
  folders: WorkspaceFolder[];
  items: WorkspaceItem[];
  tasks: { id: string; text: string; folder_id?: string; done: boolean; created_at?: string; due_date?: string; calendar_event_id?: string }[];
  groups?: WorkspaceGroup[];
  default_sections?: WorkspaceSection[];
  created_at?: string;
  updated_at?: string;
}

export interface WorkspaceOrganizeAssignment {
  item_id: string;
  section_id: WorkspaceSectionId | string;
  tags: string[];
  group_id: string;
}

export interface SmartCollectionFilters {
  search?: string;
  domain?: string;
  source?: string;
  tags?: string[];
  pinned_only?: boolean;
  archived?: boolean;
  deep?: boolean;
  sort?: string;
}

export interface SmartCollection {
  id: string;
  name: string;
  filters: SmartCollectionFilters;
  created_at?: string;
  updated_at?: string;
}

export interface BulkApiResponse {
  updated?: number;
  deleted?: number;
  trashed?: number;
  archived?: boolean;
  ids?: string[];
  entity?: string;
  project_id?: string | null;
  error?: string;
  detail?: string;
}

export interface DeepSearchHit {
  id: string;
  title?: string;
  snippet?: string;
  field?: string;
}

export interface DeepSearchResponse {
  memories?: DeepSearchHit[];
  notes?: DeepSearchHit[];
  bookmarks?: DeepSearchHit[];
}

export interface TagIndexEntry {
  name: string;
  memories: number;
  notes: number;
  bookmarks: number;
  total: number;
}

export interface WorkspaceOrganizeResult {
  ok: boolean;
  assignments: WorkspaceOrganizeAssignment[];
  groups: WorkspaceGroup[];
  stats?: { items: number; assigned: number; groups: number };
  error?: string;
}
