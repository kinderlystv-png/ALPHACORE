import { NextRequest, NextResponse } from "next/server";

import { isStorageKey, type StorageKey } from "@/lib/app-data-keys";
import {
  deleteCloudItem,
  getCloudSnapshot,
  upsertCloudItem,
  upsertCloudItems,
} from "@/lib/cloud-store-server";
import { MAX_PAYLOAD_BYTES } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = MAX_PAYLOAD_BYTES;

function noStoreJson(payload: unknown, init?: ResponseInit) {
  return NextResponse.json(payload, {
    ...init,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      ...(init?.headers ?? {}),
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

export async function GET() {
  try {
    return noStoreJson(await getCloudSnapshot());
  } catch (error) {
    return noStoreJson(
      { error: "storage_read_failed", message: toMessage(error) },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await safeJsonBody(request);
    const obj = body as Record<string, unknown> | null;
    const key = parseStorageKey(obj?.key);

    if (!key) {
      return noStoreJson({ error: "invalid_key" }, { status: 400 });
    }

    return noStoreJson(await upsertCloudItem(key, obj?.value ?? null));
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return noStoreJson({ error: "payload_too_large" }, { status: 413 });
    }
    return noStoreJson(
      { error: "storage_write_failed", message: toMessage(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await safeJsonBody(request);
    const obj = body as Record<string, unknown> | null;
    const mode = obj?.mode === "replace" ? "replace" : "merge";
    const rawItems = obj?.items;

    if (!rawItems || typeof rawItems !== "object" || Array.isArray(rawItems)) {
      return noStoreJson({ error: "invalid_items" }, { status: 400 });
    }

    const items = Object.fromEntries(
      Object.entries(rawItems).filter(([key]) => isStorageKey(key)),
    ) as Partial<Record<StorageKey, unknown>>;

    return noStoreJson(await upsertCloudItems(items, mode));
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return noStoreJson({ error: "payload_too_large" }, { status: 413 });
    }
    return noStoreJson(
      { error: "storage_bulk_write_failed", message: toMessage(error) },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    let key = parseStorageKey(request.nextUrl.searchParams.get("key"));

    if (!key) {
      const body = await request.json().catch(() => null);
      key = parseStorageKey(body?.key);
    }

    if (!key) {
      return noStoreJson({ error: "invalid_key" }, { status: 400 });
    }

    return noStoreJson(await deleteCloudItem(key));
  } catch (error) {
    return noStoreJson(
      { error: "storage_delete_failed", message: toMessage(error) },
      { status: 500 },
    );
  }
}