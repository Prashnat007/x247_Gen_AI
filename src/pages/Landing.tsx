import { useEffect, useRef, useState, useMemo, type ReactNode, useCallback } from 'react';
import { motion, useScroll, useSpring, AnimatePresence, useReducedMotion, useInView, useTransform, useMotionValue, MotionValue } from 'framer-motion';
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
  { icon: Layers, name: 'Orchestrator', tagline: 'Routes intent', color: '#7c3aed', desc: 'Picks the right specialist for every query and streams the answer in real time via SSE.' },
  { icon: FileText, name: 'Capture', tagline: 'Universal ingest', color: '#00d9ff', desc: 'YouTube transcripts, web pages, PDFs, voice notes — all turned into clean tagged memory.' },
  { icon: Search, name: 'Recall', tagline: 'Semantic memory', color: '#a78bfa', desc: '3-tier search (tag + domain + full text) finds meaning, not just keywords.' },
  { icon: Network, name: 'Graph', tagline: 'Living knowledge', color: '#8b5cf6', desc: 'Auto-links ideas, people and projects into a 3D mind graph that grows with you.' },
  { icon: Calendar, name: 'Planner', tagline: 'Tasks + calendar', color: '#7c3aed', desc: 'Turns insights into prioritized tasks, study plans and deep-work blocks.' },
  { icon: BookOpen, name: 'Briefing', tagline: 'Daily digest', color: '#06b6d4', desc: 'AI brief every morning of yesterday + what to focus on today, cached for speed.' },
  { icon: BarChart3, name: 'Analytics', tagline: 'Insight engine', color: '#a78bfa', desc: 'Tracks learning velocity, domain expertise and streaks across every module.' },
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

// ── ADVANCED ANIMATION COMPONENTS ────────────────────────────────

// Magnetic Button — follows cursor with spring physics
function MagneticButton({ children, className, onClick, strength = 0.3 }: { 
  children: ReactNode; 
  className?: string; 
  onClick?: () => void;
  strength?: number;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const reduceMotion = useReducedMotion();

  const handleMouse = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (reduceMotion) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    x.set((e.clientX - centerX) * strength);
    y.set((e.clientY - centerY) * strength);
  }, [x, y, strength, reduceMotion]);

  const handleLeave = useCallback(() => {
    x.set(0);
    y.set(0);
  }, [x, y]);

  const springConfig = { stiffness: 150, damping: 15, mass: 0.1 };

  return (
    <motion.button
      ref={ref}
      className={className}
      onClick={onClick}
      onMouseMove={handleMouse}
      onMouseLeave={handleLeave}
      style={{ x: useSpring(x, springConfig), y: useSpring(y, springConfig) }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      {children}
    </motion.button>
  );
}

// Text Reveal Animation — staggered letter animation
function TextReveal({ children, className, delay = 0 }: { children: string; className?: string; delay?: number }) {
  const reduceMotion = useReducedMotion();
  const words = children.split(' ');

  if (reduceMotion) return <span className={className}>{children}</span>;

  return (
    <motion.span className={className}>
      {words.map((word, i) => (
        <span key={i} style={{ display: 'inline-block', overflow: 'hidden', marginRight: '0.25em' }}>
          <motion.span
            style={{ display: 'inline-block' }}
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{
              duration: 0.6,
              delay: delay + i * 0.08,
              ease: [0.25, 0.46, 0.45, 0.94],
            }}
          >
            {word}
          </motion.span>
        </span>
      ))}
    </motion.span>
  );
}

// Parallax wrapper — moves elements based on scroll
function ParallaxSection({ children, offset = 50 }: { children: ReactNode; offset?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [offset, -offset]);
  const reduceMotion = useReducedMotion();

  if (reduceMotion) return <div ref={ref}>{children}</div>;

  return (
    <div ref={ref}>
      <motion.div style={{ y }}>{children}</motion.div>
    </div>
  );
}

