import type { CalendarDayPressure } from "@/lib/calendar-day-pressure";
import type { CalendarSlotSupportNote } from "@/lib/calendar-slot-support-notes";
import type { DayMode } from "@/lib/heys-day-mode";
import type { LifeArea } from "@/lib/life-areas";
import type {
  ScheduleRepeat,
  ScheduleRepeatDay,
  ScheduleSeriesScope,
  ScheduleSlot,
  ScheduleSource,
  ScheduleTone,
} from "@/lib/schedule";
import type { Task } from "@/lib/tasks";

/* ── Layout constants ── */

export const HOUR_START = 5;
export const HOUR_END = 26;
export const TOTAL_HOURS = HOUR_END - HOUR_START;
export const ROW_H = 56;
export const HEADER_BASE_H = 66;
export const HEADER_TASK_ROW_H = 24;
export const HEADER_TASK_GAP = 4;
export const HEADER_TASK_MARGIN_TOP = 6;
export const STEP_MIN = 30;
export const MIN_SLOT_MIN = 30;
export const DEFAULT_CUSTOM_DURATION_MIN = 60;
export const MOUSE_HOLD_MS = 110;
export const TOUCH_HOLD_MS = 240;
export const POINTER_SLOP_PX = 10;
export const AUTO_SCROLL_EDGE_PX = 72;
export const AUTO_SCROLL_MAX_STEP = 24;
export const QUICK_MENU_ESTIMATED_HEIGHT = 560;
export const SUPPORT_LANE_RATIO = 0.36;
export const SLOT_SIDE_INSET_PX = 4;
export const SLOT_LANE_GAP_PX = 6;
export const DESKTOP_SLOT_HINT_DELAY_MS = 3000;
export const DESKTOP_SLOT_HINT_WIDTH = 296;
export const DESKTOP_SLOT_HINT_ESTIMATED_HEIGHT = 248;

export const QUICK_TONE_OPTIONS: Array<{ value: ScheduleTone; label: string }> = [
  { value: "work", label: "💼 Работа" },
  { value: "kinderly", label: "🎉 Kinderly" },
  { value: "heys", label: "⚙️ HEYS" },
  { value: "health", label: "🫀 Здоровье" },
  { value: "personal", label: "🌙 Личное" },
  { value: "cleanup", label: "🧹 Опер." },
  { value: "family", label: "🏡 Семья" },
  { value: "review", label: "🧠 Review" },
];

/* ── Types ── */

export type DayColumn = {
  key: string;
  date: Date;
  dayLabel: string;
  dateLabel: string;
  isToday: boolean;
  isPast: boolean;
  isWeekend: boolean;
  pressure: CalendarDayPressure;
  tasks: Task[];
  slots: ScheduleSlot[];
};

export type WeekCalendarGridProps = {
  stats?: {
    inboxCount: number;
    activeCount: number;
    doneThisWeek: number;
  } | null;
};

export type DragState =
  | { type: "task"; taskId: string; originDay: string }
  | null;

export type CalendarViewMode = "full" | "compact";

export type EditableSlotDraft = {
  id: string | null;
  date: string;
  start: string;
  end: string;
  title: string;
  tone: ScheduleTone;
  tags: string[];
  kind: "task" | "event";
};

export type PointerEditMode = "move" | "resize-start" | "resize-end" | "create";

export type PendingPointerEdit = {
  mode: PointerEditMode;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  dayKey: string;
  slot: ScheduleSlot | null;
};

export type ActivePointerEdit = {
  mode: PointerEditMode;
  pointerId: number;
  pointerType: string;
  originClientX: number;
  originClientY: number;
  pointerOffsetMin: number;
  originColumnIndex: number;
  originalSlot: ScheduleSlot | null;
  base: EditableSlotDraft;
  draft: EditableSlotDraft;
  hasMoved: boolean;
  blocked: boolean;
  blockingSlot: ScheduleSlot | null;
};

export type QuickMenuState = {
  slot: ScheduleSlot;
  top: number;
  left: number;
  mobile: boolean;
  draftTitle: string;
  draftTone: ScheduleTone;
  draftKind: "task" | "event";
  draftProjectId: string;
  draftRepeat: ScheduleRepeat;
  draftRepeatDays: ScheduleRepeatDay[];
  draftSeriesScope: ScheduleSeriesScope;
};

export type EdgeCueState = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export type ReboundPreview = {
  id: string;
  slotId: string | null;
  slotDate: string;
  from: EditableSlotDraft;
  to: EditableSlotDraft;
  stage: "from" | "to";
  source: ScheduleSource;
  tags: string[];
  tone: ScheduleTone;
  title: string;
  blockedLabel: string | null;
};

export type DesktopSlotHintTone = "rose" | "amber" | "sky" | "zinc" | "emerald" | "violet";

