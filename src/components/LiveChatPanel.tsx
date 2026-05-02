/**
 * LiveChatPanel — embeddable voice/video conversation surface.
 *
 * Exports:
 *   - <LiveInline/>     — the in-layout card that hosts the connect/disconnect,
 *                         mic, camera, screen share, transcript, and tool-call feed.
 *   - <LiveInlineGate/> — checks /api/live/status and only mounts LiveInline
 *                         when the backend has an API key configured.
 *
 * The previous floating "Live" button (LiveButton/LiveGate/LivePanel) was
 * removed: it was never mounted anywhere in the app, so the inline surface
 * inside Agent Hub and Recall is the single supported entry point for voice.
 *
 * Relies on the shared `getLiveClient()` singleton in `lib/liveClient.ts`.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Mic, MicOff, Video, VideoOff, MonitorUp, Phone, PhoneOff,
  Wand2, Loader2, Camera, Check, X as XIcon,
} from "lucide-react";
import { getLiveClient, type LiveEvent } from "../lib/liveClient";

type TranscriptEntry =
  | { id: string; role: "user" | "model"; text: string; interrupted?: boolean }
  | { id: string; role: "tool"; name: string; args: Record<string, unknown>; result?: Record<string, unknown> };

/**
 * Strip "scratchpad" / chain-of-thought preamble that some Live model
 * snapshots leak into the transcript stream — e.g. "**Crafting Initial
 * Response** I've registered the greeting and am formulating…" before
 * the actual reply. The system prompt forbids it but a belt-and-braces
 * client filter keeps the UI clean if the model slips. We strip:
 *   - leading bold-wrapped meta lines like **Crafting...**, **Drafting...**,
 *     **Thinking...**, **Considering...**, **Planning...**, **Analysing...**,
 *     **Initial Response**, **Refining...**, etc.
 *   - leading "I've registered/I am formulating/Let me think/I will now…"
 *     style narration up to the first sentence break.
 * Anything inside the preamble is dropped; the rest of the text is kept.
 */
function stripScratchpad(raw: string): string {
  if (!raw) return raw;
  let t = raw;

  // ── Stage 1: hold back partial preambles while streaming ────────────
  // If the buffer LOOKS like an in-progress preamble that isn't yet
  // long enough to terminate, return '' so nothing renders for now.
  // The caller never mutates the raw buffer based on our return value,
  // so the next chunk continues to accumulate and we re-evaluate.
  const UNFINISHED_BOLD = /^\s*\*\*\s*(?:crafting|drafting|thinking|considering|planning|analy[sz]ing|reasoning|formulating|preparing|composing|building|generating|initial|refining|reviewing|reflecting)[^*]{0,200}$/i;
  if (UNFINISHED_BOLD.test(t)) return '';
  // Holdback for the narrated-preamble pattern: opener + meta verb,
  // not yet ended with a sentence break. Generous 320-char window
  // before we give up and let the text show.
  const UNFINISHED_NARR = /^\s*(?:I(?:'ve|'m| have| am| will| shall)|Let me|Allow me|Okay,|Alright,)\s+(?:registered|noted|formulat|draft|consider|process|think|prepar|compos|generat|analy[sz])[^.!?]{0,400}$/i;
  if (UNFINISHED_NARR.test(t) && t.length < 320) return '';

  // ── Stage 2: strip completed preambles ──────────────────────────────
  // a) Bold-wrapped meta headers (possibly repeated).
  const META_HEADER_RE = /^\s*\*\*\s*(?:crafting|drafting|thinking|considering|planning|analy[sz]ing|reasoning|formulating|preparing|composing|building|generating|initial|refining|reviewing|reflecting)[^*]{0,80}\*\*\s*/i;
  while (META_HEADER_RE.test(t)) t = t.replace(META_HEADER_RE, '');

  // b) Narrated meta-preamble: opener + meta verb, then EVERYTHING
  // up to a sentence boundary that's followed by a known reply-start
  // word. Anchoring to the reply-start words ("Hello", "Sure", "Yes",
  // "Here", etc.) keeps this safe — a legit reply like
  // "I have reviewed your file." won't strip because nothing matches
  // after the period, and "I've added it to your inbox." doesn't even
  // hit the verb list.
  const REPLY_START =
    "Hello|Hi|Hey|Sure|Yes|No,|Okay|Alright|Here|There|That|This|It|You|We|" +
    "Let me|I'll|I will|To answer|For (?:your|the)|Of course|Absolutely|" +
    "Based on|According|Looking|From";
  const NARRATED_PREAMBLE = new RegExp(
    "^\\s*(?:I(?:'ve|'m| have| am| will| shall)|Let me|Allow me|Okay,|Alright,)\\s+" +
    "(?:registered|noted|formulat|draft|consider|process|think|prepar|compos|generat|analy[sz])" +
    "[\\s\\S]{0,320}?[.!?]\\s+(?=(?:" + REPLY_START + ")\\b)",
    "i"
  );
  t = t.replace(NARRATED_PREAMBLE, '');

  return t.trimStart();
}

