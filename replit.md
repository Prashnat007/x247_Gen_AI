# Recall X247 — AI-powered Second Brain v2.0

## Overview
Recall X247 is an AI-powered productivity assistant designed as a "second brain." It leverages a multi-agent AI system for knowledge capture, semantic recall, task management, flashcard generation, study session scheduling, and daily AI-generated briefings. The project aims to provide comprehensive knowledge management and significantly enhance personal productivity, positioning itself as a leading platform to combat information overload and foster personal and professional development.

## User Preferences
I prefer detailed explanations.
I want iterative development.
Ask before making major changes.

## System Architecture
The application employs a multi-agent AI architecture with a central orchestrator. **Memories are first-class linkable nodes** — every memory can have outgoing links to tasks, calendar events, folders, revisits, habits, and other memories, with bidirectional back-references surfaced through the `MemoryLinksPanel` and "from-memory" badges on linked entities.

### UI/UX Decisions
The design system features dark glassmorphism with a neural theme, utilizing CSS custom properties for extensive theming, responsive layouts, and a light/dark theme toggle. The sidebar is structured with pinned "ESSENTIALS" and collapsible groups. Onboarding includes an actionable "PICK ONE TO START" tour and a dismissible "GET FAMILIAR" checklist on the dashboard. The Advanced Dashboard features stat cards and "Smart Insights." The Neural Recall Empty State provides a rich landing with prompt sections and recent questions history.

### Technical Implementations
- **Frontend:** React, TypeScript, Vite.
- **Backend:** Python, FastAPI.
- **Multi-Agent System:** An Orchestrator dispatches tasks to specialized sub-agents via OpenAI function calling, managed by a `WorkflowEngine`.
- **Live Voice/Video Brain:** Real-time bidirectional conversation with Google Gemini Live API.
- **Plan Generator:** A 4-agent pipeline for structured plan creation.
- **Workspace Agent:** Manages backend-persisted projects with AI-driven organization.
- **Discover Multi-Agent UX:** Visualizes content search, fetching, and ranking.
- **Project Insights and Task Breakdown:** `insight_agent` suggests actions, and `plan_agent` breaks down tasks.
- **Workspace Recall:** Synthesizes cited answers from across items, tasks, memories, and projects.
- **Anti-clutter Dedup:** Content-hash-based deduplication for notes.
- **Revisit Reminders:** Firestore-backed CRUD system with frequency math and Smart AI planning.
- **Advanced Dashboard:** Aggregates greetings, knowledge pulse, activity heatmap, capture streaks, top tags, and a "pick-up" feature.
- **Folder Timeline:** Derives per-folder activity feeds with bidirectional linking.
- **Reusable Agent Visualization:** Component to render agent pipeline states.
- **Real-time Communication:** Server-Sent Events (SSE) for streaming AI responses.
- **Knowledge Capture:** AI-analyzes content from YouTube, web pages, and PDFs.
- **Semantic Recall:** Features a 3-tier semantic search.
- **Spaced Repetition:** Integrated into Flashcards.
- **Voice Capture:** Transcribes audio uploads.
- **Shareable Memories:** Generates public, read-only views.
- **Auto-tagging:** AI suggests and merges tags.
- **SPA Deep-Link Hardening:** HTTP middleware serves `index.html` for SPA routes.
- **Firestore Persistence Strategy:** Prioritizes explicit credentials, then Application Default Credentials, with an in-memory mock fallback.
- **Daily Briefing:** AI-generated briefing grounded in recent memories and user stats.
- **Per-User Data Scoping:** Multi-tenant isolation across all collections using `X-User-Id` header.
- **Capture Page Upgrades:** Dedicated `/capture` route supporting various file uploads (up to 25 MB) with inline previews and intelligent title generation.
- **Inbox Management:** Library Inbox with a sticky filter toolbar, server-side pagination, URL query string state mirroring, and "Undo" functionality.
- **Sidebar Inbox Badge:** Numeric badge on the Library nav item displaying unread capture count.
- **Recall AI:** Returns short, enriched answers with thumbnails/favicons/tags/key_points/relative dates, source-type intent prioritization, single-card default widening to a batch (cap 8) on request, and conversational history.
- **Multi-Agent Behaviour Discipline:** Orchestrator prevents auto-chaining of tasks post-capture and tracks a per-(uid, session) "focus item." Supports parallel execution of read-only sub-agents, clarification prompts, and a per-(uid, session) scratchpad for cross-agent context.
- **Per-page specialist agents (chat docks):** Each major page gets its own floating bottom-right chat dock with a focused system prompt and restricted tool subset (`app/page_specialists.py`, `PageSpecialistDock` component).
- **First-Load Performance Contract:** Every route is `React.lazy`-loaded, heavy libraries are deferred, and stable vendor chunks are pinned. Core Web Vitals are shipped to the backend.
- **Visual Capture (Live):** Captures frames from Live Voice/Video Brain sessions for multimodal AI analysis and memory persistence.
- **Asset Caching Contract:** Both FastAPI and Express servers compress responses and serve fingerprinted assets with aggressive caching, while the SPA shell uses `no-cache`.

