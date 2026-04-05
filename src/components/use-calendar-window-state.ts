"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getCompactStart,
  type CalendarViewMode,
  type DayColumn,
} from "@/components/calendar-grid-types";

function getTodayWindowAnchor() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function buildWindow(anchor: Date): Date[] {
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: 8 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function useCalendarAnchorNavigation() {
  const [anchor, setAnchor] = useState<Date | null>(null);
  const [shouldCenterNow, setShouldCenterNow] = useState(true);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setAnchor(getTodayWindowAnchor());
      setShouldCenterNow(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  const days = useMemo(() => (anchor ? buildWindow(anchor) : []), [anchor]);

  const shiftWeek = useCallback((delta: number) => {
    setAnchor((prev) => {
      if (!prev) return getTodayWindowAnchor();
      const next = new Date(prev);
      next.setDate(prev.getDate() + delta * 7);
      return next;
    });
  }, []);

  const goToday = useCallback(() => {
    setAnchor(getTodayWindowAnchor());
    setShouldCenterNow(true);
  }, []);

  const markNowCentered = useCallback(() => {
    setShouldCenterNow(false);
  }, []);

  const weekLabel = useMemo(() => {
    if (days.length === 0) return "";
    const first = days[0];
    const last = days[days.length - 1];
    const fmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
    return `${fmt.format(first)} — ${fmt.format(last)}`;
  }, [days]);

  return {
    anchor,
    days,
    shouldCenterNow,
    markNowCentered,
    shiftWeek,
    goToday,
    weekLabel,
  };
}

type UseCalendarViewWindowParams = {
  columns: DayColumn[];
  shiftWeek: (delta: number) => void;
  goToday: () => void;
};

export function useCalendarViewWindow({
  columns,
  shiftWeek,
  goToday,
}: UseCalendarViewWindowParams) {
  const [viewMode, setViewMode] = useState<CalendarViewMode>("full");
  const [compactStart, setCompactStart] = useState(0);
  const [viewportWidth, setViewportWidth] = useState<number | null>(null);
  const responsiveInitRef = useRef(false);

  useEffect(() => {
    const syncViewport = () => {
      const width = window.innerWidth;
      setViewportWidth(width);

      if (!responsiveInitRef.current) {
        responsiveInitRef.current = true;
        setViewMode("full");
      }
    };

    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  const compactCount = viewportWidth != null && viewportWidth < 640 ? 2 : 3;

  useEffect(() => {
    if (viewMode !== "compact" || columns.length === 0) return;

    const frame = window.requestAnimationFrame(() => {
      setCompactStart((current) => {
        const maxStart = Math.max(0, columns.length - compactCount);
        if (current > maxStart) return maxStart;
        if (current === 0) return getCompactStart(columns, compactCount);
        return current;
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [columns, compactCount, viewMode]);

  const visibleColumns = useMemo(() => {
    if (viewMode === "full") return columns;
    return columns.slice(compactStart, compactStart + compactCount);
  }, [columns, compactCount, compactStart, viewMode]);

  const visibleWindowLabel = useMemo(() => {
    if (visibleColumns.length === 0) return "";
    const first = visibleColumns[0]?.date;
    const last = visibleColumns[visibleColumns.length - 1]?.date;
    if (!first || !last) return "";
    const fmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
    return `${fmt.format(first)} — ${fmt.format(last)}`;
  }, [visibleColumns]);

  const showCompactControls = viewMode === "compact" && columns.length > compactCount;

  const switchToCompact = useCallback(() => {
    setViewMode("compact");
    setCompactStart(getCompactStart(columns, compactCount));
  }, [columns, compactCount]);

  const switchToFull = useCallback(() => {
    setViewMode("full");
  }, []);

  const shiftCompactWindow = useCallback((delta: number) => {
    setCompactStart((current) => {
      const maxStart = Math.max(0, columns.length - compactCount);
      return Math.max(0, Math.min(maxStart, current + delta));
    });
  }, [columns.length, compactCount]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (viewMode === "compact") {
          shiftCompactWindow(-1);
        } else {
          shiftWeek(-1);
        }
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (viewMode === "compact") {
          shiftCompactWindow(1);
        } else {
          shiftWeek(1);
        }
      } else if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        goToday();
        setCompactStart(0);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goToday, shiftCompactWindow, shiftWeek, viewMode]);

  return {
    viewMode,
    compactStart,
    compactCount,
    viewportWidth,
    visibleColumns,
    visibleWindowLabel,
    showCompactControls,
    switchToCompact,
    switchToFull,
    shiftCompactWindow,
    resetCompactWindow: () => setCompactStart(0),
  };
}
