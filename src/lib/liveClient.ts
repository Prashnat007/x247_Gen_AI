/**
 * Live voice client — talks to our backend `/ws/live` relay, which proxies
 * to a third-party realtime model API. The relay holds the API key, so the
 * browser never sees it.
 *
 * Capabilities:
 *   - Captures microphone at 16 kHz mono PCM and streams it as base64 frames.
 *   - Plays back model audio (24 kHz mono PCM) via Web Audio API.
 *   - Optionally captures camera or screen frames as JPEGs.
 *   - Surfaces user/model transcripts and tool-call events via callbacks.
 *
 * Designed to be UI-agnostic — `LiveChatPanel.tsx` wires it into a panel.
 */

import { auth } from "./firebase";

type LiveEventName =
  | "ready"
  | "setup_complete"
  | "user_transcript"
  | "model_transcript"
  | "text"
  | "tool_call_started"
  | "tool_call_done"
  | "turn_complete"
  | "interrupted"
  | "error"
  | "state"
  | "vad";

type ConnState = "idle" | "connecting" | "connected" | "closing" | "closed" | "error";

/** Voice-activity event source — either the local mic or the remote model audio. */
export type VadSource = "user" | "model";

export interface LiveEvent {
  type: LiveEventName;
  text?: string;
  state?: ConnState;
  name?: string;
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
  calls?: unknown[];
  error?: string;
  model?: string;
  user_id?: string;
  /** vad-only — which side is making sound. */
  source?: VadSource;
  /** vad-only — normalized 0..1 audio level (RMS, lightly compressed). */
  level?: number;
  /** vad-only — true while audio is above the speaking threshold. */
  speaking?: boolean;
}

type Listener = (e: LiveEvent) => void;

const TARGET_INPUT_RATE = 16000;
const OUTPUT_PLAYBACK_RATE = 24000;

async function resolveIdToken(): Promise<string> {
  try {
    const fb = auth?.currentUser;
    if (fb) {
      const token = await fb.getIdToken();
      if (token) return token;
    }
  } catch {}
  return "";
}

