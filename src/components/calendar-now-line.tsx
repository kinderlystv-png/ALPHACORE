"use client";

import { useEffect, useState } from "react";

import { ROW_H, TOTAL_HOURS, calcNowTop } from "@/components/calendar-grid-types";

export function CalendarNowLine() {
  const [top, setTop] = useState(() => calcNowTop());

  useEffect(() => {
    const id = window.setInterval(() => setTop(calcNowTop()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  if (top < 0 || top > TOTAL_HOURS * ROW_H) return null;

  return (
    <div
      className="pointer-events-none absolute left-0 right-0 z-30"
      style={{ top }}
    >
      <div className="flex items-center">
        <div className="h-2.5 w-2.5 rounded-full bg-rose-500" />
        <div className="h-px flex-1 bg-rose-500/70" />
      </div>
    </div>
  );
}
