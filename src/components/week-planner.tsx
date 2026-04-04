"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  getHeysSyncedSlotBadgeLabel,
  getScheduleSlotApprovalState,
  getScheduledTaskIds,
  isHeysSyncedScheduleSlot,
  type ScheduleSlot,
  SCHEDULE_TONE_CLS,
  getScheduleForDate,
  toggleScheduleSlotApproval,
} from "@/lib/schedule";
import { dateStr, subscribeAppDataChange } from "@/lib/storage";
import {
  compareTasksByAttention,
  getActionableTasks,
  type Task,
} from "@/lib/tasks";

const TASK_PRIO_CLS: Record<Task["priority"], string> = {
  p1: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  p2: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  p3: "border-zinc-700 bg-zinc-800/60 text-zinc-400",
};

function formatCompletionLabel(completedAt?: string | null): string | null {
  if (!completedAt) return null;

  const value = new Date(completedAt);
  if (Number.isNaN(value.getTime())) return null;

  return `подтверждено ${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

type WeekPlannerProps = {
  anchorDate?: Date | string;
  title?: string;
  description?: string;
  ctaHref?: string;
  ctaLabel?: string;
};

type PlannerDay = {
  key: string;
  dayLabel: string;
  dateLabel: string;
  hint: string | null;
  isToday: boolean;
  tasks: Task[];
  slots: ScheduleSlot[];
};

function toDate(anchorDate: Date | string): Date {
  if (typeof anchorDate === "string") {
    return new Date(`${anchorDate.slice(0, 10)}T00:00:00`);
  }

  const next = new Date(anchorDate);
  next.setHours(0, 0, 0, 0);
  return next;
}

function buildHorizon(anchorDate: Date, length = 7): Date[] {
  return Array.from({ length }, (_, index) => {
    const next = new Date(anchorDate);
    next.setDate(anchorDate.getDate() + index);
    return next;
  });
}

function dayOffset(dateKey: string, referenceDate: string): number {
  return Math.round(
    (new Date(`${dateKey}T00:00:00`).getTime() -
      new Date(`${referenceDate}T00:00:00`).getTime()) /
      86_400_000,
  );
}

function taskProjectLabel(task: Task): string | null {
  return task.project ?? null;
}

function taskDueMeta(task: Task, todayKey: string): { label: string; cls: string } {
  if (!task.dueDate) {
    return {
      label: "active без даты",
      cls: "border-sky-500/20 bg-sky-500/10 text-sky-300",
    };
  }

  const diff = dayOffset(task.dueDate, todayKey);

  if (diff < 0) {
    return {
      label: `хвост ${Math.abs(diff)} д.`,
      cls: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    };
  }

  if (diff === 0) {
    return {
      label: "сегодня",
      cls: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    };
  }

  if (diff === 1) {
    return {
      label: "завтра",
      cls: "border-amber-500/20 bg-amber-500/5 text-amber-300",
    };
  }

  return {
    label: `${diff} д.`,
    cls: "border-zinc-700 bg-zinc-800/60 text-zinc-400",
  };
}

function dayHint(dayKey: string, todayKey: string): string | null {
  const diff = dayOffset(dayKey, todayKey);
  if (diff === 0) return "сегодня";
  if (diff === 1) return "завтра";
  return null;
}

function taskBelongsToDay(task: Task, dayKey: string, todayKey: string, isToday: boolean): boolean {
  if (!task.dueDate) {
    return isToday && task.status === "active";
  }

  if (task.dueDate === dayKey) return true;

  return isToday && task.dueDate < todayKey;
}

export function WeekPlanner({
  anchorDate = new Date(),
  title = "🗓 Ближайшие 7 дней",
  description = "Week-style вид: сверху задачи дня, ниже реальные слоты расписания.",
  ctaHref,
  ctaLabel,
}: WeekPlannerProps) {
  const [version, setVersion] = useState(0);
  const [isHydrated, setIsHydrated] = useState(false);
  const todayKey = dateStr();

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    return subscribeAppDataChange((keys) => {
      if (
        keys.some((key) =>
          ["alphacore_tasks", "alphacore_schedule_custom", "alphacore_schedule_overrides", "alphacore_schedule_approvals"].includes(key),
        )
      ) {
        setVersion((current) => current + 1);
      }
    });
  }, []);

  const horizonStart = useMemo(() => toDate(anchorDate), [anchorDate]);

  const days = useMemo<PlannerDay[]>(() => {
    if (!isHydrated) {
      return buildHorizon(horizonStart).map((date) => {
        const key = dateStr(date);

        return {
          key,
          dayLabel: new Intl.DateTimeFormat("ru-RU", {
            weekday: "short",
          }).format(date),
          dateLabel: new Intl.DateTimeFormat("ru-RU", {
            day: "numeric",
            month: "short",
          }).format(date),
          hint: dayHint(key, todayKey),
          isToday: key === todayKey,
          tasks: [],
          slots: [],
        };
      });
    }

    const openTasks = getActionableTasks(todayKey);

    return buildHorizon(horizonStart).map((date) => {
      const key = dateStr(date);
      const isToday = key === todayKey;
      const scheduledTaskIds = new Set(getScheduledTaskIds(key));

      return {
        key,
        dayLabel: new Intl.DateTimeFormat("ru-RU", {
          weekday: "short",
        }).format(date),
        dateLabel: new Intl.DateTimeFormat("ru-RU", {
          day: "numeric",
          month: "short",
        }).format(date),
        hint: dayHint(key, todayKey),
        isToday,
        tasks: openTasks
          .filter((task) => taskBelongsToDay(task, key, todayKey, isToday) && !scheduledTaskIds.has(task.id))
          .sort((left, right) => compareTasksByAttention(left, right, todayKey)),
        slots: getScheduleForDate(key),
      };
    });
  }, [horizonStart, isHydrated, todayKey, version]);

  const totalTasks = days.reduce((acc, day) => acc + day.tasks.length, 0);
  const totalSlots = days.reduce((acc, day) => acc + day.slots.length, 0);

  return (
    <section className="rounded-4xl border border-zinc-800/50 bg-zinc-900/20 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-50">{title}</h2>
          <p className="mt-1 text-sm text-zinc-500">{description}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-zinc-800 px-3 py-1 text-[10px] uppercase tracking-widest text-zinc-500">
            {totalTasks} tasks · {totalSlots} slots
          </span>
          {ctaHref && ctaLabel && (
            <Link
              href={ctaHref}
              className="rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
            >
              {ctaLabel}
            </Link>
          )}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto pb-2">
        <div className="grid min-w-245 grid-cols-7 gap-3">
          {days.map((day) => (
            <article
              key={day.key}
              className={`flex min-h-120 flex-col rounded-3xl border p-3 ${
                day.isToday
                  ? "border-zinc-50/20 bg-zinc-950/65 shadow-lg shadow-zinc-950/30"
                  : "border-zinc-800/60 bg-zinc-950/30"
              }`}
            >
              <header className="flex items-start justify-between gap-2 border-b border-zinc-800/80 pb-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                    {day.dayLabel}
                  </p>
                  <h3 className="mt-1 text-sm font-semibold text-zinc-50">{day.dateLabel}</h3>
                </div>
                {day.hint && (
                  <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-sky-300">
                    {day.hint}
                  </span>
                )}
              </header>

              <div className="mt-3 flex flex-1 flex-col gap-3">
                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                      Tasks / all-day
                    </p>
                    <span className="text-[10px] text-zinc-600">{day.tasks.length}</span>
                  </div>

                  {day.tasks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-zinc-800/80 px-3 py-2 text-xs text-zinc-600">
                      Ничего не нависает.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {day.tasks.map((task) => {
                        const due = taskDueMeta(task, todayKey);
                        const project = taskProjectLabel(task);

                        return (
                          <div
                            key={task.id}
                            className="rounded-xl border border-zinc-800/80 bg-zinc-900/65 px-3 py-2"
                          >
                            <p className="text-xs font-medium leading-snug text-zinc-100">
                              {task.title}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <span
                                className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${TASK_PRIO_CLS[task.priority]}`}
                              >
                                {task.priority.toUpperCase()}
                              </span>
                              <span
                                className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${due.cls}`}
                              >
                                {due.label}
                              </span>
                              {project && (
                                <span className="rounded-md border border-violet-500/20 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">
                                  {project}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                      Schedule
                    </p>
                    <span className="text-[10px] text-zinc-600">{day.slots.length}</span>
                  </div>

                  {day.slots.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-zinc-800/80 px-3 py-2 text-xs text-zinc-600">
                      Свободное окно.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {day.slots.map((slot) => {
                        const isHeysSynced = isHeysSyncedScheduleSlot(slot);
                        const heysBadgeLabel = isHeysSynced ? getHeysSyncedSlotBadgeLabel(slot) : null;
                        const approvalState = getScheduleSlotApprovalState(slot);
                        const requiresApproval = approvalState.requiresApproval;
                        const isCompleted = approvalState.isCompleted;
                        const completionLabel = formatCompletionLabel(approvalState.completedAt);

                        return (
                          <div
                            key={slot.id}
                            className={`rounded-xl border px-3 py-2 ${isCompleted ? "border-emerald-400/50 bg-linear-to-br from-emerald-400/28 via-emerald-500/18 to-emerald-950/38 text-emerald-50" : SCHEDULE_TONE_CLS[slot.tone]}`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <p className={`font-mono text-[10px] ${isCompleted ? "text-emerald-100/85" : "opacity-70"}`}>
                                  {slot.start}–{slot.end}
                                </p>
                                {requiresApproval && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      toggleScheduleSlotApproval(slot);
                                      setVersion((current) => current + 1);
                                    }}
                                    className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold leading-none transition ${
                                      isCompleted
                                        ? "border-emerald-200/70 bg-emerald-50/16 text-emerald-50 hover:border-emerald-100/80 hover:bg-emerald-50/22"
                                        : "border-white/14 bg-zinc-950/76 text-zinc-400 hover:border-sky-400/40 hover:text-sky-100"
                                    }`}
                                    aria-label={isCompleted ? "Снять подтверждение слота" : "Подтвердить слот"}
                                    title={isCompleted ? "Снять подтверждение" : "Подтвердить выполнение"}
                                  >
                                    {isCompleted ? "✓" : "○"}
                                  </button>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5">
                                {heysBadgeLabel && (
                                  <span className="rounded-full border border-orange-400/25 bg-orange-500/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.16em] text-orange-200">
                                    {heysBadgeLabel}
                                  </span>
                                )}
                              </div>
                            </div>
                            <p className={`mt-1 text-xs font-medium leading-snug ${isCompleted ? "text-emerald-50 line-through decoration-emerald-100/45 opacity-90" : ""}`}>{slot.title}</p>
                            {completionLabel && (
                              <p className="mt-1 text-[9px] uppercase tracking-[0.14em] text-emerald-100/85">
                                {completionLabel}
                              </p>
                            )}
                            {slot.subtitle && (
                              <p className="mt-1 line-clamp-2 text-[10px] opacity-70">
                                {slot.subtitle}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}