// Floating element with physics
function FloatingElement({ children, delay = 0, amplitude = 10 }: { children: ReactNode; delay?: number; amplitude?: number }) {
  const reduceMotion = useReducedMotion();
  
  if (reduceMotion) return <>{children}</>;

  return (
    <motion.div
      animate={{
        y: [0, -amplitude, 0, amplitude, 0],
        rotate: [0, 1, 0, -1, 0],
      }}
      transition={{
        duration: 6,
        delay,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
    >
      {children}
    </motion.div>
  );
}

// Glowing border card with 3D tilt
function GlowCard({ children, className, glowColor = '#7c3aed' }: { children: ReactNode; className?: string; glowColor?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const reduceMotion = useReducedMotion();

  const rotateX = useTransform(y, [-0.5, 0.5], [8, -8]);
  const rotateY = useTransform(x, [-0.5, 0.5], [-8, 8]);

  const handleMouse = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (reduceMotion) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    x.set((e.clientX - rect.left) / rect.width - 0.5);
    y.set((e.clientY - rect.top) / rect.height - 0.5);
  }, [x, y, reduceMotion]);

  const handleLeave = useCallback(() => {
    x.set(0);
    y.set(0);
  }, [x, y]);

  if (reduceMotion) return <div className={className}>{children}</div>;

  return (
    <motion.div
      ref={ref}
      className={className}
      onMouseMove={handleMouse}
      onMouseLeave={handleLeave}
      style={{
        rotateX: useSpring(rotateX, { stiffness: 300, damping: 30 }),
        rotateY: useSpring(rotateY, { stiffness: 300, damping: 30 }),
        transformStyle: 'preserve-3d',
        perspective: 1000,
      }}
      whileHover={{
        boxShadow: `0 0 40px ${glowColor}40, 0 0 80px ${glowColor}20`,
      }}
    >
      {children}
    </motion.div>
  );
}

// Counter animation for stats
function AnimatedCounter({ value, suffix = '', duration = 2 }: { value: number; suffix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-50px' });
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    if (!inView) return;
    let start = 0;
    const end = value;
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / (duration * 1000), 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const current = start + (end - start) * eased;
      setDisplayValue(Math.floor(current * 10) / 10);
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [inView, value, duration]);

  return <span ref={ref}>{displayValue}{suffix}</span>;
}

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
    color: '#7c3aed', tag: 'Graph Agent',
  },
  {
    icon: Mic, title: 'Voice-first capture', size: 'tall',
    desc: 'Record a thought, get a structured tagged memory. Powered by OpenAI Whisper. Works on phone, tablet, desktop.',
    color: '#00d9ff', tag: 'Capture Agent',
  },
  {
    icon: Compass, title: 'Live YouTube discovery', size: 'small',
    desc: 'Real Data API v3 — live view counts, channels, durations on every topic.',
    color: '#06b6d4', tag: 'Discover Agent',
  },
  {
    icon: Zap, title: 'Sub-400ms recall', size: 'small',
    desc: '3-tier semantic search across every memory you have ever captured.',
    color: '#a78bfa', tag: 'Recall Agent',
  },
  {
    icon: BarChart3, title: 'Daily AI briefings', size: 'tall',
    desc: 'Every morning: what happened yesterday, what matters today, what you are forgetting. Cached and ready before you wake up.',
    color: '#8b5cf6', tag: 'Briefing Agent',
  },
  {
    icon: Lock, title: 'Private by design', size: 'wide',
    desc: 'Your graph never trains a model. End-to-end encrypted in transit. Firebase Auth + Firestore. Shareable links use revocable one-way tokens.',
    color: '#a78bfa', tag: 'Guardian',
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

// ── COMPONENT ───��────────────────────────────────────────────────
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

      {/* ── HERO — Clean, Premium Design ─────────────────────────── */}
      <section className="lx-hero">
        <div className="lx-hero-inner">
          {/* Animated badge */}
          <motion.div
            className="lx-hero-badge"
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <motion.span 
              className="lx-hero-badge-dot"
              animate={{ scale: [1, 1.3, 1], opacity: [1, 0.7, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
            <span>7 AI Agents working together</span>
            <Sparkles size={12} />
          </motion.div>

          <motion.h1
            className="lx-hero-title"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <motion.span 
              className="lx-hero-line"
              initial={{ opacity: 0, y: 40, filter: 'blur(10px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
            >
              The second brain that
            </motion.span>
            <motion.span 
              className="lx-hero-line"
              initial={{ opacity: 0, y: 40, filter: 'blur(10px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.8, delay: 0.35, ease: [0.22, 0.61, 0.36, 1] }}
            >
              <span className="lx-hero-word lx-hero-grad">thinks with you.</span>
            </motion.span>
          </motion.h1>

          <motion.p
            className="lx-hero-sub"
            initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.7, delay: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
          >
            Seven specialist AI agents capture, link, recall and plan around you —
            so every idea, conversation and decision is one question away. Forever.
          </motion.p>

          <motion.div
            className="lx-hero-ctas"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.65 }}
          >
            <MagneticButton 
              onClick={() => navigate('/login?mode=signup')} 
              className="lx-pill-primary lx-pill-lg lx-pill-glow"
              strength={0.25}
            >
              <Sparkles size={14} /><span>Start free — no card</span>
            </MagneticButton>
            <MagneticButton 
              onClick={() => navigate('/login')} 
              className="lx-pill-ghost lx-pill-lg"
              strength={0.2}
            >
              <span>Sign in</span><ArrowRight size={14} />
            </MagneticButton>
          </motion.div>

          <motion.div
            className="lx-hero-trust"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.8 }}
          >
            <div className="lx-trust-avatars">
              {['M', 'D', 'A', 'S', 'P'].map((l, i) => (
                <motion.div 
                  key={l} 
                  className="lx-trust-avatar" 
                  style={{ ['--i' as string]: i }}
                  initial={{ opacity: 0, scale: 0, x: -10 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  transition={{ duration: 0.4, delay: 0.85 + i * 0.08 }}
                >
                  {l}
                </motion.div>
              ))}
            </div>
            <div className="lx-trust-meta">
              <div className="lx-trust-stars">
                {Array.from({ length: 5 }).map((_, i) => (
                  <motion.span
                    key={i}
                    initial={{ opacity: 0, scale: 0, rotate: -180 }}
                    animate={{ opacity: 1, scale: 1, rotate: 0 }}
                    transition={{ duration: 0.4, delay: 1.1 + i * 0.05 }}
                  >
                    <Star size={11} fill="#fbbf24" stroke="none" />
                  </motion.span>
                ))}
                <motion.span 
                  className="lx-trust-rating"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 1.4 }}
                >
                  4.9
                </motion.span>
              </div>
              <motion.div 
                className="lx-trust-text"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.5 }}
              >
                2,400+ thinkers · loved by founders, researchers & operators
              </motion.div>
            </div>
          </motion.div>

          {/* Trusted brands in hero */}
          <motion.div
            className="lx-hero-brands"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 1 }}
          >
            <span className="lx-hero-brands-label">Trusted by teams at</span>
            <div className="lx-hero-brands-row">
              {LOGOS.map((name, i) => (
                <motion.span 
                  key={name} 
                  className="lx-hero-brand"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 1.1 + i * 0.05 }}
                >
                  {name}
                </motion.span>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── PRODUCT MOCKUP — 3D perspective with parallax ───────────────────────────────────────── */}
      <section className="lx-mockup-section">
        <ParallaxSection offset={30}>
          <motion.div
            className="lx-mockup-wrap"
            initial={{ opacity: 0, y: 80, rotateX: 15 }}
            whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 1.1, ease: [0.22, 0.61, 0.36, 1] }}
            style={{ perspective: 1200, transformStyle: 'preserve-3d' }}
          >
            <motion.div 
              className="lx-mockup-glow"
              animate={{ 
                opacity: [0.4, 0.7, 0.4],
                scale: [1, 1.05, 1],
              }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            />
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
        </ParallaxSection>
      </section>

      {/* ── HOW IT WORKS — Glass Box ─────────────────────────────────────────── */}
      <section id="how" className="lx-section">
        <motion.div 
          className="lx-section-box"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.7 }}
        >
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
                  style={{ ['--accent' as string]: step.accent }}
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
        </motion.div>
      </section>

      {/* ── 7 AGENTS BENTO — Glass Box ───────────────────────────────────────── */}
      <section id="agents" className="lx-section">
        <motion.div 
          className="lx-section-box"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.7 }}
        >
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
                initial={{ opacity: 0, y: 30, rotateX: 10 }}
                whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.6, delay: i * 0.08, ease: [0.22, 0.61, 0.36, 1] }}
                style={{ perspective: 800 }}
              >
                <GlowCard 
                  className="lx-agent-card"
                  glowColor={a.color}
                >
                  <div className="lx-agent-card-inner" style={{ ['--accent' as string]: a.color }}>
                    <motion.div 
                      className="lx-agent-glow"
                      animate={{ opacity: [0.3, 0.6, 0.3] }}
                      transition={{ duration: 3, repeat: Infinity, delay: i * 0.3 }}
                    />
                    <motion.div 
                      className="lx-agent-icon"
                      whileHover={{ scale: 1.1, rotate: 5 }}
                      transition={{ type: 'spring', stiffness: 300 }}
                    >
                      <Icon size={18} />
                    </motion.div>
                    <div className="lx-agent-name">{a.name}</div>
                    <div className="lx-agent-tag">{a.tagline}</div>
                    <p className="lx-agent-desc">{a.desc}</p>
                    <div className="lx-agent-pulse">
                      <motion.span 
                        className="lx-agent-pulse-dot"
                        animate={{ scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      />
                      <span>online</span>
                    </div>
                  </div>
                </GlowCard>
              </motion.div>
            );
          })}
          </div>
        </motion.div>
      </section>

      {/* ── FEATURE BENTO GRID — Glass Box ───────────────────────────────────── */}
      <section className="lx-section">
        <motion.div 
          className="lx-section-box"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.7 }}
        >
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
                style={{ ['--accent' as string]: f.color }}
                initial={{ opacity: 0, y: 40, scale: 0.95, rotateY: -5 }}
                whileInView={{ opacity: 1, y: 0, scale: 1, rotateY: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ 
                  duration: 0.7, 
                  delay: i * 0.1,
                  ease: [0.22, 0.61, 0.36, 1]
                }}
                whileHover={{ 
                  y: -8, 
                  scale: 1.02,
                  boxShadow: `0 20px 40px -15px ${f.color}40`,
                  transition: { duration: 0.3 }
                }}
              >
                <motion.div 
                  className="lx-bento-glow"
                  animate={{ opacity: [0.2, 0.5, 0.2] }}
                  transition={{ duration: 4, repeat: Infinity, delay: i * 0.5 }}
                />
                <motion.div 
                  className="lx-bento-tag"
                  initial={{ opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 + 0.3 }}
                >
                  {f.tag}
                </motion.div>
                <motion.div 
                  className="lx-bento-icon"
                  whileHover={{ scale: 1.15, rotate: 10 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                >
                  <Icon size={22} />
                </motion.div>
                <h3 className="lx-bento-title">{f.title}</h3>
                <p className="lx-bento-desc">{f.desc}</p>
                <motion.div 
                  className="lx-bento-accent-line"
                  initial={{ scaleX: 0 }}
                  whileInView={{ scaleX: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.8, delay: i * 0.1 + 0.4, ease: [0.22, 0.61, 0.36, 1] }}
                  style={{ transformOrigin: 'left' }}
                />
              </motion.div>
            );
          })}
          </div>
        </motion.div>
      </section>

      {/* ── MODULE MAP — Glass Box ──────────── */}
      <section id="modules" className="lx-section">
        <motion.div 
          className="lx-section-box"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.7 }}
        >
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
                  style={{ ['--accent' as string]: g.color }}
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
        </motion.div>
      </section>

      {/* ── KNOWLEDGE GRAPH SHOWCASE — Glass Box ─────────────────────────────── */}
      <section id="graph" className="lx-section">
        <motion.div 
          className="lx-section-box"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.7 }}
        >
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
        </motion.div>
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

      {/* ── LIVE DISCOVER — Glass Box ────────────── */}
      <section id="discover-preview" className="lx-section">
        <motion.div 
          className="lx-section-box"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.7 }}
        >
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
        </motion.div>
      </section>

      {/* ── INTELLIGENCE TERMINAL — Glass Box ────────────────────────────────── */}
      <section className="lx-section">
        <motion.div 
          className="lx-section-box"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.7 }}
        >
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
        </motion.div>
      </section>

      {/* ── USE CASES / PERSONAS — Glass Box ─────────────────────────────────── */}
      <section id="use" className="lx-section">
        <motion.div 
          className="lx-section-box"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.7 }}
        >
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
        </motion.div>
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

      {/* ── PRICING — Glass Box ──────────────────────────────────────────────── */}
      <section id="pricing" className="lx-section">
        <motion.div 
          className="lx-section-box"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.7 }}
        >
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
        </motion.div>
      </section>

      {/* ── FAQ — Glass Box ──────────────────────────────────────────────────── */}
      <section id="faq" className="lx-section">
        <motion.div 
          className="lx-section-box"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.7 }}
        >
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
        </motion.div>
      </section>

      {/* ── FINAL CTA — Glass Box ────────────────────────────────────────────── */}
      <section className="lx-section">
        <ParallaxSection offset={40}>
          <motion.div 
            className="lx-final-cta"
            initial={{ opacity: 0, y: 40, scale: 0.98 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.8, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <motion.div 
              className="lx-final-glow"
              animate={{ 
                opacity: [0.5, 0.8, 0.5],
                scale: [1, 1.1, 1],
              }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            />
            <FloatingElement delay={0} amplitude={20}>
              <div className="lx-final-orb lx-final-orb-1" />
            </FloatingElement>
            <FloatingElement delay={2} amplitude={15}>
              <div className="lx-final-orb lx-final-orb-2" />
            </FloatingElement>
            <div className="lx-final-content">
              <motion.div 
                className="lx-eyebrow"
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.2 }}
              >
                <motion.span 
                  className="lx-eyebrow-dot"
                  animate={{ scale: [1, 1.3, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                Your second brain is one click away
              </motion.div>
              <motion.h2 
                className="lx-final-title"
                initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
                whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                viewport={{ once: true }}
                transition={{ delay: 0.3, duration: 0.7 }}
              >
                Stop forgetting.<br /><span className="lx-final-grad">Start thinking with it.</span>
              </motion.h2>
              <motion.p 
                className="lx-final-sub"
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.4 }}
              >
                Free forever. Set up in 90 seconds. Scales to your whole team when you&apos;re ready.
              </motion.p>
              <motion.div 
                className="lx-hero-ctas"
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.5 }}
              >
                <MagneticButton 
                  onClick={() => navigate('/login?mode=signup')} 
                  className="lx-pill-primary lx-pill-lg lx-pill-glow"
                  strength={0.3}
                >
                  <Sparkles size={14} /><span>Start free — no card</span>
                </MagneticButton>
                <MagneticButton 
                  onClick={() => navigate('/login')} 
                  className="lx-pill-ghost lx-pill-lg"
                  strength={0.2}
                >
                  <span>Sign in</span><ArrowRight size={14} />
                </MagneticButton>
              </motion.div>
              <motion.div 
                className="lx-final-badges"
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.6 }}
              >
                {[
                  { icon: Check, text: 'No credit card' },
                  { icon: Check, text: '90-second setup' },
                  { icon: Check, text: 'Cancel anytime' },
                ].map((badge, i) => (
                  <motion.span 
                    key={badge.text}
                    className="lx-final-badge"
                    initial={{ opacity: 0, x: -10 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.7 + i * 0.1 }}
                  >
                    <badge.icon size={11} /> {badge.text}
                  </motion.span>
                ))}
              </motion.div>
            </div>
          </motion.div>
        </ParallaxSection>
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

