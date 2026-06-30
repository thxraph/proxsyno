import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ImageOff, Inbox } from 'lucide-react';
import { api } from '../../api/client';
import { Badge } from '../../components/Badge';
import { Modal } from '../../components/Modal';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { formatDate } from '../../lib/format';
import type { FrigateEvent } from './types';

const EVENTS_REFETCH_MS = 10_000;

function EventThumb({ event }: { event: FrigateEvent }) {
  const [errored, setErrored] = useState(false);
  if (errored || !event.has_snapshot) {
    return (
      <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-lg bg-zinc-950 text-zinc-600">
        <ImageOff className="h-5 w-5" aria-hidden />
      </div>
    );
  }
  return (
    <img
      src={`/api/surveillance/event/${encodeURIComponent(event.id)}/thumbnail.jpg`}
      alt={`${event.label} on ${event.camera}`}
      className="h-16 w-24 shrink-0 rounded-lg bg-zinc-950 object-cover"
      onError={() => setErrored(true)}
    />
  );
}

export function EventsList() {
  const [active, setActive] = useState<FrigateEvent | null>(null);
  const eventsQ = useQuery({
    queryKey: ['surveillance', 'events'],
    queryFn: () => api.get<FrigateEvent[]>('/surveillance/events?limit=50'),
    refetchInterval: EVENTS_REFETCH_MS,
    retry: false,
  });

  if (eventsQ.isLoading) return <LoadingState label="Loading detections…" />;
  if (eventsQ.isError) return <ErrorState error={eventsQ.error} onRetry={() => eventsQ.refetch()} />;

  const events = eventsQ.data ?? [];
  if (events.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No recent detections"
        message="Frigate hasn't recorded any events yet."
      />
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-px">
        {events.map((ev) => (
          <li key={ev.id}>
            <button
              type="button"
              onClick={() => ev.has_snapshot && setActive(ev)}
              className="flex w-full items-center gap-3 bg-zinc-900 p-2 text-left first:rounded-t-xl last:rounded-b-xl hover:bg-zinc-800/60"
            >
              <EventThumb event={ev} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium capitalize text-zinc-100">
                    {ev.label}
                    {ev.sub_label ? ` · ${ev.sub_label}` : ''}
                  </span>
                  <Badge tone="neutral">{ev.camera}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">{formatDate(ev.start_time * 1000)}</p>
              </div>
            </button>
          </li>
        ))}
      </ul>

      <Modal
        open={active !== null}
        onClose={() => setActive(null)}
        size="lg"
        title={active ? `${active.label} · ${active.camera}` : ''}
      >
        {active && (
          <div className="flex flex-col gap-2">
            <img
              src={`/api/surveillance/event/${encodeURIComponent(active.id)}/snapshot.jpg`}
              alt={`${active.label} snapshot`}
              className="w-full rounded-lg bg-zinc-950 object-contain"
            />
            <p className="text-xs text-zinc-500">{formatDate(active.start_time * 1000)}</p>
          </div>
        )}
      </Modal>
    </>
  );
}
