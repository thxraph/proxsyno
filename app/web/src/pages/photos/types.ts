// Local Photos contract. The shared lib/types.ts is owned by the orchestrator,
// so the gallery shapes live here next to the page that consumes them. Mirrors
// services/photos.ts on the backend.
export type MediaKind = 'image' | 'video';

export interface MediaItem {
  name: string;
  path: string; // absolute path inside the jail
  sizeBytes: number;
  mtimeMs: number;
  kind: MediaKind;
}

export interface MediaFolder {
  name: string;
  path: string;
}

export interface MediaListing {
  path: string;
  hasThumbnailer: boolean;
  folders: MediaFolder[];
  items: MediaItem[];
}
