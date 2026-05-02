import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Fetch a URL and always resolve to a T[]. Never throws, never returns
 *  non-array data. Safe to use directly as a state setter argument. */
export async function safeList<T>(url: string, options?: RequestInit): Promise<T[]> {
  try {
    const r = await fetch(url, options);
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

/** Fetch a URL and resolve to T | null. Never throws. */
export async function safeJson<T>(url: string, options?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(url, options);
    if (!r.ok) return null;
    return await r.json() as T;
  } catch {
    return null;
  }
}

/** Ensure a value is an array — used when a runtime response might deviate
 *  from the declared type (e.g. 500 error object instead of T[]). */
export function toArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const getYouTubeId = (url: string): string | null => {
  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/shorts\/([^&\n?#]+)/,
  ];
  for (const p of patterns) {
    const m = url?.match(p);
    if (m) return m[1];
  }
  return null;
};

export const YouTubeEmbed = ({ url }: { url: string }) => {
  const id = getYouTubeId(url);
  if (!id) return null;
  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', background: '#000', width: '100%', position: 'relative', paddingBottom: '56.25%', height: 0 }}>
      <iframe
        src={`https://www.youtube.com/embed/${id}?rel=0&modestbranding=1`}
        title="YouTube video"
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
};

export const YouTubeThumbnail = ({ url, onClick }: { url: string; onClick?: () => void }) => {
  const id = getYouTubeId(url);
  if (!id) return null;
  // Fallback chain: maxres (1280x720, may 404) → sddefault → hqdefault → mqdefault.
  // mqdefault is 320x180 with no black bars and is virtually always present, so
  // it's a safe last stop. The chain is driven by onError.
  const FALLBACKS = [
    `https://img.youtube.com/vi/${id}/maxresdefault.jpg`,
    `https://img.youtube.com/vi/${id}/sddefault.jpg`,
    `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
    `https://img.youtube.com/vi/${id}/mqdefault.jpg`,
  ];
  const handleError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const idx = parseInt(img.dataset.fallbackIdx || '0', 10);
    if (idx < FALLBACKS.length - 1) {
      img.dataset.fallbackIdx = String(idx + 1);
      img.src = FALLBACKS[idx + 1];
    }
  };
  return (
    <div onClick={onClick} style={{ position: 'relative', borderRadius: '12px 12px 0 0', overflow: 'hidden', background: '#000', cursor: onClick ? 'pointer' : 'default' }}>
      <img src={FALLBACKS[0]} alt="YouTube thumbnail" loading="lazy"
        data-fallback-idx="0" onError={handleError}
        className="yt-thumb-img" />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.35) 100%)', pointerEvents: 'none' }}>
        <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(239,68,68,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 24px rgba(239,68,68,0.55)' }}>
          <svg viewBox="0 0 24 24" fill="white" width="22" height="22"><path d="M8 5v14l11-7z"/></svg>
        </div>
      </div>
      <div style={{ position: 'absolute', top: 8, right: 8, padding: '3px 8px', background: 'rgba(239,68,68,0.92)', borderRadius: 4, color: '#fff', fontSize: 9, fontWeight: 700, letterSpacing: '1px', pointerEvents: 'none' }}>YOUTUBE</div>
    </div>
  );
};
