"use client";

import type { EditableSlotDraft, ReboundPreview } from "@/components/calendar-grid-types";
import { formatScheduleTimeRange } from "@/lib/schedule";

type OverlayBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type CalendarReboundPreviewProps = {
  reboundPreview: ReboundPreview | null;
  getOverlayBoxForDraft: (
    draft: EditableSlotDraft,
    laneMeta: { id: string; source: ReboundPreview["source"]; tags: string[] },
    originalSlotId?: string | null,
  ) => OverlayBox | null;
};

export function CalendarReboundPreview({
  reboundPreview,
  getOverlayBoxForDraft,
}: CalendarReboundPreviewProps) {
  if (!reboundPreview) return null;

  const targetDraft = reboundPreview.stage === "from" ? reboundPreview.from : reboundPreview.to;
  const box = getOverlayBoxForDraft(
    targetDraft,
    {
      id: reboundPreview.slotId ?? "rebound-preview",
      source: reboundPreview.source,
      tags: reboundPreview.tags,
    },
    reboundPreview.slotId,
  );

  if (!box) return null;

  return (
    <div
      className="pointer-events-none absolute overflow-hidden rounded-xl border-2 border-rose-400/75 bg-rose-950/35 px-2 py-2 opacity-90 shadow-[0_20px_44px_rgba(0,0,0,0.3)] transition-all duration-200 ease-out"
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        minHeight: 20,
      }}
    >
      <p className="text-[10px] font-semibold leading-tight text-rose-100">
        {formatScheduleTimeRange(targetDraft.start, targetDraft.end)}
      </p>
      <p className="mt-0.5 truncate text-[11px] font-semibold leading-snug text-rose-100">
        {reboundPreview.title}
      </p>
      <p className="mt-1 text-[9px] font-medium uppercase tracking-[0.14em] text-rose-200">
        Возврат назад{reboundPreview.blockedLabel ? ` · занято: ${reboundPreview.blockedLabel}` : ""}
      </p>
    </div>
  );
}
