"use client";

import { getSlotQuickRescheduleOptions } from "@/lib/calendar-slot-reschedule";
import {
  isEditableScheduleSlot,
  type ScheduleSlot,
  updateEditableScheduleSlot,
} from "@/lib/schedule";

type SlotQuickRescheduleActionsProps = {
  slot: ScheduleSlot;
  todayKey: string;
  onApplied?: () => void;
  compact?: boolean;
  muted?: boolean;
  showLabel?: boolean;
  className?: string;
};

export function SlotQuickRescheduleActions({
  slot,
  todayKey,
  onApplied,
  compact = false,
  muted = false,
  showLabel = true,
  className,
}: SlotQuickRescheduleActionsProps) {
  if (!isEditableScheduleSlot(slot)) {
    return null;
  }

  const options = getSlotQuickRescheduleOptions(slot.date, todayKey);
  if (options.length === 0) {
    return null;
  }

  const wrapperClassName = className ? `space-y-1.5 ${className}` : "space-y-1.5";
  const labelClassName = muted
    ? "text-[10px] uppercase tracking-[0.16em] text-zinc-600"
    : "text-[10px] uppercase tracking-[0.16em] text-zinc-500";
  const baseButtonClassName = compact
    ? "rounded-full border px-2 py-1 text-[10px] font-medium transition"
    : "rounded-full border px-2.5 py-1 text-[11px] font-medium transition";

  return (
    <div className={wrapperClassName}>
      {showLabel && <p className={labelClassName}>Перенести одним тапом</p>}
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const toneClassName = muted
            ? "border-zinc-700 bg-zinc-900/85 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
            : option.priority === "primary"
              ? "border-sky-400/30 bg-sky-500/12 text-sky-100 hover:border-sky-300/50 hover:bg-sky-500/18"
              : "border-white/10 bg-black/10 text-white/75 hover:border-white/20 hover:text-white";

          return (
            <button
              key={option.key}
              type="button"
              title={`Перенести ${option.description}`}
              className={`${baseButtonClassName} ${toneClassName}`}
              onClick={() => {
                const updated = updateEditableScheduleSlot(slot, { date: option.dateKey });
                if (!updated) return;
                onApplied?.();
              }}
            >
              {option.buttonLabel}
            </button>
          );
        })}
      </div>
    </div>
  );
}