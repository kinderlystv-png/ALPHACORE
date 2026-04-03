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
const HEADER_H = 72; // column header height

/* ── Helpers ── */

function todayKey() {
  return dateStr();
}

function buildWeek(anchor: Date): Date[] {
  const monday = new Date(anchor);
  const day = monday.getDay();
  monday.setDate(monday.getDate() - ((day + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
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
  tasks: Task[];
  slots: ScheduleSlot[];
};

type DragState =
  | { type: "task"; taskId: string; originDay: string }
  | { type: "slot"; slotId: string; originDay: string }
  | null;

/* ── Component ── */

export function WeekCalendarGrid() {
  const [version, setVersion] = useState(0);
  const [anchor, setAnchor] = useState(() => new Date());
  const [drag, setDrag] = useState<DragState>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const today = todayKey();

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

  // scroll to ~8am on first render
  useEffect(() => {
    if (gridRef.current) {
      const target = (8 - HOUR_START) * ROW_H;
      gridRef.current.scrollTop = target - 40;
    }
  }, []);

  const week = useMemo(() => buildWeek(anchor), [anchor]);

  const columns = useMemo<DayColumn[]>(() => {
    const tasks = getActionableTasks(today);
    return week.map((date) => {
      const key = dateStr(date);
      const isToday = key === today;
      return {
        key,
        date,
        dayLabel: new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(date),
        dateLabel: new Intl.DateTimeFormat("ru-RU", { day: "numeric" }).format(date),
        isToday,
        tasks: tasks
          .filter((t) => taskBelongsToDay(t, key, today, isToday))
          .sort((a, b) => compareTasksByAttention(a, b, today)),
        slots: getScheduleForDate(key),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, today, version]);

  // navigation
  const shiftWeek = useCallback(
    (delta: number) => {
      setAnchor((prev) => {
        const next = new Date(prev);
        next.setDate(prev.getDate() + delta * 7);
        return next;
      });
    },
    [],
  );

  const goToday = useCallback(() => setAnchor(new Date()), []);

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
    const first = week[0];
    const last = week[6];
    const fmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
    return `${fmt.format(first)} — ${fmt.format(last)}`;
  }, [week]);

  return (
    <section className="flex flex-col rounded-4xl border border-zinc-800/50 bg-zinc-950/40">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/50 px-5 py-3">
        <div className="flex items-center gap-2">
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
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-2">
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
            gridTemplateColumns: "56px repeat(7, minmax(140px, 1fr))",
            minWidth: "1080px",
          }}
        >
          {/* ── Column headers ── */}
          <div
            className="sticky top-0 z-20 border-b border-r border-zinc-800/50 bg-zinc-950/95"
            style={{ height: HEADER_H }}
          />
          {columns.map((col) => (
            <div
              key={`head-${col.key}`}
              className={`sticky top-0 z-20 border-b border-r border-zinc-800/50 px-2 py-2 ${
                col.isToday ? "bg-zinc-900/95" : "bg-zinc-950/95"
              }`}
              style={{ height: HEADER_H }}
            >
              <p
                className={`text-center text-[10px] uppercase tracking-[0.2em] ${
                  col.isToday ? "text-sky-400" : "text-zinc-500"
                }`}
              >
                {col.dayLabel}
              </p>
              <p
                className={`mt-0.5 text-center text-lg font-bold ${
                  col.isToday ? "text-sky-300" : "text-zinc-200"
                }`}
              >
                {col.dateLabel}
              </p>

              {/* All-day tasks (compact) */}
              {col.tasks.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1 overflow-hidden" style={{ maxHeight: 22 }}>
                  {col.tasks.slice(0, 3).map((t) => {
                    const c = taskColor(t);
                    return (
                      <span
                        key={t.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          onDragStartTask(t.id, col.key);
                        }}
                        onDragEnd={onDragEnd}
                        className={`cursor-grab truncate rounded-md border px-1 py-0.5 text-[9px] font-medium ${c.border} ${c.bg} ${c.text}`}
                        title={t.title}
                      >
                        {t.title.slice(0, 14)}
                      </span>
                    );
                  })}
                  {col.tasks.length > 3 && (
                    <span className="text-[9px] text-zinc-600">+{col.tasks.length - 3}</span>
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
                  className="sticky left-0 z-10 border-b border-r border-zinc-800/30 bg-zinc-950/90 pr-2 text-right"
                  style={{ height: ROW_H }}
                >
                  <span className="relative -top-2 text-[10px] text-zinc-600">
                    {formatHour(hour)}
                  </span>
                </div>

                {/* Day cells */}
                {columns.map((col) => (
                  <div
                    key={`cell-${col.key}-${hour}`}
                    className={`relative border-b border-r border-zinc-800/20 transition-colors ${
                      col.isToday ? "bg-zinc-900/15" : ""
                    } ${dropTarget === col.key ? "bg-sky-500/5" : ""}`}
                    style={{ height: ROW_H }}
                    onDragOver={(e) => onDragOver(e, col.key)}
                    onDragLeave={onDragLeave}
                    onDrop={(e) => onDrop(e, col.key)}
                  />
                ))}
              </div>
            );
          })}
        </div>

        {/* ── Positioned slot blocks ── */}
        <div
          className="pointer-events-none absolute"
          style={{
            top: HEADER_H,
            left: 56,
            width: "calc(100% - 56px)",
            height: TOTAL_HOURS * ROW_H,
            minWidth: 1080 - 56,
          }}
        >
          <div
            className="relative grid h-full"
            style={{ gridTemplateColumns: "repeat(7, minmax(140px, 1fr))" }}
          >
            {columns.map((col, colIdx) => (
              <div key={`overlay-${col.key}`} className="relative">
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
