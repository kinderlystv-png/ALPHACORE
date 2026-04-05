import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { isStorageKey, type StorageKey } from "@/lib/app-data-keys";
import {
  deleteCloudItem,
  getCloudSnapshot,
  upsertCloudItem,
  upsertCloudItems,
} from "@/lib/cloud-store-server";
import { MAX_PAYLOAD_BYTES } from "@/lib/validation";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = MAX_PAYLOAD_BYTES;

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

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown storage error";
}

function parseStorageKey(value: unknown): StorageKey | null {
  return typeof value === "string" && isStorageKey(value) ? value : null;
}

async function safeJsonBody(request: NextRequest): Promise<unknown> {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    throw new PayloadTooLargeError();
  }
  return JSON.parse(text) as unknown;
}

class PayloadTooLargeError extends Error {
  constructor() {
    super("Payload too large");
  }
}

function applyRateLimit(request: NextRequest): Response | null {
  const key = getRateLimitKey(request.headers);
  const result = checkRateLimit(key, { windowMs: 60_000, maxRequests: 120 });
  if (!result.allowed) {
    return noStoreJson(
      { error: "rate_limited", retryAfterMs: result.retryAfterMs },
      { status: 429, headers: { "Retry-After": String(Math.ceil(result.retryAfterMs / 1000)) } },
    ) as unknown as Response;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const rid = requestId(request);
  try {
    return noStoreJson(await getCloudSnapshot(), { reqId: rid });
  } catch (error) {
    console.error(`[storage][${rid}] GET failed:`, toMessage(error));
    return noStoreJson(
      { error: "storage_read_failed", message: toMessage(error), requestId: rid },
      { status: 500, reqId: rid },
    );
  }
}

export async function PUT(request: NextRequest) {
  const rid = requestId(request);
  const rateLimited = applyRateLimit(request);
  if (rateLimited) return rateLimited;
  try {
    const body = await safeJsonBody(request);
    const obj = body as Record<string, unknown> | null;
    const key = parseStorageKey(obj?.key);

    if (!key) {
      return noStoreJson({ error: "invalid_key", requestId: rid }, { status: 400, reqId: rid });
    }

    return noStoreJson(await upsertCloudItem(key, obj?.value ?? null), { reqId: rid });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return noStoreJson({ error: "payload_too_large", requestId: rid }, { status: 413, reqId: rid });
    }
    console.error(`[storage][${rid}] PUT failed:`, toMessage(error));
    return noStoreJson(
      { error: "storage_write_failed", message: toMessage(error), requestId: rid },
      { status: 500, reqId: rid },
    );
  }
}

export async function POST(request: NextRequest) {
  const rid = requestId(request);
  const rateLimited = applyRateLimit(request);
  if (rateLimited) return rateLimited;
  try {
    const body = await safeJsonBody(request);
    const obj = body as Record<string, unknown> | null;
    const mode = obj?.mode === "replace" ? "replace" : "merge";
    const rawItems = obj?.items;

    if (!rawItems || typeof rawItems !== "object" || Array.isArray(rawItems)) {
      return noStoreJson({ error: "invalid_items", requestId: rid }, { status: 400, reqId: rid });
    }

    const items = Object.fromEntries(
      Object.entries(rawItems).filter(([key]) => isStorageKey(key)),
    ) as Partial<Record<StorageKey, unknown>>;

    return noStoreJson(await upsertCloudItems(items, mode), { reqId: rid });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return noStoreJson({ error: "payload_too_large", requestId: rid }, { status: 413, reqId: rid });
    }
    console.error(`[storage][${rid}] POST failed:`, toMessage(error));
    return noStoreJson(
      { error: "storage_bulk_write_failed", message: toMessage(error), requestId: rid },
      { status: 500, reqId: rid },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const rid = requestId(request);
  const rateLimited = applyRateLimit(request);
  if (rateLimited) return rateLimited;
  try {
    let key = parseStorageKey(request.nextUrl.searchParams.get("key"));

    if (!key) {
      const body = await request.json().catch(() => null);
      key = parseStorageKey(body?.key);
    }

    if (!key) {
      return noStoreJson({ error: "invalid_key", requestId: rid }, { status: 400, reqId: rid });
    }

    return noStoreJson(await deleteCloudItem(key), { reqId: rid });
  } catch (error) {
    console.error(`[storage][${rid}] DELETE failed:`, toMessage(error));
    return noStoreJson(
      { error: "storage_delete_failed", message: toMessage(error), requestId: rid },
      { status: 500, reqId: rid },
    );
  }
}