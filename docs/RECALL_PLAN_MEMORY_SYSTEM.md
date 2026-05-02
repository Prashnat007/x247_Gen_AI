# Recall X247 — Plan, Memory & Recall System

Backend design notes for the four capabilities added on 2026-04-27:

1. AI-suggested actions on detected work ("Create Plan / Add Task / Save to Memory")
2. Step-by-step task breakdown with timeline + optional deadline
3. "Save to Memory" with anti-clutter dedup
4. Workspace recall ("Show my previous work on X")

All endpoints are FastAPI, all storage is the existing Firestore-mock layer
(`workspace_projects`, `tasks`, `memories` collections).

---

## 1. Detect → Suggest → Apply (Insights)

### Flow

```
User opens a workspace project
        │
        ▼
POST /workspace/projects/{id}/extract-insights
        │  ├─ collects project items (notes, links, tasks)
        │  ├─ runs LLM with strict JSON schema
        │  └─ validates each suggestion (priority, due_in_days clamp 1-60,
        │       folder_id ∈ project.folders, action ∈ {add_task, create_plan, save_to_memory})
        ▼
{ insights: [{id, title, detail, priority, suggested_actions:[...]}] }
        │
        ▼  (user picks one suggestion)
POST /workspace/projects/{id}/insights/apply
        │  ├─ RE-validates the chosen action server-side (never trusts the client)
        │  ├─ sanitises insight envelope to {id, title, detail, priority}
        │  └─ routes to:
        │       add_task        → task_agent.create_task
        │       create_plan     → plan_agent.generate_plan + ingest_plan (sibling project)
        │       save_to_memory  → capture_agent.save_memory
        ▼
{ ok: true, action: "...", result: {...} }
```

### Why the apply path re-validates

The client could be tampered with. So even after `extract-insights` validates,
`apply` re-runs `_validate_actions([action])` and re-checks `folder_id` against
the project's current folder list. Adversarial smoke tests confirmed:

| Attack                                  | Result                |
|-----------------------------------------|-----------------------|
| Forged action type (`"delete_all"`)     | 400 invalid action    |
| Forged folder_id from another project   | Action dropped        |
| `due_in_days = 9999`                    | Clamped to 60         |
| Priority `"super_urgent"`               | Coerced to `"high"`   |

---

## 2. Task Breakdown (`POST /tasks/breakdown`)

Different from `generate_plan` (4-agent ~30s curriculum builder). This is a
**single LLM call** that turns one task into 3-7 ordered micro-steps with dates.

### Request

```json
{
  "task_title": "Prepare GenAI APAC 2026 hackathon submission video",
  "context": "Need to record 3-min demo, polish slides, upload to YouTube",
  "days": 3,
  "start_date": "",            // optional, defaults to today
  "deadline": "2026-05-10",    // optional, caps `days`
  "persist_as_subtasks": false,
  "parent_task_id": ""         // if set, breakdown uses parent's title; subtasks link back
}
```

### Validation rules (server-side, never trust LLM)

- `days` clamped to 1..14 and further capped by `(deadline - start_date)`.
- Each step's `day_offset` clamped to `0..days-1`.
- `est_minutes` clamped to 15..240.
- Title trimmed to 120 chars, notes to 200.
- Max 7 steps kept; empty-title steps dropped.
- `due_date` is computed server-side (`start + day_offset` days), not from LLM.

### Example response (real, from smoke test)

```json
{
  "ok": true,
  "task_title": "Prepare GenAI APAC 2026 hackathon submission video",
  "days": 3,
  "start_date": "2026-04-27",
  "deadline": "2026-05-10",
  "summary": "Draft, record, polish, edit, then upload the hackathon submission video.",
  "total_minutes": 420,
  "steps": [
    { "order": 1, "title": "Draft demo script and outline video content",
      "day_offset": 0, "due_date": "2026-04-27", "est_minutes": 60,
      "notes": "Create a clear script to guide the demo recording." },
    { "order": 2, "title": "Record the 3-minute demo video",
      "day_offset": 1, "due_date": "2026-04-28", "est_minutes": 120, "notes": "..." },
    { "order": 3, "title": "Polish presentation slides for submission",
      "day_offset": 1, "due_date": "2026-04-28", "est_minutes": 90, "notes": "..." },
    { "order": 4, "title": "Edit demo video for clarity and flow",
      "day_offset": 2, "due_date": "2026-04-29", "est_minutes": 120, "notes": "..." },
    { "order": 5, "title": "Upload final video to YouTube",
      "day_offset": 2, "due_date": "2026-04-29", "est_minutes": 30, "notes": "..." }
  ]
}
```

