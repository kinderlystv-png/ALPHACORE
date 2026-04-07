import { STORAGE_KEYS, isStorageKey, type StorageKey } from "./app-data-keys";

/* ── Shared local cache + cloud sync helpers for ALPHACORE ── */

export { STORAGE_KEYS } from "./app-data-keys";

export const APP_DATA_EVENT = "alphacore:data-change";
export const APP_SYNC_EVENT = "alphacore:sync-state";
export const APP_UNDO_EVENT = "alphacore:undo-state";
export const APP_RECOVERY_EVENT = "alphacore:recovery-state";

const CLOUD_META_KEY = "alphacore_cloud_meta";
const CLOUD_KEY_META_KEY = "alphacore_cloud_key_meta_v1";
const CLOUD_PENDING_KEY = "alphacore_cloud_pending_keys";
const UNDO_HISTORY_KEY = "alphacore_undo_history_v1";
const LOCAL_RECOVERY_SNAPSHOTS_KEY = "alphacore_local_recovery_snapshots_v1";
const LOCAL_RECOVERY_LIMIT = 12;
const UNDO_HISTORY_LIMIT = 48;
const UNDO_EXTRA_KEYS = ["alphacore_schedule_approvals"] as const;
const RECOVERY_MANAGED_KEYS = [
  "alphacore_tasks",
  "alphacore_notes",
  "alphacore_habits",
  "alphacore_medical",
  "alphacore_sickness",
  "alphacore_projects",
  "alphacore_journal",
  "alphacore_schedule_custom",
  "alphacore_schedule_overrides",
] as const;
const CLOUD_API_PATH = "/api/storage";
const CLOUD_POLL_INTERVAL_MS = 5000;
const CLOUD_FLUSH_DEBOUNCE_MS = 250;

type AppDataDetail = {
  keys: string[];
};

type SyncStatus = "idle" | "booting" | "syncing" | "synced" | "offline" | "error";

type CloudMeta = {
  remoteRevision: number;
  lastSyncedAt: string | null;
};

type CloudKeyMeta = Partial<Record<StorageKey, string | null>>;

type CloudSnapshot = {
  workspaceId: string;
  revision: number;
  updatedAt: string | null;
  items: Partial<Record<StorageKey, unknown>>;
  keyMeta?: CloudKeyMeta;
};

type CloudMutationAck = {
  key?: StorageKey;
  revision: number;
  updatedAt: string | null;
  keyUpdatedAt?: string | null;
};

type SyncDetail = {
  state: AppSyncState;
};

type UndoDetail = {
  state: UndoStateSnapshot;
};

export type LocalRecoverySnapshot = {
  id: string;
  createdAt: string;
  source: "remote-overwrite" | "sync-conflict";
  summary: string;
  keys: StorageKey[];
  items: Partial<Record<StorageKey, unknown | null>>;
  remoteUpdatedAt: string | null;
};

type RecoveryDetail = {
  snapshots: LocalRecoverySnapshot[];
};

type UndoHistoryEntry = {
  id: string;
  createdAt: string;
  keys: string[];
  before: Record<string, string | null>;
};

export type UndoStateSnapshot = {
  canUndo: boolean;
  pendingCount: number;
  lastActionAt: string | null;
};

type UndoManagedKey = StorageKey | (typeof UNDO_EXTRA_KEYS)[number];

export type AppSyncState = {
  mode: "cloud-cache";
  status: SyncStatus;
  pendingKeys: StorageKey[];
  lastSyncedAt: string | null;
  remoteRevision: number;
  lastError: string | null;
};

let initPromise: Promise<void> | null = null;
let pollTimer: number | null = null;
let flushTimer: number | null = null;
let isFlushing = false;
let isPulling = false;
let listenersAttached = false;
let undoCommitTimer: number | null = null;
let pendingUndoBatch: Record<string, string | null> | null = null;
let isApplyingUndo = false;

