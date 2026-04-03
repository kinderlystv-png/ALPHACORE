import pool from "./db";
import { isStorageKey, type StorageKey } from "./app-data-keys";

const TABLE_NAME = "alphacore_cloud_store";
const WORKSPACE_ID = process.env.ALPHACORE_WORKSPACE_ID ?? "default";

type RevisionMeta = {
  revision: number;
  updatedAt: string | null;
};

export type CloudSnapshot = RevisionMeta & {
  workspaceId: string;
  items: Partial<Record<StorageKey, unknown>>;
};

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
    })().catch((error) => {
      ensureTablePromise = null;
      throw error;
    });
  }

  return ensureTablePromise;
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
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
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
  let revision = 0;
  let updatedAt: string | null = null;

  for (const row of rows) {
    if (revision === 0) {
      revision = Number(row.revision_ms ?? 0);
      updatedAt = new Date(row.updated_at).toISOString();
    }

    if (isStorageKey(row.storage_key)) {
      items[row.storage_key] = row.payload;
    }
  }

  return {
    workspaceId: WORKSPACE_ID,
    revision,
    updatedAt,
    items,
  };
}

export async function upsertCloudItem(
  key: StorageKey,
  value: unknown,
): Promise<RevisionMeta & { key: StorageKey }> {
  await ensureTable();

  await pool.query(
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

  const meta = await getRevisionMeta();
  return { key, ...meta };
}

export async function deleteCloudItem(
  key: StorageKey,
): Promise<RevisionMeta & { key: StorageKey }> {
  await ensureTable();

  await pool.query(
    `
      DELETE FROM ${TABLE_NAME}
      WHERE workspace_id = $1 AND storage_key = $2
    `,
    [WORKSPACE_ID, key],
  );

  const meta = await getRevisionMeta();
  return { key, ...meta };
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