### Optional persistence

When `persist_as_subtasks=true` AND `parent_task_id` set, each step is created
as a real task (`title` prefixed with `↳ ` for visual nesting in the UI), with
`linked_memory_id = parent_task_id` so the UI can group them. Subtask IDs
returned in `persisted_subtask_ids`.

### Failure modes

| Input                                | HTTP | Body                                  |
|--------------------------------------|------|---------------------------------------|
| Empty title and no resolvable parent | 400  | `task_title or parent_task_id ...`    |
| LLM returns non-list `steps`         | 400  | `LLM returned no steps`               |
| All steps invalid after validation   | 400  | `no valid steps after validation`     |

---

## 3. Memory: Save + Anti-Clutter Dedup

### Two-tier dedup pipeline in `save_memory`

```
                    ┌────────────────────────────┐
incoming memory ─► │ has source_url?            │
                    └────────────┬───────────────┘
                       yes        │       no
                        │         │
                        ▼         ▼
        _find_duplicate_by_url   _find_duplicate_by_content_hash
        (deterministic doc-id    (sha1 of normalized title + first 400
         lookup; legacy where()  chars of summary; 90-day window;
         fallback)               returns the matching memory or None)
                        │         │
                        └────┬────┘
                             ▼
                  if hit → return existing
                          + duplicate=true
                          + duplicate_reason="content_hash" (when applicable)

                  if miss → write new doc
                          + content_hash field stamped
                          (so future scans are O(1) cheap)
```

### Why two tiers

- **URL dedup** catches the common "I clipped the same article twice" case via
  a deterministic doc id (sha1 of `userId|normalized_url`) — concurrent saves
  collide on the same row instead of forking.
- **Content-hash dedup** catches the "I voice-noted the same thought twice" or
  "I pasted the same insight from a different surface" case. URL-less notes
  don't have a deterministic id, so we scan the user's most-recent 200 memories
  in the last 90 days and compare normalized hashes. Bounded scan, no full
  collection sweep.

The hash normalises whitespace, lowercases, and truncates so trivial edits
(adding a period, fixing case) don't defeat the dedup.

---

## 4. Workspace Recall (`POST /workspace/recall`)

The existing `/recall` only searched memories. The new endpoint searches
**everything in your workspace** and synthesises a single cited answer.

### Scope per request

