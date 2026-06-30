import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cctv, ExternalLink, ListVideo, RefreshCw, VideoOff } from 'lucide-react';
import { api } from '../../api/client';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { CameraTile } from './CameraTile';
import { EventsList } from './EventsList';
import type { SurveillanceStatus } from './types';

const STATUS_REFETCH_MS = 15_000;
const CAMERA_REFRESH_MS = 1_500;

export function Surveillance() {
  const statusQ = useQuery({
    queryKey: ['surveillance', 'status'],
    queryFn: () => api.get<SurveillanceStatus>('/surveillance/status'),
    refetchInterval: STATUS_REFETCH_MS,
    retry: false,
  });

  // Shared clock that cache-busts every camera <img> on one interval.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), CAMERA_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const status = statusQ.data;
  const cameras = status?.cameras ?? [];

  const openFrigate = status?.ui ? (
    <a className="btn-secondary" href={status.ui} target="_blank" rel="noreferrer">
      <ExternalLink className="h-4 w-4" /> Open Frigate
    </a>
  ) : null;

  if (statusQ.isLoading) {
    return (
      <div>
        <PageHeader title="Surveillance" description="Live cameras and detections via Frigate" />
        <LoadingState label="Contacting Frigate…" />
      </div>
    );
  }

  if (statusQ.isError) {
    return (
      <div>
        <PageHeader title="Surveillance" description="Live cameras and detections via Frigate" />
        <ErrorState error={statusQ.error} onRetry={() => statusQ.refetch()} />
      </div>
    );
  }

  if (!status?.available) {
    return (
      <div>
        <PageHeader title="Surveillance" description="Live cameras and detections via Frigate" />
        <EmptyState
          icon={VideoOff}
          title="Frigate unavailable"
          message="Frigate isn't responding. LXC 100 (“frigate”) is likely stopped — start it to see live cameras and detections."
          action={openFrigate ?? undefined}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Surveillance"
        description={`Live cameras and detections via Frigate${status.version ? ` v${status.version}` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            {openFrigate}
            <button type="button" className="btn-secondary" onClick={() => statusQ.refetch()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
          </div>
        }
      />

      <div className="flex flex-col gap-px">
        {/* Camera grid */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
            <Cctv className="h-4 w-4" aria-hidden /> Cameras
          </h2>
          {cameras.length === 0 ? (
            <EmptyState
              icon={Cctv}
              title="No cameras configured"
              message="Frigate is running but no cameras are defined in its config."
            />
          ) : (
            <div className="grid gap-px sm:grid-cols-2 lg:grid-cols-3">
              {cameras.map((name) => (
                <CameraTile key={name} name={name} tick={tick} />
              ))}
            </div>
          )}
        </section>

        {/* Recent detections */}
        <section className="mt-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
            <ListVideo className="h-4 w-4" aria-hidden /> Recent detections
          </h2>
          <EventsList />
        </section>
      </div>
    </div>
  );
}
