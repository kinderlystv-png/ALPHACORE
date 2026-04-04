"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { ProjectSelectManager } from "@/components/project-select-manager";
import { AREA_COLOR, type LifeArea } from "@/lib/life-areas";
import {
  PROJECT_ACCENT_CLS,
  type Project,
  type ProjectAccent,
  getProjects,
} from "@/lib/projects";
import { addCompletedFactSlot, type ScheduleTone } from "@/lib/schedule";
import { subscribeAppDataChange } from "@/lib/storage";
import {
  type Task,
  type TaskStatus,
  activateTask,
  addTask,
  compareTasksByAttention,
  deleteTask,
  getTaskFocusTotal,
  getTasks,
  toggleDone,
  updateTask,
} from "@/lib/tasks";

const FILTERS: { key: TaskStatus | "all"; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "inbox", label: "Входящие" },
  { key: "active", label: "В работе" },
  { key: "done", label: "Готово" },
];

const PRIO_CLS: Record<string, string> = {
  p1: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  p2: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  p3: "border-zinc-700 bg-zinc-800/50 text-zinc-400",
};

const STATUS_CLS: Record<string, string> = {
  inbox: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  done: "border-zinc-700 bg-zinc-800/50 text-zinc-500",
};

const PRIORITY_SWITCH_LABEL: Record<Task["priority"], string> = {
  p1: "P1",
  p2: "P2",
  p3: "P3",
};

const PRIORITY_SWITCH_HINT: Record<Task["priority"], string> = {
  p1: "Супер срочно",
  p2: "Важно",
  p3: "Можно позже",
};

const PROJECT_BADGE_CLS: Record<ProjectAccent, string> = {
  sky: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  orange: "border-orange-500/30 bg-orange-500/10 text-orange-300",
  violet: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  teal: "border-teal-500/30 bg-teal-500/10 text-teal-300",
  rose: "border-rose-500/30 bg-rose-500/10 text-rose-300",
};

const PROJECT_DOT_CLS: Record<ProjectAccent, string> = {
  sky: "bg-sky-400",
  orange: "bg-orange-400",
  violet: "bg-violet-400",
  teal: "bg-teal-400",
  rose: "bg-rose-400",
};

const PRIORITY_LOAD_WEIGHT: Record<Task["priority"], number> = {
  p1: 9,
  p2: 4,
  p3: 1,
};

const AREA_GROUP_ORDER: Record<LifeArea, number> = {
  work: 0,
  recovery: 1,
  family: 2,
  health: 3,
  reflection: 4,
  operations: 5,
};

type TaskGroup = {
  id: string;
  label: string;
  project: Project | null;
  area: LifeArea | null;
  tasks: Task[];
  priorityLoad: number;
  priorityCounts: Record<Task["priority"], number>;
  openCount: number;
  doneCount: number;
  overdueCount: number;
  focusSessions: number;
  focusMinutes: number;
};

type PrioritySwitchProps = {
  value: Task["priority"];
  onChange: (priority: Task["priority"]) => void;
  size?: "sm" | "md";
};

function pluralizeTasks(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) return "задача";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "задачи";
  return "задач";
}

function normalizeGroupKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function getDueOffset(dueDate?: string): number | null {
  if (!dueDate) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  return Math.floor((due.getTime() - now.getTime()) / 86_400_000);
}

function inferGroupArea(label?: string | null): LifeArea | null {
  const normalized = label?.trim().toLowerCase();
  if (!normalized) return null;

  if (["kinderly", "heys", "work", "studio", "client"].some((token) => normalized.includes(token))) {
    return "work";
  }
  if (["health", "run", "sport", "training", "sleep", "stretch", "здоров", "спорт"].some((token) => normalized.includes(token))) {
    return "health";
  }
  if (["family", "danya", "minecraft", "bday", "birthday", "сем", "др"].some((token) => normalized.includes(token))) {
    return "family";
  }
  if (["review", "planning", "journal", "reflection", "рефлекс", "осмысл"].some((token) => normalized.includes(token))) {
    return "reflection";
  }
  if (["personal", "recovery", "rest", "лич", "отдых", "restore"].some((token) => normalized.includes(token))) {
    return "recovery";
  }
  if (["cleanup", "ops", "admin", "операц", "быт"].some((token) => normalized.includes(token))) {
    return "operations";
  }

  return null;
}

