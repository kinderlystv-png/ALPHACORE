import { type Task, getTaskFocusToday, getTasks } from "./tasks";
import { getNotes } from "./notes";
import { getChecks, DEFAULT_HABITS, isActiveOn } from "./habits";
import { type Project, getProjects } from "./projects";

/* ── Weekly task completions ── */

export type DayCompletions = { date: string; label: string; count: number };

function ds(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DAY_LABELS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

export function weeklyCompletions(): DayCompletions[] {
  const tasks = getTasks();
  const now = new Date();
  const result: DayCompletions[] = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = ds(d);
    const count = tasks.filter(
      (t) => t.completedAt && t.completedAt.startsWith(dateStr),
    ).length;
    result.push({ date: dateStr, label: DAY_LABELS[d.getDay()], count });
  }
  return result;
}

/* ── Activity stats ── */

export type ActivityStats = {
  inboxCount: number;
  activeCount: number;
  doneThisWeek: number;
  totalNotes: number;
  habitsToday: { done: number; total: number };
};

export function getActivityStats(): ActivityStats {
  const tasks = getTasks();
  const notes = getNotes();

  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const doneThisWeek = tasks.filter(
    (t) => t.completedAt && new Date(t.completedAt) >= weekAgo,
  ).length;

  const todayDate = ds(now);
  const checks = getChecks(todayDate);
  const todayHabits = DEFAULT_HABITS.filter((h) => isActiveOn(h, now.getDay()));
  const habitsDone = todayHabits.filter((h) => checks[h.id]).length;

  return {
    inboxCount: tasks.filter((t) => t.status === "inbox").length,
    activeCount: tasks.filter((t) => t.status === "active").length,
    doneThisWeek,
    totalNotes: notes.length,
    habitsToday: { done: habitsDone, total: todayHabits.length },
  };
}

export type WeeklyFocusDay = {
  date: string;
  label: string;
  focusMinutes: number;
  focusSessions: number;
  completedTasks: number;
};

export type WeeklyFocusReport = {
  days: WeeklyFocusDay[];
  totalFocusMinutes: number;
  totalFocusSessions: number;
  totalCompletedTasks: number;
  topTask:
    | {
        title: string;
        minutes: number;
        sessions: number;
        projectLabel?: string;
      }
    | null;
  topProject:
    | {
        name: string;
        minutes: number;
      }
    | null;
};

export function getWeeklyFocusReport(): WeeklyFocusReport {
  const tasks = getTasks();
  const projects = getProjects();
  const projectNameById = new Map(projects.map((project) => [project.id, project.name]));
  const now = new Date();
  const dates: string[] = [];

  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    dates.push(ds(date));
  }

  const days = dates.map((date) => {
    const focus = tasks.reduce(
      (acc, task) => {
        const stat = getTaskFocusToday(task, date);
        acc.focusMinutes += stat.minutes;
        acc.focusSessions += stat.sessions;
        return acc;
      },
      { focusMinutes: 0, focusSessions: 0 },
    );

    return {
      date,
      label: DAY_LABELS[new Date(`${date}T00:00:00`).getDay()],
      focusMinutes: focus.focusMinutes,
      focusSessions: focus.focusSessions,
      completedTasks: tasks.filter(
        (task) => task.completedAt && task.completedAt.startsWith(date),
      ).length,
    };
  });

  const taskTotals = tasks
    .map((task) => {
      const totals = dates.reduce(
        (acc, date) => {
          const stat = getTaskFocusToday(task, date);
          acc.minutes += stat.minutes;
          acc.sessions += stat.sessions;
          return acc;
        },
        { minutes: 0, sessions: 0 },
      );

      const projectLabel = task.projectId
        ? projectNameById.get(task.projectId) ?? task.project
        : task.project;

      return {
        title: task.title,
        projectLabel,
        minutes: totals.minutes,
        sessions: totals.sessions,
      };
    })
    .filter((task) => task.minutes > 0 || task.sessions > 0)
    .sort((a, b) => b.minutes - a.minutes || b.sessions - a.sessions);

  const projectTotals = taskTotals.reduce<Map<string, number>>((acc, task) => {
    if (!task.projectLabel) return acc;
    acc.set(task.projectLabel, (acc.get(task.projectLabel) ?? 0) + task.minutes);
    return acc;
  }, new Map());

  const topProjectEntry = [...projectTotals.entries()].sort(
    (a, b) => b[1] - a[1],
  )[0];

  return {
    days,
    totalFocusMinutes: days.reduce((acc, day) => acc + day.focusMinutes, 0),
    totalFocusSessions: days.reduce((acc, day) => acc + day.focusSessions, 0),
    totalCompletedTasks: days.reduce((acc, day) => acc + day.completedTasks, 0),
    topTask: taskTotals[0] ?? null,
    topProject: topProjectEntry
      ? { name: topProjectEntry[0], minutes: topProjectEntry[1] }
      : null,
  };
}

export type FocusSnapshot = {
  primaryTask: Task | null;
  overdueCount: number;
  inboxCount: number;
  attentionProject: Project | null;
  focusToday: { sessions: number; minutes: number };
};

function priorityWeight(priority: Task["priority"]): number {
  if (priority === "p1") return 0;
  if (priority === "p2") return 1;
  return 2;
}

function statusWeight(status: Task["status"]): number {
  if (status === "active") return 0;
  if (status === "inbox") return 1;
  if (status === "done") return 2;
  return 3;
}

function dueWeight(dueDate?: string): number {
  if (!dueDate) return 9999;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  return Math.floor((due.getTime() - now.getTime()) / 86_400_000);
}

export function getFocusSnapshot(): FocusSnapshot {
  const today = ds(new Date());
  const tasks = getTasks();
  const projects = getProjects();

  const candidateTasks = [...tasks]
    .filter((task) => task.status === "active" || task.status === "inbox")
    .sort((a, b) => {
      return (
        statusWeight(a.status) - statusWeight(b.status) ||
        priorityWeight(a.priority) - priorityWeight(b.priority) ||
        dueWeight(a.dueDate) - dueWeight(b.dueDate) ||
        a.createdAt.localeCompare(b.createdAt)
      );
    });

  const attentionProject =
    [...projects].sort((a, b) => {
      const aw = a.status === "red" ? 0 : a.status === "yellow" ? 1 : 2;
      const bw = b.status === "red" ? 0 : b.status === "yellow" ? 1 : 2;
      return aw - bw;
    }).find((project) => project.status !== "green") ?? null;

  const focusToday = tasks.reduce(
    (acc, task) => {
      const stat = getTaskFocusToday(task, today);
      acc.sessions += stat.sessions;
      acc.minutes += stat.minutes;
      return acc;
    },
    { sessions: 0, minutes: 0 },
  );

  return {
    primaryTask: candidateTasks[0] ?? null,
    overdueCount: tasks.filter(
      (task) =>
        (task.status === "active" || task.status === "inbox") &&
        !!task.dueDate &&
        dueWeight(task.dueDate) < 0,
    ).length,
    inboxCount: tasks.filter((task) => task.status === "inbox").length,
    attentionProject,
    focusToday,
  };
}