## Phase History — New Endpoints, Components & Agents

### P1A — Captures session, time-bundle, OCR, dedup
- **Endpoints:** `POST /capture/session` (multi-source bundle → 1 workspace), `POST /capture/session/preview`, `POST /capture/time-bundle` (capture-my-last-N-hours), `POST /capture/dedup-check`, `POST /capture/ocr-image`, `POST /capture/visual-frame`, `POST /capture/save-bundle`, `POST /capture/voice`.
- **Agents:** `app/capture_agent.py` (extended) — `process_capture_session`, `bundle_recent_activity`, `check_duplicate`, `preview_capture_session`, `_ocr_image`, `analyze_visual_frame`.
- **Components:** Multi-source tray on `CapturePage` (note/link/voice/image with OCR pipeline state), session resume banner persisted to localStorage.

### P1B — Memory links + cross-domain link graph
- **Endpoints:** `GET /memories/{id}/links`, `POST /memories/{id}/link`, `DELETE /memories/{id}/link/{kind}/{ref_id}` (memory ↔ task/event/folder/revisit/habit/memory), `POST /links` (generic cross-domain edges), `GET /memories/{id}/related`, `POST /memories/related`.
- **Agents:** `app/links.py` (link CRUD + traversal), `app/external_refs.py` (provenance pointers from external systems → memories).
- **Components:** `src/components/memory/MemoryLinksPanel.tsx` — shows outgoing links grouped by kind, "AI thinks this also relates to" sub-section, source pills (Notion/Gmail/Slack) with `^https?://` XSS guard.

### P2 — Library, smart collections, tags, trash
- **Endpoints:** `GET /memories` (server-side pagination), `GET /memories/inbox-count`, `POST /library/bulk-{delete,archive,move-project,tag-add,tag-remove}`, `POST /memories/{id}/pin`, `GET/POST/PATCH/DELETE /smart-collections`, `GET /tags-index`, `POST /tags/{rename,merge}`, `DELETE /tags/{name}`, `GET /trash`, `POST /trash/{restore,purge,purge-expired}`.
- **Agents:** `app/library_agent.py`.
- **Components:** `LibraryInboxTab` (sticky filter toolbar, URL query mirroring, Undo).

### P3 — Workspace + project recall + insights
- **Endpoints:** `GET/POST/PATCH/DELETE /workspace/projects`, `/workspace/projects/{id}/{items,tasks,timeline,export.md,analytics,ai-organize,ai-organize-full,apply-organization,extract-insights,insights/apply,to-calendar,to-flashcards}`, `POST /workspace/recall` (cited answers across items/tasks/memories/projects), `POST /workspace/projects/from-template`, `GET /workspace/{folders/flat,sections,templates,overview}`.
- **Agents:** `app/workspace_agent.py`, `app/workspace_recall.py`, `app/insight_agent.py`, `app/timeline_agent.py`.

### P4A — Capture enrichment (6-chip Enrich panel)
- **Endpoints:** `GET/PUT /preferences/capture_enrichment`.
- **Agents:** `app/folder_matcher.py` (auto-folder suggestions), enrichment hooks in `capture_agent.save_bundle`.
- **Components:** `src/components/capture/EnrichPanel.tsx` + 6 chip components (`FolderChip`, `TasksChip`, `ScheduleChip`, `RevisitChip`, `HabitChip`, `RelatedChip`) — each chip independently accepts/rejects an AI suggestion at save time.

### P4B — AI Auto-Link Layer
- **Endpoints:** `POST /memories/{id}/folder` (auto-file with 10s Undo), `POST /memories/{id}/re-suggest`, `GET/PUT /preferences/auto_link`, `GET /suggestions/{links,inbox}`, `POST /suggestions/{id}/{accept,reject}`, `POST /suggestions/run-scans`.
- **Agents:** `app/auto_linker.py`, `app/auto_link_prefs.py`, `app/briefing_agent.scan_habit_memory_links`, `app/briefing_agent.scan_stale_linked_tasks`, `app/insight_agent.cluster_weekly`, `app/revisit_agent.scan_stale_revisit_candidates`.
- **Components:** Capture page auto-filed toast w/ Undo, MemoryLinksPanel "AI thinks this also relates to" sub-section, Daily Briefing AI Suggestions side card (folder_bundle suggestions stash memory_ids in sessionStorage and route to `/workspace?from_cluster=1`), Settings page 3-toggle "AI auto-link" view-card.
- **Vite proxy:** `/preferences` and `/suggestions` mapped to FastAPI so browser fetches don't fall through to the SPA fallback.

