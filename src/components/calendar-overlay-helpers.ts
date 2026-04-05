import {
  SLOT_LANE_GAP_PX,
  SLOT_SIDE_INSET_PX,
  SUPPORT_LANE_RATIO,
  clamp,
  type DesktopSlotHintContent,
  type LaneMetrics,
  type LaneRenderable,
  type EditableSlotDraft,
} from "@/components/calendar-grid-types";
import {
  getSlotCarryoverActions,
  getSlotCarryoverDecision,
} from "@/lib/calendar-slot-carryover";
import { shiftDateKey } from "@/lib/calendar-slot-attention";
import type { CalendarSlotSupportNote } from "@/lib/calendar-slot-support-notes";
import type { ScheduleSlot } from "@/lib/schedule";
import { timeToMinutes } from "@/lib/schedule";
import type { Task } from "@/lib/tasks";

type ExplainabilityBadges = {
  showBadges: boolean;
  primaryBadge?: string | null;
  secondaryBadge?: string | null;
};

export function rangesOverlap(
  left: { start: string; end: string },
  right: { start: string; end: string },
): boolean {
  return (
    timeToMinutes(left.start) < timeToMinutes(right.end) &&
    timeToMinutes(left.end) > timeToMinutes(right.start)
  );
}

export function slotsOverlap(
  left: Pick<EditableSlotDraft, "start" | "end">,
  right: Pick<ScheduleSlot, "start" | "end">,
): boolean {
  return rangesOverlap(left, right);
}

export function isOverdueUndoneTask(
  task: Pick<Task, "dueDate" | "status">,
  today: string,
): boolean {
  const dueDate = task.dueDate;
  return task.status !== "done" && typeof dueDate === "string" && dueDate < today;
}

export function isYesterdayUndoneTask(
  task: Pick<Task, "dueDate" | "status">,
  today: string,
): boolean {
  return isOverdueUndoneTask(task, today) && task.dueDate === shiftDateKey(today, -1);
}

export function isAmbientContextSlot(slot: Pick<ScheduleSlot, "tags">): boolean {
  return (
    slot.tags.includes("childcare-window") ||
    (slot.tags.includes("admin") && slot.tags.includes("danya"))
  );
}

export function isBudgetHeavySlot(
  slot: Pick<ScheduleSlot, "source" | "tags" | "title">,
): boolean {
  const title = slot.title.toLowerCase();
  return (
    slot.source === "studio" ||
    slot.tags.some((tag) =>
      ["cleanup", "high-load", "party", "studio", "support", "between-parties", "household"].includes(tag),
    ) ||
    ["уборк", "cleanup", "праздник", "party"].some((token) => title.includes(token))
  );
}

export function isBudgetWorkLikeSlot(
  slot: Pick<ScheduleSlot, "tone" | "tags" | "title">,
): boolean {
  const title = slot.title.toLowerCase();
  return (
    slot.tone === "work" ||
    slot.tone === "kinderly" ||
    slot.tone === "heys" ||
    slot.tone === "review" ||
    slot.tags.some((tag) =>
      ["work", "deep-work", "strategy", "execution", "comms", "ops", "planning", "review"].includes(tag),
    ) ||
    ["work", "deep work", "strategy", "review", "задач", "стратег", "план", "реализац"].some((token) =>
      title.includes(token),
    )
  );
}

export function isBudgetRecoveryLikeSlot(
  slot: Pick<ScheduleSlot, "tone" | "tags" | "title">,
): boolean {
  const title = slot.title.toLowerCase();
  return (
    slot.tone === "personal" ||
    slot.tags.some((tag) =>
      ["recovery", "sleep", "shutdown", "bedtime", "quiet-buffer", "rest", "stress", "wellbeing"].includes(tag),
    ) ||
    ["сон", "sleep", "recovery", "quiet", "shutdown", "stretch", "rest", "восстанов"].some((token) =>
      title.includes(token),
    )
  );
}

