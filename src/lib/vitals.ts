// Real-User Monitoring for Core Web Vitals.
//
// We rely on the browser's built-in PerformanceObserver instead of pulling
// in `web-vitals` as a dependency — that keeps the JS payload at zero
// bytes. The observer fires once per metric per page load, batches the
// samples, and ships them via `navigator.sendBeacon` on visibility change
// so the request always lands even when the user closes the tab.
//
// The backend exposes a no-op `POST /api/vitals` endpoint that just
// accepts and discards the payload (or logs it at info level). That keeps
// the network request fire-and-forget and lets us add real persistence
// later without touching the client.

type VitalSample = {
  name: 'LCP' | 'CLS' | 'FID' | 'INP' | 'FCP' | 'TTFB';
  value: number;
  id: string;
  rating: 'good' | 'needs-improvement' | 'poor';
};

const ENDPOINT = '/api/vitals';
const samples: VitalSample[] = [];
let flushed = false;

function rate(name: VitalSample['name'], value: number): VitalSample['rating'] {
  // Thresholds straight from web.dev/vitals.
  if (name === 'LCP') return value <= 2500 ? 'good' : value <= 4000 ? 'needs-improvement' : 'poor';
  if (name === 'CLS') return value <= 0.1 ? 'good' : value <= 0.25 ? 'needs-improvement' : 'poor';
  if (name === 'INP' || name === 'FID') return value <= 200 ? 'good' : value <= 500 ? 'needs-improvement' : 'poor';
  if (name === 'FCP') return value <= 1800 ? 'good' : value <= 3000 ? 'needs-improvement' : 'poor';
  if (name === 'TTFB') return value <= 800 ? 'good' : value <= 1800 ? 'needs-improvement' : 'poor';
  return 'good';
}

function record(name: VitalSample['name'], value: number) {
  samples.push({
    name,
    value: Math.round(value * 1000) / 1000,
    id: `${name}-${performance.now().toFixed(0)}`,
    rating: rate(name, value),
  });
}

function flush() {
  if (flushed || samples.length === 0) return;
  flushed = true;
  const payload = JSON.stringify({
    path: location.pathname,
    referrer: document.referrer || null,
    ua: navigator.userAgent,
    samples: samples.slice(),
    ts: Date.now(),
  });
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(ENDPOINT, blob);
    } else {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Vitals reporting must never break the app.
  }
}

export function reportWebVitals() {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;

  // LCP — fires per layout-shift; we keep the last value.
  let lcpValue = 0;
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries() as any[];
      for (const e of entries) lcpValue = e.renderTime || e.loadTime || e.startTime || lcpValue;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}

  // CLS — sum of all session-level shifts.
  let clsValue = 0;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as any[]) {
        if (!e.hadRecentInput) clsValue += e.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {}

  // FCP / TTFB — one-shot, derived from navigation timing.
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.name === 'first-contentful-paint') record('FCP', e.startTime);
      }
    }).observe({ type: 'paint', buffered: true });
  } catch {}
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav) record('TTFB', nav.responseStart);
  } catch {}

  // INP / FID approximation via event timing.
  let worstInteraction = 0;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as any[]) {
        const dur = e.duration ?? 0;
        if (dur > worstInteraction) worstInteraction = dur;
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as any);
  } catch {}

  const finalize = () => {
    if (lcpValue > 0) record('LCP', lcpValue);
    record('CLS', clsValue);
    if (worstInteraction > 0) record('INP', worstInteraction);
    flush();
  };

  // Browsers stop guaranteeing `unload`; visibilitychange + pagehide is
  // the modern combo that catches mobile back-swipes too.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') finalize();
  });
  window.addEventListener('pagehide', finalize, { once: true });
}
