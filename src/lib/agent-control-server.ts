/**
 * Server-side version of the agent control snapshot.
 *
 * Mirrors the logic from agent-control.ts but accepts raw data from
 * Postgres (via getCloudSnapshot) instead of reading browser localStorage.
 */

import type { Task } from "./tasks";
import type { Project } from "./projects";
import type { MedEntry, MedParam } from "./medical";
import type { JournalEntry } from "./journal";
import { DEFAULT_HABITS, isActiveOn, type Habit } from "./habits";
import type { ScheduleSlot } from "./schedule";
import { getScheduleForDate } from "./schedule";
import type { StorageKey } from "./app-data-keys";
import type { HeysHealthSignals, HeysIntradaySignal } from "./heys-bridge";
import {
  buildBundleContextProfile,
  getDayModePriorityHint,
  getDayModeStatement,
  getDefaultMetricKey,
  getHeysDayMode,
  getMetricLabel,
} from "./heys-day-mode";

// Re-export types from client module for convenience
export type {
  AttentionAreaKey,
  AttentionLevel,
  AttentionArea,
  AgentPriority,
  AgentControlSnapshot,
} from "./agent-control";

import type {
  AttentionAreaKey,
  AttentionLevel,
  AttentionArea,
  AgentPriority,
  AgentControlSnapshot,
} from "./agent-control";

// ── Pure helpers ─────────────────────────────────────────────────────────────

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function ds(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysSince(dateLike: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateLike);
  target.setHours(0, 0, 0, 0);
  return Math.floor((now.getTime() - target.getTime()) / 86_400_000);
}

function levelFromScore(score: number): AttentionLevel {
  if (score >= 72) return "good";
  if (score >= 50) return "watch";
  return "critical";
}

function priorityWeight(p: string): number {
  if (p === "p1") return 0;
  if (p === "p2") return 1;
  return 2;
}

function statusWeight(s: string): number {
  if (s === "active") return 0;
  if (s === "inbox") return 1;
  if (s === "done") return 2;
  return 3;
}

function dueWeight(dueDate?: string): number {
  if (!dueDate) return 9999;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  return Math.floor((due.getTime() - now.getTime()) / 86_400_000);
}

function paramStatus(param: MedParam): "normal" | "low" | "high" {
  if (param.refMin != null && param.value < param.refMin) return "low";
  if (param.refMax != null && param.value > param.refMax) return "high";
  return "normal";
}

function getTaskFocusToday(
  task: Task,
  date: string,
): { sessions: number; minutes: number } {
  const h = task.focusHistory?.[date];
  return h ?? { sessions: 0, minutes: 0 };
}

// ── Raw data types ───────────────────────────────────────────────────────────

type RawData = {
  tasks: Task[];
  projects: Project[];
  journal: JournalEntry[];
  medical: MedEntry[];
  habits: Record<string, boolean>;
};

// ── Extract raw data from cloud snapshot ─────────────────────────────────────

export function extractRawData(
  items: Partial<Record<StorageKey, unknown>>,
): RawData {
  return {
    tasks: Array.isArray(items.alphacore_tasks) ? items.alphacore_tasks : [],
    projects: Array.isArray(items.alphacore_projects)
      ? items.alphacore_projects
      : [],
    journal: Array.isArray(items.alphacore_journal)
      ? items.alphacore_journal
      : [],
    medical: Array.isArray(items.alphacore_medical)
      ? items.alphacore_medical
      : [],
    habits:
      items.alphacore_habits &&
      typeof items.alphacore_habits === "object" &&
      !Array.isArray(items.alphacore_habits)
        ? (items.alphacore_habits as Record<string, boolean>)
        : {},
  };
}

// ── Schedule helpers (server-safe — uses template + studio, no localStorage) ─

function collectUpcomingSchedule(days = 7): ScheduleSlot[] {
  const slots: ScheduleSlot[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);
    slots.push(...getScheduleForDate(date));
  }
  return slots;
}

