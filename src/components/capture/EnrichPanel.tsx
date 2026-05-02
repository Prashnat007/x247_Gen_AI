/**
 * EnrichPanel — collapsible card on the Capture preview that lets
 * the user accept or edit AI-suggested enrichments (folder
 * placement, follow-up tasks, related memories, calendar event,
 * habit link, spaced-repetition revisit) BEFORE saving.
 *
 * State is owned here and bubbled up via `onChange` so the parent's
 * Save handler can build the /capture/save-bundle payload from a
 * single source of truth.
 *
 * P1D additions:
 *   - Reads CaptureSuggestionsContext (60 s in-memory cache) on
 *     mount, keyed by `preview.id`. Cache hit means the suggested_*
 *     bundle is reused even after a remount, so re-opening the same
 *     capture's chips is instant with no loader.
 *   - Fetches per-source-type "don't suggest again" prefs and
 *     suppresses the AI pre-fill for chips the user has muted for
 *     this source_type. The chip itself stays visible so the user
 *     can still add manually.
 *   - "Don't suggest again" link next to each expanded chip header.
 *   - Per-chip empty-state copy ("Add task", "Schedule reminder",
 *     "Link to a habit", "Pick a folder", "Browse memories",
 *     "Set a revisit").
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles, ChevronDown, ChevronUp, FolderOpen, ListChecks,
  Network, CalendarPlus, Flame, Bell, BellOff,
} from 'lucide-react';
import type { CaptureEnrichmentPrefs, Memory } from '../../lib/types';
import {
  getCaptureEnrichmentPrefs,
  setCaptureEnrichmentPrefs,
} from '../../lib/api';
import {
  useCaptureSuggestions,
  type SuggestionsBundle,
} from '../../contexts/CaptureSuggestionsContext';
import FolderChip, { type FolderState } from './FolderChip';
import TasksChip, { type TaskRow } from './TasksChip';
import RelatedChip from './RelatedChip';
import ScheduleChip, { type ScheduleEvent } from './ScheduleChip';
import HabitChip, { type HabitState } from './HabitChip';
import RevisitChip, { type RevisitState } from './RevisitChip';

export interface EnrichState {
  folder?: FolderState | null;
  tasks?: TaskRow[];
  related?: string[];          // memory ids the user picked
  calendar?: ScheduleEvent | null;
  habit?: HabitState | null;
  revisit?: RevisitState | null;
}

type ChipKey = 'folder' | 'tasks' | 'related' | 'calendar' | 'habit' | 'revisit';

interface ChipMeta {
  key: ChipKey;
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  color: string;
  /** Empty-state CTA copy used in the chip pill summary. */
  emptyCta: string;
  /** Pref dimension that hides the AI pre-fill for this chip. */
  prefKey: keyof Pick<CaptureEnrichmentPrefs,
    'disable_folders' | 'disable_tasks' | 'disable_related' |
    'disable_events'  | 'disable_habits' | 'disable_revisits'>;
}

const CHIPS: ChipMeta[] = [
  { key: 'folder',   label: 'Folder',   icon: FolderOpen,   color: '#22d3ee', emptyCta: 'Pick a folder',     prefKey: 'disable_folders'  },
  { key: 'tasks',    label: 'Tasks',    icon: ListChecks,   color: '#10b981', emptyCta: 'Add task',          prefKey: 'disable_tasks'    },
  { key: 'related',  label: 'Related',  icon: Network,      color: '#a78bfa', emptyCta: 'Browse memories',   prefKey: 'disable_related'  },
  { key: 'calendar', label: 'Schedule', icon: CalendarPlus, color: '#3b82f6', emptyCta: 'Schedule reminder', prefKey: 'disable_events'   },
  { key: 'habit',    label: 'Habit',    icon: Flame,        color: '#f59e0b', emptyCta: 'Link to a habit',   prefKey: 'disable_habits'   },
  { key: 'revisit',  label: 'Revisit',  icon: Bell,         color: '#fb7185', emptyCta: 'Set a revisit',     prefKey: 'disable_revisits' },
];

interface Props {
  preview: Memory;
  onChange: (state: EnrichState) => void;
}

