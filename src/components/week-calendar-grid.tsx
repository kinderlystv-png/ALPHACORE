"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useCalendarShellControls } from "@/components/calendar-shell-controls-context";
import { CalendarDayPressureChip } from "@/components/calendar-day-pressure-chip";
import { CalendarActiveEditOverlay } from "@/components/calendar-active-edit-overlay";
import { CalendarDesktopHint } from "@/components/calendar-desktop-hint";
import { CalendarOverlayColumn } from "@/components/calendar-overlay-column";
import { CalendarQuickMenu } from "@/components/calendar-quick-menu";
import { CalendarReboundPreview } from "@/components/calendar-rebound-preview";
import { useCalendarDesktopSlotHint } from "@/components/use-calendar-desktop-slot-hint";
import { useCalendarPointerEdit } from "@/components/use-calendar-pointer-edit";
import { useCalendarQuickMenu } from "@/components/use-calendar-quick-menu";
import { useCalendarTaskDragAndDrop } from "@/components/use-calendar-task-dnd";
import {
  HEADER_BASE_H,
  HEADER_TASK_GAP,
  HEADER_TASK_MARGIN_TOP,
  HEADER_TASK_ROW_H,
  HOUR_START,
  ROW_H,
  TOTAL_HOURS,
  formatHour,
  slotTop as sharedSlotTop,
  centerNowLine,
  type DayColumn,
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

function slotTop(startTime: string): number {
  return sharedSlotTop(startTime, timeToMinutes);
}

function taskBelongsToDay(task: Task, dayKey: string, today: string, isToday: boolean): boolean {
  if (!task.dueDate) return isToday && task.status === "active";
  if (task.dueDate === dayKey) return true;
  return isToday && task.dueDate < today;
}

const SCROLLABLE_PAST_DAYS = 1;
const SCROLLABLE_FUTURE_DAYS = 91;
const MIN_DAY_COLUMN_WIDTH = 120;
const DEFAULT_DAY_COLUMN_WIDTH: Record<3 | 8, number> = {
  3: 196,
  8: 148,
};

function buildScrollableDays(todayKey: string): Date[] {
  const start = new Date(`${todayKey}T00:00:00`);
  start.setDate(start.getDate() - SCROLLABLE_PAST_DAYS);
  start.setHours(0, 0, 0, 0);

  return Array.from({ length: SCROLLABLE_PAST_DAYS + SCROLLABLE_FUTURE_DAYS + 1 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

/* ── Component ── */

export function WeekCalendarGrid({ stats }: WeekCalendarGridProps) {
  void stats;

  const { todayJumpToken, viewDays } = useCalendarShellControls();
  const { signals: heysSignals, snapshot: heysSnapshot } = useHeysSync();
  const [version, setVersion] = useState(0);
  const [hoveredSlotKey, setHoveredSlotKey] = useState<string | null>(null);
  const [gridViewportWidth, setGridViewportWidth] = useState<number | null>(null);
  const [gridViewportHeight, setGridViewportHeight] = useState<number | null>(null);
  const [shouldCenterNow, setShouldCenterNow] = useState(true);
  const [viewportWidth, setViewportWidth] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const overlayGridRef = useRef<HTMLDivElement>(null);
  const visibleColumnsRef = useRef<DayColumn[]>([]);
  const skipNextClickRef = useRef(false);
  const today = todayKey();
  const yesterdayKey = getYesterdayKey(today);
  const days = useMemo(() => buildScrollableDays(today), [today]);

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

  const visibleColumns = columns;

  useEffect(() => {
    const syncViewport = () => {
      setViewportWidth(window.innerWidth);
    };

    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  useEffect(() => {
    const container = gridRef.current;
    if (!container) return;

    const syncWidth = () => {
      setGridViewportWidth(container.clientWidth);
    };

    syncWidth();

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      syncWidth();
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const container = gridRef.current;
    if (!container) return;

    const syncViewportHeight = () => {
      const rect = container.getBoundingClientRect();
      const nextHeight = Math.max(Math.floor(window.innerHeight - rect.top), 320);
      setGridViewportHeight((current) => (current === nextHeight ? current : nextHeight));
    };

    syncViewportHeight();

    const handleResize = () => {
      syncViewportHeight();
    };

    window.addEventListener("resize", handleResize);

    const frame = window.requestAnimationFrame(syncViewportHeight);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
    };
  }, [version]);

  useEffect(() => {
    visibleColumnsRef.current = visibleColumns;
  }, [visibleColumns]);

  const dayColumnWidth = useMemo(() => {
    if (!gridViewportWidth) return DEFAULT_DAY_COLUMN_WIDTH[viewDays];

    const availableWidth = Math.max(gridViewportWidth - 56, MIN_DAY_COLUMN_WIDTH * viewDays);
    return Math.max(MIN_DAY_COLUMN_WIDTH, Math.floor(availableWidth / viewDays));
  }, [gridViewportWidth, viewDays]);

  const visibleGridWidth = 56 + Math.max(visibleColumns.length, 1) * dayColumnWidth;
  const isMobileGripMode = viewportWidth != null && viewportWidth < 640;
  const overlayWidth = Math.max(visibleGridWidth - 56, visibleColumns.length * dayColumnWidth);
  const overlayColumnWidth = dayColumnWidth;
  const initialViewportHeight = gridViewportHeight != null ? `${gridViewportHeight}px` : "calc(100svh - 8.5rem)";
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

    const hasTodayColumn = visibleColumns.some((column) => column.isToday);
    if (!hasTodayColumn) return;

    const frame = requestAnimationFrame(() => {
      centerNowLine(gridRef.current, headerHeight);
      setShouldCenterNow(false);
    });

    return () => cancelAnimationFrame(frame);
  }, [headerHeight, shouldCenterNow, visibleColumns]);

  const linkedTasksById = useMemo(
    () => new Map(getTasks().map((task) => [task.id, task])),
    [version],
  );

  const bumpVersion = useCallback(() => {
    setVersion((value) => value + 1);
  }, []);

  const {
    desktopSlotHint,
    desktopSlotHintPendingKeyRef,
    hideDesktopSlotHint,
    scheduleDesktopSlotHint,
  } = useCalendarDesktopSlotHint({
    gridRef,
    version,
    viewMode: "full",
    compactStart: 0,
  });

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

  const scrollToToday = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const container = gridRef.current;
      if (!container) return;

      const todayIndex = visibleColumns.findIndex((column) => column.isToday);
      if (todayIndex < 0) return;

      const targetLeft = Math.max(0, (todayIndex - 1) * dayColumnWidth);

      container.scrollTo({
        left: targetLeft,
        behavior,
      });
      setShouldCenterNow(true);
    },
    [dayColumnWidth, visibleColumns],
  );

  useEffect(() => {
    if (todayJumpToken === 0) return;
    scrollToToday();
  }, [scrollToToday, todayJumpToken]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const container = gridRef.current;
      if (!container) return;

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        container.scrollBy({
          left: (event.key === "ArrowRight" ? 1 : -1) * dayColumnWidth * 7,
          behavior: "smooth",
        });
      } else if (event.key === "t" || event.key === "T") {
        event.preventDefault();
        scrollToToday();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dayColumnWidth, scrollToToday]);

  const toggleSlotApproval = useCallback((slot: ScheduleSlot) => {
    toggleScheduleSlotApproval(slot);
    setVersion((value) => value + 1);
  }, []);

  return (
    <section className="flex flex-col rounded-4xl border border-zinc-800/50 bg-zinc-950/40">
      {/* Grid */}
      <div
        ref={gridRef}
        className="relative overflow-auto"
        style={{
          height: initialViewportHeight,
          maxHeight: initialViewportHeight,
          overscrollBehaviorX: "contain",
          scrollSnapType: "x proximity",
        }}
      >
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: `56px repeat(${visibleColumns.length}, ${dayColumnWidth}px)`,
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
              style={{ height: headerHeight, scrollSnapAlign: "start" }}
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
            width: overlayWidth,
            height: TOTAL_HOURS * ROW_H,
            minWidth: overlayWidth,
          }}
        >
          <div
            className="relative grid h-full"
            style={{ gridTemplateColumns: `repeat(${visibleColumns.length}, ${dayColumnWidth}px)` }}
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
