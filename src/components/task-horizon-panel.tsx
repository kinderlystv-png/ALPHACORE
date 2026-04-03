"use client";

import Link from "next/link";

import { WeekPlanner } from "@/components/week-planner";
import { dateStr } from "@/lib/storage";
import {
  compareTasksByAttention,
  getActionableTasks,
  type Task,
} from "@/lib/tasks";

const PRIORITY_CLS: Record<Task["priority"], string> = {
  p1: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  p2: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  p3: "border-zinc-700 bg-zinc-800/60 text-zinc-400",
};

function dayOffset(dateKey: string, referenceDate: string): number {
  return Math.round(
    (new Date(`${dateKey}T00:00:00`).getTime() -
      new Date(`${referenceDate}T00:00:00`).getTime()) /
      86_400_000,
  );
}

function formatDayCaption(dateKey: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${dateKey}T00:00:00`));
}

function getProjectLabel(task: Task): string | null {
  return task.project ?? null;
}

function tasksLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) return "задача";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "задачи";
  return "задач";
}

function dueMeta(task: Task, todayKey: string): { label: string; cls: string; cardCls: string } {
  if (!task.dueDate) {
    return {
      label: "active без даты",
      cls: "border-sky-500/20 bg-sky-500/10 text-sky-300",
      cardCls: "border-sky-500/20 bg-sky-950/10",
    };
  }

  const diff = dayOffset(task.dueDate, todayKey);

  if (diff < 0) {
    return {
      label: `хвост ${Math.abs(diff)} д.`,
      cls: "border-rose-500/30 bg-rose-500/10 text-rose-300",
      cardCls: "border-rose-500/20 bg-rose-950/10",
    };
  }

  if (diff === 0) {
    return {
      label: "сегодня",
      cls: "border-amber-500/30 bg-amber-500/10 text-amber-300",
      cardCls: "border-amber-500/20 bg-amber-950/10",
    };
  }

  return {
    label: `${diff} д.`,
    cls: "border-zinc-700 bg-zinc-800/60 text-zinc-400",
    cardCls: "border-zinc-800/70 bg-zinc-900/40",
  };
}

export function TaskHorizonPanel() {
  const todayKey = dateStr();
  const actionableTasks = getActionableTasks(todayKey);

  const todayTasks = actionableTasks
    .filter((task) => {
      if (task.dueDate) return task.dueDate <= todayKey;
      return task.status === "active";
    })
    .sort((left, right) => compareTasksByAttention(left, right, todayKey));

  const upcomingGroups = Array.from(
    actionableTasks.reduce<Map<string, Task[]>>((acc, task) => {
      if (!task.dueDate) return acc;

      const diff = dayOffset(task.dueDate, todayKey);
      if (diff <= 0 || diff > 10) return acc;

      const group = acc.get(task.dueDate) ?? [];
      group.push(task);
      acc.set(task.dueDate, group);
      return acc;
    }, new Map()),
  )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([dateKey, tasks]) => ({
      dateKey,
      tasks: [...tasks].sort((left, right) => compareTasksByAttention(left, right, todayKey)),
    }));

  const overdueCount = actionableTasks.filter(
    (task) => !!task.dueDate && task.dueDate < todayKey,
  ).length;
  const dueTodayCount = actionableTasks.filter((task) => task.dueDate === todayKey).length;
  const upcomingCount = actionableTasks.filter(
    (task) => !!task.dueDate && task.dueDate > todayKey,
  ).length;

  return (
    <div className="space-y-5">
      <section className="rounded-4xl border border-amber-500/15 bg-linear-to-br from-amber-950/10 to-zinc-950 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-50">🔥 Сегодня под акцентом</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Здесь только то, что уже горит сегодня: хвосты, due today и активные задачи без даты.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/tasks"
              className="rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
            >
              Открыть задачи
            </Link>
            <Link
              href="/calendar"
              className="rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
            >
              Открыть календарь
            </Link>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-rose-500/20 bg-rose-950/10 p-3.5">
            <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">Хвосты</p>
            <p className="mt-1 text-2xl font-bold text-rose-300">{overdueCount}</p>
          </div>
          <div className="rounded-2xl border border-amber-500/20 bg-amber-950/10 p-3.5">
            <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">Сегодня</p>
            <p className="mt-1 text-2xl font-bold text-amber-300">{dueTodayCount}</p>
          </div>
          <div className="rounded-2xl border border-sky-500/20 bg-sky-950/10 p-3.5">
            <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">Дальше по горизонту</p>
            <p className="mt-1 text-2xl font-bold text-sky-300">{upcomingCount}</p>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {todayTasks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-800/80 px-4 py-4 text-sm text-zinc-500">
              На сегодня нет выделенных задач — можно жить без ощущения, что на тебя сверху упал весь backlog.
            </div>
          ) : (
            todayTasks.map((task) => {
              const due = dueMeta(task, todayKey);
              const project = getProjectLabel(task);

              return (
                <div
                  key={task.id}
                  className={`rounded-2xl border px-4 py-3 ${due.cardCls}`}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-100">{task.title}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span
                          className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${PRIORITY_CLS[task.priority]}`}
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
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="rounded-4xl border border-zinc-800/50 bg-zinc-900/20 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-50">🔭 Анонсы следующих дней</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Будущие задачи не шумят всем списком — ты видишь только короткий анонс по дням.
            </p>
          </div>
          <span className="rounded-full border border-zinc-800 px-3 py-1 text-[10px] uppercase tracking-widest text-zinc-500">
            {upcomingGroups.length} дней с задачами
          </span>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {upcomingGroups.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-800/80 px-4 py-4 text-sm text-zinc-500 md:col-span-2 xl:col-span-4">
              По горизонту тихо — значит, неделя ещё не расползлась по швам.
            </div>
          ) : (
            upcomingGroups.map((group) => (
              <div
                key={group.dateKey}
                className="rounded-2xl border border-zinc-800/70 bg-zinc-900/40 p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                      {formatDayCaption(group.dateKey)}
                    </p>
                    <p className="mt-1 text-sm font-medium text-zinc-100">
                      {group.tasks.length} {tasksLabel(group.tasks.length)}
                    </p>
                  </div>
                  <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-sky-300">
                    анонс
                  </span>
                </div>

                <div className="mt-3 space-y-1.5">
                  {group.tasks.slice(0, 3).map((task) => (
                    <div key={task.id} className="truncate text-xs text-zinc-300">
                      • {task.title}
                    </div>
                  ))}
                  {group.tasks.length > 3 && (
                    <div className="text-xs text-zinc-500">+ ещё {group.tasks.length - 3}</div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <WeekPlanner
        anchorDate={new Date()}
        title="🗓 Неделя: задачи внутри расписания"
        description="Каждый день показывает all-day задачи и реальные слоты — уже ближе к week view, а не к бессмысленному списку."
        ctaHref="/calendar"
        ctaLabel="Открыть календарный экран"
      />
    </div>
  );
}