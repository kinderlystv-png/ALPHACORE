"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { ProjectSelectManager } from "@/components/project-select-manager";
import { type Project, getProjects } from "@/lib/projects";
import { subscribeAppDataChange } from "@/lib/storage";
import {
  type Task,
  type TaskStatus,
  activateTask,
  addTask,
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

  const handleAdd = useCallback(() => {
    const title = input.trim();
    if (!title) return;

    const project = getProjects().find((item) => item.id === newTaskProjectId);

    addTask(title, {
      priority: prio,
      dueDate: dueDate || undefined,
      projectId: project?.id,
      project: project?.name,
    });

    setInput("");
    setPrio("p2");
    setDueDate("");
    setNewTaskProjectId("");
    reload();
    inputRef.current?.focus();
  }, [dueDate, input, newTaskProjectId, prio, projects, reload]);

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
              Фильтр по проектам и привязка задач прямо из списка.
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
          <select
            value={prio}
            onChange={(event) => setPrio(event.target.value as "p1" | "p2" | "p3")}
            className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-3 text-xs text-zinc-300 outline-none"
          >
            <option value="p1">P1</option>
            <option value="p2">P2</option>
            <option value="p3">P3</option>
          </select>
          <input
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            className="scheme-dark rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-3 text-xs text-zinc-300 outline-none"
          />
          <button
            type="button"
            onClick={handleAdd}
            className="rounded-xl bg-zinc-50 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200"
          >
            +
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

        <div className="space-y-2">
          {visible.length === 0 && (
            <p className="py-8 text-center text-sm text-zinc-600">
              {filter === "all" && projectFilter === "all"
                ? "Нет задач. Добавь первую ↑"
                : "Пусто в текущем фильтре"}
            </p>
          )}

          {visible.map((task) => {
            const projectLabel = getTaskProjectLabel(task);

            return (
              <div
                key={task.id}
                className={`flex items-start gap-3 rounded-xl border px-4 py-3 transition ${
                  task.status === "done"
                    ? "border-zinc-800/50 bg-zinc-900/20"
                    : "border-zinc-800/70 bg-zinc-900/40"
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
                    {projectLabel && (
                      <span className="rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">
                        {projectLabel}
                      </span>
                    )}
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
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
