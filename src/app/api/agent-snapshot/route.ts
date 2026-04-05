import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

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

function requestId(request: NextRequest): string {
  return request.headers.get("x-request-id") || randomUUID().slice(0, 8);
}

function noStoreJson(payload: unknown, init?: ResponseInit & { reqId?: string }) {
  const { reqId, ...rest } = init ?? {};
  return NextResponse.json(payload, {
    ...rest,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      ...(reqId ? { "x-request-id": reqId } : {}),
      ...(rest.headers ?? {}),
    },
  });
}

export async function GET(request: NextRequest) {
  const rid = requestId(request);
  try {
    const mode = request.nextUrl.searchParams.get("mode");
    const cloudSnapshot = await getCloudSnapshot();

    let raw;
    try {
      raw = extractRawData(cloudSnapshot.items);
    } catch (extractError) {
      console.error(`[agent-snapshot][${rid}] extractRawData failed:`, extractError);
      return noStoreJson(
        { error: "data_extraction_failed", message: extractError instanceof Error ? extractError.message : "Unknown", requestId: rid },
        { status: 500, reqId: rid },
      );
    }

    // Fetch HEYS health signals (best-effort — don't block snapshot on failure)
    let heysSignals = null;
    try {
      const heysSnapshot = await syncFromHeys();
      heysSignals = extractHealthSignals(heysSnapshot);
    } catch {
      // HEYS unavailable — continue with ALPHACORE-only data
    }

    let snapshot;
    try {
      snapshot = getServerSnapshot(raw, heysSignals);
    } catch (snapshotError) {
      console.error(`[agent-snapshot][${rid}] getServerSnapshot failed:`, snapshotError);
      return noStoreJson(
        { error: "snapshot_build_failed", message: snapshotError instanceof Error ? snapshotError.message : "Unknown", requestId: rid },
        { status: 500, reqId: rid },
      );
    }

    if (mode === "brief") {
      return noStoreJson({ ...snapshot, brief: generateMorningBrief(snapshot), heysSignals, requestId: rid }, { reqId: rid });
    }

    if (mode === "review") {
      return noStoreJson({ ...snapshot, review: generateEveningReview(snapshot), heysSignals, requestId: rid }, { reqId: rid });
    }

    return noStoreJson({ ...snapshot, heysSignals, requestId: rid }, { reqId: rid });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown snapshot error";
    console.error(`[agent-snapshot][${rid}] GET failed:`, message);
    return noStoreJson(
      { error: "snapshot_failed", message, requestId: rid },
      { status: 500, reqId: rid },
    );
  }
}
