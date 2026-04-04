import { dateStr } from "@/lib/storage";

type SlotAttentionStateInput = {
  dayKey: string;
  todayKey: string;
  requiresApproval: boolean;
  isCompleted: boolean;
};

export type SlotAttentionState = {
  isYesterdayDay: boolean;
  isPendingSlot: boolean;
  isYesterdayPendingSlot: boolean;
  isYesterdayMutedSlot: boolean;
};

export function shiftDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + days);
  return dateStr(date);
}

export function getYesterdayKey(todayKey: string): string {
  return shiftDateKey(todayKey, -1);
}

export function getSlotAttentionState({
  dayKey,
  todayKey,
  requiresApproval,
  isCompleted,
}: SlotAttentionStateInput): SlotAttentionState {
  const isYesterdayDay = dayKey === getYesterdayKey(todayKey);
  const isPendingSlot = requiresApproval && !isCompleted;

  return {
    isYesterdayDay,
    isPendingSlot,
    isYesterdayPendingSlot: isYesterdayDay && isPendingSlot,
    isYesterdayMutedSlot: isYesterdayDay && !isPendingSlot,
  };
}

export function formatCompletionLabel(completedAt?: string | null): string | null {
  if (!completedAt) return null;

  const value = new Date(completedAt);
  if (Number.isNaN(value.getTime())) return null;

  return `подтверждено ${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}
