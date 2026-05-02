import { useEffect, useRef, useState, useMemo, type ReactNode } from 'react';
import { motion, useScroll, useSpring, AnimatePresence, useReducedMotion, useInView } from 'framer-motion';
import {
  Brain, Sparkles, ArrowRight, Shield, Cpu, Search,
  Calendar, Layers, Star, Check, ChevronRight, Github, Twitter, Linkedin,
  Menu, X, Sun, Moon, FileText, Network, BookOpen, Activity, Database,
  Headphones, Plus, Minus, Quote, Youtube, Globe, Mail,
  Zap, Rocket, Target, Telescope, Compass, Send, MessageCircle,
  TrendingUp, Clock, Lock, Hexagon, Mic, Link2, BrainCircuit,
  FlaskConical, Wifi, BarChart3, Flame,
} from 'lucide-react';

type LandingProps = {
  navigate: (path: string) => void;
  isDark: boolean;
  toggleTheme: () => void;
};

// ── DATA ─────────────────────────────────────────────────────────
const AGENTS = [
  { icon: Layers, name: 'Orchestrator', tagline: 'Routes intent', color: '#3b82f6', desc: 'Picks the right specialist for every query and streams the answer in real time via SSE.' },
  { icon: FileText, name: 'Capture', tagline: 'Universal ingest', color: '#22d3ee', desc: 'YouTube transcripts, web pages, PDFs, voice notes — all turned into clean tagged memory.' },
  { icon: Search, name: 'Recall', tagline: 'Semantic memory', color: '#818cf8', desc: '3-tier search (tag + domain + full text) finds meaning, not just keywords.' },
  { icon: Network, name: 'Graph', tagline: 'Living knowledge', color: '#818cf8', desc: 'Auto-links ideas, people and projects into a 3D mind graph that grows with you.' },
  { icon: Calendar, name: 'Planner', tagline: 'Tasks + calendar', color: '#3b82f6', desc: 'Turns insights into prioritized tasks, study plans and deep-work blocks.' },
  { icon: BookOpen, name: 'Briefing', tagline: 'Daily digest', color: '#fb7185', desc: 'AI brief every morning of yesterday + what to focus on today, cached for speed.' },
  { icon: BarChart3, name: 'Analytics', tagline: 'Insight engine', color: '#60a5fa', desc: 'Tracks learning velocity, domain expertise and streaks across every module.' },
];

const HOW_IT_WORKS = [
  {
    step: '01',
    icon: Telescope,
    title: 'Capture anything',
    desc: 'Drop a YouTube link, paste an article, upload a PDF, record a voice note. Capture Agent ingests, transcribes via Whisper, and auto-tags with AI in seconds.',
    samples: ['Voice memo · transcribed · 4:12', 'YouTube · 47 min lecture', 'PDF · Q3 strategy.pdf', 'Web article · auto-tagged'],
    accent: '#22d3ee',
  },
  {
    step: '02',
    icon: Network,
    title: 'Connect everything',
    desc: 'Graph Agent silently links new memories to old. Discover Agent (live YouTube Data API) brings in fresh learning material wired to what you already know.',
    samples: ['"RAG" linked to 14 memories', '"Transformers" · 8 new edges', 'Cluster: GTM playbook (12)', 'Discover · 6 fresh videos pulled'],
    accent: '#818cf8',
  },
  {
    step: '03',
    icon: Compass,
    title: 'Recall, plan, master',
    desc: 'Ask in plain English. Orchestrator streams a cited answer. Planner schedules deep-work. Flashcards (SRS) and Study Plan turn memory into mastery.',
    samples: ['"What did Maya say about pricing?"', 'Streamed answer · 6 citations · 0.4s', 'Deep-work block scheduled · Mon 9am', 'Flashcards generated · 12 cards'],
    accent: '#3b82f6',
  },
];

const PERSONAS = [
  {
    icon: Rocket,
    name: 'Founders',
    color: '#3b82f6',
    promise: 'Never lose a customer insight, investor note, or roadmap idea again.',
    bullets: ['Capture investor calls automatically', 'Daily brief of what your team shipped', 'Recall every customer conversation'],
  },
  {
    icon: Telescope,
    name: 'Researchers',
    color: '#22d3ee',
    promise: 'Build a living library of every paper, lecture, and breakthrough you read.',
    bullets: ['Auto-summarize papers + lectures', 'Find connections across fields', 'Cite memories in your writing'],
  },
  {
    icon: Target,
    name: 'Operators',
    color: '#818cf8',
    promise: 'Stop searching docs. Just ask your second brain and get the answer.',
    bullets: ['Index every Notion + Slack thread', 'Surface SOPs the moment you need them', 'Auto-schedule deep-work blocks'],
  },
];

const STATS = [
  { value: 1200000, display: '1.2M+', label: 'Memories captured', suffix: '' },
  { value: 98.7, display: '98.7%', label: 'Recall accuracy', suffix: '%' },
  { value: 9.4, display: '9.4h', label: 'Saved per week', suffix: 'h' },
  { value: 400, display: '< 400ms', label: 'Avg recall time', suffix: 'ms' },
];

const TESTIMONIALS = [
  { quote: 'Recall X247 replaced four apps for me. The multi-agent setup is genuinely magical — like having a team of researchers on call 24/7.', name: 'Maya Rodriguez', role: 'Founder, Lumen Labs', avatar: 'MR', tint: '#3b82f6' },
  { quote: 'The daily briefings are wild. It surfaces connections between ideas I forgot I had. Felt like cheating my way to a research PhD.', name: 'Aisha Patel', role: 'Independent researcher', avatar: 'AP', tint: '#818cf8' },
  { quote: 'I used to lose 2 hours a day searching old notes. Now I just ask the Orchestrator and it pulls the exact memory in seconds.', name: 'Daniel Park', role: 'Sr. PM at Stripe', avatar: 'DP', tint: '#22d3ee' },
  { quote: 'Setup took 3 minutes. By day two I had a graph of 800 memories. By week one I felt 30% smarter at work.', name: 'Jordan Lee', role: 'Eng lead, Series B', avatar: 'JL', tint: '#818cf8' },
  { quote: 'The fact that seven specialist agents coordinate behind one chat is pure science fiction. And it just works.', name: 'Priya Suresh', role: 'AI consultant', avatar: 'PS', tint: '#3b82f6' },
  { quote: 'I run a 12-person team. Shared graph means we stop re-asking each other the same question. Massive unlock.', name: 'Sam Chen', role: 'COO at Arcfield', avatar: 'SC', tint: '#fb7185' },
];

const FAQ = [
  { q: 'How is this different from Notion or Mem?', a: 'Recall X247 is multi-agent first. Instead of a single chatbot or static wiki, seven specialist AIs coordinate to capture, link, recall, plan, brief and analyze continuously — across 24 purpose-built modules from Notes and Bookmarks to a 3D Mind Graph and SRS Flashcards.' },
  { q: 'Where does the YouTube content come from?', a: 'Discover Agent uses the real YouTube Data API v3 with live view counts, durations, channel metadata and publish dates. When the API is unavailable it falls back to AI-curated suggestions from top creators (3Blue1Brown, Fireship, IBM Technology and more) so the experience never breaks.' },
  { q: 'Where is my data stored?', a: 'Your knowledge lives in a private Google Cloud Firestore graph tied to your account. Auth runs through Firebase; everything is encrypted in transit. Shareable memory links use one-way tokens — your data is never used to train any model.' },
  { q: 'Which models power the agents?', a: 'Google Gemini 2.0 Flash as primary, with OpenAI GPT-4o-mini fallback for rate limits. Voice capture uses OpenAI Whisper. Each agent picks the best model for its job and you can swap models per-agent in Settings.' },
  { q: 'What modules ship with the free tier?', a: 'All 24 modules — Capture, Recall, Discover, Notes, Bookmarks, Habits, Tasks, Calendar, Flashcards (SRS), Study Plan, Mind Graph, Timeline, Analytics, Daily Briefing, Voice capture, Shareable links — every module is included free forever. Premium only unlocks scale and team features.' },
  { q: 'Can I import from other tools?', a: 'Yes. Notion, Obsidian, Apple Notes, Readwise, Pocket, Roam, CSV and 30+ integrations across Google Workspace, Slack, GitHub, Linear, Stripe and more land out of the box.' },
];

