/* ── Client-side hook to fetch HEYS health signals ── */

import { useState, useEffect, useCallback } from "react";
import type { HeysHealthSignals, HeysSyncSnapshot } from "./heys-bridge";

type HeysListener = () => void;

type HeysSyncState = {
  signals: HeysHealthSignals | null;
  snapshot: HeysSyncSnapshot | null;
  loading: boolean;
  error: string | null;
  lastSynced: string | null;
  refresh: () => void;
};

const POLL_INTERVAL_MS = 60_000; // 1 minute while the dashboard is open
const VISIBILITY_REFRESH_STALE_MS = 20_000;

let sharedSignals: HeysHealthSignals | null = null;
let sharedSnapshot: HeysSyncSnapshot | null = null;
let lastFetched = 0;
let fetchPromise: Promise<void> | null = null;
const listeners = new Set<HeysListener>();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

async function doFetch(): Promise<void> {
  const res = await fetch("/api/heys-sync");
  if (!res.ok) throw new Error(`HEYS sync HTTP ${res.status}`);
  const data = await res.json();
  sharedSignals = data.signals;
  sharedSnapshot = data.snapshot;
  lastFetched = Date.now();
  notifyListeners();
}

export function useHeysSync(): HeysSyncState {
  const [signals, setSignals] = useState<HeysHealthSignals | null>(sharedSignals);
  const [snapshot, setSnapshot] = useState<HeysSyncSnapshot | null>(sharedSnapshot);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<string | null>(
    sharedSnapshot?.syncedAt ?? null,
  );

  const syncFromShared = useCallback(() => {
    setSignals(sharedSignals);
    setSnapshot(sharedSnapshot);
    setLastSynced(sharedSnapshot?.syncedAt ?? null);
  }, []);

  const refresh = useCallback(() => {
    if (fetchPromise) return;

    setLoading(true);
    setError(null);

    fetchPromise = doFetch()
      .then(() => {
        syncFromShared();
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "HEYS sync failed");
      })
      .finally(() => {
        setLoading(false);
        fetchPromise = null;
      });
  }, [syncFromShared]);

  useEffect(() => {
    listeners.add(syncFromShared);
    return () => {
      listeners.delete(syncFromShared);
    };
  }, [syncFromShared]);

  useEffect(() => {
    const shouldRefresh = (staleMs = POLL_INTERVAL_MS) => Date.now() - lastFetched > staleMs;

    // Initial fetch if stale or never fetched
    if (shouldRefresh()) {
      refresh();
    }

    // Poll every minute while the page is open
    const timer = setInterval(() => {
      if (shouldRefresh()) {
        refresh();
      }
    }, 60_000);

    const handleFocus = () => {
      if (shouldRefresh(VISIBILITY_REFRESH_STALE_MS)) {
        refresh();
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && shouldRefresh(VISIBILITY_REFRESH_STALE_MS)) {
        refresh();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refresh]);

  return { signals, snapshot, loading, error, lastSynced, refresh };
}

/**
 * Standalone getter for agent-control (non-React context).
 * Returns cached signals or null if never fetched.
 */
export function getHeysSignals(): HeysHealthSignals | null {
  return sharedSignals;
}
