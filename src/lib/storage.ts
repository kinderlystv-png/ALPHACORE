import { STORAGE_KEYS, isStorageKey, type StorageKey } from "./app-data-keys";

/* ── Shared local cache + cloud sync helpers for ALPHACORE ── */

export { STORAGE_KEYS } from "./app-data-keys";

export const APP_DATA_EVENT = "alphacore:data-change";
export const APP_SYNC_EVENT = "alphacore:sync-state";

const CLOUD_META_KEY = "alphacore_cloud_meta";
const CLOUD_PENDING_KEY = "alphacore_cloud_pending_keys";
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

type CloudSnapshot = {
  workspaceId: string;
  revision: number;
  updatedAt: string | null;
  items: Partial<Record<StorageKey, unknown>>;
};

type CloudMutationAck = {
  key?: StorageKey;
  revision: number;
  updatedAt: string | null;
};

type SyncDetail = {
  state: AppSyncState;
};

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
  const response = await fetch(CLOUD_API_PATH, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ key, value }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { message?: string }
      | null;
    throw new Error(payload?.message ?? `Cloud write failed for ${key}: ${response.status}`);
  }

  return (await response.json()) as CloudMutationAck;
}

async function deleteCloudKey(key: StorageKey): Promise<CloudMutationAck> {
  const response = await fetch(CLOUD_API_PATH, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ key }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { message?: string }
      | null;
    throw new Error(payload?.message ?? `Cloud delete failed for ${key}: ${response.status}`);
  }

  return (await response.json()) as CloudMutationAck;
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

  for (const key of STORAGE_KEYS) {
    if (preservePending && pending.has(key)) continue;

    const hasRemoteValue = Object.prototype.hasOwnProperty.call(snapshot.items, key);
    const remoteRaw = hasRemoteValue ? JSON.stringify(snapshot.items[key]) : null;
    const localRaw = window.localStorage.getItem(key);

    if (remoteRaw === localRaw) continue;

    if (remoteRaw == null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, remoteRaw);
    }

    changedKeys.push(key);
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

  try {
    for (const key of [...pending]) {
      const raw = window.localStorage.getItem(key);
      const ack = raw == null
        ? await deleteCloudKey(key)
        : await putCloudKey(key, JSON.parse(raw) as unknown);

      writeCloudMeta({
        remoteRevision: ack.revision,
        lastSyncedAt: ack.updatedAt,
      });

      const nextPending = readPendingKeys().filter((item) => item !== key);
      writePendingKeys(nextPending);

      updateSyncState({
        status: nextPending.length > 0 ? "syncing" : "synced",
        lastSyncedAt: ack.updatedAt,
        remoteRevision: ack.revision,
        lastError: null,
      });
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

  writeCacheValue(key, value);
  emitAppDataChange(key);

  if (isStorageKey(key)) {
    void initializeCloudSync();
    queueKeyForCloudSync(key);
  }
}

export function lsRemove(key: string): void {
  if (!isBrowser()) return;

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
