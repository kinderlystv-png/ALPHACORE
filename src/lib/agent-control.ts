import { getChecks, DEFAULT_HABITS, isActiveOn } from "./habits";
import { getJournalEntries } from "./journal";
import { getEntries, paramStatus } from "./medical";
import { getFocusSnapshot, getWeeklyFocusReport, getActivityStats } from "./productivity";
import { getProjects } from "./projects";
import { getScheduleForDate, type ScheduleSlot } from "./schedule";
import { dateStr } from "./storage";
import { getTasks } from "./tasks";
import { getHeysSignals } from "./use-heys-sync";
import type { HeysHealthSignals } from "./heys-bridge";

export type AttentionAreaKey =
  | "work"
  | "health"
  | "family"
  | "operations"
  | "reflection"
  | "recovery";

export type AttentionLevel = "good" | "watch" | "critical";

export type AttentionArea = {
  key: AttentionAreaKey;
  label: string;
  emoji: string;
  href: string;
  score: number;
  level: AttentionLevel;
  summary: string;
  insight: string;
  evidence: string[];
};

export type AgentPriority = {
  id: string;
  title: string;
  reason: string;
  action: string;
  href: string;
  level: AttentionLevel;
};

export type AgentControlSnapshot = {
  balanceScore: number;
  narrative: string;
  modeStatement: string;
  areas: AttentionArea[];
  priorities: AgentPriority[];
};

type UpcomingScheduleStats = {
  family: number;
  health: number;
  personal: number;
  review: number;
  cleanup: number;
  studio: number;
};

type PriorityCandidate = AgentPriority & {
  weight: number;
};

const AREA_META: Record<
  AttentionAreaKey,
  { label: string; emoji: string; href: string }
> = {
  work: {
    label: "Работа",
    emoji: "💼",
    href: "/projects",
  },
  health: {
    label: "Здоровье",
    emoji: "🫀",
    href: "/medical",
  },
  family: {
    label: "Семья",
    emoji: "🏡",
    href: "/calendar",
  },
  operations: {
    label: "Операционка",
    emoji: "🧹",
    href: "/tasks",
  },
  reflection: {
    label: "Осмысление",
    emoji: "🧠",
    href: "/journal",
  },
  recovery: {
    label: "Восстановление",
    emoji: "🌙",
    href: "/routines",
  },
};

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function daysSince(dateLike: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const target = new Date(dateLike);
  target.setHours(0, 0, 0, 0);

  return Math.floor((now.getTime() - target.getTime()) / 86_400_000);
}

function collectUpcomingSchedule(days = 7): ScheduleSlot[] {
  const slots: ScheduleSlot[] = [];

  for (let index = 0; index < days; index += 1) {
    const date = new Date();
    date.setDate(date.getDate() + index);
    slots.push(...getScheduleForDate(date));
  }

  return slots;
}

function getUpcomingScheduleStats(slots: ScheduleSlot[]): UpcomingScheduleStats {
  return slots.reduce<UpcomingScheduleStats>(
    (acc, slot) => {
      if (slot.tone === "family") acc.family += 1;
      if (slot.tone === "health") acc.health += 1;
      if (slot.tone === "personal") acc.personal += 1;
      if (slot.tone === "review") acc.review += 1;
      if (slot.tone === "cleanup") acc.cleanup += 1;
      if (slot.tone === "kinderly") acc.studio += 1;
      return acc;
    },
    {
      family: 0,
      health: 0,
      personal: 0,
      review: 0,
      cleanup: 0,
      studio: 0,
    },
  );
}

function levelFromScore(score: number): AttentionLevel {
  if (score >= 72) return "good";
  if (score >= 50) return "watch";
  return "critical";
}

function pushPriority(
  list: PriorityCandidate[],
  candidate: PriorityCandidate | null,
): void {
  if (candidate) list.push(candidate);
}

