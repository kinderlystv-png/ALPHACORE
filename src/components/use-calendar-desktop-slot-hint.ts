"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import {
  DESKTOP_SLOT_HINT_DELAY_MS,
  DESKTOP_SLOT_HINT_ESTIMATED_HEIGHT,
  DESKTOP_SLOT_HINT_WIDTH,
  clamp,
  type CalendarViewMode,
  type DesktopSlotHintContent,
  type DesktopSlotHintState,
} from "@/components/calendar-grid-types";

type UseCalendarDesktopSlotHintParams = {
  gridRef: RefObject<HTMLDivElement | null>;
  version: number;
  viewMode: CalendarViewMode;
  compactStart: number;
};

export function useCalendarDesktopSlotHint({
  gridRef,
  version,
  viewMode,
  compactStart,
}: UseCalendarDesktopSlotHintParams) {
  const [desktopSlotHint, setDesktopSlotHint] = useState<DesktopSlotHintState | null>(null);
  const desktopSlotHintTimerRef = useRef<number | null>(null);
  const desktopSlotHintPendingKeyRef = useRef<string | null>(null);
  const resetKeyRef = useRef<string | null>(null);

  const clearDesktopSlotHintTimer = useCallback(() => {
    if (desktopSlotHintTimerRef.current != null) {
      window.clearTimeout(desktopSlotHintTimerRef.current);
      desktopSlotHintTimerRef.current = null;
    }
    desktopSlotHintPendingKeyRef.current = null;
  }, []);

  const hideDesktopSlotHint = useCallback(() => {
    clearDesktopSlotHintTimer();
    setDesktopSlotHint(null);
  }, [clearDesktopSlotHintTimer]);

  const scheduleDesktopSlotHint = useCallback((
    element: HTMLElement,
    slotKey: string,
    content: DesktopSlotHintContent | null,
    options?: { delayMs?: number },
  ) => {
    if (!content) {
      hideDesktopSlotHint();
      return;
    }

    if (desktopSlotHint?.slotKey === slotKey || desktopSlotHintPendingKeyRef.current === slotKey) {
      return;
    }

    clearDesktopSlotHintTimer();
    setDesktopSlotHint(null);

    const rect = element.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const left = clamp(
      rect.right + 14,
      12,
      Math.max(12, viewportW - DESKTOP_SLOT_HINT_WIDTH - 12),
    );
    const top = clamp(
      rect.top + Math.min(rect.height * 0.25, 24),
      12,
      Math.max(12, viewportH - DESKTOP_SLOT_HINT_ESTIMATED_HEIGHT - 12),
    );

    desktopSlotHintPendingKeyRef.current = slotKey;
    const revealHint = () => {
      desktopSlotHintTimerRef.current = null;
      desktopSlotHintPendingKeyRef.current = null;
      setDesktopSlotHint({
        slotKey,
        left,
        top,
        ...content,
      });
    };

    const delayMs = options?.delayMs ?? DESKTOP_SLOT_HINT_DELAY_MS;

    if (delayMs <= 0) {
      revealHint();
      return;
    }

    desktopSlotHintTimerRef.current = window.setTimeout(revealHint, delayMs);
  }, [clearDesktopSlotHintTimer, desktopSlotHint?.slotKey, hideDesktopSlotHint]);

  useEffect(() => {
    return () => {
      clearDesktopSlotHintTimer();
    };
  }, [clearDesktopSlotHintTimer]);

  useEffect(() => {
    const container = gridRef.current;
    if (!container) return;

    const handleScroll = () => hideDesktopSlotHint();

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [gridRef, hideDesktopSlotHint]);

  useEffect(() => {
    const nextResetKey = `${version}:${viewMode}:${compactStart}`;
    if (resetKeyRef.current === nextResetKey) return;
    resetKeyRef.current = nextResetKey;

    clearDesktopSlotHintTimer();
    if (!desktopSlotHint) return;

    const frame = window.requestAnimationFrame(() => {
      setDesktopSlotHint(null);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [clearDesktopSlotHintTimer, compactStart, desktopSlotHint, version, viewMode]);

  return {
    desktopSlotHint,
    desktopSlotHintPendingKeyRef,
    hideDesktopSlotHint,
    scheduleDesktopSlotHint,
  };
}
