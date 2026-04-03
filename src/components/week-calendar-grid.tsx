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
  isEditableScheduleSlot,
  removeEditableScheduleSlot,
  type ScheduleSlot,
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
};

type QuickMenuState = {
  slot: ScheduleSlot;
  top: number;
  left: number;
  mobile: boolean;
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
        setViewMode(width < 960 ? "compact" : "full");
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
      return {
        key,
        date,
        dayLabel: new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(date),
        dateLabel: new Intl.DateTimeFormat("ru-RU", { day: "numeric" }).format(date),
        isToday,
        isPast,
        isWeekend,
        tasks: tasks
          .filter((t) => taskBelongsToDay(t, key, today, isToday))
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

      return {
        ...edit,
        draft,
        hasMoved:
          edit.hasMoved ||
          Math.abs(clientX - edit.originClientX) > POINTER_SLOP_PX ||
          Math.abs(clientY - edit.originClientY) > POINTER_SLOP_PX ||
          draft.date !== edit.base.date ||
          draft.start !== edit.base.start ||
          draft.end !== edit.base.end,
      };
    },
    [getPointerDayKey, getSnappedMinutesFromClientY],
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
      };

      skipNextClickRef.current = true;
      setQuickMenu(null);
      activeEditRef.current = next;
      setActiveEdit(next);
      document.body.style.userSelect = "none";
    },
    [getSnappedMinutesFromClientY, toEditableDraft],
  );

  const commitPointerEdit = useCallback(
    (edit: ActivePointerEdit) => {
      const { draft, originalSlot } = edit;
      setQuickMenu(null);

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
        return;
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
    },
    [],
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
      commitPointerEdit(edit);
      activeEditRef.current = null;
      setActiveEdit(null);
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerFinish, { passive: false });
    window.addEventListener("pointercancel", handlePointerFinish, { passive: false });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerFinish);
      window.removeEventListener("pointercancel", handlePointerFinish);
      document.body.style.userSelect = "";
    };
  }, [buildDraftFromPointer, cancelPendingPointerEdit, commitPointerEdit]);

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
    const desktopHalfWidth = 112;

    setQuickMenu({
      slot,
      top: clamp(rect.top + Math.min(rect.height, 28) + 10, 12, window.innerHeight - 12),
      left: clamp(rect.left + rect.width / 2, 16 + desktopHalfWidth, window.innerWidth - 16 - desktopHalfWidth),
      mobile,
    });
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
              className={`sticky top-0 z-30 border-b border-r border-zinc-800/50 px-2 py-1.5 ${
                col.isPast
                  ? "bg-zinc-950"
                  : col.isToday
                    ? "bg-zinc-900"
                    : col.isWeekend
                      ? "bg-rose-950/95"
                      : "bg-zinc-950"
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
            </div>
          ))}

          {/* ── Hour rows ── */}
          {Array.from({ length: TOTAL_HOURS }, (_, i) => {
            const hour = HOUR_START + i;
            return (
              <div key={`time-${hour}`} className="contents">
                {/* Time label */}
                <div
                  className="sticky left-0 z-20 border-b border-r border-zinc-800/30 bg-zinc-950 pr-2 text-right"
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
                    className={`relative border-b border-r border-zinc-800/20 transition-colors ${
                      col.isPast
                        ? "bg-zinc-950/40"
                        : col.isToday
                          ? "bg-zinc-900/15"
                          : ""
                    } ${!col.isPast && dropTarget === col.key ? "bg-sky-500/5" : ""}`}
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
            {visibleColumns.map((col) => (
              <div key={`overlay-${col.key}`} className={`relative ${col.isPast ? "opacity-30 grayscale" : ""}`}>
                {col.slots.map((slot) => {
                  if (activeEdit?.originalSlot?.id === slot.id && activeEdit.originalSlot.date === slot.date) {
                    return null;
                  }

                  const top = slotTop(slot.start);
                  const height = slotHeight(slot.start, slot.end);
                  const c = toneColor(slot.tone);
                  const isEditable = isEditableScheduleSlot(slot);

                  return (
                    <div
                      key={slot.id}
                      className={`pointer-events-auto absolute left-1 right-1 overflow-hidden rounded-lg border px-2 py-1 ${c.border} ${c.bg} ${
                        isEditable ? "cursor-grab touch-none" : ""
                      }`}
                      style={{ top, height, minHeight: 20 }}
                      onPointerDown={(e) => {
                        if (!isEditable) return;
                        e.stopPropagation();
                        queuePointerEdit("move", e, col.key, slot);
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
                      {isEditable && (
                        <button
                          type="button"
                          aria-label="Изменить начало"
                          className="absolute inset-x-1 top-0 h-2 cursor-ns-resize rounded-t-md bg-transparent"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            queuePointerEdit("resize-start", e, col.key, slot);
                          }}
                        />
                      )}
                      <p className={`text-[10px] font-medium leading-tight ${c.text}`}>
                        {slot.start}–{slot.end}
                      </p>
                      <p className={`mt-0.5 truncate text-[11px] font-medium leading-snug ${c.text}`}>
                        {slot.title}
                      </p>
                      {height > 40 && slot.subtitle && (
                        <p className="mt-0.5 line-clamp-2 text-[9px] leading-tight text-zinc-500">
                          {slot.subtitle}
                        </p>
                      )}
                      {isEditable && (
                        <button
                          type="button"
                          aria-label="Изменить конец"
                          className="absolute inset-x-1 bottom-0 h-2 cursor-ns-resize rounded-b-md bg-transparent"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            queuePointerEdit("resize-end", e, col.key, slot);
                          }}
                        />
                      )}
                    </div>
                  );
                })}

                {activeEdit?.draft.date === col.key && (() => {
                  const draftTop = slotTop(activeEdit.draft.start);
                  const draftHeight = slotHeight(activeEdit.draft.start, activeEdit.draft.end);
                  const draftColor = toneColor(activeEdit.draft.tone);
                  return (
                    <div
                      className={`pointer-events-none absolute left-1 right-1 overflow-hidden rounded-lg border-2 px-2 py-1 shadow-[0_0_0_1px_rgba(255,255,255,0.05)] ${draftColor.border} ${draftColor.bg}`}
                      style={{ top: draftTop, height: draftHeight, minHeight: 20 }}
                    >
                      <p className={`text-[10px] font-semibold leading-tight ${draftColor.text}`}>
                        {activeEdit.draft.start}–{activeEdit.draft.end}
                      </p>
                      <p className={`mt-0.5 truncate text-[11px] font-semibold leading-snug ${draftColor.text}`}>
                        {activeEdit.originalSlot ? activeEdit.draft.title : "Новый слот"}
                      </p>
                      <p className="mt-1 text-[9px] font-medium uppercase tracking-[0.14em] text-zinc-400">
                        {activeEdit.mode === "move"
                          ? "Перемещение"
                          : activeEdit.mode === "resize-start"
                            ? "Старт"
                            : activeEdit.mode === "resize-end"
                              ? "Финиш"
                              : "Создание"}
                      </p>
                    </div>
                  );
                })()}

                {/* Now-line */}
                {col.isToday && <NowLine />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {quickMenu && (() => {
        const slot = quickMenu.slot;
        const startMin = timeToMinutes(slot.start);
        const endMin = timeToMinutes(slot.end);
        const durationMin = endMin - startMin;
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
            className={quickMenu.mobile ? "fixed inset-x-3 bottom-24 z-50" : "fixed z-50 w-56 -translate-x-1/2"}
            style={quickMenu.mobile ? undefined : { top: quickMenu.top, left: quickMenu.left }}
          >
            <div className="rounded-3xl border border-zinc-800 bg-zinc-950/95 p-3 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur">
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
