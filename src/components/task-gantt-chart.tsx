"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AREA_COLOR, type LifeArea } from "@/lib/life-areas";
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

export type TaskGanttChartProps = {
  groups: GanttGroup[];
  onTaskDueDateChange: (taskId: string, newDate: string) => void;
  onTaskPlannedMinutesChange?: (taskId: string, minutes: number | null) => void;
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

type DerivedRow = DerivedTaskRow | DerivedGroupRow;

type InteractionState = {
  taskId: string;
  mode: "move" | "resize";
  startX: number;
  startDueDate?: string;
  startCreatedAt: string;
  startPlannedMinutes?: number;
  offsetDays: number;
  previewPlannedMinutes?: number;
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

function spanFromVisual(visual: TaskVisual): Span {
  return {
    left: visual.left,
    width: visual.width,
    startIndex: visual.startIndex,
    endIndex: visual.endIndex,
  };
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
    offsetDays?: number;
    plannedMinutesOverride?: number;
  },
): TaskVisual {
  const { dayWidth, timelineStart, totalDays, offsetDays = 0, plannedMinutesOverride } = options;

  const created = d0(new Date(task.createdAt));
  const createdIndex = clamp(diffDays(timelineStart, created), 0, totalDays - 1);
  const due = parseDay(task.dueDate);
  const plannedMinutes = plannedMinutesOverride ?? task.plannedMinutes;
  const plannedDays = durationDaysFromMinutes(plannedMinutes);

  if (plannedDays != null) {
    if (due) {
      const dueIndex = clamp(diffDays(timelineStart, due) + offsetDays, 0, totalDays - 1);
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

    const startIndexFloat = clamp(createdIndex + offsetDays, 0, totalDays - 1);
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

  const anchor = due ? clamp(diffDays(timelineStart, due) + offsetDays, 0, totalDays - 1) : clamp(createdIndex + offsetDays, 0, totalDays - 1);
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
  onTaskDueDateChange,
  onTaskPlannedMinutesChange,
}: TaskGanttChartProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const suppressClickRef = useRef<string | null>(null);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState<ZoomLevel>("month");
  const [interaction, setInteraction] = useState<InteractionState | null>(null);

  const today = useMemo(() => d0(new Date()), []);
  const timelineStart = useMemo(() => addDays(today, -PAST_DAYS), [today]);
  const totalDays = PAST_DAYS + FUTURE_DAYS;
  const dayWidth = ZOOM_OPTIONS[zoom].dayWidth;
  const gridWidth = totalDays * dayWidth;
  const todayIndex = PAST_DAYS;

  const days = useMemo(
    () => Array.from({ length: totalDays }, (_, index) => addDays(timelineStart, index)),
    [timelineStart, totalDays],
  );

  const buildVisual = useCallback(
    (task: Task, options?: { offsetDays?: number; plannedMinutesOverride?: number }) =>
      computeTaskVisual(task, {
        dayWidth,
        timelineStart,
        totalDays,
        offsetDays: options?.offsetDays,
        plannedMinutesOverride: options?.plannedMinutesOverride,
      }),
    [dayWidth, timelineStart, totalDays],
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

  const derived = useMemo(() => {
    const loadByDay = Array.from({ length: totalDays }, () => 0);
    const orderedRows: DerivedRow[] = [];

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

    for (const group of groups) {
      const nodeResults = group.nodes.map((node) => buildNodeRows(group, node));
      const groupRollup = mergeSpans(nodeResults.map((result) => result.span));

      orderedRows.push({
        kind: "group",
        key: `group:${group.id}`,
        group,
        rollupSpan: groupRollup,
      });

      if (!collapsedGroups.has(group.id)) {
        orderedRows.push(...nodeResults.flatMap((result) => result.rows));
      }
    }

    const bodyHeight = orderedRows.reduce(
      (sum, row) => sum + (row.kind === "group" ? GROUP_H : ROW_H),
      0,
    );

    return { orderedRows, bodyHeight, loadByDay };
  }, [buildVisual, collapsedGroups, groups, totalDays]);

  const maxLoad = useMemo(() => Math.max(...derived.loadByDay, 0), [derived.loadByDay]);

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

  const beginMove = useCallback((event: React.PointerEvent<HTMLButtonElement>, task: Task) => {
    event.preventDefault();
    event.stopPropagation();

    setInteraction({
      taskId: task.id,
      mode: "move",
      startX: event.clientX,
      startDueDate: task.dueDate,
      startCreatedAt: task.createdAt,
      startPlannedMinutes: task.plannedMinutes,
      offsetDays: 0,
      previewPlannedMinutes: task.plannedMinutes,
      moved: false,
    });
  }, []);

  const beginResize = useCallback((event: React.PointerEvent<HTMLButtonElement>, task: Task) => {
    if (!onTaskPlannedMinutesChange) return;

    event.preventDefault();
    event.stopPropagation();

    setInteraction({
      taskId: task.id,
      mode: "resize",
      startX: event.clientX,
      startDueDate: task.dueDate,
      startCreatedAt: task.createdAt,
      startPlannedMinutes: task.plannedMinutes ?? 60,
      offsetDays: 0,
      previewPlannedMinutes: task.plannedMinutes ?? 60,
      moved: false,
    });
  }, [onTaskPlannedMinutesChange]);

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

      if (interaction.mode === "move") {
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

      const baseMinutes = interaction.startPlannedMinutes ?? 60;
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
        const currentPlannedMinutes = interaction.startPlannedMinutes;
        const durationDays = durationDaysFromMinutes(currentPlannedMinutes) ?? 0;
        const baseDue = parseDay(interaction.startDueDate)
          ?? addDays(d0(new Date(interaction.startCreatedAt)), Math.max(Math.ceil(durationDays) - 1, 0));
        const nextDueDate = addDays(baseDue, interaction.offsetDays);
        onTaskDueDateChange(interaction.taskId, fmtISO(nextDueDate));
      }

      if (
        interaction.mode === "resize"
        && onTaskPlannedMinutesChange
        && interaction.previewPlannedMinutes
        && interaction.previewPlannedMinutes !== interaction.startPlannedMinutes
      ) {
        onTaskPlannedMinutesChange(interaction.taskId, interaction.previewPlannedMinutes);
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
  }, [dayWidth, interaction, onTaskDueDateChange, onTaskPlannedMinutesChange]);

  const openTaskInList = useCallback((taskId: string) => {
    if (suppressClickRef.current === taskId) return;

    const node = document.getElementById(`task-card-${taskId}`);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const totalOpenTasks = useMemo(
    () => groups.reduce((sum, group) => sum + group.openCount, 0),
    [groups],
  );

  return (
    <div className="space-y-3 rounded-3xl border border-zinc-800/70 bg-zinc-950/45 p-3 shadow-[0_20px_60px_rgba(0,0,0,0.18)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-zinc-100">Гант по категориям и подзадачам</p>
          <p className="mt-1 text-[11px] text-zinc-500">
            Виден весь список без внутренней вертикальной прокрутки. Тяни бар — двигаешь дедлайн, правый край — меняешь длительность.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
        </div>
      </div>

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
                  {derived.loadByDay.map((load, index) => {
                    const heightPct = maxLoad > 0 ? Math.max((load / maxLoad) * 100, load > 0 ? 12 : 0) : 0;
                    return (
                      <div
                        key={`load-${index}`}
                        className={`relative border-r border-zinc-800/20 ${isWeekend(days[index]) ? "bg-zinc-900/35" : ""}`}
                        style={{ width: dayWidth }}
                        title={load > 0 ? `${Math.round(load)} мин нагрузки` : "Пусто"}
                      >
                        {load > 0 && (
                          <div
                            className="absolute bottom-0 left-[20%] w-[60%] rounded-t bg-violet-400/60"
                            style={{ height: `${heightPct}%` }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="relative" style={{ minHeight: derived.bodyHeight }}>
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
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-amber-400/55"
              style={{ left: LABEL_W + todayIndex * dayWidth + Math.floor(dayWidth / 2), zIndex: 15 }}
            />

            <div className="relative z-10">
              {derived.orderedRows.map((row) => {
                if (row.kind === "group") {
                  const tone = groupBarTone(row.group);
                  const collapsed = collapsedGroups.has(row.group.id);

                  return (
                    <div key={row.key} className="flex border-b border-zinc-800/30" style={{ height: GROUP_H }}>
                      <button
                        type="button"
                        onClick={() => toggleGroup(row.group.id)}
                        className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-zinc-800/40 bg-zinc-950/92 px-3 text-[11px] font-semibold text-zinc-100 transition hover:bg-zinc-900/70"
                        style={{ width: LABEL_W }}
                      >
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${groupDotCls(row.group)}`} />
                        <span className="truncate text-left">{row.group.label}</span>
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

                const task = row.task;
                const group = row.group;
                const interactionForTask = interaction?.taskId === task.id ? interaction : null;
                const previewVisual = buildVisual(task, {
                  offsetDays: interactionForTask?.mode === "move" ? interactionForTask.offsetDays : 0,
                  plannedMinutesOverride: interactionForTask?.mode === "resize" ? interactionForTask.previewPlannedMinutes : undefined,
                });
                const baseTone = groupBarTone(group);
                const urgencyTone = taskUrgencyTone(task, today);
                const priorityTone =
                  task.priority === "p1"
                    ? "text-rose-400"
                    : task.priority === "p2"
                      ? "text-amber-400"
                      : "text-zinc-600";
                const planned = durationLabel(task.plannedMinutes);
                const showRollup = row.hasChildren && row.rollupSpan && row.rollupSpan.width > previewVisual.width + 8;

                return (
                  <div key={row.key} className="flex border-b border-zinc-800/20" style={{ height: ROW_H }}>
                    <div
                      className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-zinc-800/30 bg-zinc-950/92 px-2 text-[10px]"
                      style={{ width: LABEL_W, paddingLeft: 10 + row.depth * 14 }}
                      title={task.title}
                    >
                      <span className={`shrink-0 font-bold uppercase ${priorityTone}`} style={{ fontSize: 8 }}>
                        {task.priority}
                      </span>
                      {row.hasChildren && <span className="text-zinc-600">▸</span>}
                      <span className="truncate text-zinc-300">{task.title}</span>
                      {planned && (
                        <span className="shrink-0 rounded-full border border-violet-500/20 bg-violet-500/10 px-1.5 py-0.5 text-[8px] text-violet-200">
                          {planned}
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

                      <button
                        type="button"
                        onClick={() => openTaskInList(task.id)}
                        onPointerDown={(event) => beginMove(event, task)}
                        className={`absolute rounded-lg border ${baseTone.bg} ${baseTone.border} ${urgencyTone} ${
                          task.priority === "p3" ? "opacity-55" : ""
                        } ${interactionForTask?.mode === "move" ? "z-20 shadow-lg shadow-black/30" : ""} transition-shadow`}
                        style={{
                          left: previewVisual.left,
                          width: previewVisual.width,
                          top: 4,
                          height: ROW_H - 8,
                          cursor: "grab",
                        }}
                        title={task.title}
                      >
                        {!previewVisual.titleOutside && (
                          <span className="pointer-events-none absolute inset-0 flex items-center px-2 text-[8px] text-white/75 truncate">
                            {task.title}
                          </span>
                        )}
                      </button>

                      {previewVisual.titleOutside && (
                        <button
                          type="button"
                          onClick={() => openTaskInList(task.id)}
                          className="absolute top-1 truncate text-left text-[8px] text-zinc-500 hover:text-zinc-300"
                          style={{ left: previewVisual.left + previewVisual.width + 4, maxWidth: 140 }}
                          title={task.title}
                        >
                          {task.title}
                        </button>
                      )}

                      {task.plannedMinutes && onTaskPlannedMinutesChange && (
                        <button
                          type="button"
                          onPointerDown={(event) => beginResize(event, task)}
                          className="absolute z-30 rounded-r-lg border-l border-white/10 bg-black/15 hover:bg-black/25"
                          style={{
                            left: previewVisual.left + previewVisual.width - 8,
                            top: 4,
                            width: 8,
                            height: ROW_H - 8,
                            cursor: "ew-resize",
                          }}
                          aria-label={`Изменить длительность ${task.title}`}
                          title={`Изменить длительность ${task.title}`}
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
        <span>Drag бара — двигает дедлайн</span>
        {onTaskPlannedMinutesChange && <span>Правый край — меняет длительность</span>}
        <span>Пунктир — сводный rollup родителя</span>
      </div>
    </div>
  );
}
