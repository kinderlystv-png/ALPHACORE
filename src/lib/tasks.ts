import { dateStr, lsGet, lsSet, uid } from "./storage";

/* ── Types ── */

export type TaskPriority = "p1" | "p2" | "p3";
export type TaskStatus = "inbox" | "active" | "done" | "archived";
export type AutomationOrigin = {
  source: "heys";
  metricKey?: string;
  via?: "task" | "slot" | "autopilot";
  bundleId?: string;
  bundleLabel?: string;
  bundlePart?: string;
  bundleRunId?: string;
};

export type Task = {
  id: string;
  title: string;
  project?: string;
  projectId?: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate?: string;
  createdAt: string;
  origin?: AutomationOrigin;
  completedAt?: string;
  focusSessions?: number;
  focusMinutes?: number;
  lastFocusedAt?: string;
  focusHistory?: Record<string, { sessions: number; minutes: number }>;
};

type AddTaskOptions = Partial<
  Pick<Task, "id" | "project" | "projectId" | "priority" | "dueDate" | "status" | "origin">
>;

const KEY = "alphacore_tasks";

export function getTasks(): Task[] {
  return lsGet<Task[]>(KEY, []);
}

function save(tasks: Task[]): void {
  lsSet(KEY, tasks);
}

function ds(d: Date): string {
  return dateStr(d);
}

function priorityWeight(priority: TaskPriority): number {
  if (priority === "p1") return 0;
  if (priority === "p2") return 1;
  return 2;
}

function statusWeight(status: TaskStatus): number {
  if (status === "active") return 0;
  if (status === "inbox") return 1;
  if (status === "done") return 2;
  return 3;
}

function dueWeight(dueDate: string | undefined, referenceDate: string): number {
  if (!dueDate) return 9999;
  return Math.floor(
    (new Date(`${dueDate}T00:00:00`).getTime() -
      new Date(`${referenceDate}T00:00:00`).getTime()) /
      86_400_000,
  );
}

function isCarryoverCandidate(task: Task): boolean {
  return task.status === "inbox" || task.status === "active";
}

export function isActionableTask(task: Task): boolean {
  return task.status === "inbox" || task.status === "active";
}

export function compareTasksByAttention(
  left: Task,
  right: Task,
  referenceDate: string = ds(new Date()),
): number {
  return (
    statusWeight(left.status) - statusWeight(right.status) ||
    priorityWeight(left.priority) - priorityWeight(right.priority) ||
    dueWeight(left.dueDate, referenceDate) - dueWeight(right.dueDate, referenceDate) ||
    left.createdAt.localeCompare(right.createdAt)
  );
}

export function getActionableTasks(referenceDate: string = ds(new Date())): Task[] {
  return getTasks()
    .filter(isActionableTask)
    .sort((left, right) => compareTasksByAttention(left, right, referenceDate));
}

export function addTask(
  title: string,
  opts?: AddTaskOptions,
): Task {
  const tasks = getTasks();
  const t: Task = {
    id: opts?.id ?? uid(),
    title,
    project: opts?.project,
    projectId: opts?.projectId,
    priority: opts?.priority ?? "p2",
    status: opts?.status ?? "inbox",
    dueDate: opts?.dueDate,
    createdAt: new Date().toISOString(),
    origin: opts?.origin,
  };
  tasks.unshift(t);
  save(tasks);
  return t;
}

export function updateTask(id: string, patch: Partial<Task>): void {
  const tasks = getTasks().map((t) => (t.id === id ? { ...t, ...patch } : t));
  save(tasks);
}

export function toggleDone(id: string): Task | undefined {
  const tasks = getTasks();
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  if (t.status === "done") {
    t.status = "active";
    t.completedAt = undefined;
  } else {
    t.status = "done";
    t.completedAt = new Date().toISOString();
  }
  save(tasks);
  return t;
}

export function deleteTask(id: string): void {
  save(getTasks().filter((t) => t.id !== id));
}

export function activateTask(id: string): void {
  updateTask(id, { status: "active" });
}

export function logFocusSession(id: string, minutes = 25): void {
  const today = ds(new Date());
  const tasks = getTasks().map((task) => {
    if (task.id !== id) return task;

    const todayLog = task.focusHistory?.[today] ?? { sessions: 0, minutes: 0 };

    return {
      ...task,
      focusSessions: (task.focusSessions ?? 0) + 1,
      focusMinutes: (task.focusMinutes ?? 0) + minutes,
      lastFocusedAt: new Date().toISOString(),
      focusHistory: {
        ...(task.focusHistory ?? {}),
        [today]: {
          sessions: todayLog.sessions + 1,
          minutes: todayLog.minutes + minutes,
        },
      },
    };
  });

  save(tasks);
}

export function getTaskFocusToday(
  task: Task,
  date: string = ds(new Date()),
): { sessions: number; minutes: number } {
  return task.focusHistory?.[date] ?? { sessions: 0, minutes: 0 };
}

export function getTaskFocusTotal(task: Task): { sessions: number; minutes: number } {
  return {
    sessions: task.focusSessions ?? 0,
    minutes: task.focusMinutes ?? 0,
  };
}

export function getCarryoverTasks(targetDate: string = ds(new Date())): Task[] {
  return getTasks().filter(
    (task) => isCarryoverCandidate(task) && !!task.dueDate && task.dueDate < targetDate,
  );
}

export function moveTasksDueDate(taskIds: string[], dueDate: string = ds(new Date())): Task[] {
  if (taskIds.length === 0) return [];

  const ids = new Set(taskIds);
  const tasks = getTasks().map((task) => {
    if (!ids.has(task.id) || !isCarryoverCandidate(task)) return task;
    return {
      ...task,
      dueDate,
    };
  });

  save(tasks);

  return tasks.filter((task) => ids.has(task.id));
}
