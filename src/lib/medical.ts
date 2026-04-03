import { lsGet, lsSet, uid } from "./storage";

/* ── Types ── */

export type MedCategory = "blood" | "ultrasound" | "other";

export type MedParam = {
  name: string;
  value: number;
  unit: string;
  refMin?: number;
  refMax?: number;
};

export type MedEntry = {
  id: string;
  date: string; // YYYY-MM-DD
  category: MedCategory;
  name: string; // e.g. "Общий анализ крови"
  params: MedParam[];
  notes: string;
  createdAt: string;
};

const KEY = "alphacore_medical";

/* ── CRUD ── */

export function getEntries(): MedEntry[] {
  return lsGet<MedEntry[]>(KEY, []);
}

function save(entries: MedEntry[]): void {
  lsSet(KEY, entries);
}

export function addEntry(
  date: string,
  category: MedCategory,
  name: string,
  params: MedParam[],
  notes: string,
): MedEntry {
  const entries = getEntries();
  const e: MedEntry = {
    id: uid(),
    date,
    category,
    name,
    params,
    notes,
    createdAt: new Date().toISOString(),
  };
  entries.unshift(e);
  save(entries);
  return e;
}

export function updateEntry(id: string, patch: Partial<Pick<MedEntry, "date" | "category" | "name" | "params" | "notes">>): void {
  const entries = getEntries().map((e) =>
    e.id === id ? { ...e, ...patch } : e,
  );
  save(entries);
}

export function deleteEntry(id: string): void {
  save(getEntries().filter((e) => e.id !== id));
}

/* ── Helpers ── */

export const CATEGORY_LABELS: Record<MedCategory, string> = {
  blood: "Кровь",
  ultrasound: "УЗИ",
  other: "Другое",
};

export const CATEGORY_ICONS: Record<MedCategory, string> = {
  blood: "🩸",
  ultrasound: "📡",
  other: "🔬",
};

/** Status of a parameter relative to its reference range */
export function paramStatus(p: MedParam): "low" | "normal" | "high" | "unknown" {
  if (p.refMin == null && p.refMax == null) return "unknown";
  if (p.refMin != null && p.value < p.refMin) return "low";
  if (p.refMax != null && p.value > p.refMax) return "high";
  return "normal";
}

/** Get all values of a named parameter across entries, sorted by date */
export function paramHistory(paramName: string): { date: string; value: number; refMin?: number; refMax?: number }[] {
  return getEntries()
    .flatMap((e) =>
      e.params
        .filter((p) => p.name === paramName)
        .map((p) => ({ date: e.date, value: p.value, refMin: p.refMin, refMax: p.refMax })),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Get all unique parameter names across all entries */
export function allParamNames(): string[] {
  const set = new Set<string>();
  for (const e of getEntries()) {
    for (const p of e.params) set.add(p.name);
  }
  return [...set].sort();
}

/** Common blood test presets */
export const BLOOD_PRESETS: { name: string; unit: string; refMin: number; refMax: number }[] = [
  { name: "Гемоглобин", unit: "г/л", refMin: 120, refMax: 160 },
  { name: "Эритроциты", unit: "×10¹²/л", refMin: 3.9, refMax: 5.5 },
  { name: "Лейкоциты", unit: "×10⁹/л", refMin: 4.0, refMax: 9.0 },
  { name: "Тромбоциты", unit: "×10⁹/л", refMin: 150, refMax: 400 },
  { name: "СОЭ", unit: "мм/ч", refMin: 1, refMax: 15 },
  { name: "Глюкоза", unit: "ммоль/л", refMin: 3.9, refMax: 6.1 },
  { name: "Холестерин", unit: "ммоль/л", refMin: 3.0, refMax: 5.2 },
  { name: "Билирубин общий", unit: "мкмоль/л", refMin: 3.4, refMax: 20.5 },
  { name: "АЛТ", unit: "Ед/л", refMin: 0, refMax: 41 },
  { name: "АСТ", unit: "Ед/л", refMin: 0, refMax: 40 },
  { name: "Креатинин", unit: "мкмоль/л", refMin: 62, refMax: 106 },
  { name: "Мочевая кислота", unit: "мкмоль/л", refMin: 202, refMax: 416 },
  { name: "Железо", unit: "мкмоль/л", refMin: 11.6, refMax: 31.3 },
  { name: "Ферритин", unit: "нг/мл", refMin: 20, refMax: 250 },
  { name: "Витамин D", unit: "нг/мл", refMin: 30, refMax: 100 },
  { name: "ТТГ", unit: "мМЕ/л", refMin: 0.4, refMax: 4.0 },
];
