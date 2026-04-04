/* ── Client-side hook to fetch HEYS health signals ── */

import { useState, useEffect, useCallback } from "react";
import type { HeysHealthSignals, HeysSyncSnapshot } from "./heys-bridge";

type HeysSyncState = {
  signals: HeysHealthSignals | null;
  snapshot: HeysSyncSnapshot | null;
  loading: boolean;
  error: string | null;
  lastSynced: string | null;
  refresh: () => void;
};

const POLL_INTERVAL_MS = 5 * 60_000; // 5 minutes

let sharedSignals: HeysHealthSignals | null = null;
let sharedSnapshot: HeysSyncSnapshot | null = null;
let lastFetched = 0;
let fetchPromise: Promise<void> | null = null;

async function doFetch(): Promise<void> {
  const res = await fetch("/api/heys-sync");
  if (!res.ok) throw new Error(`HEYS sync HTTP ${res.status}`);
  const data = await res.json();
  sharedSignals = data.signals;
  sharedSnapshot = data.snapshot;
  lastFetched = Date.now();
}

export function useHeysSync(): HeysSyncState {
  const [signals, setSignals] = useState<HeysHealthSignals | null>(sharedSignals);
  const [snapshot, setSnapshot] = useState<HeysSyncSnapshot | null>(sharedSnapshot);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<string | null>(
    sharedSnapshot?.syncedAt ?? null,
  );

  const refresh = useCallback(() => {
    if (fetchPromise) return;

    setLoading(true);
    setError(null);

    fetchPromise = doFetch()
      .then(() => {
        setSignals(sharedSignals);
        setSnapshot(sharedSnapshot);
        setLastSynced(sharedSnapshot?.syncedAt ?? null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "HEYS sync failed");
      })
      .finally(() => {
        setLoading(false);
        fetchPromise = null;
      });
  }, []);

  useEffect(() => {
    // Initial fetch if stale or never fetched
    if (Date.now() - lastFetched > POLL_INTERVAL_MS) {
      refresh();
    }

    // Poll every 5 minutes
    const timer = setInterval(() => {
      if (Date.now() - lastFetched > POLL_INTERVAL_MS) {
        refresh();
      }
    }, 60_000);

    return () => clearInterval(timer);
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