let syncState: AppSyncState = {
  mode: "cloud-cache",
  status: "idle",
  pendingKeys: [],
  lastSyncedAt: null,
  remoteRevision: 0,
  lastError: null,
};

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function readJson<T>(key: string, fallback: T): T {
  if (!isBrowser()) return fallback;

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function readCloudMeta(): CloudMeta {
  return readJson<CloudMeta>(CLOUD_META_KEY, {
    remoteRevision: 0,
    lastSyncedAt: null,
  });
}

function readCloudKeyMeta(): CloudKeyMeta {
  const raw = readJson<Record<string, unknown>>(CLOUD_KEY_META_KEY, {});
  const next: CloudKeyMeta = {};

  for (const key of STORAGE_KEYS) {
    const value = raw[key];
    if (value === null || typeof value === "string") {
      next[key] = value;
    }
  }

  return next;
}

function writeCloudKeyMeta(meta: CloudKeyMeta): void {
  if (!isBrowser()) return;
  writeJson(CLOUD_KEY_META_KEY, meta);
}

function isRecoveryManagedKey(key: string): key is StorageKey {
  return (RECOVERY_MANAGED_KEYS as readonly string[]).includes(key);
}

function buildRecoverySummary(
  source: LocalRecoverySnapshot["source"],
  keys: StorageKey[],
): string {
  const labels: Partial<Record<StorageKey, string>> = {
    alphacore_tasks: "задачи",
    alphacore_notes: "заметки",
    alphacore_habits: "привычки",
    alphacore_medical: "анализы",
    alphacore_sickness: "болезнь",
    alphacore_projects: "группы",
    alphacore_journal: "дневник",
    alphacore_schedule_custom: "календарь",
    alphacore_schedule_overrides: "оверрайды недели",
  };

  const primaryLabel = labels[keys[0]] ?? keys[0]?.replace(/^alphacore_/, "") ?? "данные";

  if (source === "sync-conflict") {
    return keys.length > 1
      ? `Локальная копия до конфликта sync · ${primaryLabel} +${keys.length - 1}`
      : `Локальная копия до конфликта sync · ${primaryLabel}`;
  }

  return keys.length > 1
    ? `Локальная копия до remote update · ${primaryLabel} +${keys.length - 1}`
    : `Локальная копия до remote update · ${primaryLabel}`;
}

function sanitizeLocalRecoverySnapshot(entry: LocalRecoverySnapshot): LocalRecoverySnapshot | null {
  if (!entry || typeof entry !== "object") return null;
  if (typeof entry.id !== "string" || typeof entry.createdAt !== "string") return null;
  if (entry.source !== "remote-overwrite" && entry.source !== "sync-conflict") return null;
  if (!Array.isArray(entry.keys) || !entry.items || typeof entry.items !== "object") return null;

  const keys = entry.keys.filter((key): key is StorageKey => typeof key === "string" && isStorageKey(key));
  if (keys.length === 0) return null;

  const items = Object.fromEntries(
    keys.map((key) => [key, Object.prototype.hasOwnProperty.call(entry.items, key) ? entry.items[key] ?? null : null]),
  ) as Partial<Record<StorageKey, unknown | null>>;

  return {
    id: entry.id,
    createdAt: entry.createdAt,
    source: entry.source,
    summary: typeof entry.summary === "string" && entry.summary.trim()
      ? entry.summary
      : buildRecoverySummary(entry.source, keys),
    keys,
    items,
    remoteUpdatedAt: typeof entry.remoteUpdatedAt === "string" ? entry.remoteUpdatedAt : null,
  };
}

function readLocalRecoverySnapshots(): LocalRecoverySnapshot[] {
  return readJson<LocalRecoverySnapshot[]>(LOCAL_RECOVERY_SNAPSHOTS_KEY, [])
    .map((entry) => sanitizeLocalRecoverySnapshot(entry))
    .filter((entry): entry is LocalRecoverySnapshot => entry != null);
}

function emitRecoveryStateChange(): void {
  if (!isBrowser()) return;

  window.dispatchEvent(
    new CustomEvent<RecoveryDetail>(APP_RECOVERY_EVENT, {
      detail: { snapshots: readLocalRecoverySnapshots() },
    }),
  );
}

function writeLocalRecoverySnapshots(snapshots: LocalRecoverySnapshot[]): void {
  if (!isBrowser()) return;
  writeJson(LOCAL_RECOVERY_SNAPSHOTS_KEY, snapshots.slice(0, LOCAL_RECOVERY_LIMIT));
  emitRecoveryStateChange();
}

function captureLocalRecoverySnapshot(
  rawItems: Partial<Record<StorageKey, string | null>>,
  source: LocalRecoverySnapshot["source"],
  options?: { summary?: string; remoteUpdatedAt?: string | null },
): void {
  if (!isBrowser()) return;

  const items: Partial<Record<StorageKey, unknown | null>> = {};
  const keys: StorageKey[] = [];

  for (const [key, raw] of Object.entries(rawItems)) {
    if (!isStorageKey(key) || !isRecoveryManagedKey(key)) continue;
    if (raw == null) continue;

    try {
      items[key] = JSON.parse(raw) as unknown;
      keys.push(key);
    } catch {
      /* ignore malformed snapshot candidate */
    }
  }

  if (keys.length === 0) return;

  const snapshot: LocalRecoverySnapshot = {
    id: uid(),
    createdAt: new Date().toISOString(),
    source,
    summary: options?.summary?.trim() || buildRecoverySummary(source, keys),
    keys,
    items,
    remoteUpdatedAt: options?.remoteUpdatedAt ?? null,
  };

  const snapshots = readLocalRecoverySnapshots();
  const signature = JSON.stringify({ source: snapshot.source, keys: snapshot.keys, items: snapshot.items });
  const latest = snapshots[0];

  if (latest) {
    const latestSignature = JSON.stringify({ source: latest.source, keys: latest.keys, items: latest.items });
    if (latestSignature === signature) {
      return;
    }
  }

  snapshots.unshift(snapshot);
  writeLocalRecoverySnapshots(snapshots);
}

function isUndoManagedKey(key: string): key is UndoManagedKey {
  return isStorageKey(key) || (UNDO_EXTRA_KEYS as readonly string[]).includes(key);
}

function sanitizeUndoHistoryEntry(entry: UndoHistoryEntry): UndoHistoryEntry | null {
  if (!entry || typeof entry !== "object") return null;
  if (typeof entry.id !== "string" || typeof entry.createdAt !== "string") return null;
  if (!Array.isArray(entry.keys) || entry.keys.length === 0) return null;
  if (!entry.before || typeof entry.before !== "object") return null;

  const keys = entry.keys.filter((key) => typeof key === "string" && isUndoManagedKey(key));
  if (keys.length === 0) return null;

  const before = Object.fromEntries(
    keys.map((key) => [key, Object.prototype.hasOwnProperty.call(entry.before, key) ? entry.before[key] ?? null : null]),
  ) as Record<string, string | null>;

  return {
    id: entry.id,
    createdAt: entry.createdAt,
    keys,
    before,
  };
}

function readUndoHistory(): UndoHistoryEntry[] {
  return readJson<UndoHistoryEntry[]>(UNDO_HISTORY_KEY, [])
    .map((entry) => sanitizeUndoHistoryEntry(entry))
    .filter((entry): entry is UndoHistoryEntry => entry != null);
}

function emitUndoStateChange(state: UndoStateSnapshot = { canUndo: false, pendingCount: 0, lastActionAt: null }): void {
  if (!isBrowser()) return;
  window.dispatchEvent(
    new CustomEvent<UndoDetail>(APP_UNDO_EVENT, {
      detail: { state },
    }),
  );
}

function writeUndoHistory(history: UndoHistoryEntry[]): void {
  if (!isBrowser()) return;
  writeJson(UNDO_HISTORY_KEY, history.slice(0, UNDO_HISTORY_LIMIT));
  emitUndoStateChange();
}

function flushPendingUndoBatch(): void {
  if (!isBrowser() || !pendingUndoBatch) return;

  if (undoCommitTimer != null) {
    window.clearTimeout(undoCommitTimer);
    undoCommitTimer = null;
  }

  const batch = pendingUndoBatch;
  pendingUndoBatch = null;

  const changedKeys = Object.keys(batch).filter(
    (key) => window.localStorage.getItem(key) !== batch[key],
  );

  if (changedKeys.length === 0) return;

  const history = readUndoHistory();
  history.unshift({
    id: uid(),
    createdAt: new Date().toISOString(),
    keys: changedKeys,
    before: Object.fromEntries(changedKeys.map((key) => [key, batch[key] ?? null])),
  });
  writeUndoHistory(history);
}

function scheduleUndoCommit(): void {
  if (!isBrowser()) return;

  if (undoCommitTimer != null) {
    window.clearTimeout(undoCommitTimer);
  }

  undoCommitTimer = window.setTimeout(() => {
    undoCommitTimer = null;
    flushPendingUndoBatch();
  }, 0);
}

function captureUndoBeforeChange(key: string): void {
  if (!isBrowser() || isApplyingUndo || !isUndoManagedKey(key)) return;

  pendingUndoBatch ??= {};

  if (!Object.prototype.hasOwnProperty.call(pendingUndoBatch, key)) {
    pendingUndoBatch[key] = window.localStorage.getItem(key);
  }

  scheduleUndoCommit();
}

function findUndoEntryIndex(history: UndoHistoryEntry[], keys: string[]): number {
  if (keys.length === 0) return -1;
  const keySet = new Set(keys);

  return history.findIndex((entry) => entry.keys.some((key) => keySet.has(key)));
}

function writeCloudMeta(meta: CloudMeta): void {
  if (!isBrowser()) return;
  writeJson(CLOUD_META_KEY, meta);
}

function readPendingKeys(): StorageKey[] {
  return readJson<string[]>(CLOUD_PENDING_KEY, []).filter(isStorageKey);
}

function writePendingKeys(keys: StorageKey[]): void {
  if (!isBrowser()) return;

  const unique = Array.from(new Set(keys)).filter(isStorageKey);
  writeJson(CLOUD_PENDING_KEY, unique);
  syncState = { ...syncState, pendingKeys: unique };
  emitSyncStateChange();
}

function emitSyncStateChange(): void {
  if (!isBrowser()) return;
  window.dispatchEvent(
    new CustomEvent<SyncDetail>(APP_SYNC_EVENT, {
      detail: { state: getSyncStateSnapshot() },
    }),
  );
}

function updateSyncState(patch: Partial<AppSyncState>): void {
  syncState = {
    ...syncState,
    ...patch,
    pendingKeys: patch.pendingKeys ?? syncState.pendingKeys,
  };
  emitSyncStateChange();
}

function syncStateFromStorage(): AppSyncState {
  const meta = readCloudMeta();
  return {
    ...syncState,
    pendingKeys: readPendingKeys(),
    lastSyncedAt: meta.lastSyncedAt,
    remoteRevision: meta.remoteRevision,
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Sync error";
}

function shouldPausePolling(): boolean {
  return (
    syncState.status === "error" &&
    !!syncState.lastError &&
    /placeholder|not configured|DB_PASSWORD|credentials/i.test(syncState.lastError)
  );
}

function readLocalSnapshot(): Partial<Record<StorageKey, unknown>> {
  if (!isBrowser()) return {};

  const items: Partial<Record<StorageKey, unknown>> = {};

  for (const key of STORAGE_KEYS) {
    const raw = window.localStorage.getItem(key);
    if (raw == null) continue;

    try {
      items[key] = JSON.parse(raw) as unknown;
    } catch {
      /* ignore malformed cache entry */
    }
  }

  return items;
}

function hasSnapshotData(snapshot: Partial<Record<StorageKey, unknown>>): boolean {
  return Object.keys(snapshot).length > 0;
}

function writeCacheValue(key: string, value: unknown): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function scheduleFlush(delay = CLOUD_FLUSH_DEBOUNCE_MS): void {
  if (!isBrowser()) return;

  if (flushTimer != null) {
    window.clearTimeout(flushTimer);
  }

  flushTimer = window.setTimeout(() => {
    void flushPendingKeys();
  }, delay);
}

class CloudConflictError extends Error {
  constructor(
    readonly key: StorageKey,
    readonly currentUpdatedAt: string | null,
    readonly expectedUpdatedAt: string | null,
  ) {
    super(`Cloud conflict for ${key}`);
    this.name = "CloudConflictError";
  }
}

async function fetchCloudSnapshot(): Promise<CloudSnapshot> {
  const response = await fetch(CLOUD_API_PATH, {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { message?: string }
      | null;
    throw new Error(payload?.message ?? `Cloud snapshot failed: ${response.status}`);
  }

  return (await response.json()) as CloudSnapshot;
}

async function putCloudKey(key: StorageKey, value: unknown): Promise<CloudMutationAck> {
  const expectedUpdatedAt = readCloudKeyMeta()[key] ?? null;
  const response = await fetch(CLOUD_API_PATH, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ key, value, expectedUpdatedAt }),
  });

  const payload = (await response.json().catch(() => null)) as
    | ({ message?: string; error?: string; key?: StorageKey; currentUpdatedAt?: string | null; expectedUpdatedAt?: string | null } & Record<string, unknown>)
    | null;

  if (!response.ok) {
    if (response.status === 409 && payload?.error === "conflict" && payload.key === key) {
      throw new CloudConflictError(
        key,
        typeof payload.currentUpdatedAt === "string" ? payload.currentUpdatedAt : null,
        typeof payload.expectedUpdatedAt === "string" ? payload.expectedUpdatedAt : expectedUpdatedAt,
      );
    }
    throw new Error(payload?.message ?? `Cloud write failed for ${key}: ${response.status}`);
  }

  return payload as CloudMutationAck;
}

