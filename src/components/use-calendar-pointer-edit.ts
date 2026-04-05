"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type React from "react";

import {
  AUTO_SCROLL_EDGE_PX,
  AUTO_SCROLL_MAX_STEP,
  DEFAULT_CUSTOM_DURATION_MIN,
  HOUR_END,
  HOUR_START,
  MIN_SLOT_MIN,
  MOUSE_HOLD_MS,
  POINTER_SLOP_PX,
  ROW_H,
  TOTAL_HOURS,
  TOUCH_HOLD_MS,
  clamp,
  minutesToCalendarTime,
  sameEdgeCue,
  slotHeight as sharedSlotHeight,
  slotTop as sharedSlotTop,
  snapMinutes,
  vibrateIfAvailable,
  type ActivePointerEdit,
  type DayColumn,
  type EdgeCueState,
  type EditableSlotDraft,
  type LaneRenderable,
  type PendingPointerEdit,
  type PointerEditMode,
  type ReboundPreview,
} from "@/components/calendar-grid-types";
import { getLaneMetrics } from "@/components/calendar-overlay-helpers";
import {
  addCustomEvent,
  isEditableScheduleSlot,
  timeToMinutes,
  updateEditableScheduleSlot,
  type ScheduleSlot,
} from "@/lib/schedule";

type UseCalendarPointerEditParams = {
  gridRef: RefObject<HTMLDivElement | null>;
  overlayGridRef: RefObject<HTMLDivElement | null>;
  visibleColumnsRef: { current: DayColumn[] };
  skipNextClickRef: { current: boolean };
  today: string;
  closeQuickMenu: () => void;
  getBlockingSlot: (
    draft: EditableSlotDraft,
    originalSlot: ScheduleSlot | null,
  ) => ScheduleSlot | null;
  onVersionBump: () => void;
};

function slotTop(startTime: string): number {
  return sharedSlotTop(startTime, timeToMinutes);
}

function slotHeight(start: string, end: string): number {
  return sharedSlotHeight(start, end, timeToMinutes);
}

