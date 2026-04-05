"use client";

import type { ActivePointerEdit, LaneMetrics, LaneRenderable } from "@/components/calendar-grid-types";
import { toneColor } from "@/lib/life-areas";
import { formatScheduleTimeRange, type ScheduleSlot } from "@/lib/schedule";

export type CalendarDraftPreviewProps = {
  activeEdit: ActivePointerEdit | null;
  colKey: string;
  colSlots: Array<Pick<ScheduleSlot, "id" | "start" | "end" | "source" | "tags">>;
  overlayColumnWidth: number;
  getLaneMetrics: (slot: LaneRenderable, daySlots: LaneRenderable[], columnWidth: number) => LaneMetrics;
  slotTop: (start: string) => number;
  slotHeight: (start: string, end: string) => number;
};

export function CalendarDraftPreview({
  activeEdit,
  colKey,
  colSlots,
  overlayColumnWidth,
  getLaneMetrics,
  slotTop,
  slotHeight,
}: CalendarDraftPreviewProps) {
  if (!activeEdit || activeEdit.draft.date !== colKey) return null;

  const draftTop = slotTop(activeEdit.draft.start);
  const draftHeight = slotHeight(activeEdit.draft.start, activeEdit.draft.end);
  const draftLaneSlot: LaneRenderable = {
    id: activeEdit.originalSlot?.id ?? "draft-preview",
    start: activeEdit.draft.start,
    end: activeEdit.draft.end,
    source: activeEdit.originalSlot?.source ?? "derived",
    tags: activeEdit.originalSlot?.tags ?? activeEdit.draft.tags,
  };
  const draftLanePool = colSlots
    .filter((slot) => slot.id !== activeEdit.originalSlot?.id)
    .map((slot) => ({
      id: slot.id,
      start: slot.start,
      end: slot.end,
      source: slot.source,
      tags: slot.tags,
    }))
    .concat(draftLaneSlot);
  const draftLaneMetrics = getLaneMetrics(draftLaneSlot, draftLanePool, overlayColumnWidth);
  const draftColor = toneColor(activeEdit.draft.tone);
  const previewClass = activeEdit.blocked
    ? "border-rose-400/80 bg-rose-950/45 text-rose-100"
    : `${draftColor.border} ${draftColor.bg}`;

  return (
    <div
      className={`pointer-events-none absolute overflow-hidden rounded-xl border-2 border-dashed px-2 py-2 shadow-[0_18px_42px_rgba(0,0,0,0.28)] ${previewClass} ${
        activeEdit.blocked ? "opacity-95" : "opacity-90"
      }`}
      style={{ top: draftTop, left: draftLaneMetrics.left, width: draftLaneMetrics.width, height: draftHeight, minHeight: 20 }}
    >
      <p className={`text-[10px] font-semibold leading-tight ${activeEdit.blocked ? "text-rose-100" : draftColor.text}`}>
        {formatScheduleTimeRange(activeEdit.draft.start, activeEdit.draft.end)}
      </p>
      <p className={`mt-0.5 font-semibold leading-snug ${activeEdit.blocked ? "text-rose-100" : draftColor.text} ${draftLaneMetrics.isSupportLane ? "line-clamp-4 text-[10px]" : "truncate text-[11px]"}`}>
        {activeEdit.originalSlot ? activeEdit.draft.title : "Новый слот"}
      </p>
      <p className={`mt-1 text-[9px] font-medium uppercase tracking-[0.14em] ${activeEdit.blocked ? "text-rose-200" : "text-zinc-300"}`}>
        {activeEdit.blocked
          ? `Нельзя · ${activeEdit.blockingSlot?.title ?? "занято"}`
          : activeEdit.mode === "move"
            ? "Ghost · перемещение"
            : activeEdit.mode === "resize-start"
              ? "Ghost · старт"
              : activeEdit.mode === "resize-end"
                ? "Ghost · финиш"
                : "Ghost · создание"}
      </p>
    </div>
  );
}
