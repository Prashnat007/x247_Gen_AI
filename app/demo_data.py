"""
Demo data seeder — populates the in-memory (or real) DB with a rich
guest-only demo so first-time visitors see a fully-loaded app.

Every doc is tagged with user_id / userId = "guest" so it is invisible to
real authenticated users (who land on a clean empty state and start
building their own Second Brain).

Organization (April 2026 refresh):
  - 12 memories total: 3 YouTube + 7 web + 2 notes
  - Domains spread across AI, Productivity, Engineering, Business, Health
  - Each YouTube URL is REAL & playable, used exactly once (no dupes)
  - Each entry has a unique source_url; titles match content
"""
import datetime
import uuid

GUEST_UID = "guest"

DEMO_MEMORIES = [
    # ─── 1. YouTube (real video, used once) ──────────────────────────────
    {
        "title": "Build with Google Cloud — Vertex AI Agent Builder Walkthrough",
        "source_type": "youtube",
        "source_url": "https://www.youtube.com/watch?v=lhwFkqiTA6Q",
        "summary": "Hands-on walkthrough of Vertex AI Agent Builder on Google Cloud — the no-code/low-code surface for assembling agentic apps that ground answers in your own data sources via Vertex Search, function calling, and Gemini. Shows how to wire grounding, tools, and deploy to a Cloud Run endpoint in under 30 minutes.",
        "key_points": [
            "Agent Builder = Vertex AI Search + Gemini + function-calling glue",
            "Grounding sources: Cloud Storage, BigQuery, Drive, websites",
            "Auth + IAM happens once at the project level, agents inherit it",
            "Deploy target: Cloud Run for HTTP, Dialogflow CX for chat surfaces",
            "Pricing: per-query for managed RAG, per-token for Gemini calls",
        ],
        "tags": ["gcp", "vertex-ai", "agents", "google-cloud", "rag"],
        "domain": "AI",
        "days_ago": 1,
    },
    {
        "title": "What is a Multi-Agent System? Visual Walkthrough",
        "source_type": "youtube",
        "source_url": "https://www.youtube.com/watch?v=j_l-9uNX2SA",
        "summary": "Beginner-friendly visual explanation of multi-agent systems — a planner agent orchestrates specialist worker agents that each own a narrow tool set. The video walks through the loop (plan → delegate → observe → synthesize) and explains why this beats a single mega-agent on long-horizon tasks.",
        "key_points": [
            "Multi-agent = one planner + many specialist workers, each scoped",
            "Communication: shared scratchpad / message bus / structured handoff",
            "Failure recovery is the differentiator — workers retry with backoff",
            "Tool use bridges reasoning to APIs, DBs, files, calendars, email",
            "ReAct loop iterates until the planner declares the task complete",
        ],
        "tags": ["multi-agent", "agents", "ai", "orchestration", "explainer"],
        "domain": "AI",
        "days_ago": 4,
    },
    {
        "title": "Production GenAI on Google Cloud — End-to-End Pipeline",
        "source_type": "youtube",
        "source_url": "https://www.youtube.com/watch?v=IUU6OR8yHCc",
        "summary": "End-to-end demo of pushing a generative AI workload to production on Google Cloud — from prompt iteration in Vertex AI Studio, to grounding via Vertex AI Search, to deployment behind Cloud Run with autoscaling, observability via Cloud Logging, and cost guardrails via Cloud Quotas.",
        "key_points": [
            "Iterate prompts in Vertex AI Studio before you write any code",
            "Vertex AI Search handles chunking + embedding + retrieval as a service",
            "Cloud Run gen2 cold start ~150ms — fits real-time chat latency",
            "Cloud Logging + Trace gives per-request token + latency breakdown",
            "Quotas + budget alerts are mandatory before going live",
        ],
        "tags": ["gcp", "cloud-run", "vertex-ai", "production", "mlops"],
        "domain": "AI",
        "days_ago": 2,
    },

    # ─── 2. Web articles ─────────────────────────────────────────────────
    {
        "title": "The Architecture of Multi-Agent AI Systems",
        "source_type": "web",
        "source_url": "https://arxiv.org/abs/2309.07864",
        "summary": "Survey of multi-agent AI orchestration patterns — the orchestrator/specialist split, shared vector memory, ReAct-style tool loops, and AgentBench-style evaluation. Reports 40% gains over single-agent baselines on complex multi-step benchmarks and outlines the failure modes (state explosion, error cascading) that production teams must design for.",
        "key_points": [
            "Orchestrator pattern: one planner, many specialist executors",
            "Shared vector memory enables cross-agent knowledge retrieval",
            "Tool use (function calling) bridges AI reasoning to real-world APIs",
            "ReAct loop: Reasoning + Acting iterates until task completion",
            "AgentBench: 40% improvement over single-agent baselines",
        ],
        "tags": ["agents", "orchestration", "architecture", "ai", "research"],
        "domain": "AI",
        "days_ago": 6,
    },
    {
        "title": "RAG vs Fine-tuning: When to Use Each",
        "source_type": "web",
        "source_url": "https://research.google/pubs/retrieval-augmented-generation",
        "summary": "Retrieval-Augmented Generation (RAG) grounds LLM responses in verified, up-to-date documents without retraining — ideal for dynamic knowledge bases. Fine-tuning instead bakes knowledge into weights, trading flexibility for lower inference latency. Hybrid approaches combine both for production systems.",
        "key_points": [
            "RAG: retrieve relevant chunks → inject into prompt context",
            "Fine-tuning: modify model weights with domain-specific data",
            "RAG excels when knowledge changes frequently (news, docs, user data)",
            "Fine-tuning excels for consistent tone/format tasks",
            "Hybrid: fine-tune for style + RAG for factual grounding",
        ],
        "tags": ["rag", "fine-tuning", "llm", "retrieval", "embeddings"],
        "domain": "AI",
        "days_ago": 8,
    },
    {
        "title": "Vector Databases — Pinecone vs Weaviate vs pgvector",
        "source_type": "web",
        "source_url": "https://www.pinecone.io/learn/vector-database/",
        "summary": "Vector databases index high-dimensional embeddings for sub-50ms similarity search at billion-vector scale. Pinecone leads on managed simplicity, Weaviate on open-source + hybrid search, and pgvector on letting you stay inside Postgres. The choice usually comes down to operational comfort + scale ceiling.",
        "key_points": [
            "ANN indices (HNSW, IVF) trade recall for speed — tune ef/probes",
            "Pinecone: fully managed, serverless tier scales to millions of vectors",
            "Weaviate: hybrid sparse+dense + self-host friendly",
            "pgvector: stay in Postgres, great below 10M vectors",
            "Embedding choice (OpenAI ada-3, BGE, Cohere) matters more than the DB",
        ],
        "tags": ["vector-db", "embeddings", "rag", "pinecone", "pgvector"],
        "domain": "Engineering",
        "days_ago": 5,
    },
    {
        "title": "Prompt Engineering Mastery — Chain-of-Thought & Beyond",
        "source_type": "web",
        "source_url": "https://arxiv.org/abs/2201.11903",
        "summary": "Chain-of-Thought (CoT) prompting instructs LLMs to show reasoning steps before answers, improving accuracy by 30-50% on math and logic tasks. Advanced techniques (Tree-of-Thought, Least-to-Most, Self-Consistency) further boost reliability by exploring multiple reasoning paths and voting across outputs.",
        "key_points": [
            "CoT: 'Think step by step' elicits intermediate reasoning, boosting accuracy",
            "Few-shot CoT: 3-5 worked examples outperform zero-shot significantly",
            "Tree-of-Thought: parallel reasoning branches + pruning finds best path",
            "Self-Consistency: sample multiple chains → majority vote final answer",
            "Least-to-Most: decompose hard problems into easy subproblems",
        ],
        "tags": ["prompting", "chain-of-thought", "llm", "reasoning"],
        "domain": "AI",
        "days_ago": 9,
    },
    {
        "title": "Transformer Architecture — A Visual Deep Dive",
        "source_type": "web",
        "source_url": "https://lilianweng.github.io/posts/2018-06-24-attention/",
        "summary": "The Transformer's self-attention mechanism computes relationships between every token pair in O(n²) time — enabling global context but limiting sequence length. Modern variants (Flash Attention, Ring Attention) address this through IO-aware tiling and distributed attention, pushing context windows to millions of tokens.",
        "key_points": [
            "Self-attention: Q·K^T/√d → softmax → V produces contextual embeddings",
            "Multi-head attention: parallel heads capture different relationships",
            "Positional encoding (RoPE, ALiBi) injects sequence order information",
            "Flash Attention 3 reduces VRAM from O(n²) to O(n) via tiling",
            "Mixture of Experts (MoE) scales parameters without proportional compute",
        ],
        "tags": ["transformer", "attention", "deep-learning", "architecture"],
        "domain": "AI",
        "days_ago": 12,
    },
    {
        "title": "Cloud Run vs Lambda vs Fly.io — Where to Deploy in 2026",
        "source_type": "web",
        "source_url": "https://blog.lakera.ai/serverless-2026",
        "summary": "All three serverless platforms have converged on container-first deploys, generous free tiers, and sub-100ms cold starts. Cloud Run wins on Google ecosystem + GPU support, Lambda on AWS depth, Fly.io on global low-latency edges.",
        "key_points": [
            "Cloud Run gen2 cold start ~150ms; supports H100 GPUs",
            "Lambda SnapStart drops Java cold start to ~80ms",
            "Fly.io anycast routes to nearest region — sub-50ms p50 globally",
            "All three now support container images up to 10GB",
            "Egress pricing remains the hidden cost — monitor it",
        ],
        "tags": ["serverless", "cloud-run", "deploy", "engineering"],
        "domain": "Engineering",
        "days_ago": 14,
    },
    {
        "title": "Founder's Guide to GTM — First 100 Customers",
        "source_type": "web",
        "source_url": "https://review.firstround.com/the-first-100",
        "summary": "Early-stage GTM is hand-to-hand combat — founders should personally close the first 100 customers to learn the language of the buyer. Patterns: do unscalable outreach, log every objection, ship same-day fixes. By customer 100 you should have a repeatable wedge and the start of a playbook.",
        "key_points": [
            "Do unscalable things: handwritten emails > automation in week one",
            "Log every objection in a shared doc — patterns become the FAQ",
            "Founder-led sales until $1M ARR, then hire your first AE",
            "Same-day shipping for paying customer feedback compounds trust",
            "Pricing experiments: charge early, raise often",
        ],
        "tags": ["gtm", "founder-sales", "startup", "business"],
        "domain": "Business",
        "days_ago": 7,
    },

    # ─── 3. Personal notes ───────────────────────────────────────────────
    {
        "title": "Building a Second Brain — Tiago Forte Method",
        "source_type": "note",
        "source_url": "",
        "summary": "The PARA method (Projects, Areas, Resources, Archives) creates a universal organizational system across all digital tools. The key insight is that knowledge should be captured in the moment of relevance, summarized for future retrieval, and connected to existing ideas — not stored in monolithic silos.",
        "key_points": [
            "PARA: Projects (active goals), Areas (ongoing responsibilities), Resources (references), Archives",
            "Progressive summarization: layers of compression preserve signal",
            "Just-in-time knowledge: retrieve when needed, not when captured",
            "Intermediate packets: build reusable knowledge components",
            "Second Brain externalizes cognition to reduce mental load",
        ],
        "tags": ["productivity", "pkm", "para", "notes"],
        "domain": "Productivity",
        "days_ago": 10,
    },
    {
        "title": "Deep Work for Builders — Personal Playbook",
        "source_type": "note",
        "source_url": "",
        "summary": "Distilled rules I follow from Cal Newport's Deep Work, adapted for engineering work. Two 90-min deep blocks daily, phone in another room, weekly shutdown ritual on Friday. After 3 months: ~2x meaningful output, 40% less context switching, sharper end-of-day energy.",
        "key_points": [
            "Two 90-min deep blocks beat 6h of fragmented work every time",
            "Phone in another room during blocks — willpower is unreliable",
            "Weekly shutdown ritual: review + plan next week before logging off Friday",
            "Boredom training: don't reach for phone in 'in-between' moments",
            "Drain the shallows: cap meetings + Slack to specific windows",
        ],
        "tags": ["productivity", "deep-work", "focus", "habits"],
        "domain": "Productivity",
        "days_ago": 11,
    },
]

