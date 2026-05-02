<div align="center">

<img src="https://img.shields.io/badge/Recall_X247-AI_Second_Brain-05050f?style=for-the-badge&logo=brain&logoColor=00d4ff" alt="Recall X247" />

# 🧠 Recall X247

### *Your AI-Powered Second Brain — Multi-Agent Knowledge System*

[![Live Demo](https://img.shields.io/badge/🌐_Live_Demo-GitHub_Pages-00d4ff?style=for-the-badge)](https://prshant28.github.io/Gen_AI_APAC/)
[![Backend API](https://img.shields.io/badge/⚡_Backend_API-Cloud_Run-4285F4?style=for-the-badge&logo=google-cloud&logoColor=white)](https://recall-x247-727590322606.asia-southeast1.run.app/)
[![Hackathon](https://img.shields.io/badge/🏆_Gen_AI_Academy-APAC_2026-FF6B35?style=for-the-badge)](https://github.com/prshant28/Gen_AI_APAC)

[![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-6.2-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=flat-square&logo=docker&logoColor=white)](https://docker.com)
[![Cloud Run](https://img.shields.io/badge/Google_Cloud_Run-asia--southeast1-4285F4?style=flat-square&logo=google-cloud&logoColor=white)](https://cloud.google.com/run)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

<br/>

> **Capture knowledge, recall it instantly, manage tasks, and schedule study sessions — all through a single natural language conversation with an AI orchestrator.**

<br/>

| 🌐 Frontend (GitHub Pages) | ⚡ Backend API (Cloud Run) | 📖 API Docs |
|:---:|:---:|:---:|
| **[prshant28.github.io/Gen_AI_APAC](https://prshant28.github.io/Gen_AI_APAC/)** | **[recall-x247 on Cloud Run](https://recall-x247-727590322606.asia-southeast1.run.app/)** | **[/docs](https://recall-x247-727590322606.asia-southeast1.run.app/docs)** |

</div>

---

## ✨ What is Recall X247?

Recall X247 is a **production-ready multi-agent AI system** built for the **Gen AI Academy APAC 2026 Hackathon**. It acts as your intelligent Second Brain — a unified platform that:

- 📥 **Captures** knowledge from YouTube videos, web articles, PDFs, and plain notes
- 🔍 **Recalls** information using natural language semantic search with AI-powered answers
- ✅ **Manages** tasks and projects linked directly to your captured knowledge
- 📅 **Schedules** study sessions and events on your calendar
- 🃏 **Generates** flashcards for active recall and spaced repetition
- 📊 **Delivers** AI daily briefings and learning analytics
- 🤖 **Orchestrates** all of this through a single natural language interface

---

## 🚀 Live Demo

<div align="center">

### 🌐 [Try it Live → https://recall-x247-727590322606.asia-southeast1.run.app/Gen_AI_APAC](https://recall-x247-727590322606.asia-southeast1.run.app/)

**Example prompts you can try:**
```
"Capture this YouTube video https://youtu.be/dQw4w9WgXcQ and create a task to review it"
"What did I learn about machine learning last week?"
"Schedule a study session for tomorrow at 2pm and generate flashcards from my recent notes"
"Give me my daily briefing and show my pending tasks"
```

</div>

---

## 🏗️ Multi-Agent Architecture

Recall X247 uses a **hierarchical multi-agent system** with an Orchestrator coordinating 6 specialized sub-agents via OpenAI function calling with real-time SSE streaming:

```
User Natural Language Request
         │
         ▼
┌─────────────────────────────────────┐
│   🧠 Orchestrator (KnowledgeCoordinator)  │
│   GPT-4o-mini via OpenRouter        │
│   app/coordinator.py                │
└──────────────┬──────────────────────┘
               │ OpenAI Function Calling
               │ (10 MCP-style tools)
    ┌──────────┼──────────────────┐
    │          │                  │
    ▼          ▼                  ▼
┌────────┐ ┌────────┐      ┌──────────┐
│Capture │ │Recall  │      │  Task    │
│ Agent  │ │ Agent  │      │  Agent   │
│📥     │ │🔍     │      │ ✅      │
└────────┘ └────────┘      └──────────┘
    │          │                  │
    ▼          ▼                  ▼
┌──────────┐ ┌────────────┐ ┌──────────────┐
│Calendar  │ │ Briefing   │ │  Analytics   │
│  Agent   │ │   Agent    │ │    Agent     │
│ 📅      │ │ 📊        │ │  📈         │
└──────────┘ └────────────┘ └──────────────┘
         │
         ▼ SSE Streaming (real-time events)
┌─────────────────────────────────┐
│   Frontend Agent Hub (/agent)   │
│   React + TypeScript + Vite     │
└─────────────────────────────────┘
```

### Agent Registry

| Agent | Role | Key Tools |
|---|---|---|
| 🧠 **Orchestrator** | Routes requests, coordinates agents | All 10 tools |
| 📥 **CaptureAgent** | Ingest YouTube, web, PDFs, notes | `capture_knowledge` |
| 🔍 **RecallAgent** | Semantic 3-tier search + AI answers | `recall_knowledge`, `list_memories` |
| ✅ **TaskAgent** | Task CRUD with priority & due dates | `create_task`, `list_tasks` |
| 📅 **CalendarAgent** | Schedule events & study sessions | `schedule_event`, `list_schedule` |
| 📊 **BriefingAgent** | AI daily briefings, study plans | `get_daily_briefing`, `generate_study_plan` |
| 📈 **AnalyticsAgent** | Learning stats, streaks, velocity | `get_knowledge_stats` |

---

## 🎨 Features

<table>
<tr>
<td width="50%">

### 📥 Knowledge Capture
- **YouTube** — Auto-fetch transcripts, AI summarization, thumbnail preview & embed
- **Web Articles** — Scrape and summarize any URL
- **PDFs** — Upload and extract content
- **Notes** — Plain text with AI tagging

</td>
<td width="50%">

### 🔍 Neural Recall
- **3-tier semantic search** — Tag → Domain → Full text
- **AI-powered answers** — Context-aware responses
- **Knowledge graph** visualization
- **Timeline** — Chronological memory view

</td>
</tr>
<tr>
<td width="50%">

### ✅ Task & Project Management
- Priority levels & due dates
- **Kanban workspace** with linked memories
- Task filtering by status
- Linked to captured knowledge

</td>
<td width="50%">

### 📊 Analytics & Learning
- **Learning velocity** tracking
- **Domain radar** chart
- **Streak tracking** & gamification
- **AI daily briefings** with insights

</td>
</tr>
<tr>
<td width="50%">

### 🃏 Flashcards & Study
- **AI-generated** study cards from memories
- Spaced repetition support
- **Study session** scheduling
- Calendar integration with Google Calendar

</td>
<td width="50%">

### 🤖 Agent Hub
- **Real-time SSE streaming** chat
- Agent registry panel with live status
- Workflow history & step tracing
- Multi-step natural language workflows

</td>
</tr>
</table>

---

## 🛠️ Tech Stack

<div align="center">

| Layer | Technology |
|---|---|
| **Frontend** | React 19, TypeScript, Vite 6, Tailwind CSS 4, Framer Motion |
| **Backend** | Python 3.11, FastAPI, Uvicorn |
| **AI / LLM** | GPT-4o-mini via OpenRouter (`GEN_APAC_API_KEY`) |
| **Database** | Google Cloud Firestore (Async) + in-memory fallback |
| **Deployment** | Google Cloud Run (Docker) + GitHub Pages |
| **CI/CD** | GitHub Actions (auto-deploy on push to `main`) |
| **Libraries** | BeautifulSoup4, YouTube Transcript API, PyPDF, Recharts, Lucide React |

</div>

---

## 📂 Project Structure

```text
Gen_AI_APAC/
├── 📄 main.py                    # FastAPI entry point
├── 📄 index.html                 # HTML shell
├── 📄 Dockerfile                 # Container config (Cloud Run)
├── 📄 vite.config.ts             # Vite + proxy config
├── 📄 requirements.txt           # Python dependencies
├── 📄 package.json               # Node dependencies
│
├── app/                          # Python backend
│   ├── config.py                 # Env vars & OpenRouter config
│   ├── db.py                     # Firestore + in-memory fallback
│   ├── coordinator.py            # Orchestrator (10 tools, SSE streaming)
│   ├── workflow_engine.py        # Workflow tracking + AGENT_REGISTRY
│   ├── capture_agent.py          # YouTube / web / PDF / note ingestion
│   ├── recall_agent.py           # 3-tier semantic search
│   ├── task_agent.py             # Task CRUD
│   └── calendar_agent.py         # Google Calendar integration
│
├── src/                          # React frontend
│   ├── App.tsx                   # All 13 views + SSE streaming
│   └── index.css                 # Dark neural theme + animations
│
└── .github/workflows/
    ├── deploy.yml                # Cloud Run CI/CD
    └── gh-pages.yml              # GitHub Pages CI/CD
```

---

## ⚙️ Quick Start

### Prerequisites
- Python 3.11+
- Node.js 20+
- An [OpenRouter](https://openrouter.ai) API key (`GEN_APAC_API_KEY`)

### 1. Clone & Install

```bash
git clone https://github.com/prshant28/Gen_AI_APAC.git
cd Gen_AI_APAC

# Install Python dependencies
pip install -r requirements.txt

# Install Node dependencies
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your keys:

```env
# Required
GEN_APAC_API_KEY=your_openrouter_api_key

# Optional — for full Firestore persistence
GCP_PROJECT_ID=your_gcp_project_id
GOOGLE_APPLICATION_CREDENTIALS=path/to/service_account.json

# Optional — for Google Custom Search
GOOGLE_CSE_CX=your_cse_id
GOOGLE_API_KEY=your_google_api_key
```

> 💡 **No Firestore?** The app uses an in-memory mock database automatically — just set `GEN_APAC_API_KEY` and you're ready to go!

### 3. Run Locally

```bash
npm run dev
```

This starts both the **FastAPI backend** (port 8000) and **Vite frontend** (port 5000) concurrently. Open [http://localhost:5000](http://localhost:5000).

### 4. Docker (Optional)

```bash
docker build -t recall-x247 .
docker run -p 8000:8000 --env-file .env recall-x247
```

---

## 📡 API Reference

### Core Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/chat` | Coordinator chat (sync) |
| `POST` | `/agent/chat/stream` | **SSE streaming** multi-agent chat |
| `GET` | `/agents` | Agent registry |
| `GET` | `/workflows` | Recent workflow history |
| `GET` | `/workflows/{id}` | Single workflow with step trace |
| `POST` | `/capture` | Capture knowledge (YouTube/web/PDF/note) |
| `POST` | `/capture/upload` | Upload PDF file |
| `GET/POST/DELETE` | `/memories` | Knowledge vault CRUD |
| `POST` | `/recall` | Semantic search |
| `GET/POST` | `/tasks` | Task management |
| `GET/POST` | `/schedule` | Calendar events |
| `GET` | `/briefing` | AI daily briefing |
| `GET` | `/stats` | System statistics |
| `GET` | `/health` | Health check |

### Chat API Example

```bash
curl -X POST https://recall-x247-asia-southeast1.run.app/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Capture this YouTube video https://youtu.be/dQw4w9WgXcQ and create a task to review it",
    "user_id": "demo_user"
  }'
```

### SSE Streaming Events

The `/agent/chat/stream` endpoint emits real-time events:

| Event | Description |
|---|---|
| `workflow_start` | New workflow initiated |
| `thinking` | Orchestrator reasoning |
| `agent_start` | Sub-agent activated |
| `agent_complete` | Sub-agent finished |
| `workflow_complete` | All steps done |
| `error` | Error occurred |
| `done` | Stream closed |

---

## 🖥️ Application Views (13 Total)

| View | Route | Description |
|---|---|---|
| 📊 **Dashboard** | `/` | Stats, charts, recent memories, daily briefing |
| 🤖 **Agent Hub** | `/agent` | Real-time multi-agent chat with SSE, agent registry, workflow history |
| 📥 **Capture** | `/capture` | URL/text/PDF capture with YouTube embed preview |
| 🗄️ **Vault** | `/vault` | Knowledge grid with thumbnails and detail modals |
| 🔍 **Neural Recall** | `/recall` | Semantic search with AI answers |
| ✅ **Tasks** | `/tasks` | Task management with priority/due dates |
| 🃏 **Flashcards** | `/flashcards` | AI-generated study cards |
| 📅 **Calendar** | `/calendar` | Event scheduling |
| ⏱️ **Timeline** | `/timeline` | Chronological memory view |
| 🕸️ **Mind Graph** | `/graph` | Knowledge graph visualization |
| 📈 **Analytics** | `/analytics` | Learning velocity, domain radar, streak tracking |
| 🗂️ **Workspace** | `/workspace` | Kanban project board with linked memories |
| ⚙️ **Settings** | `/settings` | API configuration and testing |

---

## 🚢 Deployment

### Automated CI/CD

Every push to `main` triggers two parallel deployments:

```
Push to main
    ├── 🐳 Cloud Run (deploy.yml)
    │   ├── Build Docker image
    │   ├── Deploy to asia-southeast1
    │   └── Health check /health & /api/health
    │
    └── 📄 GitHub Pages (gh-pages.yml)
        ├── npm run build
        └── Deploy to GitHub Pages
```

### Manual Cloud Run Deployment

```bash
gcloud run deploy recall-x247 \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --set-secrets "GEN_APAC_API_KEY=GEN_APAC_API_KEY:latest"
```

### Required GitHub Secrets

| Secret | Description |
|---|---|
| `GEN_APAC_API_KEY` | OpenRouter API key |
| `GCP_PROJECT_ID` | Google Cloud Project ID |
| `GCP_SA_KEY` | Google Cloud Service Account JSON |
| `GEMINI_API_KEY` | *(Optional)* Google Gemini API key |

---

## 🛡️ Security

- **Data Isolation**: Firestore security rules ensure users can only access their own data (see `firestore.rules`)
- **Secret Management**: API keys stored as Google Cloud Secrets, never in source code
- **Authentication**: Cloud Run requires valid credentials for write operations
- **CORS**: FastAPI CORS middleware configured for production domains

---

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch: `git checkout -b feat/amazing-feature`
3. Commit your changes: `git commit -m 'feat: add amazing feature'`
4. Push to the branch: `git push origin feat/amazing-feature`
5. Open a Pull Request

---

## Live Demo

Example Prompts:
- Prompt 1: What are the benefits of AI?
- Prompt 2: How can AI change the world?

Watch our live demo: [YouTube Video](https://youtu.be/bzwuRDVhGJM?si=si6Qcr_NblTJbVIZ)

## 📜 License

This project is licensed under the MIT License.

---

<div align="center">

**Built with ❤️ By Prashant for the [Gen AI Academy APAC 2026 Hackathon](https://github.com/prshant28/Gen_AI_APAC)**

[![GitHub Stars](https://img.shields.io/github/stars/prshant28/Gen_AI_APAC?style=social)](https://github.com/prshant28/Gen_AI_APAC/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/prshant28/Gen_AI_APAC?style=social)](https://github.com/prshant28/Gen_AI_APAC/network/members)

*Made by [Prashant Maurya](https://github.com/prshant28)*

</div>