function summariseToolResult(name: string, result: Record<string, unknown>, args: Record<string, unknown>): string {
  if (result?.error) return `Error: ${String(result.error)}`;
  switch (name) {
    case "save_memory":
      return `Saved memory${result?.title ? ` — "${result.title}"` : ""}.`;
    case "capture_frame":
      if (result?.pending) return "Capturing frame…";
      return `Saved frame to vault${result?.title ? ` — "${result.title}"` : ""}.`;
    case "capture_url":
      return `Captured ${String(args?.url || "URL")}.`;
    case "create_task":
      return `Task created${result?.title ? `: "${result.title}"` : ""}.`;
    case "list_tasks": {
      const tasks = (result?.tasks as any[]) || [];
      if (!tasks.length) return "No pending tasks.";
      return tasks.map((t) => `• ${t.title}`).slice(0, 5).join("  ");
    }
    case "complete_task":
      return "Marked task complete.";
    case "create_calendar_event":
      return `Event scheduled${args?.title ? ` — "${args.title}"` : ""}.`;
    case "create_revisit":
      return `Revisit set for "${args?.topic}" (${args?.frequency || "weekly"}).`;
    case "recall_memories": {
      const r = (result?.results as any[]) || [];
      if (!r.length) return `No memories matched "${args?.query}".`;
      return `Found ${r.length}: ${r.map((m) => m.title || m.snippet).slice(0, 3).join("; ")}`;
    }
    case "create_note":
      return "Note saved.";
    case "create_bookmark":
      return `Bookmark saved: ${String(args?.url || "")}`;
    case "daily_briefing":
      return "Briefing ready.";
    default:
      return JSON.stringify(result).slice(0, 160);
  }
}

// Quiet, neutral mic / camera / screen control used by LiveInline.
// `enabled` reflects whether the live session is currently active.
const quietCtrlBtn = (on: boolean, enabled: boolean): React.CSSProperties => ({
  width: 30, height: 30, borderRadius: 8,
  border: "1px solid var(--border, rgba(255,255,255,0.08))",
  background: on
    ? "var(--surface-3, rgba(255,255,255,0.08))"
    : "var(--surface, rgba(255,255,255,0.02))",
  color: on ? "var(--text-1, inherit)" : "var(--text-3, rgba(148,163,184,0.7))",
  cursor: enabled ? "pointer" : "default",
  opacity: enabled ? 1 : 0.55,
  display: "grid", placeItems: "center",
  transition: "all 0.15s",
  fontFamily: "inherit",
});

// Compact pill action button used in the slim header — variant "start" uses
// the indigo accent, "end" uses red. Both stay calm next to the small dot.
const slimActionBtn = (variant: "start" | "end"): React.CSSProperties => ({
  display: "flex", alignItems: "center", gap: 5,
  padding: "5px 11px", borderRadius: 8,
  background: variant === "end" ? "rgba(239,68,68,0.12)" : "rgba(99,102,241,0.14)",
  border: variant === "end"
    ? "1px solid rgba(239,68,68,0.32)"
    : "1px solid rgba(99,102,241,0.32)",
  color: variant === "end" ? "#ef4444" : "#a78bfa",
  fontSize: 11.5, fontWeight: 700, cursor: "pointer",
  fontFamily: "inherit",
});

/* ================================================================== */
/*  LiveInline — embeddable voice/video chat card                      */
/* ================================================================== */

/**
 * LiveInline renders the Live voice/video chat surface as a plain block
 * element that fits inside any parent card. It is the single supported
 * voice surface in the app (mounted via LiveInlineGate inside Agent Hub
 * and Recall) — there is no floating button equivalent.
 *
 * Props:
 *   active   — when false the upstream live session is torn down and
 *              mic/camera are released (privacy + cost). Pass `true`
 *              while the section is visible to the user.
 *   compact  — slightly tighter padding for sidebars / narrow widths.
 */
interface LiveInlineProps {
  active: boolean;
  compact?: boolean;
}

// Phrases that should trigger a "visually capture this" save when the
// user says them mid-conversation. Match is case-insensitive and uses
// loose word boundaries so "capture karo na bhai" still hits. Hindi/
// English mixed because users in Hinglish flip mid-sentence.
const CAPTURE_PHRASES: readonly RegExp[] = [
  /\bvisually\s+capture\b/i,
  /\bcapture\s+(?:this|that|it|karo|kar\s+do|kar\s+lo|kar\s+le)\b/i,
  /\bsave\s+(?:this|that|it)\s+(?:frame|image|picture|shot|photo)\b/i,
  /\bsave\s+this\s+frame\b/i,
  /\bsave\s+this\s+(?:to\s+)?vault\b/i,
  /\b(?:le|lo)\s+(?:screenshot|snapshot)\b/i,
  /\bscreenshot\s+(?:le|lo|kar(?:o|\s+do|\s+lo)?)\b/i,
  /\b(?:isko|ise|yeh|ye)\s+(?:save|capture)\s+kar\b/i,
  /\bsnap\s+(?:this|that|it)\b/i,
];

