// Local Note Station shapes (mirror app/server/src/services/notes.ts). Kept here
// rather than in the shared lib/types.ts since Note Station owns this contract.

export interface NoteSummary {
  id: string;
  title: string;
  notebook: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Note extends NoteSummary {
  body: string;
}

export interface NotesIndex {
  notebooks: string[];
  notes: NoteSummary[];
}
