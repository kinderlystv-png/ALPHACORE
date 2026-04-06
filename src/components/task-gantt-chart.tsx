"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AREA_COLOR, type LifeArea } from "@/lib/life-areas";
import type { ScheduleTone } from "@/lib/schedule";
import { lsGet, lsSet } from "@/lib/storage";
import type { Project, ProjectAccent } from "@/lib/projects";
import type { Task } from "@/lib/tasks";

export type GanttTaskNode = {
  task: Task;
  children: GanttTaskNode[];
  depth: number;
};

export type GanttGroup = {
  id: string;
  label: string;
  project: Project | null;
  area: LifeArea | null;
  nodes: GanttTaskNode[];
  openCount: number;
};

export type GanttScheduledSlot = {
  date: string;
  start: string;
  end: string;
  title: string;
  tone: ScheduleTone;
};

export type GanttTaskProgress = {
  done: number;
  total: number;
  ratio: number;
};

export type GanttDependencyLink = {
  fromTaskId: string;
  toTaskId: string;
};

export type TaskGanttChartProps = {
  groups: GanttGroup[];
  scheduledSlotsByTaskId?: Record<string, GanttScheduledSlot>;
  progressByTaskId?: Record<string, GanttTaskProgress>;
  dependencyLinks?: GanttDependencyLink[];
  dependencyTargetsByTaskId?: Record<string, string[]>;
  onTaskRangeChange: (taskId: string, patch: { startDate?: string; dueDate?: string }) => void;
  onDependencyLinkCreate?: (taskId: string, blockerId: string) => void;
  onDependencyLinkRemove?: (taskId: string, blockerId: string) => void;
  onTaskPlannedMinutesChange?: (taskId: string, minutes: number | null) => void;
  onTaskBaselineReset?: (taskId: string) => void;
  onTaskBaselineRebase?: (taskId: string) => void;
};

const DAY_MS = 86_400_000;
const WORKDAY_MINUTES = 8 * 60;
const LABEL_W = 248;
const GROUP_H = 34;
const ROW_H = 32;
const PAST_DAYS = 7;
const FUTURE_DAYS = 365;
const MIN_BAR_DAYS = 0.55;
const MIN_MARKER_W = 18;
const AUTO_SCROLL_EDGE = 56;
const GANTT_UI_STATE_KEY = "alphacore_tasks_gantt_ui_v1";

type ZoomLevel = "detail" | "month" | "overview";

const ZOOM_OPTIONS: Record<ZoomLevel, { label: string; dayWidth: number; hint: string }> = {
  detail: { label: "Детально", dayWidth: 40, hint: "удобно двигать по дням" },
  month: { label: "Месяц", dayWidth: 26, hint: "баланс обзорности и точности" },
  overview: { label: "Обзор", dayWidth: 16, hint: "больше горизонта на экране" },
};

type Span = {
  left: number;
  width: number;
  startIndex: number;
  endIndex: number;
};

type Rect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type TaskVisual = Span & {
  kind: "marker" | "bar";
  titleOutside: boolean;
  anchorIndex: number;
};

type DerivedTaskRow = {
  kind: "task";
  key: string;
  group: GanttGroup;
  task: Task;
  depth: number;
  hasChildren: boolean;
  ownVisual: TaskVisual;
  rollupSpan?: Span;
};

type DerivedGroupRow = {
  kind: "group";
  key: string;
  group: GanttGroup;
  rollupSpan?: Span;
};

type DerivedGroupSection = {
  key: string;
  group: GanttGroup;
  top: number;
  height: number;
  bodyTop: number;
  bodyHeight: number;
  collapsed: boolean;
};

type DerivedRepeatSeriesRow = {
  kind: "repeat-series";
  key: string;
  group: GanttGroup;
  depth: number;
  tasks: Task[];
  taskRows: DerivedTaskRow[];
  visuals: Array<{ task: Task; visual: TaskVisual }>;
  combinedSpan?: Span;
  representativeTask: Task;
  health: RepeatSeriesHealth;
};

type DerivedRow = DerivedTaskRow | DerivedGroupRow | DerivedRepeatSeriesRow;

type InteractionState = {
  taskId: string;
  mode: "move" | "resize-start" | "resize-end";
  resizeKind?: "date" | "duration";
  startX: number;
  hasExplicitStartDate: boolean;
  hasDueDate: boolean;
  baseStartDate: string;
  baseDueDate?: string;
  baseCreatedAt: string;
  basePlannedMinutes?: number;
  offsetDays: number;
  previewPlannedMinutes?: number;
  moved: boolean;
};

type PersistedGanttUiState = {
  zoom?: ZoomLevel;
  collapsedGroups?: string[];
  showNoEstimateOnly?: boolean;
  showRiskOnly?: boolean;
  showCriticalChainOnly?: boolean;
  showPlanVsSlot?: boolean;
  showBaseline?: boolean;
  showDependencies?: boolean;
  collapseRepeatSeries?: boolean;
  repeatExceptionsOnly?: boolean;
};

type RepeatSeriesHealth = {
  firstLabel: string | null;
  lastLabel: string | null;
  noEstimateCount: number;
  dominantGapDays: number | null;
  seriesHealthLabel: string | null;
  tooltip: string;
  cadenceBreakTaskIds: Set<string>;
  slippedTaskIds: Set<string>;
  overdueTaskIds: Set<string>;
  slotOutsideTaskIds: Set<string>;
  criticalTaskIds: Set<string>;
  dependencyTaskIds: Set<string>;
  exceptionTaskIds: Set<string>;
  cadenceBreakCount: number;
  slippedCount: number;
  overdueCount: number;
  slotOutsideCount: number;
  criticalCount: number;
  dependencyCount: number;
  canHideInExceptionsMode: boolean;
};

type DependencyChainSummary = {
  taskIds: string[];
  maxDepth: number;
};

type TaskLayout = {
  top: number;
  visual: TaskVisual;
  slotVisual?: Span;
  anchorVisual: Span;
  anchorCenterY: number;
  barRect: Rect;
  slotRect?: Rect;
  dropRects: Rect[];
};

type DependencyDraftState = {
  taskId: string;
  pointerX: number;
  pointerY: number;
  hoveredTaskId: string | null;
  hoveredInvalidTaskId: string | null;
  moved: boolean;
};

const BAR_BG: Record<ProjectAccent, string> = {
  sky: "bg-sky-500/60",
  orange: "bg-orange-500/60",
  violet: "bg-violet-500/60",
  teal: "bg-teal-500/60",
  rose: "bg-rose-500/60",
};

const BAR_BD: Record<ProjectAccent, string> = {
  sky: "border-sky-400/45",
  orange: "border-orange-400/45",
  violet: "border-violet-400/45",
  teal: "border-teal-400/45",
  rose: "border-rose-400/45",
};

const DOT: Record<ProjectAccent, string> = {
  sky: "bg-sky-400",
  orange: "bg-orange-400",
  violet: "bg-violet-400",
  teal: "bg-teal-400",
  rose: "bg-rose-400",
};

const SLOT_BG: Record<ScheduleTone, string> = {
  kinderly: "bg-sky-300/85",
  heys: "bg-orange-300/85",
  work: "bg-zinc-300/80",
  health: "bg-emerald-300/85",
  personal: "bg-violet-300/85",
  cleanup: "bg-rose-300/85",
  family: "bg-fuchsia-300/85",
  review: "bg-amber-300/85",
};

const SLOT_BD: Record<ScheduleTone, string> = {
  kinderly: "border-sky-100/35",
  heys: "border-orange-100/35",
  work: "border-zinc-100/25",
  health: "border-emerald-100/35",
  personal: "border-violet-100/35",
  cleanup: "border-rose-100/35",
  family: "border-fuchsia-100/35",
  review: "border-amber-100/35",
};

type GroupSurfaceTone = {
  sectionBg: string;
  headerBg: string;
  labelBg: string;
  borderColor: string;
};

const PROJECT_SURFACE: Record<ProjectAccent, GroupSurfaceTone> = {
  sky: {
    sectionBg: "rgba(14, 165, 233, 0.055)",
    headerBg: "linear-gradient(90deg, rgba(14, 165, 233, 0.18) 0%, rgba(14, 165, 233, 0.08) 42%, rgba(9, 9, 11, 0.96) 100%)",
    labelBg: "linear-gradient(90deg, rgba(14, 165, 233, 0.12) 0%, rgba(14, 165, 233, 0.035) 42%, rgba(9, 9, 11, 0.93) 100%)",
    borderColor: "rgba(56, 189, 248, 0.15)",
  },
  orange: {
    sectionBg: "rgba(249, 115, 22, 0.055)",
    headerBg: "linear-gradient(90deg, rgba(249, 115, 22, 0.18) 0%, rgba(249, 115, 22, 0.08) 42%, rgba(9, 9, 11, 0.96) 100%)",
    labelBg: "linear-gradient(90deg, rgba(249, 115, 22, 0.12) 0%, rgba(249, 115, 22, 0.035) 42%, rgba(9, 9, 11, 0.93) 100%)",
    borderColor: "rgba(251, 146, 60, 0.15)",
  },
  violet: {
    sectionBg: "rgba(139, 92, 246, 0.06)",
    headerBg: "linear-gradient(90deg, rgba(139, 92, 246, 0.18) 0%, rgba(139, 92, 246, 0.08) 42%, rgba(9, 9, 11, 0.96) 100%)",
    labelBg: "linear-gradient(90deg, rgba(139, 92, 246, 0.12) 0%, rgba(139, 92, 246, 0.04) 42%, rgba(9, 9, 11, 0.93) 100%)",
    borderColor: "rgba(167, 139, 250, 0.15)",
  },
  teal: {
    sectionBg: "rgba(20, 184, 166, 0.055)",
    headerBg: "linear-gradient(90deg, rgba(20, 184, 166, 0.18) 0%, rgba(20, 184, 166, 0.08) 42%, rgba(9, 9, 11, 0.96) 100%)",
    labelBg: "linear-gradient(90deg, rgba(20, 184, 166, 0.12) 0%, rgba(20, 184, 166, 0.04) 42%, rgba(9, 9, 11, 0.93) 100%)",
    borderColor: "rgba(45, 212, 191, 0.15)",
  },
  rose: {
    sectionBg: "rgba(244, 63, 94, 0.055)",
    headerBg: "linear-gradient(90deg, rgba(244, 63, 94, 0.18) 0%, rgba(244, 63, 94, 0.08) 42%, rgba(9, 9, 11, 0.96) 100%)",
    labelBg: "linear-gradient(90deg, rgba(244, 63, 94, 0.12) 0%, rgba(244, 63, 94, 0.04) 42%, rgba(9, 9, 11, 0.93) 100%)",
    borderColor: "rgba(251, 113, 133, 0.15)",
  },
};

const AREA_SURFACE: Record<LifeArea, GroupSurfaceTone> = {
  work: PROJECT_SURFACE.sky,
  health: {
    sectionBg: "rgba(16, 185, 129, 0.055)",
    headerBg: "linear-gradient(90deg, rgba(16, 185, 129, 0.18) 0%, rgba(16, 185, 129, 0.08) 42%, rgba(9, 9, 11, 0.96) 100%)",
    labelBg: "linear-gradient(90deg, rgba(16, 185, 129, 0.12) 0%, rgba(16, 185, 129, 0.04) 42%, rgba(9, 9, 11, 0.93) 100%)",
    borderColor: "rgba(52, 211, 153, 0.15)",
  },
  family: {
    sectionBg: "rgba(217, 70, 239, 0.055)",
    headerBg: "linear-gradient(90deg, rgba(217, 70, 239, 0.18) 0%, rgba(217, 70, 239, 0.08) 42%, rgba(9, 9, 11, 0.96) 100%)",
    labelBg: "linear-gradient(90deg, rgba(217, 70, 239, 0.12) 0%, rgba(217, 70, 239, 0.04) 42%, rgba(9, 9, 11, 0.93) 100%)",
    borderColor: "rgba(232, 121, 249, 0.15)",
  },
  operations: PROJECT_SURFACE.rose,
  reflection: {
    sectionBg: "rgba(245, 158, 11, 0.055)",
    headerBg: "linear-gradient(90deg, rgba(245, 158, 11, 0.18) 0%, rgba(245, 158, 11, 0.08) 42%, rgba(9, 9, 11, 0.96) 100%)",
    labelBg: "linear-gradient(90deg, rgba(245, 158, 11, 0.12) 0%, rgba(245, 158, 11, 0.04) 42%, rgba(9, 9, 11, 0.93) 100%)",
    borderColor: "rgba(251, 191, 36, 0.15)",
  },
  recovery: PROJECT_SURFACE.violet,
};

function d0(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function diffDays(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / DAY_MS);
}

function parseDay(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return d0(date);
}

function fmtISO(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isZoomLevel(value: string | undefined): value is ZoomLevel {
  return value === "detail" || value === "month" || value === "overview";
}

function readPersistedGanttUiState(): PersistedGanttUiState {
  return lsGet<PersistedGanttUiState>(GANTT_UI_STATE_KEY, {});
}

function getDayCapacityMinutes(day: Date): number {
  const weekday = day.getDay();

  if (weekday === 0) return 2 * 60;
  if (weekday === 3) return 4 * 60;
  if (weekday === 6) return 3 * 60;
  return WORKDAY_MINUTES;
}

function getHeatOverlay(ratio: number): string | null {
  if (ratio >= 1.15) return "rgba(244, 63, 94, 0.14)";
  if (ratio >= 0.9) return "rgba(245, 158, 11, 0.11)";
  if (ratio >= 0.6) return "rgba(139, 92, 246, 0.08)";
  return null;
}

function getLoadBarColor(ratio: number): string {
  if (ratio >= 1.15) return "rgba(251, 113, 133, 0.9)";
  if (ratio >= 0.9) return "rgba(251, 191, 36, 0.85)";
  return "rgba(167, 139, 250, 0.8)";
}

function getCapacityLineColor(ratio: number): string {
  if (ratio >= 1.15) return "rgba(254, 202, 202, 0.85)";
  if (ratio >= 0.9) return "rgba(254, 240, 138, 0.8)";
  return "rgba(228, 228, 231, 0.45)";
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function roundToQuarterHour(minutes: number): number {
  return Math.max(15, Math.round(minutes / 15) * 15);
}

function durationDaysFromMinutes(minutes?: number): number | null {
  if (!minutes || minutes <= 0) return null;
  return Math.max(minutes / WORKDAY_MINUTES, MIN_BAR_DAYS);
}

function durationLabel(minutes?: number): string | null {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `${minutes}м`;
  const hours = minutes / 60;
  if (hours < 8) return `${hours.toFixed(hours % 1 === 0 ? 0 : 1)}ч`;
  const days = minutes / WORKDAY_MINUTES;
  return `${days.toFixed(days % 1 === 0 ? 0 : 1)}д`;
}

function formatSignedDurationDelta(minutes: number): string {
  const label = durationLabel(Math.abs(minutes));
  if (!label || minutes === 0) return "0";
  return `${minutes > 0 ? "+" : "-"}${label}`;
}

function formatDayLabel(value?: string): string | null {
  if (!value) return null;
  const date = parseDay(value);
  if (!date) return null;

  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
}

function parseClockMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return clamp(hours * 60 + minutes, 0, 24 * 60);
}

function countNodes(nodes: GanttTaskNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countNodes(node.children), 0);
}

function normalizeRepeatSeriesTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

function getTaskAnchorDate(task: Task): string {
  return task.startDate ?? task.dueDate ?? task.createdAt.slice(0, 10);
}

function countNoEstimateNodes(nodes: GanttTaskNode[]): number {
  return nodes.reduce(
    (sum, node) => sum + (node.task.plannedMinutes ? 0 : 1) + countNoEstimateNodes(node.children),
    0,
  );
}

function filterNodesByNoEstimate(nodes: GanttTaskNode[]): GanttTaskNode[] {
  return nodes.flatMap((node) => {
    const filteredChildren = filterNodesByNoEstimate(node.children);
    const matches = !node.task.plannedMinutes;

    if (!matches && filteredChildren.length === 0) return [];

    return [{
      ...node,
      children: filteredChildren,
    }];
  });
}

function filterNodesByTaskIds(nodes: GanttTaskNode[], visibleTaskIds: Set<string>): GanttTaskNode[] {
  return nodes.flatMap((node) => {
    const filteredChildren = filterNodesByTaskIds(node.children, visibleTaskIds);
    const matches = visibleTaskIds.has(node.task.id);

    if (!matches && filteredChildren.length === 0) return [];

    return [{
      ...node,
      children: filteredChildren,
    }];
  });
}

function collectNodeTasks(nodes: GanttTaskNode[]): Task[] {
  return nodes.flatMap((node) => [node.task, ...collectNodeTasks(node.children)]);
}

function formatSignedDayDelta(value: number): string {
  return `${value > 0 ? "+" : ""}${value}д`;
}

