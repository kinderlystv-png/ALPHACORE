import { getScheduleForDate, type ScheduleSlot } from "./schedule";
import type { HeysHealthSignals } from "./heys-bridge";

export type HeysMetricKey =
  | "sleep"
  | "bedtime"
  | "steps"
  | "training"
  | "weight"
  | "mood"
  | "wellbeing"
  | "water"
  | "stress";

export type BundleContextProfile = {
  dateKey: string;
  dayLoad: number;
  parties: number;
  cleanup: number;
  family: number;
  tomorrowLoad: number;
  tomorrowParties: number;
  isMorning: boolean;
  isDaytime: boolean;
  isEvening: boolean;
  isLateEvening: boolean;
  isWeekend: boolean;
};

export type DayModeId = "execution" | "recovery" | "damage-control" | "light-rhythm";

export type DayMode = {
  id: DayModeId;
  label: string;
  tone: "good" | "warn" | "bad" | "neutral";
  summary: string;
  detail: string;
  focusMetricKey: HeysMetricKey;
  reasons: string[];
  calendarStrategy: string;
  forceActionKind: "task" | "slot" | null;
  preferBundle: boolean;
  bundleBiasIds: string[];
};

export type DayModePriorityHint = {
  id: string;
  title: string;
  reason: string;
  action: string;
  href: string;
  level: "good" | "watch" | "critical";
  weight: number;
};

function fmtNum(v: number | null | undefined, digits = 1): string {
  if (v == null) return "—";
  return digits === 0 ? String(Math.round(v)) : v.toFixed(digits);
}

