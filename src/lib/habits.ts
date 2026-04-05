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
const OVERRIDE_KEY = "alphacore_habit_overrides";

type HabitOverrideMode = "skip" | "extra";

/** Simple guard to prevent concurrent toggle/skip/snooze overwrites */
let mutationLock = false;

function withLock<T>(fn: () => T): T {
  if (mutationLock) {
    console.warn("[ALPHACORE] Habits: concurrent mutation blocked");
    return fn();
  }
  mutationLock = true;
  try {
    return fn();
  } finally {
    mutationLock = false;
  }
}

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

function loadOverrides(): Record<string, HabitOverrideMode> {
  return lsGet<Record<string, HabitOverrideMode>>(OVERRIDE_KEY, {});
}

function saveOverrides(log: Record<string, HabitOverrideMode>): void {
  lsSet(OVERRIDE_KEY, log);
}

export function todayStr(): string {
  return ds(new Date());
}

export function isActiveOn(h: Habit, dow: number): boolean {
  return h.frequency === "daily" || (h.days?.includes(dow) ?? false);
}

export function activeHabits(date: Date): Habit[] {
  const dow = date.getDay();
  const day = ds(date);
  const overrides = loadOverrides();
  const base = DEFAULT_HABITS.filter((h) => isActiveOn(h, dow)).filter(
    (habit) => overrides[sk(habit.id, day)] !== "skip",
  );
  const extras = DEFAULT_HABITS.filter(
    (habit) => overrides[sk(habit.id, day)] === "extra",
  );

  return [...base, ...extras].filter(
    (habit, index, list) => list.findIndex((item) => item.id === habit.id) === index,
  );
}

export function getChecks(date: string): Record<string, boolean> {
  const log = load();
  const r: Record<string, boolean> = {};
  for (const h of DEFAULT_HABITS) r[h.id] = !!log[sk(h.id, date)];
  return r;
}

export function toggle(habitId: string, date: string): boolean {
  return withLock(() => {
    const log = load();
    const key = sk(habitId, date);
    const v = !log[key];
    log[key] = v;
    save(log);
    return v;
  });
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
    const active = activeHabits(d);
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
    const active = activeHabits(d);
    if (active.length === 0) continue;
    if (active.every((h) => !!log[sk(h.id, s)])) count++;
    else break;
  }
  return count;
}

export function skipHabit(habitId: string, date: string): void {
  withLock(() => {
    const overrides = loadOverrides();
    overrides[sk(habitId, date)] = "skip";
    saveOverrides(overrides);
  });
}

export function snoozeHabitToTomorrow(habitId: string, date: string): void {
  withLock(() => {
    const overrides = loadOverrides();
    const next = new Date(`${date}T00:00:00`);
    next.setDate(next.getDate() + 1);
    const tomorrow = ds(next);

    overrides[sk(habitId, date)] = "skip";
    overrides[sk(habitId, tomorrow)] = "extra";
    saveOverrides(overrides);
  });
}

export function clearHabitOverride(habitId: string, date: string): void {
  withLock(() => {
    const overrides = loadOverrides();
    delete overrides[sk(habitId, date)];
    saveOverrides(overrides);
  });
}

export function getHabitOverrideMode(habitId: string, date: string): HabitOverrideMode | null {
  return loadOverrides()[sk(habitId, date)] ?? null;
}
