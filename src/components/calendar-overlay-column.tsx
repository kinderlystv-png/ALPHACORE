"use client";

import { CalendarDraftPreview } from "@/components/calendar-draft-preview";
import {
  slotHeight as sharedSlotHeight,
  slotTop as sharedSlotTop,
  type ActivePointerEdit,
  type DayColumn,
  type QuickMenuState,
  type ReboundPreview,
} from "@/components/calendar-grid-types";
import {
  CalendarSlotCard,
  type CalendarSlotCardProps,
} from "@/components/calendar-slot-card";
import { CalendarNowLine } from "@/components/calendar-now-line";
import {
  getAdjacentContextSlot,
  getBackgroundSlotMetrics,
  getDesktopSlotHintContent,
  getLaneMetrics,
  isAmbientContextSlot,
  isBudgetHeavySlot,
  isBudgetRecoveryLikeSlot,
  isBudgetWorkLikeSlot,
  isChildcareBackgroundSlot,
  isOverdueUndoneTask,
  isYesterdayUndoneTask,
  toSupportDesktopHintContent,
} from "@/components/calendar-overlay-helpers";
import { getSlotAttentionState, formatCompletionLabel } from "@/lib/calendar-slot-attention";
import { getScheduleSlotExplainability } from "@/lib/calendar-slot-explainability";
import type { DayModeId } from "@/lib/heys-day-mode";
import { toneColor } from "@/lib/life-areas";
import {
  getCalendarSlotSupportNote,
} from "@/lib/calendar-slot-support-notes";
import {
  getHeysSyncedSlotBadgeLabel,
  getScheduleSlotApprovalState,
  isEditableScheduleSlot,
  isHeysSyncedScheduleSlot,
  timeToMinutes,
  type ScheduleSlot,
} from "@/lib/schedule";
import type { Task } from "@/lib/tasks";

export type CalendarOverlayColumnProps = {
  column: DayColumn;
  activeEdit: ActivePointerEdit | null;
  reboundPreview: ReboundPreview | null;
  quickMenu: QuickMenuState | null;
  hoveredSlotKey: string | null;
  desktopSlotHintSlotKey: string | null;
  desktopSlotHintPendingKey: string | null;
  overlayColumnWidth: number;
  linkedTasksById: Map<string, Task>;
  projectNameById: Map<string, string>;
  today: string;
  yesterdayKey: string;
  heysDayModeId: DayModeId | null;
  isMobileGripMode: boolean;
  skipNextClickRef: CalendarSlotCardProps["skipNextClickRef"];
  onQueuePointerEdit: CalendarSlotCardProps["onQueuePointerEdit"];
  onScheduleDesktopSlotHint: CalendarSlotCardProps["onScheduleDesktopSlotHint"];
  onHideDesktopSlotHint: CalendarSlotCardProps["onHideDesktopSlotHint"];
  onOpenQuickMenu: CalendarSlotCardProps["onOpenQuickMenu"];
  onToggleSlotApproval: CalendarSlotCardProps["onToggleSlotApproval"];
  onSetHoveredSlotKey: CalendarSlotCardProps["onSetHoveredSlotKey"];
};

function slotTop(startTime: string): number {
  return sharedSlotTop(startTime, timeToMinutes);
}

function slotHeight(start: string, end: string): number {
  return sharedSlotHeight(start, end, timeToMinutes);
}

function getSlotProjectLabel(
  slot: Pick<ScheduleSlot, "projectId" | "project">,
  linkedTask: Pick<Task, "projectId" | "project"> | null,
  projectNameById: Map<string, string>,
): string | null {
  if (slot.projectId) return projectNameById.get(slot.projectId) ?? slot.project ?? null;
  if (linkedTask?.projectId) {
    return projectNameById.get(linkedTask.projectId) ?? linkedTask.project ?? slot.project ?? null;
  }
  return slot.project ?? linkedTask?.project ?? null;
}

