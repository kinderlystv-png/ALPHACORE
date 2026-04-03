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
  type ScheduleSlot,
  getScheduleForDate,
  timeToMinutes,
  updateCustomEvent,
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
  | { type: "slot"; slotId: string; originDay: string }
  | null;

type CalendarViewMode = "full" | "compact";

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
  const [viewMode, setViewMode] = useState<CalendarViewMode>("full");
  const [compactStart, setCompactStart] = useState(0);
  const [viewportWidth, setViewportWidth] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const responsiveInitRef = useRef(false);
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
          ["alphacore_tasks", "alphacore_schedule_custom"].includes(k),
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

  const onDragStartSlot = useCallback((slotId: string, originDay: string) => {
    setDrag({ type: "slot", slotId, originDay });
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

      if (drag.type === "slot" && drag.originDay !== targetDay) {
        if (drag.slotId.startsWith("custom-")) {
          updateCustomEvent(drag.slotId, { date: targetDay });
        }
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
                  />
                ))}
              </div>
            );
          })}
        </div>

        {/* ── Positioned slot blocks ── */}
        <div
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
                  const top = slotTop(slot.start);
                  const height = slotHeight(slot.start, slot.end);
                  const c = toneColor(slot.tone);
                  const isCustom = slot.id.startsWith("custom-");

                  return (
                    <div
                      key={slot.id}
                      className={`pointer-events-auto absolute left-1 right-1 overflow-hidden rounded-lg border px-2 py-1 ${c.border} ${c.bg} ${
                        isCustom ? "cursor-grab" : ""
                      }`}
                      style={{ top, height, minHeight: 20 }}
                      draggable={isCustom}
                      onDragStart={(e) => {
                        if (!isCustom) return;
                        e.dataTransfer.effectAllowed = "move";
                        onDragStartSlot(slot.id, col.key);
                      }}
                      onDragEnd={onDragEnd}
                      title={`${slot.start}–${slot.end} ${slot.title}`}
                    >
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
                    </div>
                  );
                })}

                {/* Now-line */}
                {col.isToday && <NowLine />}
              </div>
            ))}
          </div>
        </div>
      </div>
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
