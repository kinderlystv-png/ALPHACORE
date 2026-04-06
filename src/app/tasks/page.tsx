"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { ProjectSelectManager } from "@/components/project-select-manager";
import { TaskGanttChart, type GanttDependencyLink, type GanttGroup, type GanttScheduledSlot, type GanttTaskProgress } from "@/components/task-gantt-chart";
import { readTaskDragId, writeTaskDragData } from "@/lib/dashboard-events";
import { AREA_COLOR, type LifeArea } from "@/lib/life-areas";
import {
  PROJECT_ACCENT_CLS,
  getProjectDisplayName,
  type Project,
  type ProjectAccent,
  getProjects,
} from "@/lib/projects";
import {
  addCompletedFactSlot,
  deleteTaskWithScheduledSlot,
  getCustomEvents,
  getScheduledTaskSlot,
  updateCustomEvent,
  type ScheduleTone,
} from "@/lib/schedule";
import { lsGet, lsSet, subscribeAppDataChange } from "@/lib/storage";
import {
  type Task,
  type TaskStatus,
  activateTask,
  assignTaskParent,
  addTask,
  canAssignTaskParent,
  compareTasksByAttention,
  getTaskTimelineSnapshot,
  getTaskFocusTotal,
  getTasks,
  moveTaskTreeToProject,
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
  nonDoneRootTasks: TaskTreeNode[];
  doneRootTasks: TaskTreeNode[];
  priorityLoad: number;
  priorityCounts: Record<Task["priority"], number>;
  openCount: number;
  doneCount: number;
  overdueCount: number;
  focusSessions: number;
  focusMinutes: number;
};

type TaskTreeNode = {
  task: Task;
  children: TaskTreeNode[];
  depth: number;
  descendantCount: number;
};

type PrioritySwitchProps = {
  value: Task["priority"];
  onChange: (priority: Task["priority"]) => void;
  size?: "sm" | "md";
};

type QuickProjectFilterBarProps = {
  value: string;
  projects: Project[];
  quickProjects: Project[];
  onChange: (value: string) => void;
};

type QuickEffortOption = {
  label: string;
  shortLabel: string;
  minutes: number;
};

type QuickEffortPickerProps = {
  value: number | null;
  onChange: (minutes: number | null) => void;
  size?: "sm" | "md";
};

type TaskComposerModalState = {
  kind: "subtask" | "group";
  heading: string;
  subtitle: string;
  parentTaskId?: string;
  projectId: string;
  fallbackProjectLabel?: string;
  defaultStatus: "inbox" | "active";
  initialPriority: Task["priority"];
};

const QUICK_EFFORT_OPTIONS: QuickEffortOption[] = [
  { label: "15 мин", shortLabel: "15м", minutes: 15 },
  { label: "30 мин", shortLabel: "30м", minutes: 30 },
  { label: "1 час", shortLabel: "1ч", minutes: 60 },
  { label: "3 часа", shortLabel: "3ч", minutes: 180 },
  { label: "8 часов", shortLabel: "8ч", minutes: 480 },
  { label: "2 дня", shortLabel: "2д", minutes: 960 },
  { label: "3 дня", shortLabel: "3д", minutes: 1440 },
  { label: "5 дней", shortLabel: "5д", minutes: 2400 },
  { label: "Неделя", shortLabel: "1н", minutes: 3360 },
  { label: "2 недели", shortLabel: "2н", minutes: 6720 },
  { label: "Месяц", shortLabel: "1мес", minutes: 14400 },
];

const QUICK_EFFORT_LABEL_BY_MINUTES = new Map(
  QUICK_EFFORT_OPTIONS.map((option) => [option.minutes, option]),
);
const TASKS_GANTT_EXPANDED_KEY = "alphacore_tasks_gantt_expanded_v1";

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

function formatPlannedMinutesLabel(
  minutes?: number,
  mode: "full" | "short" = "full",
): string | null {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return null;

  const preset = QUICK_EFFORT_LABEL_BY_MINUTES.get(minutes);
  if (preset) return mode === "short" ? preset.shortLabel : preset.label;

  if (minutes < 60) return mode === "short" ? `${minutes}м` : `${minutes} мин`;

  if (minutes % (8 * 60) === 0) {
    const days = minutes / (8 * 60);
    return mode === "short" ? `${days}д` : `${days} д`;
  }

  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return mode === "short" ? `${hours}ч` : `${hours} ч`;
  }

  return mode === "short" ? `${Math.round(minutes / 60)}ч` : `${Math.round(minutes / 60)} ч`;
}

function buildTaskTree(tasks: Task[]): TaskTreeNode[] {
  const visibleTaskIds = new Set(tasks.map((task) => task.id));
  const childrenByParentId = new Map<string, Task[]>();

  for (const task of tasks) {
    if (!task.parentTaskId || !visibleTaskIds.has(task.parentTaskId)) continue;

    const children = childrenByParentId.get(task.parentTaskId) ?? [];
    children.push(task);
    childrenByParentId.set(task.parentTaskId, children);
  }

  for (const children of childrenByParentId.values()) {
    children.sort((left, right) => compareTasksByAttention(left, right));
  }

  const buildNode = (task: Task, depth = 0): TaskTreeNode => {
    const childNodes = (childrenByParentId.get(task.id) ?? []).map((child) => buildNode(child, depth + 1));
    const descendantCount = childNodes.reduce((sum, child) => sum + 1 + child.descendantCount, 0);

    return {
      task,
      children: childNodes,
      depth,
      descendantCount,
    };
  };

  return tasks
    .filter((task) => !task.parentTaskId || !visibleTaskIds.has(task.parentTaskId))
    .sort((left, right) => compareTasksByAttention(left, right))
    .map((task) => buildNode(task));
}

function buildTaskProgressMap(tasks: Task[]): Record<string, GanttTaskProgress> {
  const visibleTaskIds = new Set(tasks.map((task) => task.id));
  const childrenByParentId = new Map<string, Task[]>();

  for (const task of tasks) {
    if (!task.parentTaskId || !visibleTaskIds.has(task.parentTaskId)) continue;

    const children = childrenByParentId.get(task.parentTaskId) ?? [];
    children.push(task);
    childrenByParentId.set(task.parentTaskId, children);
  }

  const cache = new Map<string, { done: number; total: number }>();
  const progressByTaskId: Record<string, GanttTaskProgress> = {};

  const collect = (taskId: string): { done: number; total: number } => {
    const cached = cache.get(taskId);
    if (cached) return cached;

    let done = 0;
    let total = 0;

    for (const child of childrenByParentId.get(taskId) ?? []) {
      total += 1;
      if (child.status === "done") done += 1;

      const nested = collect(child.id);
      total += nested.total;
      done += nested.done;
    }

    const aggregated = { done, total };
    cache.set(taskId, aggregated);

    if (total > 0) {
      progressByTaskId[taskId] = {
        done,
        total,
        ratio: done / total,
      };
    }

    return aggregated;
  };

  for (const task of tasks) {
    collect(task.id);
  }

  return progressByTaskId;
}

