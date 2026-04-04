import { getSlotQuickRescheduleOptions } from "@/lib/calendar-slot-reschedule";
import { shiftDateKey } from "@/lib/calendar-slot-attention";
import { timeToMinutes, type ScheduleSlot } from "@/lib/schedule";

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
      priority: "primary" | "secondary";
      dateKey: string;
    }
  | {
      key: string;
      type: "unschedule-task";
      buttonLabel: string;
      description: string;
      priority: "primary" | "secondary";
    }
  | {
      key: string;
      type: "compress-slot";
      buttonLabel: string;
      description: string;
      priority: "primary" | "secondary";
      end: string;
    };

type SlotCarryoverDecisionInput = {
  slot: Pick<ScheduleSlot, "date" | "start" | "end" | "taskId" | "tone">;
  todayKey: string;
  requiresApproval: boolean;
  isCompleted: boolean;
};

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
  const moveOptionsByDate = new Map(
    getSlotQuickRescheduleOptions(slot.date, todayKey).map((option) => [option.dateKey, option]),
  );

  const preferredMoveActions = getPreferredMoveTargets(slot.date, todayKey, staleDays)
    .map((dateKey) => moveOptionsByDate.get(dateKey))
    .filter((option): option is NonNullable<typeof option> => Boolean(option))
    .slice(0, 2)
    .map((option, index) => {
      const priority: "primary" | "secondary" = index === 0 ? "primary" : "secondary";

      return {
        key: `carryover-move-${option.dateKey}`,
        type: "move-slot" as const,
        buttonLabel: option.buttonLabel,
        description: option.description,
        priority,
        dateKey: option.dateKey,
      } satisfies SlotCarryoverAction;
    });

  if (slot.taskId) {
    return [
      {
        key: "carryover-unschedule-task",
        type: "unschedule-task",
        buttonLabel: "В список без слота",
        description: "убрать слот и оставить задачу активной",
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