"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { AgentControlPanel } from "@/components/agent-control-panel";
import { HabitTracker } from "@/components/habit-tracker";
import { Pomodoro } from "@/components/pomodoro";
import { WeekCalendarGrid } from "@/components/week-calendar-grid";
import {
  type AgentControlSnapshot,
  getAgentControlSnapshot,
} from "@/lib/agent-control";
import { ensureJournalSeed, type JournalEntry } from "@/lib/journal";
import { allParamNames, getEntries, paramStatus } from "@/lib/medical";
import { addNote } from "@/lib/notes";
import { subscribeAppDataChange } from "@/lib/storage";
import { addTask } from "@/lib/tasks";
import {
  type ActivityStats,
  type DayCompletions,
  type FocusSnapshot,
  type WeeklyFocusReport,
  getActivityStats,
  getFocusSnapshot,
  getWeeklyFocusReport,
  weeklyCompletions,
} from "@/lib/productivity";

function ProdBars({ data }: { data: DayCompletions[] }) {
  const max = Math.max(...data.map((day) => day.count), 1);

  return (
    <div className="flex items-end gap-2">
      {data.map((day, index) => {
        const height = Math.max(4, (day.count / max) * 48);
        const isLast = index === data.length - 1;

        return (
          <div key={day.date} className="flex flex-col items-center gap-1">
            {day.count > 0 && (
              <span className="text-[10px] text-zinc-500">{day.count}</span>
            )}
            <div
              className={`w-6 rounded-md transition-all ${
                day.count > 0 ? "bg-sky-400/80" : "bg-zinc-800"
              } ${isLast ? "ring-1 ring-sky-400/30" : ""}`}
              style={{ height: `${height}px` }}
            />
            <span
              className={`text-[10px] ${
                isLast ? "font-semibold text-sky-400" : "text-zinc-600"
              }`}
            >
              {day.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function AlphacoreDashboard() {
  const [agentControl, setAgentControl] = useState<AgentControlSnapshot | null>(null);
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [completions, setCompletions] = useState<DayCompletions[]>([]);
  const [focusSnapshot, setFocusSnapshot] = useState<FocusSnapshot | null>(null);
  const [weeklyReport, setWeeklyReport] = useState<WeeklyFocusReport | null>(null);
  const [journalPreview, setJournalPreview] = useState<JournalEntry[]>([]);
  const [medicalSummary, setMedicalSummary] = useState<{
    entries: number;
    flagged: number;
    params: number;
    lastDate: string | null;
  } | null>(null);
  const [quickMode, setQuickMode] = useState<"task" | "note">("task");
  const [quickInput, setQuickInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const refreshDashboard = useCallback(() => {
    setAgentControl(getAgentControlSnapshot());
    setStats(getActivityStats());
    setCompletions(weeklyCompletions());
    setFocusSnapshot(getFocusSnapshot());
    setWeeklyReport(getWeeklyFocusReport());
    setJournalPreview(ensureJournalSeed().slice(-2));

    const entries = getEntries();
    const flagged = entries
      .flatMap((entry) => entry.params)
      .filter((param) => {
        const status = paramStatus(param);
        return status === "low" || status === "high";
      }).length;
    const lastDate = [...entries]
      .sort((a, b) => b.date.localeCompare(a.date))[0]?.date ?? null;

    setMedicalSummary({
      entries: entries.length,
      flagged,
      params: allParamNames().length,
      lastDate,
    });
  }, []);

  useEffect(() => {
    refreshDashboard();

    const unsubscribe = subscribeAppDataChange((keys) => {
      if (
        keys.some((key) =>
          [
            "alphacore_tasks",
            "alphacore_notes",
            "alphacore_habits",
            "alphacore_medical",
            "alphacore_projects",
            "alphacore_journal",
          ].includes(key),
        )
      ) {
        refreshDashboard();
      }
    });

    const onFocus = () => refreshDashboard();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshDashboard();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      unsubscribe();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshDashboard]);

  const handleQuickAdd = useCallback(() => {
    const value = quickInput.trim();
    if (!value) return;

    if (quickMode === "task") {
      addTask(value);
    } else {
      addNote(value, "");
    }

    setQuickInput("");
    refreshDashboard();
    inputRef.current?.focus();
  }, [quickInput, quickMode, refreshDashboard]);

  return (
    <div className="space-y-4 py-3">
      {/* ── Calendar hero + sidebar ── */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* Main: calendar */}
        <WeekCalendarGrid stats={stats} />

        {/* Sidebar */}
        <aside className="flex flex-col gap-4">
          {/* Quick input */}
          <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-3">
            <div className="mb-2 flex items-center gap-2">
              {(["task", "note"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setQuickMode(mode)}
                  className={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                    quickMode === mode
                      ? "bg-zinc-50 text-zinc-950"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {mode === "task" ? "📥 Задача" : "📝 Заметка"}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={quickInput}
                onChange={(event) => setQuickInput(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && handleQuickAdd()}
                placeholder={quickMode === "task" ? "Быстрая задача…" : "Быстрая заметка…"}
                className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-600"
              />
              <button
                type="button"
                onClick={handleQuickAdd}
                className="rounded-lg bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-zinc-200"
              >
                +
              </button>
            </div>
          </div>

          {/* Habits */}
          <HabitTracker />

          {/* Pomodoro */}
          <Pomodoro />

          {/* Journal preview */}
          <Link
            href="/journal"
            className="block rounded-2xl border border-fuchsia-500/15 bg-linear-to-br from-fuchsia-950/10 to-zinc-950 p-3 transition hover:border-fuchsia-400/30"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-50">💬 Дневник</h3>
              <span className="text-[10px] text-fuchsia-300">{journalPreview.length} записи</span>
            </div>
            <div className="mt-2 space-y-1.5">
              {journalPreview.map((entry) => (
                <div
                  key={entry.id}
                  className={`rounded-xl border px-3 py-2 ${
                    entry.author === "user"
                      ? "border-emerald-500/20 bg-emerald-500/8"
                      : "border-sky-500/20 bg-sky-500/8"
                  }`}
                >
                  <p className="line-clamp-2 text-[11px] text-zinc-200">{entry.text}</p>
                </div>
              ))}
            </div>
          </Link>

          {/* Agent control */}
          {agentControl && <AgentControlPanel snapshot={agentControl} />}

          {/* Productivity bars */}
          {completions.length > 0 && (
            <div className="rounded-2xl border border-sky-500/15 bg-linear-to-br from-sky-950/10 to-zinc-950 p-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-50">📊 Продуктивность</h3>
                <span className="text-[10px] text-zinc-500">нед</span>
              </div>
              <div className="mt-3 flex justify-center">
                <ProdBars data={completions} />
              </div>
            </div>
          )}

          {/* Medical */}
          <Link
            href="/medical"
            className="block rounded-2xl border border-teal-500/15 bg-linear-to-br from-teal-950/15 to-zinc-950 p-3 transition hover:border-teal-400/30"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-50">🏥 Показатели</h3>
              <span className="text-[10px] text-teal-300">{medicalSummary?.entries ?? 0} записей</span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/30 p-2 text-center">
                <p className="text-[9px] uppercase text-zinc-600">Замер</p>
                <p className="text-xs font-medium text-zinc-200">
                  {medicalSummary?.lastDate
                    ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(
                        new Date(medicalSummary.lastDate),
                      )
                    : "—"}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/30 p-2 text-center">
                <p className="text-[9px] uppercase text-zinc-600">Вне нормы</p>
                <p className="text-xs font-medium text-rose-300">{medicalSummary?.flagged ?? 0}</p>
              </div>
              <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/30 p-2 text-center">
                <p className="text-[9px] uppercase text-zinc-600">Параметры</p>
                <p className="text-xs font-medium text-teal-300">{medicalSummary?.params ?? 0}</p>
              </div>
            </div>
          </Link>
        </aside>
      </div>

      {/* ── Below-fold sections ── */}

      {focusSnapshot && (
        <section className="rounded-4xl border border-amber-500/15 bg-linear-to-br from-amber-950/10 to-zinc-950 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-zinc-50">🎯 Фокус дня</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Вместо цитат — конкретный список того, что реально двигает день.
              </p>
            </div>
            <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-amber-300">
              🍅 {focusSnapshot.focusToday.sessions} · {focusSnapshot.focusToday.minutes} мин сегодня
            </span>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-3">
              <p className="text-[10px] uppercase tracking-widest text-zinc-600">Главный фокус</p>
              <p className="mt-1 text-sm font-medium text-zinc-100">
                {focusSnapshot.primaryTask?.title ?? "Пока нет активной задачи"}
              </p>
              {focusSnapshot.primaryTask && (
                <p className="mt-1 text-[11px] text-zinc-500">
                  {focusSnapshot.primaryTask.priority.toUpperCase()} · {focusSnapshot.primaryTask.status}
                </p>
              )}
            </div>

            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-3">
              <p className="text-[10px] uppercase tracking-widest text-zinc-600">Разгрести</p>
              <p className="mt-1 text-sm font-medium text-zinc-100">
                {focusSnapshot.overdueCount} просрочено · {focusSnapshot.inboxCount} inbox
              </p>
              <p className="mt-1 text-[11px] text-zinc-500">
                Сначала убираем хвосты, потом берём новое.
              </p>
            </div>

            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-3">
              <p className="text-[10px] uppercase tracking-widest text-zinc-600">Проектное внимание</p>
              <p className="mt-1 text-sm font-medium text-zinc-100">
                {focusSnapshot.attentionProject?.name ?? "Все проекты в зелёной зоне"}
              </p>
              <p className="mt-1 text-[11px] text-zinc-500 line-clamp-2">
                {focusSnapshot.attentionProject?.nextStep ?? "Можно смело идти в execution mode."}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/tasks"
              className="rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
            >
              Открыть задачи
            </Link>
            {focusSnapshot.attentionProject && (
              <Link
                href={`/projects?open=${focusSnapshot.attentionProject.id}`}
                className="rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
              >
                Открыть проект
              </Link>
            )}
          </div>
        </section>
      )}

      {weeklyReport && (
        <section className="rounded-4xl border border-violet-500/15 bg-linear-to-br from-violet-950/10 to-zinc-950 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-zinc-50">🧾 Weekly focus report</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Фокус-минуты и completed tasks по дням без лишнего театра.
              </p>
            </div>
            <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-violet-300">
              {weeklyReport.totalFocusMinutes} мин · {weeklyReport.totalCompletedTasks} tasks
            </span>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-4">
              <div className="space-y-2">
                {weeklyReport.days.map((day) => (
                  <div
                    key={day.date}
                    className="grid grid-cols-[40px_minmax(0,1fr)_72px_72px] items-center gap-2 rounded-xl border border-zinc-800/50 bg-zinc-950/20 px-3 py-2"
                  >
                    <span className="text-xs font-semibold text-zinc-400">{day.label}</span>
                    <span className="h-2 rounded-full bg-zinc-800">
                      <span
                        className="block h-2 rounded-full bg-violet-400"
                        style={{
                          width: `${Math.max(
                            8,
                            weeklyReport.totalFocusMinutes > 0
                              ? (day.focusMinutes /
                                  Math.max(
                                    ...weeklyReport.days.map((item) => item.focusMinutes),
                                    1,
                                  )) *
                                  100
                              : 8,
                          )}%`,
                        }}
                      />
                    </span>
                    <span className="text-right text-xs text-violet-300">🍅 {day.focusMinutes}м</span>
                    <span className="text-right text-xs text-amber-300">✓ {day.completedTasks}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-4">
                <p className="text-[10px] uppercase tracking-widest text-zinc-500">Главная task недели</p>
                <p className="mt-2 text-sm font-medium text-zinc-100">
                  {weeklyReport.topTask?.title ?? "Пока без лидера по фокусу"}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {weeklyReport.topTask
                    ? `🍅 ${weeklyReport.topTask.sessions} · ${weeklyReport.topTask.minutes} мин${
                        weeklyReport.topTask.projectLabel
                          ? ` · ${weeklyReport.topTask.projectLabel}`
                          : ""
                      }`
                    : "Запусти пару помодоро — и лидер сразу найдётся."}
                </p>
              </div>

              <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-4">
                <p className="text-[10px] uppercase tracking-widest text-zinc-500">Проект недели</p>
                <p className="mt-2 text-sm font-medium text-zinc-100">
                  {weeklyReport.topProject?.name ?? "Пока без project focus leader"}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {weeklyReport.topProject
                    ? `${weeklyReport.topProject.minutes} мин чистого фокуса`
                    : "Как только задачи получат проектную привязку, карточка станет ещё умнее."}
                </p>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