| Source        | Searched when `project_id` is null | Searched when `project_id` is set |
|---------------|-------------------------------------|-----------------------------------|
| Memories      | Yes (global, via memory_recall)     | Yes (still global — memories aren't project-bound) |
| Tasks         | Yes (all your tasks)                | Yes (project tasks first, then global) |
| Project items | No                                  | Yes (notes/links/files in that project) |
| Project list  | Yes (name + summary keyword match)  | Yes                               |

### Pipeline

```
query ─► strip stopwords ("show", "previous", "work", "on", "for", …)
       │
       ├─► memory tier: delegates to recall_agent.recall (3-tier search reused, no duplication)
       ├─► task tier:   keyword scan over tasks collection (priority + recency tiebreak)
       ├─► item tier:   keyword scan over selected project's items (when scoped)
       └─► project tier: keyword scan over workspace_projects (name + summary)
                     │
                     ▼
              merge + score + cap to `limit`
                     │
                     ▼
       LLM synthesis: 2-3 sentence answer with [Memory:Title], [Task:Title],
                      [Item:Title], [Project:Name] citations
                     │
                     ▼ (if synthesis fails)
       heuristic fallback: deterministic narrative built from top hits
                     │
                     ▼
       { ok, query, scope, answer, sources: {memories, items, tasks, projects}, counts }
```

### Example response (real, from smoke test)

```json
{
  "ok": true,
  "query": "hackathon submission",
  "scope": { "project_id": null, "project_name": "" },
  "answer": "You've captured information about Google Cloud Vertex AI, which unifies various ML services into one platform, and you have a pending task to record a 3-minute demo video for your hackathon submission due on April 29, 2026 [Memory: Google Cloud Vertex AI], [Task: Record 3-minute demo video for prototype submission]. A useful next step would be to start planning the content and structure of your demo video to ensure you effectively showcase your prototype.",
  "sources": {
    "memories": [{ "id": "...", "title": "Google Cloud Vertex AI — Enterprise AI Platform", "domain": "Technology", "summary": "..." }],
    "items": [],
    "tasks":    [{ "id": "...", "title": "Record 3-minute demo video for prototype submission", "due_date": "2026-04-29", "priority": "high", "status": "pending", "score": 1 }],
    "projects": []
  },
  "counts": { "memories": 1, "items": 0, "tasks": 1, "projects": 0, "total": 2 }
}
```

### Empty / bad input

| Input             | HTTP | Body                            |
|-------------------|------|---------------------------------|
| `{"query": ""}`   | 400  | `{"error": "query is required"}`|
| Unknown project_id| 200  | scope.project_name = ""; falls back to global search |

---

## Endpoint Reference

| Method | Path                                                    | Purpose                                |
|--------|---------------------------------------------------------|----------------------------------------|
| POST   | `/workspace/projects/{id}/extract-insights`             | Detect important work in a project     |
| POST   | `/workspace/projects/{id}/insights/apply`               | Execute one suggested action           |
| POST   | `/tasks/breakdown`                                      | Step-by-step micro-plan for a task     |
| POST   | `/workspace/recall`                                     | "Show my previous work on X"           |

All four are wired in `main.py`. Underlying logic lives in
`app/insight_agent.py`, `app/plan_agent.py:breakdown_task`,
`app/workspace_recall.py`, and the dedup helpers in `app/capture_agent.py`.


---

# Folder Timeline (per-folder activity feed with bidirectional links)

**Goal:** Give every workspace folder a single chronological view that answers
*"what happened in this folder, and how is everything connected?"* — captures,
extracted insights, applied tasks, saved memories and saved plans, all on one
spine, with click-to-jump navigation between an insight and the task it
produced (and back).

## 1. Data sources (no new collection)

The timeline is **derived** at query time from existing collections — no
parallel "events" table is written, so there is nothing to keep in sync.

| Event type | Source                                                 | Time field        | Folder field             |
|------------|--------------------------------------------------------|-------------------|--------------------------|
| `capture`  | `workspace_projects.items[*]`                          | `added_at`        | `folder_id` (`""` = root)|
| `task`     | `workspace_projects.tasks[*]`                          | `created_at`      | `folder_id`              |
| `memory`   | `memories` collection where `project_id == pid` and `folder_id` matches | `created_at` | `folder_id`              |
| `insight`  | `workspace_projects.recent_insights[*]` (capped 50, FIFO) | `created_at`   | `folder_id`              |
| `plan`     | `workspace_projects.saved_plans[*]` (when present)     | `saved_at`        | project-level            |

`recent_insights[]` was added to the project document in this iteration so the
historical insight stream survives across sessions; it is appended every time
`extract_insights` returns suggestions and trimmed to the last 50.

## 2. Connection model — how an insight knows about its task

When the user clicks **Add Task** / **Save to Memory** / **Create Plan** on an
insight suggestion, the apply handler in `app/insight_agent.py` does two
writes in one round-trip:

1. The actual artefact (task / memory / plan) is created with a
   `linked_from = {event_id, type, label, action}` pointer back to the
   insight that produced it.
2. The insight's `applied_actions[]` array is appended via
   `_log_applied_action(...)` with the **same** `event_id` pointing forward
   to the new artefact.

```
recent_insights[i] ─────applied_actions[*]─────►  task / memory / plan
       ▲                                                    │
       └──────────── linked_from ───────────────────────────┘
```

`event_id` is always `"{type}:{id}"` — e.g. `task:tk_abc`, `insight:ins_xyz` —
so the same identifier round-trips through the URL fragment, the React DOM
anchor and the timeline JSON without any translation.

`add_task` is special: it logs **two** edges (one to the global `task:` and
one to the workspace `wstask:`) so the link is followable regardless of which
task list the user is looking at.

## 3. Aggregator — `app/timeline_agent.py::get_folder_timeline`

```python
get_folder_timeline(project_id, folder_id=None, limit=200) -> {
    "ok": True,
    "scope": {"project_id", "project_name", "folder_id", "folder_name"},
    "events": [ TimelineEvent, ... ],   # newest first
    "counts": {"capture", "insight", "task", "memory", "plan", "total"},
    "edges":  int                        # number of linked_to / linked_from pairs
}
```

`folder_id` semantics:

| Value     | Scope                                            |
|-----------|--------------------------------------------------|
| `None`    | Whole project (every folder + un-foldered)       |
| `""`      | Root bucket (items with no folder assigned)      |
| `"f_xyz"` | A specific folder                                |

Each event carries:
- `id`, `type`, `timestamp`, `title`, `summary`
- type-specific fields (`priority`, `due_date`, `status`, `insight_type`, …)
- `linked_from` (the upstream event that spawned this one — at most one)
- `linked_to[]` (downstream events this one spawned — zero or more)
- `deeplink: { route, params }` — exact URL the UI should `navigate()` to

The aggregator first collects raw events, then performs an **edge resolution
pass**: for every artefact that carries a `linked_from`, it appends a mirror
entry to the source insight's `linked_to` and increments the `edges` counter.
This is what makes the timeline graph bidirectional even though the underlying
storage only writes one direction at apply time.

## 4. Endpoint

```
GET /workspace/projects/{project_id}/timeline?folder_id=<id>
```

| Query param  | Default | Notes                                      |
|--------------|---------|--------------------------------------------|
| `folder_id`  | omitted | Whole project. `""` = root, `f_x` = folder |
| `limit`      | 200     | Max events returned                        |

### Example response (trimmed)

```json
{
  "ok": true,
  "scope": {
    "project_id": "ws_f1e1231105",
    "project_name": "Hackathon prep",
    "folder_id": "f_demo",
    "folder_name": "Demo prep"
  },
  "counts": { "capture": 2, "insight": 2, "task": 1, "memory": 0, "plan": 0, "total": 5 },
  "edges": 2,
  "events": [
    {
      "id": "task:tk_a1",
      "type": "task",
      "timestamp": "2026-04-27T08:14:02Z",
      "title": "Record 3-min demo video",
      "priority": "high",
      "due_date": "2026-04-29",
      "status": "pending",
      "linked_from": { "event_id": "insight:ins_77", "type": "insight",
                       "label": "High-priority deadline detected", "action": "add_task" },
      "deeplink": { "route": "/tasks", "params": { "highlight": "tk_a1" } }
    },
    {
      "id": "insight:ins_77",
      "type": "insight",
      "timestamp": "2026-04-27T08:13:55Z",
      "title": "High-priority deadline detected",
      "insight_type": "deadline",
      "linked_to": [
        { "event_id": "task:tk_a1", "type": "task", "label": "Record 3-min demo video",
          "action": "add_task", "applied_at": "2026-04-27T08:14:02Z" }
      ],
      "deeplink": { "route": "/workspace", "params": { "project_id": "ws_f1e1231105" } }
    }
  ]
}
```

## 5. Frontend

`src/pages/TimelinePage.tsx` now has two modes selected by a tab switcher:

- **Memories** — the existing chronological vault view (unchanged).
- **Workspace flow** — new view backed by `get_folder_timeline`.

The workspace mode auto-activates when the URL carries
`?mode=workspace` or `?project_id=...`. It exposes:

- A project picker (lazy-loads folder list per project).
- A scope picker: *Whole project* / *Root* / each folder.
- Type filter pills (`All / Capture / Insight / Task / Memory / Plan`)
  with live counts from the response.
- A counts strip (captures · insights · tasks · memories · plans · connections).
- Per-event card with type chip, priority/status/due chips, summary, and:
  - **`from <Insight>`** dashed pill (when `linked_from` exists) →
    smooth-scrolls to that insight via `#ev-{id}` DOM anchor.
  - **`<action> → <target>`** dashed pill for each `linked_to[]` →
    smooth-scrolls to the spawned artefact.
  - Click body → `navigate()` to the event's `deeplink` (Tasks page,
    Memory detail, Workspace project, Plan, …).

