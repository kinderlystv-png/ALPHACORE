"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CalendarDayPressureChip } from "@/components/calendar-day-pressure-chip";
import { CalendarDesktopHint } from "@/components/calendar-desktop-hint";
import { CalendarNowLine } from "@/components/calendar-now-line";
import { CalendarQuickMenu } from "@/components/calendar-quick-menu";
import { CalendarSlotCard } from "@/components/calendar-slot-card";
import {
  AUTO_SCROLL_EDGE_PX,
  AUTO_SCROLL_MAX_STEP,
  DEFAULT_CUSTOM_DURATION_MIN,
  DESKTOP_SLOT_HINT_DELAY_MS,
  DESKTOP_SLOT_HINT_ESTIMATED_HEIGHT,
  DESKTOP_SLOT_HINT_WIDTH,
  HEADER_BASE_H,
  HEADER_TASK_GAP,
  HEADER_TASK_MARGIN_TOP,
  HEADER_TASK_ROW_H,
  HOUR_END,
  HOUR_START,
  MIN_SLOT_MIN,
  MOUSE_HOLD_MS,
  POINTER_SLOP_PX,
  QUICK_MENU_ESTIMATED_HEIGHT,
  ROW_H,
  STEP_MIN,
  SLOT_LANE_GAP_PX,
  SLOT_SIDE_INSET_PX,
  SUPPORT_LANE_RATIO,
  TOTAL_HOURS,
  TOUCH_HOLD_MS,
  clamp,
  copyTitle,
  formatDurationDelta,
  formatHour,
  getCompactStart,
  getDayModeBadgeClass,
  minutesToCalendarTime,
  sameEdgeCue,
  slotHeight as sharedSlotHeight,
  slotTop as sharedSlotTop,
  snapMinutes,
  toneFromArea,
  vibrateIfAvailable,
  centerNowLine,
  type ActivePointerEdit,
  type CalendarViewMode,
  type DayColumn,
  type DesktopSlotHintContent,
  type DesktopSlotHintState,
  type DragState,
  type EdgeCueState,
  type EditableSlotDraft,
  type LaneMetrics,
  type LaneRenderable,
  type PendingPointerEdit,
  type PointerEditMode,
  type QuickMenuState,
  type ReboundPreview,
  type TimeRange,
  type WeekCalendarGridProps,
} from "@/components/calendar-grid-types";

import {
  getSlotCarryoverActions,
  getSlotCarryoverDecision,
} from "@/lib/calendar-slot-carryover";
import {
  getCalendarDayPressure,
} from "@/lib/calendar-day-pressure";
import {
  getCalendarSlotSupportNote,
  type CalendarSlotSupportNote,
} from "@/lib/calendar-slot-support-notes";
import {
  buildBundleContextProfile,
  getDefaultMetricKey,
  getHeysDayMode,
} from "@/lib/heys-day-mode";
import {
  formatCompletionLabel,
  getSlotAttentionState,
  getYesterdayKey,
  shiftDateKey,
} from "@/lib/calendar-slot-attention";
import { getScheduleSlotExplainability } from "@/lib/calendar-slot-explainability";
import {
  AREA_COLOR,
  AREA_LEGEND,
  taskArea,
  taskColor,
  toneColor,
} from "@/lib/life-areas";
import {
  addCustomEvent,
  formatScheduleClockTime,
  formatScheduleTimeRange,
  getScheduleSlotApprovalState,
  getHeysSyncedSlotBadgeLabel,
  getScheduledTaskIds,
  isHeysSyncedScheduleSlot,
  isEditableScheduleSlot,
  removeEditableScheduleSlot,
  toggleScheduleSlotApproval,
  upsertTaskSlot,
  unscheduleCustomTaskEvent,
  type ScheduleSlot,
  type ScheduleTone,
  getScheduleForDate,
  timeToMinutes,
  updateEditableScheduleSlot,
} from "@/lib/schedule";
import { readTaskDragId, writeTaskDragData } from "@/lib/dashboard-events";
import { getProjects, type Project } from "@/lib/projects";
import { dateStr, subscribeAppDataChange } from "@/lib/storage";
import {
  compareTasksByAttention,
  getActionableTasks,
  getTasks,
  type Task,
  updateTask,
} from "@/lib/tasks";
import { useHeysSync } from "@/lib/use-heys-sync";

/* ── Helpers ── */

function todayKey() {
  return dateStr();
}

