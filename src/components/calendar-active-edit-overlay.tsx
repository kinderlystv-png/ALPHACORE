"use client";

import { clamp, formatDurationDelta, TOTAL_HOURS, ROW_H, type ActivePointerEdit } from "@/components/calendar-grid-types";
import { formatScheduleClockTime, formatScheduleTimeRange, timeToMinutes } from "@/lib/schedule";

export type CalendarActiveEditOverlayProps = {
  activeEdit: ActivePointerEdit | null;
  headerHeight: number;
  pointerX: number;
  pointerY: number;
  slotTop: (start: string) => number;
};

export function CalendarActiveEditOverlay({
  activeEdit,
  headerHeight,
  pointerX,
  pointerY,
  slotTop,
}: CalendarActiveEditOverlayProps) {
  if (!activeEdit) return null;

  const startTop = slotTop(activeEdit.draft.start);
  const endTop = slotTop(activeEdit.draft.end);
  const startMin = timeToMinutes(activeEdit.draft.start);
  const endMin = timeToMinutes(activeEdit.draft.end);
  const baseDuration = timeToMinutes(activeEdit.base.end) - timeToMinutes(activeEdit.base.start);
  const draftDuration = endMin - startMin;
  const durationDelta = draftDuration - baseDuration;
  const tooltipColor = activeEdit.blocked
    ? "border-rose-400/60 bg-rose-950/92 text-rose-100"
    : "border-sky-400/35 bg-zinc-950/92 text-zinc-100";
  const guideColor = activeEdit.blocked ? "border-rose-400/50" : "border-sky-400/35";
  const tooltipWidth = 176;
  const tooltipHeight = 72;
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 0;
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 0;
  const tooltipLeft = clamp(pointerX + 18, 12, Math.max(12, viewportW - tooltipWidth - 12));
  const tooltipTop = clamp(pointerY - tooltipHeight - 12, 12, Math.max(12, viewportH - tooltipHeight - 12));
  const durationMeta =
    activeEdit.mode === "resize-start" || activeEdit.mode === "resize-end"
      ? formatDurationDelta(durationDelta)
      : activeEdit.draft.date !== activeEdit.base.date
        ? `→ ${activeEdit.draft.date.slice(5)}`
        : `${draftDuration}м`;

  return (
    <>
      <div className="pointer-events-none fixed z-50" style={{ left: tooltipLeft, top: tooltipTop, width: tooltipWidth }}>
        <div className={`rounded-2xl border px-3 py-2 shadow-[0_14px_30px_rgba(0,0,0,0.28)] backdrop-blur ${tooltipColor}`}>
          <p className="text-[11px] font-semibold tracking-[0.02em]">
            {formatScheduleTimeRange(activeEdit.draft.start, activeEdit.draft.end)}
          </p>
          <div className="mt-1 flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.14em]">
            <span className={activeEdit.blocked ? "text-rose-200" : "text-zinc-400"}>
              {activeEdit.mode === "move"
                ? "Drag"
                : activeEdit.mode === "resize-start"
                  ? "Resize start"
                  : activeEdit.mode === "resize-end"
                    ? "Resize end"
                    : "Create"}
            </span>
            <span className={activeEdit.blocked ? "text-rose-200" : "text-sky-300"}>{durationMeta}</span>
          </div>
          {activeEdit.blocked && (
            <p className="mt-1 truncate text-[10px] text-rose-200">
              Конфликт: {activeEdit.blockingSlot?.title ?? "занято"}
            </p>
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0 z-20" style={{ top: headerHeight, left: 56, width: "calc(100% - 56px)", height: TOTAL_HOURS * ROW_H }}>
        {[
          { top: startTop, label: formatScheduleClockTime(activeEdit.draft.start) },
          { top: endTop, label: formatScheduleClockTime(activeEdit.draft.end) },
        ].map((guide) => (
          <div key={`${guide.label}-${guide.top}`} className="absolute left-0 right-0" style={{ top: guide.top }}>
            <div className={`border-t border-dashed ${guideColor}`} />
            <span className={`absolute left-2 top-0 -translate-y-1/2 rounded-full border px-2 py-0.5 text-[10px] font-medium shadow-[0_6px_18px_rgba(0,0,0,0.18)] ${tooltipColor}`}>
              {guide.label}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