export function useCalendarPointerEdit({
  gridRef,
  overlayGridRef,
  visibleColumnsRef,
  skipNextClickRef,
  today,
  closeQuickMenu,
  getBlockingSlot,
  onVersionBump,
}: UseCalendarPointerEditParams) {
  const [activeEdit, setActiveEdit] = useState<ActivePointerEdit | null>(null);
  const [edgeCue, setEdgeCue] = useState<EdgeCueState>({ top: 0, bottom: 0, left: 0, right: 0 });
  const [reboundPreview, setReboundPreview] = useState<ReboundPreview | null>(null);

  const pendingEditRef = useRef<{ data: PendingPointerEdit; timerId: number } | null>(null);
  const activeEditRef = useRef<ActivePointerEdit | null>(null);
  const activePointerClientRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const autoScrollFrameRef = useRef<number | null>(null);
  const reboundTimerRef = useRef<number | null>(null);
  const reboundFrameRef = useRef<number | null>(null);

  useEffect(() => {
    activeEditRef.current = activeEdit;
  }, [activeEdit]);

  const cancelPendingPointerEdit = useCallback(() => {
    if (!pendingEditRef.current) return;
    window.clearTimeout(pendingEditRef.current.timerId);
    pendingEditRef.current = null;
  }, []);

  const resetEdgeCue = useCallback(() => {
    setEdgeCue((current) =>
      sameEdgeCue(current, { top: 0, bottom: 0, left: 0, right: 0 })
        ? current
        : { top: 0, bottom: 0, left: 0, right: 0 },
    );
  }, []);

  const toEditableDraft = useCallback((slot: ScheduleSlot): EditableSlotDraft => {
    return {
      id: slot.id,
      date: slot.date,
      start: slot.start,
      end: slot.end,
      title: slot.title,
      tone: slot.tone,
      tags: slot.tags,
      kind: slot.kind === "event" ? "event" : "task",
    };
  }, []);

  const getPointerDayIndex = useCallback((clientX: number): number => {
    const rect = overlayGridRef.current?.getBoundingClientRect();
    const columns = visibleColumnsRef.current;
    if (!rect || columns.length === 0) return 0;
    const columnWidth = rect.width / columns.length;
    const raw = Math.floor((clientX - rect.left) / Math.max(columnWidth, 1));
    return clamp(raw, 0, columns.length - 1);
  }, [overlayGridRef, visibleColumnsRef]);

  const getPointerDayKey = useCallback((clientX: number): string => {
    const columns = visibleColumnsRef.current;
    return columns[getPointerDayIndex(clientX)]?.key ?? columns[0]?.key ?? today;
  }, [getPointerDayIndex, today, visibleColumnsRef]);

  const getSnappedMinutesFromClientY = useCallback((clientY: number): number => {
    const rect = overlayGridRef.current?.getBoundingClientRect();
    if (!rect) return HOUR_START * 60;

    const relativeY = clamp(clientY - rect.top, 0, TOTAL_HOURS * ROW_H);
    const rawMinutes = HOUR_START * 60 + (relativeY / ROW_H) * 60;
    return clamp(snapMinutes(rawMinutes), HOUR_START * 60, HOUR_END * 60);
  }, [overlayGridRef]);

  const updateEdgeCueFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const container = gridRef.current;
      if (!container) {
        resetEdgeCue();
        return;
      }

      const rect = container.getBoundingClientRect();
      const next: EdgeCueState = {
        top: Number(
          clamp((rect.top + AUTO_SCROLL_EDGE_PX - clientY) / AUTO_SCROLL_EDGE_PX, 0, 1).toFixed(2),
        ),
        bottom: Number(
          clamp((clientY - (rect.bottom - AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX, 0, 1).toFixed(2),
        ),
        left: Number(
          clamp((rect.left + AUTO_SCROLL_EDGE_PX - clientX) / AUTO_SCROLL_EDGE_PX, 0, 1).toFixed(2),
        ),
        right: Number(
          clamp((clientX - (rect.right - AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX, 0, 1).toFixed(2),
        ),
      };

      setEdgeCue((current) => (sameEdgeCue(current, next) ? current : next));
    },
    [gridRef, resetEdgeCue],
  );

  const getOverlayBoxForDraft = useCallback(
    (
      draft: EditableSlotDraft,
      laneMeta: Pick<LaneRenderable, "id" | "source" | "tags">,
      originalSlotId?: string | null,
    ) => {
      const overlayWidth = overlayGridRef.current?.getBoundingClientRect().width;
      const columns = visibleColumnsRef.current;
      if (!overlayWidth || columns.length === 0) return null;

      const columnIndex = columns.findIndex((column) => column.key === draft.date);
      if (columnIndex === -1) return null;

      const columnWidth = overlayWidth / columns.length;
      const daySlots = columns[columnIndex]?.slots ?? [];
      const laneSlot: LaneRenderable = {
        id: laneMeta.id,
        start: draft.start,
        end: draft.end,
        source: laneMeta.source,
        tags: laneMeta.tags,
      };
      const lanePool: LaneRenderable[] = daySlots
        .filter((slot) => slot.id !== originalSlotId)
        .map((slot) => ({
          id: slot.id,
          start: slot.start,
          end: slot.end,
          source: slot.source,
          tags: slot.tags,
        }))
        .concat(laneSlot);
      const laneMetrics = getLaneMetrics(laneSlot, lanePool, columnWidth);

      return {
        top: slotTop(draft.start),
        height: slotHeight(draft.start, draft.end),
        left: columnIndex * columnWidth + laneMetrics.left,
        width: laneMetrics.width,
      };
    },
    [overlayGridRef, visibleColumnsRef],
  );

  const triggerReboundPreview = useCallback((edit: ActivePointerEdit) => {
    if (reboundTimerRef.current != null) {
      window.clearTimeout(reboundTimerRef.current);
    }
    if (reboundFrameRef.current != null) {
      window.cancelAnimationFrame(reboundFrameRef.current);
    }

    const id = `rebound-${Date.now().toString(36)}`;
    const preview: ReboundPreview = {
      id,
      slotId: edit.originalSlot?.id ?? null,
      slotDate: edit.originalSlot?.date ?? edit.base.date,
      from: edit.draft,
      to: edit.base,
      stage: "from",
      source: edit.originalSlot?.source ?? "derived",
      tags: edit.originalSlot?.tags ?? edit.base.tags,
      tone: edit.base.tone,
      title: edit.base.title,
      blockedLabel: edit.blockingSlot?.title ?? null,
    };

    setReboundPreview(preview);
    reboundFrameRef.current = window.requestAnimationFrame(() => {
      setReboundPreview((current) =>
        current?.id === id ? { ...current, stage: "to" } : current,
      );
    });
    reboundTimerRef.current = window.setTimeout(() => {
      setReboundPreview((current) => (current?.id === id ? null : current));
    }, 240);
  }, []);

  const buildDraftFromPointer = useCallback(
    (edit: ActivePointerEdit, clientX: number, clientY: number): ActivePointerEdit => {
      const baseStartMin = timeToMinutes(edit.base.start);
      const baseEndMin = timeToMinutes(edit.base.end);
      const duration = baseEndMin - baseStartMin;
      const pointerMin = getSnappedMinutesFromClientY(clientY);
      const targetDate = getPointerDayKey(clientX);

      let draft = edit.draft;

      if (edit.mode === "move") {
        const nextStart = clamp(
          pointerMin - edit.pointerOffsetMin,
          HOUR_START * 60,
          HOUR_END * 60 - duration,
        );
        draft = {
          ...edit.base,
          date: targetDate,
          start: minutesToCalendarTime(nextStart),
          end: minutesToCalendarTime(nextStart + duration),
        };
      }

      if (edit.mode === "resize-start") {
        const nextStart = clamp(pointerMin, HOUR_START * 60, baseEndMin - MIN_SLOT_MIN);
        draft = {
          ...edit.base,
          start: minutesToCalendarTime(nextStart),
        };
      }

      if (edit.mode === "resize-end") {
        const nextEnd = clamp(pointerMin, baseStartMin + MIN_SLOT_MIN, HOUR_END * 60);
        draft = {
          ...edit.base,
          end: minutesToCalendarTime(nextEnd),
        };
      }

      if (edit.mode === "create") {
        const anchorMin = baseStartMin;
        const low = clamp(
          Math.min(anchorMin, pointerMin),
          HOUR_START * 60,
          HOUR_END * 60 - MIN_SLOT_MIN,
        );
        const high = clamp(
          Math.max(anchorMin, pointerMin),
          low + MIN_SLOT_MIN,
          HOUR_END * 60,
        );

        draft = {
          ...edit.base,
          date: targetDate,
          start: minutesToCalendarTime(low),
          end: minutesToCalendarTime(high),
        };
      }

      const blockingSlot = getBlockingSlot(draft, edit.originalSlot);

      return {
        ...edit,
        draft,
        blocked: Boolean(blockingSlot),
        blockingSlot,
        hasMoved:
          edit.hasMoved ||
          Math.abs(clientX - edit.originClientX) > POINTER_SLOP_PX ||
          Math.abs(clientY - edit.originClientY) > POINTER_SLOP_PX ||
          draft.date !== edit.base.date ||
          draft.start !== edit.base.start ||
          draft.end !== edit.base.end,
      };
    },
    [getBlockingSlot, getPointerDayKey, getSnappedMinutesFromClientY],
  );

  const activatePendingPointerEdit = useCallback(
    (pending: PendingPointerEdit) => {
      const originColumnIndex = visibleColumnsRef.current.findIndex(
        (column) => column.key === pending.dayKey,
      );
      const startMin = getSnappedMinutesFromClientY(pending.startY);
      const base: EditableSlotDraft = pending.slot
        ? toEditableDraft(pending.slot)
        : {
            id: null,
            date: pending.dayKey,
            start: minutesToCalendarTime(
              clamp(startMin, HOUR_START * 60, HOUR_END * 60 - MIN_SLOT_MIN),
            ),
            end: minutesToCalendarTime(
              clamp(
                startMin + DEFAULT_CUSTOM_DURATION_MIN,
                HOUR_START * 60 + MIN_SLOT_MIN,
                HOUR_END * 60,
              ),
            ),
            title: "Новый слот",
            tone: "work",
            tags: ["custom"],
            kind: "task" as const,
          };
      const baseStartMin = timeToMinutes(base.start);
      const baseEndMin = timeToMinutes(base.end);
      const durationMin = Math.max(baseEndMin - baseStartMin, MIN_SLOT_MIN);
      const pointerOffsetMin =
        pending.slot && pending.mode === "move"
          ? clamp(startMin - baseStartMin, 0, durationMin)
          : 0;

      const blockingSlot = getBlockingSlot(base, pending.slot);
      const next: ActivePointerEdit = {
        mode: pending.mode,
        pointerId: pending.pointerId,
        pointerType: pending.pointerType,
        originClientX: pending.startX,
        originClientY: pending.startY,
        pointerOffsetMin,
        originColumnIndex: Math.max(originColumnIndex, 0),
        originalSlot: pending.slot,
        base,
        draft: base,
        hasMoved: false,
        blocked: Boolean(blockingSlot),
        blockingSlot,
      };

      skipNextClickRef.current = true;
      closeQuickMenu();
      activeEditRef.current = next;
      setActiveEdit(next);
      document.body.style.userSelect = "none";
      activePointerClientRef.current = { x: pending.startX, y: pending.startY };
      vibrateIfAvailable(10);
    },
    [closeQuickMenu, getBlockingSlot, getSnappedMinutesFromClientY, skipNextClickRef, toEditableDraft, visibleColumnsRef],
  );

  const commitPointerEdit = useCallback(
    (edit: ActivePointerEdit) => {
      const { draft, originalSlot } = edit;
      closeQuickMenu();

      const blockingSlot = getBlockingSlot(draft, originalSlot);
      if (blockingSlot) {
        vibrateIfAvailable([16, 50, 16]);
        return false;
      }

      if (!originalSlot) {
        addCustomEvent({
          date: draft.date,
          start: draft.start,
          end: draft.end,
          title: draft.title,
          tone: draft.tone,
          tags: draft.tags,
          kind: draft.kind,
        });
        onVersionBump();
        vibrateIfAvailable(8);
        return true;
      }

      updateEditableScheduleSlot(originalSlot, {
        date: draft.date,
        start: draft.start,
        end: draft.end,
        title: draft.title,
        tone: draft.tone,
        tags: draft.tags,
      });
      onVersionBump();
      vibrateIfAvailable(8);
      return true;
    },
    [closeQuickMenu, getBlockingSlot, onVersionBump],
  );

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const pending = pendingEditRef.current;
      if (pending?.data.pointerId === event.pointerId) {
        if (
          Math.abs(event.clientX - pending.data.startX) > POINTER_SLOP_PX ||
          Math.abs(event.clientY - pending.data.startY) > POINTER_SLOP_PX
        ) {
          cancelPendingPointerEdit();
        }
      }

      const edit = activeEditRef.current;
      if (!edit || edit.pointerId !== event.pointerId) return;

      event.preventDefault();
      activePointerClientRef.current = { x: event.clientX, y: event.clientY };
      updateEdgeCueFromPointer(event.clientX, event.clientY);
      const next = buildDraftFromPointer(edit, event.clientX, event.clientY);
      activeEditRef.current = next;
      setActiveEdit(next);
    };

    const handlePointerFinish = (event: PointerEvent) => {
      const pending = pendingEditRef.current;
      if (pending?.data.pointerId === event.pointerId) {
        cancelPendingPointerEdit();
      }

      const edit = activeEditRef.current;
      if (!edit || edit.pointerId !== event.pointerId) return;

      event.preventDefault();
      const committed = commitPointerEdit(edit);
      activeEditRef.current = null;
      setActiveEdit(null);
      document.body.style.userSelect = "";
      activePointerClientRef.current = { x: 0, y: 0 };
      resetEdgeCue();
      if (!committed) {
        triggerReboundPreview(edit);
      }
      window.setTimeout(() => {
        skipNextClickRef.current = false;
      }, 0);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerFinish, { passive: false });
    window.addEventListener("pointercancel", handlePointerFinish, { passive: false });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerFinish);
      window.removeEventListener("pointercancel", handlePointerFinish);
      document.body.style.userSelect = "";
      resetEdgeCue();
    };
  }, [
    buildDraftFromPointer,
    cancelPendingPointerEdit,
    commitPointerEdit,
    resetEdgeCue,
    skipNextClickRef,
    triggerReboundPreview,
    updateEdgeCueFromPointer,
  ]);

  useEffect(() => {
    if (!activeEdit) return;

    const tick = () => {
      const container = gridRef.current;
      const edit = activeEditRef.current;
      if (!container || !edit) {
        autoScrollFrameRef.current = null;
        return;
      }

      const { x, y } = activePointerClientRef.current;
      const rect = container.getBoundingClientRect();

      let deltaY = 0;
      let deltaX = 0;

      if (y < rect.top + AUTO_SCROLL_EDGE_PX) {
        deltaY = -Math.ceil(
          ((rect.top + AUTO_SCROLL_EDGE_PX - y) / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_STEP,
        );
      } else if (y > rect.bottom - AUTO_SCROLL_EDGE_PX) {
        deltaY = Math.ceil(
          ((y - (rect.bottom - AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_STEP,
        );
      }

      if (x < rect.left + AUTO_SCROLL_EDGE_PX) {
        deltaX = -Math.ceil(
          ((rect.left + AUTO_SCROLL_EDGE_PX - x) / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_STEP,
        );
      } else if (x > rect.right - AUTO_SCROLL_EDGE_PX) {
        deltaX = Math.ceil(
          ((x - (rect.right - AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_STEP,
        );
      }

      if (deltaY !== 0 || deltaX !== 0) {
        const prevTop = container.scrollTop;
        const prevLeft = container.scrollLeft;

        container.scrollTop = clamp(
          prevTop + deltaY,
          0,
          Math.max(container.scrollHeight - container.clientHeight, 0),
        );
        container.scrollLeft = clamp(
          prevLeft + deltaX,
          0,
          Math.max(container.scrollWidth - container.clientWidth, 0),
        );

        if (container.scrollTop !== prevTop || container.scrollLeft !== prevLeft) {
          const next = buildDraftFromPointer(edit, x, y);
          activeEditRef.current = next;
          setActiveEdit(next);
        }
      }

      autoScrollFrameRef.current = window.requestAnimationFrame(tick);
    };

    autoScrollFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (autoScrollFrameRef.current != null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }
    };
  }, [activeEdit, buildDraftFromPointer, gridRef]);

  useEffect(() => {
    return () => {
      if (reboundTimerRef.current != null) {
        window.clearTimeout(reboundTimerRef.current);
      }
      if (reboundFrameRef.current != null) {
        window.cancelAnimationFrame(reboundFrameRef.current);
      }
    };
  }, []);

  const queuePointerEdit = useCallback(
    (
      mode: PointerEditMode,
      event: React.PointerEvent<HTMLElement>,
      dayKey: string,
      slot: ScheduleSlot | null,
    ) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (slot && !isEditableScheduleSlot(slot)) return;
      if (!slot && dayKey < today) return;

      closeQuickMenu();
      cancelPendingPointerEdit();

      const data: PendingPointerEdit = {
        mode,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        startX: event.clientX,
        startY: event.clientY,
        dayKey,
        slot,
      };

      const delay = event.pointerType === "touch" ? TOUCH_HOLD_MS : MOUSE_HOLD_MS;
      const timerId = window.setTimeout(() => {
        activatePendingPointerEdit(data);
        pendingEditRef.current = null;
      }, delay);

      pendingEditRef.current = { data, timerId };
    },
    [activatePendingPointerEdit, cancelPendingPointerEdit, closeQuickMenu, today],
  );

  return {
    activeEdit,
    edgeCue,
    reboundPreview,
    activePointerClientRef,
    queuePointerEdit,
    getOverlayBoxForDraft,
  };
}
