import { NextRequest, NextResponse } from "next/server";

import { getCloudSnapshot } from "@/lib/cloud-store-server";
import {
  extractRawData,
  getServerSnapshot,
} from "@/lib/agent-control-server";
import {
  generateMorningBrief,
  generateEveningReview,
} from "@/lib/agent-brief";
import { syncFromHeys, extractHealthSignals } from "@/lib/heys-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(payload: unknown, init?: ResponseInit) {
  return NextResponse.json(payload, {
    ...init,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      ...(init?.headers ?? {}),
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    const mode = request.nextUrl.searchParams.get("mode");
    const cloudSnapshot = await getCloudSnapshot();
    const raw = extractRawData(cloudSnapshot.items);

    // Fetch HEYS health signals (best-effort — don't block snapshot on failure)
    let heysSignals = null;
    try {
      const heysSnapshot = await syncFromHeys();
      heysSignals = extractHealthSignals(heysSnapshot);
    } catch {
      // HEYS unavailable — continue with ALPHACORE-only data
    }

    const snapshot = getServerSnapshot(raw, heysSignals);

    if (mode === "brief") {
      return noStoreJson({ ...snapshot, brief: generateMorningBrief(snapshot), heysSignals });
    }

    if (mode === "review") {
      return noStoreJson({ ...snapshot, review: generateEveningReview(snapshot), heysSignals });
    }

    return noStoreJson({ ...snapshot, heysSignals });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown snapshot error";
    return noStoreJson(
      { error: "snapshot_failed", message },
      { status: 500 },
    );
  }
}
