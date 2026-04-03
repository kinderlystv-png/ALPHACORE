import { NextRequest, NextResponse } from "next/server";

import { isStorageKey, type StorageKey } from "@/lib/app-data-keys";
import {
  deleteCloudItem,
  getCloudSnapshot,
  upsertCloudItem,
  upsertCloudItems,
} from "@/lib/cloud-store-server";

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

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown storage error";
}

function parseStorageKey(value: unknown): StorageKey | null {
  return typeof value === "string" && isStorageKey(value) ? value : null;
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
    const body = await request.json();
    const key = parseStorageKey(body?.key);

    if (!key) {
      return noStoreJson({ error: "invalid_key" }, { status: 400 });
    }

    return noStoreJson(await upsertCloudItem(key, body?.value ?? null));
  } catch (error) {
    return noStoreJson(
      { error: "storage_write_failed", message: toMessage(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const mode = body?.mode === "replace" ? "replace" : "merge";
    const rawItems = body?.items;

    if (!rawItems || typeof rawItems !== "object" || Array.isArray(rawItems)) {
      return noStoreJson({ error: "invalid_items" }, { status: 400 });
    }

    const items = Object.fromEntries(
      Object.entries(rawItems).filter(([key]) => isStorageKey(key)),
    ) as Partial<Record<StorageKey, unknown>>;

    return noStoreJson(await upsertCloudItems(items, mode));
  } catch (error) {
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