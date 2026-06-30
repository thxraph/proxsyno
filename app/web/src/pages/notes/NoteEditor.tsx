import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Columns2, Eye, Pencil, Save, Tag, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import { cx } from '../../lib/format';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { MARKDOWN_CSS, renderMarkdown } from './markdown';
import type { Note } from './types';

type ViewMode = 'edit' | 'split' | 'preview';

function tagsToText(tags: string[]): string {
  return tags.join(', ');
}
function textToTags(text: string): string[] {
  return [...new Set(text.split(',').map((t) => t.trim()).filter(Boolean))].slice(0, 64);
}

export function NoteEditor({
  note,
  onSaved,
  onDeleted,
}: {
  note: Note;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(note.title);
  const [notebook, setNotebook] = useState(note.notebook);
  const [tagsText, setTagsText] = useState(tagsToText(note.tags));
  const [body, setBody] = useState(note.body);
  const [view, setView] = useState<ViewMode>('split');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tags = textToTags(tagsText);
  const dirty =
    title !== note.title ||
    notebook.trim() !== note.notebook ||
    body !== note.body ||
    tagsToText(tags) !== tagsToText(note.tags);

  const preview = useMemo(() => renderMarkdown(body), [body]);

  const saveMut = useMutation({
    mutationFn: () =>
      api.put<Note>(`/notes/${note.id}`, {
        title: title.trim() || 'Untitled',
        notebook: notebook.trim() || 'My Notebook',
        body,
        tags,
      }),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: ['note', note.id] });
      onSaved();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to save note'),
  });

  const delMut = useMutation({
    mutationFn: () => api.del<void>(`/notes/${note.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes'] });
      setConfirmDelete(false);
      onDeleted();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to delete note'),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <input
          className="min-w-0 flex-1 bg-transparent text-base font-semibold text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled"
        />
        <Segmented view={view} onChange={setView} />
        <button
          className="btn-primary h-8 px-3 py-0"
          onClick={() => saveMut.mutate()}
          disabled={!dirty || saveMut.isPending}
          title={dirty ? 'Save changes' : 'No unsaved changes'}
        >
          <Save className="h-4 w-4" aria-hidden /> {saveMut.isPending ? 'Saving…' : 'Save'}
        </button>
        <button
          className="btn-ghost h-8 w-8 p-0 text-rose-400 hover:bg-rose-500/10"
          onClick={() => setConfirmDelete(true)}
          title="Delete note"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/* Meta row */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <input
          className="input h-8 w-44 py-0"
          value={notebook}
          onChange={(e) => setNotebook(e.target.value)}
          placeholder="Notebook"
        />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Tag className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
          <input
            className="input h-8 min-w-0 flex-1 py-0"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="tags, comma, separated"
          />
        </div>
      </div>

      {error && (
        <div className="shrink-0 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{error}</div>
      )}

      {/* Editor / preview */}
      <div className="flex min-h-0 flex-1">
        {view !== 'preview' && (
          <textarea
            className={cx(
              'min-h-0 resize-none bg-zinc-950 p-3 font-mono text-sm leading-relaxed text-zinc-100 focus:outline-none',
              view === 'split' ? 'w-1/2 border-r border-zinc-800' : 'w-full',
            )}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write in markdown…"
            spellCheck={false}
          />
        )}
        {view !== 'edit' && (
          <div className={cx('min-h-0 overflow-auto', view === 'split' ? 'w-1/2' : 'w-full')}>
            <style>{MARKDOWN_CSS}</style>
            <div className="markdown p-4" dangerouslySetInnerHTML={{ __html: preview }} />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete note"
        message={
          <p>
            Delete <strong>{note.title || 'Untitled'}</strong>? This cannot be undone.
          </p>
        }
        confirmLabel="Delete"
        busy={delMut.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => delMut.mutate()}
      />
    </div>
  );
}

function Segmented({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  const opts: { key: ViewMode; icon: typeof Pencil; label: string }[] = [
    { key: 'edit', icon: Pencil, label: 'Edit' },
    { key: 'split', icon: Columns2, label: 'Split' },
    { key: 'preview', icon: Eye, label: 'Preview' },
  ];
  return (
    <div className="flex shrink-0 overflow-hidden rounded-lg border border-zinc-800">
      {opts.map((o) => {
        const Icon = o.icon;
        const active = view === o.key;
        return (
          <button
            key={o.key}
            type="button"
            title={o.label}
            onClick={() => onChange(o.key)}
            className={cx(
              'flex h-8 w-8 items-center justify-center transition-colors',
              active ? 'bg-orange-500 text-white' : 'text-zinc-400 hover:bg-zinc-800',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
