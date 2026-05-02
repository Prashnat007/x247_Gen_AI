export interface Memory {
  id?: string;
  source_type: "youtube" | "web" | "pdf" | "note";
  source_url?: string;
  title: string;
  summary: string;
  key_points: string[];
  tags: string[];
  domain: string;
  created_at: string;
  userId: string;
  duplicate?: boolean;
  duplicate_of?: {
    id: string;
    title: string;
    domain?: string;
    source_type?: string;
    source_url?: string;
    created_at?: string;
  };
  /** True when AI analysis failed (rate limit / out of credits / bad key)
   *  and the memory was saved with raw-text fallback. UI should show a
   *  gentle notice and may offer a "Re-analyze with AI" action. */
  ai_analysis_pending?: boolean;
  /** Short, human-friendly reason the AI step was skipped. */
  ai_error_reason?: string;
  /** Cross-link slots populated by the W1 capture-enrichment flow.
   *  Empty arrays / null when no links exist; the linked entities
   *  themselves live in their own collections. */
  folder_ref?: { project_id: string; folder_id: string; section_id?: string } | null;
  linked_memory_ids?: string[];
  linked_task_ids?: string[];
  linked_event_ids?: string[];
  linked_habit_ids?: string[];
  linked_revisit_ids?: string[];
}

export interface Task {
  id?: string;
  title: string;
  linked_memory_id?: string;
  due_date?: string;
  priority: "low" | "medium" | "high";
  status: "todo" | "in-progress" | "done";
  userId: string;
  created_at: string;
}

export interface Schedule {
  id?: string;
  title: string;
  date: string;
  time: string;
  duration_minutes: number;
  linked_task_id?: string;
  gcal_event_id?: string;
  userId: string;
}

export interface Note {
  id?: string;
  title: string;
  content: string;
  tags: string[];
  userId: string;
  created_at: string;
}