DEMO_TASKS = [
    {"title": "Submit refined prototype to Google Cloud Gen AI Academy", "priority": "high",
     "due_offset_days": 1, "status": "pending", "category": "Hackathon"},
    {"title": "Record 3-minute demo video for prototype submission", "priority": "high",
     "due_offset_days": 0, "status": "pending", "category": "Hackathon"},
    {"title": "Capture 5 more YouTube lectures on Vertex AI", "priority": "medium",
     "due_offset_days": -1, "status": "pending", "category": "Learning"},
    {"title": "Review flashcards on Transformer architecture", "priority": "medium",
     "due_offset_days": -3, "status": "pending", "category": "Study"},
    {"title": "Write technical blog post on multi-agent AI systems", "priority": "low",
     "due_offset_days": 6, "status": "pending", "category": "Content"},
    {"title": "Set up Firestore for production data persistence", "priority": "high",
     "due_offset_days": -2, "status": "completed", "category": "Development"},
    {"title": "Add per-user data scoping (X-User-Id header)", "priority": "high",
     "due_offset_days": 0, "status": "completed", "category": "Development"},
    {"title": "Polish demo seed with richer content", "priority": "medium",
     "due_offset_days": 0, "status": "completed", "category": "Development"},
    {"title": "Pitch rehearsal with mentor", "priority": "high",
     "due_offset_days": 1, "status": "pending", "category": "Hackathon"},
    {"title": "Migrate Recall to Cloud Run autoscaler", "priority": "medium",
     "due_offset_days": 4, "status": "pending", "category": "Development"},
    {"title": "Outreach to first 10 beta testers", "priority": "high",
     "due_offset_days": 2, "status": "pending", "category": "GTM"},
    {"title": "Refactor capture pipeline to use streaming", "priority": "medium",
     "due_offset_days": 7, "status": "pending", "category": "Development"},
]

