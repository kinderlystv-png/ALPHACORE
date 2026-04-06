"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AgentControlPanel } from "@/components/agent-control-panel";
import { HabitTracker } from "@/components/habit-tracker";
import { HeysHealthPanel } from "@/components/heys-health-panel";
import { Pomodoro } from "@/components/pomodoro";
import { SicknessHomeBadge } from "@/components/sickness-status-cards";
import { WeekCalendarGrid } from "@/components/week-calendar-grid";
import {
  type AgentControlSnapshot,
  getAgentControlSnapshot,
} from "@/lib/agent-control";
import { generateEveningReview, generateMorningBrief } from "@/lib/agent-brief";
import {
  POMODORO_FOCUS_EVENT,
  readTaskDragId,
  writeTaskDragData,
} from "@/lib/dashboard-events";
import { ensureJournalSeed, type JournalEntry } from "@/lib/journal";
import { allParamNames, getEntries, paramStatus } from "@/lib/medical";
import { addNote } from "@/lib/notes";
import { getProjects, type Project } from "@/lib/projects";
import { addCompletedFactSlot } from "@/lib/schedule";
import { subscribeAppDataChange } from "@/lib/storage";
import {
  activateTask,
  addTask,
  getActionableTasks,
  toggleDone,
  updateTask,
  type Task,
  type TaskPriority,
} from "@/lib/tasks";
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
import { useHeysSync } from "@/lib/use-heys-sync";

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

type QuickFlash = {
  tone: "success" | "info";
  text: string;
};

type MedicalTrendPoint = {
  date: string;
  label: string;
  params: number;
  flagged: number;
};

type MedicalSummary = {
  entries: number;
  flagged: number;
  params: number;
  lastDate: string | null;
  lastGapDays: number | null;
  trend: MedicalTrendPoint[];
};

type QuickTaskDraft = {
  title: string;
  priority: TaskPriority;
  dueDate?: string;
};

type CommandItem = {
  id: string;
  title: string;
  subtitle: string;
  keywords: string;
  action:
    | { kind: "capture"; mode: "task" | "note" }
    | { kind: "route"; href: string }
    | { kind: "brief"; mode: "brief" | "review" }
    | { kind: "pomodoro"; taskId: string; autoStart: boolean }
    | { kind: "done-task"; taskId: string; title: string }
    | { kind: "open-project"; projectId: string };
};

type BriefPanelMode = "brief" | "review" | null;

const PRIORITY_CLS: Record<TaskPriority, string> = {
  p1: "border-rose-500/25 bg-rose-500/10 text-rose-200",
  p2: "border-amber-500/25 bg-amber-500/10 text-amber-200",
  p3: "border-zinc-700 bg-zinc-800/70 text-zinc-300",
};

const PROJECT_STATUS_CLS: Record<Project["status"], string> = {
  green: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
  yellow: "border-amber-500/25 bg-amber-500/10 text-amber-200",
  red: "border-rose-500/25 bg-rose-500/10 text-rose-200",
};

function dayKey(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  date.setHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

function dueLabel(dueDate?: string) {
  if (!dueDate) return "без даты";
  if (dueDate === dayKey()) return "сегодня";
  if (dueDate === dayKey(1)) return "завтра";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(
    new Date(`${dueDate}T00:00:00`),
  );
}

function daysSinceDate(dateLike: string | null) {
  if (!dateLike) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(`${dateLike}T00:00:00`);
  target.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((now.getTime() - target.getTime()) / 86_400_000));
}

function buildTextPreview(text: string, maxLines = 8): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return [...lines.slice(0, maxLines), "…"].join("\n");
}

function parseQuickTaskDraft(input: string): QuickTaskDraft {
  let next = input.trim();

  const priorityMatch = next.match(/(?:^|\s)!(p[123])\b/i);
  const priority = (priorityMatch?.[1]?.toLowerCase() as TaskPriority | undefined) ?? "p2";
  next = next.replace(/(?:^|\s)!p[123]\b/gi, " ").trim();

  let dueDate: string | undefined;

  if (/(?:^|\s)@today\b/i.test(next)) {
    dueDate = dayKey();
    next = next.replace(/(?:^|\s)@today\b/gi, " ").trim();
  } else if (/(?:^|\s)@tomorrow\b/i.test(next)) {
    dueDate = dayKey(1);
    next = next.replace(/(?:^|\s)@tomorrow\b/gi, " ").trim();
  }

  return {
    title: next.replace(/\s+/g, " ").trim(),
    priority,
    dueDate,
  };
}

