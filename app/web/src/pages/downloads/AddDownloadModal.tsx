import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link2 } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import { Modal } from '../../components/Modal';
import { FormField } from '../../components/FormField';
import { DestinationPicker } from './DestinationPicker';
import type { DownloadCapabilities, DownloadJob } from './types';

const URL_RE = /^(https?|magnet):/i;

export function AddDownloadModal({
  capabilities,
  onClose,
}: {
  capabilities?: DownloadCapabilities;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [dest, setDest] = useState('/mnt');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (body: { url: string; dest: string }) =>
      api.post<DownloadJob>('/downloads', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['downloads'] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to add download'),
  });

  const onSubmit = () => {
    setError(null);
    const trimmed = url.trim();
    if (!URL_RE.test(trimmed)) {
      setError('Enter an http(s) or magnet URL.');
      return;
    }
    if (trimmed.toLowerCase().startsWith('magnet:') && capabilities && !capabilities.magnet) {
      setError('Magnet links require aria2c, which is not installed on this host.');
      return;
    }
    mut.mutate({ url: trimmed, dest });
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={
        <span className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-accent-400" aria-hidden /> Add download
        </span>
      }
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </button>
          <button className="btn-primary" onClick={onSubmit} disabled={mut.isPending}>
            {mut.isPending ? 'Adding…' : 'Add download'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-400">{error}</div>
      )}

      <FormField
        label="URL"
        required
        hint={
          capabilities?.magnet
            ? 'http(s), magnet or .torrent URLs are supported.'
            : 'http(s) URLs. Magnet/torrent need aria2c (not installed).'
        }
      >
        <input
          className="input"
          value={url}
          autoFocus
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
          placeholder="https://example.com/file.iso"
        />
      </FormField>

      <FormField label="Destination folder" required>
        <DestinationPicker value={dest} onChange={setDest} />
      </FormField>
    </Modal>
  );
}