function formatGapDays(value: number): string {
  if (value % 7 === 0 && value >= 7) {
    const weeks = value / 7;
    return `${weeks}н`;
  }

  return `${value}д`;
}

function resolveTaskStartDate(task: Task): Date {
  const explicitStart = parseDay(task.startDate);
  if (explicitStart) return explicitStart;

  const due = parseDay(task.dueDate);
  const plannedDays = durationDaysFromMinutes(task.plannedMinutes);

  if (due) {
    return addDays(due, -Math.max(Math.ceil(plannedDays ?? 1) - 1, 0));
  }

  return d0(new Date(task.createdAt));
}

function clampStartDate(nextStart: Date, dueDate?: string): Date {
  const due = parseDay(dueDate);
  if (!due) return nextStart;
  return nextStart > due ? due : nextStart;
}

function clampDueDate(nextDue: Date, startDate?: string): Date {
  const start = parseDay(startDate);
  if (!start) return nextDue;
  return nextDue < start ? start : nextDue;
}

function buildTaskTooltip(task: Task, slot?: GanttScheduledSlot): string {
  const lines = [task.title, `Приоритет: ${task.priority.toUpperCase()}`];
  const startLabel = formatDayLabel(task.startDate);
  const dueLabel = formatDayLabel(task.dueDate);
  const plannedLabel = durationLabel(task.plannedMinutes);

  if (startLabel) lines.push(`Старт: ${startLabel}`);
  if (dueLabel) lines.push(`Финиш: ${dueLabel}`);
  if (plannedLabel) lines.push(`Оценка: ${plannedLabel}`);
  else lines.push("Оценка: нет");
  if (task.project) lines.push(`Группа: ${task.project}`);
  if (slot) {
    const slotDay = formatDayLabel(slot.date);
    lines.push(`Слот: ${slot.start}–${slot.end}${slotDay ? ` · ${slotDay}` : ""}`);
  }

  return lines.join("\n");
}

function buildTaskTooltipWithProgress(
  task: Task,
  slot: GanttScheduledSlot | undefined,
  progress: GanttTaskProgress | undefined,
): string {
  const base = buildTaskTooltip(task, slot);
  const lines = [base];

  if (task.baselineStartDate || task.baselineDueDate || task.baselinePlannedMinutes) {
    const baselineStart = formatDayLabel(task.baselineStartDate);
    const baselineDue = formatDayLabel(task.baselineDueDate);
    const baselinePlanned = durationLabel(task.baselinePlannedMinutes);
    const baselineParts = [baselineStart ? `старт ${baselineStart}` : null, baselineDue ? `финиш ${baselineDue}` : null, baselinePlanned ? `оценка ${baselinePlanned}` : null].filter(Boolean);

    if (baselineParts.length > 0) {
      lines.push(`Baseline: ${baselineParts.join(" · ")}`);
    }
  }

  if (task.blockedByTaskIds?.length) {
    lines.push(`Зависит от задач: ${task.blockedByTaskIds.length}`);
  }

  if (progress && progress.total > 0) {
    lines.push(`Подзадачи: ${progress.done}/${progress.total}`);
  }

  return lines.join("\n");
}

function getOverdueTailSpan(
  task: Task,
  timelineStart: Date,
  today: Date,
  totalDays: number,
  dayWidth: number,
): Span | undefined {
  const due = parseDay(task.dueDate);
  if (!due || due >= today) return undefined;

  const startIndex = clamp(diffDays(timelineStart, addDays(due, 1)), 0, totalDays - 1);
  const endIndex = clamp(diffDays(timelineStart, today), 0, totalDays - 1);

  if (endIndex < startIndex) return undefined;

  return {
    left: startIndex * dayWidth,
    width: Math.max((endIndex - startIndex + 0.5) * dayWidth, 6),
    startIndex,
    endIndex,
  };
}

function computeScheduledSlotVisual(
  slot: GanttScheduledSlot,
  timelineStart: Date,
  totalDays: number,
  dayWidth: number,
): Span | undefined {
  const day = parseDay(slot.date);
  if (!day) return undefined;

  const dayIndex = diffDays(timelineStart, day);
  if (dayIndex < 0 || dayIndex >= totalDays) return undefined;

  const startMinutes = parseClockMinutes(slot.start);
  const endMinutes = Math.max(startMinutes + 15, parseClockMinutes(slot.end));
  const inset = Math.max(dayWidth * 0.08, 1);
  const usableWidth = Math.max(dayWidth - inset * 2, 6);
  const left = dayIndex * dayWidth + inset + (startMinutes / (24 * 60)) * usableWidth;
  const rawWidth = ((endMinutes - startMinutes) / (24 * 60)) * usableWidth;
  const width = Math.min(
    usableWidth - (left - dayIndex * dayWidth - inset),
    Math.max(rawWidth, Math.min(usableWidth, Math.max(6, dayWidth * 0.16))),
  );

  return {
    left,
    width,
    startIndex: dayIndex,
    endIndex: dayIndex,
  };
}

function isScheduledSlotOutsidePlan(slot: Span, plan: Span): boolean {
  return slot.startIndex < plan.startIndex || slot.endIndex > plan.endIndex;
}

function buildPreviewTask(task: Task, interaction: InteractionState | null): Task {
  if (!interaction || interaction.taskId !== task.id) return task;

  if (interaction.mode === "move") {
    const shiftedStart = fmtISO(addDays(parseDay(interaction.baseStartDate) ?? d0(new Date(task.createdAt)), interaction.offsetDays));
    const shiftedDue = interaction.baseDueDate
      ? fmtISO(addDays(parseDay(interaction.baseDueDate) ?? d0(new Date(task.createdAt)), interaction.offsetDays))
      : undefined;

    if (interaction.hasExplicitStartDate) {
      return {
        ...task,
        startDate: shiftedStart,
        ...(interaction.hasDueDate ? { dueDate: shiftedDue } : {}),
      };
    }

    if (interaction.hasDueDate) {
      return {
        ...task,
        dueDate: shiftedDue,
      };
    }

    if (interaction.basePlannedMinutes) {
      return {
        ...task,
        startDate: shiftedStart,
      };
    }

    return {
      ...task,
      dueDate: shiftedStart,
    };
  }

  if (interaction.mode === "resize-start") {
    const nextStart = clampStartDate(
      addDays(parseDay(interaction.baseStartDate) ?? d0(new Date(task.createdAt)), interaction.offsetDays),
      interaction.baseDueDate,
    );

    return {
      ...task,
      startDate: fmtISO(nextStart),
    };
  }

  if (interaction.mode === "resize-end") {
    if (interaction.resizeKind === "date" && interaction.baseDueDate) {
      const nextDue = clampDueDate(
        addDays(parseDay(interaction.baseDueDate) ?? d0(new Date(task.createdAt)), interaction.offsetDays),
        interaction.baseStartDate,
      );

      return {
        ...task,
        dueDate: fmtISO(nextDue),
      };
    }

    return {
      ...task,
      plannedMinutes: interaction.previewPlannedMinutes,
    };
  }

  return task;
}

function buildBaselineTask(task: Task): Task | null {
  if (!task.baselineStartDate && !task.baselineDueDate && !task.baselinePlannedMinutes) {
    return null;
  }

  return {
    ...task,
    startDate: task.baselineStartDate,
    dueDate: task.baselineDueDate,
    plannedMinutes: task.baselinePlannedMinutes ?? task.plannedMinutes,
  };
}

function spanFromVisual(visual: TaskVisual): Span {
  return {
    left: visual.left,
    width: visual.width,
    startIndex: visual.startIndex,
    endIndex: visual.endIndex,
  };
}

function buildDependencyPath(fromX: number, fromY: number, toX: number, toY: number): string {
  const elbowX = toX > fromX + 28
    ? fromX + Math.min(72, (toX - fromX) / 2)
    : fromX + 18;

  return `M ${fromX} ${fromY} H ${elbowX} V ${toY} H ${toX}`;
}

function sortNodesByDependencies(nodes: GanttTaskNode[]): GanttTaskNode[] {
  const prepared = nodes.map((node) => ({
    ...node,
    children: sortNodesByDependencies(node.children),
  }));

  if (prepared.length < 2) return prepared;

  const originalIndexById = new Map(prepared.map((node, index) => [node.task.id, index]));
  const nodeById = new Map(prepared.map((node) => [node.task.id, node]));
  const indegree = new Map(prepared.map((node) => [node.task.id, 0]));
  const dependentsById = new Map<string, string[]>();

  for (const node of prepared) {
    for (const blockerId of node.task.blockedByTaskIds ?? []) {
      if (!nodeById.has(blockerId)) continue;

      const dependents = dependentsById.get(blockerId) ?? [];
      dependents.push(node.task.id);
      dependentsById.set(blockerId, dependents);
      indegree.set(node.task.id, (indegree.get(node.task.id) ?? 0) + 1);
    }
  }

  const ready = prepared
    .filter((node) => (indegree.get(node.task.id) ?? 0) === 0)
    .sort(
      (left, right) =>
        (originalIndexById.get(left.task.id) ?? 0) - (originalIndexById.get(right.task.id) ?? 0),
    );
  const result: GanttTaskNode[] = [];

  while (ready.length > 0) {
    const current = ready.shift()!;
    result.push(current);

    for (const dependentId of dependentsById.get(current.task.id) ?? []) {
      const nextDegree = (indegree.get(dependentId) ?? 0) - 1;
      indegree.set(dependentId, nextDegree);

      if (nextDegree === 0) {
        const nextNode = nodeById.get(dependentId);
        if (!nextNode) continue;

        ready.push(nextNode);
        ready.sort(
          (left, right) =>
            (originalIndexById.get(left.task.id) ?? 0) - (originalIndexById.get(right.task.id) ?? 0),
        );
      }
    }
  }

  return result.length === prepared.length ? result : prepared;
}

function mergeSpans(spans: Array<Span | undefined>): Span | undefined {
  const valid = spans.filter((span): span is Span => Boolean(span));
  if (valid.length === 0) return undefined;

  const startIndex = Math.min(...valid.map((span) => span.startIndex));
  const endIndex = Math.max(...valid.map((span) => span.endIndex));
  const left = Math.min(...valid.map((span) => span.left));
  const right = Math.max(...valid.map((span) => span.left + span.width));

  return {
    left,
    width: Math.max(right - left, MIN_MARKER_W),
    startIndex,
    endIndex,
  };
}

function groupDotCls(group: GanttGroup): string {
  if (group.project) return DOT[group.project.accent];
  if (group.area) return AREA_COLOR[group.area].dot;
  return "bg-zinc-500";
}

function groupBarTone(group: GanttGroup): { bg: string; border: string } {
  if (group.project) {
    return {
      bg: BAR_BG[group.project.accent],
      border: BAR_BD[group.project.accent],
    };
  }

  if (group.area) {
    return {
      bg: AREA_COLOR[group.area].bar,
      border: AREA_COLOR[group.area].border,
    };
  }

  return {
    bg: "bg-zinc-600/35",
    border: "border-zinc-500/25",
  };
}

function groupSurfaceTone(group: GanttGroup): GroupSurfaceTone {
  if (group.project) {
    return PROJECT_SURFACE[group.project.accent];
  }

  if (group.area) {
    return AREA_SURFACE[group.area];
  }

  return {
    sectionBg: "rgba(39, 39, 42, 0.22)",
    headerBg: "linear-gradient(90deg, rgba(39, 39, 42, 0.66) 0%, rgba(24, 24, 27, 0.96) 100%)",
    labelBg: "linear-gradient(90deg, rgba(39, 39, 42, 0.45) 0%, rgba(24, 24, 27, 0.93) 100%)",
    borderColor: "rgba(82, 82, 91, 0.18)",
  };
}

function taskUrgencyTone(task: Task, today: Date): string {
  const due = parseDay(task.dueDate);
  if (!due) return "";
  const offset = diffDays(today, due);
  if (offset < 0) return "ring-1 ring-rose-400/50 saturate-125";
  if (offset <= 1) return "ring-1 ring-amber-400/40";
  return "";
}

function computeTaskVisual(
  task: Task,
  options: {
    dayWidth: number;
    timelineStart: Date;
    totalDays: number;
  },
): TaskVisual {
  const { dayWidth, timelineStart, totalDays } = options;

  const created = d0(new Date(task.createdAt));
  const createdIndex = clamp(diffDays(timelineStart, created), 0, totalDays - 1);
  const start = parseDay(task.startDate);
  const due = parseDay(task.dueDate);
  const plannedMinutes = task.plannedMinutes;
  const plannedDays = durationDaysFromMinutes(plannedMinutes);

  if (start) {
    if (due) {
      const startIndex = clamp(diffDays(timelineStart, start), 0, totalDays - 1);
      const dueIndex = clamp(diffDays(timelineStart, due), 0, totalDays - 1);
      const visibleStart = Math.min(startIndex, dueIndex);
      const visibleEnd = Math.max(startIndex, dueIndex) + 1;
      const left = visibleStart * dayWidth;
      const width = Math.max((visibleEnd - visibleStart) * dayWidth, Math.max(dayWidth * 0.8, MIN_MARKER_W));

      return {
        kind: "bar",
        left,
        width,
        startIndex: visibleStart,
        endIndex: clamp(visibleEnd - 1, 0, totalDays - 1),
        anchorIndex: clamp(visibleEnd - 1, 0, totalDays - 1),
        titleOutside: width < 76,
      };
    }

    if (plannedDays != null) {
      const startIndexFloat = clamp(diffDays(timelineStart, start), 0, totalDays - 1);
      const visibleEnd = clamp(startIndexFloat + plannedDays, 0, totalDays);
      const left = startIndexFloat * dayWidth;
      const width = Math.max((visibleEnd - startIndexFloat) * dayWidth, Math.max(dayWidth * 0.8, MIN_MARKER_W));
      const startIndex = clamp(Math.floor(startIndexFloat), 0, totalDays - 1);
      const endIndex = clamp(Math.ceil(visibleEnd) - 1, 0, totalDays - 1);

      return {
        kind: "bar",
        left,
        width,
        startIndex,
        endIndex,
        anchorIndex: endIndex,
        titleOutside: width < 76,
      };
    }

    const anchor = clamp(diffDays(timelineStart, start), 0, totalDays - 1);
    const width = Math.max(dayWidth * 0.75, MIN_MARKER_W);
    const left = anchor * dayWidth + Math.max(dayWidth * 0.12, 1);

    return {
      kind: "marker",
      left,
      width,
      startIndex: anchor,
      endIndex: anchor,
      anchorIndex: anchor,
      titleOutside: true,
    };
  }

  if (plannedDays != null) {
    if (due) {
      const dueIndex = clamp(diffDays(timelineStart, due), 0, totalDays - 1);
      const rawStart = dueIndex + 1 - plannedDays;
      const visibleStart = clamp(rawStart, 0, totalDays - 1);
      const visibleEnd = clamp(dueIndex + 1, 0, totalDays);
      const left = visibleStart * dayWidth;
      const width = Math.max((visibleEnd - visibleStart) * dayWidth, Math.max(dayWidth * 0.8, MIN_MARKER_W));
      const startIndex = clamp(Math.floor(visibleStart), 0, totalDays - 1);
      const endIndex = clamp(Math.ceil(visibleEnd) - 1, 0, totalDays - 1);

      return {
        kind: "bar",
        left,
        width,
        startIndex,
        endIndex,
        anchorIndex: dueIndex,
        titleOutside: width < 76,
      };
    }

    const startIndexFloat = clamp(createdIndex, 0, totalDays - 1);
    const visibleEnd = clamp(startIndexFloat + plannedDays, 0, totalDays);
    const left = startIndexFloat * dayWidth;
    const width = Math.max((visibleEnd - startIndexFloat) * dayWidth, Math.max(dayWidth * 0.8, MIN_MARKER_W));
    const startIndex = clamp(Math.floor(startIndexFloat), 0, totalDays - 1);
    const endIndex = clamp(Math.ceil(visibleEnd) - 1, 0, totalDays - 1);

    return {
      kind: "bar",
      left,
      width,
      startIndex,
      endIndex,
      anchorIndex: endIndex,
      titleOutside: width < 76,
    };
  }

  const anchor = due ? clamp(diffDays(timelineStart, due), 0, totalDays - 1) : clamp(createdIndex, 0, totalDays - 1);
  const width = Math.max(dayWidth * 0.75, MIN_MARKER_W);
  const left = anchor * dayWidth + Math.max(dayWidth * 0.12, 1);

  return {
    kind: "marker",
    left,
    width,
    startIndex: anchor,
    endIndex: anchor,
    anchorIndex: anchor,
    titleOutside: true,
  };
}