function MedicalTrend({ data }: { data: MedicalTrendPoint[] }) {
  if (data.length === 0) return null;

  const max = Math.max(...data.map((point) => point.params), 1);

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-widest text-zinc-500">
          Последние замеры
        </p>
        <p className="text-[10px] text-zinc-500">{data.length} точек</p>
      </div>

      <div className="mt-3 flex items-end justify-between gap-2">
        {data.map((point, index) => {
          const height = Math.max(8, (point.params / max) * 42);
          const isLatest = index === data.length - 1;

          return (
            <div key={`${point.date}-${index}`} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[9px] text-zinc-600">{point.params}</span>
              <div
                className={`w-full rounded-md transition-all ${
                  point.flagged > 0 ? "bg-rose-400/70" : "bg-teal-400/70"
                } ${isLatest ? "ring-1 ring-zinc-200/20" : ""}`}
                style={{ height }}
              />
              <span className={`text-[9px] ${isLatest ? "text-zinc-300" : "text-zinc-600"}`}>
                {point.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function buildMedicalSummary(): MedicalSummary {
  const entries = getEntries();
  const flagged = entries
    .flatMap((entry) => entry.params)
    .filter((param) => {
      const status = paramStatus(param);
      return status === "low" || status === "high";
    }).length;
  const sortedEntries = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const lastDate = [...entries]
    .sort((a, b) => b.date.localeCompare(a.date))[0]?.date ?? null;
  const trend = sortedEntries.slice(-6).map((entry) => ({
    date: entry.date,
    label: new Intl.DateTimeFormat("ru-RU", { day: "numeric" }).format(
      new Date(`${entry.date}T00:00:00`),
    ),
    params: entry.params.length,
    flagged: entry.params.filter((param) => {
      const status = paramStatus(param);
      return status === "low" || status === "high";
    }).length,
  }));

  return {
    entries: entries.length,
    flagged,
    params: allParamNames().length,
    lastDate,
    lastGapDays: daysSinceDate(lastDate),
    trend,
  };
}

export function AlphacoreDashboard() {
  const router = useRouter();
  const { lastSynced: heysLastSynced } = useHeysSync();
  const [agentControl, setAgentControl] = useState<AgentControlSnapshot | null>(() => getAgentControlSnapshot());
  const [stats, setStats] = useState<ActivityStats | null>(() => getActivityStats());
  const [completions, setCompletions] = useState<DayCompletions[]>(() => weeklyCompletions());
  const [focusSnapshot, setFocusSnapshot] = useState<FocusSnapshot | null>(() => getFocusSnapshot());
  const [weeklyReport, setWeeklyReport] = useState<WeeklyFocusReport | null>(() => getWeeklyFocusReport());
  const [journalPreview, setJournalPreview] = useState<JournalEntry[]>(() => ensureJournalSeed().slice(-2));
  const [triageTasks, setTriageTasks] = useState<Task[]>(() => getActionableTasks().slice(0, 4));
  const [projects, setProjects] = useState<Project[]>(() => getProjects());
  const [medicalSummary, setMedicalSummary] = useState<MedicalSummary | null>(() => buildMedicalSummary());
  const [quickMode, setQuickMode] = useState<"task" | "note">("task");
  const [quickInput, setQuickInput] = useState("");
  const [flash, setFlash] = useState<QuickFlash | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandActiveIndex, setCommandActiveIndex] = useState(0);
  const [projectQuickId, setProjectQuickId] = useState("");
  const [briefPanelMode, setBriefPanelMode] = useState<BriefPanelMode>("brief");
  const [dragDeskTarget, setDragDeskTarget] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);

  const focusQuickInput = useCallback((mode?: "task" | "note") => {
    if (mode) setQuickMode(mode);

    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const quickTaskDraft = useMemo(
    () => (quickMode === "task" ? parseQuickTaskDraft(quickInput) : null),
    [quickInput, quickMode],
  );

  const morningBrief = useMemo(
    () => (agentControl ? generateMorningBrief(agentControl) : ""),
    [agentControl],
  );

  const eveningReview = useMemo(
    () => (agentControl ? generateEveningReview(agentControl) : ""),
    [agentControl],
  );

  const activeBriefText = briefPanelMode === "review" ? eveningReview : morningBrief;
  const activeBriefTitle = briefPanelMode === "review" ? "Вечерний review" : "Утренний brief";
  const activeBriefPreview = useMemo(
    () => buildTextPreview(activeBriefText, 9),
    [activeBriefText],
  );
  const briefHasOverflow = activeBriefPreview !== activeBriefText;

  const refreshDashboard = useCallback(() => {
    setAgentControl(getAgentControlSnapshot());
    setStats(getActivityStats());
    setCompletions(weeklyCompletions());
    setFocusSnapshot(getFocusSnapshot());
    setWeeklyReport(getWeeklyFocusReport());
    setJournalPreview(ensureJournalSeed().slice(-2));
    setTriageTasks(getActionableTasks().slice(0, 4));
    setProjects(getProjects());
    setMedicalSummary(buildMedicalSummary());
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeAppDataChange((keys) => {
      if (
        keys.some((key) =>
          [
            "alphacore_tasks",
            "alphacore_schedule_custom",
            "alphacore_schedule_overrides",
            "alphacore_notes",
            "alphacore_habits",
            "alphacore_medical",
            "alphacore_sickness",
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

  useEffect(() => {
    if (heysLastSynced) {
      const frame = window.requestAnimationFrame(() => {
        refreshDashboard();
      });

      return () => window.cancelAnimationFrame(frame);
    }
  }, [heysLastSynced, refreshDashboard]);

  useEffect(() => {
    if (!flash) return;

    const timeoutId = window.setTimeout(() => setFlash(null), 2400);
    return () => window.clearTimeout(timeoutId);
  }, [flash]);

  const openCommandPalette = useCallback(() => {
    setCommandOpen(true);
    setCommandActiveIndex(0);
    requestAnimationFrame(() => {
      commandInputRef.current?.focus();
      commandInputRef.current?.select();
    });
  }, []);

  const closeCommandPalette = useCallback(() => {
    setCommandOpen(false);
    setCommandQuery("");
    setCommandActiveIndex(0);
  }, []);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      return (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;

      if (meta && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        if (commandOpen) {
          closeCommandPalette();
        } else {
          openCommandPalette();
        }
        return;
      }

      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        focusQuickInput();
        return;
      }

      if (!meta && !event.altKey && !event.shiftKey && event.key === "/" && !isTypingTarget(event.target)) {
        event.preventDefault();
        focusQuickInput();
        return;
      }

      if (event.key === "Escape" && commandOpen) {
        closeCommandPalette();
        return;
      }

      if (event.key === "Escape" && document.activeElement === inputRef.current) {
        if (quickInput) {
          setQuickInput("");
        } else {
          inputRef.current?.blur();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeCommandPalette, commandOpen, focusQuickInput, openCommandPalette, quickInput]);

  const handleQuickAdd = useCallback((status: "inbox" | "active" | "done" = "inbox") => {
    const value = quickInput.trim();
    if (!value) return;

    if (quickMode === "task") {
      const draft = parseQuickTaskDraft(value);
      if (!draft.title) return;

      const isQuickDone = status === "done";

      if (isQuickDone) {
        addCompletedFactSlot({
          title: draft.title,
          priority: draft.priority,
        });
        setFlash({
          tone: "success",
          text: `Зафиксирован завершённый слот: ${draft.title}`,
        });
      } else {
        const task = addTask(draft.title, {
          priority: draft.priority,
          dueDate: draft.dueDate,
        });

        if (status === "active") {
          updateTask(task.id, { status: "active" });
        }

        setFlash({
          tone: "success",
          text: `Задача добавлена: ${draft.priority.toUpperCase()} · ${dueLabel(draft.dueDate)} · ${status}`,
        });
      }
    } else {
      addNote(value, "");
      setFlash({ tone: "success", text: "Заметка добавлена в inbox памяти" });
    }

    setQuickInput("");
    refreshDashboard();
    inputRef.current?.focus();
  }, [quickInput, quickMode, refreshDashboard]);

  const insertQuickToken = useCallback(
    (token: string) => {
      setQuickMode("task");
      setQuickInput((current) => {
        const trimmed = current.trim();
        if (trimmed.includes(token)) return trimmed;
        return `${trimmed} ${token}`.trim();
      });
      focusQuickInput("task");
    },
    [focusQuickInput],
  );

  const handleQuickInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleQuickAdd(event.shiftKey ? "active" : "inbox");
      }
    },
    [handleQuickAdd],
  );

  const pushTaskToPomodoro = useCallback(
    (taskId: string, autoStart = false) => {
      window.dispatchEvent(
        new CustomEvent(POMODORO_FOCUS_EVENT, {
          detail: { taskId, autoStart },
        }),
      );
      setFlash({
        tone: "info",
        text: autoStart
          ? "Главный фокус отправлен в Pomodoro и запущен"
          : "Задача выбрана в Pomodoro",
      });
    },
    [],
  );

  const handleTaskDoneById = useCallback(
    (taskId: string, title: string) => {
      toggleDone(taskId);
      setFlash({ tone: "success", text: `Готово: ${title}` });
      refreshDashboard();
    },
    [refreshDashboard],
  );

  const handlePrimaryTaskDone = useCallback(() => {
    const task = focusSnapshot?.primaryTask;
    if (!task) return;

    handleTaskDoneById(task.id, task.title);
  }, [focusSnapshot, handleTaskDoneById]);

  const handlePrimaryTaskActivate = useCallback(() => {
    const task = focusSnapshot?.primaryTask;
    if (!task) return;

    activateTask(task.id);
    setFlash({ tone: "info", text: `Задача переведена в active: ${task.title}` });
    refreshDashboard();
  }, [focusSnapshot, refreshDashboard]);

  const handleTriageActivate = useCallback(
    (task: Task) => {
      activateTask(task.id);
      setFlash({ tone: "info", text: `В работе: ${task.title}` });
      refreshDashboard();
    },
    [refreshDashboard],
  );

  const handleTriageDone = useCallback(
    (task: Task) => {
      toggleDone(task.id);
      setFlash({ tone: "success", text: `Закрыто: ${task.title}` });
      refreshDashboard();
    },
    [refreshDashboard],
  );

  const handleProjectQuickOpen = useCallback(
    (projectId: string) => {
      if (!projectId) return;
      router.push(`/projects?open=${projectId}`);
    },
    [router],
  );

  const openBriefPanel = useCallback((mode: Exclude<BriefPanelMode, null>) => {
    setBriefPanelMode(mode);
  }, []);

  const copyBriefToClipboard = useCallback(async () => {
    if (!activeBriefText) return;

    try {
      await navigator.clipboard.writeText(activeBriefText);
      setFlash({ tone: "success", text: `${activeBriefTitle} скопирован` });
    } catch {
      setFlash({ tone: "info", text: "Не удалось скопировать текст — можно выделить вручную" });
    }
  }, [activeBriefText, activeBriefTitle]);

  const handleDeskDragOver = useCallback(
    (target: string) => (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDragDeskTarget(target);
    },
    [],
  );

  const handleDeskDragLeave = useCallback(() => {
    setDragDeskTarget(null);
  }, []);

  const handlePriorityDrop = useCallback(
    (priority: TaskPriority) => (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      setDragDeskTarget(null);

      const taskId = readTaskDragId(event.dataTransfer);
      if (!taskId) return;

      updateTask(taskId, { priority });
      setFlash({ tone: "info", text: `Приоритет обновлён: ${priority.toUpperCase()}` });
      refreshDashboard();
    },
    [refreshDashboard],
  );

  const handlePomodoroDeskDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      setDragDeskTarget(null);

      const taskId = readTaskDragId(event.dataTransfer);
      if (!taskId) return;

      pushTaskToPomodoro(taskId, false);
    },
    [pushTaskToPomodoro],
  );

  const commandItems = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [
      {
        id: "capture-task",
        title: "Новая задача",
        subtitle: "Сфокусировать quick capture на задаче",
        keywords: "task quick capture inbox",
        action: { kind: "capture", mode: "task" },
      },
      {
        id: "capture-note",
        title: "Новая заметка",
        subtitle: "Открыть capture в режиме note",
        keywords: "note quick capture memory",
        action: { kind: "capture", mode: "note" },
      },
      {
        id: "open-calendar",
        title: "Открыть календарь",
        subtitle: "Перейти к недельному планированию",
        keywords: "calendar week schedule",
        action: { kind: "route", href: "/calendar" },
      },
      {
        id: "open-tasks",
        title: "Открыть задачи",
        subtitle: "Inbox, active и done задачи",
        keywords: "tasks inbox active",
        action: { kind: "route", href: "/tasks" },
      },
      {
        id: "open-groups",
        title: "Открыть группы",
        subtitle: "Проекты и категории задач",
        keywords: "groups group project category categories",
        action: { kind: "route", href: "/projects" },
      },
      {
        id: "open-journal",
        title: "Открыть дневник",
        subtitle: "Поймать мысль, пока не убежала",
        keywords: "journal reflection notes",
        action: { kind: "route", href: "/journal" },
      },
      {
        id: "open-brief",
        title: "Показать утренний brief",
        subtitle: "Короткий срез приоритетов и баланса",
        keywords: "brief morning agent priorities",
        action: { kind: "brief", mode: "brief" },
      },
      {
        id: "open-review",
        title: "Показать вечерний review",
        subtitle: "Итог дня и перенос внимания на завтра",
        keywords: "review evening reflection summary",
        action: { kind: "brief", mode: "review" },
      },
      {
        id: "open-medical",
        title: "Открыть показатели",
        subtitle: "Последние анализы и отклонения",
        keywords: "medical health lab",
        action: { kind: "route", href: "/medical" },
      },
    ];

    if (focusSnapshot?.primaryTask) {
      items.unshift(
        {
          id: "focus-pomodoro",
          title: "Запустить Pomodoro для главного фокуса",
          subtitle: focusSnapshot.primaryTask.title,
          keywords: `pomodoro focus ${focusSnapshot.primaryTask.title}`,
          action: {
            kind: "pomodoro",
            taskId: focusSnapshot.primaryTask.id,
            autoStart: true,
          },
        },
        {
          id: "focus-done",
          title: "Закрыть главный фокус",
          subtitle: focusSnapshot.primaryTask.title,
          keywords: `done close focus ${focusSnapshot.primaryTask.title}`,
          action: {
            kind: "done-task",
            taskId: focusSnapshot.primaryTask.id,
            title: focusSnapshot.primaryTask.title,
          },
        },
      );
    }

    if (focusSnapshot?.attentionProject) {
      items.push({
        id: "attention-project",
        title: "Открыть проект внимания",
        subtitle: focusSnapshot.attentionProject.name,
        keywords: `project attention ${focusSnapshot.attentionProject.name}`,
        action: {
          kind: "open-project",
          projectId: focusSnapshot.attentionProject.id,
        },
      });
    }

    return items;
  }, [focusSnapshot]);

  const filteredCommandItems = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();
    if (!query) return commandItems;
    return commandItems.filter((item) => {
      const haystack = `${item.title} ${item.subtitle} ${item.keywords}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [commandItems, commandQuery]);

  const runCommand = useCallback(
    (item: CommandItem) => {
      closeCommandPalette();
      switch (item.action.kind) {
        case "capture":
          focusQuickInput(item.action.mode);
          return;
        case "route":
          router.push(item.action.href);
          return;
        case "brief":
          openBriefPanel(item.action.mode);
          return;
        case "pomodoro":
          pushTaskToPomodoro(item.action.taskId, item.action.autoStart);
          return;
        case "done-task":
          handleTaskDoneById(item.action.taskId, item.action.title);
          return;
        case "open-project":
          handleProjectQuickOpen(item.action.projectId);
          return;
        default:
          return;
      }
    },
    [closeCommandPalette, focusQuickInput, handleProjectQuickOpen, handleTaskDoneById, openBriefPanel, pushTaskToPomodoro, router],
  );

  const strategicProjects = useMemo(
    () => projects.filter((project) => project.kind === "project"),
    [projects],
  );

  const selectedQuickProject = useMemo(
    () => {
      const resolvedProjectQuickId =
        (projectQuickId && strategicProjects.some((project) => project.id === projectQuickId)
          ? projectQuickId
          : focusSnapshot?.attentionProject?.id ?? strategicProjects[0]?.id) ?? "";

      return strategicProjects.find((project) => project.id === resolvedProjectQuickId) ?? null;
    },
    [focusSnapshot, projectQuickId, strategicProjects],
  );

  return (
    <div className="space-y-4 py-3">
      {commandOpen && (
        <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/55 px-4 py-16 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-4xl border border-zinc-800 bg-zinc-950/95 p-4 shadow-2xl shadow-black/40">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-zinc-50">⌘⇧P Agent palette</p>
                <p className="text-xs text-zinc-500">Прыжок по действиям и экранам без поиска по меню.</p>
              </div>
              <button
                type="button"
                onClick={closeCommandPalette}
                className="rounded-xl border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-100"
              >
                Esc
              </button>
            </div>

            <input
              ref={commandInputRef}
              value={commandQuery}
                onChange={(event) => {
                  setCommandQuery(event.target.value);
                  setCommandActiveIndex(0);
                }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setCommandActiveIndex((current) =>
                    Math.min(current + 1, Math.max(filteredCommandItems.length - 1, 0)),
                  );
                  return;
                }

                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setCommandActiveIndex((current) => Math.max(current - 1, 0));
                  return;
                }

                if (event.key === "Enter" && filteredCommandItems[commandActiveIndex]) {
                  event.preventDefault();
                  runCommand(filteredCommandItems[commandActiveIndex]!);
                }
              }}
              placeholder="Например: pomodoro, группа, journal, задача…"
              className="mt-4 w-full rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-zinc-600"
            />

            <div className="mt-4 max-h-[55vh] space-y-2 overflow-auto pr-1">
              {filteredCommandItems.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => runCommand(item)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                    index === commandActiveIndex
                      ? "border-zinc-600 bg-zinc-900/80"
                      : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
                  }`}
                >
                  <p className="text-sm font-medium text-zinc-100">{item.title}</p>
                  <p className="mt-1 text-xs text-zinc-500">{item.subtitle}</p>
                </button>
              ))}

              {filteredCommandItems.length === 0 && (
                <div className="rounded-2xl border border-dashed border-zinc-800 px-4 py-6 text-center text-sm text-zinc-500">
                  Ничего не нашлось. Попробуй “pomodoro”, “группа” или “дневник”.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {flash && (
        <div className="pointer-events-none fixed right-5 top-5 z-50 flex justify-end">
          <div
            className={`rounded-2xl border px-4 py-3 text-sm shadow-2xl shadow-black/30 backdrop-blur ${
              flash.tone === "success"
                ? "border-emerald-500/30 bg-emerald-950/85 text-emerald-200"
                : "border-sky-500/30 bg-sky-950/85 text-sky-200"
            }`}
          >
            {flash.text}
          </div>
        </div>
      )}

      {/* ── Calendar hero + widgets grid ── */}
      <div className="space-y-5">
        <WeekCalendarGrid stats={stats} />

        {/* HEYS live health panel */}
        <HeysHealthPanel />

        <SicknessHomeBadge />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-12">
          {/* Quick input */}
          <div className="md:col-span-2 xl:col-span-5 rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-3">
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
              <button
                type="button"
                onClick={openCommandPalette}
                className="ml-auto rounded-lg border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
              >
                ⌘⇧P palette
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={inputRef}
                value={quickInput}
                onChange={(event) => setQuickInput(event.target.value)}
                onKeyDown={handleQuickInputKeyDown}
                placeholder={quickMode === "task" ? "Быстрая задача…" : "Быстрая заметка…"}
                className="min-w-0 flex-1 basis-55 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-600"
              />
              <button
                type="button"
                onClick={() => handleQuickAdd()}
                className="rounded-lg bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-zinc-200"
                title={quickMode === "task" ? "Добавить задачу в inbox" : "Добавить заметку"}
                aria-label={quickMode === "task" ? "Добавить задачу в inbox" : "Добавить заметку"}
              >
                {quickMode === "task" ? "+ task" : "+ note"}
              </button>
              {quickMode === "task" && (
                <button
                  type="button"
                  onClick={() => handleQuickAdd("done")}
                  className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200 transition hover:border-amber-400/40 hover:bg-amber-500/15"
                  title="Зафиксировать уже сделанное как завершённый слот в календаре"
                  aria-label="Зафиксировать уже сделанную задачу"
                >
                  +⚡
                </button>
              )}
            </div>

            {quickMode === "task" && quickTaskDraft?.title && (
              <p className="mt-2 text-[11px] text-zinc-500">
                Будет создано: <span className="text-zinc-200">{quickTaskDraft.title}</span> ·{" "}
                <span className="text-zinc-300">{quickTaskDraft.priority.toUpperCase()}</span> ·{" "}
                <span className="text-zinc-300">{dueLabel(quickTaskDraft.dueDate)}</span>
                <span className="text-amber-300"> · +⚡ создаёт завершённый слот на текущее время</span>
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {quickMode === "task" && (
                <>
                  {[
                    { label: "!p1", token: "!p1" },
                    { label: "!p2", token: "!p2" },
                    { label: "@today", token: "@today" },
                    { label: "@tomorrow", token: "@tomorrow" },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => insertQuickToken(item.token)}
                      className="rounded-full border border-zinc-800 bg-zinc-900/40 px-2 py-1 text-[10px] text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
                    >
                      {item.label}
                    </button>
                  ))}
                </>
              )}

              <span className="ml-auto text-[10px] text-zinc-600">
                ⌘K или / · Enter → inbox · ⇧Enter → active · +⚡ → завершённый слот
              </span>
            </div>
          </div>

          <section className="md:col-span-1 xl:col-span-4 rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-50">🧹 Inbox triage</h3>
                <p className="text-[11px] text-zinc-500">Самые важные хвосты без похода в /tasks.</p>
              </div>
              <Link
                href="/tasks"
                className="rounded-lg border border-zinc-800 px-2 py-1 text-[10px] text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
              >
                Все задачи
              </Link>
            </div>

            <div className="mt-3 space-y-2">
              {triageTasks.slice(0, 3).map((task) => (
                <div
                  key={task.id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    writeTaskDragData(event.dataTransfer, task.id);
                  }}
                  className="rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-100">{task.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                        <span className={`rounded-full border px-1.5 py-0.5 ${PRIORITY_CLS[task.priority]}`}>
                          {task.priority.toUpperCase()}
                        </span>
                        <span>{task.status}</span>
                        <span>·</span>
                        <span>{dueLabel(task.dueDate)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {task.status === "inbox" && (
                      <button
                        type="button"
                        onClick={() => handleTriageActivate(task)}
                        className="rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
                      >
                        В работу
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => pushTaskToPomodoro(task.id, task.status !== "active")}
                      className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1 text-[11px] text-rose-200 transition hover:border-rose-400/40"
                    >
                      В Pomodoro
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTriageDone(task)}
                      className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-200 transition hover:border-emerald-400/40"
                    >
                      Готово
                    </button>
                  </div>
                </div>
              ))}

              {triageTasks.length === 0 && (
                <button
                  type="button"
                  onClick={() => focusQuickInput("task")}
                  className="w-full rounded-xl border border-dashed border-zinc-800 px-3 py-4 text-sm text-zinc-500 transition hover:border-zinc-600 hover:text-zinc-300"
                >
                  Inbox пуст. Можно сразу кинуть новую задачу в capture.
                </button>
              )}
            </div>
          </section>

          <section className="md:col-span-1 xl:col-span-3 rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-50">🪄 Drop desk</h3>
                <p className="text-[11px] text-zinc-500">Перетащи задачу сюда, чтобы быстро сменить приоритет или отправить в Pomodoro.</p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {([
                { id: "p1", label: "P1", hint: "critical / today" },
                { id: "p2", label: "P2", hint: "important / week" },
                { id: "p3", label: "P3", hint: "backlog" },
              ] as const).map((item) => (
                <div
                  key={item.id}
                  onDragOver={handleDeskDragOver(item.id)}
                  onDragLeave={handleDeskDragLeave}
                  onDrop={handlePriorityDrop(item.id)}
                  className={`rounded-2xl border border-dashed px-3 py-3 transition ${
                    dragDeskTarget === item.id
                      ? "border-zinc-200 bg-zinc-50/10"
                      : "border-zinc-800 bg-zinc-950/30"
                  }`}
                >
                  <p className={`text-sm font-semibold ${PRIORITY_CLS[item.id]}`}>{item.label}</p>
                  <p className="mt-1 text-[10px] text-zinc-500">{item.hint}</p>
                </div>
              ))}

              <div
                onDragOver={handleDeskDragOver("pomodoro")}
                onDragLeave={handleDeskDragLeave}
                onDrop={handlePomodoroDeskDrop}
                className={`rounded-2xl border border-dashed px-3 py-3 transition ${
                  dragDeskTarget === "pomodoro"
                    ? "border-rose-300/50 bg-rose-500/10"
                    : "border-zinc-800 bg-zinc-950/30"
                }`}
              >
                <p className="text-sm font-semibold text-rose-200">Pomodoro</p>
                <p className="mt-1 text-[10px] text-zinc-500">положить задачу в фокус без старта</p>
              </div>
            </div>
          </section>

          {/* Habits */}
          <div className="xl:col-span-7">
            <HabitTracker />
          </div>

          {/* Pomodoro */}
          <div className="xl:col-span-5">
            <Pomodoro />
          </div>

          {/* Journal preview */}
          <Link
            href="/journal"
            className="md:col-span-1 xl:col-span-4 block h-full rounded-2xl border border-fuchsia-500/15 bg-linear-to-br from-fuchsia-950/10 to-zinc-950 p-3 transition hover:border-fuchsia-400/30"
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
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                    <span>{entry.author === "user" ? "user" : "assistant"}</span>
                    {entry.tags.slice(0, 2).map((tag) => (
                      <span key={tag} className="rounded-full border border-zinc-800/80 px-1.5 py-0.5">
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Link>

          {/* Productivity bars */}
          {completions.length > 0 && (
            <div className="md:col-span-1 xl:col-span-4">
              <div className="h-full rounded-2xl border border-sky-500/15 bg-linear-to-br from-sky-950/10 to-zinc-950 p-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-zinc-50">📊 Продуктивность</h3>
                  <span className="text-[10px] text-zinc-500">нед</span>
                </div>
                <div className="mt-3 flex justify-center">
                  <ProdBars data={completions} />
                </div>
              </div>
            </div>
          )}

          {/* Medical */}
          <Link
            href="/medical"
            className="md:col-span-1 xl:col-span-4 block h-full rounded-2xl border border-teal-500/15 bg-linear-to-br from-teal-950/15 to-zinc-950 p-3 transition hover:border-teal-400/30"
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
                <p className="mt-1 text-[10px] text-zinc-500">
                  {medicalSummary?.lastGapDays != null ? `${medicalSummary.lastGapDays} д. назад` : "нет данных"}
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

            {medicalSummary && medicalSummary.trend.length > 0 && (
              <div className="mt-2.5">
                <MedicalTrend data={medicalSummary.trend} />
              </div>
            )}
          </Link>

          {/* Agent control */}
          {agentControl && (
            <div className="md:col-span-2 xl:col-span-12">
              <AgentControlPanel snapshot={agentControl} />
            </div>
          )}
        </div>
      </div>

      {/* ── Below-fold sections ── */}

      {focusSnapshot && (
        <section className="rounded-4xl border border-amber-500/15 bg-linear-to-br from-amber-950/10 to-zinc-950 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-zinc-50">🎯 Фокус дня</h2>
              <p className="mt-1 text-sm text-zinc-500">
                {focusSnapshot.mode === "recovery"
                  ? "Сегодня день в recovery mode: health floor и один щадящий рабочий шаг вместо обычного разгона."
                  : "Вместо цитат — конкретный список того, что реально двигает день."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {focusSnapshot.sickness.active && (
                <span className="rounded-full border border-rose-500/25 bg-rose-500/10 px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-rose-200">
                  🤒 Болею · {focusSnapshot.sickness.durationLabel}
                </span>
              )}
              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-amber-300">
                🍅 {focusSnapshot.focusToday.sessions} · {focusSnapshot.focusToday.minutes} мин сегодня
              </span>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-3">
              <p className="text-[10px] uppercase tracking-widest text-zinc-600">Главный фокус</p>
              <p className="mt-1 text-sm font-medium text-zinc-100">
                {focusSnapshot.primaryTask?.title ?? "Пока нет активной задачи"}
              </p>
              {focusSnapshot.mode === "recovery" && (
                <div className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-rose-200">Recovery mode</p>
                  <p className="mt-1 text-[11px] leading-5 text-rose-100/90">{focusSnapshot.modeSummary}</p>
                  {focusSnapshot.taskScopeHint && (
                    <p className="mt-2 text-[11px] leading-5 text-rose-100/80">{focusSnapshot.taskScopeHint}</p>
                  )}
                </div>
              )}
              {focusSnapshot.primaryTask && (
                <>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    {focusSnapshot.primaryTask.priority.toUpperCase()} · {focusSnapshot.primaryTask.status} · {dueLabel(
                      focusSnapshot.primaryTask.dueDate,
                    )}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {focusSnapshot.primaryTask.status === "inbox" && (
                      <button
                        type="button"
                        onClick={handlePrimaryTaskActivate}
                        className="rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
                      >
                        В работу
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => pushTaskToPomodoro(focusSnapshot.primaryTask!.id, true)}
                      className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1 text-[11px] text-rose-200 transition hover:border-rose-400/40"
                    >
                      В Pomodoro
                    </button>
                    <button
                      type="button"
                      onClick={handlePrimaryTaskDone}
                      className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-200 transition hover:border-emerald-400/40"
                    >
                      Готово
                    </button>
                  </div>
                </>
              )}
              {!focusSnapshot.primaryTask && (
                <button
                  type="button"
                  onClick={() => focusQuickInput("task")}
                  className="mt-3 rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
                >
                  {focusSnapshot.mode === "recovery" ? "Добавить щадящую задачу" : "Добавить задачу в capture"}
                </button>
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
              <p className="text-[10px] uppercase tracking-widest text-zinc-600">Стратегический проект</p>
              <p className="mt-1 text-sm font-medium text-zinc-100">
                {focusSnapshot.attentionProject?.name ?? "Все проекты в спокойной зоне"}
              </p>
              <p className="mt-1 text-[11px] text-zinc-500 line-clamp-2">
                {focusSnapshot.attentionProject?.nextStep ?? "Можно вести день через задачи и категории без отдельного project-alert."}
              </p>

              {strategicProjects.length > 0 && (
                <div className="mt-3 space-y-2">
                  <select
                    value={selectedQuickProject?.id ?? ""}
                    onChange={(event) => setProjectQuickId(event.target.value)}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-xs text-zinc-100"
                  >
                    {strategicProjects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name} · {project.status}
                      </option>
                    ))}
                  </select>

                  {selectedQuickProject && (
                    <div className="rounded-lg border border-zinc-800/70 bg-zinc-950/40 p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] ${PROJECT_STATUS_CLS[selectedQuickProject.status]}`}
                        >
                          {selectedQuickProject.status}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleProjectQuickOpen(selectedQuickProject.id)}
                          className="rounded-lg border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
                        >
                          Открыть
                        </button>
                      </div>
                      <p className="mt-2 line-clamp-2 text-[11px] text-zinc-500">
                        {selectedQuickProject.nextStep}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/tasks"
              className="rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
            >
              Открыть задачи
            </Link>
            <button
              type="button"
              onClick={() => openBriefPanel("brief")}
              className="rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
            >
              Утренний brief
            </button>
            <button
              type="button"
              onClick={() => openBriefPanel("review")}
              className="rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
            >
              Вечерний review
            </button>
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

      {agentControl && activeBriefText && (
        <section className="rounded-4xl border border-sky-500/15 bg-linear-to-br from-sky-950/10 to-zinc-950 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-zinc-50">🪞 Agent brief / review</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Быстрый текстовый срез системы, который можно сразу скопировать в чат, заметку или себе в голову.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openBriefPanel("brief")}
                className={`rounded-xl border px-3 py-2 text-xs transition ${
                  briefPanelMode === "brief"
                    ? "border-sky-400/40 bg-sky-500/10 text-sky-200"
                    : "border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
                }`}
              >
                Утро
              </button>
              <button
                type="button"
                onClick={() => openBriefPanel("review")}
                className={`rounded-xl border px-3 py-2 text-xs transition ${
                  briefPanelMode === "review"
                    ? "border-violet-400/40 bg-violet-500/10 text-violet-200"
                    : "border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
                }`}
              >
                Вечер
              </button>
              <button
                type="button"
                onClick={copyBriefToClipboard}
                className="rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
              >
                Скопировать
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-3xl border border-zinc-800/60 bg-zinc-950/40 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-zinc-100">{activeBriefTitle}</p>
              <span className="text-[10px] uppercase tracking-widest text-zinc-500">
                ready to share
              </span>
            </div>
            <pre className="whitespace-pre-wrap text-sm leading-6 text-zinc-300">{activeBriefPreview}</pre>

            {briefHasOverflow && (
              <details className="mt-4 rounded-2xl border border-zinc-800/70 bg-zinc-950/35 p-3">
                <summary className="cursor-pointer list-none text-xs font-medium text-zinc-300">
                  Показать полный текст
                </summary>
                <pre className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-300">{activeBriefText}</pre>
              </details>
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

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
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

              {weeklyReport.topTask && (
                <button
                  type="button"
                  onClick={() => pushTaskToPomodoro(weeklyReport.topTask?.id ?? "", true)}
                  className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/10 px-2.5 py-1 text-[11px] text-violet-200 transition hover:border-violet-400/40"
                >
                  В Pomodoro
                </button>
              )}
            </div>

            <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-4">
              <p className="text-[10px] uppercase tracking-widest text-zinc-500">Проект недели</p>
              <p className="mt-2 text-sm font-medium text-zinc-100">
                {weeklyReport.topProject?.name ?? "Пока без лидера среди проектов"}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {weeklyReport.topProject
                  ? `${weeklyReport.topProject.minutes} мин чистого фокуса`
                  : "Как только задачи получат проектную привязку, карточка станет ещё умнее."}
              </p>

              {weeklyReport.topProject?.id && (
                <button
                  type="button"
                  onClick={() => handleProjectQuickOpen(weeklyReport.topProject!.id!)}
                  className="mt-3 rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
                >
                  Открыть проект
                </button>
              )}
            </div>
          </div>

          <details className="mt-4 rounded-3xl border border-zinc-800/70 bg-zinc-950/35 p-4">
            <summary className="cursor-pointer list-none text-sm font-medium text-zinc-200">
              Показать динамику по дням
            </summary>

            <div className="mt-4 rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-4">
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
          </details>
        </section>
      )}
    </div>
  );
}
