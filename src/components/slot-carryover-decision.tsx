"use client";

import {
  getSlotCarryoverActions,
  getSlotCarryoverDecision,
} from "@/lib/calendar-slot-carryover";
import {
  type ScheduleSlot,
  unscheduleCustomTaskEvent,
  updateEditableScheduleSlot,
} from "@/lib/schedule";

type SlotCarryoverDecisionProps = {
  slot: ScheduleSlot;
  todayKey: string;
  requiresApproval: boolean;
  isCompleted: boolean;
  onApplied?: () => void;
  compact?: boolean;
  className?: string;
};

export function SlotCarryoverDecision({
  slot,
  todayKey,
  requiresApproval,
  isCompleted,
  onApplied,
  compact = false,
  className,
}: SlotCarryoverDecisionProps) {
  const decision = getSlotCarryoverDecision({
    slot,
    todayKey,
    requiresApproval,
    isCompleted,
  });

  if (!decision) {
    return null;
  }

  const actions = getSlotCarryoverActions({
    slot,
    todayKey,
    requiresApproval,
    isCompleted,
  });

  if (actions.length === 0) {
    return null;
  }

  const primaryAction = actions[0] ?? null;

  const wrapperClassName = className ? `space-y-2 ${className}` : "space-y-2";
  const surfaceClassName = compact
    ? decision.tone === "rose"
      ? "rounded-2xl border border-rose-500/25 bg-rose-950/18 px-3 py-2"
      : "rounded-2xl border border-amber-500/25 bg-amber-950/14 px-3 py-2"
    : decision.tone === "rose"
      ? "rounded-2xl border border-rose-500/25 bg-rose-950/20 p-3"
      : "rounded-2xl border border-amber-500/25 bg-amber-950/16 p-3";
  const badgeClassName = compact
    ? decision.tone === "rose"
      ? "rounded-full border border-rose-400/25 bg-rose-500/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.16em] text-rose-100"
      : "rounded-full border border-amber-400/25 bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.16em] text-amber-100"
    : decision.tone === "rose"
      ? "rounded-full border border-rose-400/25 bg-rose-500/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-rose-100"
      : "rounded-full border border-amber-400/25 bg-amber-500/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-amber-100";
  const titleClassName = compact
    ? decision.tone === "rose"
      ? "text-[11px] font-semibold text-rose-50"
      : "text-[11px] font-semibold text-amber-50"
    : decision.tone === "rose"
      ? "text-sm font-semibold text-rose-50"
      : "text-sm font-semibold text-amber-50";
  const summaryClassName = compact
    ? decision.tone === "rose"
      ? "text-[10px] leading-4 text-rose-100/78"
      : "text-[10px] leading-4 text-amber-100/78"
    : decision.tone === "rose"
      ? "text-xs leading-5 text-rose-100/80"
      : "text-xs leading-5 text-amber-100/80";
  const hintClassName = compact
    ? decision.tone === "rose"
      ? "text-[10px] leading-4 text-rose-100/70"
      : "text-[10px] leading-4 text-amber-100/70"
    : decision.tone === "rose"
      ? "text-[11px] leading-5 text-rose-100/72"
      : "text-[11px] leading-5 text-amber-100/72";
  const baseButtonClassName = compact
    ? "rounded-full border px-2 py-1 text-[10px] font-medium transition"
    : "rounded-full border px-2.5 py-1.5 text-[11px] font-medium transition";

  return (
    <div className={wrapperClassName}>
      <div className={surfaceClassName}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={badgeClassName}>{decision.badge}</span>
          <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">лучший ход</span>
        </div>
        <p className={`mt-2 ${titleClassName}`}>{decision.title}</p>
        <p className={`mt-1 ${summaryClassName}`}>{decision.summary}</p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {actions.map((action) => {
            const toneClassName = action.priority === "primary"
              ? decision.tone === "rose"
                ? "border-rose-300/35 bg-rose-500/12 text-rose-50 hover:border-rose-200/55 hover:bg-rose-500/18"
                : "border-amber-300/35 bg-amber-500/12 text-amber-50 hover:border-amber-200/55 hover:bg-amber-500/18"
              : "border-white/10 bg-black/10 text-white/75 hover:border-white/20 hover:text-white";

            return (
              <button
                key={action.key}
                type="button"
                title={action.description}
                className={`${baseButtonClassName} ${toneClassName}`}
                onClick={() => {
                  if (action.type === "move-slot") {
                    const updated = updateEditableScheduleSlot(slot, { date: action.dateKey });
                    if (!updated) return;
                    onApplied?.();
                    return;
                  }

                  if (action.type === "compress-slot") {
                    const updated = updateEditableScheduleSlot(slot, { end: action.end });
                    if (!updated) return;
                    onApplied?.();
                    return;
                  }

                  const removed = unscheduleCustomTaskEvent(slot.id);
                  if (!removed) return;
                  onApplied?.();
                }}
              >
                {action.buttonLabel}
              </button>
            );
          })}
        </div>

        {primaryAction?.hint && (
          <p className={`mt-2 ${hintClassName}`}>{primaryAction.hint}</p>
        )}
      </div>
    </div>
  );
}