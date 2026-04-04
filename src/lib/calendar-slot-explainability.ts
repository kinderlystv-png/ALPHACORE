import type { ScheduleSlot } from "@/lib/schedule";

export type SlotExplainability = {
  showBadges: boolean;
  primaryBadge: string | null;
  secondaryBadge: string | null;
};

export function getScheduleSlotExplainability(
  slot: Pick<ScheduleSlot, "id" | "source" | "tags" | "taskId">,
): SlotExplainability {
  if (slot.taskId || slot.id.startsWith("custom-")) {
    return {
      showBadges: false,
      primaryBadge: null,
      secondaryBadge: null,
    };
  }

  if (slot.source === "studio") {
    return {
      showBadges: true,
      primaryBadge: "schedule.xlsx",
      secondaryBadge: "студия",
    };
  }

  if (slot.source === "template") {
    return {
      showBadges: true,
      primaryBadge: "ритм недели",
      secondaryBadge: null,
    };
  }

  if (slot.tags.includes("between-parties")) {
    return {
      showBadges: true,
      primaryBadge: "авто",
      secondaryBadge: "между праздниками",
    };
  }

  if (slot.tags.includes("childcare-window")) {
    return {
      showBadges: true,
      primaryBadge: "авто",
      secondaryBadge: slot.tags.includes("grandma") || slot.tags.includes("rehearsal")
        ? "логистика среды"
        : "семейный буфер",
    };
  }

  if (slot.tags.includes("cleanup") && slot.tags.includes("studio")) {
    return {
      showBadges: true,
      primaryBadge: "авто",
      secondaryBadge: "после праздника",
    };
  }

  if (slot.source === "derived") {
    return {
      showBadges: true,
      primaryBadge: "авто",
      secondaryBadge: null,
    };
  }

  return {
    showBadges: false,
    primaryBadge: null,
    secondaryBadge: null,
  };
}