function looksLikeCaptureCommand(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < 4 || trimmed.length > 240) return false;
  return CAPTURE_PHRASES.some((re) => re.test(trimmed));
}

export const LiveInline: React.FC<LiveInlineProps> = ({ active, compact = false }) => {
  const client = useMemo(() => getLiveClient(), []);
  const [state, setState] = useState<string>(client.getState());
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const userBufRef = useRef<string>("");
  const modelBufRef = useRef<string>("");
  const userIdRef = useRef<string>("");
  const modelIdRef = useRef<string>("");

  // Live preview tile + visual capture state. The <video> element is a
  // visible, muted, autoplaying preview that shares the SAME MediaStream
  // the LiveClient is already pushing to the model — no extra getUserMedia
  // call, no extra permission prompt.
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const [capturing, setCapturing] = useState(false);
  // Synchronous lock so two trigger calls in the same event tick (e.g.
  // user clicks Capture and Shift+C lands in the same micro-batch)
  // can't both slip past the React-state guard before it commits.
  const capturingRef = useRef(false);
  // Brief "flash" when a capture lands so the user gets instant feedback.
  const [flash, setFlash] = useState<null | "ok" | "err">(null);
  // Debounce a voice-triggered capture so a single utterance can't fire
  // twice (transcripts arrive in chunks; the same phrase often appears
  // in two consecutive flushes as the user keeps talking).
  const lastVoiceCaptureAtRef = useRef<number>(0);
  // Track the LAST utterance we already fired against so the same
  // committed sentence can't re-trigger even when the user keeps
  // talking and the rolling tail still contains the command phrase.
  const lastVoiceCaptureUtteranceRef = useRef<string>("");
  const VOICE_CAPTURE_DEBOUNCE_MS = 4500;

  // Live voice-activity bookkeeping. We surface two things in the slim
  // header: (1) a status word that names the active speaker, and (2) a
  // tiny 2-bar VU meter whose height tracks the current audio level.
  // Levels are kept smoothed so the bars don't jitter on every frame.
  const [activeSpeaker, setActiveSpeaker] = useState<"user" | "model" | null>(null);
  const [userLevel, setUserLevel] = useState(0);
  const [modelLevel, setModelLevel] = useState(0);
  const userSpeakingRef = useRef(false);
  const modelSpeakingRef = useRef(false);

  const flushUser = useCallback(() => {
    const t = userBufRef.current.trim();
    if (!t) return;
    setTranscript((cur) => {
      const next = [...cur];
      const id = userIdRef.current || `u-${Date.now()}`;
      const last = next[next.length - 1];
      if (last && last.role === "user" && last.id === id) {
        (last as any).text = t;
      } else {
        next.push({ id, role: "user", text: t });
        userIdRef.current = id;
      }
      return next;
    });
  }, []);

  /**
   * Grab the current frame from the live camera/screen and POST it to
   * the backend for vision analysis + vault save. Pushes a synthetic
   * "tool" entry into the transcript so the user sees inline feedback
   * regardless of trigger (button / voice / shortcut).
   *
   * `spokenHint` carries whatever the user said when they triggered the
   * capture (e.g. "save this slide about RAG") — the backend uses it as
   * context for the AI title/summary so the memory's title can echo
   * what the user actually wanted.
   */
  const triggerVisualCapture = useCallback(async (spokenHint: string = "") => {
    // Synchronous lock — fires before React state can commit, so two
    // triggers in the same tick (button + keyboard, etc.) can't both
    // proceed past this guard.
    if (capturingRef.current) return;
    if (!client.isVideoOn()) {
      setError("Turn on camera or screen first to capture a frame.");
      setFlash("err");
      window.setTimeout(() => setFlash(null), 600);
      return;
    }
    const frame = client.captureFrame();
    if (!frame) {
      setError("Frame not ready yet — give the camera a moment, then try again.");
      setFlash("err");
      window.setTimeout(() => setFlash(null), 600);
      return;
    }

    capturingRef.current = true;
    setCapturing(true);
    setError("");
    setFlash("ok");
    window.setTimeout(() => setFlash(null), 450);

    // Show a "capturing…" tool entry instantly so the UI doesn't feel
    // dead while the vision call runs (1.5–4 s typically). UUIDs avoid
    // any chance of collision when two captures land in the same ms.
    const placeholderId = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? `t-cap-${crypto.randomUUID()}`
      : `t-cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setTranscript((cur) => [
      ...cur,
      {
        id: placeholderId,
        role: "tool",
        name: "capture_frame",
        args: { source: frame.source, hint: spokenHint || "" },
        result: { pending: true },
      },
    ]);

    try {
      const res = await fetch("/capture/visual-frame", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_data: frame.dataUrl,
          // Smaller pre-downscaled thumbnail used by Vault list/grid
          // cards — keeps the /memories list response tiny.
          thumbnail_data: frame.thumbnailDataUrl,
          caption: spokenHint || "",
          source: frame.source === "screen" ? "live_screen" : "live_camera",
          captured_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `Capture failed (${res.status})`);
      }
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      const memory = (data?.memory as Record<string, unknown>) || {};
      const savedTitle = (data?.title as string) || (memory?.title as string) || "Captured frame";
      const savedId = (data?.id as string) || (memory?.id as string) || "";

      // Replace the placeholder in-place with the real result so we
      // don't end up with two cards for the same capture. We show the
      // small thumbnail (not the full data URL) inline.
      setTranscript((cur) => cur.map((e) => (
        e.id === placeholderId && e.role === "tool"
          ? {
              ...e,
              result: { ok: true, title: savedTitle, id: savedId, image: frame.thumbnailDataUrl },
            }
          : e
      )));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Capture failed.";
      setError(msg);
      setFlash("err");
      window.setTimeout(() => setFlash(null), 600);
      setTranscript((cur) => cur.map((entry) => (
        entry.id === placeholderId && entry.role === "tool"
          ? { ...entry, result: { error: msg } }
          : entry
      )));
    } finally {
      capturingRef.current = false;
      setCapturing(false);
    }
  }, [client]);

  // Voice-trigger: scan committed user transcripts for a capture phrase
  // and fire a capture with the surrounding sentence as the spoken hint.
  // Debounced so the same utterance can't fire twice as transcripts
  // re-flush. Only listens while video is actually on.
  const maybeVoiceCapture = useCallback((utterance: string) => {
    if (!utterance || !looksLikeCaptureCommand(utterance)) return;
    if (!client.isVideoOn()) return;
    // Once we've fired a capture in this turn, suppress all further
    // voice triggers until turn_complete clears the ref. This prevents
    // re-firing as the user keeps talking and the rolling tail keeps
    // shifting (suffix-only dedupe wasn't enough since suffix changes
    // on every chunk).
    if (lastVoiceCaptureUtteranceRef.current === "__fired_this_turn__") return;
    const now = Date.now();
    if (now - lastVoiceCaptureAtRef.current < VOICE_CAPTURE_DEBOUNCE_MS) return;
    lastVoiceCaptureAtRef.current = now;
    lastVoiceCaptureUtteranceRef.current = "__fired_this_turn__";
    // Pass the whole utterance as the hint — backend trims it.
    void triggerVisualCapture(utterance);
  }, [client, triggerVisualCapture]);

  const flushModel = useCallback(() => {
    // Always strip scratchpad at flush time. The RAW buffer in
    // modelBufRef keeps growing across chunks — we never mutate it
    // here, we just compute a display value. This way a partial
    // preamble that's currently being held back will eventually be
    // recognised + stripped once the closing marker arrives, and
    // the real reply that follows will start showing as a natural
    // continuation.
    const t = stripScratchpad(modelBufRef.current).trim();
    if (!t) return;
    setTranscript((cur) => {
      const next = [...cur];
      const id = modelIdRef.current || `m-${Date.now()}`;
      const last = next[next.length - 1];
      if (last && last.role === "model" && last.id === id) {
        (last as any).text = t;
      } else {
        next.push({ id, role: "model", text: t });
        modelIdRef.current = id;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const off = client.on((e: LiveEvent) => {
      if (e.type === "state") setState(e.state || "");
      if (e.type === "error") setError(e.error || "Unknown error");
      if (e.type === "user_transcript") {
        const chunk = e.text || "";
        userBufRef.current += chunk;
        flushUser();
        // Listen for "capture this" / "capture karo" / etc. on each
        // committed user transcript so the user can save a frame
        // without lifting a finger. We scan the rolling buffer (last
        // 240 chars) so a phrase split across two ws chunks still hits.
        const tail = userBufRef.current.slice(-240);
        if (tail) maybeVoiceCapture(tail);
      }
      if (e.type === "model_transcript") { modelBufRef.current += (e.text || ""); flushModel(); }
      if (e.type === "text") { modelBufRef.current += (e.text || ""); flushModel(); }
      if (e.type === "turn_complete" || e.type === "interrupted") {
        if (e.type === "interrupted") {
          // Mark the in-progress model bubble so the user sees their
          // barge-in landed. Idempotent — safe if both the local
          // `interrupt()` call and the server echo arrive.
          const id = modelIdRef.current;
          if (id) {
            setTranscript((cur) => cur.map((entry) =>
              entry.role === "model" && entry.id === id && !entry.interrupted
                ? { ...entry, interrupted: true }
                : entry
            ));
          }
        }
        userBufRef.current = ""; modelBufRef.current = "";
        userIdRef.current = ""; modelIdRef.current = `m-${Date.now()}`;
        // Reset voice-capture dedupe at every turn boundary. Within a
        // single turn we hold a debounce + content-suffix lock so the
        // same utterance can't fire twice; once the user finishes
        // speaking, the next turn is free to capture again.
        lastVoiceCaptureUtteranceRef.current = "";
      }
      if (e.type === "tool_call_done") {
        setTranscript((cur) => [
          ...cur,
          {
            id: `t-${Date.now()}-${Math.random()}`,
            role: "tool",
            name: e.name || "",
            args: (e.args as Record<string, unknown>) || {},
            result: (e.result as Record<string, unknown>) || {},
          },
        ]);
      }
      if (e.type === "vad") {
        // Smooth incoming RMS levels with a small first-order filter so
        // the meter feels alive without flickering. When the source's
        // speaking flag flips false we hard-snap the level to 0 — the
        // events stop arriving immediately after, so a smoothing-only
        // approach would leave a stale glow on the bars indefinitely.
        // The model side is prioritized as the active speaker so mic
        // echo (if any leaks past AGC) doesn't override it.
        const lvl = typeof e.level === "number" ? e.level : 0;
        const speak = !!e.speaking;
        if (e.source === "user") {
          userSpeakingRef.current = speak;
          if (!speak) setUserLevel(0);
          else setUserLevel((prev) => prev * 0.55 + lvl * 0.45);
        } else if (e.source === "model") {
          modelSpeakingRef.current = speak;
          if (!speak) setModelLevel(0);
          else setModelLevel((prev) => prev * 0.55 + lvl * 0.45);
        }
        const next: "user" | "model" | null = modelSpeakingRef.current
          ? "model"
          : userSpeakingRef.current ? "user" : null;
        setActiveSpeaker((cur) => (cur === next ? cur : next));
      }
    });
    return () => { off(); };
  }, [client, flushUser, flushModel, maybeVoiceCapture]);

  // When the connection drops we want the indicator to fall back to its
  // resting "Listening" / idle state instantly — without waiting for an
  // event that may never arrive.
  useEffect(() => {
    if (state !== "connected") {
      userSpeakingRef.current = false;
      modelSpeakingRef.current = false;
      setActiveSpeaker(null);
      setUserLevel(0);
      setModelLevel(0);
    }
  }, [state]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript.length]);

  // Privacy: when section is hidden/inactive OR the panel unmounts, tear down
  // the session immediately so mic/camera don't keep running invisibly. The
  // unmount cleanup matters because AgentPage gates LiveInlineGate behind
  // {liveOpen && ...} — the component is removed straight from the tree
  // without a chance to render with active=false first.
  useEffect(() => {
    if (!active) {
      try { client.disconnect(); } catch {}
      setMicOn(false); setCamOn(false); setScreenOn(false);
    }
    return () => {
      try { client.disconnect(); } catch {}
    };
  }, [active, client]);

  const connect = useCallback(async () => {
    setError("");
    try { await client.connect(); }
    catch (e: any) { setError(e?.message || "Couldn't start Live session."); return; }
    try { await client.startMic(); setMicOn(true); } catch { setMicOn(false); }
  }, [client]);

  const disconnect = useCallback(() => {
    client.disconnect();
    setMicOn(false); setCamOn(false); setScreenOn(false);
  }, [client]);

  const toggleMic = useCallback(async () => {
    if (micOn) { client.stopMic(); setMicOn(false); }
    else { await client.startMic(); setMicOn(true); }
  }, [client, micOn]);

  // Attach the live MediaStream to our visible <video> preview tile
  // every time the camera/screen toggle changes. We can't do this in the
  // toggle callbacks alone because the video element may not exist yet
  // when the toggle fires (the tile only renders after camOn/screenOn
  // becomes true). The effect runs every time either flips.
  useEffect(() => {
    const v = previewVideoRef.current;
    if (!v) return;
    const stream = client.getVideoStream();
    if (stream && (camOn || screenOn)) {
      if (v.srcObject !== stream) {
        v.srcObject = stream;
        v.muted = true;
        v.playsInline = true;
        // Some browsers reject autoplay if play() is called before the
        // element is attached to the DOM — silently swallow the
        // AbortError; the video will still start once it's mounted.
        v.play().catch(() => {});
      }
      // Listen for the user stopping screen-share via the browser's
      // own "Stop sharing" bar — without this the UI would still
      // claim screenOn:true even though the stream is dead.
      const tracks = stream.getVideoTracks();
      const handleEnded = () => {
        try { client.stopVideo(); } catch { /* ignore */ }
        setCamOn(false);
        setScreenOn(false);
      };
      tracks.forEach((t) => t.addEventListener("ended", handleEnded));
      return () => {
        tracks.forEach((t) => t.removeEventListener("ended", handleEnded));
        // Detach the stream from the <video> on unmount / re-run so
        // the element doesn't keep a reference to the (possibly already
        // stopped) MediaStream and prevent garbage collection.
        const cur = previewVideoRef.current;
        if (cur && cur.srcObject) {
          try { cur.srcObject = null; } catch { /* ignore */ }
        }
      };
    }
    // Clear the srcObject when the stream is gone so the <video> can
    // be garbage collected cleanly on unmount.
    if (v.srcObject) {
      try { v.srcObject = null; } catch { /* ignore */ }
    }
    return undefined;
  }, [client, camOn, screenOn]);

  const toggleCam = useCallback(async () => {
    try {
      if (camOn) { client.stopVideo(); setCamOn(false); return; }
      if (screenOn) { client.stopVideo(); setScreenOn(false); }
      await client.startVideo("camera", 1500);
      setCamOn(true);
    } catch (e: any) { setError(e?.message || "Camera permission denied."); }
  }, [client, camOn, screenOn]);

  const toggleScreen = useCallback(async () => {
    try {
      if (screenOn) { client.stopVideo(); setScreenOn(false); return; }
      if (camOn) { client.stopVideo(); setCamOn(false); }
      await client.startVideo("screen", 2000);
      setScreenOn(true);
    } catch (e: any) { setError(e?.message || "Screen-share cancelled."); }
  }, [client, camOn, screenOn]);

  // Keyboard shortcut: Shift+C while a live session is connected and
  // video is on triggers a manual capture. Ignored when typing in any
  // input/textarea so it can't fight the user's keystrokes.
  useEffect(() => {
    if (state !== "connected" || (!camOn && !screenOn)) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "C" && e.key !== "c") return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable) return;
      }
      e.preventDefault();
      void triggerVisualCapture("");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, camOn, screenOn, triggerVisualCapture]);

  const isConnected = state === "connected";
  const isConnecting = state === "connecting";
  const transcriptHeight = compact ? 220 : 300;

  // Status dot color matches the parent Agent Hub's quiet palette: green when
  // live, amber while connecting, red on error, otherwise muted. While
  // connected, the dot subtly shifts when the assistant is talking (violet)
  // vs. when it's hearing the user (cyan) — but stays the same 7px size.
  const statusColor = !isConnected
    ? (isConnecting ? "#f59e0b" : state === "error" ? "#ef4444" : "var(--text-3)")
    : activeSpeaker === "model" ? "#a78bfa"
    : activeSpeaker === "user" ? "#22d3ee"
    : "#22c55e";
  // Header status word reflects the active speaker. Updates within ~150ms
  // because vad events fire at ~10Hz with a crisp speaking=false edge.
  const statusLabel = !isConnected
    ? (isConnecting ? "Connecting…" : state === "error" ? "Error" : "Idle")
    : activeSpeaker === "model" ? "Speaking"
    : activeSpeaker === "user" ? "You're talking"
    : "Listening";

  // The VU bars: only shown while connected. Height tracks the *active*
  // side's smoothed level; when nobody is talking the meter clamps to
  // baseline so it stays visibly quiet (no stale glow from the last
  // turn). Two bars (left/right) animate slightly out of phase for a
  // touch of life.
  const meterLevel = activeSpeaker === "model" ? modelLevel
    : activeSpeaker === "user" ? userLevel
    : 0;
  const barBase = 3;
  const barMax = 11;
  const barH1 = barBase + Math.round(Math.min(1, meterLevel * 1.0) * (barMax - barBase));
  const barH2 = barBase + Math.round(Math.min(1, meterLevel * 0.75) * (barMax - barBase));

  return (
    <div style={{ display: "flex", flexDirection: "column", borderRadius: 12,
        overflow: "hidden", background: "var(--surface-2, #0f172a)",
        border: "1px solid var(--border, rgba(255,255,255,0.08))" }}>

      {/* Slim header — status dot + label + single Start/End button */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid var(--border, rgba(255,255,255,0.06))" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span aria-hidden="true" style={{
            width: 7, height: 7, borderRadius: "50%",
            background: statusColor,
            boxShadow: isConnected ? `0 0 6px ${statusColor}` : "none",
            animation: isConnecting
              ? "live-pulse 1.2s ease-in-out infinite"
              : (isConnected && activeSpeaker ? "live-dot-pulse 0.9s ease-in-out infinite" : "none"),
            flexShrink: 0,
            transition: "background 0.15s ease",
          }} />
          {/* Tiny 2-bar VU meter — only while connected. Height tracks the
              live audio level so the header feels alive without bringing
              back any of the heavy treatment we removed. */}
          {isConnected && (
            <span aria-hidden="true" style={{
              display: "inline-flex", alignItems: "flex-end", gap: 1.5,
              height: 12, width: 9, flexShrink: 0,
              opacity: activeSpeaker ? 1 : 0.45,
              transition: "opacity 0.15s ease",
            }}>
              <span style={{
                width: 2, height: barH1, background: statusColor, borderRadius: 1,
                transition: "height 0.08s linear, background 0.15s ease",
              }} />
              <span style={{
                width: 2, height: barH2, background: statusColor, borderRadius: 1,
                transition: "height 0.08s linear, background 0.15s ease",
              }} />
            </span>
          )}
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-1)" }}>Voice mode</span>
          <span aria-live="polite" style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 500,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            · {statusLabel}
          </span>
        </div>
        {isConnected ? (
          <button onClick={disconnect}
            style={slimActionBtn("end")}
            title="End voice session">
            <PhoneOff size={12} /> End
          </button>
        ) : (
          <button onClick={connect} disabled={isConnecting}
            style={{ ...slimActionBtn("start"), opacity: isConnecting ? 0.7 : 1,
                cursor: isConnecting ? "default" : "pointer" }}
            title="Start voice session">
            {isConnecting ? <Loader2 size={12} className="spin" /> : <Phone size={12} />}
            {isConnecting ? "Connecting" : "Start"}
          </button>
        )}
      </div>

      {/* Transcript */}
      <div ref={scrollRef} style={{ height: transcriptHeight, overflowY: "auto",
          padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {transcript.length === 0 && (
          <div style={{ opacity: 0.55, fontSize: 12, textAlign: "center", marginTop: 24,
              color: "var(--text-3)" }}>
            Tap Start to talk to your assistant in real time.
            <div style={{ fontSize: 11, marginTop: 8, opacity: 0.85 }}>
              Try: <em>"Save this thought…"</em>, <em>"What did I save about RAG?"</em>,
              <em> "Schedule revision tomorrow at 7"</em>
            </div>
          </div>
        )}
        {transcript.map((entry) => {
          if (entry.role === "tool") {
            const r = entry.result || {};
            const isCapture = entry.name === "capture_frame";
            const isErr = !!r.error;
            const isPending = !!r.pending;
            const thumb = isCapture ? (r.image as string | undefined) : undefined;
            const accent = isErr
              ? { bg: "rgba(239,68,68,0.10)", bd: "rgba(239,68,68,0.30)", icon: <XIcon size={12} /> }
              : isPending
                ? { bg: "rgba(99,102,241,0.10)", bd: "rgba(99,102,241,0.30)", icon: <Loader2 size={12} className="spin" /> }
                : isCapture
                  ? { bg: "rgba(34,197,94,0.10)", bd: "rgba(34,197,94,0.30)", icon: <Check size={12} /> }
                  : { bg: "rgba(56,189,248,0.10)", bd: "rgba(56,189,248,0.25)", icon: <Wand2 size={12} /> };
            return (
              <div key={entry.id} style={{ alignSelf: "stretch", padding: "8px 10px", borderRadius: 10,
                  background: accent.bg, border: `1px solid ${accent.bd}`,
                  fontSize: 11, color: "var(--text-2)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: thumb ? 6 : 4 }}>
                  {accent.icon}
                  <strong>{isCapture ? "Visual capture" : entry.name}</strong>
                </div>
                {thumb && (
                  <img
                    src={thumb}
                    alt="Captured frame thumbnail"
                    data-testid="capture-thumbnail"
                    style={{ display: "block", width: "100%", maxHeight: 120,
                      objectFit: "cover", borderRadius: 6, marginBottom: 6,
                      border: "1px solid rgba(255,255,255,0.06)" }}
                  />
                )}
                <div style={{ opacity: 0.85 }}>
                  {summariseToolResult(entry.name, r, entry.args)}
                </div>
              </div>
            );
          }
          const mine = entry.role === "user";
          return (
            <div key={entry.id} style={{ alignSelf: mine ? "flex-end" : "flex-start",
                maxWidth: "88%", padding: "8px 12px", borderRadius: 12, fontSize: 13, lineHeight: 1.4,
                color: "var(--text-1)",
                background: mine ? "rgba(99,102,241,0.18)" : "rgba(255,255,255,0.04)",
                border: mine ? "1px solid rgba(99,102,241,0.30)" : "1px solid rgba(255,255,255,0.06)" }}>
              {entry.text}
              {!mine && entry.interrupted && (
                <span aria-label="You interrupted the assistant" style={{
                    marginLeft: 6, opacity: 0.6, fontSize: 11, fontStyle: "italic",
                    color: "var(--text-3)", whiteSpace: "nowrap" }}>
                  …interrupted
                </span>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div style={{ padding: "6px 12px", fontSize: 11, color: "#fca5a5",
            background: "rgba(239,68,68,0.10)", borderTop: "1px solid rgba(239,68,68,0.25)" }}>
          {error}
        </div>
      )}

      {/* Live preview tile — renders only when camera or screen is on.
          Mirrors the SAME MediaStream the LiveClient is already pushing
          to the model, so there's no extra getUserMedia call. The
          Capture button overlays the bottom-right corner; a flash ring
          and "capturing…" badge give immediate feedback. */}
      {(camOn || screenOn) && (
        <div style={{
          position: "relative", margin: "0 12px 8px",
          borderRadius: 10, overflow: "hidden",
          border: `1px solid ${flash === "ok" ? "rgba(34,197,94,0.6)"
                            : flash === "err" ? "rgba(239,68,68,0.6)"
                            : "var(--border, rgba(255,255,255,0.08))"}`,
          background: "#000",
          aspectRatio: "16 / 10",
          maxHeight: 180,
          transition: "border-color 0.2s ease, box-shadow 0.2s ease",
          boxShadow: flash === "ok" ? "0 0 0 3px rgba(34,197,94,0.25)"
                  : flash === "err" ? "0 0 0 3px rgba(239,68,68,0.25)"
                  : "none",
        }}>
          <video
            ref={previewVideoRef}
            autoPlay muted playsInline
            data-testid="live-preview-video"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block",
              // Mirror the camera so the user sees themselves naturally.
              // Screen share stays unmirrored.
              transform: camOn ? "scaleX(-1)" : "none" }}
          />
          {/* Top-left source badge */}
          <div style={{ position: "absolute", top: 6, left: 6, padding: "2px 7px",
              borderRadius: 999, background: "rgba(0,0,0,0.55)", color: "#fff",
              fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
              textTransform: "uppercase", display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%",
              background: camOn ? "#06b6d4" : "#a78bfa" }} />
            {camOn ? "Camera" : "Screen"}
          </div>
          {/* Capture button (bottom-right) */}
          <button
            onClick={() => triggerVisualCapture("")}
            disabled={capturing || !isConnected}
            data-testid="button-live-capture-frame"
            title="Capture frame to vault (Shift+C)"
            style={{
              position: "absolute", bottom: 6, right: 6,
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "5px 10px", borderRadius: 999,
              background: capturing
                ? "rgba(99,102,241,0.85)"
                : "linear-gradient(135deg, #6366f1, #8b5cf6)",
              color: "#fff", border: "1px solid rgba(255,255,255,0.18)",
              fontSize: 11, fontWeight: 700, fontFamily: "inherit",
              cursor: capturing ? "default" : "pointer",
              opacity: capturing ? 0.8 : 1,
              boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
            }}
          >
            {capturing ? <Loader2 size={11} className="spin" /> : <Camera size={11} />}
            {capturing ? "Capturing…" : "Capture"}
          </button>
          {/* Hint chip (bottom-left) when idle */}
          {!capturing && (
            <div style={{ position: "absolute", bottom: 6, left: 6,
                padding: "3px 7px", borderRadius: 6,
                background: "rgba(0,0,0,0.55)", color: "rgba(255,255,255,0.75)",
                fontSize: 10, fontWeight: 500 }}>
              Say "capture this" or press Shift+C
            </div>
          )}
        </div>
      )}

      {/* Quiet controls — mic / camera / screen, neutral surface, smaller icons */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", borderTop: "1px solid var(--border, rgba(255,255,255,0.06))" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={toggleMic} disabled={!isConnected} style={quietCtrlBtn(micOn, isConnected)}
            title={!isConnected ? "Start a session first" : micOn ? "Mute" : "Unmute"}>
            {micOn ? <Mic size={13} /> : <MicOff size={13} />}
          </button>
          <button onClick={toggleCam} disabled={!isConnected} style={quietCtrlBtn(camOn, isConnected)}
            title={!isConnected ? "Start a session first" : camOn ? "Stop camera" : "Start camera"}>
            {camOn ? <Video size={13} /> : <VideoOff size={13} />}
          </button>
          <button onClick={toggleScreen} disabled={!isConnected} style={quietCtrlBtn(screenOn, isConnected)}
            title={!isConnected ? "Start a session first" : screenOn ? "Stop screen share" : "Share screen"}>
            <MonitorUp size={13} />
          </button>
        </div>
        <div style={{ fontSize: 10.5, color: "var(--text-3)", display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
          {micOn && <span style={{ color: "#22c55e" }}>Mic</span>}
          {camOn && <span style={{ color: "#06b6d4" }}>Camera</span>}
          {screenOn && <span style={{ color: "#a78bfa" }}>Screen</span>}
        </div>
      </div>

      <style>{`
        @keyframes live-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(245,158,11,0.7); }
          50% { box-shadow: 0 0 0 5px rgba(245,158,11,0); }
        }
        @keyframes live-dot-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.7; transform: scale(0.85); }
        }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

/** LiveInlineGate — checks /api/live/status and renders LiveInline only if
 *  the backend has an API key configured; otherwise renders a soft notice. */
export const LiveInlineGate: React.FC<{ active: boolean; compact?: boolean }> = ({ active, compact }) => {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/live/status")
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => { if (!cancelled) setEnabled(!!d?.enabled); })
      .catch(() => { if (!cancelled) setEnabled(false); });
    return () => { cancelled = true; };
  }, []);
  if (enabled === null) {
    return (
      <div style={{ padding: 14, fontSize: 12, color: "var(--text-3)",
          background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12 }}>
        Checking Live availability…
      </div>
    );
  }
  if (!enabled) {
    return (
      <div style={{ padding: 14, fontSize: 12, color: "var(--text-3)",
          background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12 }}>
        Voice mode is unavailable in this environment. Text chat above still works.
      </div>
    );
  }
  return <LiveInline active={active} compact={compact} />;
};
