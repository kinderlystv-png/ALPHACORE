import { lsGet, lsSet, uid } from "./storage";
import { validateTitle, validateBody, validateTags } from "./validation";

/* ── Types ── */

export type Note = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};

const KEY = "alphacore_notes";

export function getNotes(): Note[] {
  return lsGet<Note[]>(KEY, []);
}

function save(notes: Note[]): void {
  lsSet(KEY, notes);
}

export function addNote(title: string, body: string, tags: string[] = []): Note {
  const notes = getNotes();
  const now = new Date().toISOString();
  const n: Note = { id: uid(), title: validateTitle(title), body: validateBody(body), tags: validateTags(tags), pinned: false, createdAt: now, updatedAt: now };
  notes.unshift(n);
  save(notes);
  return n;
}

export function updateNote(id: string, patch: Partial<Pick<Note, "title" | "body" | "tags" | "pinned">>): void {
  const sanitized = { ...patch };
  if (sanitized.title !== undefined) sanitized.title = validateTitle(sanitized.title);
  if (sanitized.body !== undefined) sanitized.body = validateBody(sanitized.body);
  if (sanitized.tags !== undefined) sanitized.tags = validateTags(sanitized.tags);
  const notes = getNotes().map((n) =>
    n.id === id ? { ...n, ...sanitized, updatedAt: new Date().toISOString() } : n,
  );
  save(notes);
}

export function deleteNote(id: string): void {
  save(getNotes().filter((n) => n.id !== id));
}

export function togglePin(id: string): void {
  const notes = getNotes();
  const n = notes.find((x) => x.id === id);
  if (n) n.pinned = !n.pinned;
  save(notes);
}