Two entry points were added to make the feature discoverable:

- `src/pages/WorkspacePage.tsx` — the project header next to "AI Organize"
  has a **Timeline** button which deep-links to
  `/timeline?mode=workspace&project_id=<pid>&folder_id=<active>`.
- `src/pages/CapturePage.tsx` — after a successful save, a dismissible
  pill appears with **Open** and **View Timeline** actions.

## 6. End-to-end integrated workflow

```
┌────────────┐  capture (web/yt/pdf/note)
│  Capture   │──────────────────────────────────┐
└────────────┘                                  ▼
                                       ┌──────────────────┐
                                       │ workspace_items  │ ← AI Organize folders this
                                       └──────────────────┘
                                                │
                                                ▼
                                  ┌──────────────────────────┐
                                  │ extract_insights()       │
                                  │  → recent_insights[]     │  (persisted, capped 50)
                                  └──────────────────────────┘
                                                │  user clicks "Add Task"
                                                ▼
                              ┌──────────────────────────────────┐
                              │ apply: add_task / save_to_memory │
                              │        / create_plan             │
                              │ writes linked_from on artefact   │
                              │ + applied_actions[] on insight   │
                              └──────────────────────────────────┘
                                                │
                                                ▼
                                  ┌──────────────────────────┐
                                  │ get_folder_timeline()    │ ← endpoint reads everything,
                                  │  resolves edges          │   resolves bidirectional edges
                                  └──────────────────────────┘
                                                │
                                                ▼
                                  ┌──────────────────────────┐
                                  │ TimelinePage (workspace) │ ← visual jump-to-source flow
                                  └──────────────────────────┘
```

