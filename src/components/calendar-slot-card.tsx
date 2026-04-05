"use client";

import type React from "react";

import { getSupportNoteChipClass, type DesktopSlotHintContent, type LaneMetrics, type PointerEditMode } from "@/components/calendar-grid-types";
import type { CalendarSlotSupportNote } from "@/lib/calendar-slot-support-notes";
import { formatScheduleTimeRange, type ScheduleSlot } from "@/lib/schedule";

export type CalendarSlotCardModel = {
  colKey: string;
  slot: ScheduleSlot;
  top: number;
  height: number;
  laneMetrics: LaneMetrics;
  slotInstanceKey: string;
  isChildcareBackground: boolean;
  isEditable: boolean;
  isSupportSlot: boolean;
  isQuickMenuSlot: boolean;
  isActiveSlot: boolean;
  isHoveredSlot: boolean;
  isMobileGripMode: boolean;
  isYesterdayPendingSlot: boolean;
  isYesterdayMutedSlot: boolean;
  isCompletedSlot: boolean;
  isYesterdayCarryoverTask: boolean;
  isOverdueCarryoverTask: boolean;
  requiresApproval: boolean;
  completionLabel: string | null;
  projectLabel: string | null;
  isHeysSynced: boolean;
  heysBadgeLabel: string | null;
  explainability: {
    showBadges: boolean;
    primaryBadge?: string | null;
    secondaryBadge?: string | null;
  };
  supportNote: CalendarSlotSupportNote | null;
  supportHintKey: string;
  supportHintContent: DesktopSlotHintContent | null;
  desktopHintContent: DesktopSlotHintContent | null;
  primaryTextClass: string;
  secondaryTextClass: string;
  slotPadding: string;
  shellTone: string;
  shellDepth: string;
  handleButtonHeight: string;
  handleGripSize: string;
  handleOpacity: string;
  handleGripTone: string;
  slotZIndex: number;
  showSupportNoteInline: boolean;
  showSupportNoteCompact: boolean;
};

export type CalendarSlotCardProps = {
  model: CalendarSlotCardModel;
  desktopSlotHintSlotKey: string | null;
  desktopSlotHintPendingKey: string | null;
  skipNextClickRef: React.MutableRefObject<boolean>;
  onQueuePointerEdit: (
    mode: PointerEditMode,
    event: React.PointerEvent<HTMLElement>,
    dayKey: string,
    slot: ScheduleSlot | null,
  ) => void;
  onScheduleDesktopSlotHint: (
    element: HTMLElement,
    slotKey: string,
    content: DesktopSlotHintContent | null,
    options?: { delayMs?: number },
  ) => void;
  onHideDesktopSlotHint: () => void;
  onOpenQuickMenu: (element: HTMLElement, slot: ScheduleSlot) => void;
  onToggleSlotApproval: (slot: ScheduleSlot) => void;
  onSetHoveredSlotKey: (key: string | null) => void;
};

