// Shapes returned by the backend Surveillance proxy (/api/surveillance/*).
// Kept local to this feature since app/web/src/lib/types.ts is owned elsewhere.

export interface SurveillanceStatus {
  available: boolean;
  version?: string;
  cameras?: string[];
  /** Base URL of the Frigate web UI (for an "open Frigate" link). */
  ui: string;
}

// A subset of a Frigate event (GET /api/events). Times are epoch seconds.
export interface FrigateEvent {
  id: string;
  camera: string;
  label: string;
  sub_label?: string | null;
  start_time: number;
  end_time: number | null;
  has_snapshot: boolean;
  has_clip: boolean;
  zones?: string[];
}