function buildTaskDescendantsMap(tasks: Task[]): Map<string, Set<string>> {
  const childrenByParentId = new Map<string, string[]>();

  for (const task of tasks) {
    if (!task.parentTaskId) continue;
    const children = childrenByParentId.get(task.parentTaskId) ?? [];
    children.push(task.id);
    childrenByParentId.set(task.parentTaskId, children);
  }

  const cache = new Map<string, Set<string>>();

  const collect = (taskId: string): Set<string> => {
    const cached = cache.get(taskId);
    if (cached) return cached;

    const descendants = new Set<string>();

    for (const childId of childrenByParentId.get(taskId) ?? []) {
      descendants.add(childId);
      for (const nestedId of collect(childId)) {
        descendants.add(nestedId);
      }
    }

    cache.set(taskId, descendants);
    return descendants;
  };

  for (const task of tasks) {
    collect(task.id);
  }

  return cache;
}

function buildTaskBlockerMap(tasks: Task[]): Map<string, string[]> {
  return new Map(tasks.map((task) => [task.id, task.blockedByTaskIds ?? []]));
}

function hasTaskDependencyPath(
  blockerMap: Map<string, string[]>,
  currentId: string,
  targetId: string,
  seen: Set<string> = new Set(),
): boolean {
  if (currentId === targetId) return true;
  if (seen.has(currentId)) return false;

  seen.add(currentId);
  return (blockerMap.get(currentId) ?? []).some((nextId) =>
    hasTaskDependencyPath(blockerMap, nextId, targetId, seen),
  );
}

function buildDependencyCandidatesByTaskId(
  groups: TaskGroup[],
  tasks: Task[],
): Record<string, Task[]> {
  const descendantsByTaskId = buildTaskDescendantsMap(tasks);
  const blockerMap = buildTaskBlockerMap(tasks);
  const result: Record<string, Task[]> = {};

  for (const group of groups) {
    const actionableTasks = group.tasks.filter((task) => task.status !== "done");

    for (const task of actionableTasks) {
      const descendants = descendantsByTaskId.get(task.id) ?? new Set<string>();
      const currentBlockers = new Set(task.blockedByTaskIds ?? []);

      result[task.id] = actionableTasks
        .filter(
          (candidate) =>
            candidate.id !== task.id
            && !descendants.has(candidate.id)
            && !currentBlockers.has(candidate.id)
            && !hasTaskDependencyPath(blockerMap, candidate.id, task.id),
        )
        .sort((left, right) => compareTasksByAttention(left, right));
    }
  }

  return result;
}