function todayDateKey(offset = 0, baseDate = new Date()): string {
  const date = new Date(baseDate);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function getDayLoad(dateKey: string): {
  slots: ScheduleSlot[];
  score: number;
  parties: number;
  cleanup: number;
  family: number;
} {
  const slots = getScheduleForDate(dateKey);
  const parties = slots.filter((slot) => slot.tone === "kinderly").length;
  const cleanup = slots.filter((slot) => slot.tone === "cleanup").length;
  const family = slots.filter((slot) => slot.tone === "family").length;

  return {
    slots,
    parties,
    cleanup,
    family,
    score: parties * 6 + cleanup * 5 + family * 2 + slots.length,
  };
}

function pushUniqueReason(reasons: string[], text: string | null): void {
  if (!text || reasons.includes(text)) return;
  reasons.push(text);
}

function getDayModeFocusMetricKey(
  modeId: DayModeId,
  h: HeysHealthSignals,
  fallbackMetricKey: HeysMetricKey,
  sleepGoal: number | null | undefined,
): HeysMetricKey {
  const weightGap =
    h.weightCurrent != null && h.weightGoal != null
      ? h.weightCurrent - h.weightGoal
      : null;
  const sleepGap =
    h.sleepHoursAvg != null
      ? Math.max(0, (sleepGoal ?? 8) - h.sleepHoursAvg)
      : 0;

  switch (modeId) {
    case "damage-control":
      if ((h.stressAvg ?? 0) > 5) return "stress";
      if ((h.wellbeingAvg ?? 10) < 6) return "wellbeing";
      if ((h.lateBedtimeRatio ?? 0) > 0.7) return "bedtime";
      if ((h.waterAvg ?? 0) < 1500) return "water";
      return fallbackMetricKey;
    case "recovery":
      if ((h.lateBedtimeRatio ?? 0) > 0.65) return "bedtime";
      if (sleepGap > 0.6) return "sleep";
      if ((h.waterAvg ?? 0) < 1600) return "water";
      if ((h.wellbeingAvg ?? 10) < 6.6) return "wellbeing";
      return fallbackMetricKey;
    case "execution":
      if (h.trainingDaysWeek < 3) return "training";
      if (weightGap != null && weightGap > 4) return "weight";
      if ((h.stepsGoalRatio ?? 1) < 0.9) return "steps";
      if (fallbackMetricKey === "sleep" || fallbackMetricKey === "bedtime") {
        return "training";
      }
      return fallbackMetricKey;
    case "light-rhythm":
      if ((h.stepsGoalRatio ?? 1) < 0.85) return "steps";
      if ((h.waterAvg ?? 0) < 1800) return "water";
      if ((h.stressAvg ?? 0) > 4) return "stress";
      return fallbackMetricKey;
    default:
      return fallbackMetricKey;
  }
}

export function getMetricLabel(metricKey: HeysMetricKey): string {
  switch (metricKey) {
    case "sleep":
      return "Сон";
    case "bedtime":
      return "Отход ко сну";
    case "steps":
      return "Шаги";
    case "training":
      return "Тренировки";
    case "weight":
      return "Вес";
    case "mood":
      return "Настроение";
    case "wellbeing":
      return "Самочувствие";
    case "water":
      return "Вода";
    case "stress":
      return "Стресс";
  }
}

export function getDefaultMetricKey(h: HeysHealthSignals): HeysMetricKey {
  if (h.lateBedtimeRatio != null && h.lateBedtimeRatio > 0.7) return "bedtime";
  if (h.stepsGoalRatio != null && h.stepsGoalRatio < 0.7) return "steps";
  if ((h.wellbeingAvg ?? 10) < 6.5) return "wellbeing";
  if ((h.waterAvg ?? 0) < 1500) return "water";
  return "sleep";
}

export function buildBundleContextProfile(baseDate = new Date()): BundleContextProfile {
  const dateKey = todayDateKey(0, baseDate);
  const todayLoad = getDayLoad(dateKey);
  const tomorrowLoad = getDayLoad(todayDateKey(1, baseDate));
  const minutes = baseDate.getHours() * 60 + baseDate.getMinutes();

  return {
    dateKey,
    dayLoad: todayLoad.score,
    parties: todayLoad.parties,
    cleanup: todayLoad.cleanup,
    family: todayLoad.family,
    tomorrowLoad: tomorrowLoad.score,
    tomorrowParties: tomorrowLoad.parties,
    isMorning: minutes < 12 * 60,
    isDaytime: minutes >= 12 * 60 && minutes < 17 * 60,
    isEvening: minutes >= 17 * 60 && minutes < 21 * 60,
    isLateEvening: minutes >= 21 * 60,
    isWeekend: [0, 6].includes(baseDate.getDay()),
  };
}

export function getHeysDayMode(
  h: HeysHealthSignals,
  context: BundleContextProfile,
  fallbackMetricKey: HeysMetricKey,
  sleepGoal: number | null | undefined,
): DayMode {
  const lateRatio = h.lateBedtimeRatio ?? 0;
  const sleepHours = h.sleepHoursAvg ?? sleepGoal ?? 7.5;
  const sleepGap = Math.max(0, (sleepGoal ?? 8) - sleepHours);
  const wellbeing = h.wellbeingAvg ?? 7;
  const stress = h.stressAvg ?? 3;
  const sleepQuality = h.sleepQualityAvg ?? 6;
  const water = h.waterAvg ?? 1800;
  const stepsRatio = h.stepsGoalRatio ?? 1;
  const overloadedDay = context.dayLoad >= 10 || context.parties > 0 || context.cleanup > 0;
  const reasons: string[] = [];

  pushUniqueReason(reasons, lateRatio > 0.7 ? `${Math.round(lateRatio * 100)}% поздних отходов` : null);
  pushUniqueReason(reasons, sleepGap > 0.6 ? `сон ниже цели на ${fmtNum(sleepGap)}ч` : null);
  pushUniqueReason(reasons, wellbeing < 6.6 ? `самочувствие ${fmtNum(wellbeing)}/10` : null);
  pushUniqueReason(reasons, stress > 4.5 ? `стресс ${fmtNum(stress)}/10` : null);
  pushUniqueReason(reasons, water < 1600 ? `${fmtNum(water, 0)} мл воды` : null);
  pushUniqueReason(reasons, context.dayLoad >= 9 ? "день уже плотный" : null);
  pushUniqueReason(reasons, context.parties > 0 ? "есть party-нагрузка" : null);
  pushUniqueReason(reasons, context.cleanup > 0 ? "есть cleanup-слоты" : null);

  if (!h.hasRecentData) {
    return {
      id: "light-rhythm",
      label: "Light rhythm",
      tone: "neutral",
      summary: "HEYS ещё собирает базу, поэтому день лучше вести мягко, без ложной уверенности.",
      detail: "Пока сигнал сырой, автопилот удерживает лёгкий ритм и не разгоняет лишние commitments на пустом месте.",
      focusMetricKey: fallbackMetricKey,
      reasons: ["мало свежих check-in", "лучше не разгонять план вслепую"],
      calendarStrategy: "Ставить только мягкие якоря ритма и дождаться более плотного HEYS-сигнала.",
      forceActionKind: "slot",
      preferBundle: false,
      bundleBiasIds: ["movement-recovery-pair"],
    };
  }

  if (
    ((wellbeing < 5.8 || stress > 5.5 || sleepQuality < 4.5) && overloadedDay) ||
    ((lateRatio > 0.82 || sleepGap > 1) && stress > 5) ||
    (wellbeing < 5.4 && sleepQuality < 5)
  ) {
    return {
      id: "damage-control",
      label: "Damage control",
      tone: "bad",
      summary: "Сегодня не hero mode: сначала нужно снять шум и удержать базу, иначе день начнёт разваливаться сам.",
      detail: "Автопилот будет тянуть в защитные окна и короткие reset-связки, а не в ещё одну тяжёлую задачу поверх перегруза.",
      focusMetricKey: getDayModeFocusMetricKey("damage-control", h, fallbackMetricKey, sleepGoal),
      reasons: reasons.slice(0, 3),
      calendarStrategy: "Срезать лишний шум, защитить recovery-окно и only then решать, что из execution вообще нужно спасать.",
      forceActionKind: "slot",
      preferBundle: true,
      bundleBiasIds: ["sleep-hydration-reset", "review-shutdown-pair"],
    };
  }

  if (
    lateRatio > 0.65 ||
    sleepGap > 0.6 ||
    wellbeing < 6.6 ||
    water < 1600 ||
    stress > 4.5
  ) {
    return {
      id: "recovery",
      label: "Recovery mode",
      tone: "warn",
      summary: "База держится тонко: день лучше строить вокруг восстановления, а не вокруг силы воли.",
      detail: "Автопилот будет предпочитать защищённые окна и compound-мувы, которые мягко выправляют ритм без лишнего давления.",
      focusMetricKey: getDayModeFocusMetricKey("recovery", h, fallbackMetricKey, sleepGoal),
      reasons: reasons.slice(0, 3),
      calendarStrategy: "Защищать сон, воду, прогулку и recovery, а тяжёлые обещания переносить только после стабилизации фона.",
      forceActionKind: "slot",
      preferBundle: true,
      bundleBiasIds: ["sleep-hydration-reset", "movement-recovery-pair"],
    };
  }

  if (
    wellbeing >= 7 &&
    stress <= 3.5 &&
    sleepQuality >= 6 &&
    lateRatio < 0.45 &&
    stepsRatio >= 0.75
  ) {
    const executionReasons: string[] = [];
    pushUniqueReason(executionReasons, `самочувствие ${fmtNum(wellbeing)}/10`);
    pushUniqueReason(executionReasons, `стресс ${fmtNum(stress)}/10`);
    pushUniqueReason(executionReasons, `${Math.round(stepsRatio * 100)}% шаговой базы`);

    return {
      id: "execution",
      label: "Execution mode",
      tone: "good",
      summary: "Тело держит базу, поэтому сегодня можно давать нормальный execution без лишней цены для recovery.",
      detail: "Автопилот не выключает ритм, но уже может работать на прогресс: training, steps и долгие контуры вместо аварийных reset-действий.",
      focusMetricKey: getDayModeFocusMetricKey("execution", h, fallbackMetricKey, sleepGoal),
      reasons: executionReasons.slice(0, 3),
      calendarStrategy: "Можно брать полезные execution-шаги, пока хотя бы один якорь сна и recovery остаётся защищённым.",
      forceActionKind: null,
      preferBundle: false,
      bundleBiasIds: ["movement-recovery-pair", "weight-rhythm-pair"],
    };
  }

  return {
    id: "light-rhythm",
    label: "Light rhythm",
    tone: "neutral",
    summary: "День не аварийный, но и не тот случай, где стоит резко разгонять систему.",
    detail: "Автопилот держит мягкий ритм: короткие окна, умеренная нагрузка и без лишнего hero mode там, где ещё нет запаса.",
    focusMetricKey: getDayModeFocusMetricKey("light-rhythm", h, fallbackMetricKey, sleepGoal),
    reasons: reasons.slice(0, 3),
    calendarStrategy: "Держать день лёгким, распределять действия по неделе и не превращать средний фон в лишний стресс.",
    forceActionKind: "slot",
    preferBundle: false,
    bundleBiasIds: ["movement-recovery-pair", "weight-rhythm-pair"],
  };
}

export function getDayModePriorityHint(dayMode: DayMode): DayModePriorityHint | null {
  switch (dayMode.id) {
    case "damage-control":
      return {
        id: "heys-day-mode-damage-control",
        title: "Перевести день в damage control",
        reason: dayMode.reasons.length > 0
          ? `HEYS и календарь показывают режим damage control: ${dayMode.reasons.join(", ")}.`
          : dayMode.summary,
        action: dayMode.calendarStrategy,
        href: "/calendar",
        level: "critical",
        weight: 97,
      };
    case "recovery":
      return {
        id: "heys-day-mode-recovery",
        title: "Строить день как recovery mode",
        reason: dayMode.reasons.length > 0
          ? `Сегодня выгоднее чинить базу, чем наращивать нагрузку: ${dayMode.reasons.join(", ")}.`
          : dayMode.summary,
        action: dayMode.calendarStrategy,
        href: "/routines",
        level: "watch",
        weight: 84,
      };
    case "execution":
      return {
        id: "heys-day-mode-execution",
        title: `Использовать execution window через ${getMetricLabel(dayMode.focusMetricKey).toLowerCase()}`,
        reason: dayMode.reasons.length > 0
          ? `База держится: ${dayMode.reasons.join(", ")}.`
          : dayMode.summary,
        action: dayMode.calendarStrategy,
        href: "/projects",
        level: "good",
        weight: 56,
      };
    case "light-rhythm":
      return {
        id: "heys-day-mode-light-rhythm",
        title: "Держать день в light rhythm",
        reason: dayMode.reasons.length > 0
          ? `Сигнал не аварийный, но просит мягкого ритма: ${dayMode.reasons.join(", ")}.`
          : dayMode.summary,
        action: dayMode.calendarStrategy,
        href: "/calendar",
        level: "watch",
        weight: 52,
      };
    default:
      return null;
  }
}

export function getDayModeStatement(dayMode: DayMode): string {
  const focus = getMetricLabel(dayMode.focusMetricKey).toLowerCase();
  switch (dayMode.id) {
    case "damage-control":
      return `Сегодня ${dayMode.label}: агенту нужно защищать ${focus} и снимать шум, а не разгонять новые обязательства.`;
    case "recovery":
      return `Сегодня ${dayMode.label}: агенту лучше вести день через ${focus}, recovery-окна и мягкие связки вместо лишнего hero mode.`;
    case "execution":
      return `Сегодня ${dayMode.label}: база держится, поэтому агент может продвигать день через ${focus}, не ломая recovery.`;
    case "light-rhythm":
      return `Сегодня ${dayMode.label}: держим ${focus} и мягкий ритм, чтобы не превратить средний фон в новый перегруз.`;
  }
}
