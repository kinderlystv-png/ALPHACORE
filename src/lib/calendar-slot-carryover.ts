import type { ScheduleSlot } from "@/lib/schedule";

export type SlotCarryoverDecision = {
  staleDays: number;
  badge: string;
  title: string;
  summary: string;
  tone: "rose" | "amber";
  allowUnscheduleTask: boolean;
};

type SlotCarryoverDecisionInput = {
  slot: Pick<ScheduleSlot, "date" | "taskId" | "tone">;
  todayKey: string;
  requiresApproval: boolean;
  isCompleted: boolean;
};

function diffDays(fromDateKey: string, toDateKey: string): number {
  const fromDate = new Date(`${fromDateKey}T00:00:00`);
  const toDate = new Date(`${toDateKey}T00:00:00`);

  return Math.max(0, Math.round((fromDate.getTime() - toDate.getTime()) / 86_400_000));
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