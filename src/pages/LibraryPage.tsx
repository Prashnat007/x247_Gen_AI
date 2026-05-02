import React, { lazy, useEffect, useState } from 'react';
import { Library, Database, StickyNote, Bookmark, FileText, Inbox, CheckSquare, Flame, FlipHorizontal, Bell, Tag, Trash2 } from 'lucide-react';
import TabbedPage from '../components/TabbedPage';

const VaultPage = lazy(() => import('./VaultPage'));
const NotesPage = lazy(() => import('./NotesPage'));
const BookmarksPage = lazy(() => import('./BookmarksPage'));
const TasksPage = lazy(() => import('./TasksPage'));
const HabitsPage = lazy(() => import('./HabitsPage'));
const FlashcardsPage = lazy(() => import('./FlashcardsPage'));
const RevisitsPage = lazy(() => import('./RevisitsPage'));
const LibraryInboxTab = lazy(() => import('../components/LibraryInboxTab'));
const TrashPage = lazy(() => import('./TrashPage'));
const TagsManagerPage = lazy(() => import('./TagsManagerPage'));

type LibraryCounts = {
  vault?: number;
  notes?: number;
  bookmarks?: number;
  files?: number;
  inbox?: number;
  tags?: number;
  tasks?: number;
  habits?: number;
  revisits?: number;
  trash?: number;
};

const LibraryPage: React.FC = () => {
  const [counts, setCounts] = useState<LibraryCounts>({});

  // Fetch tab counts once on mount + refresh whenever the inbox-count
  // refresh event fires (capture / review actions broadcast it). Cheap
  // single round-trip via /library/counts so we don't fan out 9 fetches.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/library/counts');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data && typeof data === 'object') {
          setCounts(data as LibraryCounts);
        }
      } catch {
        // Silent — badges just stay hidden if the count fetch fails;
        // nothing functional depends on them.
      }
    };
    load();
    const onRefresh = () => { void load(); };
    window.addEventListener('inbox-count-refresh', onRefresh);
    // Light polling so badges stay roughly fresh while the user works
    // inside the Library tabs (creating/deleting items in sub-tabs
    // doesn't always fire the refresh event).
    const interval = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.removeEventListener('inbox-count-refresh', onRefresh);
      window.clearInterval(interval);
    };
  }, []);

  return (
    <TabbedPage
      icon={Library}
      iconColor="#f472b6"
      iconBg="rgba(244,114,182,0.15)"
      title="Library"
      subtitle="Vault, notes, bookmarks, files, inbox, tasks, habits, flashcards & revisits — your full second brain in one place"
      hub="library"
      paramKey="tab"
      defaultTab="vault"
      tabs={[
        { id: 'vault',      label: 'Vault',      icon: Database,        badge: counts.vault,     render: () => <VaultPage embedded storageKey="recall:library:vault" /> },
        { id: 'notes',      label: 'Notes',      icon: StickyNote,      badge: counts.notes,     render: () => <NotesPage embedded /> },
        { id: 'bookmarks',  label: 'Bookmarks',  icon: Bookmark,        badge: counts.bookmarks, render: () => <BookmarksPage embedded /> },
        { id: 'files',      label: 'Files',      icon: FileText,        badge: counts.files,     render: () => <VaultPage embedded initialSourceFilter="pdf" storageKey="recall:library:files" /> },
        // Inbox is the only tab marked `urgent` — it carries the same
        // red "needs review" treatment the sidebar Library card uses,
        // so when the user clicks Library (red dot in the dock) they
        // immediately see WHICH tab inside Library wants attention.
        // Tooltip text mirrors the sidebar wording for consistency.
        {
          id: 'inbox', label: 'Inbox', icon: Inbox,
          badge: counts.inbox,
          urgent: (counts.inbox ?? 0) > 0,
          badgeTitle: counts.inbox
            ? `${counts.inbox} item${counts.inbox === 1 ? '' : 's'} waiting in your Inbox — click to review`
            : undefined,
          render: () => <LibraryInboxTab />,
        },
        { id: 'tags',       label: 'Tags',       icon: Tag,             badge: counts.tags,      render: () => <TagsManagerPage /> },
        { id: 'tasks',      label: 'Tasks',      icon: CheckSquare,     badge: counts.tasks,     render: () => <TasksPage embedded /> },
        { id: 'habits',     label: 'Habits',     icon: Flame,           badge: counts.habits,    render: () => <HabitsPage embedded /> },
        { id: 'flashcards', label: 'Flashcards', icon: FlipHorizontal,                          render: () => <FlashcardsPage embedded /> },
        { id: 'revisits',   label: 'Revisits',   icon: Bell,            badge: counts.revisits,  render: () => <RevisitsPage embedded /> },
        { id: 'trash',      label: 'Trash',      icon: Trash2,          badge: counts.trash,     render: () => <TrashPage /> },
      ]}
    />
  );
};

export default LibraryPage;
