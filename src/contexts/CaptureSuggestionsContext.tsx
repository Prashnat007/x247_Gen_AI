/**
 * CaptureSuggestionsContext — tiny in-memory cache for AI-generated
 * `suggested_*` fields on a capture preview, keyed by `preview.id`
 * with a 60-second TTL.
 *
 * Why this exists: re-running `suggest_enrichments` on the backend
 * costs an LLM round trip (1-3 s). When the user hops away from a
 * capture preview and comes back — or clicks the "Re-analyze" button
 * on the memory detail page — we want the chips to repaint instantly
 * with the suggestions the user already saw a few seconds ago,
 * instead of either flashing a loader or showing stale empty chips.
 *
 * The cache lives only in component memory (no localStorage) because
 * suggestions are LLM output that may legitimately change run-to-run
 * and we never want a stale 60-min-old hint surfacing on a fresh
 * page load. 60 s is "while the user is still in flow on this
 * capture", not "remember this forever".
 *
 * Shape stored = the subset of Memory fields that suggest_enrichments
 * populates. The chips read directly from this shape, so all six
 * suggestion sources stay together.
 */
import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import type {
  SuggestedTask,
  SuggestedEvent,
  SuggestedHabitLink,
  SuggestedRevisit,
} from '../lib/types';

export interface SuggestionsBundle {
  suggested_folder_hint?: string;
  suggested_tasks?: SuggestedTask[];
  suggested_event?: SuggestedEvent | null;
  suggested_habit_link?: SuggestedHabitLink | null;
  suggested_revisit?: SuggestedRevisit | null;
}

interface CacheEntry {
  data: SuggestionsBundle;
  expiresAt: number;
}

interface CaptureSuggestionsCtx {
  getCached: (previewId: string) => SuggestionsBundle | null;
  setCached: (previewId: string, data: SuggestionsBundle) => void;
  invalidate: (previewId: string) => void;
}

const DEFAULT_TTL_MS = 60 * 1000;

const noopCtx: CaptureSuggestionsCtx = {
  getCached: () => null,
  setCached: () => {},
  invalidate: () => {},
};

const Ctx = createContext<CaptureSuggestionsCtx>(noopCtx);

export const CaptureSuggestionsProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  // useRef + Map keeps the cache process-wide for the SPA without
  // triggering re-renders on every set. Provider itself never
  // re-renders because the value is memoised against zero deps.
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());

  const getCached = useCallback((previewId: string): SuggestionsBundle | null => {
    if (!previewId) return null;
    const entry = cacheRef.current.get(previewId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      // Expired — drop it so the cache stays small over a long
      // session. Returning null also makes consumers fall back to
      // the preview's own suggested_* fields.
      cacheRef.current.delete(previewId);
      return null;
    }
    return entry.data;
  }, []);

  const setCached = useCallback((previewId: string, data: SuggestionsBundle) => {
    if (!previewId) return;
    cacheRef.current.set(previewId, {
      data,
      expiresAt: Date.now() + DEFAULT_TTL_MS,
    });
  }, []);

  const invalidate = useCallback((previewId: string) => {
    if (!previewId) return;
    cacheRef.current.delete(previewId);
  }, []);

  const value = useMemo<CaptureSuggestionsCtx>(
    () => ({ getCached, setCached, invalidate }),
    [getCached, setCached, invalidate],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

/** Hook for chips / panels — safe to call without the provider mounted. */
export const useCaptureSuggestions = (): CaptureSuggestionsCtx => useContext(Ctx);

export default CaptureSuggestionsProvider;
