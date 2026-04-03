import { lsGet, lsSet } from "./storage";

export type HabitCategory = "health" | "work" | "personal";

export type Habit = {
  id: string;
  name: string;
  emoji: string;
  frequency: "daily" | "custom";
  /** Active days: 0 = Sun, 1 = Mon, ..., 6 = Sat */
  days?: number[];
  category: HabitCategory;
};

export const DEFAULT_HABITS: Habit[] = [
  { id: "sleep", name: "Сон до 00:00", emoji: "🌙", frequency: "daily", category: "health" },
  { id: "run", name: "Бег 60 мин", emoji: "🏃", frequency: "custom", days: [1, 2, 5, 6], category: "health" },
  { id: "stretch", name: "Растяжка", emoji: "🧘", frequency: "daily", category: "health" },
  { id: "projects_upd", name: "Апдейт проектов", emoji: "📊", frequency: "custom", days: [1, 4], category: "work" },
  { id: "review", name: "Weekly review", emoji: "📋", frequency: "custom", days: [5], category: "work" },
  { id: "drums", name: "Барабаны", emoji: "🥁", frequency: "custom", days: [3], category: "personal" },
];

const KEY = "alphacore_habits";

function ds(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function sk(id: string, date: string): string {
  return `${id}:${date}`;
}

function load(): Record<string, boolean> {
  return lsGet<Record<string, boolean>>(KEY, {});
}

function save(log: Record<string, boolean>): void {
  lsSet(KEY, log);
}

export function todayStr(): string {
  return ds(new Date());
}

export function isActiveOn(h: Habit, dow: number): boolean {
  return h.frequency === "daily" || (h.days?.includes(dow) ?? false);
}

export function activeHabits(date: Date): Habit[] {
  const dow = date.getDay();
  return DEFAULT_HABITS.filter((h) => isActiveOn(h, dow));
}

export function getChecks(date: string): Record<string, boolean> {
  const log = load();
  const r: Record<string, boolean> = {};
  for (const h of DEFAULT_HABITS) r[h.id] = !!log[sk(h.id, date)];
  return r;
}

export function toggle(habitId: string, date: string): boolean {
  const log = load();
  const key = sk(habitId, date);
  const v = !log[key];
  log[key] = v;
  save(log);
  return v;
}

export type DaySummary = {
  date: string;
  label: string;
  total: number;
  done: number;
};

export function weekSummary(): DaySummary[] {
  const log = load();
  const labels = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  const out: DaySummary[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const s = ds(d);
    const dow = d.getDay();
    const active = DEFAULT_HABITS.filter((h) => isActiveOn(h, dow));
    const done = active.filter((h) => !!log[sk(h.id, s)]).length;
    out.push({ date: s, label: labels[dow], total: active.length, done });
  }
  return out;
}

export function streak(): number {
  const log = load();
  let count = 0;
  for (let i = 1; i <= 365; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const s = ds(d);
    const dow = d.getDay();
    const active = DEFAULT_HABITS.filter((h) => isActiveOn(h, dow));
    if (active.length === 0) continue;
    if (active.every((h) => !!log[sk(h.id, s)])) count++;
    else break;
  }
  return count;
}