async function deleteCloudKey(key: StorageKey): Promise<CloudMutationAck> {
  const expectedUpdatedAt = readCloudKeyMeta()[key] ?? null;
  const response = await fetch(CLOUD_API_PATH, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ key, expectedUpdatedAt }),
  });

  const payload = (await response.json().catch(() => null)) as
    | ({ message?: string; error?: string; key?: StorageKey; currentUpdatedAt?: string | null; expectedUpdatedAt?: string | null } & Record<string, unknown>)
    | null;

  if (!response.ok) {
    if (response.status === 409 && payload?.error === "conflict" && payload.key === key) {
      throw new CloudConflictError(
        key,
        typeof payload.currentUpdatedAt === "string" ? payload.currentUpdatedAt : null,
        typeof payload.expectedUpdatedAt === "string" ? payload.expectedUpdatedAt : expectedUpdatedAt,
      );
    }
    throw new Error(payload?.message ?? `Cloud delete failed for ${key}: ${response.status}`);
  }

  return payload as CloudMutationAck;
}

async function mergeCloudItems(
  items: Partial<Record<StorageKey, unknown>>,
  mode: "merge" | "replace" = "merge",
): Promise<CloudMutationAck> {
  const response = await fetch(CLOUD_API_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ items, mode }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { message?: string }
      | null;
    throw new Error(payload?.message ?? `Cloud merge failed: ${response.status}`);
  }

  return (await response.json()) as CloudMutationAck;
}

