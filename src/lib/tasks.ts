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
  parentTaskId?: string;
  priority: TaskPriority;
  status: TaskStatus;
  startDate?: string;
  dueDate?: string;
  plannedMinutes?: number;
  createdAt: string;
  origin?: AutomationOrigin;
  completedAt?: string;
  focusSessions?: number;
  focusMinutes?: number;
  lastFocusedAt?: string;
  focusHistory?: Record<string, { sessions: number; minutes: number }>;
};

type AddTaskOptions = Partial<
  Pick<
    Task,
    | "id"
    | "project"
    | "projectId"
    | "parentTaskId"
    | "priority"
    | "startDate"
    | "dueDate"
    | "plannedMinutes"
    | "status"
    | "origin"
    | "completedAt"
  >
>;

const KEY = "alphacore_tasks";

function sanitizeOptionalId(value?: string | null): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

function sanitizeOptionalDate(value?: string | null): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

function sanitizePlannedMinutes(value?: number | null): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;

  const rounded = Math.round(value);
  return rounded > 0 ? rounded : undefined;
}

function normalizeTasks(tasks: Task[]): Task[] {
  const prepared = tasks.map((task) => ({
    ...task,
    parentTaskId: sanitizeOptionalId(task.parentTaskId),
    startDate: sanitizeOptionalDate(task.startDate),
    dueDate: sanitizeOptionalDate(task.dueDate),
    plannedMinutes: sanitizePlannedMinutes(task.plannedMinutes),
  }));
  const taskIds = new Set(prepared.map((task) => task.id));
  const taskById = new Map(prepared.map((task) => [task.id, task]));

  return prepared.map((task) => {
    const parentTaskId = task.parentTaskId;

    if (!parentTaskId || parentTaskId === task.id || !taskIds.has(parentTaskId)) {
      return {
        ...task,
        parentTaskId: undefined,
      };
    }

    const seen = new Set<string>([task.id]);
    let cursor: string | undefined = parentTaskId;

    while (cursor) {
      if (seen.has(cursor)) {
        return {
          ...task,
          parentTaskId: undefined,
        };
      }

      seen.add(cursor);
      cursor = taskById.get(cursor)?.parentTaskId;
    }

    return task;
  });
}

function buildChildrenByParentId(tasks: Task[]): Map<string, Task[]> {
  const childrenByParentId = new Map<string, Task[]>();

  for (const task of tasks) {
    if (!task.parentTaskId) continue;

    const children = childrenByParentId.get(task.parentTaskId) ?? [];
    children.push(task);
    childrenByParentId.set(task.parentTaskId, children);
  }

  for (const children of childrenByParentId.values()) {
    children.sort((left, right) => compareTasksByAttention(left, right));
  }

  return childrenByParentId;
}

export function getTasks(): Task[] {
  return normalizeTasks(lsGet<Task[]>(KEY, []));
}

function save(tasks: Task[]): void {
  lsSet(KEY, normalizeTasks(tasks));
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
  const status = opts?.status ?? "inbox";
  const t: Task = {
    id: opts?.id ?? uid(),
    title,
    project: opts?.project,
    projectId: opts?.projectId,
    parentTaskId: opts?.parentTaskId,
    priority: opts?.priority ?? "p2",
    status,
    startDate: sanitizeOptionalDate(opts?.startDate),
    dueDate: sanitizeOptionalDate(opts?.dueDate),
    plannedMinutes: sanitizePlannedMinutes(opts?.plannedMinutes),
    createdAt: new Date().toISOString(),
    origin: opts?.origin,
    completedAt: status === "done" ? (opts?.completedAt ?? new Date().toISOString()) : undefined,
  };
  tasks.unshift(t);
  save(tasks);
  return t;
}

export function updateTask(id: string, patch: Partial<Task>): void {
  const nextPatch: Partial<Task> = {
    ...patch,
    ...(Object.prototype.hasOwnProperty.call(patch, "plannedMinutes")
      ? { plannedMinutes: sanitizePlannedMinutes(patch.plannedMinutes) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "startDate")
      ? { startDate: sanitizeOptionalDate(patch.startDate) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "dueDate")
      ? { dueDate: sanitizeOptionalDate(patch.dueDate) }
      : {}),
  };

  const tasks = getTasks().map((t) => (t.id === id ? { ...t, ...nextPatch } : t));
  save(tasks);
}

export function getTaskById(id: string, tasks: Task[] = getTasks()): Task | null {
  return tasks.find((task) => task.id === id) ?? null;
}

export function isSubtask(task: Pick<Task, "parentTaskId">): boolean {
  return Boolean(task.parentTaskId);
}