# Per-memory action items (imperative, what-to-DO phrases) injected into
# the seeded memories so the Daily Briefing's "Action items" panel shows
# real, click-through items out of the box. Keys MUST match the memory
# `title` exactly. Memories absent from this map seed without action items.
DEMO_ACTION_ITEMS = {
    "Build with Google Cloud — Vertex AI Agent Builder Walkthrough": [
        "Try Agent Builder on a small Cloud Storage dataset",
        "Wire one grounding source end-to-end and deploy to Cloud Run",
        "Compare per-query (managed RAG) vs per-token (Gemini) pricing for your use case",
    ],
    "What is a Multi-Agent System? Visual Walkthrough": [
        "Sketch a planner + worker split for one of your current projects",
        "Pick the narrow tool set each worker will own",
    ],
    "Production GenAI on Google Cloud — End-to-End Pipeline": [
        "Add Cloud Logging trace IDs to one production service",
        "Set up a project-level budget alert before going live",
    ],
    "RAG vs Fine-tuning: When to Use Each": [
        "Decide RAG, fine-tune, or hybrid for the current product",
        "Benchmark retrieval recall@10 on a sample query set",
    ],
    "Vector Databases — Pinecone vs Weaviate vs pgvector": [
        "Run a 1M-vector latency benchmark on pgvector",
        "Tune HNSW ef values to find the recall/latency knee",
    ],
    "Founder's Guide to GTM — First 100 Customers": [
        "Send 10 handwritten outreach emails this week",
        "Start a shared objections doc and log every 'no'",
    ],
    "Building a Second Brain — Tiago Forte Method": [
        "Create your PARA folders across the main tools you use",
        "Block 30 minutes for a weekly review every Friday",
    ],
    "Deep Work for Builders — Personal Playbook": [
        "Block two 90-minute deep work slots on tomorrow's calendar",
        "Move phone to another room during the next deep block",
    ],
}