function applyCloudSnapshot(
  snapshot: CloudSnapshot,
  options?: { preservePending?: boolean },
): void {
  if (!isBrowser()) return;

  const preservePending = options?.preservePending ?? true;
  const pending = new Set(readPendingKeys());
  const changedKeys: string[] = [];
  const nextKeyMeta = readCloudKeyMeta();
  const recoveryRawItems: Partial<Record<StorageKey, string | null>> = {};

  for (const key of STORAGE_KEYS) {
    const hasRemoteValue = Object.prototype.hasOwnProperty.call(snapshot.items, key);
    const remoteRaw = hasRemoteValue ? JSON.stringify(snapshot.items[key]) : null;
    const localRaw = window.localStorage.getItem(key);
    const remoteUpdatedAt = snapshot.keyMeta?.[key] ?? null;

    if (preservePending && pending.has(key)) {
      if (remoteRaw === localRaw) {
        if (remoteUpdatedAt == null) delete nextKeyMeta[key];
        else nextKeyMeta[key] = remoteUpdatedAt;
      }
      continue;
    }

    if (remoteRaw === localRaw) {
      if (remoteUpdatedAt == null) delete nextKeyMeta[key];
      else nextKeyMeta[key] = remoteUpdatedAt;
      continue;
    }

    if (localRaw != null && isRecoveryManagedKey(key)) {
      recoveryRawItems[key] = localRaw;
    }

    if (remoteRaw == null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, remoteRaw);
    }

    if (remoteUpdatedAt == null) delete nextKeyMeta[key];
    else nextKeyMeta[key] = remoteUpdatedAt;

    changedKeys.push(key);
  }

  writeCloudKeyMeta(nextKeyMeta);

  if (Object.keys(recoveryRawItems).length > 0) {
    captureLocalRecoverySnapshot(recoveryRawItems, "remote-overwrite", {
      remoteUpdatedAt: snapshot.updatedAt,
    });
  }

  writeCloudMeta({
    remoteRevision: snapshot.revision,
    lastSyncedAt: snapshot.updatedAt,
  });

  updateSyncState({
    status: pending.size > 0 && preservePending ? syncState.status : "synced",
    lastSyncedAt: snapshot.updatedAt,
    remoteRevision: snapshot.revision,
    lastError: null,
  });

  if (changedKeys.length > 0) {
    emitAppDataChange(changedKeys);
  }
}

