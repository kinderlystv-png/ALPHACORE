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
    const snapshot = getServerSnapshot(raw);

    if (mode === "brief") {
      return noStoreJson({ ...snapshot, brief: generateMorningBrief(snapshot) });
    }

    if (mode === "review") {
      return noStoreJson({ ...snapshot, review: generateEveningReview(snapshot) });
    }

    return noStoreJson(snapshot);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown snapshot error";
    return noStoreJson(
      { error: "snapshot_failed", message },
      { status: 500 },
    );
  }
}