export function CalendarOverlayColumn({
  column,
  activeEdit,
  reboundPreview,
  quickMenu,
  hoveredSlotKey,
  desktopSlotHintSlotKey,
  desktopSlotHintPendingKey,
  overlayColumnWidth,
  linkedTasksById,
  projectNameById,
  today,
  yesterdayKey,
  heysDayModeId,
  isMobileGripMode,
  skipNextClickRef,
  onQueuePointerEdit,
  onScheduleDesktopSlotHint,
  onHideDesktopSlotHint,
  onOpenQuickMenu,
  onToggleSlotApproval,
  onSetHoveredSlotKey,
}: CalendarOverlayColumnProps) {
  const isYesterdayColumn = column.key === yesterdayKey;
  const hasOverdueTaskSlot = column.slots.some((slot) => {
    const linkedTask = slot.taskId ? linkedTasksById.get(slot.taskId) ?? null : null;
    if (!linkedTask || !isOverdueUndoneTask(linkedTask, today)) return false;
    return !getScheduleSlotApprovalState(slot).isCompleted;
  });

  return (
    <div
      className={`relative ${
        column.isPast
          ? isYesterdayColumn
            ? ""
            : hasOverdueTaskSlot
              ? "opacity-80"
              : "opacity-30 grayscale"
          : ""
      }`}
    >
      <div
        className={`pointer-events-none absolute inset-y-0 right-0 w-px ${
          column.isToday ? "bg-sky-400/28" : "bg-zinc-500/42"
        }`}
      />
      <div
        className={`pointer-events-none absolute inset-y-0 right-0 w-0.5 ${
          column.isToday
            ? "bg-linear-to-b from-sky-200/18 via-sky-300/60 to-sky-200/18"
            : "bg-linear-to-b from-zinc-100/10 via-zinc-200/42 to-zinc-100/10"
        }`}
      />

      {column.slots.map((slot) => {
        const slotInstanceKey = `${slot.date}:${slot.id}`;
        if (
          activeEdit?.originalSlot?.id === slot.id &&
          activeEdit.originalSlot.date === slot.date
        ) {
          return null;
        }
        if (reboundPreview?.slotId === slot.id && reboundPreview.slotDate === slot.date) {
          return null;
        }

        const top = slotTop(slot.start);
        const height = slotHeight(slot.start, slot.end);
        const isChildcareBackground = isChildcareBackgroundSlot(slot);
        const laneMetrics = isChildcareBackground
          ? getBackgroundSlotMetrics(overlayColumnWidth)
          : getLaneMetrics(
              {
                id: slot.id,
                start: slot.start,
                end: slot.end,
                source: slot.source,
                tags: slot.tags,
              },
              column.slots.map((candidate) => ({
                id: candidate.id,
                start: candidate.start,
                end: candidate.end,
                source: candidate.source,
                tags: candidate.tags,
              })),
              overlayColumnWidth,
            );
        const color = toneColor(slot.tone);
        const linkedTask = slot.taskId ? linkedTasksById.get(slot.taskId) ?? null : null;
        const approvalState = getScheduleSlotApprovalState(slot);
        const requiresApproval = approvalState.requiresApproval;
        const isCompletedSlot = approvalState.isCompleted;
        const attentionState = getSlotAttentionState({
          dayKey: column.key,
          todayKey: today,
          requiresApproval,
          isCompleted: isCompletedSlot,
        });
        const { isYesterdayPendingSlot, isYesterdayMutedSlot } = attentionState;
        const isOverdueCarryoverTask = Boolean(
          !isYesterdayMutedSlot &&
            linkedTask &&
            isOverdueUndoneTask(linkedTask, today) &&
            !isCompletedSlot,
        );
        const isYesterdayCarryoverTask = Boolean(
          !isYesterdayMutedSlot &&
            linkedTask &&
            isYesterdayUndoneTask(linkedTask, today) &&
            !isCompletedSlot,
        );
        const completionLabel = formatCompletionLabel(approvalState.completedAt);
        const projectLabel = getSlotProjectLabel(slot, linkedTask, projectNameById);
        const isHeysSynced = isHeysSyncedScheduleSlot(slot);
        const heysBadgeLabel = isHeysSynced ? getHeysSyncedSlotBadgeLabel(slot) : null;
        const explainability = getScheduleSlotExplainability(slot);
        const desktopHintContent = getDesktopSlotHintContent({
          slot,
          todayKey: today,
          requiresApproval,
          isCompleted: isCompletedSlot,
          explainability,
        });
        const previousContextSlot = getAdjacentContextSlot(column.slots, slot, "previous");
        const nextContextSlot = getAdjacentContextSlot(column.slots, slot, "next");
        const remainingDaySlots = column.slots.filter((candidate) => {
          if (candidate.id === slot.id) return false;
          if (isAmbientContextSlot(candidate)) return false;
          return timeToMinutes(candidate.start) >= timeToMinutes(slot.end);
        });
        const supportNote = getCalendarSlotSupportNote(slot, {
          dayModeId: heysDayModeId ?? undefined,
          previousSlot: previousContextSlot,
          nextSlot: nextContextSlot,
          pressure: column.pressure,
          remainingDay: {
            remainingSlots: remainingDaySlots.length,
            remainingHeavySlots: remainingDaySlots.filter(isBudgetHeavySlot).length,
            remainingWorkSlots: remainingDaySlots.filter(isBudgetWorkLikeSlot).length,
            remainingRecoverySlots: remainingDaySlots.filter(isBudgetRecoveryLikeSlot).length,
          },
        });
        const supportHintKey = `${slotInstanceKey}:support`;
        const supportHintContent = supportNote
          ? toSupportDesktopHintContent(supportNote)
          : null;
        const isEditable = isEditableScheduleSlot(slot);
        const isSupportSlot = laneMetrics.isSupportLane;
        const isBlockingSlot =
          activeEdit?.blocked &&
          activeEdit.blockingSlot?.id === slot.id &&
          activeEdit.blockingSlot.date === slot.date;
        const isQuickMenuSlot =
          quickMenu?.slot.id === slot.id && quickMenu.slot.date === slot.date;
        const isActiveSlot =
          activeEdit?.originalSlot?.id === slot.id &&
          activeEdit.originalSlot.date === slot.date;
        const isSelectedSlot = isQuickMenuSlot || isActiveSlot;
        const isHoveredSlot = hoveredSlotKey === slotInstanceKey;
        const showSupportNoteInline = Boolean(
          supportNote && !isChildcareBackground && !isSupportSlot && height > 66,
        );
        const showSupportNoteCompact = Boolean(
          supportNote && !isChildcareBackground && !showSupportNoteInline && height > 34,
        );
        const slotPadding = isChildcareBackground
          ? height >= 88
            ? "px-3 py-2.5"
            : "px-2.5 py-2"
          : isSupportSlot
            ? height >= 88
              ? "px-1.5 py-1.5"
              : "px-1 py-1"
            : !isEditable
              ? isHeysSynced
                ? "px-2 pt-5 pb-1"
                : "px-2 py-1"
              : isHeysSynced
                ? height >= 96
                  ? "px-2 pt-6 pb-5"
                  : height >= 64
                    ? "px-2 pt-5 pb-4"
                    : "px-2 pt-4 pb-3"
                : height >= 96
                  ? "px-2 pt-5 pb-5"
                  : height >= 64
                    ? "px-2 pt-4 pb-4"
                    : "px-2 pt-3 pb-3";
        const handleButtonHeight = height >= 64 ? "h-5" : "h-4";
        const handleGripSize = height >= 64 ? "h-1 w-4" : "h-0.5 w-3";
        const handleOpacity = isActiveSlot
          ? "opacity-90"
          : isMobileGripMode
            ? isQuickMenuSlot
              ? "opacity-80"
              : "opacity-0"
            : isHoveredSlot
              ? "opacity-70"
              : "opacity-0";
        const handleGripTone = isSelectedSlot ? "bg-white/55" : "bg-white/28";
        const primaryTextClass = isYesterdayPendingSlot
          ? "text-rose-50"
          : isYesterdayMutedSlot
            ? "text-zinc-400"
            : isCompletedSlot
              ? "text-emerald-50"
              : isYesterdayCarryoverTask
                ? "text-rose-50"
                : isOverdueCarryoverTask
                  ? "text-amber-50"
                  : color.text;
        const secondaryTextClass = isYesterdayPendingSlot
          ? "text-rose-100/80"
          : isYesterdayMutedSlot
            ? "text-zinc-500"
            : isCompletedSlot
              ? "text-emerald-100/80"
              : isYesterdayCarryoverTask
                ? "text-rose-100/80"
                : isOverdueCarryoverTask
                  ? "text-amber-100/80"
                  : "text-zinc-500";
        const shellTone = isYesterdayPendingSlot
          ? "border-rose-500/55 bg-linear-to-br from-rose-500/24 via-red-500/18 to-rose-950/36"
          : isYesterdayMutedSlot
            ? "border-zinc-800/80 bg-zinc-900/72"
            : isChildcareBackground
              ? "border-amber-500/16 bg-linear-to-br from-amber-500/12 via-orange-500/8 to-amber-950/4"
              : isCompletedSlot
                ? "border-emerald-400/55 bg-linear-to-br from-emerald-400/32 via-emerald-500/22 to-emerald-950/42"
                : isYesterdayCarryoverTask
                  ? "border-rose-500/50 bg-linear-to-br from-rose-500/22 via-red-500/16 to-rose-950/34"
                  : isOverdueCarryoverTask
                    ? "border-amber-500/50 bg-linear-to-br from-amber-500/20 via-orange-500/14 to-amber-950/32"
                    : `${color.border} ${color.bg}`;
        const shellDepth = isChildcareBackground
          ? "shadow-none"
          : isBlockingSlot
            ? "ring-2 ring-rose-400/80 shadow-[0_0_0_1px_rgba(248,113,113,0.22),0_14px_28px_rgba(127,29,29,0.28)]"
            : isSelectedSlot
              ? "ring-1 ring-white/12 shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_10px_24px_rgba(0,0,0,0.22)]"
              : isHeysSynced
                ? "shadow-[0_0_0_1px_rgba(251,146,60,0.24),0_10px_24px_rgba(0,0,0,0.22)]"
                : "shadow-[0_6px_18px_rgba(0,0,0,0.18)]";
        const slotZIndex = isChildcareBackground ? 0 : isSelectedSlot ? 14 : isSupportSlot ? 11 : 12;
        const slotCardModel = {
          colKey: column.key,
          slot,
          top,
          height,
          laneMetrics,
          slotInstanceKey,
          isChildcareBackground,
          isEditable,
          isSupportSlot,
          isQuickMenuSlot,
          isActiveSlot,
          isHoveredSlot,
          isMobileGripMode,
          isYesterdayPendingSlot,
          isYesterdayMutedSlot,
          isCompletedSlot,
          isYesterdayCarryoverTask,
          isOverdueCarryoverTask,
          requiresApproval,
          completionLabel,
          projectLabel,
          isHeysSynced,
          heysBadgeLabel,
          explainability,
          supportNote,
          supportHintKey,
          supportHintContent,
          desktopHintContent,
          primaryTextClass,
          secondaryTextClass,
          slotPadding,
          shellTone,
          shellDepth,
          handleButtonHeight,
          handleGripSize,
          handleOpacity,
          handleGripTone,
          slotZIndex,
          showSupportNoteInline,
          showSupportNoteCompact,
        };

        return (
          <CalendarSlotCard
            key={slotInstanceKey}
            model={slotCardModel}
            desktopSlotHintSlotKey={desktopSlotHintSlotKey}
            desktopSlotHintPendingKey={desktopSlotHintPendingKey}
            skipNextClickRef={skipNextClickRef}
            onQueuePointerEdit={onQueuePointerEdit}
            onScheduleDesktopSlotHint={onScheduleDesktopSlotHint}
            onHideDesktopSlotHint={onHideDesktopSlotHint}
            onOpenQuickMenu={onOpenQuickMenu}
            onToggleSlotApproval={onToggleSlotApproval}
            onSetHoveredSlotKey={onSetHoveredSlotKey}
          />
        );
      })}

      <CalendarDraftPreview
        activeEdit={activeEdit}
        colKey={column.key}
        colSlots={column.slots}
        overlayColumnWidth={overlayColumnWidth}
        getLaneMetrics={getLaneMetrics}
        slotTop={slotTop}
        slotHeight={slotHeight}
      />

      {column.isToday && <CalendarNowLine />}
    </div>
  );
}