const COMPARE: Array<{ label: string; recall: string | boolean; notion: string | boolean; mem: string | boolean }> = [
  { label: 'Multi-agent orchestration', recall: '7 specialist agents', notion: false, mem: 'Single AI' },
  { label: 'Semantic recall (3-tier)', recall: true, notion: 'Limited', mem: true },
  { label: '3D living knowledge graph', recall: true, notion: false, mem: false },
  { label: 'YouTube live discovery (Data API)', recall: true, notion: false, mem: false },
  { label: 'Voice capture (Whisper)', recall: true, notion: false, mem: false },
  { label: 'SRS flashcards + study plan', recall: true, notion: false, mem: false },
  { label: 'Daily AI briefings (cached)', recall: true, notion: false, mem: 'Beta' },
  { label: 'Habits + Notes + Bookmarks built-in', recall: true, notion: 'Via DBs', mem: false },
  { label: 'Shareable public memory links', recall: true, notion: 'Page only', mem: false },
  { label: 'All 24 modules free forever', recall: true, notion: 'Trial only', mem: 'Trial only' },
];

const LOGOS = ['Lumen Labs', 'Arcfield', 'Stripe', 'Linear', 'Notion', 'OpenAI', 'Vercel', 'Anthropic'];

const CHAT_SCRIPT = [
  { role: 'user', text: 'What did Maya say about pricing on the last call?' },
  { role: 'ai', text: 'Found 6 memories. Maya pushed for usage-based pricing tied to query volume. Final note: revisit after 100 paying users.' },
  { role: 'user', text: 'Schedule deep-work for the rewrite.' },
  { role: 'ai', text: 'Booked Mon–Wed 9–11am. Linked to Q3 strategy memory.' },
];

const TERMINAL_LOGS = [
  { time: '09:41:03', agent: 'Orchestrator', text: 'Query: "What did Maya say about pricing?"', color: '#3b82f6', bg: 'rgba(167,139,250,0.12)' },
  { time: '09:41:03', agent: 'Recall', text: 'Searching 2,847 memories for "Maya pricing"…', color: '#818cf8', bg: 'rgba(52,211,153,0.1)' },
  { time: '09:41:04', agent: 'Recall', text: '6 memories found · semantic score 0.94', color: '#818cf8', bg: 'rgba(52,211,153,0.1)' },
  { time: '09:41:04', agent: 'Graph', text: 'Loading memory edges → 14 connected nodes', color: '#818cf8', bg: 'rgba(244,114,182,0.1)' },
  { time: '09:41:04', agent: 'Orchestrator', text: 'Synthesising with 6 citation anchors…', color: '#3b82f6', bg: 'rgba(167,139,250,0.12)' },
  { time: '09:41:05', agent: 'Briefing', text: 'Flagged for today\'s brief · added to context', color: '#fb7185', bg: 'rgba(251,113,133,0.1)' },
  { time: '09:41:05', agent: 'Planner', text: 'Scheduling follow-up · Mon 9am deep-work', color: '#3b82f6', bg: 'rgba(251,191,36,0.1)' },
  { time: '09:41:05', agent: 'Orchestrator', text: '✓ Done · 0.41s · 6 citations · 3 agents', color: '#3b82f6', bg: 'rgba(167,139,250,0.12)' },
];

const TERMINAL_FEATS = [
  { icon: Zap, label: 'Sub-500ms end-to-end orchestration', detail: '0.41s avg', color: '#3b82f6' },
  { icon: Network, label: 'Real-time knowledge graph updates', detail: 'live edges', color: '#818cf8' },
  { icon: Shield, label: 'Zero data leakage — private by design', detail: 'encrypted', color: '#60a5fa' },
  { icon: Activity, label: 'Streaming SSE — words as they generate', detail: 'SSE stream', color: '#818cf8' },
];

const LIVE_FEED = [
  { icon: Mic, text: 'Voice memo captured', meta: '0.3s · Orchestrator', color: '#3b82f6' },
  { icon: Youtube, text: 'YouTube lecture parsed', meta: '12s · 47 memories', color: '#fb7185' },
  { icon: FileText, text: 'PDF strategy doc ingested', meta: '2.1s · 28 memories', color: '#22d3ee' },
  { icon: Link2, text: 'Article linked to 8 memories', meta: '0.8s · Graph Agent', color: '#818cf8' },
  { icon: MessageCircle, text: 'Slack thread summarized', meta: '1.4s · 12 memories', color: '#3b82f6' },
  { icon: Globe, text: 'Web research captured', meta: '3.2s · 19 memories', color: '#818cf8' },
  { icon: Send, text: 'Email thread distilled', meta: '0.9s · 6 memories', color: '#60a5fa' },
  { icon: BrainCircuit, text: 'Knowledge cluster formed', meta: 'Graph · 34 nodes', color: '#3b82f6' },
  { icon: Zap, text: 'Daily brief generated', meta: 'Briefing Agent · 08:00', color: '#3b82f6' },
  { icon: Clock, text: 'Deep-work block scheduled', meta: 'Planner · Mon 9am', color: '#818cf8' },
];

const FEATURES = [
  {
    icon: BrainCircuit, title: 'Neural memory graph', size: 'wide',
    desc: 'Every idea becomes a node. Every concept an edge. A live 3D graph that wires itself as you think — surfacing connections you would never spot.',
    color: '#3b82f6', tag: 'Graph Agent',
  },
  {
    icon: Mic, title: 'Voice-first capture', size: 'tall',
    desc: 'Record a thought, get a structured tagged memory. Powered by OpenAI Whisper. Works on phone, tablet, desktop.',
    color: '#22d3ee', tag: 'Capture Agent',
  },
  {
    icon: Compass, title: 'Live YouTube discovery', size: 'small',
    desc: 'Real Data API v3 — live view counts, channels, durations on every topic.',
    color: '#fb7185', tag: 'Discover Agent',
  },
  {
    icon: Zap, title: 'Sub-400ms recall', size: 'small',
    desc: '3-tier semantic search across every memory you have ever captured.',
    color: '#818cf8', tag: 'Recall Agent',
  },
  {
    icon: BarChart3, title: 'Daily AI briefings', size: 'tall',
    desc: 'Every morning: what happened yesterday, what matters today, what you are forgetting. Cached and ready before you wake up.',
    color: '#fb7185', tag: 'Briefing Agent',
  },
  {
    icon: Lock, title: 'Private by design', size: 'wide',
    desc: 'Your graph never trains a model. End-to-end encrypted in transit. Firebase Auth + Firestore. Shareable links use revocable one-way tokens.',
    color: '#60a5fa', tag: 'Guardian',
  },
];

// ── ALL 24 MODULES grouped by the 5 nav groups (matches the live app sidebar) ──
const MODULE_MAP = [
  {
    group: 'AI Brain',
    color: '#3b82f6',
    icon: BrainCircuit,
    desc: 'The orchestration layer. Where seven agents coordinate.',
    items: [
      { icon: Layers,   name: 'Dashboard',     blurb: 'Power Hub · streaks · daily brief' },
      { icon: Cpu,      name: 'Agent Hub',     blurb: 'Chat with 7 specialist agents (SSE stream)' },
      { icon: Search,   name: 'Neural Recall', blurb: '3-tier semantic search · sub-400ms' },
      { icon: Compass,  name: 'Discover',      blurb: 'Live YouTube Data API v3 + curated web' },
    ],
  },
  {
    group: 'Knowledge',
    color: '#22d3ee',
    icon: Database,
    desc: 'Capture once. Find forever.',
    items: [
      { icon: Plus,      name: 'Capture',   blurb: 'YouTube · web · PDF · voice (Whisper) · note' },
      { icon: Database,  name: 'Vault',     blurb: 'Every memory · auto-tagged · shareable' },
      { icon: FileText,  name: 'Notes',     blurb: 'Markdown editor with split preview' },
      { icon: BookOpen,  name: 'Bookmarks', blurb: 'Read-later with status filters' },
    ],
  },
  {
    group: 'Productivity',
    color: '#818cf8',
    icon: Calendar,
    desc: 'Insights become action.',
    items: [
      { icon: Check,        name: 'Tasks',       blurb: 'Priority · due dates · agent-created' },
      { icon: Calendar,     name: 'Calendar',    blurb: 'Deep-work blocks scheduled by Planner' },
      { icon: Activity,     name: 'Habits',      blurb: 'Daily tracker · streaks · 30-day heatmap' },
      { icon: Hexagon,      name: 'Flashcards',  blurb: 'Spaced repetition (SM-2) · auto-generated' },
      { icon: Telescope,    name: 'Study Plan',  blurb: 'AI builds your weekly study calendar' },
    ],
  },
  {
    group: 'Insight',
    color: '#fb7185',
    icon: BarChart3,
    desc: 'Watch your second brain grow.',
    items: [
      { icon: Clock,    name: 'Timeline',  blurb: 'Every memory in time order' },
      { icon: Network,  name: 'Mind Graph', blurb: '3D live force-directed graph' },
      { icon: BarChart3,name: 'Analytics', blurb: 'Learning velocity · domain expertise · streaks' },
    ],
  },
  {
    group: 'System',
    color: '#60a5fa',
    icon: Shield,
    desc: 'Control what flows in.',
    items: [
      { icon: Wifi,         name: 'Integrations', blurb: '30+ services: Google · Slack · GitHub · Notion' },
      { icon: FlaskConical, name: 'Pitch Deck',   blurb: 'Live demo of the multi-agent OS' },
      { icon: Shield,       name: 'Settings',     blurb: 'Theme · model selection · 2FA · API keys' },
    ],
  },
];