type UpcomingStats = {
  family: number;
  health: number;
  personal: number;
  review: number;
  cleanup: number;
  studio: number;
};

function getUpcomingStats(slots: ScheduleSlot[]): UpcomingStats {
  return slots.reduce<UpcomingStats>(
    (acc, slot) => {
      if (slot.tone === "family") acc.family += 1;
      if (slot.tone === "health") acc.health += 1;
      if (slot.tone === "personal") acc.personal += 1;
      if (slot.tone === "review") acc.review += 1;
      if (slot.tone === "cleanup") acc.cleanup += 1;
      if (slot.tone === "kinderly") acc.studio += 1;
      return acc;
    },
    { family: 0, health: 0, personal: 0, review: 0, cleanup: 0, studio: 0 },
  );
}

// ── Computed stats from raw data ─────────────────────────────────────────────

function computeActivityStats(
  tasks: Task[],
  habits: Record<string, boolean>,
) {
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const today = ds(now);

  const doneThisWeek = tasks.filter(
    (t) => t.completedAt && new Date(t.completedAt) >= weekAgo,
  ).length;

  const todayHabits = DEFAULT_HABITS.filter((h) => isActiveOn(h, now.getDay()));
  const habitsDone = todayHabits.filter((h) => habits[`${h.id}:${today}`]).length;

  return {
    inboxCount: tasks.filter((t) => t.status === "inbox").length,
    activeCount: tasks.filter((t) => t.status === "active").length,
    doneThisWeek,
    habitsToday: { done: habitsDone, total: todayHabits.length },
  };
}

function computeFocusSnapshot(tasks: Task[], projects: Project[]) {
  const today = ds(new Date());

  const candidateTasks = [...tasks]
    .filter((t) => t.status === "active" || t.status === "inbox")
    .sort(
      (a, b) =>
        statusWeight(a.status) - statusWeight(b.status) ||
        priorityWeight(a.priority) - priorityWeight(b.priority) ||
        dueWeight(a.dueDate) - dueWeight(b.dueDate) ||
        a.createdAt.localeCompare(b.createdAt),
    );

  const attentionProject =
    [...projects]
      .sort((a, b) => {
        const aw = a.status === "red" ? 0 : a.status === "yellow" ? 1 : 2;
        const bw = b.status === "red" ? 0 : b.status === "yellow" ? 1 : 2;
        return aw - bw;
      })
      .find((p) => p.status !== "green") ?? null;

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
      (t) =>
        (t.status === "active" || t.status === "inbox") &&
        !!t.dueDate &&
        dueWeight(t.dueDate) < 0,
    ).length,
    inboxCount: tasks.filter((t) => t.status === "inbox").length,
    attentionProject,
    focusToday,
  };
}

function computeWeeklyFocusMinutes(tasks: Task[]): number {
  const now = new Date();
  const dates: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates.push(ds(d));
  }
  return tasks.reduce((total, task) => {
    return (
      total +
      dates.reduce((acc, date) => acc + getTaskFocusToday(task, date).minutes, 0)
    );
  }, 0);
}

// ── Main server-side snapshot computation ────────────────────────────────────

const AREA_META: Record<
  AttentionAreaKey,
  { label: string; emoji: string; href: string }
> = {
  work: { label: "Работа", emoji: "💼", href: "/projects" },
  health: { label: "Здоровье", emoji: "🫀", href: "/medical" },
  family: { label: "Семья", emoji: "🏡", href: "/calendar" },
  operations: { label: "Операционка", emoji: "🧹", href: "/tasks" },
  reflection: { label: "Осмысление", emoji: "🧠", href: "/journal" },
  recovery: { label: "Восстановление", emoji: "🌙", href: "/routines" },
};

type PriorityCandidate = AgentPriority & { weight: number };

function pushPriority(
  list: PriorityCandidate[],
  c: PriorityCandidate | null,
): void {
  if (c) list.push(c);
}