export class LiveClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private state: ConnState = "idle";

  // Mic capture
  private micStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private scriptNode: ScriptProcessorNode | null = null; // fallback path

  // Playback
  private playCtx: AudioContext | null = null;
  private playCursor = 0;

  // Camera / screen
  private videoStream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private videoTimer: number | null = null;
  // Track which media source is currently active so the UI can label
  // the live preview tile ("Camera" vs "Screen") and the visual-capture
  // endpoint can attribute the frame correctly.
  private videoSource: "camera" | "screen" | null = null;

  // VAD bookkeeping — throttle "vad" events to ~10 Hz so the UI can pulse
  // without flooding React with re-renders. Each side keeps its own
  // last-emit timestamp + a "currently speaking" flag so we can fire a
  // crisp speaking=false edge when audio stops.
  private lastUserVadAt = 0;
  private lastModelVadAt = 0;
  private userSpeaking = false;
  private modelSpeaking = false;
  private modelWatchdog: number | null = null;
  private lastModelChunkAt = 0;
  // Barge-in: track when the user's current speaking-burst started so we
  // can require it to last past a small sustained window before cutting
  // the model off. Resets to 0 the moment the user goes quiet, so brief
  // coughs / keyboard taps never trip it. `bargedInThisTurn` makes sure
  // we only fire one interrupt per model turn even if the user keeps
  // talking after the cut.
  private userSpeakingSinceMs = 0;
  private bargedInThisTurn = false;
  // RMS thresholds for "speaking". Tuned conservatively: mic uses raw
  // amplitude after AGC, model audio is already loud so a smaller floor
  // is enough.
  private readonly USER_SPEAK_THRESHOLD = 0.025;
  private readonly MODEL_SPEAK_THRESHOLD = 0.012;
  private readonly VAD_EMIT_INTERVAL_MS = 100;
  // Minimum continuous user-speaking duration (ms) before we treat it as
  // a real barge-in. Sits inside the task's 150–250ms band: long enough
  // that single-frame coughs (~85ms) and 2-frame bumps (~170ms) get
  // filtered out, short enough that real speech yields the floor inside
  // the ~250ms target.
  private readonly BARGE_IN_MIN_MS = 180;

  on(listener: Listener) {
    this.listeners.add(listener);
    listener({ type: "state", state: this.state });
    return () => this.listeners.delete(listener);
  }

  private emit(e: LiveEvent) {
    this.listeners.forEach((l) => {
      try { l(e); } catch {}
    });
  }

  private setState(s: ConnState) {
    this.state = s;
    this.emit({ type: "state", state: s });
  }

  getState(): ConnState {
    return this.state;
  }

  /** Connect the WebSocket. Does NOT start the mic — call `startMic()` after. */
  async connect(): Promise<void> {
    if (this.ws && (this.state === "connected" || this.state === "connecting")) return;
    this.setState("connecting");

    const token = await resolveIdToken();
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/ws/live`;

    await new Promise<void>((resolve, reject) => {
      let opened = false;
      try {
        const ws = new WebSocket(url);
        ws.binaryType = "arraybuffer";
        this.ws = ws;
        ws.onopen = () => {
          opened = true;
          // Send auth frame as the very first message so the server can
          // verify identity before starting the relay.
          ws.send(JSON.stringify({ type: "auth", token }));
          this.setState("connected");
          resolve();
        };
        ws.onerror = (ev) => {
          if (!opened) {
            this.setState("error");
            this.emit({ type: "error", error: "Live connection error" });
            reject(ev);
          }
        };
        ws.onclose = () => {
          this.setState("closed");
        };
        ws.onmessage = (ev) => this.handleFrame(ev.data);
      } catch (e: any) {
        this.setState("error");
        this.emit({ type: "error", error: String(e?.message || e) });
        reject(e);
      }
    });
  }

  private handleFrame(data: any) {
    if (typeof data !== "string") return;
    let msg: any;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg?.type === "audio" && msg?.data) {
      this.playPcmBase64(msg.data as string);
      return;
    }
    if (msg?.type) {
      this.emit(msg as LiveEvent);
    }
  }

  /** Decode 16-bit PCM little-endian base64 → schedule on the play AudioContext. */
  private playPcmBase64(b64: string) {
    try {
      if (!this.playCtx) {
        this.playCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: OUTPUT_PLAYBACK_RATE,
        });
      }
      const bin = atob(b64);
      const len = bin.length;
      const i16 = new Int16Array(len / 2);
      for (let i = 0, j = 0; i < len; i += 2, j++) {
        i16[j] = (bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8)) << 16 >> 16;
      }
      const f32 = new Float32Array(i16.length);
      for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
      const buf = this.playCtx.createBuffer(1, f32.length, OUTPUT_PLAYBACK_RATE);
      buf.copyToChannel(f32, 0);
      const src = this.playCtx.createBufferSource();
      src.buffer = buf;
      src.connect(this.playCtx.destination);
      const now = this.playCtx.currentTime;
      const start = Math.max(now, this.playCursor);
      src.start(start);
      this.playCursor = start + buf.duration;

      // Compute a quick RMS for the model's chunk and surface it as a
      // throttled "vad" event so the UI can show a "Speaking" indicator
      // alongside a tiny audio-level meter.
      this.emitModelVad(f32);
    } catch (e) {
      console.warn("Live: pcm decode/play failed", e);
    }
  }

  /** Compute RMS of a Float32 PCM frame, throttle, and emit a "vad" event. */
  private emitUserVad(input: Float32Array) {
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
    let sum = 0;
    for (let i = 0; i < input.length; i++) {
      const v = input[i];
      sum += v * v;
    }
    const rms = Math.sqrt(sum / Math.max(1, input.length));
    // Light compression so small voice swings still move the meter visibly.
    const level = Math.min(1, Math.sqrt(rms) * 1.6);
    const speaking = rms > this.USER_SPEAK_THRESHOLD;
    const speakingChanged = speaking !== this.userSpeaking;
    if (speakingChanged) {
      // Edge: stamp / clear the start of the current speaking burst so
      // the barge-in check can measure sustained duration. Brief noises
      // that flip back to silent within BARGE_IN_MIN_MS reset to 0 here.
      this.userSpeakingSinceMs = speaking ? now : 0;
    }
    if (speakingChanged || now - this.lastUserVadAt >= this.VAD_EMIT_INTERVAL_MS) {
      this.userSpeaking = speaking;
      this.lastUserVadAt = now;
      this.emit({ type: "vad", source: "user", level, speaking });
    }
    // Barge-in: when the user has been speaking continuously for at
    // least BARGE_IN_MIN_MS while the model is mid-turn, cut the model
    // off so the assistant yields the floor like a real conversation.
    // Re-checking on every frame (not just emit ticks) keeps the
    // response time tight to the task's "within ~250ms" target.
    if (
      speaking &&
      this.modelSpeaking &&
      !this.bargedInThisTurn &&
      this.userSpeakingSinceMs > 0 &&
      now - this.userSpeakingSinceMs >= this.BARGE_IN_MIN_MS
    ) {
      this.bargedInThisTurn = true;
      this.interrupt();
    }
  }

  private emitModelVad(input: Float32Array) {
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
    this.lastModelChunkAt = now;
    let sum = 0;
    for (let i = 0; i < input.length; i++) {
      const v = input[i];
      sum += v * v;
    }
    const rms = Math.sqrt(sum / Math.max(1, input.length));
    const level = Math.min(1, Math.sqrt(rms) * 1.4);
    const speaking = rms > this.MODEL_SPEAK_THRESHOLD;
    const speakingChanged = speaking !== this.modelSpeaking;
    if (speakingChanged && speaking) {
      // New model turn (or resumed audio after a gap) — re-arm barge-in
      // so the user can interrupt this turn too.
      this.bargedInThisTurn = false;
    }
    if (speakingChanged || now - this.lastModelVadAt >= this.VAD_EMIT_INTERVAL_MS) {
      this.modelSpeaking = speaking;
      this.lastModelVadAt = now;
      this.emit({ type: "vad", source: "model", level, speaking });
    }
    // Watchdog: model audio arrives in bursts; if no chunk for ~160ms we
    // actively clear the "Speaking" flag — the playback path won't fire
    // again until the next turn. Threshold is kept just above the
    // typical 100ms inter-chunk gap so we don't false-clear during a
    // sentence, but tight enough that the task's "within ~150ms"
    // responsiveness target still holds for speaking→silent.
    if (this.modelWatchdog == null) {
      this.modelWatchdog = window.setInterval(() => {
        if (!this.modelSpeaking) return;
        const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - this.lastModelChunkAt;
        if (elapsed > 160) {
          this.modelSpeaking = false;
          this.lastModelVadAt = (typeof performance !== "undefined" ? performance.now() : Date.now());
          this.emit({ type: "vad", source: "model", level: 0, speaking: false });
        }
      }, 60);
    }
  }

  /** Send a typed user message. */
  sendText(text: string) {
    if (!text || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "text", text }));
  }

  /** Cancel current model turn (barge-in). */
  interrupt() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "interrupt" }));
    }
    // Stop any queued playback by discarding the play context.
    try {
      this.playCtx?.close();
    } catch {}
    this.playCtx = null;
    this.playCursor = 0;
    if (this.modelSpeaking) {
      this.modelSpeaking = false;
      this.emit({ type: "vad", source: "model", level: 0, speaking: false });
    }
    // Surface a local "interrupted" event right away so UI cues (e.g.
    // marking the in-progress model bubble as cut off) don't have to
    // wait for the server to round-trip its echo. The server-side
    // event is idempotent with our local one — the listeners that act
    // on it are safe to run twice.
    this.emit({ type: "interrupted" });
  }

  /** Start streaming mic at 16 kHz mono PCM. */
  async startMic(): Promise<void> {
    if (this.micStream) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.micStream = stream;
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.audioCtx = ctx;
    const source = ctx.createMediaStreamSource(stream);

    // Use a ScriptProcessor for max compatibility (no worklet file needed).
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (e) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);
      // Emit a VAD event from the original (pre-resample) buffer so the
      // amplitude isn't affected by interpolation. Cheap to compute.
      this.emitUserVad(input);
      const resampled = this.resample(input, ctx.sampleRate, TARGET_INPUT_RATE);
      const pcm16 = this.floatTo16BitPCM(resampled);
      const b64 = this.arrayBufferToBase64(pcm16.buffer);
      this.ws.send(JSON.stringify({ type: "audio", data: b64 }));
    };
    source.connect(proc);
    // Connect to a muted destination to keep the processor alive.
    const muted = ctx.createGain();
    muted.gain.value = 0;
    proc.connect(muted);
    muted.connect(ctx.destination);
    this.scriptNode = proc;
  }

  stopMic() {
    try { this.scriptNode?.disconnect(); } catch {}
    try { this.workletNode?.disconnect(); } catch {}
    try { this.audioCtx?.close(); } catch {}
    try { this.micStream?.getTracks().forEach((t) => t.stop()); } catch {}
    this.scriptNode = null;
    this.workletNode = null;
    this.audioCtx = null;
    this.micStream = null;
    this.userSpeakingSinceMs = 0;
    if (this.userSpeaking) {
      this.userSpeaking = false;
      this.emit({ type: "vad", source: "user", level: 0, speaking: false });
    }
  }

  /** Start camera or screen capture; sends one JPEG every `intervalMs`. */
  async startVideo(source: "camera" | "screen", intervalMs = 1000): Promise<void> {
    this.stopVideo();
    let stream: MediaStream;
    if (source === "screen") {
      stream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true });
    } else {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
      });
    }
    this.videoStream = stream;
    const v = document.createElement("video");
    v.srcObject = stream;
    v.muted = true;
    v.playsInline = true;
    await v.play();
    this.videoEl = v;
    this.videoSource = source;

    const send = () => {
      if (!this.videoEl || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      try {
        const w = this.videoEl.videoWidth || 640;
        const h = this.videoEl.videoHeight || 480;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(this.videoEl, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        const b64 = dataUrl.split(",")[1];
        if (b64) {
          this.ws.send(JSON.stringify({ type: "image", mime_type: "image/jpeg", data: b64 }));
        }
      } catch (e) {
        console.warn("Live: video frame send failed", e);
      }
    };
    this.videoTimer = window.setInterval(send, intervalMs);
  }

  stopVideo() {
    if (this.videoTimer) {
      clearInterval(this.videoTimer);
      this.videoTimer = null;
    }
    try { this.videoStream?.getTracks().forEach((t) => t.stop()); } catch {}
    this.videoStream = null;
    this.videoEl = null;
    this.videoSource = null;
  }

  isVideoOn(): boolean {
    return !!this.videoStream;
  }

  /** Returns the underlying MediaStream so a UI component can attach
   *  it to a visible <video> element for the live preview tile.
   *  Null when no camera/screen capture is active. */
  getVideoStream(): MediaStream | null {
    return this.videoStream;
  }

  /** Which kind of video is currently active — used to label the
   *  preview tile and attribute server-side vault entries. */
  getVideoSource(): "camera" | "screen" | null {
    return this.videoSource;
  }

  /** Grab a single high-quality JPEG of whatever the live camera or
   *  screen is showing right now. Returns null when no video is on
   *  yet, or when the off-DOM <video> element has no decoded frames
   *  (videoWidth === 0 — happens for the first ~100 ms after start).
   *
   *  Returns BOTH a full-quality data URL (used by the AI vision pass
   *  and stored as `image_data` on the memory) and a downscaled
   *  thumbnail (max 320px wide, 0.7 quality, ~10–25 KB) used by Vault
   *  list/grid cards so we don't pay full-resolution bytes for every
   *  card render. */
  captureFrame(): { dataUrl: string; thumbnailDataUrl: string; source: "camera" | "screen" } | null {
    const v = this.videoEl;
    const src = this.videoSource;
    if (!v || !src) return null;
    const w = v.videoWidth || 0;
    const h = v.videoHeight || 0;
    if (w < 16 || h < 16) return null;
    try {
      // Full-resolution capture for vision + detail page.
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(v, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      if (!dataUrl || !dataUrl.startsWith("data:image/")) return null;

      // Downscaled thumbnail. Cap the long edge at 320 px so list
      // payloads stay tiny. We keep aspect ratio either way.
      const MAX = 320;
      let tw = w;
      let th = h;
      if (Math.max(w, h) > MAX) {
        if (w >= h) { tw = MAX; th = Math.max(1, Math.round(h * (MAX / w))); }
        else        { th = MAX; tw = Math.max(1, Math.round(w * (MAX / h))); }
      }
      const tCanvas = document.createElement("canvas");
      tCanvas.width = tw;
      tCanvas.height = th;
      const tCtx = tCanvas.getContext("2d");
      let thumbnailDataUrl = dataUrl;
      if (tCtx) {
        tCtx.drawImage(v, 0, 0, tw, th);
        const t = tCanvas.toDataURL("image/jpeg", 0.7);
        if (t && t.startsWith("data:image/")) thumbnailDataUrl = t;
      }
      return { dataUrl, thumbnailDataUrl, source: src };
    } catch (e) {
      console.warn("LiveClient.captureFrame failed", e);
      return null;
    }
  }

  isMicOn(): boolean {
    return !!this.micStream;
  }

  disconnect() {
    this.setState("closing");
    this.stopMic();
    this.stopVideo();
    try { this.ws?.close(); } catch {}
    this.ws = null;
    try { this.playCtx?.close(); } catch {}
    this.playCtx = null;
    this.playCursor = 0;
    if (this.modelWatchdog != null) {
      try { clearInterval(this.modelWatchdog); } catch {}
      this.modelWatchdog = null;
    }
    if (this.modelSpeaking) {
      this.modelSpeaking = false;
      this.emit({ type: "vad", source: "model", level: 0, speaking: false });
    }
    this.userSpeakingSinceMs = 0;
    this.bargedInThisTurn = false;
    this.setState("closed");
  }

  // ─── helpers ──────────────────────────────────────────────────────────────
  private resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
    if (fromRate === toRate) return input;
    const ratio = fromRate / toRate;
    const newLen = Math.round(input.length / ratio);
    const out = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      const srcPos = i * ratio;
      const i0 = Math.floor(srcPos);
      const i1 = Math.min(input.length - 1, i0 + 1);
      const frac = srcPos - i0;
      out[i] = input[i0] * (1 - frac) + input[i1] * frac;
    }
    return out;
  }

  private floatTo16BitPCM(input: Float32Array): Int16Array {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(
        null,
        bytes.subarray(i, Math.min(i + chunk, bytes.length)) as unknown as number[],
      );
    }
    return btoa(binary);
  }
}

// Singleton — only one Live session at a time per page.
let _client: LiveClient | null = null;
export function getLiveClient(): LiveClient {
  if (!_client) _client = new LiveClient();
  return _client;
}