export function getAgentControlSnapshot(): AgentControlSnapshot {
  const today = dateStr();
  const todaySlots = getScheduleForDate(today);
  const tasks = getTasks();
  const projects = getProjects();
  const stats = getActivityStats();
  const focusSnapshot = getFocusSnapshot();
  const weeklyReport = getWeeklyFocusReport();
  const journalEntries = getJournalEntries();
  const medEntries = getEntries();
  const h: HeysHealthSignals | null = getHeysSignals();
  const upcomingSlots = collectUpcomingSchedule(7);
  const upcoming = getUpcomingScheduleStats(upcomingSlots);
  const todayCleanupSlots = todaySlots.filter((slot) => slot.tone === "cleanup");
  const todayChecks = getChecks(today);
  const activeHabitsToday = DEFAULT_HABITS.filter((habit) =>
    isActiveOn(habit, new Date().getDay()),
  );
  const habitRatio =
    activeHabitsToday.length > 0
      ? stats.habitsToday.done / activeHabitsToday.length
      : 1;
  const flaggedMedicalParams = medEntries
    .flatMap((entry) => entry.params)
    .filter((param) => {
      const status = paramStatus(param);
      return status === "low" || status === "high";
    }).length;
  const latestMedicalDate = [...medEntries]
    .sort((a, b) => b.date.localeCompare(a.date))[0]?.date;
  const recentJournal = journalEntries.filter(
    (entry) => daysSince(entry.createdAt) <= 3,
  );
  const reflectionSignals = recentJournal.filter((entry) =>
    entry.tags.some((tag) =>
      ["review", "planning", "focus", "reflection"].includes(tag),
    ),
  ).length;
  const familySignals = recentJournal.filter((entry) =>
    entry.tags.some((tag) => ["family", "danya", "studio"].includes(tag)),
  ).length;
  const sleepChecked = Boolean(todayChecks.sleep);
  const attentionProject = focusSnapshot.attentionProject;
  const birthdayProject = projects.find((project) => /др|день рождения|minecraft/i.test(project.name));

  const workScore = clamp(
    56 +
      Math.min(weeklyReport.totalFocusMinutes, 180) / 6 +
      Math.min(stats.doneThisWeek, 5) * 4 +
      (focusSnapshot.primaryTask ? 8 : 0) -
      focusSnapshot.overdueCount * 8 -
      (attentionProject ? 10 : 0),
  );
  // Health: blend ALPHACORE habits with real HEYS biometrics
  const heysHealthBonus = h
    ? (
        Math.min((h.sleepQualityAvg ?? 5) * 1, 10) +
        Math.min((h.stepsGoalRatio ?? 0.5) * 12, 12) +
        Math.min(h.trainingDaysWeek, 4) * 2 -
        (h.lateBedtimeRatio != null ? h.lateBedtimeRatio * 8 : 0)
      )
    : 0;
  const healthScore = clamp(
    (h ? 30 : 44) +
      habitRatio * (h ? 20 : 32) +
      heysHealthBonus +
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
        Math.min(((h.sleepHoursAvg ?? 7) / 8) * 15, 15) +
        Math.min((h.sleepQualityAvg ?? 5) * 0.8, 8) +
        Math.min((h.wellbeingAvg ?? 6) * 0.8, 8) -
        (h.lateBedtimeRatio != null ? h.lateBedtimeRatio * 12 : 0) -
        (h.moodAvg != null && h.moodAvg < 6 ? (6 - h.moodAvg) * 2 : 0)
      )
    : 0;
  const recoveryScore = clamp(
    (h ? 28 : 40) +
      heysRecoveryBonus +
      Math.min(upcoming.personal, 3) * (h ? 8 : 12) +
      (sleepChecked ? (h ? 10 : 22) : 0) +
      Math.min(upcoming.health, 2) * 5 -
      Math.min(upcoming.cleanup, 2) * 6 -
      Math.max(0, upcoming.studio - upcoming.personal - upcoming.family) * 4,
  );

  const workLevel: AttentionLevel =
    focusSnapshot.overdueCount >= 3 || attentionProject?.status === "red"
      ? "critical"
      : focusSnapshot.overdueCount > 0 || Boolean(attentionProject)
        ? "watch"
        : levelFromScore(workScore);
  const healthLevel: AttentionLevel =
    habitRatio < 0.34 || flaggedMedicalParams >= 2 || (h && h.stepsGoalRatio != null && h.stepsGoalRatio < 0.5 && h.trainingDaysWeek <= 1)
      ? "critical"
      : habitRatio < 0.67 || flaggedMedicalParams > 0 || (h && h.stepsGoalRatio != null && h.stepsGoalRatio < 0.7)
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
      : focusSnapshot.overdueCount > 0 || stats.inboxCount >= 4 || upcoming.cleanup > 0
        ? "watch"
        : levelFromScore(operationsScore);
  const reflectionLevel: AttentionLevel =
    recentJournal.length === 0 && upcoming.review === 0
      ? "critical"
      : recentJournal.length < 2 || upcoming.review === 0
        ? "watch"
        : levelFromScore(reflectionScore);
  const recoveryLevel: AttentionLevel =
    (!sleepChecked && upcoming.personal === 0) || (h && h.lateBedtimeRatio != null && h.lateBedtimeRatio > 0.8 && (h.sleepQualityAvg ?? 10) < 5)
      ? "critical"
      : upcoming.personal < 2 || (h && h.lateBedtimeRatio != null && h.lateBedtimeRatio > 0.5)
        ? "watch"
        : levelFromScore(recoveryScore);

  const areas: AttentionArea[] = [
    {
      key: "work",
      label: AREA_META.work.label,
      emoji: AREA_META.work.emoji,
      href: AREA_META.work.href,
      score: workScore,
      level: workLevel,
      summary: `${stats.activeCount} active · ${stats.inboxCount} inbox · ${weeklyReport.totalFocusMinutes} мин фокуса`,
      insight: attentionProject
        ? `Следующий рычаг — ${attentionProject.name}: ${attentionProject.nextStep}`
        : focusSnapshot.primaryTask
          ? `Держи один главный рычаг: ${focusSnapshot.primaryTask.title}`
          : "Агенту нужен один ясный рабочий next step, иначе внимание расползётся.",
      evidence: [
        `${stats.doneThisWeek} задач завершено за неделю`,
        attentionProject
          ? `Проект требует внимания: ${attentionProject.name}`
          : "Нет красного проектного сигнала",
      ],
    },
    {
      key: "health",
      label: AREA_META.health.label,
      emoji: AREA_META.health.emoji,
      href: AREA_META.health.href,
      score: healthScore,
      level: healthLevel,
      summary: h
        ? `Сон ${h.sleepHoursAvg ?? "?"}ч (${h.sleepQualityAvg ?? "?"}/10) · шаги ${h.stepsAvg ?? "?"} · ${h.trainingDaysWeek} тренировок · ${stats.habitsToday.done}/${stats.habitsToday.total} привычек`
        : `${stats.habitsToday.done}/${stats.habitsToday.total} привычек сегодня · ${flaggedMedicalParams} флагов`,
      insight: h
        ? h.lateBedtimeRatio != null && h.lateBedtimeRatio > 0.7
          ? `Ложишься после часа ночи ${Math.round(h.lateBedtimeRatio * 100)}% дней — это #1 рычаг для здоровья.`
          : h.stepsGoalRatio != null && h.stepsGoalRatio < 0.7
            ? `Шаги ${h.stepsAvg ?? "?"} — NEAT-активность проседает.`
            : "HEYS показывает, что health-база держится."
        : flaggedMedicalParams > 0
          ? "Здоровье нельзя оставлять фоном: сначала понять красные сигналы, потом усиливать нагрузку."
          : todayCleanupSlots.length > 0
            ? "Сегодня уже есть cleanup-нагрузка — не нужно автоматически дублировать её отдельным cardio; важнее щадящий floor и восстановление."
          : habitRatio < 0.67
            ? "Минимальный health floor на день: сон, растяжка и один телесный блок."
            : "База держится — агенту важно лишь не дать здоровью снова исчезнуть из поля зрения.",
      evidence: [
        ...(h
          ? [
              `HEYS: вес ${h.weightCurrent ?? "?"}кг (цель ${h.weightGoal ?? "?"}кг, Δ30д: ${h.weightDelta30d != null ? `${h.weightDelta30d > 0 ? "+" : ""}${h.weightDelta30d}кг` : "?"})`,
              `HEYS: настроение ${h.moodAvg ?? "?"}/10, самочувствие ${h.wellbeingAvg ?? "?"}/10, стресс ${h.stressAvg ?? "?"}/10`,
            ]
          : []),
        latestMedicalDate
          ? `Последний медсигнал: ${latestMedicalDate}`
          : "Медицинских записей пока нет",
        `${upcoming.health} health-окон и ${upcoming.cleanup} cleanup-нагрузок в ближайшие 7 дней`,
      ],
    },
    {
      key: "family",
      label: AREA_META.family.label,
      emoji: AREA_META.family.emoji,
      href: AREA_META.family.href,
      score: familyScore,
      level: familyLevel,
      summary: `${upcoming.family} семейных окон · ${upcoming.studio} студийных событий за 7 дней`,
      insight:
        upcoming.studio > 0
          ? "Студия уже съедает внимание — семейные окна должны быть защищены заранее, а не по остаточному принципу."
          : birthdayProject
            ? `Есть семейный проект в фокусе: ${birthdayProject.name}.`
            : "Если неделя кажется свободной — это лучшее время усилить семейную часть заранее.",
      evidence: [
        birthdayProject
          ? `Семейный проект: ${birthdayProject.name}`
          : "Нет отдельного семейного проекта в панели",
        `${familySignals} семейных сигнала в последних записях`,
      ],
    },
    {
      key: "operations",
      label: AREA_META.operations.label,
      emoji: AREA_META.operations.emoji,
      href: AREA_META.operations.href,
      score: operationsScore,
      level: operationsLevel,
      summary: `${stats.inboxCount} inbox · ${focusSnapshot.overdueCount} overdue · ${upcoming.cleanup} cleanup-окон`,
      insight:
        focusSnapshot.overdueCount > 0
          ? "Сначала расчистить хвосты, иначе даже хороший план будет ощущаться как шум."
          : upcoming.cleanup > 0
            ? "Операционка уже попала в расписание — осталось не дать ей разрастись и съесть фокус."
            : "Операционный слой сейчас спокойный, его задача — не пролезть обратно в главный слот дня.",
      evidence: [
        `${tasks.filter((task) => task.status === "active" || task.status === "inbox").length} живых задач в системе`,
        `${upcoming.studio} событий студии под возможную логистику`,
      ],
    },
    {
      key: "reflection",
      label: AREA_META.reflection.label,
      emoji: AREA_META.reflection.emoji,
      href: AREA_META.reflection.href,
      score: reflectionScore,
      level: reflectionLevel,
      summary: `${recentJournal.length} записей за 3 дня · ${upcoming.review} review-окна впереди`,
      insight:
        recentJournal.length === 0
          ? "Без короткого разбора агентам сложнее отличить реальный приоритет от случайного шума."
          : upcoming.review === 0
            ? "Осмысление есть, но ему нужен закреплённый слот — иначе инсайты растворяются в операционке."
            : "Рефлексия уже встроена в ритм — главное, не заменять её бесконечным скроллом задач.",
      evidence: [
        `${reflectionSignals} записей с тегами review/planning/focus`,
        recentJournal.length > 0
          ? `Последняя запись ${daysSince(recentJournal[recentJournal.length - 1]!.createdAt)} дн. назад`
          : "Последних записей пока нет",
      ],
    },
    {
      key: "recovery",
      label: AREA_META.recovery.label,
      emoji: AREA_META.recovery.emoji,
      href: AREA_META.recovery.href,
      score: recoveryScore,
      level: recoveryLevel,
      summary: h
        ? `Сон ${h.sleepHoursAvg ?? "?"}ч · качество ${h.sleepQualityAvg ?? "?"}/10 · поздний отход ${h.lateBedtimeRatio != null ? Math.round(h.lateBedtimeRatio * 100) : "?"}% · ${upcoming.personal} личных окон`
        : `${upcoming.personal} личных окон · сон ${sleepChecked ? "отмечен" : "не отмечен"}`,
      insight: h
        ? h.lateBedtimeRatio != null && h.lateBedtimeRatio > 0.8
          ? `${Math.round(h.lateBedtimeRatio * 100)}% дней ложишься после 01:00 — главная слепая зона recovery.`
          : (h.sleepQualityAvg ?? 10) < 5
            ? `Качество сна ${h.sleepQualityAvg}/10 — recovery под давлением даже при достаточной длительности.`
            : (h.wellbeingAvg ?? 10) < 6.5
              ? `Самочувствие ${h.wellbeingAvg}/10 при низком стрессе ${h.stressAvg}/10 — недосып и низкая активность.`
              : "Recovery стабильно по данным HEYS."
        : !sleepChecked && upcoming.personal === 0
          ? todayCleanupSlots.length > 0
            ? "Сегодня уже есть cleanup-нагрузка, а recovery не защищено — не дублируй день cardio и добавь окно восстановления."
            : "Если восстановление не защищено, система скатывается в героическую, но тупиковую гонку."
          : todayCleanupSlots.length > 0 || upcoming.cleanup > 0
            ? "Cleanup-дни дают реальную физическую нагрузку, поэтому recovery нужно защищать как обязательный слот, а не как бонус."
          : upcoming.personal < 2
            ? "Восстановление есть, но пока слишком хрупкое — агенту стоит сделать его невыбиваемым."
            : "Ритм восстановления уже заметен. Важно не разменять его на случайные срочности.",
      evidence: [
        ...(h
          ? [
              `HEYS: сон ${h.sleepHoursAvg ?? "?"}ч, качество ${h.sleepQualityAvg ?? "?"}/10`,
              `HEYS: поздний отход ${h.lateBedtimeRatio != null ? Math.round(h.lateBedtimeRatio * 100) : "?"}% дней`,
              `HEYS: вода ${h.waterAvg ?? "?"}мл/день`,
            ]
          : []),
        `${upcoming.personal} personal-слотов, ${upcoming.health} телесных и ${upcoming.cleanup} cleanup-слотов на 7 дней`,
        sleepChecked ? "Сон отмечен сегодня" : "Сегодня сон пока не закрыт",
      ],
    },
  ];

  const priorityCandidates: PriorityCandidate[] = [];

  pushPriority(
    priorityCandidates,
    focusSnapshot.overdueCount > 0
      ? {
          id: "ops-overdue",
          title: "Разгрести просрочку раньше нового планирования",
          reason: `${focusSnapshot.overdueCount} задач уже лежат хвостом и крадут внимание у всего остального.`,
          action: "Попроси агента разобрать хвосты: что удалить, что перенести, что сделать сегодня первым.",
          href: "/tasks",
          level: focusSnapshot.overdueCount >= 3 ? "critical" : "watch",
          weight: 100 + focusSnapshot.overdueCount * 5,
        }
      : null,
  );

  pushPriority(
    priorityCandidates,
    attentionProject
      ? {
          id: `project-${attentionProject.id}`,
          title: `Защитить следующий шаг по ${attentionProject.name}`,
          reason: "Проект уже требует внимания, но без одного явного next step он превращается в фоновую тревогу.",
          action: "Попроси агента развернуть текущий next step в 2–3 конкретных действия и выбрать одно главное на сегодня.",
          href: `/projects?open=${attentionProject.id}`,
          level: attentionProject.status === "red" ? "critical" : "watch",
          weight: attentionProject.status === "red" ? 96 : 86,
        }
      : null,
  );

  pushPriority(
    priorityCandidates,
    healthLevel !== "good"
      ? {
          id: "health-floor",
          title: "Не отдавать здоровье на потом",
          reason: h
            ? `HEYS: шаги ${h.stepsAvg ?? "?"}, тренировок ${h.trainingDaysWeek}/нед, вес ${h.weightCurrent ?? "?"}→${h.weightGoal ?? "?"}кг.`
            : flaggedMedicalParams > 0
              ? `Есть ${flaggedMedicalParams} медицинских флага — их нельзя маскировать продуктивностью.`
              : "Сегодняшняя health-база проседает и быстро делает всё остальное дороже по энергии.",
          action: "Попроси агента зафиксировать минимальный health floor на день: сон, растяжка, бег/прогулка и нужный follow-up по анализам.",
          href: "/medical",
          level: healthLevel,
          weight: healthLevel === "critical" ? 94 : 72,
        }
      : null,
  );

  // HEYS-specific: late bedtime blind spot priority
  pushPriority(
    priorityCandidates,
    h && h.lateBedtimeRatio != null && h.lateBedtimeRatio > 0.7
      ? {
          id: "heys-sleep-blindspot",
          title: "Сдвинуть засыпание раньше",
          reason: `HEYS: ${Math.round(h.lateBedtimeRatio * 100)}% дней ложишься после 01:00, качество сна ${h.sleepQualityAvg ?? "?"}/10. Это подрывает всё остальное.`,
          action: "Установить alarm «готовиться ко сну» на 00:00. Начать с 15-минутного сдвига каждые 3 дня.",
          href: "/routines",
          level: h.lateBedtimeRatio > 0.8 ? "critical" : "watch",
          weight: h.lateBedtimeRatio > 0.8 ? 92 : 78,
        }
      : null,
  );

  pushPriority(
    priorityCandidates,
    familyLevel !== "good" && upcoming.studio > 0
      ? {
          id: "family-protection",
          title: "Защитить семейные окна вокруг студии",
          reason: `${upcoming.studio} студийных события уже стоят в горизонте недели и могут незаметно съесть семейную часть.`,
          action: "Попроси агента накидать семейные буферы и логистику на 3–7 дней вперёд, пока неделя ещё управляемая.",
          href: "/calendar",
          level: familyLevel,
          weight: familyLevel === "critical" ? 88 : 70,
        }
      : null,
  );

  pushPriority(
    priorityCandidates,
    reflectionLevel !== "good"
      ? {
          id: "reflection-reset",
          title: "Сделать короткий агентский review",
          reason: "Когда осмысления мало, система снова превращается в склад задач без смысла и иерархии.",
          action: "Опиши агенту, что происходит, что буксует и что важно. Пусть он обновит фокус и панель вместо ручного перебора списков.",
          href: "/journal",
          level: reflectionLevel,
          weight: reflectionLevel === "critical" ? 76 : 62,
        }
      : null,
  );

  pushPriority(
    priorityCandidates,
    recoveryLevel !== "good"
      ? {
          id: "recovery-protect",
          title: "Поставить восстановление в разряд обязательного",
          reason: "Если recovery не видно в панели, оно почти всегда проигрывает случайной срочности.",
          action: "Попроси агента создать хотя бы одно невыбиваемое окно восстановления и увязать его с ритмом недели.",
          href: "/routines",
          level: recoveryLevel,
          weight: recoveryLevel === "critical" ? 74 : 58,
        }
      : null,
  );

  if (priorityCandidates.length === 0) {
    priorityCandidates.push({
      id: "maintain-balance",
      title: "Удерживать баланс, а не раздувать систему",
      reason: "Сейчас нет явных красных дыр — это лучший режим для спокойной работы через агентов, без нового ручного учёта.",
      action: "Продолжай просто рассказывать агенту, что происходит; ALPHACORE должен оставаться панелью, а не обязанностью.",
      href: "/",
      level: "good",
      weight: 1,
    });
  }

  const priorities = priorityCandidates
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map(({ weight: _, ...priority }) => priority);

  const orderedAreas = [...areas].sort((a, b) => a.score - b.score);
  const weakestAreas = orderedAreas.slice(0, 2);
  const criticalAreas = areas.filter((area) => area.level === "critical");
  const balanceScore = clamp(
    areas.reduce((sum, area) => sum + area.score, 0) / areas.length,
  );
  const weakestLabels = weakestAreas
    .map((area) => area.label.toLowerCase())
    .join(" и ");
  const criticalLabels = criticalAreas
    .map((area) => area.label.toLowerCase())
    .join(", ");

  return {
    balanceScore,
    modeStatement:
      "Главный интерфейс — диалог с агентами в Copilot/Codex. Ты не ведёшь базу вручную: рассказываешь, что происходит, а агенты собирают из этого наглядную панель и защищают приоритеты.",
    narrative:
      criticalAreas.length > 0
        ? `Сейчас это не трекер, а радар слепых зон: агенту прежде всего нужно выровнять ${criticalLabels}, а уже потом наращивать скорость.`
        : `Панель выглядит живой, когда помогает выбирать, а не заполнять. Сейчас самые тонкие зоны — ${weakestLabels}; агенту стоит держать их в поле зрения первым делом.`,
    areas,
    priorities,
  };
}
