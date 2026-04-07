import pool from "./db";
import { isStorageKey, type StorageKey } from "./app-data-keys";

const TABLE_NAME = "alphacore_cloud_store";
const HISTORY_TABLE_NAME = "alphacore_cloud_store_history";
const WORKSPACE_ID = process.env.ALPHACORE_WORKSPACE_ID ?? "default";
type RevisionMeta = {
  revision: number;
  updatedAt: string | null;
};
type Queryable = {
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
};
type CloudKeyState = {
  exists: boolean;
  value: unknown | null;
  updatedAt: string | null;
  revision: number;
};
export type CloudSnapshot = RevisionMeta & {
  workspaceId: string;
  items: Partial<Record<StorageKey, unknown>>;
  keyMeta: Partial<Record<StorageKey, string | null>>;
};
export type CloudMutationAck = RevisionMeta & {
  key: StorageKey;
  keyUpdatedAt: string | null;
};
export type CloudHistoryEntry = {
  id: string;
  key: StorageKey;
  action: "put" | "delete";
  previousValue: unknown | null;
  nextValue: unknown | null;
  createdAt: string;
};
export type CloudConflictPayload = {
  error: "conflict";
  key: StorageKey;
  expectedUpdatedAt: string | null;
  currentUpdatedAt: string | null;
};
export class CloudConflictError extends Error {
  constructor(readonly payload: CloudConflictPayload) {
    super(`Cloud conflict for ${payload.key}`);
    this.name = "CloudConflictError";
  }
}
let ensureTablePromise: Promise<void> | null = null;

