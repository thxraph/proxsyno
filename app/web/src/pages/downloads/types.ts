// Download Station shapes — mirrors services/downloads.ts on the backend.
// (lib/types.ts is owned by the orchestrator and not edited here.)

export type DownloadStatus = 'queued' | 'active' | 'paused' | 'done' | 'error';
export type DownloadAction = 'pause' | 'resume' | 'cancel';

export interface DownloadJob {
  id: string;
  url: string;
  dest: string;
  filename: string | null;
  status: DownloadStatus;
  bytesTotal: number;
  bytesDone: number;
  speed: number;
  error: string | null;
  createdAt: number;
  engine: 'aria2' | 'wget';
}

export interface DownloadCapabilities {
  engine: 'aria2' | 'wget';
  magnet: boolean;
}
