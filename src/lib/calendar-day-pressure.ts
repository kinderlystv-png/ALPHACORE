import { getScheduleForDate, type ScheduleSlot } from "./schedule";

export type CalendarDayPressureLevel = "calm" | "loaded" | "overloaded";
export type CalendarDayPressureTone = "sky" | "violet" | "amber" | "rose" | "zinc";

export type CalendarDayPressure = {
  dateKey: string;
  score: number;
  slotsCount: number;
  parties: number;
  cleanup: number;
  family: number;
  planningWindows: number;
  recoveryWindows: number;
  isWeekend: boolean;
  level: CalendarDayPressureLevel;
  tone: CalendarDayPressureTone;
  badge: string;
  summary: string;
  detail: string;
};

function isPlanningWindowLike(slot: Pick<ScheduleSlot, "tone" | "title" | "tags">): boolean {
  const title = slot.title.toLowerCase();

  if (slot.tone === "review" || slot.tone === "work" || slot.tone === "heys" || slot.tone === "kinderly") {
    return true;
  }

  if (slot.tags.includes("planning") || slot.tags.includes("review") || slot.tags.includes("strategy")) {
    return true;
  }

  return (
    title.includes("план") ||
    title.includes("review") ||
    title.includes("стратег") ||
    title.includes("sprint") ||
    title.includes("focus")
  );
}

function isRecoveryWindowLike(slot: Pick<ScheduleSlot, "tone" | "title" | "tags">): boolean {
  const title = slot.title.toLowerCase();

  if (slot.tone === "personal") return true;
  if (slot.tags.includes("recovery") || slot.tags.includes("rest") || slot.tags.includes("stretch")) {
    return true;
  }

  return (
    title.includes("восстанов") ||
    title.includes("отдых") ||
    title.includes("сон") ||
    title.includes("stretch") ||
    title.includes("walk")
  );
}

function buildDetail(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" · ");
}