// ── NEURAL CANVAS — Advanced particle system with glow effects ────────────────────────────
function NeuralCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let animId: number;
    let time = 0;

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = canvas.offsetWidth * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      ctx.scale(ratio, ratio);
    };
    resize();
    window.addEventListener('resize', resize);

    // Track mouse for interactive particles
    const onMouse = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    canvas.addEventListener('mousemove', onMouse);

    const COLORS = ['#7c3aed', '#00d9ff', '#a78bfa', '#8b5cf6', '#06b6d4', '#c084fc'];
    const pts = Array.from({ length: 80 }, () => ({
      x: Math.random() * (canvas.offsetWidth || 900),
      y: Math.random() * (canvas.offsetHeight || 600),
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: Math.random() * 2.2 + 0.6,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      pulse: Math.random() * Math.PI * 2,
      pulseSpeed: 0.02 + Math.random() * 0.03,
    }));

    const draw = () => {
      time += 0.016;
      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;
      
      // Fade trail effect
      ctx.fillStyle = 'rgba(10, 14, 39, 0.15)';
      ctx.fillRect(0, 0, W, H);

      // Draw connections with gradient
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x;
          const dy = pts[i].y - pts[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 150) {
            const alpha = (1 - d / 150) * 0.25;
            const gradient = ctx.createLinearGradient(pts[i].x, pts[i].y, pts[j].x, pts[j].y);
            gradient.addColorStop(0, pts[i].color + Math.floor(alpha * 255).toString(16).padStart(2, '0'));
            gradient.addColorStop(1, pts[j].color + Math.floor(alpha * 255).toString(16).padStart(2, '0'));
            ctx.beginPath();
            ctx.moveTo(pts[i].x, pts[i].y);
            ctx.lineTo(pts[j].x, pts[j].y);
            ctx.strokeStyle = gradient;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }

      // Draw particles with glow and pulse
      for (const p of pts) {
        p.pulse += p.pulseSpeed;
        const pulseScale = 1 + Math.sin(p.pulse) * 0.3;
        const currentR = p.r * pulseScale;

        // Outer glow
        const glowGradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, currentR * 4);
        glowGradient.addColorStop(0, p.color + '40');
        glowGradient.addColorStop(0.5, p.color + '15');
        glowGradient.addColorStop(1, p.color + '00');
        ctx.beginPath();
        ctx.arc(p.x, p.y, currentR * 4, 0, Math.PI * 2);
        ctx.fillStyle = glowGradient;
        ctx.fill();

        // Core particle
        ctx.beginPath();
        ctx.arc(p.x, p.y, currentR, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();

        // Mouse interaction — particles gently avoid cursor
        const mdx = p.x - mouseRef.current.x;
        const mdy = p.y - mouseRef.current.y;
        const mdist = Math.sqrt(mdx * mdx + mdy * mdy);
        if (mdist < 100 && mdist > 0) {
          const force = (100 - mdist) / 100 * 0.5;
          p.vx += (mdx / mdist) * force;
          p.vy += (mdy / mdist) * force;
        }

        // Apply velocity with damping
        p.vx *= 0.99;
        p.vy *= 0.99;
        p.x += p.vx;
        p.y += p.vy;

        // Wrap around edges
        if (p.x < -10) p.x = W + 10;
        if (p.x > W + 10) p.x = -10;
        if (p.y < -10) p.y = H + 10;
        if (p.y > H + 10) p.y = -10;
      }
      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => { 
      cancelAnimationFrame(animId); 
      window.removeEventListener('resize', resize); 
      canvas.removeEventListener('mousemove', onMouse);
    };
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
        [20, 40, '#00d9ff'], [70, 20, '#7c3aed'], [110, 35, '#a78bfa'],
        [50, 65, '#7c3aed'], [90, 60, '#a78bfa'], [130, 55, '#8b5cf6'],
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
    { id: 0, x: 50, y: 50, r: 13, color: '#7c3aed', label: 'You' },
    { id: 1, x: 22, y: 26, r: 9, color: '#00d9ff', label: 'RAG' },
    { id: 2, x: 78, y: 22, r: 9, color: '#a78bfa', label: 'Maya' },
    { id: 3, x: 84, y: 64, r: 8, color: '#a78bfa', label: 'Q3' },
    { id: 4, x: 18, y: 74, r: 8, color: '#7c3aed', label: 'GTM' },
    { id: 5, x: 50, y: 13, r: 6, color: '#8b5cf6' },
    { id: 6, x: 50, y: 87, r: 6, color: '#06b6d4' },
    { id: 7, x: 32, y: 50, r: 5, color: '#00d9ff' },
    { id: 8, x: 68, y: 50, r: 5, color: '#a78bfa' },
    { id: 9, x: 8, y: 50, r: 4, color: '#7c3aed' },
    { id: 10, x: 92, y: 40, r: 4, color: '#a78bfa' },
    { id: 11, x: 38, y: 30, r: 4, color: '#8b5cf6' },
    { id: 12, x: 62, y: 75, r: 4, color: '#06b6d4' },
    { id: 13, x: 28, y: 90, r: 3, color: '#00d9ff' },
    { id: 14, x: 72, y: 90, r: 3, color: '#a78bfa' },
    { id: 15, x: 90, y: 80, r: 3, color: '#7c3aed' },
    { id: 16, x: 10, y: 30, r: 3, color: '#06b6d4' },
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
            <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
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
              stroke="rgba(167,139,250,0.4)"
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