async function syncFromCloud(options?: { force?: boolean }): Promise<CloudSnapshot | void> {
  if (!isBrowser() || isPulling) return;

  if (!options?.force && shouldPausePolling()) return;

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    updateSyncState({ status: "offline", lastError: null });
    return;
  }

  isPulling = true;

  try {
    if (!isFlushing) {
      updateSyncState({ status: "syncing", lastError: null });
    }

    const snapshot = await fetchCloudSnapshot();
    const meta = readCloudMeta();

    if (!options?.force && snapshot.revision === meta.remoteRevision) {
      updateSyncState({
        status: readPendingKeys().length > 0 ? "syncing" : "synced",
        lastError: null,
        lastSyncedAt: snapshot.updatedAt,
        remoteRevision: snapshot.revision,
      });
      return snapshot;
    }

    applyCloudSnapshot(snapshot, { preservePending: true });
    return snapshot;
  } catch (error) {
    updateSyncState({
      status:
        typeof navigator !== "undefined" && navigator.onLine === false
          ? "offline"
          : "error",
      lastError: toErrorMessage(error),
    });
    return;
  } finally {
    isPulling = false;
  }
}

async function bootstrapCloudState(): Promise<void> {
  const remote = await fetchCloudSnapshot();
  const local = readLocalSnapshot();
  const meta = readCloudMeta();
  const firstSyncForBrowser = meta.remoteRevision === 0 && !meta.lastSyncedAt;
  const hasRemote = hasSnapshotData(remote.items);
  const hasLocal = hasSnapshotData(local);

  if (!hasRemote && hasLocal) {
    updateSyncState({ status: "syncing", lastError: null });
    await mergeCloudItems(local, "merge");
    const bootstrapped = await fetchCloudSnapshot();
    applyCloudSnapshot(bootstrapped, { preservePending: false });
    return;
  }

  applyCloudSnapshot(remote, { preservePending: true });

  if (hasRemote && hasLocal && firstSyncForBrowser) {
    const localOnlyEntries = Object.fromEntries(
      (Object.entries(local) as Array<[StorageKey, unknown]>).filter(
        ([key]) => !Object.prototype.hasOwnProperty.call(remote.items, key),
      ),
    ) as Partial<Record<StorageKey, unknown>>;

    if (hasSnapshotData(localOnlyEntries)) {
      updateSyncState({ status: "syncing", lastError: null });
      await mergeCloudItems(localOnlyEntries, "merge");
      const merged = await fetchCloudSnapshot();
      applyCloudSnapshot(merged, { preservePending: false });
      return;
    }
  }

  if (readPendingKeys().length > 0) {
    await flushPendingKeys();
    const fresh = await fetchCloudSnapshot();
    applyCloudSnapshot(fresh, { preservePending: false });
  }
}

