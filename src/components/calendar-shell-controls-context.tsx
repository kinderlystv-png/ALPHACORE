"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type CalendarShellViewDays = 3 | 8;

type CalendarShellControlsContextValue = {
  viewDays: CalendarShellViewDays;
  setViewDays: (value: CalendarShellViewDays) => void;
  todayJumpToken: number;
  requestGoToday: () => void;
};

const STORAGE_KEY = "alphacore_dashboard_calendar_view_days_v1";

const CalendarShellControlsContext = createContext<CalendarShellControlsContextValue | null>(null);

function normalizeViewDays(value: string | null): CalendarShellViewDays {
  return value === "3" ? 3 : 8;
}

export function CalendarShellControlsProvider({ children }: { children: ReactNode }) {
  const [viewDays, setViewDaysState] = useState<CalendarShellViewDays>(8);
  const [todayJumpToken, setTodayJumpToken] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const nextViewDays = (() => {
      try {
        return normalizeViewDays(window.localStorage.getItem(STORAGE_KEY));
      } catch {
        return 8;
      }
    })();

    const frame = window.requestAnimationFrame(() => {
      setViewDaysState((current) => (current === nextViewDays ? current : nextViewDays));
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  const setViewDays = useCallback((value: CalendarShellViewDays) => {
    setViewDaysState(value);

    if (typeof window === "undefined") return;

    try {
      window.localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // ignore storage write failures
    }
  }, []);

  const requestGoToday = useCallback(() => {
    setTodayJumpToken((current) => current + 1);
  }, []);

  const value = useMemo(
    () => ({
      viewDays,
      setViewDays,
      todayJumpToken,
      requestGoToday,
    }),
    [requestGoToday, setViewDays, todayJumpToken, viewDays],
  );

  return (
    <CalendarShellControlsContext.Provider value={value}>
      {children}
    </CalendarShellControlsContext.Provider>
  );
}

export function useCalendarShellControls(): CalendarShellControlsContextValue {
  return (
    useContext(CalendarShellControlsContext) ?? {
      viewDays: 8,
      setViewDays: () => undefined,
      todayJumpToken: 0,
      requestGoToday: () => undefined,
    }
  );
}