export function getAdjacentContextSlot(
  slots: ScheduleSlot[],
  currentSlot: ScheduleSlot,
  direction: "previous" | "next",
): ScheduleSlot | null {
  const currentStart = timeToMinutes(currentSlot.start);
  const currentEnd = timeToMinutes(currentSlot.end);
  const candidates = slots.filter((candidate) => {
    if (candidate.id === currentSlot.id) return false;
    if (isAmbientContextSlot(candidate)) return false;

    return direction === "previous"
      ? timeToMinutes(candidate.end) <= currentStart
      : timeToMinutes(candidate.start) >= currentEnd;
  });

  if (candidates.length === 0) return null;

  return direction === "previous"
    ? candidates.sort(
        (left, right) =>
          timeToMinutes(right.end) - timeToMinutes(left.end) ||
          timeToMinutes(right.start) - timeToMinutes(left.start),
      )[0] ?? null
    : candidates.sort(
        (left, right) =>
          timeToMinutes(left.start) - timeToMinutes(right.start) ||
          timeToMinutes(left.end) - timeToMinutes(right.end),
      )[0] ?? null;
}

export function isChildcareBackgroundSlot(
  slot: Pick<ScheduleSlot, "source" | "tags"> | LaneRenderable,
): boolean {
  return (
    slot.source === "derived" &&
    (slot.tags.includes("childcare-window") ||
      (slot.tags.includes("admin") && slot.tags.includes("danya")))
  );
}

export function isSupportLaneSlot(
  slot: Pick<ScheduleSlot, "source" | "tags"> | LaneRenderable,
): boolean {
  return (
    slot.source === "studio" ||
    (slot.tags.includes("party") && slot.tags.includes("studio"))
  );
}

function compareLaneRenderable(left: LaneRenderable, right: LaneRenderable): number {
  return (
    timeToMinutes(left.start) - timeToMinutes(right.start) ||
    timeToMinutes(left.end) - timeToMinutes(right.end) ||
    left.id.localeCompare(right.id, "ru")
  );
}

function getSupportLaneWidth(columnWidth: number): number {
  return clamp(
    columnWidth * SUPPORT_LANE_RATIO,
    42,
    Math.max(42, columnWidth - 52),
  );
}

export function getBackgroundSlotMetrics(columnWidth: number): LaneMetrics {
  return {
    left: SLOT_SIDE_INSET_PX,
    width: Math.max(columnWidth - SLOT_SIDE_INSET_PX * 2, 24),
    isSupportLane: false,
  };
}

export function getLaneMetrics(
  slot: LaneRenderable,
  daySlots: LaneRenderable[],
  columnWidth: number,
): LaneMetrics {
  const contentWidth = Math.max(columnWidth - SLOT_SIDE_INSET_PX * 2, 24);
  const supportWidth = getSupportLaneWidth(columnWidth);

  if (isSupportLaneSlot(slot)) {
    const overlapGroup = daySlots
      .filter((candidate) => isSupportLaneSlot(candidate) && rangesOverlap(candidate, slot))
      .sort(compareLaneRenderable);

    const laneCount = Math.max(overlapGroup.length, 1);
    const laneIndex = Math.max(
      overlapGroup.findIndex((candidate) => candidate.id === slot.id),
      0,
    );
    const available = Math.max(
      supportWidth - SLOT_SIDE_INSET_PX * 2 - SLOT_LANE_GAP_PX * (laneCount - 1),
      24,
    );
    const width = Math.max(available / laneCount, 22);

    return {
      left: SLOT_SIDE_INSET_PX + laneIndex * (width + SLOT_LANE_GAP_PX),
      width,
      isSupportLane: true,
    };
  }

  const hasSupportOverlap = daySlots.some(
    (candidate) => isSupportLaneSlot(candidate) && rangesOverlap(candidate, slot),
  );

  if (!hasSupportOverlap) {
    return {
      left: SLOT_SIDE_INSET_PX,
      width: contentWidth,
      isSupportLane: false,
    };
  }

  const left = SLOT_SIDE_INSET_PX + supportWidth + SLOT_LANE_GAP_PX;
  return {
    left,
    width: Math.max(columnWidth - left - SLOT_SIDE_INSET_PX, 24),
    isSupportLane: false,
  };
}