export function getServerSnapshot(raw: RawData, heys?: HeysHealthSignals | null): AgentControlSnapshot {
  const today = ds(new Date());
  const { tasks, projects, journal: journalEntries, medical: medEntries, habits } = raw;

  const stats = computeActivityStats(tasks, habits);
  const focusSnapshot = computeFocusSnapshot(tasks, projects);
  const totalFocusMinutes = computeWeeklyFocusMinutes(tasks);

  const upcomingSlots = collectUpcomingSchedule(7);
  const upcoming = getUpcomingStats(upcomingSlots);
  const h = heys?.hasRecentData ? heys : null;
  const heysDayMode = h
    ? getHeysDayMode(h, buildBundleContextProfile(), getDefaultMetricKey(h), 8)
    : null;
  const intraday = h?.intraday ?? null;
  const intradayWorsening =
    intraday != null &&
    (intraday.momentum === "worsening" || intraday.momentum === "mixed") &&
    (intraday.status === "watch" || intraday.status === "critical");
  const intradayImproving =
    intraday?.momentum === "improving" && intraday.status === "good";
  const intradayHealthAdjustment = intradayWorsening
    ? intraday.status === "critical"
      ? -12
      : -6
    : intradayImproving
      ? 4
      : 0;
  const intradayRecoveryAdjustment = intradayWorsening
    ? intraday.status === "critical"
      ? -14
      : -7
    : intradayImproving
      ? 5
      : 0;

  const todayChecks: Record<string, boolean> = {};
  for (const h of DEFAULT_HABITS) {
    todayChecks[h.id] = habits[`${h.id}:${today}`] === true;
  }

  const activeHabitsToday = DEFAULT_HABITS.filter((h) =>
    isActiveOn(h, new Date().getDay()),
  );
  const habitRatio =
    activeHabitsToday.length > 0
      ? stats.habitsToday.done / activeHabitsToday.length
      : 1;

  const flaggedMedicalParams = medEntries
    .flatMap((e) => e.params)
    .filter((p) => {
      const s = paramStatus(p);
      return s === "low" || s === "high";
    }).length;

  const latestMedicalDate = [...medEntries].sort((a, b) =>
    b.date.localeCompare(a.date),
  )[0]?.date;

  const recentJournal = journalEntries.filter(
    (e) => daysSince(e.createdAt) <= 3,
  );
  const reflectionSignals = recentJournal.filter((e) =>
    e.tags.some((t) =>
      ["review", "planning", "focus", "reflection"].includes(t),
    ),
  ).length;
  const familySignals = recentJournal.filter((e) =>
    e.tags.some((t) => ["family", "danya", "studio"].includes(t)),
  ).length;

  const sleepChecked = todayChecks.sleep === true;
  const { attentionProject } = focusSnapshot;
  const birthdayProject = projects.find((p) =>
    /др|день рождения|minecraft/i.test(p.name),
  );

  // ── Scores ──

  // HEYS-enriched scoring: use real biometric data when available

  const workScore = clamp(
    56 +
      Math.min(totalFocusMinutes, 180) / 6 +
      Math.min(stats.doneThisWeek, 5) * 4 +
      (focusSnapshot.primaryTask ? 8 : 0) -
      focusSnapshot.overdueCount * 8 -
      (attentionProject ? 10 : 0),
  );

  // Health: blend ALPHACORE habits with real HEYS biometrics
  const heysHealthBonus = h
    ? (
        // Sleep quality factor (0-10 scale → 0-10 pts)
        Math.min((h.sleepQualityAvg ?? 5) * 1, 10) +
        // Steps ratio (0-12 pts)
        Math.min((h.stepsGoalRatio ?? 0.5) * 12, 12) +
        // Training days this week (0-8 pts)
        Math.min(h.trainingDaysWeek, 4) * 2 -
        // Late bedtime penalty (up to -8 pts)
        (h.lateBedtimeRatio != null ? h.lateBedtimeRatio * 8 : 0)
      )
    : 0;
  const healthScore = clamp(
    (h ? 30 : 44) + // lower base when HEYS provides real data
      habitRatio * (h ? 20 : 32) + // reduce habit weight when real data available
      heysHealthBonus +
      intradayHealthAdjustment +
      Math.min(upcoming.health, 3) * 8 +
      (latestMedicalDate && daysSince(latestMedicalDate) <= 60 ? 8 : 0) -
      flaggedMedicalParams * 10,
  );

  const familyScore = clamp(
    50 +
      Math.min(upcoming.family, 4) * 10 +
      Math.min(familySignals, 2) * 8 +
      (birthdayProject ? 6 : 0) -
      Math.max(0, upcoming.studio - upcoming.family) * 6,
  );
  const operationsScore = clamp(
    62 -
      stats.inboxCount * 4 -
      focusSnapshot.overdueCount * 10 +
      Math.min(upcoming.cleanup, 2) * 6,
  );
  const reflectionScore = clamp(
    36 +
      Math.min(recentJournal.length, 4) * 11 +
      Math.min(upcoming.review, 2) * 16 +
      Math.min(reflectionSignals, 2) * 8,
  );

  // Recovery: use real sleep + wellbeing data from HEYS
  const heysRecoveryBonus = h
    ? (
        // Sleep hours relative to goal (0-15 pts)
        Math.min(((h.sleepHoursAvg ?? 7) / 8) * 15, 15) +
        // Sleep quality (0-8 pts)
        Math.min((h.sleepQualityAvg ?? 5) * 0.8, 8) +
        // Wellbeing factor (0-8 pts)
        Math.min((h.wellbeingAvg ?? 6) * 0.8, 8) -
        // Late bedtime penalty (up to -12 pts — main blind spot)
        (h.lateBedtimeRatio != null ? h.lateBedtimeRatio * 12 : 0) -
        // Low mood penalty (0-6 pts)
        (h.moodAvg != null && h.moodAvg < 6 ? (6 - h.moodAvg) * 2 : 0)
      )
    : 0;
  const recoveryScore = clamp(
    (h ? 28 : 40) + // lower base when HEYS provides real data
      heysRecoveryBonus +
      intradayRecoveryAdjustment +
      Math.min(upcoming.personal, 3) * (h ? 8 : 12) +
      (sleepChecked ? (h ? 10 : 22) : 0) +
      Math.min(upcoming.health, 2) * 5 -
      Math.max(0, upcoming.studio - upcoming.personal - upcoming.family) * 4,
  );

  // ── Levels ──

  const workLevel: AttentionLevel =
    focusSnapshot.overdueCount >= 3 || attentionProject?.status === "red"
      ? "critical"
      : focusSnapshot.overdueCount > 0 || Boolean(attentionProject)
        ? "watch"
        : levelFromScore(workScore);

  const healthLevel: AttentionLevel =
    intraday?.status === "critical" ||
    habitRatio < 0.34 || flaggedMedicalParams >= 2 || (h && h.stepsGoalRatio != null && h.stepsGoalRatio < 0.5 && h.trainingDaysWeek <= 1)
      ? "critical"
      : intradayWorsening || habitRatio < 0.67 || flaggedMedicalParams > 0 || (h && h.stepsGoalRatio != null && h.stepsGoalRatio < 0.7)
        ? "watch"
        : levelFromScore(healthScore);

  const familyLevel: AttentionLevel =
    upcoming.studio >= 2 && upcoming.family === 0
      ? "critical"
      : upcoming.studio > 0 && upcoming.family < 2
        ? "watch"
        : levelFromScore(familyScore);

  const operationsLevel: AttentionLevel =
    focusSnapshot.overdueCount >= 3 || stats.inboxCount >= 8
      ? "critical"
      : focusSnapshot.overdueCount > 0 ||
          stats.inboxCount >= 4 ||
          upcoming.cleanup > 0
        ? "watch"
        : levelFromScore(operationsScore);

  const reflectionLevel: AttentionLevel =
    recentJournal.length === 0 && upcoming.review === 0
      ? "critical"
      : recentJournal.length < 2 || upcoming.review === 0
        ? "watch"
        : levelFromScore(reflectionScore);

  const recoveryLevel: AttentionLevel =
    intraday?.status === "critical" ||
    (!sleepChecked && upcoming.personal === 0) || (h && h.lateBedtimeRatio != null && h.lateBedtimeRatio > 0.8 && (h.sleepQualityAvg ?? 10) < 5)
      ? "critical"
      : intradayWorsening || upcoming.personal < 2 || (h && h.lateBedtimeRatio != null && h.lateBedtimeRatio > 0.5)
        ? "watch"
        : levelFromScore(recoveryScore);

  // ── Area summaries ──

  const areas: AttentionArea[] = [
    {
      key: "work",
      ...AREA_META.work,
      score: workScore,
      level: workLevel,
      summary: `${stats.activeCount} active · ${stats.inboxCount} inbox · ${totalFocusMinutes} мин фокуса`,
      insight: attentionProject
        ? `Следующий рычаг — ${attentionProject.name}: ${attentionProject.nextStep}`
        : focusSnapshot.primaryTask
          ? `Держи один главный рычаг: ${focusSnapshot.primaryTask.title}`
          : "Агенту нужен один ясный рабочий next step.",
      evidence: [
        `${stats.doneThisWeek} задач завершено за неделю`,
        attentionProject
          ? `Проект требует внимания: ${attentionProject.name}`
          : "Нет красного проектного сигнала",
      ],
    },
    {
      key: "health",
      ...AREA_META.health,
      score: healthScore,
      level: healthLevel,
      summary: h
        ? `Сон ${h.sleepHoursAvg ?? "?"}ч (${h.sleepQualityAvg ?? "?"}/10) · шаги ${h.stepsAvg ?? "?"} · ${h.trainingDaysWeek} тренировок · ${stats.habitsToday.done}/${stats.habitsToday.total} привычек`
        : `${stats.habitsToday.done}/${stats.habitsToday.total} привычек · ${flaggedMedicalParams} флагов`,
      insight: h
        ? intradayWorsening
          ? intraday.summary
          : intradayImproving
            ? `${intraday.summary} Значит, остаток дня можно перестраивать без panic mode, но не ломая recovery.`
            : h.lateBedtimeRatio != null && h.lateBedtimeRatio > 0.7
          ? `Ложишься после часа ночи ${Math.round(h.lateBedtimeRatio * 100)}% дней — это #1 рычаг для здоровья и самочувствия.`
          : h.stepsGoalRatio != null && h.stepsGoalRatio < 0.7
            ? `Шаги ${h.stepsAvg ?? "?"} при цели ${h.stepsGoalRatio != null ? Math.round((h.stepsAvg ?? 0) / (h.stepsGoalRatio || 1)) : "?"} — NEAT-активность проседает.`
            : "HEYS показывает, что health-база держится — важно не дать ей исчезнуть."
        : flaggedMedicalParams > 0
          ? "Сначала понять красные медицинские сигналы."
          : habitRatio < 0.67
            ? "Минимальный health floor: сон, растяжка, один телесный блок."
            : "Health-база держится.",
      evidence: [
        ...(h
          ? [
              ...(heysDayMode
                ? [
                    `HEYS: режим дня ${heysDayMode.label} → фокус ${getMetricLabel(heysDayMode.focusMetricKey).toLowerCase()}`,
                  ]
                : []),
              ...(intraday ? [`HEYS: ${intraday.summary}`] : []),
              `HEYS: вес ${h.weightCurrent ?? "?"}кг (цель ${h.weightGoal ?? "?"}кг, Δ30д: ${h.weightDelta30d != null ? `${h.weightDelta30d > 0 ? "+" : ""}${h.weightDelta30d}кг` : "?"})`,
              `HEYS: настроение ${h.moodAvg ?? "?"}/10, самочувствие ${h.wellbeingAvg ?? "?"}/10, стресс ${h.stressAvg ?? "?"}/10`,
            ]
          : []),
        latestMedicalDate
          ? `Последний медсигнал: ${latestMedicalDate}`
          : "Медицинских записей нет",
        `${upcoming.health} health-окон за 7 дней`,
      ],
    },
    {
      key: "family",
      ...AREA_META.family,
      score: familyScore,
      level: familyLevel,
      summary: `${upcoming.family} семейных · ${upcoming.studio} студийных за 7 дней`,
      insight:
        upcoming.studio > 0
          ? "Студия съедает внимание — семейные окна нужно защитить."
          : birthdayProject
            ? `Семейный проект: ${birthdayProject.name}.`
            : "Хорошее время усилить семейную часть.",
      evidence: [
        birthdayProject
          ? `Семейный проект: ${birthdayProject.name}`
          : "Нет семейного проекта",
        `${familySignals} семейных сигнала в записях`,
      ],
    },
    {
      key: "operations",
      ...AREA_META.operations,
      score: operationsScore,
      level: operationsLevel,
      summary: `${stats.inboxCount} inbox · ${focusSnapshot.overdueCount} overdue · ${upcoming.cleanup} cleanup`,
      insight:
        focusSnapshot.overdueCount > 0
          ? "Сначала расчистить хвосты."
          : "Операционный слой спокойный.",
      evidence: [
        `${tasks.filter((t) => t.status === "active" || t.status === "inbox").length} живых задач`,
        `${upcoming.studio} событий студии`,
      ],
    },
    {
      key: "reflection",
      ...AREA_META.reflection,
      score: reflectionScore,
      level: reflectionLevel,
      summary: `${recentJournal.length} записей за 3 дня · ${upcoming.review} review-окна`,
      insight:
        recentJournal.length === 0
          ? "Без разбора агенту сложнее отличить приоритет от шума."
          : upcoming.review === 0
            ? "Осмысление есть, но нужен закреплённый слот."
            : "Рефлексия встроена в ритм.",
      evidence: [
        `${reflectionSignals} записей review/planning/focus`,
        recentJournal.length > 0
          ? `Последняя запись ${daysSince(recentJournal[recentJournal.length - 1]!.createdAt)} дн. назад`
          : "Записей пока нет",
      ],
    },
    {
      key: "recovery",
      ...AREA_META.recovery,
      score: recoveryScore,
      level: recoveryLevel,
      summary: h
        ? `Сон ${h.sleepHoursAvg ?? "?"}ч · качество ${h.sleepQualityAvg ?? "?"}/10 · поздний отход ${h.lateBedtimeRatio != null ? Math.round(h.lateBedtimeRatio * 100) : "?"}% · ${upcoming.personal} личных окон`
        : `${upcoming.personal} личных окон · сон ${sleepChecked ? "✓" : "✗"}`,
      insight: h
        ? intradayWorsening
          ? `${intraday.summary} ${intraday.detail}`
          : intradayImproving
            ? `${intraday.summary} Это хороший момент защитить recovery-окно и не разменять выровнявшийся фон.`
            : h.lateBedtimeRatio != null && h.lateBedtimeRatio > 0.8
          ? `100% дней ложишься после 01:00 — это главная слепая зона recovery. Без сдвига засыпания всё остальное работает на половину.`
          : (h.sleepQualityAvg ?? 10) < 5
            ? `Качество сна ${h.sleepQualityAvg}/10 — recovery под давлением даже при достаточной длительности.`
            : (h.wellbeingAvg ?? 10) < 6.5
              ? `Самочувствие ${h.wellbeingAvg}/10 при низком стрессе ${h.stressAvg}/10 — скорее всего, недосып и низкая активность.`
              : "Recovery выглядит стабильно по данным HEYS."
        : !sleepChecked && upcoming.personal === 0
          ? "Восстановление не защищено."
          : upcoming.personal < 2
            ? "Восстановление хрупкое — стоит усилить."
            : "Ритм восстановления заметен.",
      evidence: [
        ...(h
          ? [
              ...(heysDayMode
                ? [
                    `HEYS: стратегия дня — ${heysDayMode.calendarStrategy}`,
                  ]
                : []),
              ...(intradayWorsening && intraday?.detail ? [`HEYS: ${intraday.detail}`] : []),
              `HEYS: сон ${h.sleepHoursAvg ?? "?"}ч, качество ${h.sleepQualityAvg ?? "?"}/10`,
              `HEYS: поздний отход ко сну ${h.lateBedtimeRatio != null ? Math.round(h.lateBedtimeRatio * 100) : "?"}% дней`,
              `HEYS: вода ${h.waterAvg ?? "?"}мл/день`,
            ]
          : []),
        `${upcoming.personal} personal + ${upcoming.health} health слотов`,
        sleepChecked ? "Сон отмечен" : "Сон не отмечен",
      ],
    },
  ];

  // ── Priorities ──

  const candidates: PriorityCandidate[] = [];

  pushPriority(
    candidates,
    focusSnapshot.overdueCount > 0
      ? {
          id: "ops-overdue",
          title: "Разгрести просрочку",
          reason: `${focusSnapshot.overdueCount} задач просрочены.`,
          action:
            "Разобрать хвосты: удалить, перенести или сделать первым.",
          href: "/tasks",
          level: focusSnapshot.overdueCount >= 3 ? "critical" : "watch",
          weight: 100 + focusSnapshot.overdueCount * 5,
        }
      : null,
  );

  pushPriority(
    candidates,
    attentionProject
      ? {
          id: `project-${attentionProject.id}`,
          title: `Защитить next step по ${attentionProject.name}`,
          reason: "Проект требует внимания.",
          action: "Развернуть next step в 2–3 действия.",
          href: `/projects?open=${attentionProject.id}`,
          level: attentionProject.status === "red" ? "critical" : "watch",
          weight: attentionProject.status === "red" ? 96 : 86,
        }
      : null,
  );

  pushPriority(
    candidates,
    intradayWorsening
      ? {
          id: "heys-intraday-drift",
          title:
            intraday?.status === "critical"
              ? "Быстро перестроить день по live-сигналу HEYS"
              : "Подстроить день под live-сдвиг HEYS",
          reason: intraday?.summary ?? "HEYS внутри дня уже показывает сдвиг состояния.",
          action:
            intraday?.status === "critical"
              ? "Срезать остаток дня до одного мягкого узла, защитить ближайшее recovery-окно и не добавлять новый execution."
              : "Проверить ближайшие окна, убрать лишнее и подстроить остаток дня под самочувствие / стресс, пока сигнал ещё живой.",
          href: "/calendar",
          level: intraday?.status === "critical" ? "critical" : "watch",
          weight: intraday?.status === "critical" ? 95 : 82,
        }
      : null,
  );

  pushPriority(
    candidates,
    heysDayMode
      ? getDayModePriorityHint(heysDayMode)
      : null,
  );

  pushPriority(
    candidates,
    healthLevel !== "good"
      ? {
          id: "health-floor",
          title: "Не отдавать здоровье на потом",
          reason: h
            ? `HEYS: шаги ${h.stepsAvg ?? "?"}/${h.stepsGoalRatio != null ? Math.round((h.stepsAvg ?? 0) / (h.stepsGoalRatio || 1)) : "?"}, тренировок ${h.trainingDaysWeek}/нед, вес ${h.weightCurrent ?? "?"}→${h.weightGoal ?? "?"}кг.`
            : flaggedMedicalParams > 0
              ? `${flaggedMedicalParams} медицинских флага.`
              : "Health-база проседает.",
          action:
            "Зафиксировать минимальный health floor: сон, растяжка, бег.",
          href: "/medical",
          level: healthLevel,
          weight: healthLevel === "critical" ? 94 : 72,
        }
      : null,
  );

  // HEYS-specific: late bedtime blind spot priority
  pushPriority(
    candidates,
    h && h.lateBedtimeRatio != null && h.lateBedtimeRatio > 0.7
      ? {
          id: "heys-sleep-blindspot",
          title: "Сдвинуть засыпание раньше",
          reason: `HEYS показывает: ${Math.round(h.lateBedtimeRatio * 100)}% дней ложишься после 01:00, качество сна ${h.sleepQualityAvg ?? "?"}/10. Это подрывает всё остальное.`,
          action: "Установить alarm «готовиться ко сну» на 00:00. Начать с 15-минутного сдвига каждые 3 дня.",
          href: "/routines",
          level: h.lateBedtimeRatio > 0.9 ? "critical" : "watch",
          weight: h.lateBedtimeRatio > 0.9 ? 92 : 78,
        }
      : null,
  );

  pushPriority(
    candidates,
    familyLevel !== "good" && upcoming.studio > 0
      ? {
          id: "family-protection",
          title: "Защитить семейные окна",
          reason: `${upcoming.studio} студийных событий могут съесть семейную часть.`,
          action: "Накидать семейные буферы на 3–7 дней.",
          href: "/calendar",
          level: familyLevel,
          weight: familyLevel === "critical" ? 88 : 70,
        }
      : null,
  );

  pushPriority(
    candidates,
    reflectionLevel !== "good"
      ? {
          id: "reflection-reset",
          title: "Сделать короткий review",
          reason: "Мало осмысления — система превращается в склад задач.",
          action: "Опиши агенту, что происходит, что буксует.",
          href: "/journal",
          level: reflectionLevel,
          weight: reflectionLevel === "critical" ? 76 : 62,
        }
      : null,
  );

  pushPriority(
    candidates,
    recoveryLevel !== "good"
      ? {
          id: "recovery-protect",
          title: "Восстановление обязательно",
          reason:
            "Если recovery не видно, оно проигрывает случайной срочности.",
          action: "Создать невыбиваемое окно восстановления.",
          href: "/routines",
          level: recoveryLevel,
          weight: recoveryLevel === "critical" ? 74 : 58,
        }
      : null,
  );

  if (candidates.length === 0) {
    candidates.push({
      id: "maintain-balance",
      title: "Удерживать баланс",
      reason: "Нет явных красных дыр.",
      action: "Продолжай рассказывать агенту, что происходит.",
      href: "/",
      level: "good",
      weight: 1,
    });
  }

  const priorities = candidates
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map(({ weight: _, ...p }) => p);

  const orderedAreas = [...areas].sort((a, b) => a.score - b.score);
  const weakestAreas = orderedAreas.slice(0, 2);
  const criticalAreas = areas.filter((a) => a.level === "critical");
  const balanceScore = clamp(
    areas.reduce((sum, a) => sum + a.score, 0) / areas.length,
  );
  const weakestLabels = weakestAreas.map((a) => a.label.toLowerCase()).join(" и ");
  const criticalLabels = criticalAreas.map((a) => a.label.toLowerCase()).join(", ");

  return {
    balanceScore,
    modeStatement:
      heysDayMode
        ? `${getDayModeStatement(heysDayMode)} Главный интерфейс — диалог с агентами: рассказываешь, что происходит, а они собирают панель и защищают приоритеты.`
        : "Главный интерфейс — диалог с агентами в Copilot/Codex. Рассказываешь, что происходит, а агенты собирают панель и защищают приоритеты.",
    narrative:
      criticalAreas.length > 0
        ? `Радар слепых зон: прежде всего выровнять ${criticalLabels}.${heysDayMode ? ` HEYS при этом ставит день в ${heysDayMode.label} и тянет фокус к ${getMetricLabel(heysDayMode.focusMetricKey).toLowerCase()}.` : ""}`
        : `Самые тонкие зоны — ${weakestLabels}; агенту стоит держать их в поле зрения.${heysDayMode ? ` HEYS ведёт день как ${heysDayMode.label}: ${heysDayMode.summary}` : ""}`,
    areas,
    priorities,
    heysDayMode,
    heysIntradaySignal: intraday as HeysIntradaySignal | null,
  };
}