const EMPTY_PREFS: CaptureEnrichmentPrefs = {
  disable_tasks: [], disable_events: [], disable_habits: [],
  disable_revisits: [], disable_folders: [], disable_related: [],
};

const EnrichPanel: React.FC<Props> = ({ preview, onChange }) => {
  const { getCached, setCached } = useCaptureSuggestions();

  // Pull suggested_* either from the live preview or from the cache
  // (cache wins so a fresh re-analyze is reflected on remount). Falls
  // back to the preview's own fields when the cache is cold.
  const cacheKey = preview.id || '';
  const cached = cacheKey ? getCached(cacheKey) : null;
  const liveBundle: SuggestionsBundle = useMemo(() => ({
    suggested_folder_hint: preview.suggested_folder_hint,
    suggested_tasks: preview.suggested_tasks,
    suggested_event: preview.suggested_event,
    suggested_habit_link: preview.suggested_habit_link,
    suggested_revisit: preview.suggested_revisit,
  }), [
    preview.suggested_folder_hint,
    preview.suggested_tasks,
    preview.suggested_event,
    preview.suggested_habit_link,
    preview.suggested_revisit,
  ]);
  const effectiveBundle: SuggestionsBundle = cached || liveBundle;

  // Warm the cache with the live preview's suggestion bundle so the
  // next remount of this same preview reads from cache instead of the
  // (possibly stale) preview prop. Ignored when preview.id is empty.
  useEffect(() => {
    if (!cacheKey) return;
    if (cached) return;
    const hasAny =
      !!(liveBundle.suggested_folder_hint && liveBundle.suggested_folder_hint.trim()) ||
      !!(liveBundle.suggested_tasks && liveBundle.suggested_tasks.length) ||
      !!liveBundle.suggested_event ||
      !!liveBundle.suggested_habit_link ||
      !!liveBundle.suggested_revisit;
    if (hasAny) setCached(cacheKey, liveBundle);
  }, [cacheKey, cached, liveBundle, setCached]);

  // Per-source-type "don't suggest" preferences. Kept in local state
  // so the "Don't suggest again" link can optimistically update both
  // the chip render and the persisted Firestore doc. Soft-fail on
  // fetch — empty prefs just mean we show all suggestions.
  //
  // `prefsLoaded` gates the chip editor's mount so the per-chip
  // auto-seed effects (TasksChip / ScheduleChip / RevisitChip /
  // HabitChip seed once from `suggested_*` on first open) cannot
  // fire before we know which dimensions are muted. Without this
  // gate a chip opened during the brief fetch window would seed
  // from the (about-to-be-stripped) AI suggestion and leak through.
  const [prefs, setPrefs] = useState<CaptureEnrichmentPrefs>(EMPTY_PREFS);
  const [prefsLoaded, setPrefsLoaded] = useState<boolean>(false);
  // prefsRef keeps a synchronous mirror of `prefs` so handleDontSuggest
  // can build the next PUT payload without the React-anti-pattern of
  // reading state inside a setPrefs updater callback for side-effects.
  const prefsRef = useRef<CaptureEnrichmentPrefs>(EMPTY_PREFS);
  useEffect(() => { prefsRef.current = prefs; }, [prefs]);
  useEffect(() => {
    let cancelled = false;
    getCaptureEnrichmentPrefs()
      .then(p => { if (!cancelled) { setPrefs(p); setPrefsLoaded(true); } })
      .catch(() => { if (!cancelled) setPrefsLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const sourceType = (preview.source_type || 'note').toLowerCase();
  const isMuted = (chip: ChipMeta): boolean =>
    (prefs[chip.prefKey] || []).includes(sourceType);

  // The bundle the chips actually see — AI suggestions are stripped
  // for any chip the user has muted for this source_type. Keeps the
  // chip empty (with its manual-add CTA) instead of repeating an AI
  // pre-fill the user already rejected once.
  const pickedBundle: SuggestionsBundle = useMemo(() => {
    const out: SuggestionsBundle = { ...effectiveBundle };
    for (const c of CHIPS) {
      if (!isMuted(c)) continue;
      switch (c.key) {
        case 'folder':   out.suggested_folder_hint = ''; break;
        case 'tasks':    out.suggested_tasks = [];       break;
        case 'calendar': out.suggested_event = null;     break;
        case 'habit':    out.suggested_habit_link = null; break;
        case 'revisit':  out.suggested_revisit = null;   break;
        // 'related' has no AI pre-fill — chip lazy-fetches itself.
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBundle, prefs, sourceType]);

  // Serialise PUTs so two rapid "Don't suggest again" clicks on
  // different chips can't race on the server: the backend stores the
  // full prefs doc and last-write-wins, so we await the previous PUT
  // before sending the next. Builds the payload from the *latest*
  // state (via functional read) right before the request so the
  // queued PUT reflects every toggle accumulated so far.
  const writeChainRef = useRef<Promise<unknown>>(Promise.resolve());

  // Toggle "don't suggest" for a chip + source_type and persist the
  // updated prefs. Optimistic — UI updates immediately. Rollback is
  // *granular*: on failure we remove only this specific
  // chip+source_type from the list, leaving any other toggles the
  // user fired in the meantime intact.
  const handleDontSuggest = (chip: ChipMeta) => {
    // Synchronous read via prefsRef — reliable, no React-anti-pattern
    // side effects inside a setState updater. Bails out cleanly when
    // the user re-clicks an already-muted chip.
    const current = prefsRef.current;
    const currentList = current[chip.prefKey] || [];
    if (currentList.includes(sourceType)) return;

    // Optimistic UI update + ref sync so the next handleDontSuggest
    // call (potentially fired before this PUT resolves) sees the
    // accumulated mute set.
    const optimistic: CaptureEnrichmentPrefs = {
      ...current,
      [chip.prefKey]: [...currentList, sourceType],
    };
    prefsRef.current = optimistic;
    setPrefs(optimistic);

    // Chain this PUT after any in-flight one so two rapid toggles on
    // different chips can't race on the server's last-write-wins.
    // Inside the closure we re-read prefsRef so the queued PUT sends
    // every accumulated mute, not just this one.
    writeChainRef.current = writeChainRef.current
      .catch(() => { /* prior failures already rolled back themselves */ })
      .then(async () => {
        const payload = prefsRef.current;
        try {
          const persisted = await setCaptureEnrichmentPrefs(payload);
          // Trust the server's normalised shape; sync ref + state so
          // subsequent toggles read the canonical post-PUT view.
          prefsRef.current = persisted;
          setPrefs(persisted);
        } catch {
          // Granular rollback: drop only this (chip, sourceType) tuple
          // from the list. Any other concurrent toggles stay applied.
          const rolled: CaptureEnrichmentPrefs = {
            ...prefsRef.current,
            [chip.prefKey]: (prefsRef.current[chip.prefKey] || []).filter(s => s !== sourceType),
          };
          prefsRef.current = rolled;
          setPrefs(rolled);
        }
      });
  };

  // Surface the AI badge when any (post-mute) suggestion remains.
  const hasAnySuggestion =
    !!(pickedBundle.suggested_folder_hint && pickedBundle.suggested_folder_hint.trim()) ||
    !!(pickedBundle.suggested_tasks && pickedBundle.suggested_tasks.length > 0) ||
    !!pickedBundle.suggested_event ||
    !!pickedBundle.suggested_habit_link ||
    !!pickedBundle.suggested_revisit;

  const [expanded, setExpanded] = useState<boolean>(true);

  // Which chip's inline editor is open. Null = no editor visible.
  const [activeChip, setActiveChip] = useState<ChipKey | null>(null);

  // Per-chip state. Each chip owns its draft and bubbles changes up
  // via setState so the merged EnrichState stays consistent.
  const [folder, setFolder]     = useState<FolderState | null>(null);
  const [tasks, setTasks]       = useState<TaskRow[]>([]);
  const [related, setRelated]   = useState<string[]>([]);
  const [calendar, setCalendar] = useState<ScheduleEvent | null>(null);
  const [habit, setHabit]       = useState<HabitState | null>(null);
  const [revisit, setRevisit]   = useState<RevisitState | null>(null);

  // Bubble the merged state up whenever any chip changes.
  useEffect(() => {
    onChange({
      folder: folder ?? null,
      tasks,
      related,
      calendar: calendar ?? null,
      habit: habit ?? null,
      revisit: revisit ?? null,
    });
  }, [folder, tasks, related, calendar, habit, revisit, onChange]);

  const handleChipClick = (key: ChipKey) => {
    setActiveChip(prev => (prev === key ? null : key));
  };

  // Short label rendered inside the chip pill — shows what's selected
  // so the user can scan at a glance. Falls back to per-chip empty
  // CTA copy ("Add task", "Schedule reminder", etc) when nothing is
  // selected and no AI suggestion is available (or it was muted).
  const chipSummary = (chip: ChipMeta): string => {
    switch (chip.key) {
      case 'folder':
        if (folder?.kind === 'existing') return folder.folder_name || 'Selected';
        return pickedBundle.suggested_folder_hint || chip.emptyCta;
      case 'tasks':
        if (tasks.length) return `${tasks.length} task${tasks.length === 1 ? '' : 's'}`;
        if (pickedBundle.suggested_tasks?.length) return `${pickedBundle.suggested_tasks.length} suggested`;
        return chip.emptyCta;
      case 'related':
        if (related.length) return `${related.length} linked`;
        return chip.emptyCta;
      case 'calendar': {
        if (calendar?.title) {
          const t = calendar.title;
          return t.length > 22 ? t.slice(0, 22) + '…' : t;
        }
        if (pickedBundle.suggested_event) {
          const t = pickedBundle.suggested_event.title;
          return t.length > 22 ? t.slice(0, 22) + '…' : t;
        }
        return chip.emptyCta;
      }
      case 'habit':
        if (habit?.habit_id) return habit.habit_name || 'Selected';
        if (pickedBundle.suggested_habit_link) return 'AI suggested';
        return chip.emptyCta;
      case 'revisit':
        if (revisit?.frequency) return revisit.frequency.charAt(0).toUpperCase() + revisit.frequency.slice(1);
        if (pickedBundle.suggested_revisit) return pickedBundle.suggested_revisit.frequency;
        return chip.emptyCta;
    }
  };

  const isChipFilled = (key: ChipKey): boolean => {
    switch (key) {
      case 'folder':   return !!folder;
      case 'tasks':    return tasks.length > 0;
      case 'related':  return related.length > 0;
      case 'calendar': return !!calendar;
      case 'habit':    return !!habit?.habit_id;
      case 'revisit':  return !!revisit?.frequency;
      default:         return false;
    }
  };

  const activeMeta: ChipMeta | undefined = activeChip
    ? CHIPS.find(c => c.key === activeChip)
    : undefined;

  return (
    <section
      data-testid="enrich-panel"
      style={{
        borderRadius: 14,
        background: 'linear-gradient(135deg, rgba(167,139,250,0.06), rgba(34,211,238,0.04))',
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        data-testid="button-enrich-toggle"
        aria-expanded={expanded}
        aria-controls="enrich-panel-body"
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          padding: '12px 16px', background: 'transparent', border: 'none',
          cursor: 'pointer', color: 'var(--text-1)', fontFamily: 'inherit',
          textAlign: 'left',
        }}
      >
        <Sparkles size={15} color="#a78bfa" />
        <span style={{ flex: 1, fontWeight: 700, fontSize: 13 }}>
          Enrich &amp; connect
        </span>
        {hasAnySuggestion && !expanded && (
          <span style={{
            fontSize: 10.5, fontWeight: 700, color: '#a78bfa',
            padding: '2px 8px', borderRadius: 999,
            background: 'rgba(167,139,250,0.12)',
            border: '1px solid rgba(167,139,250,0.32)',
            letterSpacing: 0.4, textTransform: 'uppercase',
          }}>
            AI suggestions ready
          </span>
        )}
        {expanded
          ? <ChevronUp size={15} color="var(--text-2)" />
          : <ChevronDown size={15} color="var(--text-2)" />}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="enrich-body"
            id="enrich-panel-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '4px 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {CHIPS.map(c => {
                  const Icon = c.icon;
                  const filled = isChipFilled(c.key);
                  const active = activeChip === c.key;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => handleChipClick(c.key)}
                      data-testid={`chip-${c.key}`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 7,
                        padding: '7px 12px', borderRadius: 999, cursor: 'pointer',
                        background: filled
                          ? `${c.color}20`
                          : active
                            ? 'var(--surface-2)'
                            : 'var(--surface-1)',
                        border: `1px solid ${filled ? c.color + '66' : active ? 'var(--text-2)' : 'var(--border)'}`,
                        color: filled ? c.color : 'var(--text-1)',
                        fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <Icon size={13} color={filled ? c.color : 'var(--text-2)'} />
                      <span style={{ fontWeight: 700 }}>{c.label}</span>
                      <span style={{
                        fontSize: 11, fontWeight: 500,
                        color: filled ? c.color : 'var(--text-2)',
                        maxWidth: 140, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        · {chipSummary(c)}
                      </span>
                    </button>
                  );
                })}
              </div>

              <AnimatePresence mode="wait">
                {/* Gate the editor on prefsLoaded so per-chip auto-seed
                    effects (TasksChip etc) never fire before we know
                    which dimensions are muted — without this gate a
                    chip opened during the brief fetch window would
                    seed from a suggestion the user has muted. */}
                {activeChip && activeMeta && prefsLoaded && (
                  <motion.div
                    key={activeChip}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                    style={{
                      padding: 14, borderRadius: 10,
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    {/* "Don't suggest again" link — only meaningful for
                        chips that have an AI pre-fill dimension, which is
                        every chip except 'related' (it lazy-fetches its
                        own list rather than reading suggested_*). */}
                    {activeMeta.key !== 'related' && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                        {isMuted(activeMeta) ? (
                          <span
                            data-testid={`label-dont-suggest-muted-${activeMeta.key}`}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 5,
                              fontSize: 10.5, fontWeight: 600, color: 'var(--text-3)',
                              padding: '3px 8px', borderRadius: 999,
                              background: 'var(--surface-1)',
                              border: '1px dashed var(--border)',
                            }}
                          >
                            <BellOff size={11} /> AI muted for {sourceType}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleDontSuggest(activeMeta)}
                            data-testid={`button-dont-suggest-${activeMeta.key}`}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 5,
                              fontSize: 10.5, fontWeight: 600, color: 'var(--text-3)',
                              padding: '3px 8px', borderRadius: 999,
                              background: 'transparent',
                              border: '1px solid var(--border)',
                              cursor: 'pointer', fontFamily: 'inherit',
                            }}
                            title={`Stop AI from suggesting ${activeMeta.label.toLowerCase()} on ${sourceType} captures`}
                          >
                            <BellOff size={11} /> Don&apos;t suggest again
                          </button>
                        )}
                      </div>
                    )}

                    {activeChip === 'folder' && (
                      <FolderChip
                        suggestedHint={pickedBundle.suggested_folder_hint || ''}
                        value={folder}
                        onChange={setFolder}
                      />
                    )}
                    {activeChip === 'tasks' && (
                      <TasksChip
                        suggested={pickedBundle.suggested_tasks || []}
                        value={tasks}
                        onChange={setTasks}
                      />
                    )}
                    {activeChip === 'related' && (
                      <RelatedChip
                        text={
                          (preview.title || '') + ' ' +
                          (preview.summary || '')
                        }
                        tags={preview.tags || []}
                        excludeId={preview.id}
                        value={related}
                        onChange={setRelated}
                      />
                    )}
                    {activeChip === 'calendar' && (
                      <ScheduleChip
                        suggested={pickedBundle.suggested_event || null}
                        defaultTitle={preview.title || ''}
                        value={calendar}
                        onChange={setCalendar}
                      />
                    )}
                    {activeChip === 'habit' && (
                      <HabitChip
                        suggested={pickedBundle.suggested_habit_link || null}
                        value={habit}
                        onChange={setHabit}
                      />
                    )}
                    {activeChip === 'revisit' && (
                      <RevisitChip
                        suggested={pickedBundle.suggested_revisit || null}
                        value={revisit}
                        onChange={setRevisit}
                      />
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};

export default EnrichPanel;
