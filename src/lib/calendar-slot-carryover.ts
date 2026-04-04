import { getSlotQuickRescheduleLabel } from "@/lib/calendar-slot-reschedule";
import { shiftDateKey } from "@/lib/calendar-slot-attention";
import { getScheduleForDate, timeToMinutes, type ScheduleSlot } from "@/lib/schedule";

export type SlotCarryoverDecision = {
  staleDays: number;
  badge: string;
  title: string;
  summary: string;
  tone: "rose" | "amber";
  allowUnscheduleTask: boolean;
};

export type SlotCarryoverAction =
  | {
      key: string;
      type: "move-slot";
      buttonLabel: string;
      description: string;
      hint?: string;
      priority: "primary" | "secondary";
      dateKey: string;
    }
  | {
      key: string;
      type: "unschedule-task";
      buttonLabel: string;
      description: string;
      hint?: string;
      priority: "primary" | "secondary";
    }
  | {
      key: string;
      type: "compress-slot";
      buttonLabel: string;
      description: string;
      hint?: string;
      priority: "primary" | "secondary";
      end: string;
    };

type SlotCarryoverDecisionInput = {
  slot: Pick<ScheduleSlot, "date" | "start" | "end" | "title" | "tags" | "taskId" | "tone">;
  todayKey: string;
  requiresApproval: boolean;
  isCompleted: boolean;
};

type CarryoverDayPressure = {
  dateKey: string;
  totalSlots: number;
  parties: number;
  cleanup: number;
  family: number;
  planningWindows: number;
  recoveryWindows: number;
  familyWindows: number;
  isWeekend: boolean;
  loadScore: number;
};

type CarryoverWindowPreference = "cleanup" | "recovery" | "planning" | "family" | "general";

function diffDays(fromDateKey: string, toDateKey: string): number {
  const fromDate = new Date(`${fromDateKey}T00:00:00`);
  const toDate = new Date(`${toDateKey}T00:00:00`);

  return Math.max(0, Math.round((fromDate.getTime() - toDate.getTime()) / 86_400_000));
}