export function CalendarSlotCard({
  model,
  desktopSlotHintSlotKey,
  desktopSlotHintPendingKey,
  skipNextClickRef,
  onQueuePointerEdit,
  onScheduleDesktopSlotHint,
  onHideDesktopSlotHint,
  onOpenQuickMenu,
  onToggleSlotApproval,
  onSetHoveredSlotKey,
}: CalendarSlotCardProps) {
  const hideSupportHintIfActive = (slotKey: string) => {
    if (desktopSlotHintSlotKey === slotKey || desktopSlotHintPendingKey === slotKey) {
      onHideDesktopSlotHint();
    }
  };

  const {
    colKey,
    slot,
    top,
    height,
    laneMetrics,
    slotInstanceKey,
    isChildcareBackground,
    isEditable,
    isSupportSlot,
    isHoveredSlot,
    isMobileGripMode,
    isYesterdayPendingSlot,
    isYesterdayMutedSlot,
    isCompletedSlot,
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
  } = model;

  return (
    <div
      className={`group absolute overflow-hidden rounded-xl border ${slotPadding} ${shellTone} ${
        isChildcareBackground ? "pointer-events-none" : "pointer-events-auto"
      } ${isEditable ? "cursor-grab touch-none" : ""} ${shellDepth}`}
      style={{ top, left: laneMetrics.left, width: laneMetrics.width, height, minHeight: 20, zIndex: slotZIndex }}
      onPointerDown={(event) => {
        if (!isEditable) return;
        event.stopPropagation();
        onQueuePointerEdit("move", event, colKey, slot);
      }}
      onPointerEnter={(event) => {
        if (isMobileGripMode || event.pointerType !== "mouse") return;
        if (!isHoveredSlot) {
          onSetHoveredSlotKey(slotInstanceKey);
        }
        onScheduleDesktopSlotHint(event.currentTarget, slotInstanceKey, desktopHintContent);
      }}
      onPointerLeave={() => {
        if (isHoveredSlot) {
          onSetHoveredSlotKey(null);
        }
        hideSupportHintIfActive(slotInstanceKey);
      }}
      onClick={(event) => {
        if (!isEditable) return;
        if (skipNextClickRef.current) {
          skipNextClickRef.current = false;
          return;
        }
        event.stopPropagation();
        onOpenQuickMenu(event.currentTarget, slot);
      }}
    >
      {isChildcareBackground ? (
        <>
          <div className={`pointer-events-none absolute inset-0 ${isYesterdayMutedSlot ? "bg-zinc-900/28" : "bg-linear-to-r from-amber-400/10 via-orange-400/6 to-transparent"}`} />
          <div className={`pointer-events-none absolute inset-x-0 top-0 h-px ${isYesterdayMutedSlot ? "bg-zinc-700/55" : "bg-linear-to-r from-amber-200/35 via-orange-300/18 to-transparent"}`} />
        </>
      ) : (
        <>
          {isHeysSynced && !isSupportSlot && heysBadgeLabel && (
            <span className={`pointer-events-none absolute left-2 top-1.5 z-10 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${isYesterdayMutedSlot ? "border-zinc-700 bg-zinc-900/80 text-zinc-500" : "border-orange-400/30 bg-orange-500/12 text-orange-100"}`}>
              {heysBadgeLabel}
            </span>
          )}
          {showSupportNoteCompact && supportNote && supportHintContent && (
            <button
              type="button"
              aria-label={supportNote.title}
              title={supportNote.summary}
              className={`absolute bottom-1.5 right-1.5 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px] shadow-[0_6px_18px_rgba(0,0,0,0.18)] ${getSupportNoteChipClass(supportNote.tone, isYesterdayMutedSlot)}`}
              onClick={(event) => {
                event.stopPropagation();
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              onPointerEnter={(event) => {
                if (event.pointerType !== "mouse") return;
                onScheduleDesktopSlotHint(event.currentTarget, supportHintKey, supportHintContent, { delayMs: 0 });
              }}
              onPointerLeave={() => {
                hideSupportHintIfActive(supportHintKey);
              }}
              onFocus={(event) => {
                onScheduleDesktopSlotHint(event.currentTarget, supportHintKey, supportHintContent, { delayMs: 0 });
              }}
              onBlur={() => {
                hideSupportHintIfActive(supportHintKey);
              }}
            >
              <span aria-hidden="true">{supportNote.icon}</span>
            </button>
          )}
          {isEditable && (
            <button
              type="button"
              aria-label="Изменить начало"
              className={`absolute inset-x-0 top-0 z-10 flex cursor-ns-resize items-start justify-between ${isSupportSlot ? "px-1.5" : "px-3"} bg-transparent transition-opacity ${handleOpacity} ${handleButtonHeight}`}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => {
                event.stopPropagation();
                onQueuePointerEdit("resize-start", event, colKey, slot);
              }}
            >
              <span className={`mt-1 rounded-full shadow-[0_0_0_1px_rgba(255,255,255,0.04)] ${handleGripTone} ${handleGripSize}`} />
              <span className={`mt-1 rounded-full shadow-[0_0_0_1px_rgba(255,255,255,0.04)] ${handleGripTone} ${handleGripSize}`} />
            </button>
          )}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className={`text-[10px] font-medium leading-tight ${primaryTextClass}`}>
                  {formatScheduleTimeRange(slot.start, slot.end)}
                </p>
                {requiresApproval && (
                  <button
                    type="button"
                    aria-label={isCompletedSlot ? "Снять подтверждение слота" : "Подтвердить слот"}
                    title={isCompletedSlot ? "Снять подтверждение" : "Подтвердить выполнение"}
                    className={`relative z-10 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold leading-none transition ${
                      isYesterdayPendingSlot
                        ? "border-rose-200/40 bg-black/20 text-rose-50 hover:border-rose-100/70 hover:bg-black/30"
                        : isYesterdayMutedSlot
                          ? "border-zinc-600/80 bg-zinc-900/85 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
                          : isCompletedSlot
                            ? "border-emerald-200/70 bg-emerald-50/16 text-emerald-50 hover:border-emerald-100/80 hover:bg-emerald-50/22"
                            : "border-white/14 bg-zinc-950/76 text-zinc-400 hover:border-sky-400/40 hover:text-sky-100"
                    }`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleSlotApproval(slot);
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                    }}
                  >
                    {isCompletedSlot ? "✓" : "○"}
                  </button>
                )}
              </div>
              <p className={`mt-0.5 font-medium leading-snug ${primaryTextClass} ${isSupportSlot ? "line-clamp-4 text-[10px]" : "truncate text-[11px]"} ${isCompletedSlot ? isYesterdayMutedSlot ? "line-through decoration-zinc-500/40 opacity-85" : "line-through decoration-emerald-100/45 opacity-90" : ""}`}>
                {slot.title}
              </p>
              {showSupportNoteInline && supportNote && supportHintContent && (
                <div className="mt-1 flex">
                  <button
                    type="button"
                    aria-label={supportNote.title}
                    title={supportNote.summary}
                    className={`relative z-10 inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[8px] font-medium uppercase tracking-[0.14em] ${getSupportNoteChipClass(supportNote.tone, isYesterdayMutedSlot)}`}
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                    }}
                    onPointerEnter={(event) => {
                      if (event.pointerType !== "mouse") return;
                      onScheduleDesktopSlotHint(event.currentTarget, supportHintKey, supportHintContent, { delayMs: 0 });
                    }}
                    onPointerLeave={() => {
                      hideSupportHintIfActive(supportHintKey);
                    }}
                    onFocus={(event) => {
                      onScheduleDesktopSlotHint(event.currentTarget, supportHintKey, supportHintContent, { delayMs: 0 });
                    }}
                    onBlur={() => {
                      hideSupportHintIfActive(supportHintKey);
                    }}
                  >
                    <span aria-hidden="true">{supportNote.icon}</span>
                    <span className="truncate">{supportNote.badge}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
          {projectLabel && !isSupportSlot && height > 46 && (
            <p className={`mt-1 inline-flex max-w-full truncate rounded-full border px-2 py-0.5 text-[9px] font-medium ${isYesterdayMutedSlot ? "border-zinc-700 bg-zinc-900/80 text-zinc-500" : "border-violet-500/20 bg-violet-500/10 text-violet-200"}`}>
              {projectLabel}
            </p>
          )}
          {explainability.showBadges && !isSupportSlot && height > 52 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {explainability.primaryBadge && (
                <span className={`inline-flex max-w-full truncate rounded-full border px-2 py-0.5 text-[8px] font-medium uppercase tracking-[0.14em] ${isYesterdayMutedSlot ? "border-zinc-700 bg-zinc-900/80 text-zinc-500" : "border-white/10 bg-black/10 text-white/70"}`}>
                  {explainability.primaryBadge}
                </span>
              )}
              {explainability.secondaryBadge && (
                <span className={`inline-flex max-w-full truncate rounded-full border px-2 py-0.5 text-[8px] font-medium uppercase tracking-[0.14em] ${isYesterdayMutedSlot ? "border-zinc-700 bg-zinc-900/80 text-zinc-500" : "border-white/10 bg-black/10 text-white/70"}`}>
                  {explainability.secondaryBadge}
                </span>
              )}
            </div>
          )}
          {completionLabel && !isSupportSlot && height > 44 && (
            <p className={`mt-1 text-[9px] uppercase tracking-[0.14em] ${isYesterdayMutedSlot ? "text-zinc-500" : isCompletedSlot ? "text-emerald-100/85" : secondaryTextClass}`}>
              {completionLabel}
            </p>
          )}
          {!isSupportSlot && height > 40 && slot.subtitle && (
            <p className={`mt-0.5 line-clamp-2 text-[9px] leading-tight ${secondaryTextClass}`}>
              {slot.subtitle}
            </p>
          )}
          {isEditable && (
            <button
              type="button"
              aria-label="Изменить конец"
              className={`absolute inset-x-0 bottom-0 z-10 flex cursor-ns-resize items-end justify-between ${isSupportSlot ? "px-1.5" : "px-3"} bg-transparent transition-opacity ${handleOpacity} ${handleButtonHeight}`}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => {
                event.stopPropagation();
                onQueuePointerEdit("resize-end", event, colKey, slot);
              }}
            >
              <span className={`mb-1 rounded-full shadow-[0_0_0_1px_rgba(255,255,255,0.04)] ${handleGripTone} ${handleGripSize}`} />
              <span className={`mb-1 rounded-full shadow-[0_0_0_1px_rgba(255,255,255,0.04)] ${handleGripTone} ${handleGripSize}`} />
            </button>
          )}
        </>
      )}
    </div>
  );
}
