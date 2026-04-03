/**
 * Life area → color mapping used across calendar, tasks, schedule.
 * Each tone gets a visual identity tied to the 6 attention areas.
 */

import type { ScheduleTone } from "./schedule";
import type { Task } from "./tasks";

export type LifeArea =
  | "work"
  | "health"
  | "family"
  | "operations"
  | "reflection"
  | "recovery";

/** Tone → life area mapping */
export const TONE_AREA: Record<ScheduleTone, LifeArea> = {
  kinderly: "work",
  heys: "work",
  work: "work",
  health: "health",
  personal: "recovery",
  cleanup: "operations",
  family: "family",
  review: "reflection",
};

/** Life area → Tailwind colour tokens */
export const AREA_COLOR: Record<
  LifeArea,
  { bg: string; border: string; text: string; dot: string; bar: string }
> = {
  work: {
    bg: "bg-sky-500/12",
    border: "border-sky-500/25",
    text: "text-sky-300",
    dot: "bg-sky-400",
    bar: "bg-sky-500/70",
  },
  health: {
    bg: "bg-emerald-500/12",
    border: "border-emerald-500/25",
    text: "text-emerald-300",
    dot: "bg-emerald-400",
    bar: "bg-emerald-500/70",
  },
  family: {
    bg: "bg-fuchsia-500/12",
    border: "border-fuchsia-500/25",
    text: "text-fuchsia-300",
    dot: "bg-fuchsia-400",
    bar: "bg-fuchsia-500/70",
  },
  operations: {
    bg: "bg-rose-500/12",
    border: "border-rose-500/25",
    text: "text-rose-300",
    dot: "bg-rose-400",
    bar: "bg-rose-500/70",
  },
  reflection: {
    bg: "bg-amber-500/12",
    border: "border-amber-500/25",
    text: "text-amber-300",
    dot: "bg-amber-400",
    bar: "bg-amber-500/70",
  },
  recovery: {
    bg: "bg-violet-500/12",
    border: "border-violet-500/25",
    text: "text-violet-300",
    dot: "bg-violet-400",
    bar: "bg-violet-500/70",
  },
};

/** Resolve life area colour for a schedule tone */
export function toneColor(tone: ScheduleTone) {
  return AREA_COLOR[TONE_AREA[tone]];
}

/** Infer task life area from project name */
export function taskArea(task: Task): LifeArea {
  const p = (task.project ?? "").toLowerCase();
  if (p === "kinderly" || p === "heys") return "work";
  if (p === "health" || p === "run") return "health";
  if (p === "family" || p === "danya") return "family";
  return "operations";
}

export function taskColor(task: Task) {
  return AREA_COLOR[taskArea(task)];
}

/** Legend items for UI */
export const AREA_LEGEND: Array<{ key: LifeArea; label: string; emoji: string }> = [
  { key: "work", label: "Работа", emoji: "💼" },
  { key: "health", label: "Здоровье", emoji: "🫀" },
  { key: "family", label: "Семья", emoji: "🏡" },
  { key: "operations", label: "Операционка", emoji: "🧹" },
  { key: "reflection", label: "Осмысление", emoji: "🧠" },
  { key: "recovery", label: "Восстановление", emoji: "🌙" },
];