function attachCloudListeners(): void {
  if (!isBrowser() || listenersAttached) return;
  listenersAttached = true;

  window.addEventListener("online", () => {
    updateSyncState({ status: "syncing", lastError: null });
    void flushPendingKeys();
    void syncFromCloud({ force: true });
  });

  window.addEventListener("offline", () => {
    updateSyncState({ status: "offline", lastError: null });
  });

  window.addEventListener("focus", () => {
    void syncFromCloud();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void syncFromCloud({ force: true });
    }
  });
}

function queueKeyForCloudSync(key: StorageKey): void {
  const pending = readPendingKeys();
  if (!pending.includes(key)) {
    writePendingKeys([...pending, key]);
  }

  updateSyncState({ status: "syncing", lastError: null });
  scheduleFlush();
}

export async function initializeCloudSync(): Promise<void> {
  if (!isBrowser()) return;

  attachCloudListeners();

  if (!initPromise) {
    updateSyncState({ status: "booting", pendingKeys: readPendingKeys() });

    initPromise = bootstrapCloudState()
      .catch((error) => {
        updateSyncState({
          status:
            typeof navigator !== "undefined" && navigator.onLine === false
              ? "offline"
              : "error",
          lastError: toErrorMessage(error),
        });
      })
      .finally(() => {
        if (pollTimer == null) {
          pollTimer = window.setInterval(() => {
            if (shouldPausePolling()) return;
            void syncFromCloud();
          }, CLOUD_POLL_INTERVAL_MS);
        }
      });
  }

  return initPromise;
}

export async function flushPendingKeys(): Promise<void> {
  if (!isBrowser() || isFlushing) return;

  const pending = readPendingKeys();

  if (pending.length === 0) {
    updateSyncState({ status: "synced", lastError: null });
    return;
  }

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    updateSyncState({ status: "offline", lastError: null });
    return;
  }

  if (flushTimer != null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }

  isFlushing = true;
  updateSyncState({ status: "syncing", lastError: null });
  let conflictMessage: string | null = null;

  try {
    for (const key of [...pending]) {
      const raw = window.localStorage.getItem(key);
      try {
        const ack = raw == null
          ? await deleteCloudKey(key)
          : await putCloudKey(key, JSON.parse(raw) as unknown);

        writeCloudMeta({
          remoteRevision: ack.revision,
          lastSyncedAt: ack.updatedAt,
        });

        const nextKeyMeta = readCloudKeyMeta();
        if (ack.keyUpdatedAt == null) {
          delete nextKeyMeta[key];
        } else {
          nextKeyMeta[key] = ack.keyUpdatedAt;
        }
        writeCloudKeyMeta(nextKeyMeta);

        const nextPending = readPendingKeys().filter((item) => item !== key);
        writePendingKeys(nextPending);

        updateSyncState({
          status: nextPending.length > 0 ? "syncing" : "synced",
          lastSyncedAt: ack.updatedAt,
          remoteRevision: ack.revision,
          lastError: conflictMessage,
        });
      } catch (error) {
        if (error instanceof CloudConflictError) {
          conflictMessage = `Конфликт синка для ${key.replace(/^alphacore_/, "")}: локальная копия сохранена в recovery snapshots, облако обновлено поверх неё.`;

          if (raw != null) {
            captureLocalRecoverySnapshot({ [key]: raw }, "sync-conflict", {
              summary: conflictMessage,
              remoteUpdatedAt: error.currentUpdatedAt,
            });
          }

          const nextPending = readPendingKeys().filter((item) => item !== key);
          writePendingKeys(nextPending);

          const snapshot = await fetchCloudSnapshot();
          applyCloudSnapshot(snapshot, { preservePending: true });

          updateSyncState({
            status: nextPending.length > 0 ? "syncing" : "error",
            lastSyncedAt: snapshot.updatedAt,
            remoteRevision: snapshot.revision,
            lastError: conflictMessage,
          });
          continue;
        }

        throw error;
      }
    }
  } catch (error) {
    updateSyncState({
      status:
        typeof navigator !== "undefined" && navigator.onLine === false
          ? "offline"
          : "error",
      lastError: toErrorMessage(error),
    });
  } finally {
    isFlushing = false;
  }
}

