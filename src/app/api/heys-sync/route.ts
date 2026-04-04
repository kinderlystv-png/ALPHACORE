import { NextResponse } from "next/server";
import { syncFromHeys, extractHealthSignals, type HeysSyncSnapshot } from "@/lib/heys-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/heys-sync
 *
 * Pulls latest data from HEYS REST API (read-only) and returns a
 * health-signals summary for ALPHACORE agent-control model.
 *
 * HEYS is not modified in any way — this is a one-way read bridge.
 */

let cachedSnapshot: HeysSyncSnapshot | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 30_000; // 30s cache so intraday shifts reach ALPHACORE faster

export async function GET() {
  try {
    const now = Date.now();

    if (cachedSnapshot && now - cachedAt < CACHE_TTL_MS) {
      return NextResponse.json({
        cached: true,
        signals: extractHealthSignals(cachedSnapshot),
        snapshot: cachedSnapshot,
      }, {
        headers: { "Cache-Control": "no-store, max-age=0" },
      });
    }

    const snapshot = await syncFromHeys();
    cachedSnapshot = snapshot;
    cachedAt = now;

    return NextResponse.json({
      cached: false,
      signals: extractHealthSignals(snapshot),
      snapshot,
    }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "HEYS sync failed";
    return NextResponse.json(
      { error: "heys_sync_failed", message },
      { status: 500 },
    );
  }
}
