# Threat Model

## Project Overview

Recall X247 is a multi-tenant "second brain" application with a React + TypeScript + Vite frontend and a Python FastAPI backend deployed to Cloud Run via `uvicorn main:app` (`Dockerfile`). It stores user memories, tasks, calendar items, flashcards, workspace/project data, and external-import content in Firestore, and it exposes streaming agent endpoints, live Gemini sessions, capture/upload flows, public share links, and server-side integrations for Notion, Gmail, and Slack.

For production scope, the browser is untrusted, `main.py` is the authoritative backend entry point, and `server.ts` should be treated as dev/legacy unless production reachability is proven. Mockup sandbox paths are out of scope for production. Platform TLS is assumed present in production.

## Assets

- **User data and knowledge corpus** — memories, notes, uploads, tags, links, tasks, events, flashcards, workspace items, and derived AI summaries. This is the primary tenant-isolated data plane.
- **Conversation state and workflow traces** — agent prompts, session history, workflow steps, tool inputs/outputs, live-session metadata, and specialist dock history. These can contain sensitive user data and operational context.
- **Third-party integration data** — Notion databases/pages, Gmail labels/messages/snippets, Slack workspace/channel/thread data, and any imported external references.
- **Application secrets and privileged tokens** — Firestore credentials, Replit identity tokens, Gemini/OpenRouter credentials, integration OAuth tokens, and manual env-secret tokens.
- **Server-side compute/network authority** — backend ability to fetch arbitrary URLs, call external APIs, run AI pipelines, and access Firestore on behalf of users.
- **Public share artifacts** — read-only memory shares and any metadata exposed through public links.

## Trust Boundaries

- **Browser → FastAPI API (`main.py`)** — all request headers, bodies, query params, uploads, websocket params, and SSE requests are attacker-controlled and must be authenticated and authorized server-side.
- **FastAPI → Firestore** — the backend has broad read/write access; any authorization flaw at the API layer becomes direct tenant data exposure or tampering.
- **FastAPI → External integrations** — the server uses privileged Notion/Gmail/Slack credentials and Gemini/OpenRouter API keys. Requests crossing this boundary must be scoped to the correct user and operation.
- **Public → Authenticated/tenant-owned resources** — memories, tasks, calendar items, workflow traces, chat history, and imported external content must not be reachable by anonymous callers or other tenants.
- **User → Admin/owner capability boundary** — connector setup, global secrets, and any app-level integrations must not silently become available to arbitrary end users.
- **Production → Dev-only/legacy code** — `main.py`, `app/**`, and frontend code referenced by the Vite app are in production scope; `server.ts`, mock/in-memory fallbacks, and sandbox-only paths should be ignored unless deployment evidence shows otherwise.

## Scan Anchors

- **Production entry points:** `main.py`, `Dockerfile`, frontend routes/components under `src/`, websocket/live code in `app/live_agent.py`.
- **Highest-risk areas:** `app/user_context.py`, `main.py` route handlers, `app/coordinator.py`, `app/page_specialists.py`, `app/workflow_engine.py`, `app/integrations/**`, `app/capture_agent.py`.
- **Public/authenticated boundary:** treat every route as public unless it proves server-side auth. Pay special attention to `/agent/*`, `/workflows*`, `/integrations/*`, capture/upload endpoints, share routes, and websocket/live paths.
- **Usually dev-only unless proven reachable:** `server.ts`, experimental client-side agents under `src/agents/*`, mockup/sandbox flows.

## Threat Categories

### Spoofing

This application currently relies heavily on a caller identity crossing the browser-to-API boundary. The backend must derive user identity from a validated server-side session or signed token, not from arbitrary request headers or query parameters. Websocket/live sessions, SSE agent sessions, and any endpoint that reads or mutates tenant data must bind actions to the authenticated principal on the server.

### Tampering

Users can create and mutate memories, tasks, events, links, preferences, workspace items, and imported content. The server must ignore client claims about ownership, role, or target tenant and must validate every object-level operation against server-trusted identity. User-supplied URLs, file uploads, and import parameters must be validated before they reach storage, external fetchers, or AI pipelines.

### Information Disclosure

The app handles a large amount of personal knowledge data plus AI conversation state and third-party data. API responses, debug endpoints, share links, workflow traces, and chat history must only expose the minimum data required for the calling principal. Secrets, provider tokens, email metadata, Slack/Notion workspace contents, and internal trace payloads must never be exposed to the browser except where explicitly intended and access-controlled.

### Denial of Service

Several public routes can trigger expensive work: AI orchestration, capture/import pipelines, external URL fetches, uploads, and live websocket sessions. Production endpoints must enforce size/time limits, rate limits, and bounded concurrency so anonymous or low-privilege callers cannot exhaust model quotas, outbound bandwidth, or worker memory.

### Elevation of Privilege

This codebase mixes normal user actions with owner-level capabilities such as connector-backed third-party access and broad workflow introspection. Every route that touches another user's data, app-level credentials, privileged traces, or imported external content must enforce server-side authorization. Per-user isolation must hold across Firestore documents, in-memory session state, live sessions, and external integration actions.
