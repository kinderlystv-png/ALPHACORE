"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { dateStr, subscribeAppDataChange } from "@/lib/storage";
import { toggleDone, type Task, getCarryoverTasks, moveTasksDueDate, updateTask } from "@/lib/tasks";

const DECISION_KEY = "alphacore_task_carryover_decision_date";

type CarryoverAction = "today" | "tomorrow" | "unschedule" | "done" | "archive";

function readDecisionDate(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(DECISION_KEY);
}

function writeDecisionDate(value: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DECISION_KEY, value);
}

function tomorrowStr(): string {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  return dateStr(next);
}

function overdueLabel(dueDate?: string): string {
  if (!dueDate) return "без даты";

  const today = new Date(`${dateStr()}T00:00:00`);
  const due = new Date(`${dueDate}T00:00:00`);
  const diff = Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86_400_000));
  const dueText = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(due);

  if (diff === 0) return `${dueText} · сегодня`;
  if (diff === 1) return `${dueText} · 1 д. назад`;
  return `${dueText} · ${diff} д. назад`;
}

function projectLabel(task: Task): string | null {
  return task.project?.trim() || null;
}

export function DailyTaskCarryoverBanner() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isVisible, setIsVisible] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const refresh = useCallback((preserveVisible = false) => {
    const today = dateStr();
    const overdue = getCarryoverTasks(today);
    const decidedToday = readDecisionDate() === today;

    setTasks(overdue);

    if (overdue.length === 0) {
      setIsVisible(false);
      return;
    }

    if (preserveVisible && isVisible) {
      setIsVisible(true);
      return;
    }

    setIsVisible(!decidedToday);
  }, [isVisible]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => refresh());

    const unsubscribe = subscribeAppDataChange((keys) => {
      if (keys.includes("alphacore_tasks")) {
        refresh(true);
      }
    });

    const handleFocus = () => refresh();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.cancelAnimationFrame(frame);
      unsubscribe();
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refresh]);

  const handleMoveToToday = useCallback(() => {
    if (tasks.length === 0) return;

    setIsApplying(true);

    const today = dateStr();
    moveTasksDueDate(
      tasks.map((task) => task.id),
      today,
    );
    writeDecisionDate(today);
    setIsVisible(false);
    setIsApplying(false);
  }, [tasks]);

  const handleTaskAction = useCallback((task: Task, action: CarryoverAction) => {
    setActiveTaskId(task.id);

    switch (action) {
      case "today":
        moveTasksDueDate([task.id], dateStr());
        break;
      case "tomorrow":
        moveTasksDueDate([task.id], tomorrowStr());
        break;
      case "unschedule":
        updateTask(task.id, { dueDate: undefined });
        break;
      case "done":
        toggleDone(task.id);
        break;
      case "archive":
        updateTask(task.id, {
          status: "archived",
          dueDate: undefined,
          completedAt: undefined,
        });
        break;
    }

    refresh(true);
    setActiveTaskId(null);
  }, [refresh]);

  const handleDismiss = useCallback(() => {
    writeDecisionDate(dateStr());
    setIsVisible(false);
  }, []);

  if (!isVisible || tasks.length === 0) return null;

  return (
    <section className="mx-4 mt-4 rounded-[1.75rem] border border-amber-500/25 bg-amber-500/10 p-4 text-zinc-50 shadow-lg shadow-amber-950/10 sm:mx-6 lg:mx-5">
      <div className="space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-300">
                Daily carry-over
              </p>
              <h2 className="mt-1 text-base font-semibold text-zinc-50">
                Нашёл {tasks.length} незаверш{tasks.length === 1 ? "ённую" : "ённых"} задач{tasks.length === 1 ? "у" : ""} с прошлой даты
              </h2>
              <p className="mt-1 text-sm text-amber-100/85">
                Можно быстро раскидать всё на сегодня или дать каждой задаче отдельное решение прямо здесь.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 text-[11px] text-amber-100/80">
              <span className="rounded-full border border-amber-400/20 bg-zinc-950/30 px-3 py-1">↪ сегодня</span>
              <span className="rounded-full border border-amber-400/20 bg-zinc-950/30 px-3 py-1">↪ завтра</span>
              <span className="rounded-full border border-amber-400/20 bg-zinc-950/30 px-3 py-1">⊘ убрать дату</span>
              <span className="rounded-full border border-amber-400/20 bg-zinc-950/30 px-3 py-1">✓ done</span>
              <span className="rounded-full border border-amber-400/20 bg-zinc-950/30 px-3 py-1">архив</span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={handleMoveToToday}
              disabled={isApplying}
              className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isApplying ? "Переношу…" : "Все на сегодня"}
            </button>
            <Link
              href="/tasks"
              className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-200 transition hover:border-zinc-500 hover:text-zinc-50"
            >
              Открыть задачи
            </Link>
            <button
              type="button"
              onClick={handleDismiss}
              className="rounded-xl border border-transparent px-4 py-2 text-sm text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
            >
              Не сейчас
            </button>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          {tasks.map((task) => {
            const isBusy = activeTaskId === task.id || isApplying;
            const project = projectLabel(task);

            return (
              <article
                key={task.id}
                className="rounded-2xl border border-amber-400/15 bg-zinc-950/35 p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-50">{task.title}</p>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-100">
                      {overdueLabel(task.dueDate)}
                    </span>
                    <span className="rounded-full border border-zinc-700 bg-zinc-900/70 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
                      {task.priority.toUpperCase()}
                    </span>
                    <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-200">
                      {task.status}
                    </span>
                    {project && (
                      <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-200">
                        {project}
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleTaskAction(task, "today")}
                    className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-100 transition hover:border-amber-400/40 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    На сегодня
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleTaskAction(task, "tomorrow")}
                    className="rounded-xl border border-zinc-700 bg-zinc-900/70 px-2.5 py-1.5 text-[11px] font-medium text-zinc-200 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    На завтра
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleTaskAction(task, "unschedule")}
                    className="rounded-xl border border-zinc-700 bg-zinc-900/70 px-2.5 py-1.5 text-[11px] font-medium text-zinc-200 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Убрать дату
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleTaskAction(task, "done")}
                    className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-medium text-emerald-200 transition hover:border-emerald-400/40 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Готово
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleTaskAction(task, "archive")}
                    className="rounded-xl border border-zinc-700 bg-zinc-950/80 px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    В архив
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
