"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AREA_COLOR,
  AREA_LEGEND,
  type LifeArea,
  taskArea,
  taskColor,
  toneColor,
} from "@/lib/life-areas";
import {
  addCustomEvent,
  getScheduledTaskIds,
  isEditableScheduleSlot,
  removeEditableScheduleSlot,
  type ScheduleSlot,
  type ScheduleSource,
  type ScheduleTone,
  getScheduleForDate,
  timeToMinutes,
  updateEditableScheduleSlot,
} from "@/lib/schedule";
import { writeTaskDragData } from "@/lib/dashboard-events";
import { dateStr, subscribeAppDataChange } from "@/lib/storage";
import {
  type Task,
  compareTasksByAttention,
  getActionableTasks,
  updateTask,
} from "@/lib/tasks";

/* ── Constants ── */

const HOUR_START = 5; // 05:00
const HOUR_END = 24; // 00:00 next day
const TOTAL_HOURS = HOUR_END - HOUR_START; // 19
const ROW_H = 56; // px per hour row
const HEADER_H = 66; // compact column header height
const STEP_MIN = 30;
const MIN_SLOT_MIN = 30;
const DEFAULT_CUSTOM_DURATION_MIN = 60;
const MOUSE_HOLD_MS = 110;
const TOUCH_HOLD_MS = 240;
const POINTER_SLOP_PX = 10;
const AUTO_SCROLL_EDGE_PX = 72;
const AUTO_SCROLL_MAX_STEP = 24;
const QUICK_MENU_ESTIMATED_HEIGHT = 560;
const SUPPORT_LANE_RATIO = 0.36;
const SLOT_SIDE_INSET_PX = 4;
const SLOT_LANE_GAP_PX = 6;

const QUICK_TONE_OPTIONS: Array<{ value: ScheduleTone; label: string }> = [
  { value: "work", label: "💼 Работа" },
  { value: "kinderly", label: "🎉 Kinderly" },
  { value: "heys", label: "⚙️ HEYS" },
  { value: "health", label: "🫀 Здоровье" },
  { value: "personal", label: "🌙 Личное" },
  { value: "cleanup", label: "🧹 Опер." },
  { value: "family", label: "🏡 Семья" },
  { value: "review", label: "🧠 Review" },
];

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
  const mins = timeToMinutes(startTime);
  return ((mins - HOUR_START * 60) / 60) * ROW_H;
}

function slotHeight(start: string, end: string): number {
  const duration = timeToMinutes(end) - timeToMinutes(start);
  return Math.max((duration / 60) * ROW_H, 20);
}

function taskBelongsToDay(task: Task, dayKey: string, today: string, isToday: boolean): boolean {
  if (!task.dueDate) return isToday && task.status === "active";
  if (task.dueDate === dayKey) return true;
  return isToday && task.dueDate < today;
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function snapMinutes(minutes: number): number {
  return Math.round(minutes / STEP_MIN) * STEP_MIN;
}

function minutesToCalendarTime(minutes: number): string {
  if (minutes >= HOUR_END * 60) return "24:00";
  const safe = Math.max(0, minutes);
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function shiftDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function copyTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.toLowerCase().endsWith("(копия)")) return trimmed;
  return `${trimmed} (копия)`;
}

type TimeRange = {
  start: string;
  end: string;
};

type LaneRenderable = {
  id: string;
  start: string;
  end: string;
  source: ScheduleSource;
  tags: string[];
};

type LaneMetrics = {
  left: number;
  width: number;
  isSupportLane: boolean;
};

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

function vibrateIfAvailable(pattern: number | number[]) {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  navigator.vibrate(pattern);
}

function sameEdgeCue(
  left: { top: number; bottom: number; left: number; right: number },
  right: { top: number; bottom: number; left: number; right: number },
) {
  return (
    left.top === right.top &&
    left.bottom === right.bottom &&
    left.left === right.left &&
    left.right === right.right
  );
}

