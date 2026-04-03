"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type Task,
  getTaskFocusTotal,
  getTasks,
  logFocusSession,
} from "@/lib/tasks";
import { lsGet, lsSet, subscribeAppDataChange } from "@/lib/storage";

type Phase = "focus" | "break";

const FOCUS_MIN = 25;
const BREAK_MIN = 5;
const PREF_KEY = "alphacore_pomodoro";
const POMODORO_FOCUS_EVENT = "alphacore:pomodoro-focus-task";

function sortPomodoroTasks(tasks: Task[]): Task[] {
  const priorityRank = { p1: 0, p2: 1, p3: 2 };
  const statusRank = { active: 0, inbox: 1, done: 2, archived: 3 };

  return [...tasks].sort((a, b) => {
    return (
      statusRank[a.status] - statusRank[b.status] ||
      priorityRank[a.priority] - priorityRank[b.priority] ||
      (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") ||
      a.createdAt.localeCompare(b.createdAt)
    );
  });
}

export function Pomodoro() {
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<Phase>("focus");
  const [seconds, setSeconds] = useState(FOCUS_MIN * 60);
  const [sessions, setSessions] = useState(0);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const total = phase === "focus" ? FOCUS_MIN * 60 : BREAK_MIN * 60;
  const pct = Math.round(((total - seconds) / total) * 100);

  const refreshTasks = useCallback(() => {
    const next = sortPomodoroTasks(
      getTasks().filter((task) => task.status === "active" || task.status === "inbox"),
    );
    const savedTaskId = lsGet<{ selectedTaskId?: string }>(PREF_KEY, {}).selectedTaskId ?? "";
    setTasks(next);
    setSelectedTaskId((current) => {
      const preferred = current || savedTaskId;
      if (preferred && next.some((task) => task.id === preferred)) return preferred;
      return next[0]?.id ?? "";
    });
  }, []);

  const reset = useCallback((p: Phase) => {
    setPhase(p);
    setSeconds(p === "focus" ? FOCUS_MIN * 60 : BREAK_MIN * 60);
    setRunning(false);
  }, []);

  useEffect(() => {
    refreshTasks();
    return subscribeAppDataChange((keys) => {
      if (keys.includes("alphacore_tasks")) refreshTasks();
    });
  }, [refreshTasks]);

  useEffect(() => {
    const onExternalFocus = (event: Event) => {
      const customEvent = event as CustomEvent<{ taskId?: string; autoStart?: boolean }>;
      const taskId = customEvent.detail?.taskId;
      if (!taskId) return;

      const nextTasks = sortPomodoroTasks(
        getTasks().filter((task) => task.status === "active" || task.status === "inbox"),
      );
      const selectedTask = nextTasks.find((task) => task.id === taskId);
      if (!selectedTask) return;

      setTasks(nextTasks);
      setSelectedTaskId(taskId);
      setFeedback(
        customEvent.detail?.autoStart
          ? `Pomodoro запущен для «${selectedTask.title}»`
          : `В фокусе: «${selectedTask.title}»`,
      );

      if (customEvent.detail?.autoStart) {
        setPhase("focus");
        setSeconds(FOCUS_MIN * 60);
        setRunning(true);
      }
    };

    window.addEventListener(POMODORO_FOCUS_EVENT, onExternalFocus as EventListener);
    return () => window.removeEventListener(POMODORO_FOCUS_EVENT, onExternalFocus as EventListener);
  }, []);

  useEffect(() => {
    lsSet(PREF_KEY, { selectedTaskId });
  }, [selectedTaskId]);

  useEffect(() => {
    if (!running) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          setRunning(false);
          if (phase === "focus") {
            if (selectedTaskId) {
              logFocusSession(selectedTaskId, FOCUS_MIN);
              const task = tasks.find((item) => item.id === selectedTaskId);
              setFeedback(task ? `+${FOCUS_MIN} мин записано в «${task.title}»` : `+${FOCUS_MIN} мин зафиксировано`);
            } else {
              setFeedback(`Фокус-сессия завершена`);
            }
            setSessions((n) => n + 1);
            setPhase("break");
            return BREAK_MIN * 60;
          } else {
            setPhase("focus");
            setFeedback("Перерыв завершён — можно возвращаться в фокус");
            return FOCUS_MIN * 60;
          }
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running, phase, selectedTaskId, tasks]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedStats = selectedTask ? getTaskFocusTotal(selectedTask) : null;

  const ringSize = 80;
  const sw = 4;
  const r = (ringSize - sw) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (pct / 100) * c;

  return (
    <section
      className={`rounded-4xl border p-5 shadow-2xl shadow-black/20 transition-colors ${
        phase === "focus"
          ? "border-rose-500/20 bg-linear-to-br from-rose-950/10 to-zinc-950"
          : "border-emerald-500/20 bg-linear-to-br from-emerald-950/10 to-zinc-950"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-50">
            🍅 {phase === "focus" ? "Фокус" : "Перерыв"}
          </h2>
          <p className="text-xs text-zinc-500">
            Сессий: {sessions} · {FOCUS_MIN} / {BREAK_MIN} мин
          </p>
        </div>
        <div className="relative flex items-center justify-center">
          <svg width={ringSize} height={ringSize} className="-rotate-90">
            <circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={r}
              fill="none"
              strokeWidth={sw}
              className="stroke-zinc-800"
            />
            <circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={r}
              fill="none"
              strokeWidth={sw}
              strokeDasharray={c}
              strokeDashoffset={off}
              strokeLinecap="round"
              className={`transition-all duration-500 ${
                phase === "focus" ? "stroke-rose-400" : "stroke-emerald-400"
              }`}
            />
          </svg>
          <span className="absolute text-lg font-mono font-bold text-zinc-100">
            {mm}:{ss}
          </span>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <label className="block text-[11px] uppercase tracking-widest text-zinc-500">
          Задача в фокусе
        </label>
        <select
          value={selectedTaskId}
          onChange={(e) => setSelectedTaskId(e.target.value)}
          className="w-full rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2.5 text-sm text-zinc-100"
        >
          <option value="">Без привязки</option>
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.priority.toUpperCase()} · {task.title}
            </option>
          ))}
        </select>

        {selectedTask && selectedStats && (
          <p className="text-xs text-zinc-500">
            Уже накоплено: 🍅 {selectedStats.sessions} · {selectedStats.minutes} мин
          </p>
        )}

        {!selectedTask && tasks.length === 0 && (
          <p className="text-xs text-zinc-600">
            Добавьте или активируйте задачу, чтобы привязать фокус-сессии.
          </p>
        )}

        {feedback && <p className="text-xs text-emerald-300">{feedback}</p>}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => setRunning(!running)}
          className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition ${
            running
              ? "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
              : "bg-zinc-50 text-zinc-950 hover:bg-zinc-200"
          }`}
        >
          {running ? "⏸ Пауза" : "▶ Старт"}
        </button>
        <button
          type="button"
          onClick={() => reset("focus")}
          className="rounded-xl border border-zinc-800 px-4 py-2.5 text-sm text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
        >
          ↺
        </button>
      </div>
    </section>
  );
}