function getGroupShellTone(group: Pick<TaskGroup, "project" | "area">): {
  shellCls: string;
  badgeCls: string;
  dotCls: string;
} {
  if (group.project) {
    return {
      shellCls: PROJECT_ACCENT_CLS[group.project.accent],
      badgeCls: PROJECT_BADGE_CLS[group.project.accent],
      dotCls: PROJECT_DOT_CLS[group.project.accent],
    };
  }

  if (group.area) {
    const color = AREA_COLOR[group.area];
    return {
      shellCls: `${color.border} ${color.bg}`,
      badgeCls: `${color.border} ${color.bg} ${color.text}`,
      dotCls: color.dot,
    };
  }

  return {
    shellCls: "border-zinc-800/70 bg-zinc-900/35",
    badgeCls: "border-zinc-700 bg-zinc-800/60 text-zinc-300",
    dotCls: "bg-zinc-500",
  };
}

function formatGroupSummary(group: TaskGroup): string {
  const parts: string[] = [];

  if (group.openCount > 0) {
    parts.push(`${group.openCount} открытых`);
  }
  if (group.overdueCount > 0) {
    parts.push(`${group.overdueCount} просрочено`);
  }
  if (group.doneCount > 0) {
    parts.push(`${group.doneCount} готово`);
  }
  if (group.openCount === 0 && group.doneCount === 0) {
    parts.push(`${group.tasks.length} ${pluralizeTasks(group.tasks.length)}`);
  }

  return parts.join(" · ");
}

function PrioritySwitch({ value, onChange, size = "sm" }: PrioritySwitchProps) {
  const shellSizeCls = size === "md" ? "min-h-10 px-1.5 py-1.5" : "min-h-8 px-1 py-1";
  const buttonSizeCls = size === "md" ? "px-2.5 py-1.5 text-xs" : "px-2 py-1 text-[10px]";
  const hintTone = value === "p1" ? "text-rose-300" : "text-zinc-500";

  return (
    <div className={`flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950/40 ${shellSizeCls}`}>
      {(["p1", "p2", "p3"] as const).map((priority) => {
        const isActive = value === priority;

        return (
          <button
            key={priority}
            type="button"
            onClick={() => onChange(priority)}
            title={PRIORITY_SWITCH_HINT[priority]}
            aria-pressed={isActive}
            className={`rounded-md border font-semibold uppercase tracking-wide transition ${buttonSizeCls} ${
              isActive
                ? PRIO_CLS[priority]
                : "border-zinc-800 bg-zinc-900/70 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
            }`}
          >
            {PRIORITY_SWITCH_LABEL[priority]}
          </button>
        );
      })}
      <span className={`hidden pl-1 text-[10px] sm:inline ${hintTone}`}>
        {PRIORITY_SWITCH_HINT[value]}
      </span>
    </div>
  );
}

function dueBadge(due?: string): { cls: string; label: string } | null {
  if (!due) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = new Date(`${due}T00:00:00`);
  const diff = Math.ceil((d.getTime() - now.getTime()) / 86_400_000);

  if (diff < 0) {
    return {
      cls: "border-rose-500/30 bg-rose-500/10 text-rose-300",
      label: `просрочено ${-diff} д.`,
    };
  }
  if (diff === 0) {
    return {
      cls: "border-amber-500/30 bg-amber-500/10 text-amber-300",
      label: "сегодня",
    };
  }
  if (diff === 1) {
    return {
      cls: "border-amber-500/20 bg-amber-500/5 text-amber-300",
      label: "завтра",
    };
  }
  if (diff <= 7) {
    return {
      cls: "border-zinc-700 bg-zinc-800/50 text-zinc-400",
      label: `${diff} д.`,
    };
  }

  return {
    cls: "border-zinc-800 bg-zinc-900/30 text-zinc-500",
    label: d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }),
  };
}