def _today_iso_offset(days: int) -> str:
    return (datetime.date.today() + datetime.timedelta(days=days)).isoformat()


async def seed_demo_data(db) -> bool:
    """Seed GUEST demo data into the DB. Skips if any guest data already exists.

    Real authenticated users are unaffected — they land on a clean app and
    only see the data they themselves capture.
    """
    try:
        # Skip if guest already has memories
        existing = await db.collection("memories").limit(50).get()
        for doc in existing:
            data = doc.to_dict() or {}
            owner = data.get("user_id") or data.get("userId") or GUEST_UID
            if owner == GUEST_UID:
                return False  # already seeded

        now = datetime.datetime.now(datetime.timezone.utc)

        # ─── Memories ────────────────────────────────────────────────────────
        seeded_memory_ids: list = []
        for memory in DEMO_MEMORIES:
            data = dict(memory)
            data.pop("days_ago", None)
            data["id"] = str(uuid.uuid4())
            data["created_at"] = (now - datetime.timedelta(days=memory.get("days_ago", 1))).isoformat()
            data["user_id"] = GUEST_UID
            data["userId"] = GUEST_UID
            # Inject per-title action_items so the Daily Briefing's action
            # items panel renders real, demo-grounded items. Memories missing
            # from DEMO_ACTION_ITEMS seed without action items (and so don't
            # contribute to the panel) — that's intentional.
            ai_items = DEMO_ACTION_ITEMS.get(data.get("title") or "")
            if ai_items and not data.get("action_items"):
                data["action_items"] = list(ai_items)
            await db.collection("memories").document(data["id"]).set(data)
            seeded_memory_ids.append((data["id"], data["title"], data.get("source_type", "note"), data.get("source_url", ""), data.get("tags", [])))

        # ─── Tasks ───────────────────────────────────────────────────────────
        for task in DEMO_TASKS:
            data = dict(task)
            data["id"] = str(uuid.uuid4())
            data["created_at"] = now.isoformat()
            data["user_id"] = GUEST_UID
            data["userId"] = GUEST_UID
            data["due_date"] = _today_iso_offset(int(task.pop("due_offset_days", 0)))
            await db.collection("tasks").document(data["id"]).set(data)

        # ─── Calendar / schedule events ──────────────────────────────────────
        try:
            today = datetime.date.today()
            schedule_events = [
                ("Pitch rehearsal with mentor", 1, "10:00", 60, "Hackathon"),
                ("Deep work block — capture pipeline refactor", 0, "14:00", 120, "Engineering"),
                ("Demo recording session", 0, "16:30", 45, "Hackathon"),
                ("Submit prototype + write-up", 1, "11:00", 30, "Hackathon"),
                ("Beta tester onboarding call (#1)", 2, "15:00", 30, "GTM"),
                ("Beta tester onboarding call (#2)", 2, "16:00", 30, "GTM"),
                ("Weekly review", 5, "09:00", 45, "Productivity"),
                ("Read & summarise 'Year of Agents' podcast", 3, "08:00", 60, "Learning"),
            ]
            for title, day_off, time_str, dur, topic in schedule_events:
                ev_id = str(uuid.uuid4())
                ev = {
                    "id": ev_id,
                    "title": title,
                    "date": (today + datetime.timedelta(days=day_off)).isoformat(),
                    "time": time_str,
                    "duration_minutes": dur,
                    "description": "",
                    "linked_task_id": "",
                    "linked_memory_id": "",
                    "topic": topic,
                    "source": "demo-seed",
                    "created_at": now.isoformat(),
                    "gcal_event_id": "mock_calendar_id",
                    "user_id": GUEST_UID,
                    "userId": GUEST_UID,
                }
                await db.collection("schedules").document(ev_id).set(ev)
        except Exception as cal_e:
            print(f"Calendar seed warning: {cal_e}")

        # ─── Revisits (spaced repetition reminders) ──────────────────────────
        try:
            for idx, (mid, title, src_type, src_url, tags) in enumerate(seeded_memory_ids[:6]):
                rid = str(uuid.uuid4())
                next_due_dt = now + datetime.timedelta(days=(idx % 4) - 1, hours=idx * 3)
                rv = {
                    "id": rid,
                    "title": f"Revisit: {title[:120]}",
                    "memory_id": mid,
                    "url": src_url,
                    "notes": "",
                    "frequency": ["daily", "weekly", "monthly", "custom_days"][idx % 4],
                    "interval_days": 3 if idx % 4 == 3 else 0,
                    "specific_date": "",
                    "action_label": "Open",
                    "next_due": next_due_dt.isoformat(),
                    "last_visited": "",
                    "visit_count": idx,
                    "status": "active",
                    "created_at": now.isoformat(),
                    "updated_at": now.isoformat(),
                    "user_id": GUEST_UID,
                    "userId": GUEST_UID,
                }
                await db.collection("revisits").document(rid).set(rv)
        except Exception as rv_e:
            print(f"Revisits seed warning: {rv_e}")

        # ─── Workspace projects (3 demo projects) ────────────────────────────
        try:
            await _seed_workspace_projects(db, now, seeded_memory_ids)
        except Exception as ws_e:
            print(f"Workspace seed warning: {ws_e}")

        print(
            f"Demo data seeded for guest: "
            f"{len(DEMO_MEMORIES)} memories, {len(DEMO_TASKS)} tasks, "
            f"8 calendar events, 6 revisits, 3 workspace projects."
        )
        return True
    except Exception as e:
        print(f"Demo seed error: {e}")
        return False