function assertDbConfigured(): void {
  const password = process.env.DB_PASSWORD;

  if (!process.env.DB_HOST || !process.env.DB_USER || !password) {
    throw new Error("ALPHACORE cloud sync is not configured: fill DB_HOST / DB_USER / DB_PASSWORD in .env");
  }

  if (password === "__SET_REAL_PASSWORD_HERE__") {
    throw new Error("ALPHACORE cloud sync is blocked: replace the placeholder DB_PASSWORD in .env with a real PostgreSQL password");
  }
}
function toIsoDateString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}
function toRevision(updatedAt: string | null): number {
  return updatedAt ? new Date(updatedAt).getTime() : 0;
}
function payloadEquals(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function buildConflictPayload(
  key: StorageKey,
  expectedUpdatedAt: string | null | undefined,
  currentUpdatedAt: string | null,
): CloudConflictPayload {
  return {
    error: "conflict",
    key,
    expectedUpdatedAt: expectedUpdatedAt ?? null,
    currentUpdatedAt,
  };
}
async function ensureTable(): Promise<void> {
  assertDbConfigured();

  if (!ensureTablePromise) {
    ensureTablePromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
          workspace_id TEXT NOT NULL,
          storage_key TEXT NOT NULL,
          payload JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (workspace_id, storage_key)
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS ${TABLE_NAME}_workspace_updated_idx
        ON ${TABLE_NAME} (workspace_id, updated_at DESC)
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${HISTORY_TABLE_NAME} (
          id BIGSERIAL PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          storage_key TEXT NOT NULL,
          action TEXT NOT NULL,
          previous_payload JSONB,
          next_payload JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS ${HISTORY_TABLE_NAME}_workspace_key_created_idx
        ON ${HISTORY_TABLE_NAME} (workspace_id, storage_key, created_at DESC)
      `);
    })().catch((error) => {
      ensureTablePromise = null;
      throw error;
    });
  }

  return ensureTablePromise;
}
async function getKeyState(
  key: StorageKey,
  queryable: Queryable = pool,
): Promise<CloudKeyState> {
  await ensureTable();

  const { rows } = await queryable.query<{
    payload: unknown;
    updated_at: Date | string;
  }>(
    `
      SELECT payload, updated_at
      FROM ${TABLE_NAME}
      WHERE workspace_id = $1 AND storage_key = $2
      LIMIT 1
    `,
    [WORKSPACE_ID, key],
  );

  const row = rows[0];
  const updatedAt = toIsoDateString(row?.updated_at);

  return {
    exists: Boolean(row),
    value: row?.payload ?? null,
    updatedAt,
    revision: toRevision(updatedAt),
  };
}
async function recordHistoryEntry(
  queryable: Queryable,
  entry: {
    key: StorageKey;
    action: "put" | "delete";
    previousValue: unknown | null;
    nextValue: unknown | null;
  },
): Promise<void> {
  await queryable.query(
    `
      INSERT INTO ${HISTORY_TABLE_NAME} (
        workspace_id,
        storage_key,
        action,
        previous_payload,
        next_payload,
        created_at
      )
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, NOW())
    `,
    [
      WORKSPACE_ID,
      entry.key,
      entry.action,
      JSON.stringify(entry.previousValue),
      JSON.stringify(entry.nextValue),
    ],
  );
}
async function getRevisionMeta(): Promise<RevisionMeta> {
  await ensureTable();

  const { rows } = await pool.query<{
    revision: string | number | null;
    updated_at: Date | string | null;
  }>(
    `
      SELECT
        COALESCE(MAX((EXTRACT(EPOCH FROM updated_at) * 1000)::BIGINT), 0) AS revision,
        MAX(updated_at) AS updated_at
      FROM ${TABLE_NAME}
      WHERE workspace_id = $1
    `,
    [WORKSPACE_ID],
  );

  const row = rows[0];

  return {
    revision: Number(row?.revision ?? 0),
    updatedAt: toIsoDateString(row?.updated_at),
  };
}
async function finalizeMutationAck(key: StorageKey): Promise<CloudMutationAck> {
  const [meta, keyState] = await Promise.all([getRevisionMeta(), getKeyState(key)]);

  return {
    key,
    ...meta,
    keyUpdatedAt: keyState.updatedAt,
  };
}
export async function getCloudSnapshot(): Promise<CloudSnapshot> {
  await ensureTable();

  const { rows } = await pool.query<{
    storage_key: string;
    payload: unknown;
    updated_at: Date | string;
    revision_ms: string | number;
  }>(
    `
      SELECT
        storage_key,
        payload,
        updated_at,
        (EXTRACT(EPOCH FROM updated_at) * 1000)::BIGINT AS revision_ms
      FROM ${TABLE_NAME}
      WHERE workspace_id = $1
      ORDER BY updated_at DESC
    `,
    [WORKSPACE_ID],
  );

  const items: Partial<Record<StorageKey, unknown>> = {};
  const keyMeta: Partial<Record<StorageKey, string | null>> = {};
  let revision = 0;
  let updatedAt: string | null = null;

  for (const row of rows) {
    const normalizedUpdatedAt = toIsoDateString(row.updated_at);

    if (revision === 0) {
      revision = Number(row.revision_ms ?? 0);
      updatedAt = normalizedUpdatedAt;
    }

    if (isStorageKey(row.storage_key)) {
      items[row.storage_key] = row.payload;
      keyMeta[row.storage_key] = normalizedUpdatedAt;
    }
  }

  return {
    workspaceId: WORKSPACE_ID,
    revision,
    updatedAt,
    items,
    keyMeta,
  };
}
export async function listCloudHistory(
  key: StorageKey,
  limit = 20,
): Promise<CloudHistoryEntry[]> {
  await ensureTable();

  const { rows } = await pool.query<{
    id: string | number;
    storage_key: string;
    action: "put" | "delete";
    previous_payload: unknown;
    next_payload: unknown;
    created_at: Date | string;
  }>(
    `
      SELECT id, storage_key, action, previous_payload, next_payload, created_at
      FROM ${HISTORY_TABLE_NAME}
      WHERE workspace_id = $1 AND storage_key = $2
      ORDER BY created_at DESC, id DESC
      LIMIT $3
    `,
    [WORKSPACE_ID, key, Math.max(1, Math.min(limit, 100))],
  );

  return rows.map((row) => ({
    id: String(row.id),
    key,
    action: row.action,
    previousValue: row.previous_payload ?? null,
    nextValue: row.next_payload ?? null,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}
export async function restoreCloudHistoryEntry(id: string): Promise<CloudMutationAck> {
  await ensureTable();

  const { rows } = await pool.query<{
    storage_key: string;
    previous_payload: unknown;
  }>(
    `
      SELECT storage_key, previous_payload
      FROM ${HISTORY_TABLE_NAME}
      WHERE workspace_id = $1 AND id = $2::bigint
      LIMIT 1
    `,
    [WORKSPACE_ID, id],
  );

  const row = rows[0];

  if (!row || !isStorageKey(row.storage_key)) {
    throw new Error(`History entry not found: ${id}`);
  }

  if (row.previous_payload == null) {
    return deleteCloudItem(row.storage_key);
  }

  return upsertCloudItem(row.storage_key, row.previous_payload);
}
export async function upsertCloudItem(
  key: StorageKey,
  value: unknown,
  options?: { expectedUpdatedAt?: string | null },
): Promise<CloudMutationAck> {
  await ensureTable();

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const current = await getKeyState(key, client);
    const expectedUpdatedAt = options?.expectedUpdatedAt;

    if (expectedUpdatedAt !== undefined && current.updatedAt !== (expectedUpdatedAt ?? null)) {
      throw new CloudConflictError(buildConflictPayload(key, expectedUpdatedAt, current.updatedAt));
    }

    if (current.exists && payloadEquals(current.value, value)) {
      await client.query("COMMIT");
      return finalizeMutationAck(key);
    }

    await client.query(
      `
        INSERT INTO ${TABLE_NAME} (workspace_id, storage_key, payload, updated_at)
        VALUES ($1, $2, $3::jsonb, NOW())
        ON CONFLICT (workspace_id, storage_key)
        DO UPDATE SET
          payload = EXCLUDED.payload,
          updated_at = NOW()
      `,
      [WORKSPACE_ID, key, JSON.stringify(value)],
    );

    await recordHistoryEntry(client, {
      key,
      action: "put",
      previousValue: current.exists ? current.value : null,
      nextValue: value,
    });

    await client.query("COMMIT");
    return finalizeMutationAck(key);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function deleteCloudItem(
  key: StorageKey,
  options?: { expectedUpdatedAt?: string | null },
): Promise<CloudMutationAck> {
  await ensureTable();

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const current = await getKeyState(key, client);
    const expectedUpdatedAt = options?.expectedUpdatedAt;

    if (expectedUpdatedAt !== undefined && current.updatedAt !== (expectedUpdatedAt ?? null)) {
      throw new CloudConflictError(buildConflictPayload(key, expectedUpdatedAt, current.updatedAt));
    }

    if (!current.exists) {
      await client.query("COMMIT");
      return finalizeMutationAck(key);
    }

    await client.query(
      `
        DELETE FROM ${TABLE_NAME}
        WHERE workspace_id = $1 AND storage_key = $2
      `,
      [WORKSPACE_ID, key],
    );

    await recordHistoryEntry(client, {
      key,
      action: "delete",
      previousValue: current.value,
      nextValue: null,
    });

    await client.query("COMMIT");
    return finalizeMutationAck(key);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function upsertCloudItems(
  items: Partial<Record<StorageKey, unknown>>,
  mode: "merge" | "replace" = "merge",
): Promise<RevisionMeta> {
  await ensureTable();

  const entries = Object.entries(items).filter(([key]) => isStorageKey(key)) as Array<
    [StorageKey, unknown]
  >;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    if (mode === "replace") {
      if (entries.length === 0) {
        await client.query(
          `DELETE FROM ${TABLE_NAME} WHERE workspace_id = $1`,
          [WORKSPACE_ID],
        );
      } else {
        await client.query(
          `
            DELETE FROM ${TABLE_NAME}
            WHERE workspace_id = $1
              AND storage_key <> ALL($2::text[])
          `,
          [WORKSPACE_ID, entries.map(([key]) => key)],
        );
      }
    }

    for (const [key, value] of entries) {
      await client.query(
        `
          INSERT INTO ${TABLE_NAME} (workspace_id, storage_key, payload, updated_at)
          VALUES ($1, $2, $3::jsonb, NOW())
          ON CONFLICT (workspace_id, storage_key)
          DO UPDATE SET
            payload = EXCLUDED.payload,
            updated_at = NOW()
        `,
        [WORKSPACE_ID, key, JSON.stringify(value)],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return getRevisionMeta();
}