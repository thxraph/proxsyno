import { useState } from 'react';
import { CameraOff, Video } from 'lucide-react';
import { cx } from '../../lib/format';

/**
 * One live camera. Frigate's /latest.jpg is a still snapshot, so we poll it by
 * cache-busting the <img> src with a shared `tick` (bumped ~every 1.5s by the
 * grid). Same-origin requests carry the session cookie automatically, so the
 * authenticated proxy is reached without any extra wiring.
 */
export function CameraTile({ name, tick }: { name: string; tick: number }) {
  const [errored, setErrored] = useState(false);
  // h=360 asks the proxy/Frigate for a tile-sized snapshot instead of full-res.
  const src = `/api/surveillance/camera/${encodeURIComponent(name)}/latest.jpg?h=360&t=${tick}`;

  return (
    <div className="card overflow-hidden">
      <div className="relative aspect-video bg-zinc-950">
        {/* Keep the <img> mounted even while errored so each `tick` retries the
            snapshot and onLoad can clear the error; the placeholder overlays it. */}
        <img
          src={src}
          alt={`${name} live snapshot`}
          className={cx('h-full w-full object-contain', errored && 'invisible')}
          onError={() => setErrored(true)}
          onLoad={() => errored && setErrored(false)}
        />
        {errored && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-zinc-600">
            <CameraOff className="h-6 w-6" aria-hidden />
            <span className="text-xs">No image</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        <Video className="h-3.5 w-3.5 text-orange-400" aria-hidden />
        <span className="truncate text-sm font-medium text-zinc-100">{name}</span>
      </div>
    </div>
  );
}
