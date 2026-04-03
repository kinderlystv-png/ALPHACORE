"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { dateStr, subscribeAppDataChange } from "@/lib/storage";
import { type Task, getCarryoverTasks, moveTasksDueDate } from "@/lib/tasks";

const DECISION_KEY = "alphacore_task_carryover_decision_date";

function readDecisionDate(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(DECISION_KEY);
}

function writeDecisionDate(value: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DECISION_KEY, value);
}

export function DailyTaskCarryoverBanner() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isVisible, setIsVisible] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

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
    refresh();

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

  const handleDismiss = useCallback(() => {
    writeDecisionDate(dateStr());
    setIsVisible(false);
  }, []);

  if (!isVisible || tasks.length === 0) return null;

  const preview = tasks.slice(0, 3);
  const hiddenCount = tasks.length - preview.length;

  return (
    <section className="mx-4 mt-4 rounded-[1.75rem] border border-amber-500/25 bg-amber-500/10 p-4 text-zinc-50 shadow-lg shadow-amber-950/10 sm:mx-6 lg:mx-5">
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
              Перенести их на сегодня, чтобы они не застряли во вчерашнем дне и не потерялись в истории?
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {preview.map((task) => (
              <span
                key={task.id}
                className="max-w-full truncate rounded-full border border-amber-400/20 bg-zinc-950/30 px-3 py-1 text-xs text-amber-50"
                title={task.title}
              >
                ↪ {task.title}
              </span>
            ))}
            {hiddenCount > 0 && (
              <span className="rounded-full border border-zinc-700/80 bg-zinc-950/30 px-3 py-1 text-xs text-zinc-300">
                + ещё {hiddenCount}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={handleMoveToToday}
            disabled={isApplying}
            className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isApplying ? "Переношу…" : "Перенести на сегодня"}
          </button>
          <Link
            href="/tasks"
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-200 transition hover:border-zinc-500 hover:text-zinc-50"
          >
            Разобрать вручную
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
    </section>
  );
}