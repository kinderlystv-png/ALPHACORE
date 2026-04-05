"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CalendarDayPressureChip } from "@/components/calendar-day-pressure-chip";
import { CalendarActiveEditOverlay } from "@/components/calendar-active-edit-overlay";
import { CalendarDesktopHint } from "@/components/calendar-desktop-hint";
import { CalendarOverlayColumn } from "@/components/calendar-overlay-column";
import { CalendarQuickMenu } from "@/components/calendar-quick-menu";
import { CalendarReboundPreview } from "@/components/calendar-rebound-preview";
import { useCalendarPointerEdit } from "@/components/use-calendar-pointer-edit";
import { useCalendarQuickMenu } from "@/components/use-calendar-quick-menu";
import { useCalendarTaskDragAndDrop } from "@/components/use-calendar-task-dnd";
import {
  DESKTOP_SLOT_HINT_DELAY_MS,
  DESKTOP_SLOT_HINT_ESTIMATED_HEIGHT,
  DESKTOP_SLOT_HINT_WIDTH,
  HEADER_BASE_H,
  HEADER_TASK_GAP,
  HEADER_TASK_MARGIN_TOP,
  HEADER_TASK_ROW_H,
  HOUR_START,
  ROW_H,
  TOTAL_HOURS,
  clamp,
  formatHour,
  getCompactStart,
  getDayModeBadgeClass,
  slotTop as sharedSlotTop,
  centerNowLine,
  type CalendarViewMode,
  type DayColumn,
  type DesktopSlotHintContent,
  type DesktopSlotHintState,
  type EditableSlotDraft,
  type WeekCalendarGridProps,
} from "@/components/calendar-grid-types";
import {
  isAmbientContextSlot,
  isChildcareBackgroundSlot,
  isSupportLaneSlot,
  slotsOverlap,
} from "@/components/calendar-overlay-helpers";