function getExplainabilityDesktopHint(
  slot: Pick<ScheduleSlot, "source" | "tags">,
  explainability: ExplainabilityBadges,
): DesktopSlotHintContent | null {
  if (!explainability.showBadges) {
    return null;
  }

  const badgeLabel = [explainability.primaryBadge, explainability.secondaryBadge]
    .filter((value): value is string => Boolean(value))
    .join(" · ");

  if (slot.source === "studio") {
    return {
      eyebrow: badgeLabel || "почему слот здесь",
      title: "Фиксированное окно из schedule.xlsx",
      summary:
        "Это реальное событие студии. Вокруг него календарь уже достраивает семейные буферы, логистику и уборку.",
      detail: "Якорь дня · не требует ручного подтверждения",
      tone: "sky",
    };
  }

  if (slot.tags.includes("between-parties")) {
    return {
      eyebrow: badgeLabel || "авто",
      title: "Окно вставлено между двумя праздниками",
      summary:
        "Календарь увидел два события в один день и добавил операционный слот, чтобы не потерять быструю уборку между ними.",
      detail: "Автологика по шаблону студии",
      tone: "amber",
    };
  }

  if (slot.tags.includes("childcare-window")) {
    return {
      eyebrow: badgeLabel || "авто",
      title: "Это семейный буфер вокруг события",
      summary:
        "Слот появился как защитное окно под Даню и бытовую логистику, пока студия занята праздником.",
      detail: slot.tags.includes("grandma") || slot.tags.includes("rehearsal")
        ? "Среда · бабушка/репетиция"
        : "Семейное покрытие вокруг студии",
      tone: "sky",
    };
  }

  if (slot.tags.includes("cleanup") && slot.tags.includes("studio")) {
    return {
      eyebrow: badgeLabel || "авто",
      title: "Уборка поставлена правилом после праздника",
      summary:
        "Это не ручной ввод: cleanup-окно возникло из студийного расписания и его можно вручную сдвинуть, если жизнь уехала иначе.",
      detail: "Derived slot · под реальный послепраздничный хвост",
      tone: "amber",
    };
  }

  if (slot.source === "template") {
    return {
      eyebrow: badgeLabel || "ритм недели",
      title: "Это мягкий weekly-слот",
      summary:
        "Он задаёт базовый ритм дня и подтверждается вручную — это ориентир, а не автоматически случившийся факт.",
      detail: "Можно двигать под реальный день",
      tone: "zinc",
    };
  }

  if (slot.source === "derived") {
    return {
      eyebrow: badgeLabel || "авто",
      title: "Слот сгенерирован правилами календаря",
      summary:
        "Он появился не из ручного ввода, а из событий недели и встроенных правил, чтобы день не разваливался на скрытые хвосты.",
      detail: "Авто-слот · можно скорректировать вручную",
      tone: "zinc",
    };
  }

  return null;
}

export function getDesktopSlotHintContent(params: {
  slot: Pick<ScheduleSlot, "id" | "date" | "start" | "end" | "title" | "tags" | "taskId" | "tone" | "source" | "origin">;
  todayKey: string;
  requiresApproval: boolean;
  isCompleted: boolean;
  explainability: ExplainabilityBadges;
}): DesktopSlotHintContent | null {
  const carryoverDecision = getSlotCarryoverDecision({
    slot: params.slot,
    todayKey: params.todayKey,
    requiresApproval: params.requiresApproval,
    isCompleted: params.isCompleted,
  });

  if (carryoverDecision) {
    const primaryAction = getSlotCarryoverActions({
      slot: params.slot,
      todayKey: params.todayKey,
      requiresApproval: params.requiresApproval,
      isCompleted: params.isCompleted,
    })[0];

    return {
      eyebrow: carryoverDecision.badge,
      title: carryoverDecision.title,
      summary: primaryAction?.hint ?? carryoverDecision.summary,
      detail: primaryAction ? `Лучший ход: ${primaryAction.buttonLabel}` : undefined,
      tone: carryoverDecision.tone,
    };
  }

  return getExplainabilityDesktopHint(params.slot, params.explainability);
}

export function toSupportDesktopHintContent(
  note: CalendarSlotSupportNote,
): DesktopSlotHintContent {
  const eyebrow = [
    note.badge,
    note.timingLabel,
    note.durationLabel,
    note.sequenceLabel,
    note.pressureLabel,
    note.budgetLabel,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");

  return {
    eyebrow,
    title: note.title,
    summary: note.summary,
    detail: note.detail,
    points: note.points,
    tone: note.tone,
    icon: note.icon,
  };
}