function willTaskPlanChange(
  task: Task,
  patch: Partial<Pick<Task, "startDate" | "dueDate" | "plannedMinutes">>,
): boolean {
  const nextStartDate = Object.prototype.hasOwnProperty.call(patch, "startDate")
    ? patch.startDate
    : task.startDate;
  const nextDueDate = Object.prototype.hasOwnProperty.call(patch, "dueDate")
    ? patch.dueDate
    : task.dueDate;
  const nextPlannedMinutes = Object.prototype.hasOwnProperty.call(patch, "plannedMinutes")
    ? patch.plannedMinutes
    : task.plannedMinutes;

  return (
    nextStartDate !== task.startDate
    || nextDueDate !== task.dueDate
    || nextPlannedMinutes !== task.plannedMinutes
  );
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

function QuickProjectFilterBar({
  value,
  projects,
  quickProjects,
  onChange,
}: QuickProjectFilterBarProps) {
  const [showAll, setShowAll] = useState(false);
  const projectLabelById = useMemo(
    () =>
      new Map(
        projects.map((project) => [project.id, getProjectDisplayName(project, projects)]),
      ),
    [projects],
  );

  const visibleQuickProjects = useMemo(() => {
    const seen = new Set<string>();
    const shortlist = quickProjects.filter((project) => {
      if (seen.has(project.id)) return false;
      seen.add(project.id);
      return true;
    });

    const selectedProject = projects.find((project) => project.id === value);
    if (selectedProject && !seen.has(selectedProject.id)) {
      shortlist.push(selectedProject);
    }

    return shortlist;
  }, [projects, quickProjects, value]);

  const hasExtraProjects = projects.length > visibleQuickProjects.length;
  const baseBtnCls =
    "rounded-xl border px-3 py-2 text-xs transition";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onChange("all")}
          aria-pressed={value === "all"}
          className={`${baseBtnCls} ${
            value === "all"
              ? "border-zinc-100 bg-zinc-100 text-zinc-950"
              : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100"
          }`}
        >
          Все группы
        </button>

        <button
          type="button"
          onClick={() => onChange("none")}
          aria-pressed={value === "none"}
          className={`${baseBtnCls} ${
            value === "none"
              ? "border-zinc-100 bg-zinc-100 text-zinc-950"
              : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100"
          }`}
        >
          Без группы
        </button>

        {visibleQuickProjects.map((project) => {
          const isActive = value === project.id;
          const label = projectLabelById.get(project.id) ?? project.name;

          return (
            <button
              key={project.id}
              type="button"
              onClick={() => onChange(project.id)}
              aria-pressed={isActive}
              title={label}
              className={`flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs transition ${
                isActive
                  ? "border-zinc-100 bg-zinc-100 text-zinc-950"
                  : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100"
              }`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${PROJECT_DOT_CLS[project.accent]}`} />
              <span className="truncate">{label}</span>
            </button>
          );
        })}

        {hasExtraProjects && (
          <button
            type="button"
            onClick={() => setShowAll((current) => !current)}
            aria-expanded={showAll}
            className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100"
          >
            {showAll ? "Скрыть список" : "Все"}
          </button>
        )}
      </div>

      {hasExtraProjects && showAll && (
        <div className="flex flex-wrap gap-2 rounded-2xl border border-zinc-800/70 bg-zinc-950/30 p-2.5">
          {projects.map((project) => {
            const isActive = value === project.id;
            const label = projectLabelById.get(project.id) ?? project.name;

            return (
              <button
                key={project.id}
                type="button"
                onClick={() => {
                  onChange(project.id);
                  setShowAll(false);
                }}
                aria-pressed={isActive}
                title={label}
                className={`flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs transition ${
                  isActive
                    ? "border-zinc-100 bg-zinc-100 text-zinc-950"
                    : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100"
                }`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${PROJECT_DOT_CLS[project.accent]}`} />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>
      )}
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

function startBadge(startDate?: string, dueDate?: string): { cls: string; label: string } | null {
  if (!startDate) return null;

  const start = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;

  const sameAsDue = Boolean(dueDate && dueDate === startDate);

  return {
    cls: sameAsDue
      ? "border-sky-500/15 bg-sky-500/8 text-sky-200"
      : "border-sky-500/25 bg-sky-500/10 text-sky-200",
    label: `старт ${start.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}`,
  };
}

function inferComposerFactTone(project: Project | undefined): ScheduleTone {
  const label = `${project?.id ?? ""} ${project?.name ?? ""}`.toLowerCase();
  if (label.includes("kinderly")) return "kinderly";
  if (label.includes("heys")) return "heys";
  return "work";
}

function toInputDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function quickDueButtonCls(isActive: boolean, size: "sm" | "md"): string {
  if (size === "md") {
    return isActive
      ? "whitespace-nowrap rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-xs font-medium text-amber-200 transition"
      : "whitespace-nowrap rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-3 text-xs font-medium text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100";
  }

  return isActive
    ? "whitespace-nowrap rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-1 text-[10px] font-medium text-amber-200 transition"
    : "whitespace-nowrap rounded-md border border-zinc-800 bg-zinc-900/40 px-1.5 py-1 text-[10px] font-medium text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100";
}

function QuickEffortPicker({ value, onChange, size = "md" }: QuickEffortPickerProps) {
  const buttonCls = size === "sm"
    ? "rounded-md px-1.5 py-0.5 text-[10px]"
    : "rounded-lg px-2.5 py-1.5 text-[11px]";
  const containerCls = size === "sm" ? "gap-0.5 pb-0" : "gap-1 pb-1";

  return (
    <div className="min-w-0 overflow-x-auto">
      <div className={`flex min-w-max items-center ${containerCls}`}>
        {QUICK_EFFORT_OPTIONS.map((option) => {
          const isActive = value === option.minutes;

          return (
            <button
              key={`${option.label}-${option.minutes}`}
              type="button"
              onClick={() => onChange(isActive ? null : option.minutes)}
              aria-pressed={isActive}
              className={`whitespace-nowrap border font-medium transition ${buttonCls} ${
                isActive
                  ? "border-violet-400/30 bg-violet-500/12 text-violet-100"
                  : "border-zinc-800 bg-zinc-900/35 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
              }`}
            >
              {size === "sm" ? option.shortLabel : option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [filter, setFilter] = useState<TaskStatus | "all">("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [input, setInput] = useState("");
  const [prio, setPrio] = useState<"p1" | "p2" | "p3">("p2");
  const [dueDate, setDueDate] = useState("");
  const [plannedMinutes, setPlannedMinutes] = useState<number | null>(null);
  const [newTaskProjectId, setNewTaskProjectId] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedCompletedGroups, setExpandedCompletedGroups] = useState<Set<string>>(new Set());
  const [ganttExpanded, setGanttExpanded] = useState<boolean>(() => lsGet<boolean>(TASKS_GANTT_EXPANDED_KEY, true));
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [nestDropTargetId, setNestDropTargetId] = useState<string | null>(null);
  const [taskComposerModal, setTaskComposerModal] = useState<TaskComposerModalState | null>(null);
  const [taskComposerTitle, setTaskComposerTitle] = useState("");
  const [taskComposerPrio, setTaskComposerPrio] = useState<Task["priority"]>("p2");
  const [taskComposerDueDate, setTaskComposerDueDate] = useState("");
  const [taskComposerPlannedMinutes, setTaskComposerPlannedMinutes] = useState<number | null>(null);
  const [taskComposerProjectId, setTaskComposerProjectId] = useState("");
  const [taskComposerProjectTouched, setTaskComposerProjectTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const composerModalInputRef = useRef<HTMLInputElement>(null);

  const TASKS_PER_GROUP = 15;

  const reload = useCallback(() => {
    setTasks(getTasks());
    setProjects(getProjects());
  }, []);

  useEffect(() => {
    reload();
    return subscribeAppDataChange((keys) => {
      if (
        keys.includes("alphacore_tasks")
        || keys.includes("alphacore_projects")
        || keys.includes("alphacore_schedule_custom")
      ) {
        reload();
      }
    });
  }, [reload]);

  useEffect(() => {
    lsSet(TASKS_GANTT_EXPANDED_KEY, ganttExpanded);
  }, [ganttExpanded]);

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const taskById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  );
  const projectDisplayNameById = useMemo(
    () =>
      new Map(
        projects.map((project) => [project.id, getProjectDisplayName(project, projects)]),
      ),
    [projects],
  );

  const getTaskProjectLabel = useCallback(
    (task: Task) => {
      if (task.projectId) {
        return projectDisplayNameById.get(task.projectId) ?? projectNameById.get(task.projectId) ?? task.project;
      }
      return task.project;
    },
    [projectDisplayNameById, projectNameById],
  );

  const getTaskProjectId = useCallback(
    (task: Task) => {
      if (task.projectId) return task.projectId;
      const match = projects.find((project) => project.name === task.project);
      return match?.id ?? "";
    },
    [projects],
  );

  const popularProjects = useMemo(() => {
    const usage = new Map<string, { total: number; open: number; priorityLoad: number }>();

    for (const project of projects) {
      usage.set(project.id, { total: 0, open: 0, priorityLoad: 0 });
    }

    for (const task of tasks) {
      const projectId = getTaskProjectId(task);
      if (!projectId) continue;

      const stats = usage.get(projectId);
      if (!stats) continue;

      stats.total += 1;
      stats.priorityLoad += PRIORITY_LOAD_WEIGHT[task.priority];

      if (task.status === "inbox" || task.status === "active") {
        stats.open += 1;
      }
    }

    return [...projects]
      .sort((left, right) => {
        const leftUsage = usage.get(left.id) ?? { total: 0, open: 0, priorityLoad: 0 };
        const rightUsage = usage.get(right.id) ?? { total: 0, open: 0, priorityLoad: 0 };

        return (
          rightUsage.open - leftUsage.open ||
          rightUsage.total - leftUsage.total ||
          rightUsage.priorityLoad - leftUsage.priorityLoad ||
          left.order - right.order ||
          left.name.localeCompare(right.name, "ru")
        );
      })
      .slice(0, 4);
  }, [getTaskProjectId, projects, tasks]);

  const todayDateValue = useMemo(() => toInputDateValue(new Date()), []);
  const tomorrowDateValue = useMemo(() => {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    return toInputDateValue(next);
  }, []);

  const closeTaskComposerModal = useCallback(() => {
    setTaskComposerModal(null);
    setTaskComposerTitle("");
    setTaskComposerPrio("p2");
    setTaskComposerDueDate("");
    setTaskComposerPlannedMinutes(null);
    setTaskComposerProjectId("");
    setTaskComposerProjectTouched(false);
  }, []);

  const openTaskComposerModal = useCallback((config: TaskComposerModalState) => {
    setTaskComposerModal(config);
    setTaskComposerTitle("");
    setTaskComposerPrio(config.initialPriority);
    setTaskComposerDueDate("");
    setTaskComposerPlannedMinutes(null);
    setTaskComposerProjectId(config.projectId);
    setTaskComposerProjectTouched(false);
  }, []);

  useEffect(() => {
    if (!taskComposerModal) return;

    const frame = window.requestAnimationFrame(() => {
      composerModalInputRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeTaskComposerModal();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeTaskComposerModal, taskComposerModal]);

  const matchesProjectFilter = useCallback(
    (task: Task) => {
      const label = getTaskProjectLabel(task);
      if (projectFilter === "all") return true;
      if (projectFilter === "none") return !label;
      return (
        task.projectId === projectFilter ||
        label === projectDisplayNameById.get(projectFilter) ||
        label === projectNameById.get(projectFilter)
      );
    },
    [getTaskProjectLabel, projectDisplayNameById, projectFilter, projectNameById],
  );

  const handleTaskComposerProjectChange = useCallback((projectId: string) => {
    setTaskComposerProjectTouched(true);
    setTaskComposerProjectId(projectId);
  }, []);

  const resolveTaskComposerProject = useCallback((): { projectId?: string; project?: string } => {
    const selectedProject = projects.find((item) => item.id === taskComposerProjectId);

    if (selectedProject) {
      return {
        projectId: selectedProject.id,
        project: selectedProject.name,
      };
    }

    if (!taskComposerProjectTouched && taskComposerModal?.fallbackProjectLabel) {
      return {
        project: taskComposerModal.fallbackProjectLabel,
      };
    }

    return {};
  }, [projects, taskComposerModal, taskComposerProjectId, taskComposerProjectTouched]);

  const resetComposer = useCallback(() => {
    setInput("");
    setPrio("p2");
    setDueDate("");
    setPlannedMinutes(null);
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
        plannedMinutes: plannedMinutes ?? undefined,
        projectId: project?.id,
        project: project?.name,
      });
    }

    resetComposer();
    reload();
    inputRef.current?.focus();
  }, [dueDate, input, newTaskProjectId, plannedMinutes, prio, reload, resetComposer]);

  const handleCreateTaskFromModal = useCallback(
    (mode: "planned" | "done" = "planned") => {
      if (!taskComposerModal) return;

      const title = taskComposerTitle.trim();
      if (!title) return;

      addTask(title, {
        parentTaskId: taskComposerModal.parentTaskId,
        priority: taskComposerPrio,
        dueDate: taskComposerDueDate || undefined,
        plannedMinutes: taskComposerPlannedMinutes ?? undefined,
        status: mode === "done" ? "done" : taskComposerModal.defaultStatus,
        ...resolveTaskComposerProject(),
      });

      closeTaskComposerModal();
      reload();
    },
    [
      closeTaskComposerModal,
      reload,
      resolveTaskComposerProject,
      taskComposerDueDate,
      taskComposerModal,
      taskComposerPlannedMinutes,
      taskComposerPrio,
      taskComposerTitle,
    ],
  );

  const handleSetDue = useCallback(
    (id: string, date: string) => {
      const task = taskById.get(id);
      const patch: Partial<Task> = { dueDate: date || undefined };

      if (
        task
        && willTaskPlanChange(task, patch)
        && !task.baselineStartDate
        && !task.baselineDueDate
        && !task.baselinePlannedMinutes
      ) {
        const baseline = getTaskTimelineSnapshot(task);
        patch.baselineStartDate = baseline.startDate;
        patch.baselineDueDate = baseline.dueDate;
        patch.baselinePlannedMinutes = baseline.plannedMinutes;
      }

      updateTask(id, patch);
      reload();
    },
    [reload, taskById],
  );

  const handleSetRange = useCallback(
    (id: string, patch: { startDate?: string; dueDate?: string }) => {
      const task = taskById.get(id);
      const nextPatch: Partial<Task> = {
        ...(Object.prototype.hasOwnProperty.call(patch, "startDate") ? { startDate: patch.startDate || undefined } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "dueDate") ? { dueDate: patch.dueDate || undefined } : {}),
      };

      if (
        task
        && willTaskPlanChange(task, nextPatch)
        && !task.baselineStartDate
        && !task.baselineDueDate
        && !task.baselinePlannedMinutes
      ) {
        const baseline = getTaskTimelineSnapshot(task);
        nextPatch.baselineStartDate = baseline.startDate;
        nextPatch.baselineDueDate = baseline.dueDate;
        nextPatch.baselinePlannedMinutes = baseline.plannedMinutes;
      }

      updateTask(id, nextPatch);
      reload();
    },
    [reload, taskById],
  );

  const handleSetProject = useCallback(
    (id: string, projectId: string) => {
      const project = getProjects().find((item) => item.id === projectId);
      const updatedTasks = moveTaskTreeToProject(id, project?.id, project?.name);

      for (const task of updatedTasks) {
        const linkedSlot = getScheduledTaskSlot(task.id);
        if (!linkedSlot) continue;

        updateCustomEvent(linkedSlot.id, {
          projectId: task.projectId,
          project: task.project,
        });
      }

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

  const handleSetPlannedMinutes = useCallback(
    (id: string, minutes: number | null) => {
      const task = taskById.get(id);
      const patch: Partial<Task> = { plannedMinutes: minutes ?? undefined };

      if (
        task
        && willTaskPlanChange(task, patch)
        && !task.baselineStartDate
        && !task.baselineDueDate
        && !task.baselinePlannedMinutes
      ) {
        const baseline = getTaskTimelineSnapshot(task);
        patch.baselineStartDate = baseline.startDate;
        patch.baselineDueDate = baseline.dueDate;
        patch.baselinePlannedMinutes = baseline.plannedMinutes;
      }

      updateTask(id, patch);
      reload();
    },
    [reload, taskById],
  );

  const handleResetTaskBaseline = useCallback(
    (id: string) => {
      const task = taskById.get(id);
      if (!task) return;

      if (!task.baselineStartDate && !task.baselineDueDate && !task.baselinePlannedMinutes) {
        return;
      }

      updateTask(id, {
        startDate: task.baselineStartDate || undefined,
        dueDate: task.baselineDueDate || undefined,
        plannedMinutes: task.baselinePlannedMinutes ?? undefined,
      });
      reload();
    },
    [reload, taskById],
  );

  const handleRebaseTaskBaseline = useCallback(
    (id: string) => {
      const task = taskById.get(id);
      if (!task) return;

      const baseline = getTaskTimelineSnapshot(task);

      updateTask(id, {
        baselineStartDate: baseline.startDate,
        baselineDueDate: baseline.dueDate,
        baselinePlannedMinutes: baseline.plannedMinutes,
      });
      reload();
    },
    [reload, taskById],
  );

  const handleAddBlocker = useCallback(
    (taskId: string, blockerId: string) => {
      const task = taskById.get(taskId);
      if (!task) return;

      updateTask(taskId, {
        blockedByTaskIds: Array.from(new Set([...(task.blockedByTaskIds ?? []), blockerId])),
      });
      reload();
    },
    [reload, taskById],
  );

  const handleRemoveBlocker = useCallback(
    (taskId: string, blockerId: string) => {
      const task = taskById.get(taskId);
      if (!task) return;

      updateTask(taskId, {
        blockedByTaskIds: (task.blockedByTaskIds ?? []).filter((currentId) => currentId !== blockerId),
      });
      reload();
    },
    [reload, taskById],
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
      const shouldCloseTaskComposer = taskComposerModal?.kind === "subtask" && taskComposerModal.parentTaskId === id;

      deleteTaskWithScheduledSlot(id);

      if (shouldCloseTaskComposer) {
        closeTaskComposerModal();
      }

      reload();
    },
    [closeTaskComposerModal, reload, taskComposerModal],
  );

  const handleOpenSubtaskTaskModal = useCallback(
    (task: Task) => {
      const projectId = getTaskProjectId(task);
      const fallbackProjectLabel = projectId ? undefined : getTaskProjectLabel(task)?.trim();

      openTaskComposerModal({
        kind: "subtask",
        heading: "Новая подзадача",
        subtitle: `Внутри «${task.title}»`,
        parentTaskId: task.id,
        projectId,
        fallbackProjectLabel,
        defaultStatus: task.status === "active" ? "active" : "inbox",
        initialPriority: task.priority,
      });
    },
    [getTaskProjectId, getTaskProjectLabel, openTaskComposerModal],
  );

  const handleOpenGroupTaskModal = useCallback(
    (group: TaskGroup) => {
      const fallbackProjectLabel = group.project ? undefined : group.label === "Без группы" ? undefined : group.label;

      openTaskComposerModal({
        kind: "group",
        heading: group.project || fallbackProjectLabel ? "Новая задача в группе" : "Новая задача",
        subtitle: group.project
          ? `Сразу в «${group.label}»`
          : fallbackProjectLabel
            ? `Сразу в группе «${group.label}»`
            : "Без группы — можно оставить так или выбрать группу",
        projectId: group.project?.id ?? "",
        fallbackProjectLabel,
        defaultStatus: "inbox",
        initialPriority: "p2",
      });
    },
    [openTaskComposerModal],
  );

  const syncTaskTreeSlots = useCallback((updatedTasks: Task[]) => {
    for (const task of updatedTasks) {
      const linkedSlot = getScheduledTaskSlot(task.id);
      if (!linkedSlot) continue;

      updateCustomEvent(linkedSlot.id, {
        projectId: task.projectId,
        project: task.project,
      });
    }
  }, []);

  const handleDetachSubtask = useCallback(
    (taskId: string) => {
      const updatedTasks = assignTaskParent(taskId, null);
      syncTaskTreeSlots(updatedTasks);
      reload();
    },
    [reload, syncTaskTreeSlots],
  );

  const handleTaskDragStart = useCallback((event: React.DragEvent<HTMLElement>, taskId: string) => {
    writeTaskDragData(event.dataTransfer, taskId);
    event.dataTransfer.effectAllowed = "move";
    setDraggedTaskId(taskId);
    setNestDropTargetId(null);
  }, []);

  const handleTaskDragEnd = useCallback(() => {
    setDraggedTaskId(null);
    setNestDropTargetId(null);
  }, []);

  const handleTaskDragOver = useCallback(
    (event: React.DragEvent<HTMLElement>, targetTask: Task) => {
      const sourceTaskId = readTaskDragId(event.dataTransfer) ?? draggedTaskId;
      if (!sourceTaskId) return;
      if (targetTask.status === "done") return;
      if (!canAssignTaskParent(sourceTaskId, targetTask.id, tasks)) return;

      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setDraggedTaskId(sourceTaskId);
      setNestDropTargetId(targetTask.id);
    },
    [draggedTaskId, tasks],
  );

  const handleTaskDragLeave = useCallback((targetTaskId: string) => {
    setNestDropTargetId((current) => (current === targetTaskId ? null : current));
  }, []);

  const handleTaskDrop = useCallback(
    (event: React.DragEvent<HTMLElement>, targetTask: Task) => {
      const sourceTaskId = readTaskDragId(event.dataTransfer) ?? draggedTaskId;

      event.preventDefault();
      event.stopPropagation();
      setDraggedTaskId(null);
      setNestDropTargetId(null);

      if (!sourceTaskId) return;
      if (targetTask.status === "done") return;
      if (!canAssignTaskParent(sourceTaskId, targetTask.id, tasks)) return;

      const updatedTasks = assignTaskParent(sourceTaskId, targetTask.id);
      syncTaskTreeSlots(updatedTasks);
      reload();
    },
    [draggedTaskId, reload, syncTaskTreeSlots, tasks],
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
      const groupLabel = projectLabel || "Без группы";
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
        nonDoneRootTasks: [],
        doneRootTasks: [],
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
      .map((group) => {
        const sortedTasks = [...group.tasks].sort((left, right) => compareTasksByAttention(left, right));
        const nonDoneTasks = sortedTasks.filter((task) => task.status !== "done");
        const doneTasks = sortedTasks.filter((task) => task.status === "done");

        return {
          ...group,
          tasks: sortedTasks,
          nonDoneRootTasks: buildTaskTree(nonDoneTasks),
          doneRootTasks: buildTaskTree(doneTasks),
        };
      })
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

  const ganttGroups: GanttGroup[] = useMemo(
    () =>
      visibleGroups.map((group) => ({
        id: group.id,
        label: group.label,
        project: group.project,
        area: group.area,
        nodes: group.nonDoneRootTasks,
        openCount: group.openCount,
      })),
    [visibleGroups],
  );

  const ganttScheduledSlotsByTaskId = useMemo<Record<string, GanttScheduledSlot>>(() => {
    const visibleTaskIds = new Set(
      visible.filter((task) => task.status === "active" || task.status === "inbox").map((task) => task.id),
    );

    return getCustomEvents().reduce<Record<string, GanttScheduledSlot>>((acc, event) => {
      if (event.kind === "event") return acc;

      const taskId = event.taskId ?? undefined;
      if (!taskId || !visibleTaskIds.has(taskId)) return acc;

      acc[taskId] = {
        date: event.date,
        start: event.start,
        end: event.end,
        title: event.title,
        tone: event.tone,
      };
      return acc;
    }, {});
  }, [visible]);

  const ganttProgressByTaskId = useMemo<Record<string, GanttTaskProgress>>(() => {
    const tasksForProgress = tasks.filter((task) => matchesProjectFilter(task));
    return buildTaskProgressMap(tasksForProgress);
  }, [matchesProjectFilter, tasks]);

  const dependencyCandidatesByTaskId = useMemo<Record<string, Task[]>>(
    () => buildDependencyCandidatesByTaskId(visibleGroups, tasks),
    [tasks, visibleGroups],
  );

  const ganttDependencyLinks = useMemo<GanttDependencyLink[]>(() => {
    const visibleTaskIds = new Set(
      visible.filter((task) => task.status === "active" || task.status === "inbox").map((task) => task.id),
    );

    return visible.flatMap((task) =>
      (task.blockedByTaskIds ?? [])
        .filter((blockerId) => visibleTaskIds.has(blockerId))
        .map((blockerId) => ({
          fromTaskId: blockerId,
          toTaskId: task.id,
        })),
    );
  }, [visible]);

  function renderTaskNode(node: TaskTreeNode): React.ReactNode {
      const task = node.task;
      const badge = dueBadge(task.dueDate);
      const rangeBadge = startBadge(task.startDate, task.dueDate);
      const plannedLabel = formatPlannedMinutesLabel(task.plannedMinutes, "short");
      const focus = getTaskFocusTotal(task);
      const taskProjectId = getTaskProjectId(task);
      const showQuickProjects = task.status !== "done" && !taskProjectId;
      const showAssignedProjectTrigger = task.status !== "done" && !!taskProjectId;
      const isDropTarget = nestDropTargetId === task.id;
      const isSubtask = node.depth > 0;
      const activeDraggedTaskId = draggedTaskId ?? null;
      const canNestHere =
        activeDraggedTaskId != null &&
        task.status !== "done" &&
        canAssignTaskParent(activeDraggedTaskId, task.id, tasks);
      const blockerTasks = (task.blockedByTaskIds ?? [])
        .map((blockerId) => taskById.get(blockerId))
        .filter((blocker): blocker is Task => Boolean(blocker));
      const dependencyCandidates = dependencyCandidatesByTaskId[task.id] ?? [];
      const dragTitle =
        task.status === "done"
          ? "Готовые задачи не вкладываем — пусть наслаждаются пенсией"
          : "Перетащи задачу сюда, чтобы сделать её подзадачей";
      const isActiveSubtaskModal = taskComposerModal?.kind === "subtask" && taskComposerModal.parentTaskId === task.id;

    return (
        <div
          key={task.id}
          id={`task-card-${task.id}`}
          className={`${isSubtask ? "ml-5 border-l border-zinc-800/80 pl-3" : ""}`}
        >
          <div
            onDragOver={(event) => handleTaskDragOver(event, task)}
            onDragLeave={() => handleTaskDragLeave(task.id)}
            onDrop={(event) => handleTaskDrop(event, task)}
            className={`rounded-2xl border px-4 py-3 transition ${
              task.status === "done"
                ? "border-zinc-800/50 bg-zinc-950/20"
                : node.children.length > 0
                  ? "border-violet-500/20 bg-violet-950/10"
                  : "border-zinc-800/70 bg-zinc-950/35"
            } ${isDropTarget && canNestHere ? "ring-2 ring-sky-400/35 border-sky-400/30 bg-sky-950/15" : ""}`}
          >
            <div className="flex items-start gap-3">
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
                <div className="flex min-w-0 items-start gap-2">
                  <button
                    type="button"
                    draggable={task.status !== "done"}
                    onDragStart={(event) => handleTaskDragStart(event, task.id)}
                    onDragEnd={handleTaskDragEnd}
                    disabled={task.status === "done"}
                    className="mt-0.5 shrink-0 cursor-grab rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-[10px] text-zinc-500 transition hover:border-zinc-700 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
                    title={dragTitle}
                    aria-label={dragTitle}
                  >
                    ⋮⋮
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {isSubtask && (
                        <span
                          className="shrink-0 rounded-md border border-violet-500/20 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-200"
                          title="Подзадача"
                          aria-label="Подзадача"
                        >
                          ↳
                        </span>
                      )}
                      {node.children.length > 0 && (
                        <span className="shrink-0 rounded-md border border-violet-500/20 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-200">
                          {node.children.length} подзадач
                        </span>
                      )}

                      <div className="min-w-0 flex flex-1 items-center gap-2">
                        <p
                          className={`min-w-0 flex-1 truncate text-sm ${
                            task.status === "done" ? "text-zinc-500 line-through" : "text-zinc-100"
                          }`}
                          title={task.title}
                        >
                          {task.title}
                        </p>

                        {task.status !== "done" && (
                          <div className="min-w-0 max-w-full">
                            <QuickEffortPicker
                              value={task.plannedMinutes ?? null}
                              onChange={(minutes) => handleSetPlannedMinutes(task.id, minutes)}
                              size="sm"
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 flex min-w-0 items-center gap-2">
                      <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span
                          className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${STATUS_CLS[task.status]}`}
                        >
                          {task.status}
                        </span>

                        {badge && (
                          <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>
                            📅 {badge.label}
                          </span>
                        )}

                        {rangeBadge && (
                          <span
                            className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${rangeBadge.cls}`}
                            title="Старт диапазона задачи — можно менять левым краем в Ганте"
                          >
                            ↦ {rangeBadge.label}
                          </span>
                        )}

                        {task.status === "done" && plannedLabel && (
                          <span className="shrink-0 rounded-md border border-violet-500/20 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-200">
                            ⏱ {plannedLabel}
                          </span>
                        )}

                        {focus.sessions > 0 && (
                          <span className="shrink-0 rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                            🍅 {focus.sessions} · {focus.minutes}м
                          </span>
                        )}

                        {blockerTasks.length > 0 && (
                          <span className="shrink-0 rounded-md border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-200">
                            ⛓ {blockerTasks.length}
                          </span>
                        )}

                        {task.status !== "done" && (
                          <>
                            <div className="flex shrink-0 items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950/40 px-1 py-1">
                              <button
                                type="button"
                                onClick={() => handleSetDue(task.id, todayDateValue)}
                                aria-pressed={task.dueDate === todayDateValue}
                                className={quickDueButtonCls(task.dueDate === todayDateValue, "sm")}
                              >
                                Сегодня
                              </button>

                              <button
                                type="button"
                                onClick={() => handleSetDue(task.id, tomorrowDateValue)}
                                aria-pressed={task.dueDate === tomorrowDateValue}
                                className={quickDueButtonCls(task.dueDate === tomorrowDateValue, "sm")}
                              >
                                Завтра
                              </button>

                              <button
                                type="button"
                                onClick={() => handleSetDue(task.id, "")}
                                aria-pressed={!task.dueDate}
                                className={quickDueButtonCls(!task.dueDate, "sm")}
                              >
                                Без даты
                              </button>

                              <input
                                type="date"
                                value={task.dueDate ?? ""}
                                onChange={(event) => handleSetDue(task.id, event.target.value)}
                                className="scheme-dark w-30 rounded-md border border-zinc-800 bg-zinc-900/50 px-2 py-1 text-[10px] text-zinc-500 outline-none"
                              />
                            </div>

                            <div className={showQuickProjects ? "min-w-0 flex-1" : showAssignedProjectTrigger ? "min-w-24 max-w-44 flex-1" : "min-w-34 max-w-52 flex-1"}>
                              <ProjectSelectManager
                                value={taskProjectId}
                                projects={projects}
                                quickProjects={showQuickProjects ? popularProjects : undefined}
                                compactValueOnly={showAssignedProjectTrigger}
                                desktopSingleRow={showQuickProjects}
                                onChange={(projectId) => handleSetProject(task.id, projectId)}
                                onProjectsMutate={() => reload()}
                                creationContextLabel="редактирования задачи"
                                suggestedAccent="violet"
                                suggestedKind="category"
                                suggestedLifeArea="work"
                                size="sm"
                              />
                            </div>

                            <div className="shrink-0">
                              <PrioritySwitch
                                value={task.priority}
                                onChange={(priority) => handleSetPriority(task.id, priority)}
                                size="sm"
                              />
                            </div>
                          </>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenSubtaskTaskModal(task)}
                          className={`rounded-lg border px-2 py-1 text-[10px] transition ${
                            isActiveSubtaskModal
                              ? "border-sky-400/30 bg-sky-500/10 text-sky-200"
                              : "border-sky-500/20 text-sky-300 hover:bg-sky-500/10"
                          }`}
                          title="Создать подзадачу с полным composer"
                          aria-haspopup="dialog"
                        >
                          ↳＋
                        </button>
                        {task.parentTaskId && task.status !== "done" && (
                          <button
                            type="button"
                            onClick={() => handleDetachSubtask(task.id)}
                            className="rounded-lg border border-violet-500/20 px-2 py-1 text-[10px] text-violet-300 transition hover:bg-violet-500/10"
                            title="Поднять на верхний уровень внутри группы"
                          >
                            ↰
                          </button>
                        )}
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
                  </div>
                </div>

                {isDropTarget && canNestHere && (
                  <div className="mt-3 rounded-xl border border-dashed border-sky-400/35 bg-sky-500/5 px-3 py-2 text-xs text-sky-200">
                    Отпускай — задача станет подзадачей внутри «{task.title}».
                  </div>
                )}

                {task.status !== "done" && (blockerTasks.length > 0 || dependencyCandidates.length > 0) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800/60 bg-zinc-950/25 px-3 py-2">
                    <span className="text-[10px] uppercase tracking-widest text-zinc-600">⛓ зависимости</span>

                    {blockerTasks.map((blocker) => (
                      <button
                        key={`${task.id}-${blocker.id}`}
                        type="button"
                        onClick={() => handleRemoveBlocker(task.id, blocker.id)}
                        className="max-w-full truncate rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[10px] text-sky-100 transition hover:border-sky-400/30 hover:bg-sky-500/15"
                        title={`Убрать блокер «${blocker.title}»`}
                      >
                        ⛓ {blocker.title} ×
                      </button>
                    ))}

                    {dependencyCandidates.length > 0 && (
                      <div className="min-w-48 max-w-full flex-1 sm:flex-none">
                        <select
                          defaultValue=""
                          onChange={(event) => {
                            const blockerId = event.target.value;
                            if (!blockerId) return;
                            handleAddBlocker(task.id, blockerId);
                            event.currentTarget.value = "";
                          }}
                          className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-[11px] text-zinc-300 outline-none transition hover:border-zinc-700 focus:border-sky-500/35"
                        >
                          <option value="">Добавить blocker…</option>
                          {dependencyCandidates.map((candidate) => (
                            <option key={`${task.id}-candidate-${candidate.id}`} value={candidate.id}>
                              {candidate.title}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {node.children.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {node.children.map((child) => renderTaskNode(child))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
    );
  }

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

        <div className="space-y-2">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
            <input
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && handleAdd()}
              placeholder="Новая задача…"
              className="w-full min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-600 xl:flex-1"
            />

            <QuickEffortPicker value={plannedMinutes} onChange={setPlannedMinutes} />
          </div>

          <div className="flex flex-col gap-2 lg:flex-row lg:flex-nowrap lg:items-start">
            <div className="min-w-0 lg:flex-1">
              <ProjectSelectManager
                value={newTaskProjectId}
                projects={projects}
                quickProjects={popularProjects}
                desktopSingleRow
                onChange={setNewTaskProjectId}
                onProjectsMutate={(projectId) => {
                  reload();
                  setNewTaskProjectId(projectId);
                }}
                creationContextLabel="выбора группы в задаче"
                suggestedAccent="violet"
                suggestedKind="category"
                suggestedLifeArea="work"
                size="md"
              />
            </div>

            <div className="lg:shrink-0">
              <PrioritySwitch value={prio} onChange={(priority) => setPrio(priority)} size="md" />
            </div>

            <div className="flex w-full gap-2 lg:w-auto lg:shrink-0">
              <button
                type="button"
                onClick={() => setDueDate(todayDateValue)}
                aria-pressed={dueDate === todayDateValue}
                className={quickDueButtonCls(dueDate === todayDateValue, "md")}
              >
                Сегодня
              </button>

              <button
                type="button"
                onClick={() => setDueDate(tomorrowDateValue)}
                aria-pressed={dueDate === tomorrowDateValue}
                className={quickDueButtonCls(dueDate === tomorrowDateValue, "md")}
              >
                Завтра
              </button>

              <button
                type="button"
                onClick={() => setDueDate("")}
                aria-pressed={dueDate === ""}
                className={quickDueButtonCls(dueDate === "", "md")}
              >
                Без даты
              </button>

              <input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                className="scheme-dark min-h-10 w-full rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-3 text-xs text-zinc-300 outline-none lg:w-44 lg:shrink-0"
              />
            </div>

            <div className="flex flex-wrap items-stretch gap-2 lg:ml-auto lg:shrink-0 lg:flex-nowrap">
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
          </div>
        </div>

        <div className="space-y-2">
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

          <QuickProjectFilterBar
            value={projectFilter}
            projects={projects}
            quickProjects={popularProjects}
            onChange={setProjectFilter}
          />
        </div>

        {ganttGroups.some((group) => group.nodes.length > 0) && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setGanttExpanded((v) => !v)}
              className="flex items-center gap-2 text-xs text-zinc-400 transition hover:text-zinc-200"
            >
              <span>{ganttExpanded ? "▾" : "▸"}</span>
              <span className="font-medium">Диаграмма Ганта</span>
              <span className="text-zinc-600">
                ({ganttGroups.reduce((s, g) => s + g.openCount, 0)} задач)
              </span>
            </button>
            {ganttExpanded && (
              <TaskGanttChart
                groups={ganttGroups}
                scheduledSlotsByTaskId={ganttScheduledSlotsByTaskId}
                progressByTaskId={ganttProgressByTaskId}
                dependencyLinks={ganttDependencyLinks}
                onTaskRangeChange={handleSetRange}
                onTaskPlannedMinutesChange={handleSetPlannedMinutes}
                onTaskBaselineReset={handleResetTaskBaseline}
                onTaskBaselineRebase={handleRebaseTaskBaseline}
              />
            )}
          </div>
        )}

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
            const primaryRootTasks = filter === "done" ? group.doneRootTasks : group.nonDoneRootTasks;
            const isPrimaryExpanded = expandedGroups.has(group.id);
            const visiblePrimaryTasks = isPrimaryExpanded
              ? primaryRootTasks
              : primaryRootTasks.slice(0, TASKS_PER_GROUP);
            const hasMorePrimaryTasks = primaryRootTasks.length > TASKS_PER_GROUP;
            const hasCompletedSection = filter !== "done" && group.doneRootTasks.length > 0;
            const isCompletedExpanded = expandedCompletedGroups.has(group.id);

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
                    <button
                      type="button"
                      onClick={() => handleOpenGroupTaskModal(group)}
                      className="rounded-xl border border-sky-500/20 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-100 transition hover:border-sky-400/30 hover:bg-sky-500/15"
                    >
                      ＋ задача
                    </button>
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

                {primaryRootTasks.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {visiblePrimaryTasks.map((node) => renderTaskNode(node))}

                    {!isPrimaryExpanded && hasMorePrimaryTasks && (
                      <button
                        type="button"
                        onClick={() => setExpandedGroups((s) => new Set(s).add(group.id))}
                        className="w-full rounded-xl border border-zinc-800 py-2 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
                      >
                        Показать ещё {primaryRootTasks.length - TASKS_PER_GROUP}
                      </button>
                    )}
                  </div>
                )}

                {hasCompletedSection && (
                  <div className={`mt-3 ${primaryRootTasks.length > 0 ? "border-t border-zinc-800/70 pt-3" : ""}`}>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        aria-expanded={isCompletedExpanded}
                        onClick={() =>
                          setExpandedCompletedGroups((current) => {
                            const next = new Set(current);
                            if (next.has(group.id)) {
                              next.delete(group.id);
                            } else {
                              next.add(group.id);
                            }
                            return next;
                          })
                        }
                        className={`inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-[11px] font-medium transition ${
                          isCompletedExpanded
                            ? "border-zinc-700 bg-zinc-900/50 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
                            : "border-zinc-800 bg-zinc-950/25 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
                        }`}
                      >
                        {isCompletedExpanded
                          ? `Скрыть выполненные задачи (${group.doneRootTasks.length})`
                          : `Посмотреть выполненные задачи (${group.doneRootTasks.length})`}
                      </button>
                    </div>

                    {isCompletedExpanded && (
                      <div className="mt-2 space-y-2">
                        {group.doneRootTasks.map((node) => renderTaskNode(node))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        {taskComposerModal && (
          <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 py-10 backdrop-blur-sm sm:py-16">
            <button
              type="button"
              onClick={closeTaskComposerModal}
              aria-label="Закрыть создание задачи"
              className="absolute inset-0"
            />

            <div className="relative w-full max-w-6xl rounded-4xl border border-zinc-800 bg-zinc-950/95 p-4 shadow-2xl shadow-black/50 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                    {taskComposerModal.kind === "subtask" ? "Подзадача" : "Задача в группе"}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-zinc-50">{taskComposerModal.heading}</h3>
                  <p className="mt-1 text-sm text-zinc-500">{taskComposerModal.subtitle}</p>
                </div>
                <button
                  type="button"
                  onClick={closeTaskComposerModal}
                  className="rounded-xl border border-zinc-800 px-3 py-2 text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100"
                >
                  Esc
                </button>
              </div>

              <div className="mt-4 space-y-2">
                <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
                  <input
                    ref={composerModalInputRef}
                    value={taskComposerTitle}
                    onChange={(event) => setTaskComposerTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleCreateTaskFromModal();
                      }
                    }}
                    placeholder={taskComposerModal.kind === "subtask" ? "Новая подзадача…" : "Новая задача…"}
                    className="w-full min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-600 xl:flex-1"
                  />

                  <QuickEffortPicker value={taskComposerPlannedMinutes} onChange={setTaskComposerPlannedMinutes} />
                </div>

                <div className="flex flex-col gap-2 xl:flex-row xl:flex-nowrap xl:items-start">
                  <div className="min-w-0 xl:flex-1">
                    <ProjectSelectManager
                      value={taskComposerProjectId}
                      projects={projects}
                      quickProjects={popularProjects}
                      desktopSingleRow
                      onChange={handleTaskComposerProjectChange}
                      onProjectsMutate={(projectId) => {
                        reload();
                        setTaskComposerProjectTouched(true);
                        setTaskComposerProjectId(projectId);
                      }}
                      creationContextLabel={
                        taskComposerModal.kind === "subtask"
                          ? "создания подзадачи"
                            : "создания задачи в группе"
                      }
                      suggestedAccent="violet"
                      suggestedKind="category"
                      suggestedLifeArea="work"
                      size="md"
                    />

                    {!taskComposerProjectTouched && !taskComposerProjectId && taskComposerModal.fallbackProjectLabel && (
                      <p className="mt-2 text-[11px] text-zinc-500">
                        Если группу не менять, задача попадёт в «{taskComposerModal.fallbackProjectLabel}».
                      </p>
                    )}
                  </div>

                  <div className="xl:shrink-0">
                    <PrioritySwitch value={taskComposerPrio} onChange={setTaskComposerPrio} size="md" />
                  </div>

                  <div className="flex w-full gap-2 xl:w-auto xl:shrink-0">
                    <button
                      type="button"
                      onClick={() => setTaskComposerDueDate(todayDateValue)}
                      aria-pressed={taskComposerDueDate === todayDateValue}
                      className={quickDueButtonCls(taskComposerDueDate === todayDateValue, "md")}
                    >
                      Сегодня
                    </button>

                    <button
                      type="button"
                      onClick={() => setTaskComposerDueDate(tomorrowDateValue)}
                      aria-pressed={taskComposerDueDate === tomorrowDateValue}
                      className={quickDueButtonCls(taskComposerDueDate === tomorrowDateValue, "md")}
                    >
                      Завтра
                    </button>

                    <button
                      type="button"
                      onClick={() => setTaskComposerDueDate("")}
                      aria-pressed={taskComposerDueDate === ""}
                      className={quickDueButtonCls(taskComposerDueDate === "", "md")}
                    >
                      Без даты
                    </button>

                    <input
                      type="date"
                      value={taskComposerDueDate}
                      onChange={(event) => setTaskComposerDueDate(event.target.value)}
                      className="scheme-dark min-h-10 w-full rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-3 text-xs text-zinc-300 outline-none xl:w-44 xl:shrink-0"
                    />
                  </div>

                  <div className="flex flex-wrap items-stretch gap-2 xl:ml-auto xl:shrink-0 xl:flex-nowrap">
                    <button
                      type="button"
                      onClick={() => handleCreateTaskFromModal()}
                      disabled={!taskComposerTitle.trim()}
                      className="rounded-xl bg-zinc-50 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Создать задачу
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCreateTaskFromModal("done")}
                      disabled={!taskComposerTitle.trim()}
                      className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-200 transition hover:border-amber-400/40 hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-40"
                      title="Создать сразу в выполненных"
                    >
                      +⚡
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