export function getTaskChildren(parentTaskId: string, tasks: Task[] = getTasks()): Task[] {
  return tasks
    .filter((task) => task.parentTaskId === parentTaskId)
    .sort((left, right) => compareTasksByAttention(left, right));
}

export function getTaskTreeIds(taskId: string, tasks: Task[] = getTasks()): string[] {
  const childrenByParentId = buildChildrenByParentId(tasks);
  const ids: string[] = [];
  const seen = new Set<string>();

  const visit = (currentId: string) => {
    if (seen.has(currentId)) return;
    seen.add(currentId);
    ids.push(currentId);

    for (const child of childrenByParentId.get(currentId) ?? []) {
      visit(child.id);
    }
  };

  visit(taskId);
  return ids;
}

export function getTaskLineage(task: Task, tasks: Task[] = getTasks()): Task[] {
  const taskById = new Map(tasks.map((item) => [item.id, item]));
  const lineage: Task[] = [];
  const seen = new Set<string>();

  let current: Task | null = task;

  while (current && !seen.has(current.id)) {
    lineage.unshift(current);
    seen.add(current.id);
    current = current.parentTaskId ? taskById.get(current.parentTaskId) ?? null : null;
  }

  return lineage;
}

export function getTaskDepth(task: Task, tasks: Task[] = getTasks()): number {
  return Math.max(0, getTaskLineage(task, tasks).length - 1);
}

export function canAssignTaskParent(
  taskId: string,
  parentTaskId?: string | null,
  tasks: Task[] = getTasks(),
): boolean {
  const nextParentTaskId = sanitizeOptionalId(parentTaskId);

  if (!nextParentTaskId) return Boolean(getTaskById(taskId, tasks));
  if (taskId === nextParentTaskId) return false;

  const task = getTaskById(taskId, tasks);
  const parentTask = getTaskById(nextParentTaskId, tasks);
  if (!task || !parentTask) return false;

  return !new Set(getTaskTreeIds(taskId, tasks)).has(nextParentTaskId);
}

export function assignTaskParent(
  taskId: string,
  parentTaskId?: string | null,
): Task[] {
  const tasks = getTasks();
  const nextParentTaskId = sanitizeOptionalId(parentTaskId);

  if (!canAssignTaskParent(taskId, nextParentTaskId, tasks)) return [];

  const task = getTaskById(taskId, tasks);
  if (!task) return [];

  if ((task.parentTaskId ?? undefined) === nextParentTaskId) {
    return [task];
  }

  const parentTask = nextParentTaskId ? getTaskById(nextParentTaskId, tasks) : null;
  const treeIds = new Set(getTaskTreeIds(taskId, tasks));

  const nextTasks = tasks.map((item) => {
    if (!treeIds.has(item.id)) return item;

    if (item.id === taskId) {
      return {
        ...item,
        parentTaskId: nextParentTaskId,
        ...(parentTask
          ? {
              projectId: parentTask.projectId,
              project: parentTask.project,
            }
          : {}),
      };
    }

    if (!parentTask) return item;

    return {
      ...item,
      projectId: parentTask.projectId,
      project: parentTask.project,
    };
  });

  save(nextTasks);
  return nextTasks.filter((item) => treeIds.has(item.id));
}

export function moveTaskTreeToProject(
  taskId: string,
  projectId?: string,
  project?: string,
): Task[] {
  const tasks = getTasks();
  const task = getTaskById(taskId, tasks);
  if (!task) return [];

  const normalizedProjectId = sanitizeOptionalId(projectId);
  const normalizedProject = project?.trim() || undefined;
  const currentParent = task.parentTaskId ? getTaskById(task.parentTaskId, tasks) : null;
  const shouldDetachFromParent =
    Boolean(currentParent) &&
    ((currentParent?.projectId ?? "") !== (normalizedProjectId ?? "") ||
      (currentParent?.project ?? "") !== (normalizedProject ?? ""));

  const treeIds = new Set(getTaskTreeIds(taskId, tasks));
  const nextTasks = tasks.map((item) => {
    if (!treeIds.has(item.id)) return item;

    return {
      ...item,
      projectId: normalizedProjectId,
      project: normalizedProject,
      ...(item.id === taskId && shouldDetachFromParent ? { parentTaskId: undefined } : {}),
    };
  });

  save(nextTasks);
  return nextTasks.filter((item) => treeIds.has(item.id));
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
  const tasks = getTasks();
  const target = tasks.find((task) => task.id === id) ?? null;
  const fallbackParentTaskId = target?.parentTaskId;

  save(
    tasks
      .filter((task) => task.id !== id)
      .map((task) =>
        task.parentTaskId === id
          ? {
              ...task,
              parentTaskId: fallbackParentTaskId,
            }
          : task,
      ),
  );
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
