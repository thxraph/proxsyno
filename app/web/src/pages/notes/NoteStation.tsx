import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Book,
  ChevronLeft,
  FileText,
  NotebookPen,
  Plus,
  Search,
  StickyNote,
} from 'lucide-react';
import { api } from '../../api/client';
import { cx, formatDate } from '../../lib/format';
import { useIsMobile } from '../../hooks/useIsMobile';
import { ErrorState, LoadingState } from '../../components/states';
import { NoteEditor } from './NoteEditor';
import type { Note, NotesIndex, NoteSummary } from './types';

// `null` selects the "All Notes" pseudo-notebook — collision-proof, since a real
// notebook name is always a string.
export function NoteStation() {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const [search, setSearch] = useState('');
  const [notebook, setNotebook] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const q = search.trim();
  const indexQ = useQuery({
    queryKey: ['notes', q],
    queryFn: () => api.get<NotesIndex>(`/notes${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  });

  const noteQ = useQuery({
    queryKey: ['note', selectedId],
    queryFn: () => api.get<Note>(`/notes/${selectedId}`),
    enabled: !!selectedId,
  });

  const createMut = useMutation({
    mutationFn: () =>
      api.post<Note>('/notes', {
        title: 'Untitled',
        notebook: notebook ?? undefined,
        body: '',
      }),
    onSuccess: (note) => {
      qc.invalidateQueries({ queryKey: ['notes'] });
      setSelectedId(note.id);
    },
  });

  const notebooks = indexQ.data?.notebooks ?? [];
  const allNotes = indexQ.data?.notes ?? [];
  const notes = useMemo(
    () => (notebook === null ? allNotes : allNotes.filter((n) => n.notebook === notebook)),
    [allNotes, notebook],
  );

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of allNotes) map.set(n.notebook, (map.get(n.notebook) ?? 0) + 1);
    return map;
  }, [allNotes]);

  return (
    <div className="flex h-full min-h-0 gap-px text-sm">
      {/* Pane 1 — notebooks (hidden on mobile; filter moves into the list pane) */}
      <div className={cx('card w-48 shrink-0 flex-col', isMobile ? 'hidden' : 'flex')}>
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2.5 text-zinc-300">
          <NotebookPen className="h-4 w-4 text-orange-400" aria-hidden />
          <span className="font-semibold">Notebooks</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          <NotebookItem
            icon={StickyNote}
            label="All Notes"
            count={allNotes.length}
            active={notebook === null}
            onClick={() => setNotebook(null)}
          />
          {notebooks.map((nb) => (
            <NotebookItem
              key={nb}
              icon={Book}
              label={nb}
              count={counts.get(nb) ?? 0}
              active={notebook === nb}
              onClick={() => setNotebook(nb)}
            />
          ))}
        </div>
      </div>

      {/* Pane 2 — notes list (full-width on mobile; hidden once a note opens) */}
      <div
        className={cx(
          'card',
          isMobile
            ? selectedId
              ? 'hidden'
              : 'flex w-full flex-1 flex-col'
            : 'flex w-64 shrink-0 flex-col',
        )}
      >
        <div className="flex items-center gap-2 border-b border-zinc-800 p-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-2">
            <Search className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
            <input
              className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notes…"
            />
          </div>
          <button
            className="btn-primary h-8 w-8 shrink-0 p-0"
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending}
            title="New note"
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Mobile notebook filter (replaces the hidden sidebar). */}
        {isMobile && (
          <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-zinc-800 p-2">
            {[{ key: null, label: 'All' }, ...notebooks.map((nb) => ({ key: nb, label: nb }))].map(
              (c) => (
                <button
                  key={c.key ?? '__all__'}
                  type="button"
                  onClick={() => setNotebook(c.key)}
                  className={cx(
                    'shrink-0 rounded-full px-3 py-1 text-xs transition-colors',
                    notebook === c.key
                      ? 'bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/40'
                      : 'bg-zinc-800 text-zinc-300',
                  )}
                >
                  {c.label}
                </button>
              ),
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {indexQ.isLoading ? (
            <LoadingState label="Loading notes…" />
          ) : indexQ.isError ? (
            <ErrorState error={indexQ.error} onRetry={() => indexQ.refetch()} />
          ) : notes.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center text-zinc-500">
              <FileText className="h-6 w-6" aria-hidden />
              <p className="text-xs">{q ? 'No matching notes.' : 'No notes yet.'}</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-px p-1.5">
              {notes.map((n) => (
                <NoteListItem
                  key={n.id}
                  note={n}
                  showNotebook={notebook === null}
                  active={n.id === selectedId}
                  onClick={() => setSelectedId(n.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Pane 3 — editor (full-screen on mobile; hidden until a note opens) */}
      <div
        className={cx(
          'card min-w-0',
          isMobile
            ? selectedId
              ? 'flex w-full flex-1 flex-col'
              : 'hidden'
            : 'flex flex-1 flex-col',
        )}
      >
        {isMobile && selectedId && (
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="flex h-11 shrink-0 items-center gap-1 border-b border-zinc-800 px-2 text-sm text-zinc-300 active:bg-zinc-800"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden /> Notes
          </button>
        )}
        {!selectedId ? (
          <EmptyEditor />
        ) : noteQ.isLoading ? (
          <LoadingState label="Opening note…" />
        ) : noteQ.isError ? (
          <ErrorState error={noteQ.error} onRetry={() => noteQ.refetch()} />
        ) : noteQ.data ? (
          <NoteEditor
            key={noteQ.data.id}
            note={noteQ.data}
            onSaved={() => qc.invalidateQueries({ queryKey: ['notes'] })}
            onDeleted={() => setSelectedId(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

function NotebookItem({
  icon: Icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: typeof Book;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
        active ? 'bg-orange-500/15 text-orange-300' : 'text-zinc-300 hover:bg-zinc-800',
      )}
    >
      <Icon className={cx('h-4 w-4 shrink-0', active ? 'text-orange-400' : 'text-zinc-500')} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-xs tabular-nums text-zinc-500">{count}</span>
    </button>
  );
}

function NoteListItem({
  note,
  showNotebook,
  active,
  onClick,
}: {
  note: NoteSummary;
  showNotebook: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cx(
          'w-full rounded-lg px-2.5 py-2 text-left transition-colors',
          active ? 'bg-orange-500/15' : 'hover:bg-zinc-800',
        )}
      >
        <div className={cx('truncate font-medium', active ? 'text-orange-200' : 'text-zinc-100')}>
          {note.title || 'Untitled'}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
          {showNotebook && <span className="truncate">{note.notebook}</span>}
          {showNotebook && <span aria-hidden>·</span>}
          <span className="shrink-0">{formatDate(note.updatedAt)}</span>
        </div>
        {note.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {note.tags.slice(0, 4).map((t) => (
              <span
                key={t}
                className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </button>
    </li>
  );
}

function EmptyEditor() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-zinc-500">
      <StickyNote className="h-8 w-8" aria-hidden />
      <p className="text-sm">Select a note, or create a new one.</p>
    </div>
  );
}