async def _seed_workspace_projects(db, now: datetime.datetime, seeded_memory_ids: list) -> None:
    """Seed three demo workspace projects.

    IMPORTANT — schema (matches `app/workspace_agent.py`):
      project: { id, name, description, color, goal_type, folders, items, tasks }
      folder:  { id, name, description }
      item:    { id, kind, ref_id, title, url, folder_id, added_at, meta }
    """

    # Project 1 — GenAI APAC Hackathon
    project_id = "ws_demo_genai_apac"
    folder_id = "fld_research"
    ws_items = []
    for idx, (mid, title, src_type, src_url, tags) in enumerate(seeded_memory_ids[:6]):
        ws_items.append({
            "id": f"wi_{idx}_{uuid.uuid4().hex[:6]}",
            "kind": "memory",
            "ref_id": mid,
            "title": title,
            "url": src_url,
            "folder_id": folder_id,
            "added_at": now.isoformat(),
            "order": idx,
            "meta": {"source_type": src_type, "tags": tags or []},
        })
    project = {
        "id": project_id,
        "name": "GenAI APAC Hackathon — Recall X247",
        "description": "Ship a multi-agent Second Brain on Google Cloud (Vertex AI + Cloud Run) and submit a 3-minute demo video.",
        "goal_type": "hackathon",
        "domain": "AI / Productivity",
        "tags": ["hackathon", "gcp", "agents", "vertex-ai"],
        "color": "#6366f1",
        "owner_uid": GUEST_UID,
        "user_id": GUEST_UID,
        "userId": GUEST_UID,
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
        "status": "active",
        "folders": [{"id": folder_id, "name": "Research", "description": "Captured material to study", "order": 0}],
        "items": ws_items,
        "tasks": [],
        "meta": {"memory_ids": [m[0] for m in seeded_memory_ids[:6]]},
    }
    await db.collection("workspace_projects").document(project_id).set(project)

    # Project 2 — Personal Productivity OS
    p2_id = "ws_demo_personal_os"
    p2_items = []
    for idx, (mid, title, src_type, src_url, tags) in enumerate(seeded_memory_ids[6:10]):
        p2_items.append({
            "id": f"wi2_{idx}_{uuid.uuid4().hex[:6]}",
            "kind": "memory",
            "ref_id": mid,
            "title": title,
            "url": src_url,
            "folder_id": "fld_habits",
            "added_at": now.isoformat(),
            "order": idx,
            "meta": {"source_type": src_type, "tags": tags or []},
        })
    p2 = {
        "id": p2_id,
        "name": "Personal Productivity OS",
        "description": "Build a sustainable personal operating system: deep work blocks, weekly review, knowledge capture pipeline.",
        "goal_type": "personal",
        "domain": "Productivity",
        "tags": ["productivity", "habits", "pkm"],
        "color": "#10b981",
        "owner_uid": GUEST_UID,
        "user_id": GUEST_UID,
        "userId": GUEST_UID,
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
        "status": "active",
        "folders": [{"id": "fld_habits", "name": "Habits & Systems", "description": "Workflow and routine references", "order": 0}],
        "items": p2_items,
        "tasks": [],
        "meta": {"memory_ids": [m[0] for m in seeded_memory_ids[6:10]]},
    }
    await db.collection("workspace_projects").document(p2_id).set(p2)

    # Project 3 — Engineering Knowledge Vault
    p3_id = "ws_demo_eng_vault"
    p3_items = []
    for idx, (mid, title, src_type, src_url, tags) in enumerate(seeded_memory_ids[2:8]):
        p3_items.append({
            "id": f"wi3_{idx}_{uuid.uuid4().hex[:6]}",
            "kind": "memory",
            "ref_id": mid,
            "title": title,
            "url": src_url,
            "folder_id": "fld_eng",
            "added_at": now.isoformat(),
            "order": idx,
            "meta": {"source_type": src_type, "tags": tags or []},
        })
    p3 = {
        "id": p3_id,
        "name": "Engineering Knowledge Vault",
        "description": "Ongoing technical reading list — RAG, agents, vector DBs, serverless deploys.",
        "goal_type": "learning",
        "domain": "Engineering",
        "tags": ["engineering", "rag", "agents", "infra"],
        "color": "#3b82f6",
        "owner_uid": GUEST_UID,
        "user_id": GUEST_UID,
        "userId": GUEST_UID,
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
        "status": "active",
        "folders": [{"id": "fld_eng", "name": "Reading List", "description": "Engineering deep-dives and references", "order": 0}],
        "items": p3_items,
        "tasks": [],
        "meta": {"memory_ids": [m[0] for m in seeded_memory_ids[2:8]]},
    }
    await db.collection("workspace_projects").document(p3_id).set(p3)