// ── COMPONENT ────────────────────────────────────────────────────
export default function Landing({ navigate, isDark, toggleTheme }: LandingProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [scrolled, setScrolled] = useState(false);
  const [chatStep, setChatStep] = useState(1);
  const [activePersona, setActivePersona] = useState(0);

  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const progressBar = useSpring(scrollYProgress, { stiffness: 100, damping: 20 });

  // Scroll handler
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Animate chat preview
  useEffect(() => {
    if (reduceMotion) { setChatStep(CHAT_SCRIPT.length); return; }
    const t = setInterval(() => {
      setChatStep(s => (s >= CHAT_SCRIPT.length ? 1 : s + 1));
    }, 2800);
    return () => clearInterval(t);
  }, [reduceMotion]);

  // Mobile menu keyboard
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileMenuOpen(false); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      lastFocusedRef.current?.focus();
    };
  }, [mobileMenuOpen]);

  return (
    <div className="lx-shell">
      {/* Scroll progress bar */}
      <motion.div className="lx-progress" style={{ scaleX: progressBar }} />

      {/* Background layers */}
      <div className="lx-bg">
        <div className="lx-bg-vignette" />
        <div className="lx-bg-grid" />
        <div className="lx-bg-orb lx-bg-orb-1" />
        <div className="lx-bg-orb lx-bg-orb-2" />
        <div className="lx-bg-orb lx-bg-orb-3" />
        <div className="lx-bg-noise" />
      </div>

      {/* ── NAV ──────────────────────────────────────────────────── */}
      <header className={`lx-nav ${scrolled ? 'lx-nav-scrolled' : ''}`}>
        <div className="lx-nav-inner">
          <button className="lx-nav-menu-btn" onClick={() => setMobileMenuOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <button className="lx-nav-logo" onClick={() => navigate('/')} aria-label="Recall X247 home">
            <img src="/x247-logo.webp" alt="x247 AI" className="lx-brand-img" width={785} height={421} decoding="async" fetchPriority="high" draggable={false} />
          </button>
          <nav className="lx-nav-links">
            <a href="#how" className="lx-nav-link">How it works</a>
            <a href="#agents" className="lx-nav-link">Agents</a>
            <a href="#modules" className="lx-nav-link">Modules</a>
            <a href="#use" className="lx-nav-link">Use cases</a>
            <a href="#pricing" className="lx-nav-link">Pricing</a>
            <a href="#faq" className="lx-nav-link">FAQ</a>
          </nav>
          <div className="lx-nav-actions">
            <button onClick={toggleTheme} className="lx-icon-btn" aria-label="Toggle theme">
              {isDark ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button onClick={() => navigate('/login')} className="lx-pill-ghost lx-nav-signin">Sign in</button>
            <button onClick={() => navigate('/login?mode=signup')} className="lx-pill-primary">
              <span>Get Started</span><ArrowRight size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            ref={mobileMenuRef}
            className="lx-mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Site navigation"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <button className="lx-mobile-close" onClick={() => setMobileMenuOpen(false)} aria-label="Close menu"><X size={20} /></button>
            <nav className="lx-mobile-links">
              <a href="#how" onClick={() => setMobileMenuOpen(false)}>How it works</a>
              <a href="#agents" onClick={() => setMobileMenuOpen(false)}>Agents</a>
              <a href="#modules" onClick={() => setMobileMenuOpen(false)}>Modules</a>
              <a href="#use" onClick={() => setMobileMenuOpen(false)}>Use cases</a>
              <a href="#pricing" onClick={() => setMobileMenuOpen(false)}>Pricing</a>
              <a href="#faq" onClick={() => setMobileMenuOpen(false)}>FAQ</a>
            </nav>
            <div className="lx-mobile-cta">
              <button onClick={() => { setMobileMenuOpen(false); navigate('/login'); }} className="lx-pill-ghost">Sign in</button>
              <button onClick={() => { setMobileMenuOpen(false); navigate('/login?mode=signup'); }} className="lx-pill-primary">
                <span>Get Started</span><ArrowRight size={14} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <section className="lx-hero">
        <NeuralCanvas />
        <div className="lx-hero-inner">
          

          <motion.h1
            className="lx-hero-title"
            initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.05 }}
          >
            <span className="lx-hero-line">The second brain that</span>
            <span className="lx-hero-line">
              <span className="lx-hero-word">thinks with you.</span>
            </span>
          </motion.h1>

          <motion.p
            className="lx-hero-sub"
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.18 }}
          >
            Seven specialist AI agents capture, link, recall and plan around you —
            so every idea, conversation and decision is one question away. Forever.
          </motion.p>

          <motion.div
            className="lx-hero-ctas"
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.28 }}
          >
            <button onClick={() => navigate('/login?mode=signup')} className="lx-pill-primary lx-pill-lg">
              <Sparkles size={14} /><span>Start free — no card</span>
            </button>
            <button onClick={() => navigate('/login')} className="lx-pill-ghost lx-pill-lg">
              <span>Sign in</span><ArrowRight size={14} />
            </button>
          </motion.div>

          <motion.div
            className="lx-hero-trust"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.42 }}
          >
            <div className="lx-trust-avatars">
              {['M', 'D', 'A', 'S', 'P'].map((l, i) => (
                <div key={l} className="lx-trust-avatar" style={{ ['--i' as any]: i }}>{l}</div>
              ))}
            </div>
            <div className="lx-trust-meta">
              <div className="lx-trust-stars">
                {Array.from({ length: 5 }).map((_, i) => <Star key={i} size={11} fill="#fbbf24" stroke="none" />)}
                <span className="lx-trust-rating">4.9</span>
              </div>
              <div className="lx-trust-text">2,400+ thinkers · loved by founders, researchers & operators</div>
            </div>
          </motion.div>

          {/* Live stats ticker */}
          <motion.div
            className="lx-hero-ticker"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.55 }}
          >
            {[
              { val: '1.2M+', lbl: 'memories' },
              { val: '< 400ms', lbl: 'recall' },
              { val: '7', lbl: 'agents' },
              { val: '98.7%', lbl: 'accuracy' },
            ].map((s, i) => (
              <div key={i} className="lx-hero-tick">
                <span className="lx-hero-tick-val">{s.val}</span>
                <span className="lx-hero-tick-lbl">{s.lbl}</span>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── PRODUCT MOCKUP ───────────────────────────────────────── */}
      <section className="lx-mockup-section">
        <motion.div
          className="lx-mockup-wrap"
          initial={{ opacity: 0, y: 60 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.9, ease: [0.22, 0.61, 0.36, 1] }}
        >
          <div className="lx-mockup-glow" />
          <div className="lx-mockup">
            <div className="lx-mock-chrome">
              <span className="lx-mock-dot" style={{ background: '#ff5f57' }} />
              <span className="lx-mock-dot" style={{ background: '#febc2e' }} />
              <span className="lx-mock-dot" style={{ background: '#28c840' }} />
              <div className="lx-mock-url">recall x247 · second brain</div>
              <div className="lx-mock-pill"><Activity size={11} /> Live</div>
            </div>

            <div className="lx-mock-body">
              <div className="lx-mock-sidebar">
                <div className="lx-mock-side-head">
                  <span className="lx-nav-logo-mark" style={{ width: 22, height: 22, borderRadius: 7 }}>
                    <Brain size={11} strokeWidth={2.4} />
                  </span>
                  <span>recall ×247</span>
                </div>
                <div className="lx-mock-side-section">Workspace</div>
                {[
                  { icon: MessageCircle, label: 'Chat', active: true },
                  { icon: Database, label: 'Memories' },
                  { icon: Network, label: 'Graph' },
                  { icon: Calendar, label: 'Briefings' },
                  { icon: Activity, label: 'Activity' },
                ].map((it, i) => {
                  const I = it.icon;
                  return (
                    <div key={i} className={`lx-mock-side-item ${it.active ? 'lx-mock-side-active' : ''}`}>
                      <I size={12} /><span>{it.label}</span>
                    </div>
                  );
                })}
                <div className="lx-mock-side-section">Agents · 7</div>
                <div className="lx-mock-agent-dots">
                  {AGENTS.map(a => (
                    <span key={a.name} className="lx-mock-agent-dot" style={{ background: a.color, boxShadow: `0 0 6px ${a.color}` }} title={a.name} />
                  ))}
                </div>
              </div>

              <div className="lx-mock-main">
                <div className="lx-mock-main-head">
                  <div className="lx-mock-thread">
                    <Hexagon size={11} />
                    <span>Strategy thread · today</span>
                  </div>
                  <div className="lx-mock-status">
                    <span className="lx-mock-status-dot" />
                    <span>3 agents working · 412 ms</span>
                  </div>
                </div>
                <div className="lx-mock-chat">
                  {CHAT_SCRIPT.slice(0, chatStep).map((m, i) => (
                    <motion.div
                      key={i}
                      className={`lx-mock-msg lx-mock-msg-${m.role}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35 }}
                    >
                      {m.role === 'ai' && (
                        <span className="lx-mock-msg-avatar"><Brain size={11} /></span>
                      )}
                      <div className="lx-mock-msg-bubble">
                        {m.text}
                        {m.role === 'ai' && i === chatStep - 1 && (
                          <span className="lx-mock-cursor" />
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
                <div className="lx-mock-input-bar">
                  <div className="lx-mock-input"><span className="lx-mock-input-placeholder">Ask your second brain…</span></div>
                  <button className="lx-mock-send"><Send size={11} /></button>
                </div>
              </div>

              <div className="lx-mock-right">
                <div className="lx-mock-card">
                  <div className="lx-mock-card-head">
                    <Cpu size={11} style={{ color: '#3b82f6' }} />
                    <span>Agents · active</span>
                  </div>
                  <div className="lx-mock-agents-mini">
                    {AGENTS.slice(0, 4).map(a => (
                      <div key={a.name} className="lx-mock-agent-row">
                        <span style={{ color: a.color, width: 8, height: 8, borderRadius: '50%', background: a.color, display: 'inline-block', boxShadow: `0 0 5px ${a.color}`, flexShrink: 0 }} />
                        <span className="lx-mock-agent-label">{a.name}</span>
                        <div className="lx-mock-bar"><span style={{ width: `${60 + Math.random() * 35}%` }} /></div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="lx-mock-card">
                  <div className="lx-mock-card-head">
                    <Network size={11} style={{ color: '#818cf8' }} />
                    <span>Graph · live</span>
                  </div>
                  <MiniGraph />
                </div>
                <div className="lx-mock-card">
                  <div className="lx-mock-card-head">
                    <TrendingUp size={11} style={{ color: '#818cf8' }} />
                    <span>This week</span>
                  </div>
                  <div className="lx-mock-stat">
                    <span className="lx-mock-stat-val">+218</span>
                    <span className="lx-mock-stat-lbl">new memories</span>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </motion.div>
      </section>

      {/* ── LOGO BAR ─────────────────────────────────────────────── */}
      <section className="lx-logobar">
        <div className="lx-logobar-label">Trusted by teams shipping at companies like</div>
        <div className="lx-logobar-row">
          {LOGOS.map(name => <span key={name} className="lx-logo">{name}</span>)}
        </div>
      </section>

      {/* ── LIVE ACTIVITY FEED ───────────────────────────────────── */}
      <section className="lx-feed-section">
        <div className="lx-feed-label">
          <span className="lx-feed-dot" />
          <span>Live intelligence feed — memories being captured right now</span>
        </div>
        <div className="lx-feed-track-wrap">
          <div className="lx-feed-fade lx-feed-fade-l" />
          <div className="lx-feed-track">
            <div className="lx-feed-row">
              {[...LIVE_FEED, ...LIVE_FEED].map((item, i) => {
                const Icon = item.icon;
                return (
                  <div key={i} className="lx-feed-item" style={{ ['--fc' as any]: item.color }}>
                    <span className="lx-feed-icon"><Icon size={13} /></span>
                    <span className="lx-feed-text">{item.text}</span>
                    <span className="lx-feed-meta">{item.meta}</span>
                  </div>
                );
              })}
            </div>
            <div className="lx-feed-row lx-feed-row-rev">
              {[...LIVE_FEED.slice(5), ...LIVE_FEED.slice(0, 5), ...LIVE_FEED.slice(5), ...LIVE_FEED.slice(0, 5)].map((item, i) => {
                const Icon = item.icon;
                return (
                  <div key={i} className="lx-feed-item" style={{ ['--fc' as any]: item.color }}>
                    <span className="lx-feed-icon"><Icon size={13} /></span>
                    <span className="lx-feed-text">{item.text}</span>
                    <span className="lx-feed-meta">{item.meta}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="lx-feed-fade lx-feed-fade-r" />
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────── */}
      <section id="how" className="lx-section">
        <SectionHeader
          eyebrow="How it works"
          title={<>From scattered notes to <span className="lx-grad-silver">a thinking partner</span> — in three moves.</>}
          sub="No setup ceremony. No wikis. Just capture and ask."
        />
        <div className="lx-how-grid">
          {HOW_IT_WORKS.map((step, i) => {
            const Icon = step.icon;
            return (
              <motion.div
                key={step.step}
                className="lx-how-card"
                style={{ ['--accent' as any]: step.accent }}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
              >
                <div className="lx-how-num">{step.step}</div>
                <div className="lx-how-icon"><Icon size={20} /></div>
                <h3 className="lx-how-title">{step.title}</h3>
                <p className="lx-how-desc">{step.desc}</p>
                <div className="lx-how-samples">
                  {step.samples.map((s, j) => (
                    <motion.div
                      key={j}
                      className="lx-how-sample"
                      initial={{ opacity: 0, x: -10 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.1 + 0.3 + j * 0.08 }}
                    >
                      {s}
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* ── 7 AGENTS BENTO ───────────────────────────────────────── */}
      <section id="agents" className="lx-section">
        <SectionHeader
          eyebrow="The team behind the magic"
          title={<>Seven specialist agents. <span className="lx-grad-silver">One quiet symphony.</span></>}
          sub="Each agent is great at exactly one thing. Together, they think with you."
        />
        <div className="lx-agents-grid">
          {AGENTS.map((a, i) => {
            const Icon = a.icon;
            return (
              <motion.div
                key={a.name}
                className="lx-agent-card"
                style={{ ['--accent' as any]: a.color }}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.5, delay: i * 0.06 }}
              >
                <div className="lx-agent-glow" />
                <div className="lx-agent-icon"><Icon size={18} /></div>
                <div className="lx-agent-name">{a.name}</div>
                <div className="lx-agent-tag">{a.tagline}</div>
                <p className="lx-agent-desc">{a.desc}</p>
                <div className="lx-agent-pulse">
                  <span className="lx-agent-pulse-dot" />
                  <span>online</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* ── FEATURE BENTO GRID ───────────────────────────────────── */}
      <section className="lx-section">
        <SectionHeader
          eyebrow="Built different"
          title={<>Every feature is a <span className="lx-grad-silver">specialist agent.</span></>}
          sub="Not a plugin. Not a wrapper. A coordinated intelligence system."
        />
        <div className="lx-bento">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <motion.div
                key={f.title}
                className={`lx-bento-card lx-bento-${f.size}`}
                style={{ ['--accent' as any]: f.color }}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.55, delay: i * 0.07 }}
              >
                <div className="lx-bento-glow" />
                <div className="lx-bento-tag">{f.tag}</div>
                <div className="lx-bento-icon"><Icon size={22} /></div>
                <h3 className="lx-bento-title">{f.title}</h3>
                <p className="lx-bento-desc">{f.desc}</p>
                <div className="lx-bento-accent-line" />
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* ── MODULE MAP — every page in the app, grouped ──────────── */}
      <section id="modules" className="lx-section">
        <SectionHeader
          eyebrow="The full second brain · 24 modules"
          title={<>One app. <span className="lx-grad-silver">Every part of how you think.</span></>}
          sub="Five neural groups. Twenty-four purpose-built modules. Each one a click away from your dashboard Power Hub."
        />
        <div className="lx-modgrid">
          {MODULE_MAP.map((g, gi) => {
            const GIcon = g.icon;
            return (
              <motion.div
                key={g.group}
                className="lx-modgroup"
                style={{ ['--accent' as any]: g.color }}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.5, delay: gi * 0.06 }}
              >
                <div className="lx-modgroup-glow" />
                <div className="lx-modgroup-head">
                  <div className="lx-modgroup-icon"><GIcon size={16} /></div>
                  <div className="lx-modgroup-title">{g.group}</div>
                  <div className="lx-modgroup-count">{g.items.length} modules</div>
                </div>
                <p className="lx-modgroup-desc">{g.desc}</p>
                <div className="lx-modlist">
                  {g.items.map((m) => {
                    const MIcon = m.icon;
                    return (
                      <div key={m.name} className="lx-modrow">
                        <div className="lx-modrow-icon"><MIcon size={13} /></div>
                        <div className="lx-modrow-text">
                          <div className="lx-modrow-name">{m.name}</div>
                          <div className="lx-modrow-blurb">{m.blurb}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* ── KNOWLEDGE GRAPH SHOWCASE ─────────────────────────────── */}
      <section id="graph" className="lx-section">
        <div className="lx-graph-wrap">
          <motion.div
            className="lx-graph-text"
            initial={{ opacity: 0, x: -24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7 }}
          >
            <div className="lx-eyebrow">
              <span className="lx-eyebrow-dot" />
              The living graph
            </div>
            <h2 className="lx-section-title lx-graph-title">
              Watch your second brain <span className="lx-grad-silver">wire itself.</span>
            </h2>
            <p className="lx-section-sub lx-graph-sub">
              Every memory becomes a node. Every concept becomes an edge. The Graph Agent
              quietly stitches your knowledge together so connections you would never spot
              surface on their own.
            </p>
            <div className="lx-graph-stats">
              <div className="lx-graph-stat">
                <div className="lx-graph-stat-icon" style={{ color: '#3b82f6' }}><Hexagon size={14} /></div>
                <div>
                  <div className="lx-graph-stat-v">14,892</div>
                  <div className="lx-graph-stat-l">Nodes wired</div>
                </div>
              </div>
              <div className="lx-graph-stat">
                <div className="lx-graph-stat-icon" style={{ color: '#818cf8' }}><Link2 size={14} /></div>
                <div>
                  <div className="lx-graph-stat-v">38,217</div>
                  <div className="lx-graph-stat-l">Edges drawn</div>
                </div>
              </div>
              <div className="lx-graph-stat">
                <div className="lx-graph-stat-icon" style={{ color: '#22d3ee' }}><Network size={14} /></div>
                <div>
                  <div className="lx-graph-stat-v">412</div>
                  <div className="lx-graph-stat-l">Clusters formed</div>
                </div>
              </div>
              <div className="lx-graph-stat">
                <div className="lx-graph-stat-icon" style={{ color: '#fb7185' }}><Zap size={14} /></div>
                <div>
                  <div className="lx-graph-stat-v">0.41s</div>
                  <div className="lx-graph-stat-l">Avg sync time</div>
                </div>
              </div>
            </div>
            <div className="lx-graph-bullets">
              <div className="lx-graph-bullet"><Check size={12} /> Force-directed 3D physics renderer</div>
              <div className="lx-graph-bullet"><Check size={12} /> Auto-clusters by topic, person, project</div>
              <div className="lx-graph-bullet"><Check size={12} /> Click any node to recall every related memory</div>
            </div>
          </motion.div>
          <motion.div
            className="lx-graph-canvas-wrap"
            initial={{ opacity: 0, scale: 0.92 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.8, delay: 0.1 }}
          >
            <BigGraph />
          </motion.div>
        </div>
      </section>

      {/* ── DASHBOARD PREVIEW — Power Hub + briefing + streaks ───── */}
      <section id="dashboard-preview" className="lx-section">
        <SectionHeader
          eyebrow="Inside your dashboard"
          title={<>One screen. <span className="lx-grad-silver">Every superpower.</span></>}
          sub="The Power Hub puts every agent, every module and every captured idea one click away — with a daily AI briefing waiting before you wake up."
        />
        <div className="lx-dashprev">
          <div className="lx-dashprev-glow" />
          <div className="lx-dashprev-grid">
            {/* Briefing */}
            <div className="lx-dashprev-card lx-dashprev-brief">
              <div className="lx-dashprev-card-head">
                <span className="lx-dashprev-pill" style={{ ['--pc' as any]: '#fb7185' }}>Briefing Agent</span>
                <span className="lx-dashprev-time">08:00</span>
              </div>
              <div className="lx-dashprev-title-md">Today you should focus on…</div>
              <ul className="lx-dashprev-brieflist">
                <li><span className="lx-dot" style={{ background: '#3b82f6' }} /> Q3 strategy memo (Maya flagged)</li>
                <li><span className="lx-dot" style={{ background: '#22d3ee' }} /> Ship RAG playbook v2 — 3 cards due</li>
                <li><span className="lx-dot" style={{ background: '#fb7185' }} /> Daily review · 12 new edges</li>
              </ul>
            </div>

            {/* Power Hub mini grid */}
            <div className="lx-dashprev-card lx-dashprev-power">
              <div className="lx-dashprev-card-head">
                <span className="lx-dashprev-pill" style={{ ['--pc' as any]: '#3b82f6' }}>Power Hub</span>
                <span className="lx-dashprev-time">one-click</span>
              </div>
              <div className="lx-dashprev-powergrid">
                {[
                  { icon: Plus, label: 'Capture', c: '#6366f1' },
                  { icon: Cpu, label: 'Agent Hub', c: '#3b82f6' },
                  { icon: Search, label: 'Recall', c: '#9333ea' },
                  { icon: Compass, label: 'Discover', c: '#06b6d4' },
                  { icon: Hexagon, label: 'Cards', c: '#ec4899' },
                  { icon: Check, label: 'Tasks', c: '#10b981' },
                  { icon: Network, label: 'Graph', c: '#06b6d4' },
                  { icon: Telescope, label: 'Plan', c: '#7c3aed' },
                ].map((b) => {
                  const I = b.icon;
                  return (
                    <div key={b.label} className="lx-dashprev-powerbtn" style={{ ['--pc' as any]: b.c }}>
                      <I size={13} />
                      <span>{b.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Streak + habits */}
            <div className="lx-dashprev-card lx-dashprev-streak">
              <div className="lx-dashprev-card-head">
                <span className="lx-dashprev-pill" style={{ ['--pc' as any]: '#10b981' }}>Habits</span>
                <span className="lx-dashprev-time">17 day streak</span>
              </div>
              <div className="lx-dashprev-heat">
                {Array.from({ length: 30 }).map((_, i) => {
                  const intensity = Math.max(0, Math.min(1, (Math.sin(i * 1.7) + 1) / 2));
                  return (
                    <div
                      key={i}
                      className="lx-dashprev-heatcell"
                      style={{ background: `rgba(16,185,129,${0.12 + intensity * 0.55})` }}
                    />
                  );
                })}
              </div>
              <div className="lx-dashprev-streakrow">
                <Flame size={13} style={{ color: '#fb923c' }} />
                <span>Read · Workout · Code · Review · Reflect</span>
              </div>
            </div>

            {/* Live agent feed */}
            <div className="lx-dashprev-card lx-dashprev-feed">
              <div className="lx-dashprev-card-head">
                <span className="lx-dashprev-pill" style={{ ['--pc' as any]: '#22d3ee' }}>Live agent feed</span>
                <span className="lx-dashprev-live"><span className="lx-dashprev-livedot" /> live</span>
              </div>
              <div className="lx-dashprev-feedlist">
                <div className="lx-dashprev-feedrow"><Mic size={11} style={{ color: '#3b82f6' }} /><span>Voice memo captured · 0.3s</span></div>
                <div className="lx-dashprev-feedrow"><Youtube size={11} style={{ color: '#fb7185' }} /><span>YouTube · 47 memories pulled</span></div>
                <div className="lx-dashprev-feedrow"><Network size={11} style={{ color: '#818cf8' }} /><span>Graph · 8 new edges</span></div>
                <div className="lx-dashprev-feedrow"><BarChart3 size={11} style={{ color: '#60a5fa' }} /><span>Analytics · streak +1</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── LIVE DISCOVER — real YouTube Data API v3 ────────────── */}
      <section id="discover-preview" className="lx-section">
        <SectionHeader
          eyebrow="Live · YouTube Data API v3"
          title={<>Discover <span className="lx-grad-silver">what to learn next.</span></>}
          sub="Type any topic. Discover Agent pulls real YouTube videos with live view counts, channels and durations — then auto-suggests captures for your second brain."
        />
        <div className="lx-discover">
          <div className="lx-discover-bar">
            <Search size={15} className="lx-discover-bar-icon" />
            <span className="lx-discover-bar-text">transformers attention mechanism</span>
            <span className="lx-discover-bar-pill"><span className="lx-discover-livedot" /> Live</span>
          </div>
          <div className="lx-discover-grid">
            {[
              { title: 'But what is a Neural Network? · Chapter 1', ch: '3Blue1Brown', views: '18M views', dur: '19:13', age: '7y ago', c: '#3b82f6' },
              { title: 'Attention is all you need (Transformer)', ch: 'Yannic Kilcher', views: '912K views', dur: '27:07', age: '5y ago', c: '#fb7185' },
              { title: 'Transformers Explained Visually', ch: 'StatQuest with Josh Starmer', views: '1.4M views', dur: '36:15', age: '2y ago', c: '#22d3ee' },
              { title: 'The math behind Transformers', ch: 'Two Minute Papers', views: '584K views', dur: '12:48', age: '1y ago', c: '#818cf8' },
            ].map((v, i) => (
              <motion.div
                key={i}
                className="lx-discover-card"
                style={{ ['--accent' as any]: v.c }}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.5, delay: i * 0.07 }}
              >
                <div className="lx-discover-thumb">
                  <Youtube size={20} />
                  <span className="lx-discover-dur">{v.dur}</span>
                </div>
                <div className="lx-discover-body">
                  <div className="lx-discover-title">{v.title}</div>
                  <div className="lx-discover-meta">
                    <span className="lx-discover-ch">{v.ch}</span>
                    <span className="lx-discover-sep">·</span>
                    <span>{v.views}</span>
                    <span className="lx-discover-sep">·</span>
                    <span>{v.age}</span>
                  </div>
                  <div className="lx-discover-actions">
                    <span className="lx-discover-act"><Plus size={11} /> Capture</span>
                    <span className="lx-discover-act"><Network size={11} /> Wire</span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── INTELLIGENCE TERMINAL ────────────────────────────────── */}
      <section className="lx-section">
        <div className="lx-terminal-wrap">
          <motion.div
            className="lx-terminal-text"
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7 }}
          >
            <div className="lx-eyebrow"><span className="lx-eyebrow-dot" />Inside the machine</div>
            <h2 className="lx-section-title" style={{ textAlign: 'left', fontSize: 'clamp(28px, 3.8vw, 52px)' }}>
              Watch your agents <span className="lx-grad-silver">think out loud.</span>
            </h2>
            <p>Every query routes through a real-time orchestration layer — seven specialists coordinate in under 500ms, so you get answers, not interfaces.</p>
            <div className="lx-terminal-feat">
              {TERMINAL_FEATS.map((f, i) => {
                const Icon = f.icon;
                return (
                  <div key={i} className="lx-terminal-feat-row" style={{ ['--fc' as any]: f.color }}>
                    <span className="lx-terminal-feat-icon"><Icon size={14} /></span>
                    <span>{f.label}</span>
                    <em>{f.detail}</em>
                  </div>
                );
              })}
            </div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7 }}
          >
            <TerminalDemo />
          </motion.div>
        </div>
      </section>

      {/* ── USE CASES / PERSONAS ─────────────────────────────────── */}
      <section id="use" className="lx-section">
        <SectionHeader
          eyebrow="Built for the way you think"
          title={<>One brain, <span className="lx-grad-silver">three thinkers.</span></>}
          sub="Whether you're shipping product, doing research, or running ops — your second brain adapts."
        />
        <div className="lx-persona-wrap">
          <div className="lx-persona-tabs">
            {PERSONAS.map((p, i) => {
              const I = p.icon;
              return (
                <button
                  key={p.name}
                  onClick={() => setActivePersona(i)}
                  className={`lx-persona-tab ${i === activePersona ? 'lx-persona-tab-active' : ''}`}
                  style={{ ['--accent' as any]: p.color }}
                >
                  <I size={15} />
                  <span>{p.name}</span>
                </button>
              );
            })}
          </div>
          <div className="lx-persona-card" style={{ ['--accent' as any]: PERSONAS[activePersona].color }}>
            <AnimatePresence mode="wait">
              <motion.div
                key={activePersona}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.45 }}
                className="lx-persona-content"
              >
                <div className="lx-persona-icon">
                  {(() => { const I = PERSONAS[activePersona].icon; return <I size={26} />; })()}
                </div>
                <div className="lx-persona-name">{PERSONAS[activePersona].name}</div>
                <p className="lx-persona-promise">{PERSONAS[activePersona].promise}</p>
                <ul className="lx-persona-bullets">
                  {PERSONAS[activePersona].bullets.map((b, i) => (
                    <li key={i}><Check size={13} /> {b}</li>
                  ))}
                </ul>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </section>

      {/* ── STATS ─────────────────────────────────────────────────── */}
      <section className="lx-section lx-section-tight">
        <div className="lx-bigstats">
          {STATS.map((s, i) => (
            <motion.div
              key={s.label}
              className="lx-bigstat"
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
            >
              <CountUp display={s.display} className="lx-bigstat-v" />
              <div className="lx-bigstat-l">{s.label}</div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── COMPARISON TABLE ─────────────────────────────────────── */}
      <section className="lx-section">
        <SectionHeader
          eyebrow="Why Recall X247"
          title={<>The fastest path from <span className="lx-grad-silver">capture to clarity.</span></>}
        />
        <div className="lx-compare-card">
          <div className="lx-compare-row lx-compare-head">
            <div className="lx-compare-cell">Capability</div>
            <div className="lx-compare-cell lx-compare-mine"><span className="lx-compare-mark">●</span> Recall X247</div>
            <div className="lx-compare-cell">Notion AI</div>
            <div className="lx-compare-cell">Mem</div>
          </div>
          {COMPARE.map(row => (
            <div key={row.label} className="lx-compare-row">
              <div className="lx-compare-cell lx-compare-label">{row.label}</div>
              <CompareCell value={row.recall} highlight />
              <CompareCell value={row.notion} />
              <CompareCell value={row.mem} />
            </div>
          ))}
        </div>
      </section>

      {/* ── TESTIMONIAL MARQUEE ──────────────────────────────────── */}
      <section className="lx-section lx-section-tight">
        <SectionHeader
          eyebrow="Loved out loud"
          title={<>People who think for a living, <span className="lx-grad-silver">love thinking with us.</span></>}
        />
        <div className="lx-tmarquee-wrap">
          <div className="lx-tmarquee-fade lx-tmarquee-fade-l" />
          <div className="lx-tmarquee-fade lx-tmarquee-fade-r" />
          {/* Row 1 → left */}
          <div className="lx-tmarquee-row">
            <div className="lx-tmarquee-track">
              {[...TESTIMONIALS, ...TESTIMONIALS].map((t, i) => (
                <div key={i} className="lx-tmarquee-card" style={{ ['--accent' as any]: t.tint }}>
                  <Quote size={16} className="lx-tw-q" />
                  <p className="lx-tmarquee-quote">{t.quote}</p>
                  <div className="lx-tw-meta">
                    <div className="lx-tw-avatar" style={{ background: `linear-gradient(135deg, ${t.tint}, #22d3ee)` }}>{t.avatar}</div>
                    <div>
                      <div className="lx-tw-name">{t.name}</div>
                      <div className="lx-tw-role">{t.role}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Row 2 → right */}
          <div className="lx-tmarquee-row lx-tmarquee-row-rev">
            <div className="lx-tmarquee-track">
              {[...TESTIMONIALS.slice(3), ...TESTIMONIALS.slice(0, 3), ...TESTIMONIALS.slice(3), ...TESTIMONIALS.slice(0, 3)].map((t, i) => (
                <div key={i} className="lx-tmarquee-card" style={{ ['--accent' as any]: t.tint }}>
                  <Quote size={16} className="lx-tw-q" />
                  <p className="lx-tmarquee-quote">{t.quote}</p>
                  <div className="lx-tw-meta">
                    <div className="lx-tw-avatar" style={{ background: `linear-gradient(135deg, ${t.tint}, #22d3ee)` }}>{t.avatar}</div>
                    <div>
                      <div className="lx-tw-name">{t.name}</div>
                      <div className="lx-tw-role">{t.role}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── PRICING ──────────────────────────────────────────────── */}
      <section id="pricing" className="lx-section">
        <SectionHeader
          eyebrow="Pricing"
          title={<>Free to start. <span className="lx-grad-silver">Premium when ready.</span></>}
          sub="Every plan unlocks the full multi-agent system. Pay only for scale and team features."
        />
        <div className="lx-price-grid">
          <PriceCard
            name="Starter"
            price="$0"
            period="/mo"
            tag="Forever free"
            features={['All 7 agents included', '1 GB knowledge graph', '500 captures / month', 'Daily AI briefings', 'Community support']}
            cta="Get started"
            onCta={() => navigate('/login?mode=signup')}
          />
          <PriceCard
            name="Pro"
            price="$19"
            period="/mo"
            tag="Best for serious thinkers"
            features={['Unlimited captures', '50 GB knowledge graph', 'Advanced analytics', 'Custom agent workflows', 'Priority models (GPT-4o)', 'Priority support']}
            cta="Start Pro trial"
            onCta={() => navigate('/login?mode=signup')}
            featured
          />
          <PriceCard
            name="Teams"
            price="$49"
            period="/seat/mo"
            tag="For small high-output teams"
            features={['Everything in Pro', 'Shared knowledge graphs', 'Team briefings & digests', 'Admin & SSO controls', 'SOC 2 controls']}
            cta="Talk to sales"
            onCta={() => navigate('/login')}
          />
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────── */}
      <section id="faq" className="lx-section">
        <SectionHeader eyebrow="FAQ" title={<>Questions, <span className="lx-grad-silver">answered.</span></>} />
        <div className="lx-faq">
          {FAQ.map((f, i) => (
            <div key={i} className={`lx-faq-item ${openFaq === i ? 'lx-faq-open' : ''}`}>
              <button className="lx-faq-q" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                <span>{f.q}</span>
                <span className="lx-faq-icon">{openFaq === i ? <Minus size={15} /> : <Plus size={15} />}</span>
              </button>
              <AnimatePresence initial={false}>
                {openFaq === i && (
                  <motion.div
                    className="lx-faq-a"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <p>{f.a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </section>

      {/* ── FINAL CTA ────────────────────────────────────────────── */}
      <section className="lx-section">
        <div className="lx-final-cta">
          <div className="lx-final-glow" />
          <div className="lx-final-orb lx-final-orb-1" />
          <div className="lx-final-orb lx-final-orb-2" />
          <div className="lx-final-content">
            <div className="lx-eyebrow">
              <span className="lx-eyebrow-dot" />
              Your second brain is one click away
            </div>
            <h2 className="lx-final-title">
              Stop forgetting.<br /><span className="lx-final-grad">Start thinking with it.</span>
            </h2>
            <p className="lx-final-sub">Free forever. Set up in 90 seconds. Scales to your whole team when you're ready.</p>
            <div className="lx-hero-ctas">
              <button onClick={() => navigate('/login?mode=signup')} className="lx-pill-primary lx-pill-lg">
                <Sparkles size={14} /><span>Start free — no card</span>
              </button>
              <button onClick={() => navigate('/login')} className="lx-pill-ghost lx-pill-lg">
                <span>Sign in</span><ArrowRight size={14} />
              </button>
            </div>
            <div className="lx-final-badges">
              <span className="lx-final-badge"><Check size={11} /> No credit card</span>
              <span className="lx-final-badge"><Check size={11} /> 90-second setup</span>
              <span className="lx-final-badge"><Check size={11} /> Cancel anytime</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────── */}
      <footer className="lx-footer">
        <div className="lx-footer-top">
          <div className="lx-footer-brand">
            <button className="lx-nav-logo" onClick={() => navigate('/')}>
              <img src="/x247-logo.webp" alt="x247 AI" className="lx-brand-img" width={785} height={421} loading="lazy" decoding="async" draggable={false} />
            </button>
            <p className="lx-footer-tag">Your AI-powered second brain. Multi-agent. Always on.</p>
            <div className="lx-footer-social">
              <a href="#" aria-label="Twitter"><Twitter size={15} /></a>
              <a href="#" aria-label="GitHub"><Github size={15} /></a>
              <a href="#" aria-label="LinkedIn"><Linkedin size={15} /></a>
              <a href="#" aria-label="Email"><Mail size={15} /></a>
            </div>
          </div>
          <div className="lx-footer-cols">
            <div>
              <h5>Product</h5>
              <a href="#agents">Agents</a>
              <a href="#how">How it works</a>
              <a href="#pricing">Pricing</a>
              <a href="#">Changelog</a>
            </div>
            <div>
              <h5>Resources</h5>
              <a href="#">Docs</a>
              <a href="#">API</a>
              <a href="#">Guides</a>
              <a href="#">Status</a>
            </div>
            <div>
              <h5>Company</h5>
              <a href="#">About</a>
              <a href="#">Blog</a>
              <a href="#">Careers</a>
              <a href="#">Contact</a>
            </div>
            <div>
              <h5>Legal</h5>
              <a href="#">Privacy</a>
              <a href="#">Terms</a>
              <a href="#">Security</a>
              <a href="#">DPA</a>
            </div>
          </div>
        </div>
        <div className="lx-footer-bottom">
          <span>© 2026 Recall X247 Labs · All rights reserved.</span>
          <span className="lx-footer-meta">v3.0 · Made on Earth</span>
        </div>
      </footer>

      {/* Floating help dock */}
      <div className="lx-dock">
        <button className="lx-dock-btn" onClick={() => navigate('/login')} aria-label="Talk to us">
          <Headphones size={16} />
        </button>
      </div>
    </div>
  );
}

// ── SUB-COMPONENTS ───────────────────────────────────────────────
function SectionHeader({ eyebrow, title, sub }: { eyebrow: string; title: ReactNode; sub?: string }) {
  return (
    <motion.div
      className="lx-section-header"
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6 }}
    >
      <div className="lx-eyebrow">
        <span className="lx-eyebrow-dot" />{eyebrow}
      </div>
      <h2 className="lx-section-title">{title}</h2>
      {sub && <p className="lx-section-sub">{sub}</p>}
    </motion.div>
  );
}

function CountUp({ display, className }: { display: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (inView && !shown) setShown(true);
  }, [inView]);
  return (
    <div ref={ref} className={className}>
      <AnimatePresence mode="wait">
        <motion.span
          key={shown ? 'final' : 'init'}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          {display}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

function CompareCell({ value, highlight }: { value: string | boolean; highlight?: boolean }) {
  if (value === true) return <div className={`lx-compare-cell ${highlight ? 'lx-compare-mine' : ''}`}><Check size={15} className="lx-compare-yes" /></div>;
  if (value === false) return <div className={`lx-compare-cell ${highlight ? 'lx-compare-mine' : ''}`}><X size={15} className="lx-compare-no" /></div>;
  return <div className={`lx-compare-cell ${highlight ? 'lx-compare-mine' : ''}`}><span className="lx-compare-text">{value}</span></div>;
}

function PriceCard({
  name, price, period, tag, features, cta, onCta, featured,
}: {
  name: string; price: string; period: string; tag: string;
  features: string[]; cta: string; onCta: () => void; featured?: boolean;
}) {
  return (
    <motion.div
      className={`lx-price-card ${featured ? 'lx-price-card-feature' : ''}`}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5 }}
    >
      {featured && <div className="lx-price-badge">Most popular</div>}
      <div className="lx-price-name">{name}</div>
      <div className="lx-price-amount"><span>{price}</span><em>{period}</em></div>
      <div className="lx-price-tag">{tag}</div>
      <ul className="lx-price-features">
        {features.map(f => <li key={f}><Check size={13} /> {f}</li>)}
      </ul>
      <button onClick={onCta} className={`${featured ? 'lx-pill-primary' : 'lx-pill-ghost'} lx-pill-block`}>{cta}</button>
    </motion.div>
  );
}

// ── NEURAL CANVAS ────────────────────────────────────────────────
function NeuralCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let animId: number;

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = canvas.offsetWidth * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      ctx.scale(ratio, ratio);
    };
    resize();
    window.addEventListener('resize', resize);

    const COLORS = ['#3b82f6', '#22d3ee', '#818cf8', '#818cf8', '#3b82f6', '#60a5fa'];
    const pts = Array.from({ length: 60 }, () => ({
      x: Math.random() * (canvas.offsetWidth || 900),
      y: Math.random() * (canvas.offsetHeight || 600),
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      r: Math.random() * 1.6 + 0.4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));

    const draw = () => {
      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x;
          const dy = pts[i].y - pts[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 120) {
            ctx.beginPath();
            ctx.moveTo(pts[i].x, pts[i].y);
            ctx.lineTo(pts[j].x, pts[j].y);
            ctx.strokeStyle = `rgba(167,139,250,${(1 - d / 120) * 0.13})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.color + '55';
        ctx.fill();
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > W) p.vx *= -1;
        if (p.y < 0 || p.y > H) p.vy *= -1;
      }
      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize); };
  }, [reduceMotion]);

  return <canvas ref={canvasRef} className="lx-neural-canvas" />;
}

// ── TERMINAL DEMO ─────────────────────────────────────────────────
function TerminalDemo() {
  const [visibleLines, setVisibleLines] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: false, margin: '-120px' });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCycle = () => {
    setVisibleLines(0);
    let i = 0;
    timerRef.current = setInterval(() => {
      i++;
      setVisibleLines(i);
      if (i >= TERMINAL_LOGS.length) {
        clearInterval(timerRef.current!);
        timerRef.current = setTimeout(() => startCycle(), 2800) as unknown as ReturnType<typeof setInterval>;
      }
    }, 620);
  };

  useEffect(() => {
    if (inView) startCycle();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [inView]);

  return (
    <div ref={ref} className="lx-terminal-box">
      <div className="lx-terminal-chrome">
        <div className="lx-terminal-dots">
          <span style={{ background: '#ff5f57' }} />
          <span style={{ background: '#febc2e' }} />
          <span style={{ background: '#28c840' }} />
        </div>
        <div className="lx-terminal-title">agent-orchestrator · live</div>
        <div className="lx-terminal-live">
          <span className="lx-terminal-live-dot" />
          active
        </div>
      </div>
      <div className="lx-terminal-body">
        {TERMINAL_LOGS.slice(0, visibleLines).map((log, i) => (
          <motion.div
            key={`${i}-${visibleLines}`}
            className="lx-terminal-line"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25 }}
          >
            <span className="lx-terminal-line-time">{log.time}</span>
            <span className="lx-terminal-line-agent" style={{ color: log.color, background: log.bg }}>
              {log.agent}
            </span>
            <span className="lx-terminal-line-text">
              {log.text}
              {i === visibleLines - 1 && <span className="lx-terminal-cursor" />}
            </span>
          </motion.div>
        ))}
        {visibleLines === 0 && (
          <div className="lx-terminal-line">
            <span className="lx-terminal-line-time">—</span>
            <span className="lx-terminal-line-text" style={{ color: 'var(--lx-text-3)' }}>
              Waiting for query<span className="lx-terminal-cursor" />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function MiniGraph() {
  return (
    <svg viewBox="0 0 140 80" className="lx-mock-mini-graph">
      <defs>
        <radialGradient id="mgnode">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
        </radialGradient>
      </defs>
      {[
        [20, 40, 70, 20], [70, 20, 110, 35], [70, 20, 90, 60], [20, 40, 50, 65], [50, 65, 90, 60], [110, 35, 130, 55],
      ].map((l, i) => (
        <line key={i} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} stroke="rgba(167,139,250,0.35)" strokeWidth="0.6" />
      ))}
      {[
        [20, 40, '#22d3ee'], [70, 20, '#3b82f6'], [110, 35, '#818cf8'],
        [50, 65, '#3b82f6'], [90, 60, '#818cf8'], [130, 55, '#60a5fa'],
      ].map((n, i) => (
        <g key={i}>
          <circle cx={n[0]} cy={n[1]} r="6" fill="url(#mgnode)" opacity="0.5" />
          <circle cx={n[0]} cy={n[1]} r="2.5" fill={n[2] as string} />
        </g>
      ))}
    </svg>
  );
}

function BigGraph() {
  const reduceMotion = useReducedMotion();
  const nodes = useMemo(() => ([
    { id: 0, x: 50, y: 50, r: 13, color: '#3b82f6', label: 'You' },
    { id: 1, x: 22, y: 26, r: 9, color: '#22d3ee', label: 'RAG' },
    { id: 2, x: 78, y: 22, r: 9, color: '#818cf8', label: 'Maya' },
    { id: 3, x: 84, y: 64, r: 8, color: '#818cf8', label: 'Q3' },
    { id: 4, x: 18, y: 74, r: 8, color: '#3b82f6', label: 'GTM' },
    { id: 5, x: 50, y: 13, r: 6, color: '#60a5fa' },
    { id: 6, x: 50, y: 87, r: 6, color: '#fb7185' },
    { id: 7, x: 32, y: 50, r: 5, color: '#22d3ee' },
    { id: 8, x: 68, y: 50, r: 5, color: '#818cf8' },
    { id: 9, x: 8, y: 50, r: 4, color: '#3b82f6' },
    { id: 10, x: 92, y: 40, r: 4, color: '#818cf8' },
    { id: 11, x: 38, y: 30, r: 4, color: '#60a5fa' },
    { id: 12, x: 62, y: 75, r: 4, color: '#fb7185' },
    { id: 13, x: 28, y: 90, r: 3, color: '#22d3ee' },
    { id: 14, x: 72, y: 90, r: 3, color: '#818cf8' },
    { id: 15, x: 90, y: 80, r: 3, color: '#3b82f6' },
    { id: 16, x: 10, y: 30, r: 3, color: '#fb7185' },
  ]), []);

  const edges = useMemo(() => ([
    [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8],
    [1, 5], [2, 5], [2, 8], [3, 8], [3, 6], [4, 7], [4, 6], [4, 9],
    [1, 9], [2, 10], [3, 10], [11, 1], [11, 5], [12, 6], [12, 8],
    [13, 4], [13, 6], [14, 6], [14, 3], [15, 3], [15, 10], [16, 1], [16, 9],
  ]), []);

  return (
    <div className="lx-graph-canvas">
      <div className="lx-graph-canvas-glow" />
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="lx-graph-svg">
        <defs>
          <radialGradient id="bgnode" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="white" stopOpacity="0.9" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="bg-center-pulse" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* Center pulse — disabled when user prefers reduced motion */}
        {reduceMotion ? (
          <circle cx={50} cy={50} r={32} fill="url(#bg-center-pulse)" opacity={0.25} />
        ) : (
          <motion.circle
            cx={50} cy={50} r={32}
            fill="url(#bg-center-pulse)"
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: [0.7, 1.05, 0.7], opacity: [0, 0.45, 0] }}
            transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
            style={{ transformOrigin: '50px 50px' }}
          />
        )}
        {edges.map(([a, b], i) => {
          const A = nodes[a], B = nodes[b];
          return (
            <motion.line
              key={i}
              x1={A.x} y1={A.y} x2={B.x} y2={B.y}
              stroke="rgba(129,140,248,0.32)"
              strokeWidth={0.2}
              initial={{ pathLength: 0, opacity: 0 }}
              whileInView={{ pathLength: 1, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 1.0, delay: 0.15 + i * 0.035 }}
            />
          );
        })}
        {nodes.map((n, i) => (
          <g key={n.id}>
            <motion.circle
              cx={n.x} cy={n.y} r={n.r * 1.7}
              fill={n.color}
              opacity={0.16}
              initial={{ scale: 0, opacity: 0 }}
              whileInView={{ scale: 1, opacity: 0.16 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.4 + i * 0.03 }}
              style={{ transformOrigin: `${n.x}px ${n.y}px` }}
            />
            <motion.circle
              cx={n.x} cy={n.y} r={n.r * 0.5}
              fill={n.color}
              initial={{ scale: 0, opacity: 0 }}
              whileInView={{ scale: 1, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.5 + i * 0.03 }}
              style={{ transformOrigin: `${n.x}px ${n.y}px`, filter: `drop-shadow(0 0 5px ${n.color})` }}
            />
            {n.label && (
              <motion.text
                x={n.x} y={n.y - n.r - 1.8}
                textAnchor="middle"
                fontSize="2.6"
                fill="white"
                fontWeight="600"
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 0.92 }}
                viewport={{ once: true }}
                transition={{ delay: 0.9 }}
              >{n.label}</motion.text>
            )}
          </g>
        ))}
      </svg>
      <div className="lx-graph-tag lx-graph-tag-1"><span className="lx-graph-tag-dot" />"RAG playbook" linked</div>
      <div className="lx-graph-tag lx-graph-tag-2"><span className="lx-graph-tag-dot" />3 new edges</div>
      <div className="lx-graph-tag lx-graph-tag-3"><span className="lx-graph-tag-dot" />cluster "GTM"</div>
    </div>
  );
}