export function emitAppDataChange(keys: string | string[]): void {
  if (!isBrowser()) return;

  const detail: AppDataDetail = {
    keys: Array.isArray(keys) ? keys : [keys],
  };

  window.dispatchEvent(new CustomEvent<AppDataDetail>(APP_DATA_EVENT, { detail }));
}

export function subscribeAppDataChange(handler: (keys: string[]) => void): () => void {
  if (!isBrowser()) return () => {};

  const customHandler = (event: Event) => {
    const detail = (event as CustomEvent<AppDataDetail>).detail;
    handler(detail?.keys ?? []);
  };

  const storageHandler = (event: StorageEvent) => {
    if (event.key) handler([event.key]);
  };

  window.addEventListener(APP_DATA_EVENT, customHandler as EventListener);
  window.addEventListener("storage", storageHandler);

  return () => {
    window.removeEventListener(APP_DATA_EVENT, customHandler as EventListener);
    window.removeEventListener("storage", storageHandler);
  };
}

export function getSyncStateSnapshot(): AppSyncState {
  return syncStateFromStorage();
}

export function subscribeSyncState(handler: (state: AppSyncState) => void): () => void {
  if (!isBrowser()) return () => {};

  const customHandler = (event: Event) => {
    const detail = (event as CustomEvent<SyncDetail>).detail;
    handler(detail?.state ?? getSyncStateSnapshot());
  };

  const storageHandler = (event: StorageEvent) => {
    if (event.key === CLOUD_META_KEY || event.key === CLOUD_PENDING_KEY) {
      handler(getSyncStateSnapshot());
    }
  };

  window.addEventListener(APP_SYNC_EVENT, customHandler as EventListener);
  window.addEventListener("storage", storageHandler);

  return () => {
    window.removeEventListener(APP_SYNC_EVENT, customHandler as EventListener);
    window.removeEventListener("storage", storageHandler);
  };
}

export function getLocalRecoverySnapshots(): LocalRecoverySnapshot[] {
  return readLocalRecoverySnapshots();
}

export function subscribeLocalRecoverySnapshots(
  handler: (snapshots: LocalRecoverySnapshot[]) => void,
): () => void {
  if (!isBrowser()) return () => {};

  const emit = () => {
    handler(getLocalRecoverySnapshots());
  };

  const customHandler = () => {
    emit();
  };

  const storageHandler = (event: StorageEvent) => {
    if (event.key === LOCAL_RECOVERY_SNAPSHOTS_KEY) {
      emit();
    }
  };

  window.addEventListener(APP_RECOVERY_EVENT, customHandler as EventListener);
  window.addEventListener("storage", storageHandler);

  emit();

  return () => {
    window.removeEventListener(APP_RECOVERY_EVENT, customHandler as EventListener);
    window.removeEventListener("storage", storageHandler);
  };
}

export function restoreLocalRecoverySnapshot(
  snapshotId: string,
): { restoredKeys: StorageKey[]; snapshot: LocalRecoverySnapshot | null } {
  if (!isBrowser()) {
    return { restoredKeys: [], snapshot: null };
  }

  const snapshots = readLocalRecoverySnapshots();
  const snapshot = snapshots.find((entry) => entry.id === snapshotId) ?? null;
  if (!snapshot) {
    return { restoredKeys: [], snapshot: null };
  }

  const restoredKeys: StorageKey[] = [];

  for (const key of snapshot.keys) {
    captureUndoBeforeChange(key);

    if (!Object.prototype.hasOwnProperty.call(snapshot.items, key) || snapshot.items[key] == null) {
      window.localStorage.removeItem(key);
    } else {
      writeCacheValue(key, snapshot.items[key]);
    }

    restoredKeys.push(key);
    void initializeCloudSync();
    queueKeyForCloudSync(key);
  }

  if (restoredKeys.length > 0) {
    emitAppDataChange(restoredKeys);
  }

  return { restoredKeys, snapshot };
}

