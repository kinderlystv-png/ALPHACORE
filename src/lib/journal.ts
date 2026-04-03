import { lsGet, lsSet, uid } from "./storage";

export type JournalAuthor = "user" | "assistant";

export type JournalEntry = {
  id: string;
  author: JournalAuthor;
  text: string;
  tags: string[];
  createdAt: string;
};

const KEY = "alphacore_journal";

function sortEntries(entries: JournalEntry[]): JournalEntry[] {
  return [...entries].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

function buildSeedEntries(): JournalEntry[] {
  const now = Date.now();

  return sortEntries([
    {
      id: uid(),
      author: "user",
      text:
        "Спал 7 часов. Утреннюю рутину делать не хочется. Нужно ехать на студию и убираться.",
      tags: ["sleep", "mood", "studio", "cleanup"],
      createdAt: new Date(now - 5 * 60_000).toISOString(),
    },
    {
      id: uid(),
      author: "assistant",
      text:
        "Зафиксировал новые правила: с 1 апреля без уборщицы, поэтому после каждого праздника нужна уборка на следующий день. Если утром уже стоит праздник после вечернего — уборка идёт окном 06:00–09:00. Вокруг каждого праздника держим семейный буфер за час до и через час после; по средам с вечерним праздником добавляем логистику с Даней к бабушке перед репетицией.",
      tags: ["ops", "schedule", "family", "cleanup"],
      createdAt: new Date(now - 2 * 60_000).toISOString(),
    },
  ]);
}

export function getJournalEntries(): JournalEntry[] {
  const entries = lsGet<JournalEntry[] | null>(KEY, null);
  return entries ? sortEntries(entries) : buildSeedEntries();
}

export function ensureJournalSeed(): JournalEntry[] {
  const entries = lsGet<JournalEntry[] | null>(KEY, null);
  if (entries) return sortEntries(entries);

  const seed = buildSeedEntries();
  lsSet(KEY, seed);
  return seed;
}

function save(entries: JournalEntry[]): void {
  lsSet(KEY, sortEntries(entries));
}

export function addJournalEntry(
  author: JournalAuthor,
  text: string,
  tags: string[] = [],
): JournalEntry {
  const entry: JournalEntry = {
    id: uid(),
    author,
    text: text.trim(),
    tags: tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean),
    createdAt: new Date().toISOString(),
  };

  save([...getJournalEntries(), entry]);
  return entry;
}

export function deleteJournalEntry(id: string): void {
  save(getJournalEntries().filter((entry) => entry.id !== id));
}

export function latestJournalEntries(limit = 3): JournalEntry[] {
  return getJournalEntries().slice(-limit);
}