function minutesToClock(minutes: number): string {
  const safeMinutes = Math.max(0, minutes);
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function getCompressTargetMinutes(durationMin: number): number | null {
  if (durationMin >= 120) return 60;
  if (durationMin >= 90) return 45;
  return null;
}

function getPreferredMoveTargets(slotDate: string, todayKey: string, staleDays: number): string[] {
  const tomorrowKey = shiftDateKey(todayKey, 1);
  const plusTwoKey = shiftDateKey(todayKey, 2);

  if (staleDays >= 2) {
    return [tomorrowKey, plusTwoKey, todayKey];
  }

  return [todayKey, tomorrowKey, plusTwoKey];
}

function isRecoveryWindowLike(slot: Pick<ScheduleSlot, "tone" | "title" | "tags">): boolean {
  const title = slot.title.toLowerCase();

  if (slot.tone === "personal") return true;
  if (slot.tags.includes("recovery") || slot.tags.includes("rest") || slot.tags.includes("stretch")) return true;

  return (
    title.includes("восстанов") ||
    title.includes("отдых") ||
    title.includes("сон") ||
    title.includes("stretch") ||
    title.includes("walk")
  );
}

function isPlanningWindowLike(slot: Pick<ScheduleSlot, "tone" | "title" | "tags">): boolean {
  const title = slot.title.toLowerCase();

  if (slot.tone === "review" || slot.tone === "work" || slot.tone === "heys") return true;
  if (slot.tags.includes("planning") || slot.tags.includes("review")) return true;

  return (
    title.includes("план") ||
    title.includes("review") ||
    title.includes("стратег") ||
    title.includes("decision") ||
    title.includes("sprint")
  );
}

function isFamilyWindowLike(slot: Pick<ScheduleSlot, "tone" | "title" | "tags">): boolean {
  const title = slot.title.toLowerCase();

  return slot.tone === "family" || slot.tags.includes("family") || title.includes("сем") || title.includes("доч");
}

function getCarryoverWindowPreference(
  slot: Pick<ScheduleSlot, "tone" | "title" | "tags" | "taskId">,
): CarryoverWindowPreference {
  if (slot.tone === "cleanup") return "cleanup";
  if (slot.tone === "family" || isFamilyWindowLike(slot)) return "family";
  if (slot.tone === "personal" || isRecoveryWindowLike(slot)) return "recovery";
  if (slot.tone === "work" || slot.tone === "review" || slot.tone === "heys" || slot.taskId) return "planning";
  return "general";
}

function getCarryoverDayPressure(dateKey: string): CarryoverDayPressure {
  const slots = getScheduleForDate(dateKey);
  const parties = slots.filter((slot) => slot.tone === "kinderly").length;
  const cleanup = slots.filter((slot) => slot.tone === "cleanup").length;
  const family = slots.filter((slot) => slot.tone === "family").length;
  const planningWindows = slots.filter(isPlanningWindowLike).length;
  const recoveryWindows = slots.filter(isRecoveryWindowLike).length;
  const familyWindows = slots.filter(isFamilyWindowLike).length;
  const date = new Date(`${dateKey}T00:00:00`);

  return {
    dateKey,
    totalSlots: slots.length,
    parties,
    cleanup,
    family,
    planningWindows,
    recoveryWindows,
    familyWindows,
    isWeekend: [0, 6].includes(date.getDay()),
    loadScore: parties * 6 + cleanup * 5 + family * 2 + slots.length,
  };
}

function buildCarryoverMoveHint(
  slot: Pick<ScheduleSlot, "tone" | "title" | "tags" | "taskId">,
  pressure: CarryoverDayPressure,
  buttonLabel: string,
): string {
  const preference = getCarryoverWindowPreference(slot);

  if (slot.tone === "cleanup") {
    if (pressure.parties === 0 && pressure.cleanup === 0) return `${buttonLabel} спокойнее: без party и cleanup`;
    if (pressure.parties === 0) return `${buttonLabel} спокойнее: без party-нагрузки`;
    if (pressure.cleanup === 0) return `${buttonLabel} чище по операционке: без второго cleanup`;
  }

  if (preference === "recovery") {
    if (pressure.recoveryWindows > 0 && pressure.parties === 0 && pressure.cleanup === 0) {
      return `${buttonLabel} лучше под recovery: есть тихое окно и меньше шума`;
    }

    if (pressure.recoveryWindows > 0) return `${buttonLabel} подходит под recovery: уже есть спокойный контур`;
    if (pressure.parties === 0 && pressure.cleanup === 0) return `${buttonLabel} тише по нагрузке`;
  }

  if (preference === "planning") {
    if (pressure.planningWindows > 0 && pressure.parties === 0 && pressure.cleanup === 0) {
      return `${buttonLabel} лучше под задачу: есть planning-окно и меньше шума`;
    }

    if (pressure.planningWindows > 0) return `${buttonLabel} удобнее: в дне уже есть рабочее окно`;
    if (pressure.parties === 0 && pressure.cleanup === 0) return `${buttonLabel} легче для фокуса`;
  }

  if (preference === "family") {
    if (pressure.familyWindows > 0) return `${buttonLabel} ближе к семейному контуру`;
    if (pressure.isWeekend) return `${buttonLabel} мягче по ритму: выходной`;
  }

  if (pressure.parties === 0 && pressure.cleanup === 0 && pressure.loadScore <= 6) return `${buttonLabel} спокойнее по дню`;
  if (pressure.cleanup === 0 && pressure.loadScore <= 9) return `${buttonLabel} без cleanup`;
  if (pressure.parties === 0 && pressure.loadScore <= 9) return `${buttonLabel} без party`;
  if (pressure.loadScore <= 7) return `${buttonLabel} мягче по нагрузке`;

  return `${buttonLabel} выглядит спокойнее по контуру`;
}

function scoreCarryoverMoveTarget(
  slot: Pick<ScheduleSlot, "tone" | "title" | "tags" | "taskId">,
  pressure: CarryoverDayPressure,
  todayKey: string,
  staleDays: number,
): number {
  const daysAhead = diffDays(pressure.dateKey, todayKey);
  const preference = getCarryoverWindowPreference(slot);
  let score = pressure.loadScore + daysAhead * 3;

  if (pressure.parties > 0) {
    score += slot.tone === "kinderly" ? 2 : slot.tone === "cleanup" ? 14 : 10;
  }

  if (pressure.cleanup > 0) {
    score += slot.tone === "cleanup" ? 8 : slot.tone === "personal" || slot.tone === "health" ? 10 : 7;
  }

  if (pressure.family > 0 && slot.tone !== "family") {
    score += 2;
  }

  if (preference === "planning") {
    if (pressure.planningWindows > 0) score -= 6;
    if (pressure.isWeekend && pressure.planningWindows === 0) score += 2;
  }

  if (preference === "recovery") {
    if (pressure.recoveryWindows > 0) score -= 7;
    if (pressure.parties === 0 && pressure.cleanup === 0 && pressure.loadScore <= 6) score -= 4;
  }

  if (preference === "family") {
    if (pressure.familyWindows > 0) score -= 5;
    if (pressure.isWeekend) score -= 4;
  }

  if (slot.taskId) {
    if (pressure.parties === 0 && pressure.cleanup === 0 && pressure.loadScore <= 6) score -= 5;
  } else if (slot.tone === "cleanup") {
    if (pressure.parties === 0 && pressure.cleanup === 0) score -= 6;
    if (pressure.dateKey === todayKey) score += 2;
  } else if (preference === "recovery") {
    if (pressure.parties === 0 && pressure.cleanup === 0 && pressure.loadScore <= 6) score -= 7;
  } else {
    if (pressure.parties === 0 && pressure.cleanup === 0 && pressure.loadScore <= 6) score -= 4;
  }

  if (staleDays >= 2 && pressure.dateKey === todayKey) {
    score += 6;
  }

  if (staleDays === 1 && pressure.dateKey === todayKey && pressure.loadScore <= 8) {
    score -= 2;
  }

  return score;
}

function getRankedCarryoverMoveTargets(
  slot: Pick<ScheduleSlot, "date" | "title" | "tags" | "tone" | "taskId">,
  todayKey: string,
  staleDays: number,
): Array<{
  dateKey: string;
  buttonLabel: string;
  description: string;
  hint: string;
  score: number;
}> {
  const candidateDates = Array.from({ length: 7 }, (_, index) => shiftDateKey(todayKey, index))
    .filter((dateKey) => dateKey !== slot.date);

  return candidateDates
    .map((dateKey) => {
      const labels = getSlotQuickRescheduleLabel(dateKey, todayKey);
      const pressure = getCarryoverDayPressure(dateKey);
      const hint = buildCarryoverMoveHint(slot, pressure, labels.buttonLabel);
      const score = scoreCarryoverMoveTarget(slot, pressure, todayKey, staleDays);

      return {
        dateKey,
        buttonLabel: labels.buttonLabel,
        description: `${labels.description} · ${hint}`,
        hint,
        score,
      };
    })
    .sort((left, right) => left.score - right.score || left.dateKey.localeCompare(right.dateKey));
}

export function getSlotCarryoverDecision({
  slot,
  todayKey,
  requiresApproval,
  isCompleted,
}: SlotCarryoverDecisionInput): SlotCarryoverDecision | null {
  if (!requiresApproval || isCompleted || slot.date >= todayKey) {
    return null;
  }

  const staleDays = diffDays(todayKey, slot.date);
  const tone = staleDays === 1 ? "rose" : "amber";

  if (slot.taskId) {
    return staleDays === 1
      ? {
          staleDays,
          badge: "Хвост со вчера",
          title: "Задача жива, устарел только слот",
          summary:
            "Лучший ход — быстро дать задаче новый день или вернуть её обратно в список без жёсткого времени.",
          tone,
          allowUnscheduleTask: true,
        }
      : {
          staleDays,
          badge: `Застрял ${staleDays} д.`,
          title: "Старый слот задачи уже тянет план назад",
          summary:
            "Не держи его красным хвостом: передвинь слот ближе или оставь задачу без привязки ко времени.",
          tone,
          allowUnscheduleTask: true,
        };
  }

  if (slot.tone === "cleanup") {
    return staleDays === 1
      ? {
          staleDays,
          badge: "Уборка зависла",
          title: "Вчерашнее окно уборки не случилось",
          summary:
            "Если это всё ещё актуально — переставь на ближайший день, а не копи новый операционный хвост.",
          tone,
          allowUnscheduleTask: false,
        }
      : {
          staleDays,
          badge: `Уборка · ${staleDays} д.`,
          title: "Авто-окно уборки уже устарело",
          summary:
            "Либо вручную поставь новое окно, либо оставь этот день как факт, а не как висящий план из прошлого.",
          tone,
          allowUnscheduleTask: false,
        };
  }

  return staleDays === 1
    ? {
        staleDays,
        badge: "План не случился",
        title: "Слот остался во вчера",
        summary:
          "Если слот всё ещё нужен — проще сразу сдвинуть его на сегодня или завтра, чем держать день красным.",
        tone,
        allowUnscheduleTask: false,
      }
    : {
        staleDays,
        badge: `Старый план · ${staleDays} д.`,
        title: "Слот давно в прошлом",
        summary:
          "Лучше быстро решить его судьбу и перетащить ближе, если он ещё актуален, вместо фонового накопления хвостов.",
        tone,
        allowUnscheduleTask: false,
      };
}

export function getSlotCarryoverActions({
  slot,
  todayKey,
  requiresApproval,
  isCompleted,
}: SlotCarryoverDecisionInput): SlotCarryoverAction[] {
  const decision = getSlotCarryoverDecision({
    slot,
    todayKey,
    requiresApproval,
    isCompleted,
  });

  if (!decision) {
    return [];
  }

  const staleDays = decision.staleDays;
  const durationMin = timeToMinutes(slot.end) - timeToMinutes(slot.start);
  const compressTargetMin = getCompressTargetMinutes(durationMin);
  const preferredDates = new Set(getPreferredMoveTargets(slot.date, todayKey, staleDays));
  const preferredMoveActions = getRankedCarryoverMoveTargets(slot, todayKey, staleDays)
    .filter((target) => preferredDates.has(target.dateKey))
    .slice(0, 2)
    .map((target, index) => {
      const priority: "primary" | "secondary" = index === 0 ? "primary" : "secondary";

      return {
        key: `carryover-move-${target.dateKey}`,
        type: "move-slot" as const,
        buttonLabel: target.buttonLabel,
        description: target.description,
        hint: target.hint,
        priority,
        dateKey: target.dateKey,
      } satisfies SlotCarryoverAction;
    });

  if (slot.taskId) {
    return [
      {
        key: "carryover-unschedule-task",
        type: "unschedule-task",
        buttonLabel: "В список без слота",
        description: "убрать слот и оставить задачу активной",
        hint: "Этот хвост проще вернуть в список, чем держать жёстким слотом в уже прожитом дне.",
        priority: "primary" as const,
      },
      ...preferredMoveActions.map((action, index) => {
        const priority: "primary" | "secondary" = index === 0 ? "secondary" : action.priority;

        return {
          ...action,
          priority,
        } satisfies SlotCarryoverAction;
      }),
    ].slice(0, 3) as SlotCarryoverAction[];
  }

  if (slot.tone !== "cleanup" && compressTargetMin != null) {
    const compressedEndMinutes = timeToMinutes(slot.start) + compressTargetMin;
    return [
      {
        key: `carryover-compress-${compressTargetMin}`,
        type: "compress-slot",
        buttonLabel: `Сжать до ${compressTargetMin}м`,
        description: `оставить короткую версию до ${minutesToClock(compressedEndMinutes)}`,
        hint: `Длинный хвост проще ужать до ${compressTargetMin} минут, чем тащить целиком через перегруженные дни.`,
        priority: "primary" as const,
        end: minutesToClock(compressedEndMinutes),
      },
      ...preferredMoveActions.map((action, index) => {
        const priority: "primary" | "secondary" = index === 0 ? "secondary" : action.priority;

        return {
          ...action,
          priority,
        } satisfies SlotCarryoverAction;
      }),
    ].slice(0, 3) as SlotCarryoverAction[];
  }

  return preferredMoveActions as SlotCarryoverAction[];
}