export function getUndoStateSnapshot(keys: string[]): UndoStateSnapshot {
  if (!isBrowser()) {
    return {
      canUndo: false,
      pendingCount: 0,
      lastActionAt: null,
    };
  }

  flushPendingUndoBatch();

  const history = readUndoHistory();
  const matchingEntries = history.filter((entry) => entry.keys.some((key) => keys.includes(key)));
  const latest = matchingEntries[0] ?? null;

  return {
    canUndo: Boolean(latest),
    pendingCount: matchingEntries.length,
    lastActionAt: latest?.createdAt ?? null,
  };
}

export function subscribeUndoHistory(
  keys: string[],
  handler: (state: UndoStateSnapshot) => void,
): () => void {
  if (!isBrowser()) return () => {};

  const emit = () => {
    handler(getUndoStateSnapshot(keys));
  };

  const customHandler = (event: Event) => {
    void event;
    emit();
  };

  const storageHandler = (event: StorageEvent) => {
    if (event.key === UNDO_HISTORY_KEY) {
      emit();
    }
  };

  window.addEventListener(APP_UNDO_EVENT, customHandler as EventListener);
  window.addEventListener("storage", storageHandler);

  emit();

  return () => {
    window.removeEventListener(APP_UNDO_EVENT, customHandler as EventListener);
    window.removeEventListener("storage", storageHandler);
  };
}

export function undoLastAction(keys: string[]): boolean {
  if (!isBrowser()) return false;

  flushPendingUndoBatch();

  const history = readUndoHistory();
  const index = findUndoEntryIndex(history, keys);
  if (index === -1) return false;

  const [entry] = history.splice(index, 1);
  if (!entry) return false;

  const restoredKeys: string[] = [];
  isApplyingUndo = true;

  try {
    for (const key of entry.keys) {
      const nextRaw = Object.prototype.hasOwnProperty.call(entry.before, key)
        ? entry.before[key] ?? null
        : null;
      const currentRaw = window.localStorage.getItem(key);

      if (currentRaw === nextRaw) continue;

      if (nextRaw == null) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, nextRaw);
      }

      restoredKeys.push(key);

      if (isStorageKey(key)) {
        void initializeCloudSync();
        queueKeyForCloudSync(key);
      }
    }
  } finally {
    isApplyingUndo = false;
  }

  writeUndoHistory(history);

  if (restoredKeys.length > 0) {
    emitAppDataChange(restoredKeys);
  }

  return true;
}

export function getCachedAppData(): Partial<Record<StorageKey, unknown>> {
  return readLocalSnapshot();
}

export function getCachedAppDataSizeKb(): string {
  if (!isBrowser()) return "0.0";

  let total = 0;

  for (const key of STORAGE_KEYS) {
    const value = window.localStorage.getItem(key);
    if (value) total += value.length;
  }

  return (total / 1024).toFixed(1);
}

export function exportAppDataJson(): string {
  return JSON.stringify(getCachedAppData(), null, 2);
}

export function importAppData(items: Partial<Record<StorageKey, unknown>>): number {
  if (!isBrowser()) return 0;

  const changedKeys: StorageKey[] = [];

  for (const key of STORAGE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(items, key)) continue;

    writeCacheValue(key, items[key]);
    changedKeys.push(key);
    queueKeyForCloudSync(key);
  }

  if (changedKeys.length > 0) {
    emitAppDataChange(changedKeys);
  }

  return changedKeys.length;
}

export function lsGet<T>(key: string, fallback: T): T {
  if (!isBrowser()) return fallback;

  void initializeCloudSync();

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function lsSet<T>(key: string, value: T): void {
  if (!isBrowser()) return;

  captureUndoBeforeChange(key);
  writeCacheValue(key, value);
  emitAppDataChange(key);

  if (isStorageKey(key)) {
    void initializeCloudSync();
    queueKeyForCloudSync(key);
  }
}

export function lsRemove(key: string): void {
  if (!isBrowser()) return;

  captureUndoBeforeChange(key);
  window.localStorage.removeItem(key);
  emitAppDataChange(key);

  if (isStorageKey(key)) {
    void initializeCloudSync();
    queueKeyForCloudSync(key);
  }
}

/* ── Date helpers ── */

export function dateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function toLocaleDateRu(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