A single user gesture in step 4 is the only place an edge is ever
**created**; everything downstream just **reads** it. That keeps the data
model simple and the timeline trivially correct under retries / backfills.

## 7. Endpoint reference (additions)

| Method | Path                                                           | Purpose                              |
|--------|----------------------------------------------------------------|--------------------------------------|
| GET    | `/workspace/projects/{id}/timeline?folder_id=<id>&limit=<n>`   | Per-folder activity feed with edges  |

## 8. Hardening (post-review fixes)

### Edge canonicalization
The aggregator rewrites `applied_actions[*]` target ids before resolving them
to actual rendered events, so the bidirectional links survive the fact that
each downstream system uses its own id namespace:

| `target_type` written by apply | Resolved event id in timeline                           |
|--------------------------------|----------------------------------------------------------|
| `task:<global_task_id>`        | direct match if hydrated from `tasks/<id>`               |
| `task:<workspace_task_id>`     | direct match against `tasks[*].id` on the project doc    |
| `memory:<memory_id>`           | rewritten to `item:<workspace_item_id>` via `memory_alias_to_event` (memory pins are always also pinned as workspace items in the same folder by `save_to_memory`) |
| `plan:<sibling_project_id>` (or legacy `project:<id>` for `create_plan`) | emitted as `plan:<id>` event in section 5 |

Without this rewrite, derived `linked_to[]` entries pointed at IDs the UI never
rendered, so the click-to-jump was a silent no-op.

### Idempotency at the apply layer
`apply_insight_action` now short-circuits if `recent_insights[insight_id].applied_actions[]`
already contains a row whose `action == a_type`. The handler returns
`{ok: true, idempotent: true, previous: {target_type, target_id, target_label, applied_at}}`
without creating a second task / memory / plan. This protects against rapid
double-clicks, retries on flaky network, and reload-then-resubmit.

A second, narrower idempotency check inside `_log_applied_action` (dedup on
`(action, target_id)`) prevents the edge log itself from growing duplicates if
two writers slip past the apply guard at the same instant.

### URL parameter contract
TimelinePage's "Open Workspace" button (empty-state) and the timeline's plan
deeplink both use `/workspace?project=<id>` to match the actual query param
WorkspacePage reads (`useSearchParams().get('project')`). The Timeline button
on WorkspacePage uses `/timeline?mode=workspace&project_id=<id>` because that
is what TimelinePage's workspace mode reads. Asymmetric but each side owns its
contract.
