/**
 * LinkerContext — global handle for opening the Cmd-K Universal Linker
 * (a.k.a. command palette) from anywhere in the app.
 *
 * Why a context instead of just lifting state into AppShell?
 * - The palette has three modes (jump / link / create) and a per-call
 *   "scope" (e.g. "linking from this memory"). Plumbing those props
 *   through every section of MemoryLinksPanel, EnrichPanel, and the
 *   future inbox quick-actions menu would be a maintenance trap.
 * - Modeled after CaptureSuggestionsContext (the W2 sibling) so the
 *   provider stack stays consistent.
 *
 * Modes
 * -----
 * - "jump"   → result click navigates to that entity's detail page.
 * - "link"   → result click POSTs to /links with `scope` as the
 *              "from" side and the result as "to". Used by
 *              MemoryLinksPanel's "Link existing" button.
 * - "create" → palette shows quick-create commands (`/task ...`,
 *              `/event ...`, etc.). Stub for now — full plumbing
 *              lands when the inbox quick-create row ships.
 */
import React, {
  createContext, useCallback, useContext, useMemo, useState,
} from 'react';

export type LinkerKind =
  | 'memory' | 'task' | 'event' | 'revisit' | 'habit' | 'folder';

export type LinkerMode = 'jump' | 'link' | 'create';

/**
 * Optional context for the open call. In `link` mode, `scope` is the
 * "from" side of the future POST /links call — usually the memory the
 * user is currently looking at. `restrictKind` narrows the palette's
 * search to that single kind so e.g. "Link existing task" only shows
 * tasks instead of mixing in events and folders.
 */
export interface LinkerOpenOptions {
  scope?: { kind: LinkerKind; id: string; title?: string } | null;
  restrictKind?: LinkerKind | null;
  /** Optional callback fired after a successful link write so the
   *  caller (e.g. MemoryLinksPanel) can refresh its data. */
  onLinked?: (result: { kind: LinkerKind; id: string; title?: string }) => void;
}

interface LinkerState {
  open: boolean;
  mode: LinkerMode;
  options: LinkerOpenOptions;
}

interface LinkerContextValue {
  state: LinkerState;
  openLinker: (mode: LinkerMode, options?: LinkerOpenOptions) => void;
  closeLinker: () => void;
}

const initialState: LinkerState = {
  open: false,
  mode: 'jump',
  options: {},
};

const LinkerContext = createContext<LinkerContextValue | null>(null);

export const LinkerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<LinkerState>(initialState);

  const openLinker = useCallback((mode: LinkerMode, options: LinkerOpenOptions = {}) => {
    setState({ open: true, mode, options });
  }, []);

  const closeLinker = useCallback(() => {
    // Reset mode/options too — leaving them around can leak the
    // previous "scope" into a fresh Cmd-K open and cause a stray link
    // write on the wrong entity.
    setState(initialState);
  }, []);

  const value = useMemo<LinkerContextValue>(
    () => ({ state, openLinker, closeLinker }),
    [state, openLinker, closeLinker],
  );

  return <LinkerContext.Provider value={value}>{children}</LinkerContext.Provider>;
};

/**
 * Hook for any component that wants to summon the palette. Throws if
 * the provider isn't mounted so we surface mis-wirings during dev
 * instead of silently failing the open call.
 */
export function useLinker(): LinkerContextValue {
  const ctx = useContext(LinkerContext);
  if (!ctx) {
    throw new Error('useLinker must be used inside <LinkerProvider>');
  }
  return ctx;
}
