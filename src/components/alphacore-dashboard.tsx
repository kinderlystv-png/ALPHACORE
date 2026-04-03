"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AgentControlPanel } from "@/components/agent-control-panel";
import { HabitTracker } from "@/components/habit-tracker";
import { Pomodoro } from "@/components/pomodoro";
import {
  type AgentControlSnapshot,
  getAgentControlSnapshot,
} from "@/lib/agent-control";
import { ensureJournalSeed, type JournalEntry } from "@/lib/journal";
import { allParamNames, getEntries, paramStatus } from "@/lib/medical";
import { addNote } from "@/lib/notes";
import {
  type ScheduleSlot,
  SCHEDULE_TONE_CLS,
  getScheduleForDate,
} from "@/lib/schedule";
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

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return "Доброй ночи";
  if (h < 12) return "Доброе утро";
  if (h < 18) return "Добрый день";
  return "Добрый вечер";
}

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

  const todaySlots = useMemo<ScheduleSlot[]>(() => getScheduleForDate(new Date()), []);

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

  const dateStr = useMemo(
    () =>
      new Intl.DateTimeFormat("ru-RU", {
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(new Date()),
    [],
  );

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
    <div className="space-y-5 py-5">
      <section>
        <h1 className="text-2xl font-bold text-zinc-50">{greeting()} 👋</h1>
        <p className="mt-1 text-sm capitalize text-zinc-500">{dateStr}</p>
      </section>

      {agentControl && <AgentControlPanel snapshot={agentControl} />}

      <section className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-4">
        <div className="mb-3 flex items-center gap-2">
          {(["task", "note"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setQuickMode(mode)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
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
            placeholder={
              quickMode === "task" ? "Быстрая задача…" : "Быстрая заметка…"
            }
            className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-600"
          />
          <button
            type="button"
            onClick={handleQuickAdd}
            className="rounded-xl bg-zinc-50 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200"
          >
            +
          </button>
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Ручной ввод — запасной режим. Основной сценарий: рассказываешь агенту в Copilot/Codex,
          а он уже собирает эту панель как систему фокуса, а не как очередной список ради галочек.
        </p>
      </section>

      {stats && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-sky-500/20 bg-sky-950/10 p-3.5">
            <p className="text-[10px] uppercase tracking-widest text-zinc-500">Inbox</p>
            <p className="mt-1 text-2xl font-bold text-sky-300">{stats.inboxCount}</p>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-3.5">
            <p className="text-[10px] uppercase tracking-widest text-zinc-500">В работе</p>
            <p className="mt-1 text-2xl font-bold text-emerald-300">{stats.activeCount}</p>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-3.5">
            <p className="text-[10px] uppercase tracking-widest text-zinc-500">Готово / нед</p>
            <p className="mt-1 text-2xl font-bold text-amber-300">{stats.doneThisWeek}</p>
          </div>
          <div className="rounded-xl border border-violet-500/20 bg-violet-950/10 p-3.5">
            <p className="text-[10px] uppercase tracking-widest text-zinc-500">Привычки</p>
            <p className="mt-1 text-2xl font-bold text-violet-300">
              {stats.habitsToday.done}/{stats.habitsToday.total}
            </p>
          </div>
        </section>
      )}

      <HabitTracker />

      <section className="rounded-4xl border border-zinc-800/50 bg-zinc-900/20 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-50">🗓 Расписание на сегодня</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Объединено из недельного шаблона, событий студии и операционных правил.
            </p>
          </div>
          <Link
            href="/calendar"
            className="rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
          >
            Открыть календарь
          </Link>
        </div>

        <div className="mt-4 space-y-2">
          {todaySlots.map((slot) => (
            <div
              key={slot.id}
              className={`rounded-xl border px-4 py-3 ${SCHEDULE_TONE_CLS[slot.tone]}`}
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-mono text-xs opacity-70">
                    {slot.start}–{slot.end}
                  </p>
                  <p className="mt-1 text-sm font-medium">{slot.title}</p>
                  {slot.subtitle && (
                    <p className="mt-1 text-xs opacity-70">{slot.subtitle}</p>
                  )}
                </div>
                <span className="shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-white/70">
                  {slot.source === "studio"
                    ? "schedule.xlsx"
                    : slot.source === "derived"
                      ? "rule"
                      : "week"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <Pomodoro />

      {completions.length > 0 && (
        <section className="rounded-4xl border border-sky-500/15 bg-linear-to-br from-sky-950/10 to-zinc-950 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-50">📊 Продуктивность</h2>
            <span className="text-xs text-zinc-500">задачи / неделя</span>
          </div>
          <div className="mt-4 flex justify-center">
            <ProdBars data={completions} />
          </div>
        </section>
      )}

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

      <Link
        href="/journal"
        className="block rounded-4xl border border-fuchsia-500/15 bg-linear-to-br from-fuchsia-950/10 to-zinc-950 p-5 transition hover:border-fuchsia-400/30"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-50">💬 Дневник / лог</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Быстрый диалоговый архив: твои вводные и мои структурные заметки в одном потоке.
            </p>
          </div>
          <span className="rounded-full border border-fuchsia-500/20 bg-fuchsia-500/10 px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-fuchsia-300">
            {journalPreview.length} свежих записи
          </span>
        </div>

        <div className="mt-4 space-y-2">
          {journalPreview.map((entry) => (
            <div
              key={entry.id}
              className={`rounded-2xl border px-4 py-3 ${
                entry.author === "user"
                  ? "border-emerald-500/20 bg-emerald-500/8"
                  : "border-sky-500/20 bg-sky-500/8"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-500">
                <span>{entry.author === "user" ? "Ты" : "Copilot"}</span>
                <span>
                  {new Intl.DateTimeFormat("ru-RU", {
                    hour: "2-digit",
                    minute: "2-digit",
                    day: "numeric",
                    month: "short",
                  }).format(new Date(entry.createdAt))}
                </span>
              </div>
              <p className="mt-2 line-clamp-3 text-sm text-zinc-200">{entry.text}</p>
              {entry.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {entry.tags.map((tag) => (
                    <span
                      key={`${entry.id}-${tag}`}
                      className="rounded-full border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </Link>

      <Link
        href="/medical"
        className="block rounded-4xl border border-teal-500/15 bg-linear-to-br from-teal-950/15 to-zinc-950 p-5 transition hover:border-teal-400/30"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-50">🏥 Контроль показателей</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Держите анализы, УЗИ и динамику параметров в одном месте.
            </p>
          </div>
          <span className="rounded-full border border-teal-500/20 bg-teal-500/10 px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-teal-300">
            {medicalSummary?.entries ?? 0} записей
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-3">
            <p className="text-[10px] uppercase tracking-widest text-zinc-600">Последний замер</p>
            <p className="mt-1 text-sm font-medium text-zinc-200">
              {medicalSummary?.lastDate
                ? new Intl.DateTimeFormat("ru-RU", {
                    day: "numeric",
                    month: "short",
                  }).format(new Date(medicalSummary.lastDate))
                : "Пока пусто"}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-3">
            <p className="text-[10px] uppercase tracking-widest text-zinc-600">Вне нормы</p>
            <p className="mt-1 text-sm font-medium text-rose-300">{medicalSummary?.flagged ?? 0}</p>
          </div>
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-3">
            <p className="text-[10px] uppercase tracking-widest text-zinc-600">Параметры</p>
            <p className="mt-1 text-sm font-medium text-teal-300">{medicalSummary?.params ?? 0}</p>
          </div>
        </div>
      </Link>
    </div>
  );
}