function inferComposerFactTone(project: Project | undefined): ScheduleTone {
  const label = `${project?.id ?? ""} ${project?.name ?? ""}`.toLowerCase();
  if (label.includes("kinderly")) return "kinderly";
  if (label.includes("heys")) return "heys";
  return "work";
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [filter, setFilter] = useState<TaskStatus | "all">("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [input, setInput] = useState("");
  const [prio, setPrio] = useState<"p1" | "p2" | "p3">("p2");
  const [dueDate, setDueDate] = useState("");
  const [newTaskProjectId, setNewTaskProjectId] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    setTasks(getTasks());
    setProjects(getProjects());
  }, []);

  useEffect(() => {
    reload();
    return subscribeAppDataChange((keys) => {
      if (keys.includes("alphacore_tasks") || keys.includes("alphacore_projects")) {
        reload();
      }
    });
  }, [reload]);

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  const getTaskProjectLabel = useCallback(
    (task: Task) => {
      if (task.projectId) {
        return projectNameById.get(task.projectId) ?? task.project;
      }
      return task.project;
    },
    [projectNameById],
  );

  const getTaskProjectId = useCallback(
    (task: Task) => {
      if (task.projectId) return task.projectId;
      const match = projects.find((project) => project.name === task.project);
      return match?.id ?? "";
    },
    [projects],
  );

  const matchesProjectFilter = useCallback(
    (task: Task) => {
      const label = getTaskProjectLabel(task);
      if (projectFilter === "all") return true;
      if (projectFilter === "none") return !label;
      return task.projectId === projectFilter || label === projectNameById.get(projectFilter);
    },
    [getTaskProjectLabel, projectFilter, projectNameById],
  );

  const resetComposer = useCallback(() => {
    setInput("");
    setPrio("p2");
    setDueDate("");
    setNewTaskProjectId("");
  }, []);

  const handleAdd = useCallback((mode: "planned" | "done" = "planned") => {
    const title = input.trim();
    if (!title) return;

    const project = getProjects().find((item) => item.id === newTaskProjectId);
    const isQuickDone = mode === "done";

    if (isQuickDone) {
      addCompletedFactSlot({
        title,
        priority: prio,
        projectId: project?.id,
        project: project?.name,
        tone: inferComposerFactTone(project),
      });
    } else {
      addTask(title, {
        priority: prio,
        dueDate: dueDate || undefined,
        projectId: project?.id,
        project: project?.name,
      });
    }

    resetComposer();
    reload();
    inputRef.current?.focus();
  }, [dueDate, input, newTaskProjectId, prio, reload, resetComposer]);

  const handleSetDue = useCallback(
    (id: string, date: string) => {
      updateTask(id, { dueDate: date || undefined });
      reload();
    },
    [reload],
  );

  const handleSetProject = useCallback(
    (id: string, projectId: string) => {
      const project = getProjects().find((item) => item.id === projectId);
      updateTask(id, {
        projectId: project?.id,
        project: project?.name,
      });
      reload();
    },
    [reload],
  );

  const handleSetPriority = useCallback(
    (id: string, priority: Task["priority"]) => {
      updateTask(id, { priority });
      reload();
    },
    [reload],
  );

  const handleToggle = useCallback(
    (id: string) => {
      toggleDone(id);
      reload();
    },
    [reload],
  );

  const handleActivate = useCallback(
    (id: string) => {
      activateTask(id);
      reload();
    },
    [reload],
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteTask(id);
      reload();
    },
    [reload],
  );

  const visible = tasks.filter(
    (task) => (filter === "all" || task.status === filter) && matchesProjectFilter(task),
  );

  const visibleGroups = useMemo(() => {
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const projectByName = new Map(
      projects.map((project) => [project.name.trim().toLowerCase(), project]),
    );
    const groups = new Map<string, TaskGroup>();

    for (const task of visible) {
      const projectLabel = getTaskProjectLabel(task)?.trim();
      const resolvedProject = task.projectId
        ? projectById.get(task.projectId) ?? (projectLabel ? projectByName.get(projectLabel.toLowerCase()) ?? null : null)
        : projectLabel
          ? projectByName.get(projectLabel.toLowerCase()) ?? null
          : null;
      const groupLabel = projectLabel || "Без проекта";
      const groupKey = resolvedProject
        ? `project:${resolvedProject.id}`
        : projectLabel
          ? `label:${normalizeGroupKey(groupLabel)}`
          : "unassigned";

      const existing = groups.get(groupKey) ?? {
        id: groupKey,
        label: groupLabel,
        project: resolvedProject,
        area: projectLabel ? inferGroupArea(projectLabel) : null,
        tasks: [],
        priorityLoad: 0,
        priorityCounts: { p1: 0, p2: 0, p3: 0 },
        openCount: 0,
        doneCount: 0,
        overdueCount: 0,
        focusSessions: 0,
        focusMinutes: 0,
      } satisfies TaskGroup;

      existing.tasks.push(task);

      if (task.status === "active" || task.status === "inbox") {
        existing.openCount += 1;
        existing.priorityCounts[task.priority] += 1;
        existing.priorityLoad += PRIORITY_LOAD_WEIGHT[task.priority];

        const dueOffset = getDueOffset(task.dueDate);
        if (dueOffset != null && dueOffset < 0) {
          existing.overdueCount += 1;
        }
      }

      if (task.status === "done") {
        existing.doneCount += 1;
      }

      const focus = getTaskFocusTotal(task);
      existing.focusSessions += focus.sessions;
      existing.focusMinutes += focus.minutes;

      groups.set(groupKey, existing);
    }

    return [...groups.values()]
      .map((group) => ({
        ...group,
        tasks: [...group.tasks].sort((left, right) => compareTasksByAttention(left, right)),
      }))
      .sort((left, right) => {
        const leftOrder = left.project?.order ?? (left.area ? 100 + AREA_GROUP_ORDER[left.area] : 999);
        const rightOrder = right.project?.order ?? (right.area ? 100 + AREA_GROUP_ORDER[right.area] : 999);

        return (
          right.priorityLoad - left.priorityLoad ||
          right.priorityCounts.p1 - left.priorityCounts.p1 ||
          right.priorityCounts.p2 - left.priorityCounts.p2 ||
          right.overdueCount - left.overdueCount ||
          right.openCount - left.openCount ||
          leftOrder - rightOrder ||
          left.label.localeCompare(right.label, "ru")
        );
      });
  }, [getTaskProjectLabel, projects, visible]);

  const counts: Record<TaskStatus | "all", number> = {
    all: tasks.length,
    inbox: tasks.filter((task) => task.status === "inbox").length,
    active: tasks.filter((task) => task.status === "active").length,
    done: tasks.filter((task) => task.status === "done").length,
    archived: tasks.filter((task) => task.status === "archived").length,
  };

  return (
    <AppShell>
      <div className="space-y-5 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">📥 Задачи</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Группы сами поднимаются выше, когда внутри накапливается тяжёлый приоритет.
            </p>
          </div>
          {projectFilter !== "all" && (
            <button
              type="button"
              onClick={() => setProjectFilter("all")}
              className="rounded-xl border border-zinc-800 px-3 py-2 text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
            >
              Сбросить фильтр
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && handleAdd()}
            placeholder="Новая задача…"
            className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-600"
          />
          <ProjectSelectManager
            value={newTaskProjectId}
            projects={projects}
            onChange={setNewTaskProjectId}
            onProjectsMutate={(projectId) => {
              reload();
              setNewTaskProjectId(projectId);
            }}
            creationContextLabel="выбора проекта в задаче"
            suggestedAccent="violet"
            size="md"
          />
          <PrioritySwitch value={prio} onChange={(priority) => setPrio(priority)} size="md" />
          <input
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            className="scheme-dark rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-3 text-xs text-zinc-300 outline-none"
          />
          <button
            type="button"
            onClick={() => handleAdd()}
            className="rounded-xl bg-zinc-50 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200"
            title="Добавить задачу в список"
            aria-label="Добавить задачу в список"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => handleAdd("done")}
            className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-200 transition hover:border-amber-400/40 hover:bg-amber-500/15"
            title="Зафиксировать как завершённый слот на текущее время — дата не учитывается"
            aria-label="Добавить сразу в выполненные"
          >
            +⚡
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1.5 overflow-x-auto">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  filter === item.key
                    ? "bg-zinc-50 text-zinc-950"
                    : "border border-zinc-800 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {item.label}
                <span className="ml-1.5 text-[10px] opacity-60">{counts[item.key]}</span>
              </button>
            ))}
          </div>

          <select
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
            className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-300 outline-none"
          >
            <option value="all">Все проекты</option>
            <option value="none">Без проекта</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-3">
          {visible.length === 0 && (
            <p className="py-8 text-center text-sm text-zinc-600">
              {filter === "all" && projectFilter === "all"
                ? "Нет задач. Добавь первую ↑"
                : "Пусто в текущем фильтре"}
            </p>
          )}

          {visibleGroups.map((group) => {
            const tone = getGroupShellTone(group);

            return (
              <section
                key={group.id}
                className={`rounded-[1.75rem] border p-4 shadow-2xl shadow-black/10 ${tone.shellCls}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${tone.dotCls}`} />
                      <h2 className="text-base font-semibold text-zinc-100">{group.label}</h2>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone.badgeCls}`}>
                        {group.tasks.length} {pluralizeTasks(group.tasks.length)}
                      </span>
                      {group.priorityLoad > 0 && (
                        <span className="rounded-full border border-zinc-700/70 bg-zinc-950/50 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
                          вес {group.priorityLoad}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-zinc-400">{formatGroupSummary(group)}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {(["p1", "p2", "p3"] as const).map((priority) =>
                      group.priorityCounts[priority] > 0 ? (
                        <span
                          key={priority}
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${PRIO_CLS[priority]}`}
                        >
                          {priority.toUpperCase()} × {group.priorityCounts[priority]}
                        </span>
                      ) : null,
                    )}
                    {group.focusSessions > 0 && (
                      <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                        🍅 {group.focusSessions} · {group.focusMinutes}м
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {group.tasks.map((task) => (
                    <div
                      key={task.id}
                      className={`flex items-start gap-3 rounded-2xl border px-4 py-3 transition ${
                        task.status === "done"
                          ? "border-zinc-800/50 bg-zinc-950/20"
                          : "border-zinc-800/70 bg-zinc-950/35"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleToggle(task.id)}
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                          task.status === "done"
                            ? "border-emerald-400 bg-emerald-400 text-zinc-950"
                            : "border-zinc-600 hover:border-zinc-400"
                        }`}
                      >
                        {task.status === "done" && (
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path
                              d="M2 6L5 9L10 3"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </button>

                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-sm ${
                            task.status === "done"
                              ? "text-zinc-500 line-through"
                              : "text-zinc-100"
                          }`}
                        >
                          {task.title}
                        </p>

                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <span
                            className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${PRIO_CLS[task.priority]}`}
                          >
                            {task.priority.toUpperCase()}
                          </span>
                          <span
                            className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${STATUS_CLS[task.status]}`}
                          >
                            {task.status}
                          </span>
                          {(() => {
                            const badge = dueBadge(task.dueDate);
                            return badge ? (
                              <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>
                                📅 {badge.label}
                              </span>
                            ) : null;
                          })()}
                          {(() => {
                            const focus = getTaskFocusTotal(task);
                            return focus.sessions > 0 ? (
                              <span className="rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                                🍅 {focus.sessions} · {focus.minutes}м
                              </span>
                            ) : null;
                          })()}
                        </div>

                        {task.status !== "done" && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <input
                              type="date"
                              value={task.dueDate ?? ""}
                              onChange={(event) => handleSetDue(task.id, event.target.value)}
                              className="scheme-dark rounded-lg border border-zinc-800 bg-zinc-900/50 px-2 py-1 text-[10px] text-zinc-500 outline-none"
                            />
                            <ProjectSelectManager
                              value={getTaskProjectId(task)}
                              projects={projects}
                              onChange={(projectId) => handleSetProject(task.id, projectId)}
                              onProjectsMutate={() => reload()}
                              creationContextLabel="редактирования задачи"
                              suggestedAccent="violet"
                              size="sm"
                            />
                            <PrioritySwitch
                              value={task.priority}
                              onChange={(priority) => handleSetPriority(task.id, priority)}
                              size="sm"
                            />
                          </div>
                        )}
                      </div>

                      <div className="flex shrink-0 gap-1">
                        {task.status === "inbox" && (
                          <button
                            type="button"
                            onClick={() => handleActivate(task.id)}
                            className="rounded-lg border border-emerald-500/20 px-2 py-1 text-[10px] text-emerald-400 transition hover:bg-emerald-500/10"
                            title="В работу"
                          >
                            ▶
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDelete(task.id)}
                          className="rounded-lg border border-rose-500/20 px-2 py-1 text-[10px] text-rose-400 transition hover:bg-rose-500/10"
                          title="Удалить"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