export function TaskGanttChart({
  groups,
  scheduledSlotsByTaskId = {},
  progressByTaskId = {},
  dependencyLinks = [],
  dependencyTargetsByTaskId = {},
  onTaskRangeChange,
  onDependencyLinkCreate,
  onDependencyLinkRemove,
  onTaskPlannedMinutesChange,
  onTaskBaselineReset,
  onTaskBaselineRebase,
}: TaskGanttChartProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const gridBodyRef = useRef<HTMLDivElement>(null);
  const suppressClickRef = useRef<string | null>(null);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    const persisted = readPersistedGanttUiState();
    return new Set((persisted.collapsedGroups ?? []).filter(Boolean));
  });
  const [zoom, setZoom] = useState<ZoomLevel>(() => {
    const persisted = readPersistedGanttUiState();
    return isZoomLevel(persisted.zoom) ? persisted.zoom : "month";
  });
  const [showNoEstimateOnly, setShowNoEstimateOnly] = useState<boolean>(() => {
    const persisted = readPersistedGanttUiState();
    return Boolean(persisted.showNoEstimateOnly);
  });
  const [showRiskOnly, setShowRiskOnly] = useState<boolean>(() => {
    const persisted = readPersistedGanttUiState();
    return Boolean(persisted.showRiskOnly);
  });
  const [showCriticalChainOnly, setShowCriticalChainOnly] = useState<boolean>(() => {
    const persisted = readPersistedGanttUiState();
    return Boolean(persisted.showCriticalChainOnly);
  });
  const [showBaseline, setShowBaseline] = useState<boolean>(() => {
    const persisted = readPersistedGanttUiState();
    return persisted.showBaseline ?? true;
  });
  const [showDependencies, setShowDependencies] = useState<boolean>(() => {
    const persisted = readPersistedGanttUiState();
    return persisted.showDependencies ?? true;
  });
  const [collapseRepeatSeries, setCollapseRepeatSeries] = useState<boolean>(() => {
    const persisted = readPersistedGanttUiState();
    return persisted.collapseRepeatSeries ?? true;
  });
  const [repeatExceptionsOnly, setRepeatExceptionsOnly] = useState<boolean>(() => {
    const persisted = readPersistedGanttUiState();
    return Boolean((persisted.collapseRepeatSeries ?? true) && persisted.repeatExceptionsOnly);
  });
  const [expandedRepeatSeriesKey, setExpandedRepeatSeriesKey] = useState<string | null>(null);
  const [showPlanVsSlot, setShowPlanVsSlot] = useState<boolean>(() => {
    const persisted = readPersistedGanttUiState();
    return Boolean(persisted.showPlanVsSlot);
  });
  const [interaction, setInteraction] = useState<InteractionState | null>(null);
  const [dependencyDraft, setDependencyDraft] = useState<DependencyDraftState | null>(null);

  const today = useMemo(() => d0(new Date()), []);
  const timelineStart = useMemo(() => addDays(today, -PAST_DAYS), [today]);
  const totalDays = PAST_DAYS + FUTURE_DAYS;
  const dayWidth = ZOOM_OPTIONS[zoom].dayWidth;
  const gridWidth = totalDays * dayWidth;
  const todayIndex = PAST_DAYS;
  const dependencyTargetSetByTaskId = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(dependencyTargetsByTaskId).map(([taskId, targetIds]) => [taskId, new Set(targetIds)]),
      ) as Record<string, Set<string>>,
    [dependencyTargetsByTaskId],
  );

  const days = useMemo(
    () => Array.from({ length: totalDays }, (_, index) => addDays(timelineStart, index)),
    [timelineStart, totalDays],
  );

  const buildVisual = useCallback(
    (task: Task) =>
      computeTaskVisual(task, {
        dayWidth,
        timelineStart,
        totalDays,
      }),
    [dayWidth, timelineStart, totalDays],
  );

  const riskMeta = useMemo(() => {
    const allTasks = groups.flatMap((group) => collectNodeTasks(group.nodes));
    const taskById = new Map(allTasks.map((task) => [task.id, task]));
    const incomingByTaskId = new Map<string, string[]>();
    const outgoingByTaskId = new Map<string, string[]>();
    const downstreamByTaskId = new Map<string, DependencyChainSummary>();
    const upstreamByTaskId = new Map<string, DependencyChainSummary>();
    const varianceByTaskId: Record<string, { startDeltaDays: number; finishDeltaDays: number; slipDays: number; gainDays: number }> = {};
    const dependencyByTaskId: Record<
      string,
      {
        incomingCount: number;
        outgoingCount: number;
        incomingConflictCount: number;
        outgoingConflictCount: number;
      }
    > = {};
    const dependencyHeatByDay = Array.from({ length: totalDays }, () => 0);
    const dependencyConflictHeatByDay = Array.from({ length: totalDays }, () => 0);
    const criticalChainHeatByDay = Array.from({ length: totalDays }, () => 0);
    const relevantTaskIds = new Set<string>();
    const slippedTaskIds = new Set<string>();
    const conflictedTaskIds = new Set<string>();
    const criticalTaskIds = new Set<string>();
    const criticalLinkIds = new Set<string>();

    const ensureDependencyState = (taskId: string) => {
      dependencyByTaskId[taskId] ??= {
        incomingCount: 0,
        outgoingCount: 0,
        incomingConflictCount: 0,
        outgoingConflictCount: 0,
      };

      return dependencyByTaskId[taskId];
    };

    for (const task of allTasks) {
      const baselineTask = buildBaselineTask(task);
      if (!baselineTask) continue;

      const currentVisual = buildVisual(task);
      const baselineVisual = buildVisual(baselineTask);
      const startDeltaDays = currentVisual.startIndex - baselineVisual.startIndex;
      const finishDeltaDays = currentVisual.endIndex - baselineVisual.endIndex;
      const slipDays = Math.max(startDeltaDays, finishDeltaDays, 0);
      const gainDays = Math.max(-(Math.min(startDeltaDays, finishDeltaDays, 0)), 0);

      varianceByTaskId[task.id] = {
        startDeltaDays,
        finishDeltaDays,
        slipDays,
        gainDays,
      };

      if (slipDays > 0) {
        slippedTaskIds.add(task.id);
        relevantTaskIds.add(task.id);
      }
    }

    for (const link of dependencyLinks) {
      const blocker = taskById.get(link.fromTaskId);
      const dependent = taskById.get(link.toTaskId);
      if (!blocker || !dependent) continue;

      const blockerState = ensureDependencyState(link.fromTaskId);
      const dependentState = ensureDependencyState(link.toTaskId);

      const incoming = incomingByTaskId.get(link.toTaskId) ?? [];
      incoming.push(link.fromTaskId);
      incomingByTaskId.set(link.toTaskId, incoming);

      const outgoing = outgoingByTaskId.get(link.fromTaskId) ?? [];
      outgoing.push(link.toTaskId);
      outgoingByTaskId.set(link.fromTaskId, outgoing);

      blockerState.outgoingCount += 1;
      dependentState.incomingCount += 1;
      relevantTaskIds.add(link.fromTaskId);
      relevantTaskIds.add(link.toTaskId);

      const blockerVisual = buildVisual(blocker);
      const dependentVisual = buildVisual(dependent);
      const gapDays = dependentVisual.startIndex - blockerVisual.endIndex - 1;

      if (gapDays < 0) {
        for (let index = Math.max(0, dependentVisual.startIndex); index <= Math.min(totalDays - 1, blockerVisual.endIndex); index += 1) {
          dependencyHeatByDay[index] += 1;
          dependencyConflictHeatByDay[index] += 1;
        }
      } else {
        dependencyHeatByDay[Math.max(0, Math.min(totalDays - 1, dependentVisual.startIndex))] += 1;
      }

      if (gapDays < 0) {
        blockerState.outgoingConflictCount += 1;
        dependentState.incomingConflictCount += 1;
        conflictedTaskIds.add(link.fromTaskId);
        conflictedTaskIds.add(link.toTaskId);
      }
    }

    const collectChain = (
      rootTaskId: string,
      graph: Map<string, string[]>,
    ): DependencyChainSummary => {
      const seen = new Set<string>();
      let maxDepth = 0;
      const stack = (graph.get(rootTaskId) ?? []).map((taskId) => ({ taskId, depth: 1 }));

      while (stack.length > 0) {
        const current = stack.pop();
        if (!current || seen.has(current.taskId)) continue;

        seen.add(current.taskId);
        maxDepth = Math.max(maxDepth, current.depth);

        for (const nextTaskId of graph.get(current.taskId) ?? []) {
          stack.push({ taskId: nextTaskId, depth: current.depth + 1 });
        }
      }

      return {
        taskIds: Array.from(seen),
        maxDepth,
      };
    };

    for (const task of allTasks) {
      downstreamByTaskId.set(task.id, collectChain(task.id, outgoingByTaskId));
      upstreamByTaskId.set(task.id, collectChain(task.id, incomingByTaskId));
    }

    for (const taskId of conflictedTaskIds) {
      relevantTaskIds.add(taskId);
    }

    const criticalSeeds = Array.from(new Set([...slippedTaskIds, ...conflictedTaskIds]));
    const criticalQueue = [...criticalSeeds];

    while (criticalQueue.length > 0) {
      const currentId = criticalQueue.shift();
      if (!currentId || criticalTaskIds.has(currentId)) continue;

      criticalTaskIds.add(currentId);

      for (const nextId of [
        ...(incomingByTaskId.get(currentId) ?? []),
        ...(outgoingByTaskId.get(currentId) ?? []),
      ]) {
        if (!criticalTaskIds.has(nextId)) {
          criticalQueue.push(nextId);
        }
      }
    }

    for (const taskId of criticalTaskIds) {
      const task = taskById.get(taskId);
      if (!task) continue;

      const visual = buildVisual(task);
      for (let index = Math.max(0, visual.startIndex); index <= Math.min(totalDays - 1, visual.endIndex); index += 1) {
        criticalChainHeatByDay[index] += 1;
      }
    }

    for (const link of dependencyLinks) {
      if (!criticalTaskIds.has(link.fromTaskId) || !criticalTaskIds.has(link.toTaskId)) continue;
      criticalLinkIds.add(`${link.fromTaskId}->${link.toTaskId}`);
    }

    return {
      varianceByTaskId,
      dependencyByTaskId,
      incomingByTaskId,
      outgoingByTaskId,
      downstreamByTaskId,
      upstreamByTaskId,
      dependencyHeatByDay,
      dependencyConflictHeatByDay,
      criticalChainHeatByDay,
      relevantTaskIds,
      slippedTaskIds,
      conflictedTaskIds,
      criticalTaskIds,
      criticalLinkIds,
    };
  }, [buildVisual, dependencyLinks, groups, totalDays]);

  const allTasks = useMemo(() => groups.flatMap((group) => collectNodeTasks(group.nodes)), [groups]);
  const allTasksById = useMemo(
    () => new Map(allTasks.map((task) => [task.id, task])),
    [allTasks],
  );

  const months = useMemo(() => {
    const result: Array<{ label: string; left: number; width: number }> = [];
    let monthStart = 0;

    for (let index = 1; index <= days.length; index += 1) {
      const reachedEnd = index === days.length;
      const monthChanged = !reachedEnd && days[index]?.getMonth() !== days[monthStart]?.getMonth();
      if (!reachedEnd && !monthChanged) continue;

      result.push({
        label: days[monthStart].toLocaleDateString("ru-RU", { month: "short" }),
        left: monthStart * dayWidth,
        width: (index - monthStart) * dayWidth,
      });

      monthStart = index;
    }

    return result;
  }, [dayWidth, days]);

  const noEstimateCount = useMemo(
    () => groups.reduce((sum, group) => sum + countNoEstimateNodes(group.nodes), 0),
    [groups],
  );

  const displayGroups = useMemo(() => {
    return groups
      .map((group) => {
        let nodes = showNoEstimateOnly ? filterNodesByNoEstimate(group.nodes) : group.nodes;

        if (showRiskOnly) {
          nodes = filterNodesByTaskIds(nodes, riskMeta.relevantTaskIds);
        }

        if (showCriticalChainOnly) {
          nodes = filterNodesByTaskIds(nodes, riskMeta.criticalTaskIds);
        }

        return {
          ...group,
          nodes,
          openCount: countNodes(nodes),
        } satisfies GanttGroup;
      })
      .filter((group) => group.nodes.length > 0);
  }, [groups, riskMeta.criticalTaskIds, riskMeta.relevantTaskIds, showCriticalChainOnly, showNoEstimateOnly, showRiskOnly]);

  const groupRiskStatsByGroupId = useMemo(() => {
    return Object.fromEntries(
      displayGroups.map((group) => {
        const groupTasks = collectNodeTasks(group.nodes);
        let slipCount = 0;
        let blockedCount = 0;
        let blockerCount = 0;
        let conflictCount = 0;
        let criticalCount = 0;

        for (const task of groupTasks) {
          const variance = riskMeta.varianceByTaskId[task.id];
          const dependencyState = riskMeta.dependencyByTaskId[task.id];

          if ((variance?.slipDays ?? 0) > 0) slipCount += 1;
          if ((dependencyState?.incomingCount ?? 0) > 0) blockedCount += 1;
          if ((dependencyState?.outgoingCount ?? 0) > 0) blockerCount += 1;
          if (((dependencyState?.incomingConflictCount ?? 0) + (dependencyState?.outgoingConflictCount ?? 0)) > 0) {
            conflictCount += 1;
          }
          if (riskMeta.criticalTaskIds.has(task.id)) criticalCount += 1;
        }

        return [
          group.id,
          {
            slipCount,
            blockedCount,
            blockerCount,
            conflictCount,
            criticalCount,
          },
        ];
      }),
    ) as Record<string, { slipCount: number; blockedCount: number; blockerCount: number; conflictCount: number; criticalCount: number }>;
  }, [displayGroups, riskMeta.criticalTaskIds, riskMeta.dependencyByTaskId, riskMeta.varianceByTaskId]);

  const analyzeRepeatSeries = useCallback(
    (
      tasks: Task[],
      visuals: Array<{ task: Task; visual: TaskVisual }>,
    ): RepeatSeriesHealth => {
      const noEstimateCount = tasks.filter((task) => !task.plannedMinutes).length;
      const sortedSeriesItems = [...visuals].sort(
        (left, right) => left.visual.startIndex - right.visual.startIndex || left.task.createdAt.localeCompare(right.task.createdAt),
      );
      const firstTask = sortedSeriesItems[0]?.task ?? tasks[0] ?? null;
      const lastTask = sortedSeriesItems[sortedSeriesItems.length - 1]?.task ?? tasks[tasks.length - 1] ?? null;
      const firstLabel = firstTask ? formatDayLabel(getTaskAnchorDate(firstTask)) : null;
      const lastLabel = lastTask ? formatDayLabel(getTaskAnchorDate(lastTask)) : null;
      const gapFrequencies = new Map<number, number>();

      for (let index = 1; index < sortedSeriesItems.length; index += 1) {
        const previousDate = parseDay(getTaskAnchorDate(sortedSeriesItems[index - 1]!.task));
        const nextDate = parseDay(getTaskAnchorDate(sortedSeriesItems[index]!.task));
        if (!previousDate || !nextDate) continue;

        const gapDays = Math.max(diffDays(previousDate, nextDate), 0);
        gapFrequencies.set(gapDays, (gapFrequencies.get(gapDays) ?? 0) + 1);
      }

      const dominantGapDays = Array.from(gapFrequencies.entries())
        .sort((left, right) => right[1] - left[1] || left[0] - right[0])[0]?.[0] ?? null;

      const cadenceBreakTaskIds = new Set<string>();

      if (dominantGapDays != null) {
        for (let index = 1; index < sortedSeriesItems.length; index += 1) {
          const previousDate = parseDay(getTaskAnchorDate(sortedSeriesItems[index - 1]!.task));
          const nextDate = parseDay(getTaskAnchorDate(sortedSeriesItems[index]!.task));
          if (!previousDate || !nextDate) continue;

          const gapDays = Math.max(diffDays(previousDate, nextDate), 0);
          if (gapDays !== dominantGapDays) {
            cadenceBreakTaskIds.add(sortedSeriesItems[index]!.task.id);
          }
        }
      }

      const slippedTaskIds = new Set(
        tasks
          .filter((task) => (riskMeta.varianceByTaskId[task.id]?.slipDays ?? 0) > 0)
          .map((task) => task.id),
      );
      const overdueTaskIds = new Set(
        tasks
          .filter((task) => {
            const due = parseDay(task.dueDate);
            return Boolean(due && due < today);
          })
          .map((task) => task.id),
      );
      const slotOutsideTaskIds = new Set(
        sortedSeriesItems
          .filter(({ task, visual }) => {
            const scheduledSlot = scheduledSlotsByTaskId[task.id];
            if (!scheduledSlot) return false;
            const scheduledSlotVisual = computeScheduledSlotVisual(scheduledSlot, timelineStart, totalDays, dayWidth);
            return Boolean(scheduledSlotVisual && isScheduledSlotOutsidePlan(scheduledSlotVisual, spanFromVisual(visual)));
          })
          .map(({ task }) => task.id),
      );
      const criticalTaskIds = new Set(
        tasks
          .filter((task) => {
            const dependencyState = riskMeta.dependencyByTaskId[task.id];
            return (
              riskMeta.criticalTaskIds.has(task.id)
              || ((dependencyState?.incomingConflictCount ?? 0) + (dependencyState?.outgoingConflictCount ?? 0)) > 0
            );
          })
          .map((task) => task.id),
      );
      const dependencyTaskIds = new Set(
        tasks
          .filter((task) => {
            const dependencyState = riskMeta.dependencyByTaskId[task.id];
            return ((dependencyState?.incomingCount ?? 0) + (dependencyState?.outgoingCount ?? 0)) > 0;
          })
          .map((task) => task.id),
      );
      const exceptionTaskIds = new Set<string>([
        ...cadenceBreakTaskIds,
        ...slippedTaskIds,
        ...overdueTaskIds,
        ...slotOutsideTaskIds,
        ...criticalTaskIds,
      ]);
      const cadenceBreakCount = cadenceBreakTaskIds.size;
      const slippedCount = slippedTaskIds.size;
      const overdueCount = overdueTaskIds.size;
      const slotOutsideCount = slotOutsideTaskIds.size;
      const criticalCount = criticalTaskIds.size;
      const dependencyCount = dependencyTaskIds.size;
      const seriesHealthLabel = dominantGapDays != null ? `ритм ${formatGapDays(dominantGapDays)}` : null;
      const canHideInExceptionsMode =
        exceptionTaskIds.size === 0
        && dependencyCount === 0
        && !(showNoEstimateOnly && noEstimateCount > 0);
      const tooltip = [
        firstTask?.title ?? "Повторяющаяся серия",
        `Серия: ${tasks.length} повторов`,
        firstLabel || lastLabel
          ? `Окно: ${firstLabel ?? "?"}${lastLabel && lastLabel !== firstLabel ? ` → ${lastLabel}` : ""}`
          : null,
        seriesHealthLabel ? `Базовый ${seriesHealthLabel}` : null,
        cadenceBreakCount > 0 ? `Ритм сбит: ${cadenceBreakCount}` : null,
        slippedCount > 0 ? `Baseline drift: ${slippedCount}` : null,
        overdueCount > 0 ? `Просрочено: ${overdueCount}` : null,
        slotOutsideCount > 0 ? `Слот вне плана: ${slotOutsideCount}` : null,
        dependencyCount > 0 ? `Связано зависимостями: ${dependencyCount}` : null,
        canHideInExceptionsMode ? "Стабильная серия: в режиме exceptions уходит в фон." : null,
        ...tasks.slice(0, 6).map((task) => `• ${formatDayLabel(getTaskAnchorDate(task)) ?? task.createdAt.slice(0, 10)}`),
        tasks.length > 6 ? `… ещё ${tasks.length - 6}` : null,
        "Переключи Повторы = compact/full, если нужен полный список элементов.",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        firstLabel,
        lastLabel,
        noEstimateCount,
        dominantGapDays,
        seriesHealthLabel,
        tooltip,
        cadenceBreakTaskIds,
        slippedTaskIds,
        overdueTaskIds,
        slotOutsideTaskIds,
        criticalTaskIds,
        dependencyTaskIds,
        exceptionTaskIds,
        cadenceBreakCount,
        slippedCount,
        overdueCount,
        slotOutsideCount,
        criticalCount,
        dependencyCount,
        canHideInExceptionsMode,
      };
    },
    [dayWidth, riskMeta.criticalTaskIds, riskMeta.dependencyByTaskId, riskMeta.varianceByTaskId, scheduledSlotsByTaskId, showNoEstimateOnly, timelineStart, today, totalDays],
  );

  const derived = useMemo(() => {
    const loadByDay = Array.from({ length: totalDays }, () => 0);
    const orderedRows: DerivedRow[] = [];
    const groupSections: DerivedGroupSection[] = [];
    const taskRowTopById: Record<string, number> = {};
    let repeatSeriesCount = 0;
    let repeatTaskCount = 0;
    let hiddenStableRepeatSeriesCount = 0;
    let hiddenStableRepeatTaskCount = 0;
    let cursorTop = 0;

    const collectLoad = (span: Span, task: Task) => {
      const totalMinutes = task.plannedMinutes ?? 30;
      const daysCovered = Math.max(1, span.endIndex - span.startIndex + 1);
      const perDay = totalMinutes / daysCovered;

      for (let index = span.startIndex; index <= span.endIndex; index += 1) {
        if (index < 0 || index >= totalDays) continue;
        loadByDay[index] += perDay;
      }
    };

    const buildNodeRows = (
      group: GanttGroup,
      node: GanttTaskNode,
    ): { rows: DerivedTaskRow[]; span: Span | undefined } => {
      const ownVisual = buildVisual(node.task);
      const ownSpan = spanFromVisual(ownVisual);
      collectLoad(ownSpan, node.task);

      const childResults = node.children.map((child) => buildNodeRows(group, child));
      const rollupSpan = mergeSpans([ownSpan, ...childResults.map((child) => child.span)]);

      const row: DerivedTaskRow = {
        kind: "task",
        key: `task:${node.task.id}`,
        group,
        task: node.task,
        depth: node.depth,
        hasChildren: node.children.length > 0,
        ownVisual,
        rollupSpan,
      };

      return {
        rows: [row, ...childResults.flatMap((child) => child.rows)],
        span: rollupSpan,
      };
    };

    const isRepeatSeriesCandidate = (row: DerivedTaskRow): boolean => {
      return row.depth === 0 && !row.hasChildren && !(row.task.blockedByTaskIds?.length);
    };

    const collapseRepeatRows = (
      group: GanttGroup,
      rows: DerivedTaskRow[],
    ): {
      rows: Array<DerivedTaskRow | DerivedRepeatSeriesRow>;
      repeatSeriesCount: number;
      repeatTaskCount: number;
    } => {
      const compactRows: Array<DerivedTaskRow | DerivedRepeatSeriesRow> = [];
      let localRepeatSeriesCount = 0;
      let localRepeatTaskCount = 0;
      let index = 0;

      while (index < rows.length) {
        const row = rows[index]!;

        if (!isRepeatSeriesCandidate(row)) {
          compactRows.push(row);
          index += 1;
          continue;
        }

        const normalizedTitle = normalizeRepeatSeriesTitle(row.task.title);
        const run: DerivedTaskRow[] = [row];
        let cursor = index + 1;

        while (cursor < rows.length) {
          const candidate = rows[cursor]!;
          if (!isRepeatSeriesCandidate(candidate)) break;
          if (candidate.depth !== row.depth) break;
          if (candidate.task.priority !== row.task.priority) break;
          if (normalizeRepeatSeriesTitle(candidate.task.title) !== normalizedTitle) break;
          run.push(candidate);
          cursor += 1;
        }

        if (run.length >= 3) {
          const visuals = run.map((repeatRow) => ({
            task: repeatRow.task,
            visual: repeatRow.ownVisual,
          }));
          const health = analyzeRepeatSeries(
            run.map((repeatRow) => repeatRow.task),
            visuals,
          );

          compactRows.push({
            kind: "repeat-series",
            key: `repeat-series:${group.id}:${normalizedTitle}:${run[0]!.task.id}`,
            group,
            depth: row.depth,
            tasks: run.map((repeatRow) => repeatRow.task),
            taskRows: run.map((repeatRow) => ({
              ...repeatRow,
              depth: repeatRow.depth + 1,
            })),
            visuals,
            combinedSpan: mergeSpans(visuals.map(({ visual }) => spanFromVisual(visual))),
            representativeTask: row.task,
            health,
          });
          localRepeatSeriesCount += 1;
          localRepeatTaskCount += run.length;
          index = cursor;
          continue;
        }

        compactRows.push(row);
        index += 1;
      }

      return {
        rows: compactRows,
        repeatSeriesCount: localRepeatSeriesCount,
        repeatTaskCount: localRepeatTaskCount,
      };
    };

    for (const group of displayGroups) {
      const sectionTop = cursorTop;
      const orderedGroupNodes = sortNodesByDependencies(group.nodes);
      const nodeResults = orderedGroupNodes.map((node) => buildNodeRows(group, node));
      const groupRollup = mergeSpans(nodeResults.map((result) => result.span));
      const groupRows = nodeResults.flatMap((result) => result.rows);
      const repeatPreview = collapseRepeatRows(group, groupRows);
      const hiddenRepeatRows = repeatExceptionsOnly
        ? repeatPreview.rows.filter(
            (row): row is DerivedRepeatSeriesRow => row.kind === "repeat-series" && row.health.canHideInExceptionsMode,
          )
        : [];
      const compactRows = !collapseRepeatSeries
        ? groupRows
        : repeatExceptionsOnly
          ? repeatPreview.rows.filter((row) => row.kind !== "repeat-series" || !row.health.canHideInExceptionsMode)
          : repeatPreview.rows;
      const visibleRows = compactRows.flatMap((row) => {
        if (row.kind !== "repeat-series" || row.key !== expandedRepeatSeriesKey) {
          return [row];
        }

        return [row, ...row.taskRows];
      });
      repeatSeriesCount += repeatPreview.repeatSeriesCount;
      repeatTaskCount += repeatPreview.repeatTaskCount;
      hiddenStableRepeatSeriesCount += hiddenRepeatRows.length;
      hiddenStableRepeatTaskCount += hiddenRepeatRows.reduce((sum, row) => sum + row.tasks.length, 0);
      const collapsed = collapsedGroups.has(group.id);

      orderedRows.push({
        kind: "group",
        key: `group:${group.id}`,
        group,
        rollupSpan: groupRollup,
      });
      cursorTop += GROUP_H;

      if (!collapsed) {
        visibleRows.forEach((row, index) => {
          if (row.kind === "task") {
            taskRowTopById[row.task.id] = cursorTop + index * ROW_H;
          }
        });
        orderedRows.push(...visibleRows);
        cursorTop += visibleRows.length * ROW_H;
      }

      groupSections.push({
        key: `section:${group.id}`,
        group,
        top: sectionTop,
        height: cursorTop - sectionTop,
        bodyTop: sectionTop + GROUP_H,
        bodyHeight: Math.max(cursorTop - sectionTop - GROUP_H, 0),
        collapsed,
      });
    }

    const bodyHeight = cursorTop;

    return {
      orderedRows,
      bodyHeight,
      loadByDay,
      groupSections,
      taskRowTopById,
      repeatSeriesCount,
      repeatTaskCount,
      hiddenStableRepeatSeriesCount,
      hiddenStableRepeatTaskCount,
    };
  }, [analyzeRepeatSeries, buildVisual, collapseRepeatSeries, collapsedGroups, displayGroups, expandedRepeatSeriesKey, repeatExceptionsOnly, totalDays]);

  const maxLoad = useMemo(() => Math.max(...derived.loadByDay, 0), [derived.loadByDay]);
  const dayMetrics = useMemo(
    () => days.map((day, index) => {
      const capacity = getDayCapacityMinutes(day);
      const load = derived.loadByDay[index] ?? 0;
      const ratio = capacity > 0 ? load / capacity : 0;
      return {
        load,
        capacity,
        ratio,
        heatOverlay: getHeatOverlay(ratio),
        loadBarColor: getLoadBarColor(ratio),
        capacityLineColor: getCapacityLineColor(ratio),
      };
    }),
    [days, derived.loadByDay],
  );
  const maxCapacity = useMemo(
    () => Math.max(...dayMetrics.map((metric) => metric.capacity), 0),
    [dayMetrics],
  );
  const loadScaleMax = Math.max(maxLoad, maxCapacity, WORKDAY_MINUTES);
  const maxDependencyHeat = useMemo(
    () => Math.max(...riskMeta.dependencyHeatByDay, 0),
    [riskMeta.dependencyHeatByDay],
  );
  const maxCriticalChainHeat = useMemo(
    () => Math.max(...riskMeta.criticalChainHeatByDay, 0),
    [riskMeta.criticalChainHeatByDay],
  );

  useEffect(() => {
    lsSet(GANTT_UI_STATE_KEY, {
      zoom,
      collapsedGroups: Array.from(collapsedGroups),
      showNoEstimateOnly,
      showRiskOnly,
      showCriticalChainOnly,
      showBaseline,
      showDependencies,
      showPlanVsSlot,
      collapseRepeatSeries,
      repeatExceptionsOnly: collapseRepeatSeries ? repeatExceptionsOnly : false,
    } satisfies PersistedGanttUiState);
  }, [collapseRepeatSeries, collapsedGroups, repeatExceptionsOnly, showBaseline, showCriticalChainOnly, showDependencies, showNoEstimateOnly, showPlanVsSlot, showRiskOnly, zoom]);

  const taskLayoutsById = useMemo(() => {
    const layouts: Record<string, TaskLayout> = {};
    const slotOverlayTop = showPlanVsSlot ? 2 : ROW_H - 8;
    const slotOverlayHeight = showPlanVsSlot ? 8 : 5;

    for (const row of derived.orderedRows) {
      if (row.kind !== "task") continue;

      const interactionForTask = interaction?.taskId === row.task.id ? interaction : null;
      const previewTask = buildPreviewTask(row.task, interactionForTask);
      const visual = buildVisual(previewTask);
      const scheduledSlot = scheduledSlotsByTaskId[row.task.id];
      const slotVisual = scheduledSlot
        ? computeScheduledSlotVisual(scheduledSlot, timelineStart, totalDays, dayWidth)
        : undefined;
      const top = derived.taskRowTopById[row.task.id] ?? 0;
      const barRect: Rect = {
        left: visual.left,
        right: visual.left + visual.width,
        top: top + 4,
        bottom: top + ROW_H - 4,
      };
      const slotRect = slotVisual
        ? {
            left: slotVisual.left,
            right: slotVisual.left + slotVisual.width,
            top: top + slotOverlayTop - 4,
            bottom: top + slotOverlayTop + slotOverlayHeight + 4,
          }
        : undefined;
      const anchorVisual = slotVisual ?? visual;
      const anchorTop = slotVisual ? slotOverlayTop : 4;
      const anchorHeight = slotVisual ? slotOverlayHeight : ROW_H - 8;

      layouts[row.task.id] = {
        top,
        visual,
        slotVisual,
        anchorVisual,
        anchorCenterY: top + anchorTop + anchorHeight / 2,
        barRect,
        slotRect,
        dropRects: slotRect ? [slotRect, barRect] : [barRect],
      };
    }

    return layouts;
  }, [buildVisual, dayWidth, derived.orderedRows, derived.taskRowTopById, interaction, scheduledSlotsByTaskId, showPlanVsSlot, timelineStart, totalDays]);

  const readGridPointer = useCallback((clientX: number, clientY: number) => {
    const body = gridBodyRef.current;
    if (!body) return null;

    const rect = body.getBoundingClientRect();
    return {
      x: clientX - rect.left - LABEL_W,
      y: clientY - rect.top,
    };
  }, []);

  const findDependencyHoverTarget = useCallback(
    (sourceTaskId: string, x: number, y: number) => {
      let hoveredInvalidTaskId: string | null = null;
      const validTargets = dependencyTargetSetByTaskId[sourceTaskId] ?? new Set<string>();

      for (const [taskId, layout] of Object.entries(taskLayoutsById)) {
        if (taskId === sourceTaskId) continue;

        const isInside = layout.dropRects.some(
          (rect) => x >= rect.left - 6 && x <= rect.right + 6 && y >= rect.top && y <= rect.bottom,
        );

        if (!isInside) continue;

        if (validTargets.has(taskId)) {
          return {
            hoveredTaskId: taskId,
            hoveredInvalidTaskId: null,
          };
        }

        hoveredInvalidTaskId = taskId;
      }

      return {
        hoveredTaskId: null,
        hoveredInvalidTaskId,
      };
    },
    [dependencyTargetSetByTaskId, taskLayoutsById],
  );

  const interactionImpact = useMemo(() => {
    if (!interaction) return null;

    const task = allTasksById.get(interaction.taskId);
    if (!task) return null;

    const previewTask = buildPreviewTask(task, interaction);
    const currentVisual = buildVisual(task);
    const previewVisual = buildVisual(previewTask);
    const startDeltaDays = previewVisual.startIndex - currentVisual.startIndex;
    const finishDeltaDays = previewVisual.endIndex - currentVisual.endIndex;
    const plannedMinutesDelta = (previewTask.plannedMinutes ?? task.plannedMinutes ?? 0) - (task.plannedMinutes ?? 0);

    if (startDeltaDays === 0 && finishDeltaDays === 0 && plannedMinutesDelta === 0) {
      return null;
    }

    const directIncomingIds = riskMeta.incomingByTaskId.get(task.id) ?? [];
    const directOutgoingIds = riskMeta.outgoingByTaskId.get(task.id) ?? [];
    const downstreamSummary = riskMeta.downstreamByTaskId.get(task.id) ?? { taskIds: [], maxDepth: 0 };

    const currentOutgoingConflictIds = new Set(
      directOutgoingIds.filter((dependentId) => {
        const dependent = allTasksById.get(dependentId);
        if (!dependent) return false;

        const dependentVisual = taskLayoutsById[dependentId]?.visual ?? buildVisual(dependent);
        return dependentVisual.startIndex <= currentVisual.endIndex;
      }),
    );

    const nextOutgoingConflictIds = new Set(
      directOutgoingIds.filter((dependentId) => {
        const dependent = allTasksById.get(dependentId);
        if (!dependent) return false;

        const dependentVisual = taskLayoutsById[dependentId]?.visual ?? buildVisual(dependent);
        return dependentVisual.startIndex <= previewVisual.endIndex;
      }),
    );

    const currentIncomingConflictIds = new Set(
      directIncomingIds.filter((blockerId) => {
        const blocker = allTasksById.get(blockerId);
        if (!blocker) return false;

        const blockerVisual = taskLayoutsById[blockerId]?.visual ?? buildVisual(blocker);
        return blockerVisual.endIndex >= currentVisual.startIndex;
      }),
    );

    const nextIncomingConflictIds = new Set(
      directIncomingIds.filter((blockerId) => {
        const blocker = allTasksById.get(blockerId);
        if (!blocker) return false;

        const blockerVisual = taskLayoutsById[blockerId]?.visual ?? buildVisual(blocker);
        return blockerVisual.endIndex >= previewVisual.startIndex;
      }),
    );

    const newOutgoingConflictCount = Array.from(nextOutgoingConflictIds).filter((taskId) => !currentOutgoingConflictIds.has(taskId)).length;
    const resolvedOutgoingConflictCount = Array.from(currentOutgoingConflictIds).filter((taskId) => !nextOutgoingConflictIds.has(taskId)).length;
    const newIncomingConflictCount = Array.from(nextIncomingConflictIds).filter((taskId) => !currentIncomingConflictIds.has(taskId)).length;
    const resolvedIncomingConflictCount = Array.from(currentIncomingConflictIds).filter((taskId) => !nextIncomingConflictIds.has(taskId)).length;

    const deltaLabel = finishDeltaDays !== 0
      ? `финиш ${formatSignedDayDelta(finishDeltaDays)}`
      : startDeltaDays !== 0
        ? `старт ${formatSignedDayDelta(startDeltaDays)}`
        : `длительность ${formatSignedDurationDelta(plannedMinutesDelta)}`;

    const summaryParts: string[] = [];
    if (downstreamSummary.taskIds.length > 0) {
      if (finishDeltaDays > 0) {
        summaryParts.push(`под риском ${downstreamSummary.taskIds.length} задач`);
      } else if (finishDeltaDays < 0) {
        summaryParts.push(`освобождает запас для ${downstreamSummary.taskIds.length}`);
      } else {
        summaryParts.push(`цепочка ${downstreamSummary.taskIds.length} задач`);
      }
    }
    if (downstreamSummary.maxDepth > 1) {
      summaryParts.push(`глубина ${downstreamSummary.maxDepth}`);
    }
    if (newOutgoingConflictCount > 0) {
      summaryParts.push(`новых конфликтов ${newOutgoingConflictCount}`);
    }
    if (resolvedOutgoingConflictCount > 0) {
      summaryParts.push(`снимет ${resolvedOutgoingConflictCount} конфликтов`);
    }
    if (newIncomingConflictCount > 0) {
      summaryParts.push(`входящих конфликтов ${newIncomingConflictCount}`);
    }
    if (resolvedIncomingConflictCount > 0) {
      summaryParts.push(`снимет ${resolvedIncomingConflictCount} входящих конфликтов`);
    }
    if (summaryParts.length === 0) {
      if (directOutgoingIds.length > 0) {
        summaryParts.push(`прямых зависимых ${directOutgoingIds.length}`);
      } else if (directIncomingIds.length > 0) {
        summaryParts.push(`ждёт ${directIncomingIds.length} blockers`);
      } else {
        summaryParts.push("локальный сдвиг без цепочки");
      }
    }

    const downstreamTitles = downstreamSummary.taskIds
      .slice(0, 3)
      .map((taskId) => allTasksById.get(taskId)?.title)
      .filter((title): title is string => Boolean(title));

    const bubbleWidth = 224;
    const defaultBubbleLeft = previewVisual.left + previewVisual.width + 10;
    const maxBubbleLeft = Math.max(8, gridWidth - bubbleWidth - 8);
    const bubbleLeft = defaultBubbleLeft + bubbleWidth <= gridWidth
      ? defaultBubbleLeft
      : clamp(previewVisual.left - bubbleWidth - 10, 8, maxBubbleLeft);
    const bubbleAlign = defaultBubbleLeft + bubbleWidth <= gridWidth ? "start" : "end";

    return {
      taskId: task.id,
      taskTitle: task.title,
      deltaLabel,
      summaryLabel: summaryParts.join(" · "),
      downstreamTitles,
      downstreamCount: downstreamSummary.taskIds.length,
      downstreamDepth: downstreamSummary.maxDepth,
      directOutgoingCount: directOutgoingIds.length,
      directIncomingCount: directIncomingIds.length,
      activeOutgoingConflictCount: nextOutgoingConflictIds.size,
      activeIncomingConflictCount: nextIncomingConflictIds.size,
      bubbleLeft,
      bubbleAlign,
      startDeltaDays,
      finishDeltaDays,
      plannedMinutesDelta,
    };
  }, [allTasksById, buildVisual, gridWidth, interaction, riskMeta, taskLayoutsById]);

  const renderableDependencyLinks = useMemo(() => {
    if (!showDependencies) return [];

    return dependencyLinks.flatMap((link) => {
      const from = taskLayoutsById[link.fromTaskId];
      const to = taskLayoutsById[link.toTaskId];
      if (!from || !to) return [];

      const fromX = from.anchorVisual.left + from.anchorVisual.width;
      const toX = Math.max(to.anchorVisual.left - 4, 0);
      const fromY = from.anchorCenterY;
      const toY = to.anchorCenterY;
      const blocked = to.anchorVisual.left <= from.anchorVisual.left + from.anchorVisual.width;

      return [{
        ...link,
        blocked,
        critical: riskMeta.criticalLinkIds.has(`${link.fromTaskId}->${link.toTaskId}`),
        path: buildDependencyPath(fromX, fromY, toX, toY),
        dotX: toX,
        dotY: toY,
      }];
    });
  }, [dependencyLinks, riskMeta.criticalLinkIds, showDependencies, taskLayoutsById]);

  const dependencyDraftPreview = useMemo(() => {
    if (!dependencyDraft) return null;

    const source = taskLayoutsById[dependencyDraft.taskId];
    if (!source) return null;

    const sourceX = Math.max(source.anchorVisual.left - 2, 0);
    const sourceY = source.anchorCenterY;

    if (dependencyDraft.hoveredTaskId) {
      const target = taskLayoutsById[dependencyDraft.hoveredTaskId];
      if (!target) return null;

      const fromX = target.anchorVisual.left + target.anchorVisual.width;
      const fromY = target.anchorCenterY;

      return {
        path: buildDependencyPath(fromX, fromY, sourceX, sourceY),
        lineEndX: sourceX,
        lineEndY: sourceY,
        tone: "valid" as const,
      };
    }

    return {
      path: `M ${sourceX} ${sourceY} L ${Math.max(Math.min(dependencyDraft.pointerX, gridWidth), 0)} ${Math.max(Math.min(dependencyDraft.pointerY, derived.bodyHeight), 0)}`,
      lineEndX: Math.max(Math.min(dependencyDraft.pointerX, gridWidth), 0),
      lineEndY: Math.max(Math.min(dependencyDraft.pointerY, derived.bodyHeight), 0),
      tone: dependencyDraft.hoveredInvalidTaskId ? "invalid" as const : "idle" as const,
    };
  }, [dependencyDraft, derived.bodyHeight, gridWidth, taskLayoutsById]);

  const bottleneckSummary = useMemo(() => {
    const candidates = Array.from(riskMeta.criticalTaskIds)
      .map((taskId) => {
        const task = allTasksById.get(taskId);
        if (!task) return null;

        const dependencyState = riskMeta.dependencyByTaskId[taskId];
        const variance = riskMeta.varianceByTaskId[taskId];
        const downstream = riskMeta.downstreamByTaskId.get(taskId) ?? { taskIds: [], maxDepth: 0 };
        const outgoingCount = dependencyState?.outgoingCount ?? 0;
        const incomingCount = dependencyState?.incomingCount ?? 0;
        const conflictCount = (dependencyState?.incomingConflictCount ?? 0) + (dependencyState?.outgoingConflictCount ?? 0);
        const slipDays = variance?.slipDays ?? 0;
        const hasBaseline = Boolean(task.baselineStartDate || task.baselineDueDate || task.baselinePlannedMinutes);
        const score = conflictCount * 120 + outgoingCount * 22 + incomingCount * 10 + slipDays * 12 + (task.priority === "p1" ? 8 : task.priority === "p2" ? 4 : 0);

        return {
          task,
          outgoingCount,
          incomingCount,
          conflictCount,
          slipDays,
          downstreamCount: downstream.taskIds.length,
          downstreamDepth: downstream.maxDepth,
          hasBaseline,
          score,
        };
      })
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
      .sort((left, right) => right.score - left.score || right.downstreamCount - left.downstreamCount || right.outgoingCount - left.outgoingCount || right.slipDays - left.slipDays || left.task.title.localeCompare(right.task.title, "ru"));

    return candidates[0] ?? null;
  }, [allTasksById, riskMeta]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollLeft = 0;
  }, [dayWidth]);

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const repeatSeriesModeLabel = !collapseRepeatSeries ? "full" : repeatExceptionsOnly ? "exceptions" : "compact";
  const nextRepeatSeriesModeLabel = !collapseRepeatSeries ? "compact" : repeatExceptionsOnly ? "full" : "exceptions";
  const cycleRepeatSeriesMode = useCallback(() => {
    if (!collapseRepeatSeries) {
      setCollapseRepeatSeries(true);
      setRepeatExceptionsOnly(false);
      return;
    }

    if (!repeatExceptionsOnly) {
      setRepeatExceptionsOnly(true);
      return;
    }

    setRepeatExceptionsOnly(false);
    setCollapseRepeatSeries(false);
  }, [collapseRepeatSeries, repeatExceptionsOnly]);

  const showCompactRepeatSeries = useCallback(() => {
    setCollapseRepeatSeries(true);
    setRepeatExceptionsOnly(false);
  }, []);

  const toggleRepeatSeriesExpansion = useCallback((seriesKey: string) => {
    setExpandedRepeatSeriesKey((current) => (current === seriesKey ? null : seriesKey));
  }, []);

  useEffect(() => {
    if (!expandedRepeatSeriesKey) return;

    const hasVisibleSeries = derived.orderedRows.some(
      (row) => row.kind === "repeat-series" && row.key === expandedRepeatSeriesKey,
    );

    if (!hasVisibleSeries) {
      setExpandedRepeatSeriesKey(null);
    }
  }, [derived.orderedRows, expandedRepeatSeriesKey]);

  const beginMove = useCallback((event: React.PointerEvent<HTMLButtonElement>, task: Task) => {
    event.preventDefault();
    event.stopPropagation();

    setInteraction({
      taskId: task.id,
      mode: "move",
      startX: event.clientX,
      hasExplicitStartDate: Boolean(task.startDate),
      hasDueDate: Boolean(task.dueDate),
      baseStartDate: fmtISO(resolveTaskStartDate(task)),
      baseDueDate: task.dueDate,
      baseCreatedAt: task.createdAt,
      basePlannedMinutes: task.plannedMinutes,
      offsetDays: 0,
      previewPlannedMinutes: task.plannedMinutes,
      moved: false,
    });
  }, []);

  const beginResizeStart = useCallback((event: React.PointerEvent<HTMLButtonElement>, task: Task) => {
    event.preventDefault();
    event.stopPropagation();

    setInteraction({
      taskId: task.id,
      mode: "resize-start",
      startX: event.clientX,
      hasExplicitStartDate: Boolean(task.startDate),
      hasDueDate: Boolean(task.dueDate),
      baseStartDate: fmtISO(resolveTaskStartDate(task)),
      baseDueDate: task.dueDate,
      baseCreatedAt: task.createdAt,
      basePlannedMinutes: task.plannedMinutes,
      offsetDays: 0,
      previewPlannedMinutes: task.plannedMinutes,
      moved: false,
    });
  }, []);

  const beginResizeEnd = useCallback((event: React.PointerEvent<HTMLButtonElement>, task: Task) => {
    const resizeKind = task.startDate && task.dueDate ? "date" : "duration";
    if (resizeKind === "duration" && !onTaskPlannedMinutesChange) return;

    event.preventDefault();
    event.stopPropagation();

    setInteraction({
      taskId: task.id,
      mode: "resize-end",
      resizeKind,
      startX: event.clientX,
      hasExplicitStartDate: Boolean(task.startDate),
      hasDueDate: Boolean(task.dueDate),
      baseStartDate: fmtISO(resolveTaskStartDate(task)),
      baseDueDate: task.dueDate,
      baseCreatedAt: task.createdAt,
      basePlannedMinutes: task.plannedMinutes ?? 60,
      offsetDays: 0,
      previewPlannedMinutes: task.plannedMinutes ?? 60,
      moved: false,
    });
  }, [onTaskPlannedMinutesChange]);

  const beginDependencyDraft = useCallback((event: React.PointerEvent<HTMLButtonElement>, taskId: string) => {
    if (!onDependencyLinkCreate) return;

    const point = readGridPointer(event.clientX, event.clientY);
    if (!point) return;

    event.preventDefault();
    event.stopPropagation();

    setDependencyDraft({
      taskId,
      pointerX: point.x,
      pointerY: point.y,
      hoveredTaskId: null,
      hoveredInvalidTaskId: null,
      moved: false,
    });
  }, [onDependencyLinkCreate, readGridPointer]);

  useEffect(() => {
    if (!interaction) return;

    const handlePointerMove = (event: PointerEvent) => {
      const viewport = viewportRef.current;
      if (viewport) {
        const rect = viewport.getBoundingClientRect();
        if (event.clientX < rect.left + AUTO_SCROLL_EDGE) {
          viewport.scrollLeft -= Math.ceil((rect.left + AUTO_SCROLL_EDGE - event.clientX) / 6);
        } else if (event.clientX > rect.right - AUTO_SCROLL_EDGE) {
          viewport.scrollLeft += Math.ceil((event.clientX - (rect.right - AUTO_SCROLL_EDGE)) / 6);
        }
      }

      const deltaX = event.clientX - interaction.startX;

      if (
        interaction.mode === "move"
        || interaction.mode === "resize-start"
        || (interaction.mode === "resize-end" && interaction.resizeKind === "date")
      ) {
        const offsetDays = Math.round(deltaX / dayWidth);
        setInteraction((current) =>
          current
            ? {
                ...current,
                offsetDays,
                moved: current.moved || Math.abs(deltaX) > 3,
              }
            : null,
        );
        return;
      }

      const baseMinutes = interaction.basePlannedMinutes ?? 60;
      const nextMinutes = roundToQuarterHour(baseMinutes + (deltaX / dayWidth) * WORKDAY_MINUTES);
      setInteraction((current) =>
        current
          ? {
              ...current,
              previewPlannedMinutes: nextMinutes,
              moved: current.moved || Math.abs(deltaX) > 3,
            }
          : null,
      );
    };

    const handlePointerUp = () => {
      if (interaction.mode === "move" && interaction.offsetDays !== 0) {
        const shiftedStart = addDays(parseDay(interaction.baseStartDate) ?? d0(new Date(interaction.baseCreatedAt)), interaction.offsetDays);

        if (interaction.hasExplicitStartDate) {
          const patch: { startDate?: string; dueDate?: string } = {
            startDate: fmtISO(shiftedStart),
          };

          if (interaction.hasDueDate && interaction.baseDueDate) {
            patch.dueDate = fmtISO(addDays(parseDay(interaction.baseDueDate) ?? shiftedStart, interaction.offsetDays));
          }

          onTaskRangeChange(interaction.taskId, patch);
        } else if (interaction.hasDueDate && interaction.baseDueDate) {
          onTaskRangeChange(interaction.taskId, {
            dueDate: fmtISO(addDays(parseDay(interaction.baseDueDate) ?? shiftedStart, interaction.offsetDays)),
          });
        } else if (interaction.basePlannedMinutes) {
          onTaskRangeChange(interaction.taskId, {
            startDate: fmtISO(shiftedStart),
          });
        } else {
          onTaskRangeChange(interaction.taskId, {
            dueDate: fmtISO(shiftedStart),
          });
        }
      }

      if (interaction.mode === "resize-start" && interaction.offsetDays !== 0) {
        const nextStart = clampStartDate(
          addDays(parseDay(interaction.baseStartDate) ?? d0(new Date(interaction.baseCreatedAt)), interaction.offsetDays),
          interaction.baseDueDate,
        );
        const nextStartValue = fmtISO(nextStart);

        if (!interaction.hasExplicitStartDate || nextStartValue !== interaction.baseStartDate) {
          onTaskRangeChange(interaction.taskId, { startDate: nextStartValue });
        }
      }

      if (interaction.mode === "resize-end") {
        if (interaction.resizeKind === "date" && interaction.baseDueDate) {
          const nextDue = clampDueDate(
            addDays(parseDay(interaction.baseDueDate) ?? d0(new Date(interaction.baseCreatedAt)), interaction.offsetDays),
            interaction.baseStartDate,
          );
          const nextDueValue = fmtISO(nextDue);

          if (nextDueValue !== interaction.baseDueDate) {
            onTaskRangeChange(interaction.taskId, { dueDate: nextDueValue });
          }
        } else if (
          onTaskPlannedMinutesChange
          && interaction.previewPlannedMinutes
          && interaction.previewPlannedMinutes !== interaction.basePlannedMinutes
        ) {
          onTaskPlannedMinutesChange(interaction.taskId, interaction.previewPlannedMinutes);
        }
      }

      if (interaction.moved) {
        suppressClickRef.current = interaction.taskId;
        window.setTimeout(() => {
          if (suppressClickRef.current === interaction.taskId) {
            suppressClickRef.current = null;
          }
        }, 180);
      }

      setInteraction(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dayWidth, interaction, onTaskPlannedMinutesChange, onTaskRangeChange]);

  useEffect(() => {
    if (!dependencyDraft) return;

    const handlePointerMove = (event: PointerEvent) => {
      const viewport = viewportRef.current;
      if (viewport) {
        const rect = viewport.getBoundingClientRect();
        if (event.clientX < rect.left + AUTO_SCROLL_EDGE) {
          viewport.scrollLeft -= Math.ceil((rect.left + AUTO_SCROLL_EDGE - event.clientX) / 6);
        } else if (event.clientX > rect.right - AUTO_SCROLL_EDGE) {
          viewport.scrollLeft += Math.ceil((event.clientX - (rect.right - AUTO_SCROLL_EDGE)) / 6);
        }
      }

      const point = readGridPointer(event.clientX, event.clientY);
      if (!point) return;

      const hover = findDependencyHoverTarget(dependencyDraft.taskId, point.x, point.y);

      setDependencyDraft((current) =>
        current
          ? {
              ...current,
              pointerX: point.x,
              pointerY: point.y,
              hoveredTaskId: hover.hoveredTaskId,
              hoveredInvalidTaskId: hover.hoveredInvalidTaskId,
              moved:
                current.moved
                || Math.abs(point.x - current.pointerX) > 2
                || Math.abs(point.y - current.pointerY) > 2,
            }
          : null,
      );
    };

    const handlePointerUp = () => {
      if (dependencyDraft.hoveredTaskId && onDependencyLinkCreate) {
        onDependencyLinkCreate(dependencyDraft.taskId, dependencyDraft.hoveredTaskId);
      }

      if (dependencyDraft.moved) {
        suppressClickRef.current = dependencyDraft.taskId;
        window.setTimeout(() => {
          if (suppressClickRef.current === dependencyDraft.taskId) {
            suppressClickRef.current = null;
          }
        }, 180);
      }

      setDependencyDraft(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dependencyDraft, findDependencyHoverTarget, onDependencyLinkCreate, readGridPointer]);

  const openTaskInList = useCallback((taskId: string) => {
    if (suppressClickRef.current === taskId) return;

    const node = document.getElementById(`task-card-${taskId}`);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const totalOpenTasks = useMemo(
    () => displayGroups.reduce((sum, group) => sum + group.openCount, 0),
    [displayGroups],
  );

  return (
    <div className="space-y-3 rounded-3xl border border-zinc-800/70 bg-zinc-950/45 p-3 shadow-[0_20px_60px_rgba(0,0,0,0.18)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-zinc-100">Гант по категориям и подзадачам</p>
          <p className="mt-1 text-[11px] text-zinc-500">
            Виден весь список без внутренней вертикальной прокрутки. Тяни бар — сдвигаешь диапазон, левый край задаёт старт, правый — финиш или длительность.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRiskOnly((current) => !current)}
            aria-pressed={showRiskOnly}
            className={`rounded-xl border px-3 py-1.5 text-[11px] font-medium transition ${
              showRiskOnly
                ? "border-rose-400/40 bg-rose-500/12 text-rose-100"
                : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100"
            }`}
            title="Оставить только задачи с drift по baseline или участием в blocker chain"
          >
            Риски / цепочка · {riskMeta.relevantTaskIds.size}
          </button>
          <button
            type="button"
            onClick={() => setShowCriticalChainOnly((current) => !current)}
            aria-pressed={showCriticalChainOnly}
            className={`rounded-xl border px-3 py-1.5 text-[11px] font-medium transition ${
              showCriticalChainOnly
                ? "border-fuchsia-400/40 bg-fuchsia-500/12 text-fuchsia-100"
                : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100"
            }`}
            title="Оставить только задачи из critical chain вокруг drift/conflict узлов"
          >
            Critical chain · {riskMeta.criticalTaskIds.size}
          </button>
          <button
            type="button"
            onClick={() => setShowDependencies((current) => !current)}
            aria-pressed={showDependencies}
            className={`rounded-xl border px-3 py-1.5 text-[11px] font-medium transition ${
              showDependencies
                ? "border-cyan-400/40 bg-cyan-500/12 text-cyan-100"
                : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100"
            }`}
            title="Показать finish-to-start связи между задачами"
          >
            Зависимости · {dependencyLinks.length}
          </button>
          <button
            type="button"
            onClick={() => setShowBaseline((current) => !current)}
            aria-pressed={showBaseline}
            className={`rounded-xl border px-3 py-1.5 text-[11px] font-medium transition ${
              showBaseline
                ? "border-zinc-300/35 bg-zinc-200/10 text-zinc-100"
                : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100"
            }`}
            title="Показать baseline-план до первого сдвига диапазона"
          >
            Baseline
          </button>
          <button
            type="button"
            onClick={cycleRepeatSeriesMode}
            aria-pressed={collapseRepeatSeries}
            className={`rounded-xl border px-3 py-1.5 text-[11px] font-medium transition ${
              repeatExceptionsOnly
                ? "border-fuchsia-400/35 bg-fuchsia-500/12 text-fuchsia-100"
                : collapseRepeatSeries
                  ? "border-violet-400/35 bg-violet-500/12 text-violet-100"
                : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100"
            }`}
            title={`Переключить режим повторов: следующий — ${nextRepeatSeriesModeLabel}`}
          >
            Повторы · {repeatSeriesModeLabel}
            {derived.repeatSeriesCount > 0 ? ` · ${derived.repeatSeriesCount}` : ""}
            {repeatExceptionsOnly && derived.hiddenStableRepeatSeriesCount > 0
              ? ` · скрыто ${derived.hiddenStableRepeatSeriesCount}`
              : ""}
          </button>
          <button
            type="button"
            onClick={() => setShowPlanVsSlot((current) => !current)}
            aria-pressed={showPlanVsSlot}
            className={`rounded-xl border px-3 py-1.5 text-[11px] font-medium transition ${
              showPlanVsSlot
                ? "border-sky-400/40 bg-sky-500/12 text-sky-100"
                : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100"
            }`}
            title="Подсветить соотношение планового диапазона и реального календарного слота"
          >
            План ↔ слот
          </button>
          <button
            type="button"
            onClick={() => setShowNoEstimateOnly((current) => !current)}
            aria-pressed={showNoEstimateOnly}
            className={`rounded-xl border px-3 py-1.5 text-[11px] font-medium transition ${
              showNoEstimateOnly
                ? "border-amber-400/40 bg-amber-500/12 text-amber-100"
                : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100"
            }`}
            title="Сфокусироваться на задачах без plannedMinutes"
          >
            Без оценки · {noEstimateCount}
          </button>
          {(Object.entries(ZOOM_OPTIONS) as Array<[ZoomLevel, (typeof ZOOM_OPTIONS)[ZoomLevel]]>).map(([key, option]) => {
            const active = zoom === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setZoom(key)}
                title={option.hint}
                aria-pressed={active}
                className={`rounded-xl border px-3 py-1.5 text-[11px] font-medium transition ${
                  active
                    ? "border-zinc-100 bg-zinc-100 text-zinc-950"
                    : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100"
                }`}
              >
                {option.label}
              </button>
            );
          })}
          <span className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-[11px] text-zinc-500">
            {totalOpenTasks} задач
          </span>
          {riskMeta.slippedTaskIds.size > 0 && (
            <span className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-[11px] text-rose-200">
              Δ {riskMeta.slippedTaskIds.size}
            </span>
          )}
          {riskMeta.conflictedTaskIds.size > 0 && (
            <span className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-200">
              chain ⚠ {riskMeta.conflictedTaskIds.size}
            </span>
          )}
          {riskMeta.criticalTaskIds.size > 0 && (
            <span className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/10 px-3 py-1.5 text-[11px] text-fuchsia-100">
              critical {riskMeta.criticalTaskIds.size}
            </span>
          )}
        </div>
      </div>

      {bottleneckSummary && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/8 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-fuchsia-200/80">главный bottleneck недели</p>
            <p className="mt-1 truncate text-sm font-medium text-zinc-50">{bottleneckSummary.task.title}</p>
            <p className="mt-1 text-[11px] text-zinc-300">
              {bottleneckSummary.downstreamCount > 0 ? `под риском ${bottleneckSummary.downstreamCount} задач` : bottleneckSummary.outgoingCount > 0 ? `сдвинет ${bottleneckSummary.outgoingCount} задач` : "пока никого не сдвигает"}
              {bottleneckSummary.downstreamDepth > 1 ? ` · глубина ${bottleneckSummary.downstreamDepth}` : ""}
              {bottleneckSummary.outgoingCount > 0 && bottleneckSummary.downstreamCount > bottleneckSummary.outgoingCount ? ` · прямых ${bottleneckSummary.outgoingCount}` : ""}
              {bottleneckSummary.incomingCount > 0 ? ` · ждёт ${bottleneckSummary.incomingCount}` : ""}
              {bottleneckSummary.slipDays > 0 ? ` · Δ ${formatSignedDayDelta(bottleneckSummary.slipDays)}` : ""}
              {bottleneckSummary.conflictCount > 0 ? ` · chain conflict ${bottleneckSummary.conflictCount}` : ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => openTaskInList(bottleneckSummary.task.id)}
              className="rounded-xl border border-zinc-700 bg-zinc-900/60 px-3 py-1.5 text-[11px] text-zinc-100 transition hover:border-zinc-500"
            >
              К задаче
            </button>
            {onTaskBaselineReset && bottleneckSummary.hasBaseline && (
              <button
                type="button"
                onClick={() => onTaskBaselineReset(bottleneckSummary.task.id)}
                className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-100 transition hover:border-amber-400/30"
                title="Вернуть диапазон bottleneck-задачи к baseline"
              >
                ↺ Reset baseline
              </button>
            )}
            {onTaskBaselineRebase && (
              <button
                type="button"
                onClick={() => onTaskBaselineRebase(bottleneckSummary.task.id)}
                className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/10 px-3 py-1.5 text-[11px] text-fuchsia-100 transition hover:border-fuchsia-400/30"
                title="Сделать текущий план bottleneck-задачи новым baseline"
              >
                ◎ Rebase baseline
              </button>
            )}
          </div>
        </div>
      )}

      {interactionImpact && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/8 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-cyan-100/80">preview последствий</p>
            <p className="mt-1 truncate text-sm font-medium text-zinc-50">{interactionImpact.taskTitle}</p>
            <p className="mt-1 text-[11px] text-zinc-300">
              {interactionImpact.deltaLabel} · {interactionImpact.summaryLabel}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-300">
            {interactionImpact.downstreamCount > 0 && (
              <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-1 text-violet-100">
                ↠ цепочка {interactionImpact.downstreamCount}
              </span>
            )}
            {interactionImpact.downstreamDepth > 1 && (
              <span className="rounded-full border border-fuchsia-500/20 bg-fuchsia-500/10 px-2 py-1 text-fuchsia-100">
                глубина {interactionImpact.downstreamDepth}
              </span>
            )}
            {interactionImpact.activeOutgoingConflictCount > 0 && (
              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-amber-200">
                ⚠ вниз {interactionImpact.activeOutgoingConflictCount}
              </span>
            )}
            {interactionImpact.activeIncomingConflictCount > 0 && (
              <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-cyan-100">
                ⛓ сверху {interactionImpact.activeIncomingConflictCount}
              </span>
            )}
          </div>
        </div>
      )}

      {repeatExceptionsOnly && derived.hiddenStableRepeatSeriesCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-500/20 bg-violet-500/8 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-violet-100/80">repeat exceptions mode</p>
            <p className="mt-1 text-sm font-medium text-zinc-50">
              Стабильный ритм убран в фон: скрыто {derived.hiddenStableRepeatSeriesCount} серий / {derived.hiddenStableRepeatTaskCount} повторов
            </p>
            <p className="mt-1 text-[11px] text-zinc-300">
              На виду остались только серии со сбитым ритмом, drift по baseline, slot mismatch или зависимостями.
            </p>
          </div>

          <button
            type="button"
            onClick={showCompactRepeatSeries}
            className="rounded-xl border border-violet-400/30 bg-violet-500/12 px-3 py-1.5 text-[11px] text-violet-100 transition hover:border-violet-300/40"
          >
            Показать compact
          </button>
        </div>
      )}

      <div className="overflow-x-auto overflow-y-visible rounded-2xl border border-zinc-800/60 bg-zinc-950/65" ref={viewportRef}>
        <div style={{ minWidth: LABEL_W + gridWidth }}>
          <div className="sticky top-0 z-20 bg-zinc-950/96 backdrop-blur-sm">
            <div className="flex border-b border-zinc-800/60">
              <div
                className="sticky left-0 z-30 shrink-0 border-r border-zinc-800/70 bg-zinc-950/96 px-3 text-[11px] font-medium text-zinc-500"
                style={{ width: LABEL_W, lineHeight: "52px" }}
              >
                Задачи
              </div>
              <div style={{ width: gridWidth }}>
                <div className="flex h-6 border-b border-zinc-800/45">
                  {months.map((month) => (
                    <div
                      key={`${month.left}-${month.label}`}
                      className="border-r border-zinc-800/35 px-2 text-[10px] font-medium leading-6 text-zinc-500"
                      style={{ width: month.width }}
                    >
                      {month.label}
                    </div>
                  ))}
                </div>

                <div className="flex h-7 border-b border-zinc-800/45">
                  {days.map((day, index) => (
                    <div
                      key={fmtISO(day)}
                      className={`border-r text-center text-[9px] leading-7 ${
                        index === todayIndex
                          ? "border-amber-500/30 bg-amber-500/10 font-semibold text-amber-300"
                          : isWeekend(day)
                            ? "border-zinc-800/25 bg-zinc-900/40 text-zinc-600"
                            : "border-zinc-800/25 text-zinc-600"
                      }`}
                      style={{ width: dayWidth }}
                    >
                      {day.getDate()}
                    </div>
                  ))}
                </div>

                <div className="flex h-5 border-b border-zinc-800/45 bg-zinc-950/40">
                  {dayMetrics.map((metric, index) => {
                    const load = metric.load;
                    const heightPct = loadScaleMax > 0 ? Math.max((load / loadScaleMax) * 100, load > 0 ? 12 : 0) : 0;
                    const capacityPct = loadScaleMax > 0 ? (metric.capacity / loadScaleMax) * 100 : 0;
                    return (
                      <div
                        key={`load-${index}`}
                        className={`relative border-r border-zinc-800/20 ${isWeekend(days[index]) ? "bg-zinc-900/35" : ""}`}
                        style={{ width: dayWidth }}
                        title={load > 0 ? `${Math.round(load)} / ${metric.capacity} мин нагрузки` : `Пусто · capacity ${metric.capacity}м`}
                      >
                        {metric.heatOverlay && (
                          <div
                            className="absolute inset-0"
                            style={{ backgroundColor: metric.heatOverlay }}
                          />
                        )}
                        {load > 0 && (
                          <div
                            className="absolute bottom-0 left-[20%] w-[60%] rounded-t"
                            style={{ backgroundColor: metric.loadBarColor, height: `${heightPct}%` }}
                          />
                        )}
                        {(riskMeta.dependencyHeatByDay[index] ?? 0) > 0 && (
                          <div
                            className="absolute left-[18%] top-0 w-[64%] rounded-b"
                            style={{
                              backgroundColor: (riskMeta.dependencyConflictHeatByDay[index] ?? 0) > 0
                                ? "rgba(251, 191, 36, 0.88)"
                                : "rgba(103, 232, 249, 0.72)",
                              height: `${Math.max(
                                (((riskMeta.dependencyConflictHeatByDay[index] ?? 0) > 0
                                  ? riskMeta.dependencyConflictHeatByDay[index]
                                  : riskMeta.dependencyHeatByDay[index]) /
                                  Math.max(maxDependencyHeat, 1)) * 38,
                                2,
                              )}%`,
                            }}
                          />
                        )}
                        {(riskMeta.criticalChainHeatByDay[index] ?? 0) > 0 && (
                          <div
                            className="absolute right-[8%] top-0 w-[14%] rounded-b"
                            style={{
                              backgroundColor: "rgba(232, 121, 249, 0.82)",
                              height: `${Math.max(((riskMeta.criticalChainHeatByDay[index] ?? 0) / Math.max(maxCriticalChainHeat, 1)) * 46, 3)}%`,
                            }}
                          />
                        )}
                        <div
                          className="absolute left-[12%] right-[12%] h-px rounded-full"
                          style={{
                            bottom: `calc(${capacityPct}% - 0.5px)`,
                            backgroundColor: metric.capacityLineColor,
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="relative" style={{ minHeight: derived.bodyHeight }} ref={gridBodyRef}>
            <div
              className="pointer-events-none absolute top-0"
              style={{ left: LABEL_W, width: gridWidth, height: derived.bodyHeight }}
            >
              {days.map((day, index) => (
                <div
                  key={`bg-${fmtISO(day)}`}
                  className={`absolute top-0 bottom-0 border-r border-zinc-800/15 ${isWeekend(day) ? "bg-zinc-900/35" : ""}`}
                  style={{ left: index * dayWidth, width: dayWidth }}
                />
              ))}
            </div>

            <div
              className="pointer-events-none absolute top-0"
              style={{ left: LABEL_W, width: gridWidth, height: derived.bodyHeight }}
            >
              {dayMetrics.map((metric, index) =>
                metric.heatOverlay ? (
                  <div
                    key={`heat-${index}`}
                    className="absolute top-0 bottom-0"
                    style={{
                      left: index * dayWidth,
                      width: dayWidth,
                      backgroundColor: metric.heatOverlay,
                    }}
                  />
                ) : null,
              )}
            </div>

            <div className="pointer-events-none absolute inset-0">
              {derived.groupSections.map((section) => {
                const surface = groupSurfaceTone(section.group);
                return (
                  <div
                    key={section.key}
                    className="absolute rounded-[20px] border"
                    style={{
                      left: 0,
                      top: section.top + 1,
                      width: LABEL_W + gridWidth,
                      height: Math.max(section.height - 2, GROUP_H - 2),
                      background: surface.sectionBg,
                      borderColor: surface.borderColor,
                    }}
                  />
                );
              })}
            </div>

            {(renderableDependencyLinks.length > 0 || dependencyDraftPreview) && (
              <svg
                className="absolute top-0"
                style={{ left: LABEL_W, width: gridWidth, height: derived.bodyHeight, zIndex: 8 }}
              >
                <defs>
                  <marker
                    id="gantt-dependency-arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
                  </marker>
                </defs>
                {renderableDependencyLinks.map((link) => (
                  <g key={`${link.fromTaskId}-${link.toTaskId}`}>
                    {onDependencyLinkRemove && (
                      <path
                        d={link.path}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={10}
                        className="cursor-pointer"
                        onClick={() => onDependencyLinkRemove(link.toTaskId, link.fromTaskId)}
                      />
                    )}
                    <path
                      d={link.path}
                      fill="none"
                      stroke={link.blocked ? "rgba(251, 191, 36, 0.8)" : link.critical ? "rgba(232, 121, 249, 0.78)" : "rgba(103, 232, 249, 0.58)"}
                      strokeDasharray={link.blocked ? "5 4" : link.critical ? "6 3" : "4 3"}
                      strokeWidth={link.critical ? 2 : 1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      markerEnd="url(#gantt-dependency-arrow)"
                    />
                    <circle
                      cx={link.dotX}
                      cy={link.dotY}
                      r={3}
                      fill={link.blocked ? "rgba(251, 191, 36, 0.9)" : link.critical ? "rgba(244, 114, 182, 0.92)" : "rgba(165, 243, 252, 0.9)"}
                    />
                    <title>
                      {onDependencyLinkRemove
                        ? "Клик по стрелке — убрать зависимость"
                        : "Зависимость finish → start"}
                    </title>
                  </g>
                ))}
                {dependencyDraftPreview && (
                  <g className="pointer-events-none">
                    <path
                      d={dependencyDraftPreview.path}
                      fill="none"
                      stroke={
                        dependencyDraftPreview.tone === "valid"
                          ? "rgba(103, 232, 249, 0.92)"
                          : dependencyDraftPreview.tone === "invalid"
                            ? "rgba(251, 191, 36, 0.92)"
                            : "rgba(228, 228, 231, 0.58)"
                      }
                      strokeDasharray={dependencyDraftPreview.tone === "valid" ? "5 4" : "4 4"}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      markerEnd="url(#gantt-dependency-arrow)"
                    />
                    <circle
                      cx={dependencyDraftPreview.lineEndX}
                      cy={dependencyDraftPreview.lineEndY}
                      r={3.5}
                      fill={
                        dependencyDraftPreview.tone === "valid"
                          ? "rgba(103, 232, 249, 0.98)"
                          : dependencyDraftPreview.tone === "invalid"
                            ? "rgba(251, 191, 36, 0.98)"
                            : "rgba(212, 212, 216, 0.82)"
                      }
                    />
                  </g>
                )}
              </svg>
            )}

            <div
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-amber-400/55"
              style={{ left: LABEL_W + todayIndex * dayWidth + Math.floor(dayWidth / 2), zIndex: 15 }}
            />

            <div className="relative z-10">
              {derived.orderedRows.map((row) => {
                if (row.kind === "group") {
                  const tone = groupBarTone(row.group);
                  const surface = groupSurfaceTone(row.group);
                  const groupRisk = groupRiskStatsByGroupId[row.group.id] ?? {
                    slipCount: 0,
                    blockedCount: 0,
                    blockerCount: 0,
                    conflictCount: 0,
                    criticalCount: 0,
                  };
                  const collapsed = collapsedGroups.has(row.group.id);

                  return (
                    <div key={row.key} className="flex border-b border-zinc-800/30" style={{ height: GROUP_H }}>
                      <button
                        type="button"
                        onClick={() => toggleGroup(row.group.id)}
                        className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-zinc-800/40 px-3 text-[11px] font-semibold text-zinc-100 transition hover:brightness-110"
                        style={{ width: LABEL_W, background: surface.headerBg }}
                      >
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${groupDotCls(row.group)}`} />
                        <span className="truncate text-left">{row.group.label}</span>
                        {groupRisk.slipCount > 0 && (
                          <span className="shrink-0 rounded-full border border-rose-500/20 bg-rose-500/10 px-1.5 py-0.5 text-[8px] text-rose-200">
                            Δ {groupRisk.slipCount}
                          </span>
                        )}
                        {(groupRisk.blockedCount > 0 || groupRisk.blockerCount > 0) && (
                          <span className="shrink-0 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-0.5 text-[8px] text-cyan-100">
                            ⛓ {groupRisk.blockedCount + groupRisk.blockerCount}
                          </span>
                        )}
                        {groupRisk.conflictCount > 0 && (
                          <span className="shrink-0 rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[8px] text-amber-200">
                            ⚠ {groupRisk.conflictCount}
                          </span>
                        )}
                        {groupRisk.criticalCount > 0 && (
                          <span className="shrink-0 rounded-full border border-fuchsia-500/20 bg-fuchsia-500/10 px-1.5 py-0.5 text-[8px] text-fuchsia-100">
                            ✦ {groupRisk.criticalCount}
                          </span>
                        )}
                        <span className="ml-auto shrink-0 text-[10px] text-zinc-500">{row.group.openCount}</span>
                        <span className="shrink-0 text-[10px] text-zinc-600">{collapsed ? "▸" : "▾"}</span>
                      </button>

                      <div className="relative" style={{ width: gridWidth }}>
                        {row.rollupSpan && (
                          <div
                            className={`absolute top-1/2 -translate-y-1/2 rounded-full border ${tone.bg} ${tone.border} opacity-55`}
                            style={{ left: row.rollupSpan.left, width: row.rollupSpan.width, height: 10 }}
                          />
                        )}
                      </div>
                    </div>
                  );
                }

                if (row.kind === "repeat-series") {
                  const group = row.group;
                  const surface = groupSurfaceTone(group);
                  const baseTone = groupBarTone(group);
                  const firstTask = row.tasks[0]!;
                  const isExpanded = expandedRepeatSeriesKey === row.key;
                  const priorityTone =
                    firstTask.priority === "p1"
                      ? "text-rose-400"
                      : firstTask.priority === "p2"
                        ? "text-amber-400"
                        : "text-zinc-600";
                  const {
                    firstLabel,
                    lastLabel,
                    noEstimateCount,
                    seriesHealthLabel,
                    tooltip: seriesTooltip,
                    cadenceBreakTaskIds,
                    slippedTaskIds,
                    overdueTaskIds,
                    slotOutsideTaskIds,
                    criticalTaskIds,
                    dependencyTaskIds,
                    exceptionTaskIds,
                    cadenceBreakCount,
                    slippedCount,
                    overdueCount,
                    slotOutsideCount,
                    criticalCount,
                    dependencyCount,
                  } = row.health;

                  return (
                    <div key={row.key} className="flex border-b border-zinc-800/20" style={{ height: ROW_H }}>
                      <div
                        className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-zinc-800/30 px-2"
                        style={{ width: LABEL_W, paddingLeft: 10 + row.depth * 14, background: surface.labelBg }}
                        title={seriesTooltip}
                      >
                        <button
                          type="button"
                          onClick={() => toggleRepeatSeriesExpansion(row.key)}
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[10px] transition hover:brightness-110"
                          title={isExpanded ? "Свернуть серию" : "Раскрыть серию"}
                        >
                          <span className="shrink-0 text-[10px] text-zinc-500">{isExpanded ? "▾" : "▸"}</span>
                          <span className={`shrink-0 font-bold uppercase ${priorityTone}`} style={{ fontSize: 8 }}>
                            {firstTask.priority}
                          </span>
                          <span className="shrink-0 rounded-full border border-violet-500/20 bg-violet-500/10 px-1.5 py-0.5 text-[8px] text-violet-100">
                            ∿ серия ×{row.tasks.length}
                          </span>
                          <span className="truncate text-zinc-300">{firstTask.title}</span>
                          {seriesHealthLabel && (
                            <span className="shrink-0 rounded-full border border-zinc-700/70 bg-zinc-900/60 px-1.5 py-0.5 text-[8px] text-zinc-300">
                              {seriesHealthLabel}
                            </span>
                          )}
                          {noEstimateCount > 0 && (
                            <span className="shrink-0 rounded-full border border-dashed border-amber-400/35 bg-amber-500/10 px-1.5 py-0.5 text-[8px] text-amber-200">
                              без оценки {noEstimateCount}
                            </span>
                          )}
                          {cadenceBreakCount > 0 && (
                            <span className="shrink-0 rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[8px] text-amber-200">
                              ⚠ ритм {cadenceBreakCount}
                            </span>
                          )}
                          {slippedCount > 0 && (
                            <span className="shrink-0 rounded-full border border-rose-500/20 bg-rose-500/10 px-1.5 py-0.5 text-[8px] text-rose-200">
                              Δ {slippedCount}
                            </span>
                          )}
                          {overdueCount > 0 && (
                            <span className="shrink-0 rounded-full border border-rose-500/20 bg-rose-500/10 px-1.5 py-0.5 text-[8px] text-rose-200">
                              ⌛ {overdueCount}
                            </span>
                          )}
                          {slotOutsideCount > 0 && (
                            <span className="shrink-0 rounded-full border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-[8px] text-sky-200">
                              ↔ слот {slotOutsideCount}
                            </span>
                          )}
                          {criticalCount > 0 && (
                            <span className="shrink-0 rounded-full border border-fuchsia-500/20 bg-fuchsia-500/10 px-1.5 py-0.5 text-[8px] text-fuchsia-100">
                              ✦ {criticalCount}
                            </span>
                          )}
                          {dependencyCount > 0 && (
                            <span className="shrink-0 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-0.5 text-[8px] text-cyan-100">
                              ⛓ {dependencyCount}
                            </span>
                          )}
                          {(firstLabel || lastLabel) && (
                            <span className="shrink-0 rounded-full border border-zinc-700/70 bg-zinc-900/60 px-1.5 py-0.5 text-[8px] text-zinc-400">
                              {firstLabel ?? "?"}{lastLabel && lastLabel !== firstLabel ? ` → ${lastLabel}` : ""}
                            </span>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => openTaskInList(firstTask.id)}
                          className="shrink-0 rounded-full border border-zinc-700/70 bg-zinc-900/65 px-1.5 py-0.5 text-[8px] text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
                          title="Прыжок к первому элементу серии в списке задач"
                        >
                          ↗
                        </button>
                      </div>

                      <div className="relative" style={{ width: gridWidth }}>
                        {row.combinedSpan && (
                          <div
                            className={`pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full border border-dashed ${baseTone.border} ${baseTone.bg} opacity-35`}
                            style={{ left: row.combinedSpan.left, width: row.combinedSpan.width, height: 8 }}
                          />
                        )}

                        {row.visuals.map(({ task, visual }) => {
                          const isCadenceBreak = cadenceBreakTaskIds.has(task.id);
                          const isSlipped = slippedTaskIds.has(task.id);
                          const isOverdue = overdueTaskIds.has(task.id);
                          const isSlotOutside = slotOutsideTaskIds.has(task.id);
                          const isCritical = criticalTaskIds.has(task.id);
                          const isDependencyTouch = dependencyTaskIds.has(task.id);
                          const isException = exceptionTaskIds.has(task.id);
                          const compactWidth = visual.kind === "marker"
                            ? 10
                            : Math.max(Math.min(visual.width, 24), 12);
                          const markerWidth = isException || isDependencyTouch ? Math.max(compactWidth, 14) : compactWidth;
                          const compactLeft = visual.left + Math.max((visual.width - markerWidth) / 2, 0);
                          const markerTone = isOverdue
                            ? "border-rose-300/45 bg-rose-300/85"
                            : isCadenceBreak
                              ? "border-amber-300/45 bg-amber-300/85"
                              : isSlotOutside
                                ? "border-sky-300/45 bg-sky-300/85"
                                : isSlipped
                                  ? "border-fuchsia-300/45 bg-fuchsia-300/85"
                                  : isCritical
                                    ? "border-cyan-300/45 bg-cyan-300/80"
                                    : isDependencyTouch
                                      ? "border-violet-300/40 bg-violet-300/75"
                                    : `${baseTone.bg} ${baseTone.border}`;
                          const markerOpacity = isException || isDependencyTouch ? "opacity-95" : "opacity-55";
                          const markerHeight = isException ? 16 : isDependencyTouch ? 14 : 12;

                          return (
                            <div
                              key={`${row.key}:${task.id}`}
                              className={`pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full border ${markerTone} ${markerOpacity}`}
                              style={{ left: compactLeft, width: markerWidth, height: markerHeight }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                }

                const task = row.task;
                const group = row.group;
                const surface = groupSurfaceTone(group);
                const interactionForTask = interaction?.taskId === task.id ? interaction : null;
                const previewTask = buildPreviewTask(task, interactionForTask);
                const previewVisual = buildVisual(previewTask);
                const baselineTask = buildBaselineTask(task);
                const baselineVisual = showBaseline && baselineTask ? buildVisual(baselineTask) : undefined;
                const showBaselineVisual = Boolean(
                  baselineVisual
                  && (Math.abs(baselineVisual.left - previewVisual.left) > 1 || Math.abs(baselineVisual.width - previewVisual.width) > 1),
                );
                const variance = riskMeta.varianceByTaskId[task.id];
                const scheduledSlot = scheduledSlotsByTaskId[task.id];
                const scheduledSlotVisual = scheduledSlot
                  ? computeScheduledSlotVisual(scheduledSlot, timelineStart, totalDays, dayWidth)
                  : undefined;
                const baseTone = groupBarTone(group);
                const urgencyTone = taskUrgencyTone(previewTask, today);
                const priorityTone =
                  task.priority === "p1"
                    ? "text-rose-400"
                    : task.priority === "p2"
                      ? "text-amber-400"
                      : "text-zinc-600";
                const planned = durationLabel(previewTask.plannedMinutes);
                const isNoEstimate = !task.plannedMinutes;
                const progress = progressByTaskId[task.id];
                const progressPct = progress ? Math.max(progress.ratio * 100, progress.done > 0 ? 8 : 0) : 0;
                const progressLabel = progress && progress.total > 0 ? `${progress.done}/${progress.total}` : null;
                const dependencyState = riskMeta.dependencyByTaskId[task.id];
                const incomingDependencyCount = dependencyState?.incomingCount ?? 0;
                const outgoingDependencyCount = dependencyState?.outgoingCount ?? 0;
                const dependencyConflictCount = (dependencyState?.incomingConflictCount ?? 0) + (dependencyState?.outgoingConflictCount ?? 0);
                const isCriticalChainTask = riskMeta.criticalTaskIds.has(task.id);
                const hasBaselineSnapshot = Boolean(task.baselineStartDate || task.baselineDueDate || task.baselinePlannedMinutes);
                const slipDays = variance?.slipDays ?? 0;
                const gainDays = variance?.gainDays ?? 0;
                const barRiskTone = dependencyConflictCount > 0
                  ? "ring-1 ring-amber-300/35"
                  : isCriticalChainTask
                    ? "ring-1 ring-fuchsia-300/25"
                  : incomingDependencyCount > 0
                    ? "ring-1 ring-cyan-300/25"
                    : outgoingDependencyCount > 0
                      ? "ring-1 ring-violet-300/20"
                      : slipDays > 0
                        ? "ring-1 ring-rose-300/30"
                        : gainDays > 0
                          ? "ring-1 ring-emerald-300/20"
                          : "";
                const slotTone = scheduledSlot
                  ? { bg: SLOT_BG[scheduledSlot.tone], border: SLOT_BD[scheduledSlot.tone] }
                  : null;
                const showRollup = row.hasChildren && row.rollupSpan && row.rollupSpan.width > previewVisual.width + 8;
                const taskTooltip = buildTaskTooltipWithProgress(previewTask, scheduledSlot, progress);
                const overdueTail = getOverdueTailSpan(previewTask, timelineStart, today, totalDays, dayWidth);
                const canResizeStart = Boolean(task.dueDate);
                const canResizeEnd = Boolean(task.startDate && task.dueDate) || Boolean(task.plannedMinutes && onTaskPlannedMinutesChange);
                const endResizeTitle = task.startDate && task.dueDate
                  ? `Изменить финиш ${task.title}`
                  : `Изменить длительность ${task.title}`;
                const slotOutsidePlan = Boolean(
                  showPlanVsSlot
                    && scheduledSlotVisual
                    && isScheduledSlotOutsidePlan(scheduledSlotVisual, previewVisual),
                );
                const slotOverlayTop = showPlanVsSlot ? 2 : ROW_H - 8;
                const slotOverlayHeight = showPlanVsSlot ? 8 : 5;
                const slotConnectorLeft = scheduledSlotVisual
                  ? Math.min(previewVisual.left + previewVisual.width / 2, scheduledSlotVisual.left + scheduledSlotVisual.width / 2)
                  : 0;
                const slotConnectorWidth = scheduledSlotVisual
                  ? Math.abs((previewVisual.left + previewVisual.width / 2) - (scheduledSlotVisual.left + scheduledSlotVisual.width / 2))
                  : 0;
                const dependencyTargetState = dependencyDraft
                  ? dependencyDraft.taskId === task.id
                    ? "source"
                    : dependencyDraft.hoveredTaskId === task.id
                      ? "valid"
                      : dependencyDraft.hoveredInvalidTaskId === task.id
                        ? "invalid"
                        : null
                  : null;
                const dependencyHandleTargets = dependencyTargetsByTaskId[task.id] ?? [];
                const canCreateDependency = Boolean(onDependencyLinkCreate) && dependencyHandleTargets.length > 0;
                const dependencyAnchorVisual = scheduledSlotVisual ?? previewVisual;
                const dependencyAnchorTop = scheduledSlotVisual ? slotOverlayTop : 4;
                const dependencyAnchorHeight = scheduledSlotVisual ? slotOverlayHeight : ROW_H - 8;
                const dependencyHandleLeft = Math.max(dependencyAnchorVisual.left - 12, 2);
                const dependencyHandleTop = dependencyAnchorTop + dependencyAnchorHeight / 2 - 5;
                const dependencyHighlightTone = dependencyTargetState === "valid"
                  ? "ring-2 ring-cyan-300/40"
                  : dependencyTargetState === "invalid"
                    ? "ring-2 ring-amber-300/35"
                    : dependencyTargetState === "source"
                      ? "ring-2 ring-cyan-100/35"
                      : "";

                return (
                  <div key={row.key} className="flex border-b border-zinc-800/20" style={{ height: ROW_H }}>
                    <div
                      className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-zinc-800/30 px-2 text-[10px]"
                      style={{ width: LABEL_W, paddingLeft: 10 + row.depth * 14, background: surface.labelBg }}
                      title={task.title}
                    >
                      <span className={`shrink-0 font-bold uppercase ${priorityTone}`} style={{ fontSize: 8 }}>
                        {task.priority}
                      </span>
                      {row.hasChildren && <span className="text-zinc-600">▸</span>}
                      <span className="truncate text-zinc-300">{task.title}</span>
                      {isNoEstimate && (
                        <span className="shrink-0 rounded-full border border-dashed border-amber-400/35 bg-amber-500/10 px-1.5 py-0.5 text-[8px] text-amber-200">
                          без оценки
                        </span>
                      )}
                      {planned && (
                        <span className="shrink-0 rounded-full border border-violet-500/20 bg-violet-500/10 px-1.5 py-0.5 text-[8px] text-violet-200">
                          {planned}
                        </span>
                      )}
                      {progressLabel && (
                        <span className="shrink-0 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-1.5 py-0.5 text-[8px] text-emerald-200">
                          ✓ {progressLabel}
                        </span>
                      )}
                      {slipDays > 0 && (
                        <span className="shrink-0 rounded-full border border-rose-500/20 bg-rose-500/10 px-1.5 py-0.5 text-[8px] text-rose-200">
                          {formatSignedDayDelta(slipDays)}
                        </span>
                      )}
                      {slipDays === 0 && gainDays > 0 && (
                        <span className="shrink-0 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[8px] text-emerald-200">
                          {formatSignedDayDelta(-gainDays)}
                        </span>
                      )}
                      {incomingDependencyCount > 0 && (
                        <span className="shrink-0 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-1.5 py-0.5 text-[8px] text-cyan-100">
                          ⛓ ждёт {incomingDependencyCount}
                        </span>
                      )}
                      {outgoingDependencyCount > 0 && (
                        <span className="shrink-0 rounded-full border border-violet-400/20 bg-violet-500/10 px-1.5 py-0.5 text-[8px] text-violet-100">
                          ↠ {outgoingDependencyCount}
                        </span>
                      )}
                      {dependencyConflictCount > 0 && (
                        <span className="shrink-0 rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[8px] text-amber-200">
                          ⚠ chain
                        </span>
                      )}
                      {dependencyConflictCount === 0 && isCriticalChainTask && (
                        <span className="shrink-0 rounded-full border border-fuchsia-500/20 bg-fuchsia-500/10 px-1.5 py-0.5 text-[8px] text-fuchsia-100">
                          ✦ critical
                        </span>
                      )}
                      {showBaseline && hasBaselineSnapshot && (onTaskBaselineReset || onTaskBaselineRebase) && (
                        <span className="ml-0.5 inline-flex shrink-0 items-center gap-1">
                          {onTaskBaselineReset && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onTaskBaselineReset(task.id);
                              }}
                              className="rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[8px] text-amber-100 transition hover:border-amber-400/30"
                              title="Вернуть диапазон к baseline"
                            >
                              ↺
                            </button>
                          )}
                          {onTaskBaselineRebase && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onTaskBaselineRebase(task.id);
                              }}
                              className="rounded-full border border-fuchsia-500/20 bg-fuchsia-500/10 px-1.5 py-0.5 text-[8px] text-fuchsia-100 transition hover:border-fuchsia-400/30"
                              title="Сделать текущий план новым baseline"
                            >
                              ◎
                            </button>
                          )}
                        </span>
                      )}
                    </div>

                    <div className="relative" style={{ width: gridWidth }}>
                      {showRollup && row.rollupSpan && (
                        <div
                          className="absolute top-1/2 -translate-y-1/2 rounded-full border border-dashed border-violet-400/30 bg-violet-500/10"
                          style={{ left: row.rollupSpan.left, width: row.rollupSpan.width, height: 8 }}
                        />
                      )}

                      {showRollup && row.rollupSpan && progress && progress.total > 0 && (
                        <div
                          className="absolute top-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-emerald-500/15"
                          style={{ left: row.rollupSpan.left + 1, width: Math.max((row.rollupSpan.width - 2) * progress.ratio, progress.done > 0 ? 6 : 0), height: 6 }}
                        >
                          <div className="h-full w-full rounded-full bg-emerald-300/70" />
                        </div>
                      )}

                      {overdueTail && (
                        <div
                          className="pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full bg-linear-to-r from-rose-500/10 via-rose-400/55 to-rose-300/20"

                          style={{ left: overdueTail.left, width: overdueTail.width, height: 7 }}
                          title={`Просрочка: ${task.title}`}
                        />
                      )}

                      {showBaselineVisual && baselineVisual && (
                        <div
                          className="pointer-events-none absolute rounded-lg border border-dashed border-zinc-300/25 bg-zinc-200/8"
                          style={{
                            left: baselineVisual.left,
                            width: baselineVisual.width,
                            top: 8,
                            height: ROW_H - 16,
                          }}
                          title="Baseline-план до первого сдвига"
                        />
                      )}

                      {showPlanVsSlot && scheduledSlotVisual && slotOutsidePlan && slotConnectorWidth > 10 && (
                        <div
                          className="pointer-events-none absolute border-t border-dashed border-sky-300/45"
                          style={{
                            left: slotConnectorLeft,
                            width: slotConnectorWidth,
                            top: ROW_H / 2,
                          }}
                        />
                      )}

                      {scheduledSlotVisual && slotTone && (
                        <div
                          className={`pointer-events-none absolute rounded-full border ${slotTone.bg} ${slotTone.border} ${showPlanVsSlot && slotOutsidePlan ? "ring-1 ring-amber-300/35" : ""} ${dependencyHighlightTone}`}
                          style={{
                            left: scheduledSlotVisual.left,
                            width: scheduledSlotVisual.width,
                            top: slotOverlayTop,
                            height: slotOverlayHeight,
                          }}
                          title={`Слот ${scheduledSlot.start}–${scheduledSlot.end}: ${scheduledSlot.title}`}
                        />
                      )}

                      <button
                        type="button"
                        onPointerDown={(event) => beginDependencyDraft(event, task.id)}
                        disabled={!canCreateDependency}
                        className={`absolute z-30 rounded-full border transition ${
                          dependencyTargetState === "source"
                            ? "border-cyan-100/80 bg-cyan-300 shadow-[0_0_0_4px_rgba(34,211,238,0.18)]"
                            : incomingDependencyCount > 0
                              ? "border-cyan-300/50 bg-cyan-300/85 hover:border-cyan-100"
                              : canCreateDependency
                                ? "border-zinc-400/55 bg-zinc-300/75 hover:border-cyan-200 hover:bg-cyan-200"
                                : "border-zinc-800/90 bg-zinc-700/35 opacity-40"
                        }`}
                        style={{
                          left: dependencyHandleLeft,
                          top: dependencyHandleTop,
                          width: 10,
                          height: 10,
                          cursor: canCreateDependency ? "crosshair" : "not-allowed",
                        }}
                        aria-label={`Привязать зависимость для ${task.title}`}
                        title={
                          canCreateDependency
                            ? `Потяни точку к другому бару, чтобы ${task.title} стало зависеть от него`
                            : incomingDependencyCount > 0
                              ? `У ${task.title} уже есть зависимости. Удалить связь можно кликом по стрелке.`
                              : `Для ${task.title} сейчас нет доступных целей для зависимости`
                        }
                      />

                      <button
                        type="button"
                        onClick={() => openTaskInList(task.id)}
                        onPointerDown={(event) => beginMove(event, task)}
                        className={`absolute rounded-lg border ${baseTone.bg} ${baseTone.border} ${urgencyTone} ${
                          isNoEstimate ? "border-dashed ring-1 ring-amber-300/35 saturate-125" : ""
                        } ${
                          showPlanVsSlot && scheduledSlot ? "opacity-75" : ""
                        } ${
                          task.priority === "p3" ? "opacity-55" : ""
                        } ${barRiskTone} ${dependencyHighlightTone} ${interactionForTask?.mode === "move" ? "z-20 shadow-lg shadow-black/30" : ""} transition-shadow`}
                        style={{
                          left: previewVisual.left,
                          width: previewVisual.width,
                          top: 4,
                          height: ROW_H - 8,
                          cursor: "grab",
                        }}
                        title={taskTooltip}
                      >
                        {!previewVisual.titleOutside && (
                          <span className="pointer-events-none absolute inset-0 flex items-center px-2 text-[8px] text-white/75 truncate">
                            {task.title}
                          </span>
                        )}
                        {progress && progress.total > 0 && (
                          <span className="pointer-events-none absolute bottom-1.5 left-1.5 right-1.5 h-0.75 rounded-full bg-black/20">
                            <span
                              className="block h-full rounded-full bg-emerald-300/90"
                              style={{ width: `${progressPct}%` }}
                            />
                          </span>
                        )}
                      </button>

                      {interactionImpact?.taskId === task.id && (
                        <div
                          className={`pointer-events-none absolute z-30 w-56 rounded-2xl border border-cyan-400/25 bg-zinc-950/92 px-3 py-2 shadow-[0_18px_40px_rgba(0,0,0,0.35)] ${interactionImpact.bubbleAlign === "end" ? "text-right" : "text-left"}`}
                          style={{ left: interactionImpact.bubbleLeft, top: 2 }}
                        >
                          <p className="text-[9px] uppercase tracking-[0.16em] text-cyan-100/80">preview последствий</p>
                          <p className="mt-1 text-[11px] font-medium text-zinc-50">{interactionImpact.deltaLabel}</p>
                          <p className="mt-1 text-[10px] leading-4 text-zinc-300">{interactionImpact.summaryLabel}</p>
                          {interactionImpact.downstreamTitles.length > 0 && (
                            <p className="mt-1 truncate text-[9px] text-zinc-500">
                              дальше: {interactionImpact.downstreamTitles.join(" · ")}
                            </p>
                          )}
                        </div>
                      )}

                      {previewVisual.titleOutside && (
                        <button
                          type="button"
                          onClick={() => openTaskInList(task.id)}
                          className="absolute top-1 truncate text-left text-[8px] text-zinc-500 hover:text-zinc-300"
                          style={{ left: previewVisual.left + previewVisual.width + 4, maxWidth: 140 }}
                          title={taskTooltip}
                        >
                          {task.title}
                        </button>
                      )}

                      {canResizeStart && previewVisual.kind === "bar" && (
                        <button
                          type="button"
                          onPointerDown={(event) => beginResizeStart(event, task)}
                          className="absolute z-30 rounded-l-lg border-r border-white/10 bg-black/20 hover:bg-black/30"
                          style={{
                            left: previewVisual.left,
                            top: 4,
                            width: 8,
                            height: ROW_H - 8,
                            cursor: "ew-resize",
                          }}
                          aria-label={`Изменить старт ${task.title}`}
                          title={`Изменить старт ${task.title}`}
                        />
                      )}

                      {canResizeEnd && previewVisual.kind === "bar" && (
                        <button
                          type="button"
                          onPointerDown={(event) => beginResizeEnd(event, task)}
                          className="absolute z-30 rounded-r-lg border-l border-white/10 bg-black/15 hover:bg-black/25"
                          style={{
                            left: previewVisual.left + previewVisual.width - 8,
                            top: 4,
                            width: 8,
                            height: ROW_H - 8,
                            cursor: "ew-resize",
                          }}
                          aria-label={endResizeTitle}
                          title={endResizeTitle}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[10px] text-zinc-500">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-amber-400" /> сегодня
        </span>
        <span>Drag бара — двигает весь диапазон</span>
        <span>Левый край — задаёт старт</span>
        {onTaskPlannedMinutesChange && <span>Правый край — финиш или длительность</span>}
        <span>Пунктир — сводный rollup родителя</span>
        <span>Серый ghost — baseline до первого сдвига</span>
        <span>Точка слева у слота/бара — потяни к другому бару, чтобы создать зависимость</span>
        <span>Стрелка — dependency finish → start, клик по ней снимает связь</span>
        <span>Кнопка «Риски / цепочка» — фокус на slip и blocker tasks</span>
        <span>Фуксия — critical chain вокруг risky узлов</span>
        <span>↺ / ◎ — reset и rebase baseline по задаче</span>
        <span>Preview последствий — во время drag/resize показывает, кого заденет цепочка</span>
        <span>Повторы compact — одинаковые подряд идущие задачи схлопываются в серию</span>
        <span>Повторы exceptions — стабильные серии уходят в фон, остаются только сбои и зависимости</span>
        <span>▸ / ▾ на серии — раскрывает только один повторный ритм, не разворачивая все повторы сразу</span>
        <span>Тонкая цветная плашка — реальный слот в календаре</span>
        <span>Пунктирная рамка — задача без оценки</span>
        <span>Зелёная шкала — rollup-progress по подзадачам</span>
        <span>Фон колонки — heatmap по дневной нагрузке</span>
        <span>Светлая риска — capacity дня</span>
        <span>Красный хвост — уже вышли за срок</span>
      </div>
    </div>
  );
}