### P5A — Notion (real two-way integration)
- **Endpoints:** `/integrations/notion/{status,databases,databases/{id}/pages,import,import-page,disconnect,sync-now}` (7).
- **Agents:** `app/integrations/notion.py`, `app/notion_sync_scheduler.py` (1h tick).
- **Components:** Connect/Disconnect/Import on `IntegrationsPage`, "From Notion" picker on `CapturePage`, "Open in Notion" pill on `MemoryLinksPanel` external refs.
- **Credentials:** Replit OAuth (connector `notion`) or `NOTION_INTEGRATION_TOKEN`.

### P5B — Gmail (real read-only integration)
- **Endpoints:** `/integrations/gmail/{status,labels,search,import-message,disconnect}` (5).
- **Agents:** `app/integrations/gmail.py`.
- **Components:** Label picker + bulk import on `IntegrationsPage`, "From Gmail" search picker on `CapturePage` with Gmail search syntax, "Open in Gmail" pill on `MemoryLinksPanel` external refs.
- **Credentials:** Replit OAuth (connector `google-mail`, alias-resolved in `app/integrations/__init__.py`) or `GMAIL_ACCESS_TOKEN`. Idempotent message → memory import (`source_type="email"`, `mail.google.com/mail/u/0/#all/{thread_id}` back-link).

### P5C — Slack (real read-only thread import)
- **Endpoints:** `/integrations/slack/{status,channels,import-thread,disconnect}` (4).
- **Agents:** `app/integrations/slack.py` — `auth_test`, `list_channels`, `fetch_thread` (paginated `conversations.replies` + `chat.getPermalink`, capped at 200 messages), `parse_thread_url` (regex on `/archives/{C}/p{ts_no_dot}` with `?thread_ts=` query preference and strict `\d+\.\d{6}` validation), `import_thread_as_memory` (idempotent via `external_refs` `source=slack`, `source_id={channel}:{thread_ts}`, workspace-qualified permalink fallback derived from `auth.test`).
- **Components:** Slack card with channel list + paste-URL import on `IntegrationsPage`, "From Slack" paste-URL picker on `CapturePage`, "Open in Slack" pill on `MemoryLinksPanel` external refs.
- **Credentials:** `SLACK_BOT_TOKEN` env var (needs `channels:read`, `groups:read`, `channels:history`, `groups:history`). The Replit Slack OAuth connector (`ccfg_slack_*`) was offered to the user and **dismissed** — do not re-propose it. If runtime auth ever needs to be re-tried, ask the user to set `SLACK_BOT_TOKEN` directly via Secrets instead of re-proposing the connector.
- **Memory shape:** `source_type="slack_thread"`, `source_url=permalink`, body composed as quoted Markdown (`> <@user>: text`) with channel + start-time header.

### Cross-cutting infrastructure
- **`app/integrations/__init__.py`** — unified credential proxy: `get_connection(name)` tries Replit OAuth first (`https://connectors.replit.com/api/v2/connection`), then falls back to `_MANUAL_TOKEN_ENVS[name]` env var; resolves friendly names to canonical connector ids; exposes `NotConnectedError` (→ 401) and `IntegrationError` (→ provider status code).
- **`app/external_refs.py`** — provenance rows linking memories to external system origins (`source`, `source_id`, `url`, `title`, `snippet`); used by all integrations for idempotent re-import.
- **`app/briefing_scheduler.py`**, **`app/notion_sync_scheduler.py`** — ticking schedulers started at FastAPI startup (300s and 3600s respectively).

### Feature Specifications
- **Core AI Functionality:** Multi-agent orchestration and natural language processing.
- **Knowledge Management:** Capture, semantic search, memory vault, mind graph, first-class linkable memory nodes.
- **Productivity Tools:** Task management, advanced calendar (with ICS import/export), flashcards with spaced repetition, study plan generation, markdown notes, bookmarks, and habits.
- **Advanced Workspace:** Workspace KPIs, Workspace Recall search, per-project analytics, project templates, Markdown export, and drag-and-drop organization.
- **Analytics:** Tracks learning velocity, domain expertise, and streaks.
- **User Management:** Profile management, security, and data export.

## External Dependencies
- **AI Providers:** Google Gemini 2.0 Flash, OpenRouter.
- **Database:** Google Cloud Firestore.
- **Deployment:** Google Cloud Run.
- **APIs:** OpenAI-compatible API layer.
- **Third-party Services (Integrated, real wiring shipped):**
    - **Notion** (P5A) — real two-way integration via Replit OAuth or `NOTION_INTEGRATION_TOKEN`.
    - **Gmail** (P5B) — real read-only integration via Replit OAuth (`google-mail`) or `GMAIL_ACCESS_TOKEN`.
    - **Slack** (P5C) — real read-only thread import via Replit OAuth (`slack`) or `SLACK_BOT_TOKEN`.
- **Third-party Services (UI present, real wiring TBD):** Google Calendar/Drive/Docs/Photos/Keep/YouTube, Obsidian, Evernote, Todoist, Trello, Discord, Telegram, WhatsApp, GitHub, GitLab, Linear, Jira, X, LinkedIn, Reddit, Dropbox, OneDrive, S3, Spotify, Pocket, Instapaper, Chrome extension, Zapier, Make, Webhooks.