import {
  getCalendarDayPressure,
} from "@/lib/calendar-day-pressure";
import {
  buildBundleContextProfile,
  getDefaultMetricKey,
  getHeysDayMode,
} from "@/lib/heys-day-mode";
import {
  getYesterdayKey,
} from "@/lib/calendar-slot-attention";
import {
  AREA_COLOR,
  AREA_LEGEND,
  taskColor,
} from "@/lib/life-areas";
import {
  getScheduledTaskIds,
  toggleScheduleSlotApproval,
  type ScheduleSlot,
  getScheduleForDate,
  timeToMinutes,
} from "@/lib/schedule";
import { getProjects } from "@/lib/projects";
import { dateStr, subscribeAppDataChange } from "@/lib/storage";
import {
  compareTasksByAttention,
  getActionableTasks,
  getTasks,
  type Task,
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

function taskBelongsToDay(task: Task, dayKey: string, today: string, isToday: boolean): boolean {
  if (!task.dueDate) return isToday && task.status === "active";
  if (task.dueDate === dayKey) return true;
  return isToday && task.dueDate < today;
}

/* ── Component ── */

export function WeekCalendarGrid({ stats }: WeekCalendarGridProps) {
  const { signals: heysSignals, snapshot: heysSnapshot } = useHeysSync();
  const [version, setVersion] = useState(0);
  const [anchor, setAnchor] = useState<Date | null>(null);
  const [shouldCenterNow, setShouldCenterNow] = useState(true);
  const [hoveredSlotKey, setHoveredSlotKey] = useState<string | null>(null);
  const [desktopSlotHint, setDesktopSlotHint] = useState<DesktopSlotHintState | null>(null);
  const [viewMode, setViewMode] = useState<CalendarViewMode>("full");
  const [compactStart, setCompactStart] = useState(0);
  const [viewportWidth, setViewportWidth] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const overlayGridRef = useRef<HTMLDivElement>(null);
  const responsiveInitRef = useRef(false);
  const visibleColumnsRef = useRef<DayColumn[]>([]);
  const skipNextClickRef = useRef(false);
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

  const bumpVersion = useCallback(() => {
    setVersion((value) => value + 1);
  }, []);

  const {
    quickMenu,
    quickMenuRef,
    closeQuickMenu,
    openQuickMenu,
    updateQuickMenuDraft,
    applyQuickSlotPatch,
    saveQuickMenuDraft,
    duplicateQuickSlot,
    unscheduleQuickSlot,
    deleteQuickSlot,
    toggleQuickSlotApproval,
  } = useCalendarQuickMenu({
    gridRef,
    linkedTasksById,
    hideDesktopSlotHint,
    onVersionBump: bumpVersion,
    onClearHoveredSlot: () => setHoveredSlotKey(null),
  });

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

  const {
    activeEdit,
    edgeCue,
    reboundPreview,
    activePointerClientRef,
    queuePointerEdit,
    getOverlayBoxForDraft,
  } = useCalendarPointerEdit({
    gridRef,
    overlayGridRef,
    visibleColumnsRef,
    skipNextClickRef,
    today,
    closeQuickMenu,
    getBlockingSlot,
    onVersionBump: bumpVersion,
  });

  const {
    drag,
    dropTarget,
    beginTaskDrag,
    endTaskDrag,
    handleDragOver,
    handleDragLeave,
    handleDropToDayHeader,
    handleDropToTimeCell,
  } = useCalendarTaskDragAndDrop({
    linkedTasksById,
    getBlockingSlot,
    onVersionBump: bumpVersion,
  });

  useEffect(() => {
    return () => {
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

  const toggleSlotApproval = useCallback((slot: ScheduleSlot) => {
    toggleScheduleSlotApproval(slot);
    setVersion((value) => value + 1);
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
              onDragOver={(e) => !col.isPast && handleDragOver(e, col.key)}
              onDragLeave={!col.isPast ? handleDragLeave : undefined}
              onDrop={(e) => !col.isPast && handleDropToDayHeader(e, col.key)}
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
                          beginTaskDrag(e, t.id, col.key);
                        }}
                        onDragEnd={endTaskDrag}
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
                    onDragOver={(e) => !col.isPast && handleDragOver(e, col.key)}
                    onDragLeave={!col.isPast ? handleDragLeave : undefined}
                    onDrop={(e) => !col.isPast && handleDropToTimeCell(e, col.key, hour)}
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
            {visibleColumns.map((col) => (
              <CalendarOverlayColumn
                key={`overlay-${col.key}`}
                column={col}
                activeEdit={activeEdit}
                reboundPreview={reboundPreview}
                quickMenu={quickMenu}
                hoveredSlotKey={hoveredSlotKey}
                desktopSlotHintSlotKey={desktopSlotHint?.slotKey ?? null}
                desktopSlotHintPendingKey={desktopSlotHintPendingKeyRef.current}
                overlayColumnWidth={overlayColumnWidth}
                linkedTasksById={linkedTasksById}
                projectNameById={projectNameById}
                today={today}
                yesterdayKey={yesterdayKey}
                heysDayModeId={heysDayMode?.id ?? null}
                isMobileGripMode={isMobileGripMode}
                skipNextClickRef={skipNextClickRef}
                onQueuePointerEdit={queuePointerEdit}
                onScheduleDesktopSlotHint={scheduleDesktopSlotHint}
                onHideDesktopSlotHint={hideDesktopSlotHint}
                onOpenQuickMenu={openQuickMenu}
                onToggleSlotApproval={toggleSlotApproval}
                onSetHoveredSlotKey={setHoveredSlotKey}
              />
            ))}
          </div>

          <CalendarReboundPreview
            reboundPreview={reboundPreview}
            getOverlayBoxForDraft={getOverlayBoxForDraft}
          />
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
      <CalendarActiveEditOverlay
        activeEdit={activeEdit}
        headerHeight={headerHeight}
        pointerX={activePointerClientRef.current.x}
        pointerY={activePointerClientRef.current.y}
        slotTop={slotTop}
      />

      {desktopSlotHint && <CalendarDesktopHint hint={desktopSlotHint} />}
    </section>
  );
}