function getTodayWindowAnchor() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function buildWindow(anchor: Date): Date[] {
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: 8 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function slotTop(startTime: string): number {
  return sharedSlotTop(startTime, timeToMinutes);
}

function slotHeight(start: string, end: string): number {
  return sharedSlotHeight(start, end, timeToMinutes);
}

function getTaskCompletionDetails(
  task: Pick<Task, "completedAt">,
): { dateKey: string; minutes: number; timeLabel: string } | null {
  if (!task.completedAt) return null;

  const completedAt = new Date(task.completedAt);
  if (Number.isNaN(completedAt.getTime())) return null;

  return {
    dateKey: dateStr(completedAt),
    minutes: completedAt.getHours() * 60 + completedAt.getMinutes(),
    timeLabel: `${String(completedAt.getHours()).padStart(2, "0")}:${String(completedAt.getMinutes()).padStart(2, "0")}`,
  };
}

function taskBelongsToDay(task: Task, dayKey: string, today: string, isToday: boolean): boolean {
  if (!task.dueDate) return isToday && task.status === "active";
  if (task.dueDate === dayKey) return true;
  return isToday && task.dueDate < today;
}

function isOverdueUndoneTask(
  task: Pick<Task, "dueDate" | "status">,
  today: string,
): boolean {
  const dueDate = task.dueDate;
  return task.status !== "done" && typeof dueDate === "string" && dueDate < today;
}

function isYesterdayUndoneTask(
  task: Pick<Task, "dueDate" | "status">,
  today: string,
): boolean {
  return isOverdueUndoneTask(task, today) && task.dueDate === shiftDateKey(today, -1);
}

function inferTaskSlotTone(task: Task): ScheduleTone {
  const projectLabel = `${task.projectId ?? ""} ${task.project ?? ""}`.toLowerCase();

  if (projectLabel.includes("kinderly")) return "kinderly";
  if (projectLabel.includes("heys")) return "heys";

  return toneFromArea(taskArea(task));
}

function buildTaskSlotTags(task: Task): string[] {
  const projectTag = (task.projectId ?? task.project ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return [...new Set([
    "task",
    "task-slot",
    task.priority,
    task.status,
    ...(projectTag ? [projectTag] : []),
  ])];
}

function getTaskDropStartMinutes(
  event: React.DragEvent<HTMLDivElement>,
  hour: number,
): number {
  const rect = event.currentTarget.getBoundingClientRect();
  const pointerOffset = event.clientY - rect.top;
  const minuteOffset = pointerOffset >= rect.height / 2 ? STEP_MIN : 0;

  return clamp(
    hour * 60 + minuteOffset,
    HOUR_START * 60,
    HOUR_END * 60 - DEFAULT_CUSTOM_DURATION_MIN,
  );
}

function findProjectIdByLabel(projects: Project[], label?: string | null): string {
  if (!label) return "";
  const match = projects.find((project) => project.name === label);
  return match?.id ?? "";
}

function getSlotProjectId(
  slot: Pick<ScheduleSlot, "projectId" | "project">,
  linkedTask: Pick<Task, "projectId" | "project"> | null,
  projects: Project[],
): string {
  if (slot.projectId) return slot.projectId;
  if (linkedTask?.projectId) return linkedTask.projectId;
  return findProjectIdByLabel(projects, slot.project ?? linkedTask?.project);
}

function getSlotProjectLabel(
  slot: Pick<ScheduleSlot, "projectId" | "project">,
  linkedTask: Pick<Task, "projectId" | "project"> | null,
  projectNameById: Map<string, string>,
): string | null {
  if (slot.projectId) return projectNameById.get(slot.projectId) ?? slot.project ?? null;
  if (linkedTask?.projectId) {
    return projectNameById.get(linkedTask.projectId) ?? linkedTask.project ?? slot.project ?? null;
  }
  return slot.project ?? linkedTask?.project ?? null;
}

function rangesOverlap(left: TimeRange, right: TimeRange): boolean {
  return (
    timeToMinutes(left.start) < timeToMinutes(right.end) &&
    timeToMinutes(left.end) > timeToMinutes(right.start)
  );
}

function slotsOverlap(
  left: Pick<EditableSlotDraft, "start" | "end">,
  right: Pick<ScheduleSlot, "start" | "end">,
): boolean {
  return rangesOverlap(left, right);
}

function isAmbientContextSlot(slot: Pick<ScheduleSlot, "tags">): boolean {
  return (
    slot.tags.includes("childcare-window") ||
    (slot.tags.includes("admin") && slot.tags.includes("danya"))
  );
}

function isBudgetHeavySlot(slot: Pick<ScheduleSlot, "source" | "tags" | "title">): boolean {
  const title = slot.title.toLowerCase();
  return (
    slot.source === "studio" ||
    slot.tags.some((tag) => ["cleanup", "high-load", "party", "studio", "support", "between-parties", "household"].includes(tag)) ||
    ["уборк", "cleanup", "праздник", "party"].some((token) => title.includes(token))
  );
}

function isBudgetWorkLikeSlot(slot: Pick<ScheduleSlot, "tone" | "tags" | "title">): boolean {
  const title = slot.title.toLowerCase();
  return (
    slot.tone === "work" ||
    slot.tone === "kinderly" ||
    slot.tone === "heys" ||
    slot.tone === "review" ||
    slot.tags.some((tag) => ["work", "deep-work", "strategy", "execution", "comms", "ops", "planning", "review"].includes(tag)) ||
    ["work", "deep work", "strategy", "review", "задач", "стратег", "план", "реализац"].some((token) => title.includes(token))
  );
}

function isBudgetRecoveryLikeSlot(slot: Pick<ScheduleSlot, "tone" | "tags" | "title">): boolean {
  const title = slot.title.toLowerCase();
  return (
    slot.tone === "personal" ||
    slot.tags.some((tag) => ["recovery", "sleep", "shutdown", "bedtime", "quiet-buffer", "rest", "stress", "wellbeing"].includes(tag)) ||
    ["сон", "sleep", "recovery", "quiet", "shutdown", "stretch", "rest", "восстанов"].some((token) => title.includes(token))
  );
}

function getAdjacentContextSlot(
  slots: ScheduleSlot[],
  currentSlot: ScheduleSlot,
  direction: "previous" | "next",
): ScheduleSlot | null {
  const currentStart = timeToMinutes(currentSlot.start);
  const currentEnd = timeToMinutes(currentSlot.end);
  const candidates = slots.filter((candidate) => {
    if (candidate.id === currentSlot.id) return false;
    if (isAmbientContextSlot(candidate)) return false;

    return direction === "previous"
      ? timeToMinutes(candidate.end) <= currentStart
      : timeToMinutes(candidate.start) >= currentEnd;
  });

  if (candidates.length === 0) return null;

  return direction === "previous"
    ? candidates.sort(
        (left, right) =>
          timeToMinutes(right.end) - timeToMinutes(left.end) ||
          timeToMinutes(right.start) - timeToMinutes(left.start),
      )[0] ?? null
    : candidates.sort(
        (left, right) =>
          timeToMinutes(left.start) - timeToMinutes(right.start) ||
          timeToMinutes(left.end) - timeToMinutes(right.end),
      )[0] ?? null;
}

function isChildcareBackgroundSlot(
  slot: Pick<ScheduleSlot, "source" | "tags"> | LaneRenderable,
): boolean {
  return (
    slot.source === "derived" &&
    (slot.tags.includes("childcare-window") ||
      (slot.tags.includes("admin") && slot.tags.includes("danya")))
  );
}

function isSupportLaneSlot(slot: Pick<ScheduleSlot, "source" | "tags"> | LaneRenderable): boolean {
  return (
    slot.source === "studio" ||
    (slot.tags.includes("party") && slot.tags.includes("studio"))
  );
}

function compareLaneRenderable(left: LaneRenderable, right: LaneRenderable): number {
  return (
    timeToMinutes(left.start) - timeToMinutes(right.start) ||
    timeToMinutes(left.end) - timeToMinutes(right.end) ||
    left.id.localeCompare(right.id, "ru")
  );
}

function getSupportLaneWidth(columnWidth: number): number {
  return clamp(
    columnWidth * SUPPORT_LANE_RATIO,
    42,
    Math.max(42, columnWidth - 52),
  );
}

function getBackgroundSlotMetrics(columnWidth: number): LaneMetrics {
  return {
    left: SLOT_SIDE_INSET_PX,
    width: Math.max(columnWidth - SLOT_SIDE_INSET_PX * 2, 24),
    isSupportLane: false,
  };
}

function getLaneMetrics(
  slot: LaneRenderable,
  daySlots: LaneRenderable[],
  columnWidth: number,
): LaneMetrics {
  const contentWidth = Math.max(columnWidth - SLOT_SIDE_INSET_PX * 2, 24);
  const supportWidth = getSupportLaneWidth(columnWidth);

  if (isSupportLaneSlot(slot)) {
    const overlapGroup = daySlots
      .filter((candidate) => isSupportLaneSlot(candidate) && rangesOverlap(candidate, slot))
      .sort(compareLaneRenderable);

    const laneCount = Math.max(overlapGroup.length, 1);
    const laneIndex = Math.max(
      overlapGroup.findIndex((candidate) => candidate.id === slot.id),
      0,
    );
    const available = Math.max(
      supportWidth - SLOT_SIDE_INSET_PX * 2 - SLOT_LANE_GAP_PX * (laneCount - 1),
      24,
    );
    const width = Math.max(available / laneCount, 22);

    return {
      left: SLOT_SIDE_INSET_PX + laneIndex * (width + SLOT_LANE_GAP_PX),
      width,
      isSupportLane: true,
    };
  }

  const hasSupportOverlap = daySlots.some(
    (candidate) => isSupportLaneSlot(candidate) && rangesOverlap(candidate, slot),
  );

  if (!hasSupportOverlap) {
    return {
      left: SLOT_SIDE_INSET_PX,
      width: contentWidth,
      isSupportLane: false,
    };
  }

  const left = SLOT_SIDE_INSET_PX + supportWidth + SLOT_LANE_GAP_PX;
  return {
    left,
    width: Math.max(columnWidth - left - SLOT_SIDE_INSET_PX, 24),
    isSupportLane: false,
  };
}

function getExplainabilityDesktopHint(
  slot: Pick<ScheduleSlot, "source" | "tags">,
  explainability: ReturnType<typeof getScheduleSlotExplainability>,
): DesktopSlotHintContent | null {
  if (!explainability.showBadges) {
    return null;
  }

  const badgeLabel = [explainability.primaryBadge, explainability.secondaryBadge]
    .filter((value): value is string => Boolean(value))
    .join(" · ");

  if (slot.source === "studio") {
    return {
      eyebrow: badgeLabel || "почему слот здесь",
      title: "Фиксированное окно из schedule.xlsx",
      summary:
        "Это реальное событие студии. Вокруг него календарь уже достраивает семейные буферы, логистику и уборку.",
      detail: "Якорь дня · не требует ручного подтверждения",
      tone: "sky",
    };
  }

  if (slot.tags.includes("between-parties")) {
    return {
      eyebrow: badgeLabel || "авто",
      title: "Окно вставлено между двумя праздниками",
      summary:
        "Календарь увидел два события в один день и добавил операционный слот, чтобы не потерять быструю уборку между ними.",
      detail: "Автологика по шаблону студии",
      tone: "amber",
    };
  }

  if (slot.tags.includes("childcare-window")) {
    return {
      eyebrow: badgeLabel || "авто",
      title: "Это семейный буфер вокруг события",
      summary:
        "Слот появился как защитное окно под Даню и бытовую логистику, пока студия занята праздником.",
      detail: slot.tags.includes("grandma") || slot.tags.includes("rehearsal")
        ? "Среда · бабушка/репетиция"
        : "Семейное покрытие вокруг студии",
      tone: "sky",
    };
  }

  if (slot.tags.includes("cleanup") && slot.tags.includes("studio")) {
    return {
      eyebrow: badgeLabel || "авто",
      title: "Уборка поставлена правилом после праздника",
      summary:
        "Это не ручной ввод: cleanup-окно возникло из студийного расписания и его можно вручную сдвинуть, если жизнь уехала иначе.",
      detail: "Derived slot · под реальный послепраздничный хвост",
      tone: "amber",
    };
  }

  if (slot.source === "template") {
    return {
      eyebrow: badgeLabel || "ритм недели",
      title: "Это мягкий weekly-слот",
      summary:
        "Он задаёт базовый ритм дня и подтверждается вручную — это ориентир, а не автоматически случившийся факт.",
      detail: "Можно двигать под реальный день",
      tone: "zinc",
    };
  }

  if (slot.source === "derived") {
    return {
      eyebrow: badgeLabel || "авто",
      title: "Слот сгенерирован правилами календаря",
      summary:
        "Он появился не из ручного ввода, а из событий недели и встроенных правил, чтобы день не разваливался на скрытые хвосты.",
      detail: "Авто-слот · можно скорректировать вручную",
      tone: "zinc",
    };
  }

  return null;
}

function getDesktopSlotHintContent(params: {
  slot: Pick<ScheduleSlot, "id" | "date" | "start" | "end" | "title" | "tags" | "taskId" | "tone" | "source" | "origin">;
  todayKey: string;
  requiresApproval: boolean;
  isCompleted: boolean;
  explainability: ReturnType<typeof getScheduleSlotExplainability>;
}): DesktopSlotHintContent | null {
  const carryoverDecision = getSlotCarryoverDecision({
    slot: params.slot,
    todayKey: params.todayKey,
    requiresApproval: params.requiresApproval,
    isCompleted: params.isCompleted,
  });

  if (carryoverDecision) {
    const primaryAction = getSlotCarryoverActions({
      slot: params.slot,
      todayKey: params.todayKey,
      requiresApproval: params.requiresApproval,
      isCompleted: params.isCompleted,
    })[0];

    return {
      eyebrow: carryoverDecision.badge,
      title: carryoverDecision.title,
      summary: primaryAction?.hint ?? carryoverDecision.summary,
      detail: primaryAction ? `Лучший ход: ${primaryAction.buttonLabel}` : undefined,
      tone: carryoverDecision.tone,
    };
  }

  return getExplainabilityDesktopHint(params.slot, params.explainability);
}

function toSupportDesktopHintContent(
  note: CalendarSlotSupportNote,
): DesktopSlotHintContent {
  const eyebrow = [
    note.badge,
    note.timingLabel,
    note.durationLabel,
    note.sequenceLabel,
    note.pressureLabel,
    note.budgetLabel,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");

  return {
    eyebrow,
    title: note.title,
    summary: note.summary,
    detail: note.detail,
    points: note.points,
    tone: note.tone,
    icon: note.icon,
  };
}

/* ── Component ── */

export function WeekCalendarGrid({ stats }: WeekCalendarGridProps) {
  const { signals: heysSignals, snapshot: heysSnapshot } = useHeysSync();
  const [version, setVersion] = useState(0);
  const [anchor, setAnchor] = useState<Date | null>(null);
  const [shouldCenterNow, setShouldCenterNow] = useState(true);
  const [drag, setDrag] = useState<DragState>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [activeEdit, setActiveEdit] = useState<ActivePointerEdit | null>(null);
  const [quickMenu, setQuickMenu] = useState<QuickMenuState | null>(null);
  const [edgeCue, setEdgeCue] = useState<EdgeCueState>({ top: 0, bottom: 0, left: 0, right: 0 });
  const [reboundPreview, setReboundPreview] = useState<ReboundPreview | null>(null);
  const [hoveredSlotKey, setHoveredSlotKey] = useState<string | null>(null);
  const [desktopSlotHint, setDesktopSlotHint] = useState<DesktopSlotHintState | null>(null);
  const [viewMode, setViewMode] = useState<CalendarViewMode>("full");
  const [compactStart, setCompactStart] = useState(0);
  const [viewportWidth, setViewportWidth] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const overlayGridRef = useRef<HTMLDivElement>(null);
  const responsiveInitRef = useRef(false);
  const pendingEditRef = useRef<{ data: PendingPointerEdit; timerId: number } | null>(null);
  const activeEditRef = useRef<ActivePointerEdit | null>(null);
  const visibleColumnsRef = useRef<DayColumn[]>([]);
  const quickMenuRef = useRef<HTMLDivElement>(null);
  const skipNextClickRef = useRef(false);
  const activePointerClientRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const autoScrollFrameRef = useRef<number | null>(null);
  const reboundTimerRef = useRef<number | null>(null);
  const reboundFrameRef = useRef<number | null>(null);
  const desktopSlotHintTimerRef = useRef<number | null>(null);
  const desktopSlotHintPendingKeyRef = useRef<string | null>(null);
  const today = todayKey();
  const yesterdayKey = getYesterdayKey(today);

  useEffect(() => {
    setAnchor(getTodayWindowAnchor());
    setShouldCenterNow(true);
  }, []);

  useEffect(() => {
    const syncViewport = () => {
      const width = window.innerWidth;
      setViewportWidth(width);

      if (!responsiveInitRef.current) {
        responsiveInitRef.current = true;
        setViewMode("full");
      }
    };

    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  // subscribe to data changes
  useEffect(() => {
    return subscribeAppDataChange((keys) => {
      if (
        keys.some((k) =>
          ["alphacore_tasks", "alphacore_schedule_custom", "alphacore_schedule_overrides", "alphacore_schedule_approvals", "alphacore_projects"].includes(k),
        )
      ) {
        setVersion((v) => v + 1);
      }
    });
  }, []);

  const days = useMemo(() => (anchor ? buildWindow(anchor) : []), [anchor]);
  const projects = useMemo(() => getProjects(), [version]);
  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  const columns = useMemo<DayColumn[]>(() => {
    const tasks = getActionableTasks(today);

    return days.map((date) => {
      const key = dateStr(date);
      const isToday = key === today;
      const isPast = key < today;
      const weekday = date.getDay();
      const isWeekend = weekday === 0 || weekday === 6;
      const scheduledTaskIds = new Set(getScheduledTaskIds(key));
      const slots = getScheduleForDate(key);
      const pressure = getCalendarDayPressure({ dateKey: key, slots });

      return {
        key,
        date,
        dayLabel: new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(date),
        dateLabel: new Intl.DateTimeFormat("ru-RU", { day: "numeric" }).format(date),
        isToday,
        isPast,
        isWeekend,
        pressure,
        tasks: tasks
          .filter((t) => taskBelongsToDay(t, key, today, isToday) && !scheduledTaskIds.has(t.id))
          .sort((a, b) => compareTasksByAttention(a, b, today)),
        slots,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, today, version]);

  const compactCount = viewportWidth != null && viewportWidth < 640 ? 2 : 3;

  const heysDayMode = useMemo(() => {
    if (!heysSignals) return null;

    const fallbackMetricKey = getDefaultMetricKey(heysSignals);
    return getHeysDayMode(
      heysSignals,
      buildBundleContextProfile(),
      fallbackMetricKey,
      heysSnapshot?.profile?.sleepHoursGoal,
    );
  }, [heysSignals, heysSnapshot?.profile?.sleepHoursGoal, version]);

  useEffect(() => {
    if (viewMode !== "compact" || columns.length === 0) return;
    setCompactStart((current) => {
      const maxStart = Math.max(0, columns.length - compactCount);
      if (current > maxStart) return maxStart;
      if (current === 0) return getCompactStart(columns, compactCount);
      return current;
    });
  }, [columns, compactCount, viewMode]);

  const visibleColumns = useMemo(() => {
    if (viewMode === "full") return columns;
    return columns.slice(compactStart, compactStart + compactCount);
  }, [columns, compactCount, compactStart, viewMode]);

  useEffect(() => {
    visibleColumnsRef.current = visibleColumns;
  }, [visibleColumns]);

  useEffect(() => {
    activeEditRef.current = activeEdit;
  }, [activeEdit]);

  const visibleGridWidth = 56 + Math.max(visibleColumns.length, 1) * 120;
  const isMobileGripMode = viewportWidth != null && viewportWidth < 640;
  const overlayWidth =
    overlayGridRef.current?.getBoundingClientRect().width ??
    Math.max(visibleGridWidth - 56, visibleColumns.length * 120);
  const overlayColumnWidth = visibleColumns.length > 0 ? overlayWidth / visibleColumns.length : 120;
  const maxHeaderTaskCount = useMemo(
    () => visibleColumns.reduce((max, column) => Math.max(max, column.tasks.length), 0),
    [visibleColumns],
  );
  const headerHeight =
    HEADER_BASE_H +
    (maxHeaderTaskCount > 0
      ? HEADER_TASK_MARGIN_TOP +
        maxHeaderTaskCount * HEADER_TASK_ROW_H +
        Math.max(0, maxHeaderTaskCount - 1) * HEADER_TASK_GAP
      : 0);

  // center current-time line on first render / when returning to today
  useEffect(() => {
    if (!shouldCenterNow) return;

    const hasTodayColumn = days.some((day) => dateStr(day) === today);
    if (!hasTodayColumn) return;

    const frame = requestAnimationFrame(() => {
      centerNowLine(gridRef.current, headerHeight);
      setShouldCenterNow(false);
    });

    return () => cancelAnimationFrame(frame);
  }, [days, headerHeight, shouldCenterNow, today]);

  const visibleWindowLabel = useMemo(() => {
    if (visibleColumns.length === 0) return "";
    const first = visibleColumns[0]?.date;
    const last = visibleColumns[visibleColumns.length - 1]?.date;
    if (!first || !last) return "";
    const fmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
    return `${fmt.format(first)} — ${fmt.format(last)}`;
  }, [visibleColumns]);

  const linkedTasksById = useMemo(
    () => new Map(getTasks().map((task) => [task.id, task])),
    [version],
  );

  const showCompactControls = viewMode === "compact" && columns.length > compactCount;

  const clearDesktopSlotHintTimer = useCallback(() => {
    if (desktopSlotHintTimerRef.current != null) {
      window.clearTimeout(desktopSlotHintTimerRef.current);
      desktopSlotHintTimerRef.current = null;
    }
    desktopSlotHintPendingKeyRef.current = null;
  }, []);

  const hideDesktopSlotHint = useCallback(() => {
    clearDesktopSlotHintTimer();
    setDesktopSlotHint(null);
  }, [clearDesktopSlotHintTimer]);

  const cancelPendingPointerEdit = useCallback(() => {
    if (!pendingEditRef.current) return;
    window.clearTimeout(pendingEditRef.current.timerId);
    pendingEditRef.current = null;
  }, []);

  const closeQuickMenu = useCallback(() => {
    hideDesktopSlotHint();
    setQuickMenu(null);
  }, [hideDesktopSlotHint]);

  const scheduleDesktopSlotHint = useCallback((
    element: HTMLElement,
    slotKey: string,
    content: DesktopSlotHintContent | null,
    options?: { delayMs?: number },
  ) => {
    if (!content) {
      hideDesktopSlotHint();
      return;
    }

    if (desktopSlotHint?.slotKey === slotKey || desktopSlotHintPendingKeyRef.current === slotKey) {
      return;
    }

    clearDesktopSlotHintTimer();
    setDesktopSlotHint(null);

    const rect = element.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const left = clamp(
      rect.right + 14,
      12,
      Math.max(12, viewportW - DESKTOP_SLOT_HINT_WIDTH - 12),
    );
    const top = clamp(
      rect.top + Math.min(rect.height * 0.25, 24),
      12,
      Math.max(12, viewportH - DESKTOP_SLOT_HINT_ESTIMATED_HEIGHT - 12),
    );

    desktopSlotHintPendingKeyRef.current = slotKey;
    const revealHint = () => {
      desktopSlotHintTimerRef.current = null;
      desktopSlotHintPendingKeyRef.current = null;
      setDesktopSlotHint({
        slotKey,
        left,
        top,
        ...content,
      });
    };

    const delayMs = options?.delayMs ?? DESKTOP_SLOT_HINT_DELAY_MS;

    if (delayMs <= 0) {
      revealHint();
      return;
    }

    desktopSlotHintTimerRef.current = window.setTimeout(revealHint, delayMs);
  }, [clearDesktopSlotHintTimer, desktopSlotHint?.slotKey, hideDesktopSlotHint]);

  const resetEdgeCue = useCallback(() => {
    setEdgeCue((current) => (sameEdgeCue(current, { top: 0, bottom: 0, left: 0, right: 0 }) ? current : { top: 0, bottom: 0, left: 0, right: 0 }));
  }, []);

  const toEditableDraft = useCallback((slot: ScheduleSlot): EditableSlotDraft => {
    return {
      id: slot.id,
      date: slot.date,
      start: slot.start,
      end: slot.end,
      title: slot.title,
      tone: slot.tone,
      tags: slot.tags,
      kind: slot.kind === "event" ? "event" : "task",
    };
  }, []);

  const getPointerDayIndex = useCallback((clientX: number): number => {
    const rect = overlayGridRef.current?.getBoundingClientRect();
    const columns = visibleColumnsRef.current;
    if (!rect || columns.length === 0) return 0;
    const columnWidth = rect.width / columns.length;
    const raw = Math.floor((clientX - rect.left) / Math.max(columnWidth, 1));
    return clamp(raw, 0, columns.length - 1);
  }, []);

  const getPointerDayKey = useCallback((clientX: number): string => {
    const columns = visibleColumnsRef.current;
    return columns[getPointerDayIndex(clientX)]?.key ?? columns[0]?.key ?? today;
  }, [getPointerDayIndex, today]);

  const getSnappedMinutesFromClientY = useCallback((clientY: number): number => {
    const rect = overlayGridRef.current?.getBoundingClientRect();
    if (!rect) return HOUR_START * 60;

    const relativeY = clamp(clientY - rect.top, 0, TOTAL_HOURS * ROW_H);
    const rawMinutes = HOUR_START * 60 + (relativeY / ROW_H) * 60;
    return clamp(snapMinutes(rawMinutes), HOUR_START * 60, HOUR_END * 60);
  }, []);

  const getBlockingSlot = useCallback(
    (draft: EditableSlotDraft, originalSlot: ScheduleSlot | null): ScheduleSlot | null => {
      const draftIsAmbient = originalSlot
        ? isSupportLaneSlot(originalSlot) || isChildcareBackgroundSlot(originalSlot)
        : false;
      const draftIsTaskLike = draft.kind !== "event";
      const siblings = getScheduleForDate(draft.date).filter((slot) => {
        if (slot.id === originalSlot?.id) return false;
        if (isSupportLaneSlot(slot)) return false;
        if (isChildcareBackgroundSlot(slot)) return false;
        if (draftIsAmbient) return false;
        if (draftIsTaskLike && !slot.id.startsWith("custom-")) return false;
        return true;
      });
      return siblings.find((slot) => slotsOverlap(draft, slot)) ?? null;
    },
    [],
  );

  const updateEdgeCueFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const container = gridRef.current;
      if (!container) {
        resetEdgeCue();
        return;
      }

      const rect = container.getBoundingClientRect();
      const next: EdgeCueState = {
        top: Number(clamp((rect.top + AUTO_SCROLL_EDGE_PX - clientY) / AUTO_SCROLL_EDGE_PX, 0, 1).toFixed(2)),
        bottom: Number(clamp((clientY - (rect.bottom - AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX, 0, 1).toFixed(2)),
        left: Number(clamp((rect.left + AUTO_SCROLL_EDGE_PX - clientX) / AUTO_SCROLL_EDGE_PX, 0, 1).toFixed(2)),
        right: Number(clamp((clientX - (rect.right - AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX, 0, 1).toFixed(2)),
      };

      setEdgeCue((current) => (sameEdgeCue(current, next) ? current : next));
    },
    [resetEdgeCue],
  );

  const getOverlayBoxForDraft = useCallback((
    draft: EditableSlotDraft,
    laneMeta: Pick<LaneRenderable, "id" | "source" | "tags">,
    originalSlotId?: string | null,
  ) => {
    const overlayWidth = overlayGridRef.current?.getBoundingClientRect().width;
    const columns = visibleColumnsRef.current;
    if (!overlayWidth || columns.length === 0) return null;

    const columnIndex = columns.findIndex((column) => column.key === draft.date);
    if (columnIndex === -1) return null;

    const columnWidth = overlayWidth / columns.length;
    const daySlots = columns[columnIndex]?.slots ?? [];
    const laneSlot: LaneRenderable = {
      id: laneMeta.id,
      start: draft.start,
      end: draft.end,
      source: laneMeta.source,
      tags: laneMeta.tags,
    };
    const lanePool: LaneRenderable[] = daySlots
      .filter((slot) => slot.id !== originalSlotId)
      .map((slot) => ({
        id: slot.id,
        start: slot.start,
        end: slot.end,
        source: slot.source,
        tags: slot.tags,
      }))
      .concat(laneSlot);
    const laneMetrics = getLaneMetrics(laneSlot, lanePool, columnWidth);

    return {
      top: slotTop(draft.start),
      height: slotHeight(draft.start, draft.end),
      left: columnIndex * columnWidth + laneMetrics.left,
      width: laneMetrics.width,
    };
  }, []);

  const triggerReboundPreview = useCallback((edit: ActivePointerEdit) => {
    if (reboundTimerRef.current != null) {
      window.clearTimeout(reboundTimerRef.current);
    }
    if (reboundFrameRef.current != null) {
      window.cancelAnimationFrame(reboundFrameRef.current);
    }

    const id = `rebound-${Date.now().toString(36)}`;
    const preview: ReboundPreview = {
      id,
      slotId: edit.originalSlot?.id ?? null,
      slotDate: edit.originalSlot?.date ?? edit.base.date,
      from: edit.draft,
      to: edit.base,
      stage: "from",
      source: edit.originalSlot?.source ?? "derived",
      tags: edit.originalSlot?.tags ?? edit.base.tags,
      tone: edit.base.tone,
      title: edit.base.title,
      blockedLabel: edit.blockingSlot?.title ?? null,
    };

    setReboundPreview(preview);
    reboundFrameRef.current = window.requestAnimationFrame(() => {
      setReboundPreview((current) => (current?.id === id ? { ...current, stage: "to" } : current));
    });
    reboundTimerRef.current = window.setTimeout(() => {
      setReboundPreview((current) => (current?.id === id ? null : current));
    }, 240);
  }, []);

  const buildDraftFromPointer = useCallback(
    (edit: ActivePointerEdit, clientX: number, clientY: number): ActivePointerEdit => {
      const baseStartMin = timeToMinutes(edit.base.start);
      const baseEndMin = timeToMinutes(edit.base.end);
      const duration = baseEndMin - baseStartMin;
      const pointerMin = getSnappedMinutesFromClientY(clientY);
      const targetDate = getPointerDayKey(clientX);

      let draft = edit.draft;

      if (edit.mode === "move") {
        const nextStart = clamp(
          pointerMin - edit.pointerOffsetMin,
          HOUR_START * 60,
          HOUR_END * 60 - duration,
        );
        draft = {
          ...edit.base,
          date: targetDate,
          start: minutesToCalendarTime(nextStart),
          end: minutesToCalendarTime(nextStart + duration),
        };
      }

      if (edit.mode === "resize-start") {
        const nextStart = clamp(pointerMin, HOUR_START * 60, baseEndMin - MIN_SLOT_MIN);
        draft = {
          ...edit.base,
          start: minutesToCalendarTime(nextStart),
        };
      }

      if (edit.mode === "resize-end") {
        const nextEnd = clamp(pointerMin, baseStartMin + MIN_SLOT_MIN, HOUR_END * 60);
        draft = {
          ...edit.base,
          end: minutesToCalendarTime(nextEnd),
        };
      }

      if (edit.mode === "create") {
        const anchorMin = baseStartMin;
        const low = clamp(Math.min(anchorMin, pointerMin), HOUR_START * 60, HOUR_END * 60 - MIN_SLOT_MIN);
        const high = clamp(Math.max(anchorMin, pointerMin), low + MIN_SLOT_MIN, HOUR_END * 60);

        draft = {
          ...edit.base,
          date: targetDate,
          start: minutesToCalendarTime(low),
          end: minutesToCalendarTime(high),
        };
      }

      const blockingSlot = getBlockingSlot(draft, edit.originalSlot);

      return {
        ...edit,
        draft,
        blocked: Boolean(blockingSlot),
        blockingSlot,
        hasMoved:
          edit.hasMoved ||
          Math.abs(clientX - edit.originClientX) > POINTER_SLOP_PX ||
          Math.abs(clientY - edit.originClientY) > POINTER_SLOP_PX ||
          draft.date !== edit.base.date ||
          draft.start !== edit.base.start ||
          draft.end !== edit.base.end,
      };
    },
    [getBlockingSlot, getPointerDayKey, getSnappedMinutesFromClientY],
  );

  const activatePendingPointerEdit = useCallback(
    (pending: PendingPointerEdit) => {
      const originColumnIndex = visibleColumnsRef.current.findIndex((column) => column.key === pending.dayKey);
      const startMin = getSnappedMinutesFromClientY(pending.startY);
      const base = pending.slot
        ? toEditableDraft(pending.slot)
        : {
            id: null,
            date: pending.dayKey,
            start: minutesToCalendarTime(clamp(startMin, HOUR_START * 60, HOUR_END * 60 - MIN_SLOT_MIN)),
            end: minutesToCalendarTime(
              clamp(startMin + DEFAULT_CUSTOM_DURATION_MIN, HOUR_START * 60 + MIN_SLOT_MIN, HOUR_END * 60),
            ),
            title: "Новый слот",
            tone: "work" as ScheduleTone,
            tags: ["custom"],
            kind: "task" as const,
          };
      const baseStartMin = timeToMinutes(base.start);
      const baseEndMin = timeToMinutes(base.end);
      const durationMin = Math.max(baseEndMin - baseStartMin, MIN_SLOT_MIN);
      const pointerOffsetMin = pending.slot && pending.mode === "move"
        ? clamp(startMin - baseStartMin, 0, durationMin)
        : 0;

      const next: ActivePointerEdit = {
        mode: pending.mode,
        pointerId: pending.pointerId,
        pointerType: pending.pointerType,
        originClientX: pending.startX,
        originClientY: pending.startY,
        pointerOffsetMin,
        originColumnIndex: Math.max(originColumnIndex, 0),
        originalSlot: pending.slot,
        base,
        draft: base,
        hasMoved: false,
        blocked: Boolean(getBlockingSlot(base, pending.slot)),
        blockingSlot: getBlockingSlot(base, pending.slot),
      };

      skipNextClickRef.current = true;
      setQuickMenu(null);
      activeEditRef.current = next;
      setActiveEdit(next);
      document.body.style.userSelect = "none";
      activePointerClientRef.current = { x: pending.startX, y: pending.startY };
      vibrateIfAvailable(10);
    },
    [getBlockingSlot, getSnappedMinutesFromClientY, toEditableDraft],
  );

  const commitPointerEdit = useCallback(
    (edit: ActivePointerEdit) => {
      const { draft, originalSlot } = edit;
      setQuickMenu(null);

      const blockingSlot = getBlockingSlot(draft, originalSlot);
      if (blockingSlot) {
        vibrateIfAvailable([16, 50, 16]);
        return false;
      }

      if (!originalSlot) {
        addCustomEvent({
          date: draft.date,
          start: draft.start,
          end: draft.end,
          title: draft.title,
          tone: draft.tone,
          tags: draft.tags,
          kind: draft.kind,
        });
        setVersion((value) => value + 1);
        vibrateIfAvailable(8);
        return true;
      }

      updateEditableScheduleSlot(originalSlot, {
        date: draft.date,
        start: draft.start,
        end: draft.end,
        title: draft.title,
        tone: draft.tone,
        tags: draft.tags,
      });
      setVersion((value) => value + 1);
      vibrateIfAvailable(8);
      return true;
    },
    [getBlockingSlot],
  );

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const pending = pendingEditRef.current;
      if (pending?.data.pointerId === event.pointerId) {
        if (
          Math.abs(event.clientX - pending.data.startX) > POINTER_SLOP_PX ||
          Math.abs(event.clientY - pending.data.startY) > POINTER_SLOP_PX
        ) {
          cancelPendingPointerEdit();
        }
      }

      const edit = activeEditRef.current;
      if (!edit || edit.pointerId !== event.pointerId) return;

      event.preventDefault();
      activePointerClientRef.current = { x: event.clientX, y: event.clientY };
      updateEdgeCueFromPointer(event.clientX, event.clientY);
      const next = buildDraftFromPointer(edit, event.clientX, event.clientY);
      activeEditRef.current = next;
      setActiveEdit(next);
    };

    const handlePointerFinish = (event: PointerEvent) => {
      const pending = pendingEditRef.current;
      if (pending?.data.pointerId === event.pointerId) {
        cancelPendingPointerEdit();
      }

      const edit = activeEditRef.current;
      if (!edit || edit.pointerId !== event.pointerId) return;

      event.preventDefault();
      const committed = commitPointerEdit(edit);
      activeEditRef.current = null;
      setActiveEdit(null);
      document.body.style.userSelect = "";
      activePointerClientRef.current = { x: 0, y: 0 };
      resetEdgeCue();
      if (!committed) {
        triggerReboundPreview(edit);
      }
      window.setTimeout(() => {
        skipNextClickRef.current = false;
      }, 0);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerFinish, { passive: false });
    window.addEventListener("pointercancel", handlePointerFinish, { passive: false });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerFinish);
      window.removeEventListener("pointercancel", handlePointerFinish);
      document.body.style.userSelect = "";
      resetEdgeCue();
    };
  }, [buildDraftFromPointer, cancelPendingPointerEdit, commitPointerEdit, resetEdgeCue, triggerReboundPreview, updateEdgeCueFromPointer]);

  useEffect(() => {
    if (!activeEdit) return;

    const tick = () => {
      const container = gridRef.current;
      const edit = activeEditRef.current;
      if (!container || !edit) {
        autoScrollFrameRef.current = null;
        return;
      }

      const { x, y } = activePointerClientRef.current;
      const rect = container.getBoundingClientRect();

      let deltaY = 0;
      let deltaX = 0;

      if (y < rect.top + AUTO_SCROLL_EDGE_PX) {
        deltaY = -Math.ceil(((rect.top + AUTO_SCROLL_EDGE_PX - y) / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_STEP);
      } else if (y > rect.bottom - AUTO_SCROLL_EDGE_PX) {
        deltaY = Math.ceil(((y - (rect.bottom - AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_STEP);
      }

      if (x < rect.left + AUTO_SCROLL_EDGE_PX) {
        deltaX = -Math.ceil(((rect.left + AUTO_SCROLL_EDGE_PX - x) / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_STEP);
      } else if (x > rect.right - AUTO_SCROLL_EDGE_PX) {
        deltaX = Math.ceil(((x - (rect.right - AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_STEP);
      }

      if (deltaY !== 0 || deltaX !== 0) {
        const prevTop = container.scrollTop;
        const prevLeft = container.scrollLeft;

        container.scrollTop = clamp(
          prevTop + deltaY,
          0,
          Math.max(container.scrollHeight - container.clientHeight, 0),
        );
        container.scrollLeft = clamp(
          prevLeft + deltaX,
          0,
          Math.max(container.scrollWidth - container.clientWidth, 0),
        );

        if (container.scrollTop !== prevTop || container.scrollLeft !== prevLeft) {
          const next = buildDraftFromPointer(edit, x, y);
          activeEditRef.current = next;
          setActiveEdit(next);
        }
      }

      autoScrollFrameRef.current = window.requestAnimationFrame(tick);
    };

    autoScrollFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (autoScrollFrameRef.current != null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }
    };
  }, [activeEdit, buildDraftFromPointer]);

  useEffect(() => {
    return () => {
      if (reboundTimerRef.current != null) {
        window.clearTimeout(reboundTimerRef.current);
      }
      if (reboundFrameRef.current != null) {
        window.cancelAnimationFrame(reboundFrameRef.current);
      }
      clearDesktopSlotHintTimer();
    };
  }, [clearDesktopSlotHintTimer]);

  useEffect(() => {
    const container = gridRef.current;
    if (!container) return;

    const handleScroll = () => hideDesktopSlotHint();

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [hideDesktopSlotHint]);

  useEffect(() => {
    hideDesktopSlotHint();
  }, [hideDesktopSlotHint, version, viewMode, compactStart]);

  const queuePointerEdit = useCallback(
    (
      mode: PointerEditMode,
      event: React.PointerEvent<HTMLElement>,
      dayKey: string,
      slot: ScheduleSlot | null,
    ) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (slot && !isEditableScheduleSlot(slot)) return;
      if (!slot && dayKey < today) return;

      hideDesktopSlotHint();
      setQuickMenu(null);
      cancelPendingPointerEdit();

      const data: PendingPointerEdit = {
        mode,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        startX: event.clientX,
        startY: event.clientY,
        dayKey,
        slot,
      };

      const delay = event.pointerType === "touch" ? TOUCH_HOLD_MS : MOUSE_HOLD_MS;
      const timerId = window.setTimeout(() => {
        activatePendingPointerEdit(data);
        pendingEditRef.current = null;
      }, delay);

      pendingEditRef.current = { data, timerId };
    },
    [activatePendingPointerEdit, cancelPendingPointerEdit, hideDesktopSlotHint, today],
  );

  const openQuickMenu = useCallback((element: HTMLElement, slot: ScheduleSlot) => {
    const rect = element.getBoundingClientRect();
    const mobile = window.innerWidth < 640;
    const desktopHalfWidth = 192;
    const maxTop = Math.max(12, window.innerHeight - QUICK_MENU_ESTIMATED_HEIGHT - 12);
    const linkedTask = slot.taskId ? linkedTasksById.get(slot.taskId) ?? null : null;

    setHoveredSlotKey(null);
    hideDesktopSlotHint();
    setQuickMenu({
      slot,
      top: clamp(rect.top + Math.min(rect.height, 28) + 10, 12, maxTop),
      left: clamp(rect.left + rect.width / 2, 16 + desktopHalfWidth, window.innerWidth - 16 - desktopHalfWidth),
      mobile,
      draftTitle: slot.title,
      draftTone: slot.tone,
      draftKind: slot.kind === "event" ? "event" : "task",
      draftProjectId: getSlotProjectId(slot, linkedTask, projects),
    });
  }, [hideDesktopSlotHint, linkedTasksById, projects]);

  const updateQuickMenuDraft = useCallback((patch: Partial<Pick<QuickMenuState, "draftTitle" | "draftTone" | "draftKind" | "draftProjectId">>) => {
    setQuickMenu((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const applyQuickSlotPatch = useCallback((slot: ScheduleSlot, patch: Partial<EditableSlotDraft>) => {
    updateEditableScheduleSlot(slot, {
      date: patch.date,
      start: patch.start,
      end: patch.end,
      title: patch.title,
      tone: patch.tone,
      tags: patch.tags,
    });
    setVersion((value) => value + 1);
    setQuickMenu(null);
  }, []);

  const saveQuickMenuDraft = useCallback(() => {
    if (!quickMenu) return;

    const nextTitle = quickMenu.draftTitle.trim();
    if (!nextTitle) return;
    const selectedProject = getProjects().find((project) => project.id === quickMenu.draftProjectId);
    const currentProjectId = getSlotProjectId(
      quickMenu.slot,
      quickMenu.slot.taskId ? linkedTasksById.get(quickMenu.slot.taskId) ?? null : null,
      getProjects(),
    );

    const isCustomSlot = quickMenu.slot.id.startsWith("custom-");
    const nextKind = isCustomSlot ? quickMenu.draftKind : quickMenu.slot.kind ?? "event";

    if (
      nextTitle === quickMenu.slot.title &&
      quickMenu.draftTone === quickMenu.slot.tone &&
      nextKind === (quickMenu.slot.kind ?? "event") &&
      quickMenu.draftProjectId === currentProjectId
    ) {
      setQuickMenu(null);
      return;
    }

    updateEditableScheduleSlot(quickMenu.slot, {
      title: nextTitle,
      tone: quickMenu.draftTone,
      kind: nextKind,
      projectId: selectedProject?.id,
      project: selectedProject?.name,
    });
    setVersion((value) => value + 1);
    setQuickMenu(null);
  }, [linkedTasksById, quickMenu]);

  const duplicateQuickSlot = useCallback(() => {
    if (!quickMenu) return;

    const duration = timeToMinutes(quickMenu.slot.end) - timeToMinutes(quickMenu.slot.start);
    const sourceStart = timeToMinutes(quickMenu.slot.start);
    const sourceEnd = timeToMinutes(quickMenu.slot.end);
    const sameDayStart = sourceEnd;
    const sameDayEnd = sameDayStart + duration;
    const nextTitle = quickMenu.draftTitle.trim() || quickMenu.slot.title;

    const duplicateDate = sameDayEnd <= HOUR_END * 60 ? quickMenu.slot.date : shiftDateKey(quickMenu.slot.date, 1);
    const duplicateStart = sameDayEnd <= HOUR_END * 60 ? sameDayStart : sourceStart;
    const duplicateEnd = sameDayEnd <= HOUR_END * 60 ? sameDayEnd : sourceEnd;

    addCustomEvent({
      date: duplicateDate,
      start: minutesToCalendarTime(duplicateStart),
      end: minutesToCalendarTime(duplicateEnd),
      title: copyTitle(nextTitle),
      tone: quickMenu.draftTone,
      tags: [...new Set([...quickMenu.slot.tags, "copy"])],
      kind: quickMenu.draftKind,
      taskId: null,
      projectId: quickMenu.draftProjectId || undefined,
      project: getProjects().find((project) => project.id === quickMenu.draftProjectId)?.name,
    });
    setVersion((value) => value + 1);
    setQuickMenu(null);
  }, [quickMenu]);

  const unscheduleQuickSlot = useCallback((slot: ScheduleSlot) => {
    unscheduleCustomTaskEvent(slot.id);
    setVersion((value) => value + 1);
    setQuickMenu(null);
  }, []);

  const deleteQuickSlot = useCallback((slot: ScheduleSlot) => {
    removeEditableScheduleSlot(slot);
    setVersion((value) => value + 1);
    setQuickMenu(null);
  }, []);

  const toggleQuickSlotApproval = useCallback((slot: ScheduleSlot) => {
    toggleScheduleSlotApproval(slot);
    setVersion((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!quickMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && quickMenuRef.current?.contains(target)) return;
      setQuickMenu(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setQuickMenu(null);
    };

    const handleScroll = () => setQuickMenu(null);

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    gridRef.current?.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      gridRef.current?.removeEventListener("scroll", handleScroll);
    };
  }, [quickMenu]);

  // navigation
  const shiftWeek = useCallback(
    (delta: number) => {
      setAnchor((prev) => {
        if (!prev) return getTodayWindowAnchor();
        const next = new Date(prev);
        next.setDate(prev.getDate() + delta * 7);
        return next;
      });
    },
    [],
  );

  const goToday = useCallback(() => {
    setAnchor(getTodayWindowAnchor());
    setCompactStart(0);
    setShouldCenterNow(true);
  }, []);

  // keyboard navigation: ← → shift week/window, t → today
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (viewMode === "compact") {
          setCompactStart((c) => Math.max(0, c - 1));
        } else {
          shiftWeek(-1);
        }
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (viewMode === "compact") {
          setCompactStart((c) => Math.min(columns.length - compactCount, c + 1));
        } else {
          shiftWeek(1);
        }
      } else if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        goToday();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [viewMode, columns.length, compactCount, shiftWeek, goToday]);

  // drag handlers
  const onDragStartTask = useCallback((taskId: string, originDay: string) => {
    setDrag({ type: "task", taskId, originDay });
  }, []);

  const moveTaskToDay = useCallback((taskId: string, targetDay: string) => {
    const task = linkedTasksById.get(taskId);
    if (!task) return false;
    if (task.dueDate === targetDay) return false;

    updateTask(taskId, { dueDate: targetDay });
    return true;
  }, [linkedTasksById]);

  const toggleSlotApproval = useCallback((slot: ScheduleSlot) => {
    toggleScheduleSlotApproval(slot);
    setVersion((value) => value + 1);
  }, []);

  const scheduleTaskFromDrop = useCallback((
    taskId: string,
    targetDay: string,
    startMinutes: number,
  ) => {
    const task = linkedTasksById.get(taskId);
    if (!task) return false;

    const draft: EditableSlotDraft = {
      id: null,
      date: targetDay,
      start: minutesToCalendarTime(startMinutes),
      end: minutesToCalendarTime(startMinutes + DEFAULT_CUSTOM_DURATION_MIN),
      title: task.title,
      tone: inferTaskSlotTone(task),
      tags: buildTaskSlotTags(task),
      kind: "task",
    };

    const blockingSlot = getBlockingSlot(draft, null);
    if (blockingSlot) {
      return false;
    }

    const scheduled = upsertTaskSlot({
      taskId,
      date: draft.date,
      start: draft.start,
      end: draft.end,
      title: draft.title,
      tone: draft.tone,
      tags: draft.tags,
    });

    if (!scheduled) return false;

    setVersion((value) => value + 1);
    return true;
  }, [getBlockingSlot, linkedTasksById]);

  const onDragOver = useCallback((e: React.DragEvent, dayKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(dayKey);
  }, []);

  const onDragLeave = useCallback(() => {
    setDropTarget(null);
  }, []);

  const onDropToDayHeader = useCallback(
    (e: React.DragEvent, targetDay: string) => {
      e.preventDefault();
      setDropTarget(null);
      const taskId = readTaskDragId(e.dataTransfer) ?? drag?.taskId ?? null;
      if (!taskId) return;

      moveTaskToDay(taskId, targetDay);

      setDrag(null);
    },
    [drag?.taskId, moveTaskToDay],
  );

  const onDropToTimeCell = useCallback(
    (e: React.DragEvent<HTMLDivElement>, targetDay: string, hour: number) => {
      e.preventDefault();
      setDropTarget(null);
      const taskId = readTaskDragId(e.dataTransfer) ?? drag?.taskId ?? null;
      if (!taskId) return;

      const startMinutes = getTaskDropStartMinutes(e, hour);
      scheduleTaskFromDrop(taskId, targetDay, startMinutes);

      setDrag(null);
    },
    [drag?.taskId, scheduleTaskFromDrop],
  );

  const onDragEnd = useCallback(() => {
    setDrag(null);
    setDropTarget(null);
  }, []);

  // week label
  const weekLabel = useMemo(() => {
    if (days.length === 0) return "";
    const first = days[0];
    const last = days[days.length - 1];
    const fmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
    return `${fmt.format(first)} — ${fmt.format(last)}`;
  }, [days]);

  if (!anchor) {
    return (
      <section className="flex flex-col rounded-4xl border border-zinc-800/50 bg-zinc-950/40">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/50 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-xl border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-700">
              ←
            </span>
            <span className="rounded-xl border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-600">
              Сегодня
            </span>
            <span className="rounded-xl border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-700">
              →
            </span>
            <span className="ml-2 text-sm font-semibold text-zinc-700">Загрузка…</span>

            {stats && (
              <div className="ml-2 flex flex-wrap gap-2">
                <span className="rounded-lg border border-sky-500/10 bg-sky-950/5 px-2 py-1 text-[11px] text-sky-400/60">
                  {stats.inboxCount} inbox
                </span>
                <span className="rounded-lg border border-emerald-500/10 bg-emerald-950/5 px-2 py-1 text-[11px] text-emerald-400/60">
                  {stats.activeCount} в работе
                </span>
                <span className="rounded-lg border border-amber-500/10 bg-amber-950/5 px-2 py-1 text-[11px] text-amber-400/60">
                  {stats.doneThisWeek} готово/нед
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {AREA_LEGEND.map((a) => (
              <span
                key={a.key}
                className="flex items-center gap-1.5 text-[10px] text-zinc-600"
              >
                <span className={`inline-block h-2 w-2 rounded-full ${AREA_COLOR[a.key].dot}`} />
                {a.emoji} {a.label}
              </span>
            ))}
          </div>
        </div>

        <div className="h-[75vh] min-h-160 animate-pulse bg-zinc-950/20" />
      </section>
    );
  }

  return (
    <section className="flex flex-col rounded-4xl border border-zinc-800/50 bg-zinc-950/40">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/50 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => shiftWeek(-1)}
            aria-label="Предыдущая неделя"
            className="rounded-xl border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
          >
            ←
          </button>
          <button
            type="button"
            onClick={goToday}
            className="rounded-xl border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100"
          >
            Сегодня
          </button>
          <button
            type="button"
            onClick={() => shiftWeek(1)}
            aria-label="Следующая неделя"
            className="rounded-xl border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
          >
            →
          </button>
          <span className="ml-2 text-sm font-semibold text-zinc-100">{weekLabel}</span>

          {viewMode === "compact" && (
            <span className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-2 py-1 text-[11px] text-zinc-400">
              {visibleWindowLabel}
            </span>
          )}

          {stats && (
            <div className="ml-2 flex flex-wrap gap-2">
              <span className="rounded-lg border border-sky-500/20 bg-sky-950/10 px-2 py-1 text-[11px] text-sky-300">
                {stats.inboxCount} inbox
              </span>
              <span className="rounded-lg border border-emerald-500/20 bg-emerald-950/10 px-2 py-1 text-[11px] text-emerald-300">
                {stats.activeCount} в работе
              </span>
              <span className="rounded-lg border border-amber-500/20 bg-amber-950/10 px-2 py-1 text-[11px] text-amber-300">
                {stats.doneThisWeek} готово/нед
              </span>
            </div>
          )}

          {heysDayMode && (
            <span
              title={heysDayMode.summary}
              className={`ml-2 rounded-lg border px-2 py-1 text-[11px] ${getDayModeBadgeClass(heysDayMode)}`}
            >
              HEYS · {heysDayMode.label}
            </span>
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-1 flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/40 p-1">
            <button
              type="button"
              onClick={() => {
                setViewMode("compact");
                setCompactStart(getCompactStart(columns, compactCount));
              }}
              className={`rounded-full px-2 py-1 text-[10px] transition ${
                viewMode === "compact" ? "bg-zinc-50 text-zinc-950" : "text-zinc-500 hover:text-zinc-200"
              }`}
            >
              {compactCount}д
            </button>
            <button
              type="button"
              onClick={() => setViewMode("full")}
              className={`rounded-full px-2 py-1 text-[10px] transition ${
                viewMode === "full" ? "bg-zinc-50 text-zinc-950" : "text-zinc-500 hover:text-zinc-200"
              }`}
            >
              8д
            </button>
          </div>

          {showCompactControls && (
            <div className="mr-2 flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/40 p-1">
              <button
                type="button"
                onClick={() => setCompactStart((current) => Math.max(0, current - 1))}
                className="rounded-full px-2 py-1 text-[10px] text-zinc-400 transition hover:text-zinc-100"
              >
                ← окно
              </button>
              <button
                type="button"
                onClick={() =>
                  setCompactStart((current) => Math.min(columns.length - compactCount, current + 1))
                }
                className="rounded-full px-2 py-1 text-[10px] text-zinc-400 transition hover:text-zinc-100"
              >
                окно →
              </button>
            </div>
          )}
          {AREA_LEGEND.map((a) => (
            <span
              key={a.key}
              className="flex items-center gap-1.5 text-[10px] text-zinc-500"
            >
              <span className={`inline-block h-2 w-2 rounded-full ${AREA_COLOR[a.key].dot}`} />
              {a.emoji} {a.label}
            </span>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div ref={gridRef} className="relative overflow-auto" style={{ maxHeight: "75vh" }}>
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: `56px repeat(${visibleColumns.length}, minmax(120px, 1fr))`,
            minWidth: `${visibleGridWidth}px`,
          }}
        >
          {/* ── Column headers ── */}
          <div
            className="sticky top-0 z-30 border-b border-r border-zinc-800/50 bg-zinc-950"
            style={{ height: headerHeight }}
          />
          {visibleColumns.map((col) => (
            <div
              key={`head-${col.key}`}
              className={`sticky top-0 z-30 overflow-hidden border-b border-r border-b-zinc-800/60 px-2 py-1.5 ${
                col.isPast
                  ? "bg-zinc-950"
                  : col.isToday
                    ? "bg-zinc-900"
                    : col.isWeekend
                      ? "bg-rose-950/95"
                      : "bg-zinc-950"
              } ${
                col.isToday ? "border-r-sky-400/35" : "border-r-zinc-700/70"
              }`}
              style={{ height: headerHeight }}
              onDragOver={(e) => !col.isPast && onDragOver(e, col.key)}
              onDragLeave={!col.isPast ? onDragLeave : undefined}
              onDrop={(e) => !col.isPast && onDropToDayHeader(e, col.key)}
            >
              <p
                className={`text-center text-[9px] uppercase tracking-[0.18em] ${
                  col.isPast
                    ? "text-zinc-600"
                    : col.isToday
                      ? "text-sky-400"
                      : col.isWeekend
                        ? "text-rose-300"
                        : "text-zinc-500"
                }`}
              >
                {col.dayLabel}
              </p>
              <p
                className={`mt-0.5 text-center text-base font-bold leading-none ${
                  col.isPast
                    ? "text-zinc-600"
                    : col.isToday
                      ? "text-sky-300"
                      : col.isWeekend
                        ? "text-rose-200"
                        : "text-zinc-200"
                }`}
              >
                {col.dateLabel}
              </p>

              <div className="mt-1.5 flex justify-center">
                <CalendarDayPressureChip pressure={col.pressure} variant="pill" />
              </div>

              {/* All-day tasks */}
              {col.tasks.length > 0 && (
                <div className="mt-1.5 flex flex-col gap-1">
                  {col.tasks.map((t) => {
                    const c = taskColor(t);

                    return (
                      <span
                        key={t.id}
                        draggable={!col.isPast}
                        onDragStart={(e) => {
                          if (col.isPast) return;
                          e.dataTransfer.effectAllowed = "move";
                          writeTaskDragData(e.dataTransfer, t.id);
                          onDragStartTask(t.id, col.key);
                        }}
                        onDragEnd={onDragEnd}
                        className={`block w-full truncate rounded-md border px-2 py-1 text-left text-[10px] font-medium leading-tight ${
                          col.isPast
                            ? "border-zinc-800 bg-zinc-900/50 text-zinc-600"
                            : `cursor-grab ${c.border} ${c.bg} ${c.text}`
                        }`}
                      >
                        {t.title}
                      </span>
                    );
                  })}
                </div>
              )}

              <div
                className={`pointer-events-none absolute inset-y-0 right-0 w-0.5 ${
                  col.isToday
                    ? "bg-linear-to-b from-sky-200/15 via-sky-300/55 to-sky-200/15"
                    : "bg-linear-to-b from-zinc-200/10 via-zinc-300/38 to-zinc-200/10"
                }`}
              />
            </div>
          ))}

          {/* ── Hour rows ── */}
          {Array.from({ length: TOTAL_HOURS }, (_, i) => {
            const hour = HOUR_START + i;
            return (
              <div key={`time-${hour}`} className="contents">
                {/* Time label */}
                <div
                  className="sticky left-0 z-20 border-b border-r border-b-zinc-800/30 border-r-zinc-700/60 bg-zinc-950 pr-2 text-right"
                  style={{ height: ROW_H }}
                >
                  <span className="relative -top-2 text-[10px] text-zinc-600">
                    {formatHour(hour)}
                  </span>
                </div>

                {/* Day cells */}
                {visibleColumns.map((col) => (
                  <div
                    key={`cell-${col.key}-${hour}`}
                    className={`relative border-b border-r border-b-zinc-800/20 transition-colors ${
                      col.isPast
                        ? "bg-zinc-950/40"
                        : col.isToday
                          ? "bg-zinc-900/15"
                          : ""
                    } ${!col.isPast && dropTarget === col.key ? "bg-sky-500/5" : ""} ${
                      col.isToday ? "border-r-sky-400/18" : "border-r-zinc-700/30"
                    }`}
                    style={{ height: ROW_H }}
                    onDragOver={(e) => !col.isPast && onDragOver(e, col.key)}
                    onDragLeave={!col.isPast ? onDragLeave : undefined}
                    onDrop={(e) => !col.isPast && onDropToTimeCell(e, col.key, hour)}
                    onPointerDown={(e) => {
                      if (col.isPast) return;
                      queuePointerEdit("create", e, col.key, null);
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>

        {/* ── Positioned slot blocks ── */}
        <div
          ref={overlayGridRef}
          className="pointer-events-none absolute z-10 overflow-hidden"
          style={{
            top: headerHeight,
            left: 56,
            width: "calc(100% - 56px)",
            height: TOTAL_HOURS * ROW_H,
            minWidth: visibleGridWidth - 56,
          }}
        >
          <div
            className="relative grid h-full"
            style={{ gridTemplateColumns: `repeat(${visibleColumns.length}, minmax(120px, 1fr))` }}
          >
            {visibleColumns.map((col) => {
              const isYesterdayColumn = col.key === yesterdayKey;
              const hasOverdueTaskSlot = col.slots.some((slot) => {
                const linkedTask = slot.taskId ? linkedTasksById.get(slot.taskId) ?? null : null;
                if (!linkedTask || !isOverdueUndoneTask(linkedTask, today)) return false;
                return !getScheduleSlotApprovalState(slot).isCompleted;
              });

              return (
                <div
                  key={`overlay-${col.key}`}
                  className={`relative ${
                    col.isPast
                      ? isYesterdayColumn
                        ? ""
                        : hasOverdueTaskSlot
                          ? "opacity-80"
                          : "opacity-30 grayscale"
                      : ""
                  }`}
                >
                  <div
                    className={`pointer-events-none absolute inset-y-0 right-0 w-px ${
                      col.isToday ? "bg-sky-400/28" : "bg-zinc-500/42"
                    }`}
                  />
                  <div
                    className={`pointer-events-none absolute inset-y-0 right-0 w-0.5 ${
                      col.isToday
                        ? "bg-linear-to-b from-sky-200/18 via-sky-300/60 to-sky-200/18"
                        : "bg-linear-to-b from-zinc-100/10 via-zinc-200/42 to-zinc-100/10"
                    }`}
                  />
                  {col.slots.map((slot) => {
                  const slotInstanceKey = `${slot.date}:${slot.id}`;
                  if (activeEdit?.originalSlot?.id === slot.id && activeEdit.originalSlot.date === slot.date) {
                    return null;
                  }
                  if (reboundPreview?.slotId === slot.id && reboundPreview.slotDate === slot.date) {
                    return null;
                  }

                  const top = slotTop(slot.start);
                  const height = slotHeight(slot.start, slot.end);
                  const isChildcareBackground = isChildcareBackgroundSlot(slot);
                  const laneMetrics = isChildcareBackground
                    ? getBackgroundSlotMetrics(overlayColumnWidth)
                    : getLaneMetrics(
                        {
                          id: slot.id,
                          start: slot.start,
                          end: slot.end,
                          source: slot.source,
                          tags: slot.tags,
                        },
                        col.slots.map((candidate) => ({
                          id: candidate.id,
                          start: candidate.start,
                          end: candidate.end,
                          source: candidate.source,
                          tags: candidate.tags,
                        })),
                        overlayColumnWidth,
                      );
                  const c = toneColor(slot.tone);
                  const linkedTask = slot.taskId ? linkedTasksById.get(slot.taskId) ?? null : null;
                  const approvalState = getScheduleSlotApprovalState(slot);
                  const requiresApproval = approvalState.requiresApproval;
                  const isCompletedSlot = approvalState.isCompleted;
                  const attentionState = getSlotAttentionState({
                    dayKey: col.key,
                    todayKey: today,
                    requiresApproval,
                    isCompleted: isCompletedSlot,
                  });
                  const { isYesterdayPendingSlot, isYesterdayMutedSlot } = attentionState;
                  const isOverdueCarryoverTask = Boolean(
                    !isYesterdayMutedSlot && linkedTask && isOverdueUndoneTask(linkedTask, today) && !isCompletedSlot,
                  );
                  const isYesterdayCarryoverTask = Boolean(
                    !isYesterdayMutedSlot && linkedTask && isYesterdayUndoneTask(linkedTask, today) && !isCompletedSlot,
                  );
                  const completionLabel = formatCompletionLabel(approvalState.completedAt);
                  const projectLabel = getSlotProjectLabel(slot, linkedTask, projectNameById);
                  const isHeysSynced = isHeysSyncedScheduleSlot(slot);
                  const heysBadgeLabel = isHeysSynced ? getHeysSyncedSlotBadgeLabel(slot) : null;
                  const explainability = getScheduleSlotExplainability(slot);
                  const desktopHintContent = getDesktopSlotHintContent({
                    slot,
                    todayKey: today,
                    requiresApproval,
                    isCompleted: isCompletedSlot,
                    explainability,
                  });
                  const previousContextSlot = getAdjacentContextSlot(col.slots, slot, "previous");
                  const nextContextSlot = getAdjacentContextSlot(col.slots, slot, "next");
                  const remainingDaySlots = col.slots.filter((candidate) => {
                    if (candidate.id === slot.id) return false;
                    if (isAmbientContextSlot(candidate)) return false;
                    return timeToMinutes(candidate.start) >= timeToMinutes(slot.end);
                  });
                  const supportNote = getCalendarSlotSupportNote(slot, {
                    dayModeId: heysDayMode?.id,
                    previousSlot: previousContextSlot,
                    nextSlot: nextContextSlot,
                    pressure: col.pressure,
                    remainingDay: {
                      remainingSlots: remainingDaySlots.length,
                      remainingHeavySlots: remainingDaySlots.filter(isBudgetHeavySlot).length,
                      remainingWorkSlots: remainingDaySlots.filter(isBudgetWorkLikeSlot).length,
                      remainingRecoverySlots: remainingDaySlots.filter(isBudgetRecoveryLikeSlot).length,
                    },
                  });
                  const supportHintKey = `${slotInstanceKey}:support`;
                  const supportHintContent = supportNote
                    ? toSupportDesktopHintContent(supportNote)
                    : null;
                  const isEditable = isEditableScheduleSlot(slot);
                  const isSupportSlot = laneMetrics.isSupportLane;
                  const isBlockingSlot =
                    activeEdit?.blocked &&
                    activeEdit.blockingSlot?.id === slot.id &&
                    activeEdit.blockingSlot.date === slot.date;
                  const isQuickMenuSlot = quickMenu?.slot.id === slot.id && quickMenu.slot.date === slot.date;
                  const isActiveSlot =
                    activeEdit?.originalSlot?.id === slot.id && activeEdit.originalSlot.date === slot.date;
                  const isSelectedSlot = isQuickMenuSlot || isActiveSlot;
                  const isHoveredSlot = hoveredSlotKey === slotInstanceKey;
                  const showSupportNoteInline = Boolean(
                    supportNote && !isChildcareBackground && !isSupportSlot && height > 66,
                  );
                  const showSupportNoteCompact = Boolean(
                    supportNote && !isChildcareBackground && !showSupportNoteInline && height > 34,
                  );
                  const slotPadding = isChildcareBackground
                    ? height >= 88
                      ? "px-3 py-2.5"
                      : "px-2.5 py-2"
                    : isSupportSlot
                      ? height >= 88
                        ? "px-1.5 py-1.5"
                        : "px-1 py-1"
                      : !isEditable
                        ? isHeysSynced
                          ? "px-2 pt-5 pb-1"
                          : "px-2 py-1"
                        : isHeysSynced
                          ? height >= 96
                            ? "px-2 pt-6 pb-5"
                            : height >= 64
                              ? "px-2 pt-5 pb-4"
                              : "px-2 pt-4 pb-3"
                          : height >= 96
                            ? "px-2 pt-5 pb-5"
                            : height >= 64
                              ? "px-2 pt-4 pb-4"
                              : "px-2 pt-3 pb-3";
                  const handleButtonHeight = height >= 64 ? "h-5" : "h-4";
                  const handleGripSize = height >= 64 ? "h-1 w-4" : "h-0.5 w-3";
                  const handleOpacity = isActiveSlot
                    ? "opacity-90"
                    : isMobileGripMode
                      ? isQuickMenuSlot
                        ? "opacity-80"
                        : "opacity-0"
                      : isHoveredSlot
                        ? "opacity-70"
                        : "opacity-0";
                  const handleGripTone = isSelectedSlot ? "bg-white/55" : "bg-white/28";
                  const primaryTextClass = isYesterdayPendingSlot
                    ? "text-rose-50"
                    : isYesterdayMutedSlot
                      ? "text-zinc-400"
                      : isCompletedSlot
                        ? "text-emerald-50"
                        : isYesterdayCarryoverTask
                          ? "text-rose-50"
                          : isOverdueCarryoverTask
                            ? "text-amber-50"
                            : c.text;
                  const secondaryTextClass = isYesterdayPendingSlot
                    ? "text-rose-100/80"
                    : isYesterdayMutedSlot
                      ? "text-zinc-500"
                      : isCompletedSlot
                        ? "text-emerald-100/80"
                        : isYesterdayCarryoverTask
                          ? "text-rose-100/80"
                          : isOverdueCarryoverTask
                            ? "text-amber-100/80"
                            : "text-zinc-500";
                  const shellTone = isYesterdayPendingSlot
                    ? "border-rose-500/55 bg-linear-to-br from-rose-500/24 via-red-500/18 to-rose-950/36"
                    : isYesterdayMutedSlot
                      ? "border-zinc-800/80 bg-zinc-900/72"
                      : isChildcareBackground
                        ? "border-amber-500/16 bg-linear-to-br from-amber-500/12 via-orange-500/8 to-amber-950/4"
                        : isCompletedSlot
                          ? "border-emerald-400/55 bg-linear-to-br from-emerald-400/32 via-emerald-500/22 to-emerald-950/42"
                          : isYesterdayCarryoverTask
                            ? "border-rose-500/50 bg-linear-to-br from-rose-500/22 via-red-500/16 to-rose-950/34"
                            : isOverdueCarryoverTask
                              ? "border-amber-500/50 bg-linear-to-br from-amber-500/20 via-orange-500/14 to-amber-950/32"
                              : `${c.border} ${c.bg}`;
                  const shellDepth = isChildcareBackground
                    ? "shadow-none"
                    : isBlockingSlot
                      ? "ring-2 ring-rose-400/80 shadow-[0_0_0_1px_rgba(248,113,113,0.22),0_14px_28px_rgba(127,29,29,0.28)]"
                      : isSelectedSlot
                        ? "ring-1 ring-white/12 shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_10px_24px_rgba(0,0,0,0.22)]"
                        : isHeysSynced
                          ? "shadow-[0_0_0_1px_rgba(251,146,60,0.24),0_10px_24px_rgba(0,0,0,0.22)]"
                          : "shadow-[0_6px_18px_rgba(0,0,0,0.18)]";
                  const slotZIndex = isChildcareBackground ? 0 : isSelectedSlot ? 14 : isSupportSlot ? 11 : 12;
                  const slotCardModel = {
                    colKey: col.key,
                    slot,
                    top,
                    height,
                    laneMetrics,
                    slotInstanceKey,
                    isChildcareBackground,
                    isEditable,
                    isSupportSlot,
                    isQuickMenuSlot,
                    isActiveSlot,
                    isHoveredSlot,
                    isMobileGripMode,
                    isYesterdayPendingSlot,
                    isYesterdayMutedSlot,
                    isCompletedSlot,
                    isYesterdayCarryoverTask,
                    isOverdueCarryoverTask,
                    requiresApproval,
                    completionLabel,
                    projectLabel,
                    isHeysSynced,
                    heysBadgeLabel,
                    explainability,
                    supportNote,
                    supportHintKey,
                    supportHintContent,
                    desktopHintContent,
                    primaryTextClass,
                    secondaryTextClass,
                    slotPadding,
                    shellTone,
                    shellDepth,
                    handleButtonHeight,
                    handleGripSize,
                    handleOpacity,
                    handleGripTone,
                    slotZIndex,
                    showSupportNoteInline,
                    showSupportNoteCompact,
                  };

                  return (
                    <CalendarSlotCard
                      key={slot.id}
                      model={slotCardModel}
                      desktopSlotHintSlotKey={desktopSlotHint?.slotKey ?? null}
                      desktopSlotHintPendingKey={desktopSlotHintPendingKeyRef.current}
                      skipNextClickRef={skipNextClickRef}
                      onQueuePointerEdit={queuePointerEdit}
                      onScheduleDesktopSlotHint={scheduleDesktopSlotHint}
                      onHideDesktopSlotHint={hideDesktopSlotHint}
                      onOpenQuickMenu={openQuickMenu}
                      onToggleSlotApproval={toggleSlotApproval}
                      onSetHoveredSlotKey={setHoveredSlotKey}
                    />
                  );
                })}

                {activeEdit?.draft.date === col.key && (() => {
                  const draftTop = slotTop(activeEdit.draft.start);
                  const draftHeight = slotHeight(activeEdit.draft.start, activeEdit.draft.end);
                  const draftLaneSlot: LaneRenderable = {
                    id: activeEdit.originalSlot?.id ?? "draft-preview",
                    start: activeEdit.draft.start,
                    end: activeEdit.draft.end,
                    source: activeEdit.originalSlot?.source ?? "derived",
                    tags: activeEdit.originalSlot?.tags ?? activeEdit.draft.tags,
                  };
                  const draftLanePool = col.slots
                    .filter((slot) => slot.id !== activeEdit.originalSlot?.id)
                    .map((slot) => ({
                      id: slot.id,
                      start: slot.start,
                      end: slot.end,
                      source: slot.source,
                      tags: slot.tags,
                    }))
                    .concat(draftLaneSlot);
                  const draftLaneMetrics = getLaneMetrics(draftLaneSlot, draftLanePool, overlayColumnWidth);
                  const draftColor = toneColor(activeEdit.draft.tone);
                  const previewClass = activeEdit.blocked
                    ? "border-rose-400/80 bg-rose-950/45 text-rose-100"
                    : `${draftColor.border} ${draftColor.bg}`;
                  return (
                    <div
                      className={`pointer-events-none absolute overflow-hidden rounded-xl border-2 border-dashed px-2 py-2 shadow-[0_18px_42px_rgba(0,0,0,0.28)] ${previewClass} ${
                        activeEdit.blocked ? "opacity-95" : "opacity-90"
                      }`}
                      style={{ top: draftTop, left: draftLaneMetrics.left, width: draftLaneMetrics.width, height: draftHeight, minHeight: 20 }}
                    >
                      <p className={`text-[10px] font-semibold leading-tight ${activeEdit.blocked ? "text-rose-100" : draftColor.text}`}>
                        {formatScheduleTimeRange(activeEdit.draft.start, activeEdit.draft.end)}
                      </p>
                      <p className={`mt-0.5 font-semibold leading-snug ${activeEdit.blocked ? "text-rose-100" : draftColor.text} ${draftLaneMetrics.isSupportLane ? "line-clamp-4 text-[10px]" : "truncate text-[11px]"}`}>
                        {activeEdit.originalSlot ? activeEdit.draft.title : "Новый слот"}
                      </p>
                      <p className={`mt-1 text-[9px] font-medium uppercase tracking-[0.14em] ${activeEdit.blocked ? "text-rose-200" : "text-zinc-300"}`}>
                        {activeEdit.blocked
                          ? `Нельзя · ${activeEdit.blockingSlot?.title ?? "занято"}`
                          : activeEdit.mode === "move"
                            ? "Ghost · перемещение"
                            : activeEdit.mode === "resize-start"
                              ? "Ghost · старт"
                              : activeEdit.mode === "resize-end"
                                ? "Ghost · финиш"
                                : "Ghost · создание"}
                      </p>
                    </div>
                  );
                })()}

                {/* Now-line */}
                {col.isToday && <CalendarNowLine />}
                </div>
              );
            })}
          </div>

          {reboundPreview && (() => {
            const targetDraft = reboundPreview.stage === "from" ? reboundPreview.from : reboundPreview.to;
            const box = getOverlayBoxForDraft(
              targetDraft,
              {
                id: reboundPreview.slotId ?? "rebound-preview",
                source: reboundPreview.source,
                tags: reboundPreview.tags,
              },
              reboundPreview.slotId,
            );
            if (!box) return null;

            return (
              <div
                className="pointer-events-none absolute overflow-hidden rounded-xl border-2 border-rose-400/75 bg-rose-950/35 px-2 py-2 opacity-90 shadow-[0_20px_44px_rgba(0,0,0,0.3)] transition-all duration-200 ease-out"
                style={{
                  left: box.left,
                  top: box.top,
                  width: box.width,
                  height: box.height,
                  minHeight: 20,
                }}
              >
                <p className="text-[10px] font-semibold leading-tight text-rose-100">
                  {formatScheduleTimeRange(targetDraft.start, targetDraft.end)}
                </p>
                <p className="mt-0.5 truncate text-[11px] font-semibold leading-snug text-rose-100">
                  {reboundPreview.title}
                </p>
                <p className="mt-1 text-[9px] font-medium uppercase tracking-[0.14em] text-rose-200">
                  Возврат назад{reboundPreview.blockedLabel ? ` · занято: ${reboundPreview.blockedLabel}` : ""}
                </p>
              </div>
            );
          })()}
        </div>

        {activeEdit && (
          <>
            <div
              className="pointer-events-none absolute inset-x-0 top-0 z-20 h-18 bg-linear-to-b from-sky-400/20 to-transparent transition-opacity duration-150"
              style={{ opacity: edgeCue.top }}
            />
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-18 bg-linear-to-t from-sky-400/20 to-transparent transition-opacity duration-150"
              style={{ opacity: edgeCue.bottom }}
            />
            <div
              className="pointer-events-none absolute inset-y-0 left-0 z-20 w-16 bg-linear-to-r from-sky-400/18 to-transparent transition-opacity duration-150"
              style={{ opacity: edgeCue.left }}
            />
            <div
              className="pointer-events-none absolute inset-y-0 right-0 z-20 w-16 bg-linear-to-l from-sky-400/18 to-transparent transition-opacity duration-150"
              style={{ opacity: edgeCue.right }}
            />
          </>
        )}
      </div>

      {quickMenu && (
        <CalendarQuickMenu
          menuRef={quickMenuRef}
          quickMenu={quickMenu}
          linkedTasksById={linkedTasksById}
          projects={projects}
          projectNameById={projectNameById}
          columns={columns}
          today={today}
          onClose={closeQuickMenu}
          onUpdateDraft={updateQuickMenuDraft}
          onSaveDraft={saveQuickMenuDraft}
          onDuplicate={duplicateQuickSlot}
          onApplyPatch={applyQuickSlotPatch}
          onDelete={deleteQuickSlot}
          onUnschedule={unscheduleQuickSlot}
          onToggleApproval={toggleQuickSlotApproval}
          onVersionBump={() => setVersion((v) => v + 1)}
        />
      )}


      {activeEdit && (() => {
        const startTop = slotTop(activeEdit.draft.start);
        const endTop = slotTop(activeEdit.draft.end);
        const startMin = timeToMinutes(activeEdit.draft.start);
        const endMin = timeToMinutes(activeEdit.draft.end);
        const baseDuration = timeToMinutes(activeEdit.base.end) - timeToMinutes(activeEdit.base.start);
        const draftDuration = endMin - startMin;
        const durationDelta = draftDuration - baseDuration;
        const tooltipColor = activeEdit.blocked
          ? "border-rose-400/60 bg-rose-950/92 text-rose-100"
          : "border-sky-400/35 bg-zinc-950/92 text-zinc-100";
        const guideColor = activeEdit.blocked ? "border-rose-400/50" : "border-sky-400/35";
        const pointerX = activePointerClientRef.current.x;
        const pointerY = activePointerClientRef.current.y;
        const tooltipWidth = 176;
        const tooltipHeight = 72;
        const viewportW = typeof window !== "undefined" ? window.innerWidth : 0;
        const viewportH = typeof window !== "undefined" ? window.innerHeight : 0;
        const tooltipLeft = clamp(pointerX + 18, 12, Math.max(12, viewportW - tooltipWidth - 12));
        const tooltipTop = clamp(pointerY - tooltipHeight - 12, 12, Math.max(12, viewportH - tooltipHeight - 12));
        const durationMeta =
          activeEdit.mode === "resize-start" || activeEdit.mode === "resize-end"
            ? formatDurationDelta(durationDelta)
            : activeEdit.draft.date !== activeEdit.base.date
              ? `→ ${activeEdit.draft.date.slice(5)}`
              : `${draftDuration}м`;

        return (
          <>
            <div className="pointer-events-none fixed z-50" style={{ left: tooltipLeft, top: tooltipTop, width: tooltipWidth }}>
              <div className={`rounded-2xl border px-3 py-2 shadow-[0_14px_30px_rgba(0,0,0,0.28)] backdrop-blur ${tooltipColor}`}>
                <p className="text-[11px] font-semibold tracking-[0.02em]">
                  {formatScheduleTimeRange(activeEdit.draft.start, activeEdit.draft.end)}
                </p>
                <div className="mt-1 flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.14em]">
                  <span className={activeEdit.blocked ? "text-rose-200" : "text-zinc-400"}>
                    {activeEdit.mode === "move"
                      ? "Drag"
                      : activeEdit.mode === "resize-start"
                        ? "Resize start"
                        : activeEdit.mode === "resize-end"
                          ? "Resize end"
                          : "Create"}
                  </span>
                  <span className={activeEdit.blocked ? "text-rose-200" : "text-sky-300"}>{durationMeta}</span>
                </div>
                {activeEdit.blocked && (
                  <p className="mt-1 truncate text-[10px] text-rose-200">
                    Конфликт: {activeEdit.blockingSlot?.title ?? "занято"}
                  </p>
                )}
              </div>
            </div>

            <div className="pointer-events-none absolute inset-0 z-20" style={{ top: headerHeight, left: 56, width: "calc(100% - 56px)", height: TOTAL_HOURS * ROW_H }}>
              {[
                { top: startTop, label: formatScheduleClockTime(activeEdit.draft.start) },
                { top: endTop, label: formatScheduleClockTime(activeEdit.draft.end) },
              ].map((guide) => (
                <div key={`${guide.label}-${guide.top}`} className="absolute left-0 right-0" style={{ top: guide.top }}>
                  <div className={`border-t border-dashed ${guideColor}`} />
                  <span className={`absolute left-2 top-0 -translate-y-1/2 rounded-full border px-2 py-0.5 text-[10px] font-medium shadow-[0_6px_18px_rgba(0,0,0,0.18)] ${tooltipColor}`}>
                    {guide.label}
                  </span>
                </div>
              ))}
            </div>
          </>
        );
      })()}

      {desktopSlotHint && <CalendarDesktopHint hint={desktopSlotHint} />}
    </section>
  );
}