export type DesktopSlotHintContent = {
  eyebrow: string;
  title: string;
  summary: string;
  detail?: string;
  points?: string[];
  tone: DesktopSlotHintTone;
  icon?: string;
};

export type DesktopSlotHintState = DesktopSlotHintContent & {
  slotKey: string;
  left: number;
  top: number;
};

/* ── Lane metrics ── */

export type TimeRange = {
  start: string;
  end: string;
};

export type LaneRenderable = {
  id: string;
  start: string;
  end: string;
  source: ScheduleSource;
  tags: string[];
};

export type LaneMetrics = {
  left: number;
  width: number;
  isSupportLane: boolean;
};

/* ── Pure helpers ── */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function snapMinutes(minutes: number): number {
  return Math.round(minutes / STEP_MIN) * STEP_MIN;
}

export function minutesToCalendarTime(minutes: number): string {
  const safe = Math.min(Math.max(0, minutes), HOUR_END * 60);
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatHour(hour: number): string {
  const displayHour = hour % 24;
  return `${String(displayHour).padStart(2, "0")}:00`;
}

export function formatDurationDelta(minutes: number): string {
  if (minutes === 0) return "±0м";
  const sign = minutes > 0 ? "+" : "−";
  const abs = Math.abs(minutes);
  if (abs % 60 === 0) return `${sign}${abs / 60}ч`;
  if (abs > 60) {
    const hours = Math.floor(abs / 60);
    const rest = abs % 60;
    return `${sign}${hours}ч ${rest}м`;
  }
  return `${sign}${abs}м`;
}

export function copyTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.toLowerCase().endsWith("(копия)")) return trimmed;
  return `${trimmed} (копия)`;
}

export function toneFromArea(area: LifeArea): ScheduleTone {
  switch (area) {
    case "health":
      return "health";
    case "family":
      return "family";
    case "reflection":
      return "review";
    case "recovery":
      return "personal";
    case "operations":
      return "cleanup";
    case "work":
    default:
      return "work";
  }
}

export function getDayModeBadgeClass(dayMode: DayMode): string {
  switch (dayMode.id) {
    case "damage-control":
      return "border-rose-500/25 bg-rose-500/10 text-rose-200";
    case "recovery":
      return "border-amber-500/25 bg-amber-500/10 text-amber-200";
    case "execution":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-200";
    case "light-rhythm":
    default:
      return "border-zinc-700 bg-zinc-900/60 text-zinc-300";
  }
}

export function getSupportNoteChipClass(
  tone: CalendarSlotSupportNote["tone"],
  isMuted: boolean,
): string {
  if (isMuted) {
    return "border-zinc-700 bg-zinc-900/80 text-zinc-500";
  }

  switch (tone) {
    case "rose":
      return "border-rose-400/30 bg-rose-500/12 text-rose-100";
    case "amber":
      return "border-amber-400/30 bg-amber-500/12 text-amber-100";
    case "sky":
      return "border-sky-400/30 bg-sky-500/12 text-sky-100";
    case "emerald":
      return "border-emerald-400/30 bg-emerald-500/12 text-emerald-100";
    case "violet":
      return "border-violet-400/30 bg-violet-500/12 text-violet-100";
    default:
      return "border-white/10 bg-black/10 text-white/75";
  }
}

export function vibrateIfAvailable(pattern: number | number[]): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  navigator.vibrate(pattern);
}

export function sameEdgeCue(
  left: EdgeCueState,
  right: EdgeCueState,
): boolean {
  return (
    left.top === right.top &&
    left.bottom === right.bottom &&
    left.left === right.left &&
    left.right === right.right
  );
}

export function getCompactStart(columns: DayColumn[], compactCount: number): number {
  if (columns.length <= compactCount) return 0;
  const todayIndex = columns.findIndex((column) => column.isToday);
  if (todayIndex < 0) return 0;
  return Math.max(0, Math.min(todayIndex - 1, columns.length - compactCount));
}

export function slotTop(startTime: string, timeToMinutes: (t: string) => number): number {
  const mins = timeToMinutes(startTime);
  return ((mins - HOUR_START * 60) / 60) * ROW_H;
}

export function slotHeight(start: string, end: string, timeToMinutes: (t: string) => number): number {
  const duration = timeToMinutes(end) - timeToMinutes(start);
  return Math.max((duration / 60) * ROW_H, 20);
}

export function calcNowTop(): number {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  return ((mins - HOUR_START * 60) / 60) * ROW_H;
}

export function centerNowLine(container: HTMLDivElement | null, headerHeight: number): void {
  if (!container) return;
  const rowViewportHeight = Math.max(container.clientHeight - headerHeight, 0);
  const rawTarget = calcNowTop() - rowViewportHeight / 2;
  const maxScroll = Math.max(container.scrollHeight - container.clientHeight, 0);
  container.scrollTop = Math.min(Math.max(rawTarget, 0), maxScroll);
}