function formatDurationDelta(minutes: number): string {
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

/* ── Types ── */

type DayColumn = {
  key: string;
  date: Date;
  dayLabel: string;
  dateLabel: string;
  isToday: boolean;
  isPast: boolean;
  isWeekend: boolean;
  tasks: Task[];
  slots: ScheduleSlot[];
};

type WeekCalendarGridProps = {
  stats?: {
    inboxCount: number;
    activeCount: number;
    doneThisWeek: number;
  } | null;
};

type DragState =
  | { type: "task"; taskId: string; originDay: string }
  | null;

type CalendarViewMode = "full" | "compact";

type EditableSlotDraft = {
  id: string | null;
  date: string;
  start: string;
  end: string;
  title: string;
  tone: ScheduleTone;
  tags: string[];
};

type PointerEditMode = "move" | "resize-start" | "resize-end" | "create";

type PendingPointerEdit = {
  mode: PointerEditMode;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  dayKey: string;
  slot: ScheduleSlot | null;
};

type ActivePointerEdit = {
  mode: PointerEditMode;
  pointerId: number;
  pointerType: string;
  originClientX: number;
  originClientY: number;
  originColumnIndex: number;
  originalSlot: ScheduleSlot | null;
  base: EditableSlotDraft;
  draft: EditableSlotDraft;
  hasMoved: boolean;
  blocked: boolean;
  blockingSlot: ScheduleSlot | null;
};

type QuickMenuState = {
  slot: ScheduleSlot;
  top: number;
  left: number;
  mobile: boolean;
  draftTitle: string;
  draftTone: ScheduleTone;
};

type EdgeCueState = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

type ReboundPreview = {
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

function getCompactStart(columns: DayColumn[], compactCount: number): number {
  if (columns.length <= compactCount) return 0;
  const todayIndex = columns.findIndex((column) => column.isToday);
  if (todayIndex < 0) return 0;

  return Math.max(0, Math.min(todayIndex - 1, columns.length - compactCount));
}

/* ── Component ── */

export function WeekCalendarGrid({ stats }: WeekCalendarGridProps) {
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
  const today = todayKey();

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
          ["alphacore_tasks", "alphacore_schedule_custom", "alphacore_schedule_overrides"].includes(k),
        )
      ) {
        setVersion((v) => v + 1);
      }
    });
  }, []);

  const days = useMemo(() => (anchor ? buildWindow(anchor) : []), [anchor]);

  // center current-time line on first render / when returning to today
  useEffect(() => {
    if (!shouldCenterNow) return;

    const hasTodayColumn = days.some((day) => dateStr(day) === today);
    if (!hasTodayColumn) return;

    const frame = requestAnimationFrame(() => {
      centerNowLine(gridRef.current);
      setShouldCenterNow(false);
    });

    return () => cancelAnimationFrame(frame);
  }, [days, shouldCenterNow, today]);

  const columns = useMemo<DayColumn[]>(() => {
    const tasks = getActionableTasks(today);
    return days.map((date) => {
      const key = dateStr(date);
      const isToday = key === today;
      const isPast = key < today;
      const weekday = date.getDay();
      const isWeekend = weekday === 0 || weekday === 6;
      const scheduledTaskIds = new Set(getScheduledTaskIds(key));
      return {
        key,
        date,
        dayLabel: new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(date),
        dateLabel: new Intl.DateTimeFormat("ru-RU", { day: "numeric" }).format(date),
        isToday,
        isPast,
        isWeekend,
        tasks: tasks
          .filter((t) => taskBelongsToDay(t, key, today, isToday) && !scheduledTaskIds.has(t.id))
          .sort((a, b) => compareTasksByAttention(a, b, today)),
        slots: getScheduleForDate(key),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, today, version]);

  const compactCount = viewportWidth != null && viewportWidth < 640 ? 2 : 3;

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

  const visibleWindowLabel = useMemo(() => {
    if (visibleColumns.length === 0) return "";
    const first = visibleColumns[0]?.date;
    const last = visibleColumns[visibleColumns.length - 1]?.date;
    if (!first || !last) return "";
    const fmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
    return `${fmt.format(first)} — ${fmt.format(last)}`;
  }, [visibleColumns]);

  const showCompactControls = viewMode === "compact" && columns.length > compactCount;

  const cancelPendingPointerEdit = useCallback(() => {
    if (!pendingEditRef.current) return;
    window.clearTimeout(pendingEditRef.current.timerId);
    pendingEditRef.current = null;
  }, []);

  const closeQuickMenu = useCallback(() => {
    setQuickMenu(null);
  }, []);

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
      const siblings = getScheduleForDate(draft.date).filter((slot) => {
        if (slot.id === originalSlot?.id) return false;
        if (isSupportLaneSlot(slot)) return false;
        if (isChildcareBackgroundSlot(slot)) return false;
        if (draftIsAmbient) return false;
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
      const deltaMin = snapMinutes(((clientY - edit.originClientY) / ROW_H) * 60);
      const targetDate = getPointerDayKey(clientX);

      let draft = edit.draft;

      if (edit.mode === "move") {
        const nextStart = clamp(baseStartMin + deltaMin, HOUR_START * 60, HOUR_END * 60 - duration);
        draft = {
          ...edit.base,
          date: targetDate,
          start: minutesToCalendarTime(nextStart),
          end: minutesToCalendarTime(nextStart + duration),
        };
      }

      if (edit.mode === "resize-start") {
        const nextStart = clamp(baseStartMin + deltaMin, HOUR_START * 60, baseEndMin - MIN_SLOT_MIN);
        draft = {
          ...edit.base,
          start: minutesToCalendarTime(nextStart),
        };
      }

      if (edit.mode === "resize-end") {
        const nextEnd = clamp(baseEndMin + deltaMin, baseStartMin + MIN_SLOT_MIN, HOUR_END * 60);
        draft = {
          ...edit.base,
          end: minutesToCalendarTime(nextEnd),
        };
      }

      if (edit.mode === "create") {
        const anchorMin = baseStartMin;
        const pointerMin = getSnappedMinutesFromClientY(clientY);
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
          };

      const next: ActivePointerEdit = {
        mode: pending.mode,
        pointerId: pending.pointerId,
        pointerType: pending.pointerType,
        originClientX: pending.startX,
        originClientY: pending.startY,
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
    };
  }, []);

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
    [activatePendingPointerEdit, cancelPendingPointerEdit, today],
  );

  const openQuickMenu = useCallback((element: HTMLElement, slot: ScheduleSlot) => {
    const rect = element.getBoundingClientRect();
    const mobile = window.innerWidth < 640;
    const desktopHalfWidth = 192;
    const maxTop = Math.max(12, window.innerHeight - QUICK_MENU_ESTIMATED_HEIGHT - 12);

    setHoveredSlotKey(null);
    setQuickMenu({
      slot,
      top: clamp(rect.top + Math.min(rect.height, 28) + 10, 12, maxTop),
      left: clamp(rect.left + rect.width / 2, 16 + desktopHalfWidth, window.innerWidth - 16 - desktopHalfWidth),
      mobile,
      draftTitle: slot.title,
      draftTone: slot.tone,
    });
  }, []);

  const updateQuickMenuDraft = useCallback((patch: Partial<Pick<QuickMenuState, "draftTitle" | "draftTone">>) => {
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

    if (nextTitle === quickMenu.slot.title && quickMenu.draftTone === quickMenu.slot.tone) {
      setQuickMenu(null);
      return;
    }

    updateEditableScheduleSlot(quickMenu.slot, {
      title: nextTitle,
      tone: quickMenu.draftTone,
    });
    setVersion((value) => value + 1);
    setQuickMenu(null);
  }, [quickMenu]);

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
    });
    setVersion((value) => value + 1);
    setQuickMenu(null);
  }, [quickMenu]);

  const deleteQuickSlot = useCallback((slot: ScheduleSlot) => {
    removeEditableScheduleSlot(slot);
    setVersion((value) => value + 1);
    setQuickMenu(null);
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

  // drag handlers
  const onDragStartTask = useCallback((taskId: string, originDay: string) => {
    setDrag({ type: "task", taskId, originDay });
  }, []);

  const onDragOver = useCallback((e: React.DragEvent, dayKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(dayKey);
  }, []);

  const onDragLeave = useCallback(() => {
    setDropTarget(null);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent, targetDay: string) => {
      e.preventDefault();
      setDropTarget(null);
      if (!drag) return;

      if (drag.type === "task" && drag.originDay !== targetDay) {
        updateTask(drag.taskId, { dueDate: targetDay });
      }

      setDrag(null);
    },
    [drag],
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
            style={{ height: HEADER_H }}
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
              style={{ height: HEADER_H }}
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

              {/* All-day tasks */}
              {col.tasks.length > 0 && (
                <div className="mt-1 flex flex-wrap justify-center gap-1 overflow-hidden" style={{ maxHeight: 22 }}>
                  {col.tasks.slice(0, 2).map((t) => {
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
                        className={`max-w-full truncate rounded-md border px-1.5 py-0.5 text-[9px] font-medium ${
                          col.isPast
                            ? "border-zinc-800 bg-zinc-900/50 text-zinc-600"
                            : `cursor-grab ${c.border} ${c.bg} ${c.text}`
                        }`}
                        title={t.title}
                      >
                        {t.title}
                      </span>
                    );
                  })}
                  {col.tasks.length > 2 && (
                    <span className="text-[9px] text-zinc-600">+{col.tasks.length - 2}</span>
                  )}
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
                    onDrop={(e) => !col.isPast && onDrop(e, col.key)}
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
            top: HEADER_H,
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
              return (
                <div key={`overlay-${col.key}`} className={`relative ${col.isPast ? "opacity-30 grayscale" : ""}`}>
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
                  const slotPadding = isChildcareBackground
                    ? height >= 88
                      ? "px-3 py-2.5"
                      : "px-2.5 py-2"
                    : isSupportSlot
                      ? height >= 88
                        ? "px-1.5 py-1.5"
                        : "px-1 py-1"
                      : !isEditable
                        ? "px-2 py-1"
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
                  const shellTone = isChildcareBackground
                    ? "border-amber-500/16 bg-linear-to-br from-amber-500/12 via-orange-500/8 to-amber-950/4"
                    : `${c.border} ${c.bg}`;
                  const shellDepth = isChildcareBackground
                    ? "shadow-none"
                    : isBlockingSlot
                      ? "ring-2 ring-rose-400/80 shadow-[0_0_0_1px_rgba(248,113,113,0.22),0_14px_28px_rgba(127,29,29,0.28)]"
                      : isSelectedSlot
                        ? "ring-1 ring-white/12 shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_10px_24px_rgba(0,0,0,0.22)]"
                        : "shadow-[0_6px_18px_rgba(0,0,0,0.18)]";
                  const slotZIndex = isChildcareBackground ? 0 : isSelectedSlot ? 14 : isSupportSlot ? 11 : 12;

                  return (
                    <div
                      key={slot.id}
                      className={`group absolute overflow-hidden rounded-xl border ${slotPadding} ${shellTone} ${
                        isChildcareBackground ? "pointer-events-none" : "pointer-events-auto"
                      } ${isEditable ? "cursor-grab touch-none" : ""} ${shellDepth}`}
                      style={{ top, left: laneMetrics.left, width: laneMetrics.width, height, minHeight: 20, zIndex: slotZIndex }}
                      onPointerDown={(e) => {
                        if (!isEditable) return;
                        e.stopPropagation();
                        queuePointerEdit("move", e, col.key, slot);
                      }}
                      onPointerMove={() => {
                        if (isMobileGripMode) return;
                        if (hoveredSlotKey !== slotInstanceKey) {
                          setHoveredSlotKey(slotInstanceKey);
                        }
                      }}
                      onPointerLeave={() => {
                        if (hoveredSlotKey === slotInstanceKey) {
                          setHoveredSlotKey(null);
                        }
                      }}
                      onClick={(e) => {
                        if (!isEditable) return;
                        if (skipNextClickRef.current) {
                          skipNextClickRef.current = false;
                          return;
                        }
                        e.stopPropagation();
                        openQuickMenu(e.currentTarget, slot);
                      }}
                      title={`${slot.start}–${slot.end} ${slot.title}`}
                    >
                      {isChildcareBackground ? (
                        <>
                          <div className="pointer-events-none absolute inset-0 bg-linear-to-r from-amber-400/10 via-orange-400/6 to-transparent" />
                          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-amber-200/35 via-orange-300/18 to-transparent" />
                        </>
                      ) : (
                        <>
                          {isEditable && (
                            <button
                              type="button"
                              aria-label="Изменить начало"
                              className={`absolute inset-x-0 top-0 z-10 flex cursor-ns-resize items-start justify-between ${isSupportSlot ? "px-1.5" : "px-3"} bg-transparent transition-opacity ${handleOpacity} ${handleButtonHeight}`}
                              onClick={(e) => e.stopPropagation()}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                queuePointerEdit("resize-start", e, col.key, slot);
                              }}
                            >
                              <span className={`mt-1 rounded-full shadow-[0_0_0_1px_rgba(255,255,255,0.04)] ${handleGripTone} ${handleGripSize}`} />
                              <span className={`mt-1 rounded-full shadow-[0_0_0_1px_rgba(255,255,255,0.04)] ${handleGripTone} ${handleGripSize}`} />
                            </button>
                          )}
                          <p className={`text-[10px] font-medium leading-tight ${c.text}`}>
                            {slot.start}–{slot.end}
                          </p>
                          <p className={`mt-0.5 font-medium leading-snug ${c.text} ${isSupportSlot ? "line-clamp-4 text-[10px]" : "truncate text-[11px]"}`}>
                            {slot.title}
                          </p>
                          {!isSupportSlot && height > 40 && slot.subtitle && (
                            <p className="mt-0.5 line-clamp-2 text-[9px] leading-tight text-zinc-500">
                              {slot.subtitle}
                            </p>
                          )}
                          {isEditable && (
                            <button
                              type="button"
                              aria-label="Изменить конец"
                              className={`absolute inset-x-0 bottom-0 z-10 flex cursor-ns-resize items-end justify-between ${isSupportSlot ? "px-1.5" : "px-3"} bg-transparent transition-opacity ${handleOpacity} ${handleButtonHeight}`}
                              onClick={(e) => e.stopPropagation()}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                queuePointerEdit("resize-end", e, col.key, slot);
                              }}
                            >
                              <span className={`mb-1 rounded-full shadow-[0_0_0_1px_rgba(255,255,255,0.04)] ${handleGripTone} ${handleGripSize}`} />
                              <span className={`mb-1 rounded-full shadow-[0_0_0_1px_rgba(255,255,255,0.04)] ${handleGripTone} ${handleGripSize}`} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
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
                        {activeEdit.draft.start}–{activeEdit.draft.end}
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
                {col.isToday && <NowLine />}
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
                  {targetDraft.start}–{targetDraft.end}
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

      {quickMenu && (() => {
        const slot = quickMenu.slot;
        const startMin = timeToMinutes(slot.start);
        const endMin = timeToMinutes(slot.end);
        const durationMin = endMin - startMin;
        const draftTitle = quickMenu.draftTitle.trim();
        const saveDisabled = !draftTitle || (draftTitle === slot.title && quickMenu.draftTone === slot.tone);
        const earlierDisabled = startMin <= HOUR_START * 60;
        const laterDisabled = endMin >= HOUR_END * 60;
        const shorterDisabled = durationMin <= MIN_SLOT_MIN;
        const longerDisabled = endMin + STEP_MIN > HOUR_END * 60;
        const dayIndex = columns.findIndex((column) => column.key === slot.date);
        const prevDay = dayIndex > 0 ? columns[dayIndex - 1]?.key : null;
        const nextDay = dayIndex >= 0 && dayIndex < columns.length - 1 ? columns[dayIndex + 1]?.key : null;

        const actionBtnCls =
          "rounded-2xl border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-left text-[12px] font-medium text-zinc-200 transition hover:border-zinc-600 hover:text-zinc-50 disabled:cursor-not-allowed disabled:opacity-40";

        return (
          <div
            ref={quickMenuRef}
            className={quickMenu.mobile ? "fixed bottom-20 left-1/2 z-50 w-[min(22rem,calc(100vw-1rem))] -translate-x-1/2" : "fixed z-50 w-[min(24rem,calc(100vw-1.5rem))] -translate-x-1/2"}
            style={quickMenu.mobile ? undefined : { top: quickMenu.top, left: quickMenu.left }}
          >
            <div className={`overflow-y-auto overscroll-contain rounded-3xl border border-zinc-800 bg-zinc-950/95 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur ${quickMenu.mobile ? "max-h-[min(70vh,34rem)] p-3" : "max-h-[min(72vh,38rem)] p-3"}`}>
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[11px] uppercase tracking-[0.16em] text-zinc-500">Быстрые команды</p>
                  <p className="truncate text-sm font-semibold text-zinc-100">{slot.title}</p>
                  <p className="mt-0.5 text-[11px] text-zinc-400">{slot.start}–{slot.end}</p>
                </div>
                <button
                  type="button"
                  onClick={closeQuickMenu}
                  className="rounded-full border border-zinc-800 px-2 py-1 text-[10px] text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-100"
                >
                  ✕
                </button>
              </div>

              <div className="mb-3 space-y-2">
                <label className="block text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">
                  Название
                </label>
                <input
                  value={quickMenu.draftTitle}
                  onChange={(event) => updateQuickMenuDraft({ draftTitle: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      saveQuickMenuDraft();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      closeQuickMenu();
                    }
                  }}
                  className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600"
                  placeholder="Название слота"
                />
              </div>

              <div className="mb-3 space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">Тон</p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_TONE_OPTIONS.map((option) => {
                    const tone = toneColor(option.value);
                    const active = quickMenu.draftTone === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => updateQuickMenuDraft({ draftTone: option.value })}
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                          active
                            ? `${tone.border} ${tone.bg} ${tone.text}`
                            : "border-zinc-800 bg-zinc-900/60 text-zinc-500 hover:border-zinc-600 hover:text-zinc-200"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={actionBtnCls}
                  disabled={earlierDisabled}
                  onClick={() =>
                    applyQuickSlotPatch(slot, {
                      start: minutesToCalendarTime(startMin - STEP_MIN),
                      end: minutesToCalendarTime(endMin - STEP_MIN),
                    })
                  }
                >
                  ↑ раньше 30м
                </button>
                <button
                  type="button"
                  className={actionBtnCls}
                  disabled={laterDisabled}
                  onClick={() =>
                    applyQuickSlotPatch(slot, {
                      start: minutesToCalendarTime(startMin + STEP_MIN),
                      end: minutesToCalendarTime(endMin + STEP_MIN),
                    })
                  }
                >
                  ↓ позже 30м
                </button>

                <button
                  type="button"
                  className={actionBtnCls}
                  disabled={!prevDay}
                  onClick={() => prevDay && applyQuickSlotPatch(slot, { date: prevDay })}
                >
                  ← на день
                </button>
                <button
                  type="button"
                  className={actionBtnCls}
                  disabled={!nextDay}
                  onClick={() => nextDay && applyQuickSlotPatch(slot, { date: nextDay })}
                >
                  → на день
                </button>

                <button
                  type="button"
                  className={actionBtnCls}
                  disabled={shorterDisabled}
                  onClick={() =>
                    applyQuickSlotPatch(slot, {
                      end: minutesToCalendarTime(endMin - STEP_MIN),
                    })
                  }
                >
                  − длительность
                </button>
                <button
                  type="button"
                  className={actionBtnCls}
                  disabled={longerDisabled}
                  onClick={() =>
                    applyQuickSlotPatch(slot, {
                      end: minutesToCalendarTime(endMin + STEP_MIN),
                    })
                  }
                >
                  + длительность
                </button>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={saveQuickMenuDraft}
                  disabled={saveDisabled}
                  className="rounded-2xl border border-sky-500/30 bg-sky-950/30 px-3 py-2 text-sm font-semibold text-sky-200 transition hover:border-sky-400/50 hover:bg-sky-950/50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Сохранить
                </button>
                <button
                  type="button"
                  onClick={duplicateQuickSlot}
                  className="rounded-2xl border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-900"
                >
                  Дублировать
                </button>
              </div>

              <button
                type="button"
                onClick={() => deleteQuickSlot(slot)}
                className="mt-3 w-full rounded-2xl border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-sm font-semibold text-rose-200 transition hover:border-rose-400/50 hover:bg-rose-950/50"
              >
                Удалить
              </button>
            </div>
          </div>
        );
      })()}

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
                  {activeEdit.draft.start}–{activeEdit.draft.end}
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

            <div className="pointer-events-none absolute inset-0 z-20" style={{ top: HEADER_H, left: 56, width: "calc(100% - 56px)", height: TOTAL_HOURS * ROW_H }}>
              {[{ top: startTop, label: activeEdit.draft.start }, { top: endTop, label: activeEdit.draft.end }].map((guide) => (
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
    </section>
  );
}

/* ── Now indicator ── */

function NowLine() {
  const [top, setTop] = useState(() => calcNowTop());

  useEffect(() => {
    const id = setInterval(() => setTop(calcNowTop()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (top < 0 || top > TOTAL_HOURS * ROW_H) return null;

  return (
    <div
      className="pointer-events-none absolute left-0 right-0 z-30"
      style={{ top }}
    >
      <div className="flex items-center">
        <div className="h-2.5 w-2.5 rounded-full bg-rose-500" />
        <div className="h-px flex-1 bg-rose-500/70" />
      </div>
    </div>
  );
}

function calcNowTop(): number {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  return ((mins - HOUR_START * 60) / 60) * ROW_H;
}

function centerNowLine(container: HTMLDivElement | null) {
  if (!container) return;

  const rowViewportHeight = Math.max(container.clientHeight - HEADER_H, 0);
  const rawTarget = calcNowTop() - rowViewportHeight / 2;
  const maxScroll = Math.max(container.scrollHeight - container.clientHeight, 0);
  const nextScrollTop = Math.min(Math.max(rawTarget, 0), maxScroll);

  container.scrollTop = nextScrollTop;
}