export function getCalendarDayPressure(input: {
  dateKey: string;
  slots?: ScheduleSlot[];
}): CalendarDayPressure {
  const slots = input.slots ?? getScheduleForDate(input.dateKey);
  const parties = slots.filter((slot) => slot.tone === "kinderly").length;
  const cleanup = slots.filter((slot) => slot.tone === "cleanup").length;
  const family = slots.filter((slot) => slot.tone === "family").length;
  const planningWindows = slots.filter(isPlanningWindowLike).length;
  const recoveryWindows = slots.filter(isRecoveryWindowLike).length;
  const score = parties * 6 + cleanup * 5 + family * 2 + slots.length;
  const date = new Date(`${input.dateKey}T00:00:00`);
  const isWeekend = [0, 6].includes(date.getDay());

  if (parties > 0 && cleanup > 0) {
    return {
      dateKey: input.dateKey,
      score,
      slotsCount: slots.length,
      parties,
      cleanup,
      family,
      planningWindows,
      recoveryWindows,
      isWeekend,
      level: "overloaded",
      tone: "rose",
      badge: "перегруз",
      summary: "не тащить новые хвосты",
      detail: buildDetail([`${parties} party`, `${cleanup} cleanup`, `${slots.length} слотов`]),
    };
  }

  if (parties > 0) {
    return {
      dateKey: input.dateKey,
      score,
      slotsCount: slots.length,
      parties,
      cleanup,
      family,
      planningWindows,
      recoveryWindows,
      isWeekend,
      level: "overloaded",
      tone: "rose",
      badge: "студия",
      summary: "оставить только главное",
      detail: buildDetail([`${parties} party`, cleanup > 0 ? `${cleanup} cleanup` : null, `${slots.length} слотов`]),
    };
  }

  if (cleanup > 0 && score >= 10) {
    return {
      dateKey: input.dateKey,
      score,
      slotsCount: slots.length,
      parties,
      cleanup,
      family,
      planningWindows,
      recoveryWindows,
      isWeekend,
      level: "loaded",
      tone: "amber",
      badge: "cleanup",
      summary: "не раздувать день",
      detail: buildDetail([`${cleanup} cleanup`, `${slots.length} слотов`, planningWindows > 0 ? `${planningWindows} planning` : null]),
    };
  }

  if (slots.length >= 7 || score >= 11) {
    return {
      dateKey: input.dateKey,
      score,
      slotsCount: slots.length,
      parties,
      cleanup,
      family,
      planningWindows,
      recoveryWindows,
      isWeekend,
      level: "loaded",
      tone: "amber",
      badge: "плотно",
      summary: "новое только по делу",
      detail: buildDetail([`${slots.length} слотов`, family > 0 ? `${family} family` : null, planningWindows > 0 ? `${planningWindows} planning` : null]),
    };
  }

  if (family > 0 && isWeekend) {
    return {
      dateKey: input.dateKey,
      score,
      slotsCount: slots.length,
      parties,
      cleanup,
      family,
      planningWindows,
      recoveryWindows,
      isWeekend,
      level: "calm",
      tone: "violet",
      badge: "семья",
      summary: "держать мягкий ритм",
      detail: buildDetail(["выходной", `${family} family`, recoveryWindows > 0 ? `${recoveryWindows} recovery` : null]),
    };
  }

  if (planningWindows > 0 && parties === 0 && cleanup === 0 && score <= 6) {
    return {
      dateKey: input.dateKey,
      score,
      slotsCount: slots.length,
      parties,
      cleanup,
      family,
      planningWindows,
      recoveryWindows,
      isWeekend,
      level: "calm",
      tone: "sky",
      badge: "под задачу",
      summary: "есть спокойное окно под фокус",
      detail: buildDetail([`${planningWindows} planning`, recoveryWindows > 0 ? `${recoveryWindows} recovery` : null, `${slots.length} слотов`]),
    };
  }

  if (recoveryWindows > 0 && parties === 0 && cleanup === 0 && score <= 6) {
    return {
      dateKey: input.dateKey,
      score,
      slotsCount: slots.length,
      parties,
      cleanup,
      family,
      planningWindows,
      recoveryWindows,
      isWeekend,
      level: "calm",
      tone: "violet",
      badge: "спокойно",
      summary: "под recovery или мягкий sprint",
      detail: buildDetail([`${recoveryWindows} recovery`, planningWindows > 0 ? `${planningWindows} planning` : null, `${slots.length} слотов`]),
    };
  }

  if (family > 0) {
    return {
      dateKey: input.dateKey,
      score,
      slotsCount: slots.length,
      parties,
      cleanup,
      family,
      planningWindows,
      recoveryWindows,
      isWeekend,
      level: "calm",
      tone: "violet",
      badge: "семья",
      summary: "не дробить день мелочами",
      detail: buildDetail([`${family} family`, `${slots.length} слотов`, recoveryWindows > 0 ? `${recoveryWindows} recovery` : null]),
    };
  }

  if (planningWindows > 0) {
    return {
      dateKey: input.dateKey,
      score,
      slotsCount: slots.length,
      parties,
      cleanup,
      family,
      planningWindows,
      recoveryWindows,
      isWeekend,
      level: "calm",
      tone: "sky",
      badge: "окно",
      summary: "можно положить один узел",
      detail: buildDetail([`${planningWindows} planning`, `${slots.length} слотов`, recoveryWindows > 0 ? `${recoveryWindows} recovery` : null]),
    };
  }

  return {
    dateKey: input.dateKey,
    score,
    slotsCount: slots.length,
    parties,
    cleanup,
    family,
    planningWindows,
    recoveryWindows,
    isWeekend,
    level: "calm",
    tone: "zinc",
    badge: "ровно",
    summary: "день ещё гибкий",
    detail: buildDetail([`${slots.length} слотов`, recoveryWindows > 0 ? `${recoveryWindows} recovery` : null]),
  };
}
