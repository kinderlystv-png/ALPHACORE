"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { SicknessHistoryPanel } from "@/components/sickness-status-cards";
import { STORAGE_KEYS } from "@/lib/app-data-keys";
import {
  exportAppDataJson,
  getCachedAppDataSizeKb,
  getSyncStateSnapshot,
  importAppData,
  lsRemove,
  lsSet,
  subscribeAppDataChange,
  subscribeSyncState,
  type AppSyncState,
} from "@/lib/storage";

function importData(json: string): { ok: boolean; msg: string } {
  try {
    const data = JSON.parse(json);
    if (typeof data !== "object" || data === null) {
      return { ok: false, msg: "Файл должен содержать JSON-объект" };
    }

    const count = importAppData(data);
    return { ok: true, msg: `Импортировано: ${count} хранилищ` };
  } catch {
    return { ok: false, msg: "Невалидный JSON" };
  }
}

function clearAllData(): void {
  for (const key of STORAGE_KEYS) {
    if (key === "alphacore_projects" || key === "alphacore_journal") {
      lsSet(key, []);
    } else {
      lsRemove(key);
    }
  }
}

export default function SettingsPage() {
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [storageSize, setStorageSize] = useState(() => getCachedAppDataSizeKb());
  const [syncState, setSyncState] = useState<AppSyncState>(() => getSyncStateSnapshot());
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribeData = subscribeAppDataChange(() => {
      setStorageSize(getCachedAppDataSizeKb());
    });

    const unsubscribeSync = subscribeSyncState((state) => {
      setSyncState(state);
    });

    return () => {
      unsubscribeData();
      unsubscribeSync();
    };
  }, []);

  const handleExport = useCallback(() => {
    const blob = new Blob([exportAppDataJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `alphacore-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg({ text: "Бэкап скачан", ok: true });
  }, []);

  const handleImport = useCallback(() => {
    fileRef.current?.click();
  }, []);

  const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = importData(reader.result as string);
      setMsg({ text: result.msg, ok: result.ok });
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  const handleClear = useCallback(() => {
    if (!confirm("Удалить все данные в облаке и локальном кэше (задачи, заметки, привычки, анализы, группы)?")) return;
    clearAllData();
    setMsg({ text: "Все данные удалены", ok: true });
  }, []);

  const syncStatusLabel: Record<AppSyncState["status"], string> = {
    idle: "ожидание",
    booting: "подключение к облаку…",
    syncing: "синхронизация…",
    synced: "синхронизировано",
    offline: "офлайн — ждём сеть",
    error: "ошибка синка",
  };

  return (
    <AppShell>
      <div className="space-y-6 py-2">
        <h1 className="text-2xl font-bold">⚙️ Настройки</h1>

        {/* Status message */}
        {msg && (
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              msg.ok
                ? "border-emerald-500/25 bg-emerald-950/15 text-emerald-300"
                : "border-rose-500/25 bg-rose-950/15 text-rose-300"
            }`}
          >
            {msg.text}
          </div>
        )}

        {/* Data section */}
        <section className="rounded-xl border border-zinc-800/50 bg-zinc-900/20 p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">
              💾 Данные
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Данные хранятся в Yandex Cloud PostgreSQL, а браузер держит локальный кэш · {storageSize} KB cache
            </p>
          </div>

          <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/30 p-3 text-xs text-zinc-400">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Состояние синка: <span className="text-zinc-200">{syncStatusLabel[syncState.status]}</span>
              </span>
              <span>
                pending keys: <span className="text-zinc-200">{syncState.pendingKeys.length}</span>
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <span>
                Последний sync: <span className="text-zinc-200">{syncState.lastSyncedAt ? new Date(syncState.lastSyncedAt).toLocaleString("ru-RU") : "ещё не было"}</span>
              </span>
              <span>
                Revision: <span className="text-zinc-200">{syncState.remoteRevision}</span>
              </span>
            </div>
            {syncState.lastError && (
              <p className="mt-2 text-rose-300">{syncState.lastError}</p>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleExport}
              className="rounded-xl bg-zinc-50 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200"
            >
              📤 Экспорт JSON
            </button>
            <button
              type="button"
              onClick={handleImport}
              className="rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
            >
              📥 Импорт JSON
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              onChange={onFile}
              className="hidden"
            />
          </div>
        </section>

        <SicknessHistoryPanel
          title="🤒 Болезнь и recovery log"
          subtitle="Эти периоды входят в backup/export наравне с задачами, анализами и календарём."
          maxItems={8}
        />

        {/* Danger zone */}
        <section className="rounded-xl border border-rose-500/20 bg-rose-950/10 p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-rose-300">⚠️ Опасная зона</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Действия необратимы. Рекомендуем сначала сделать экспорт.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClear}
            className="rounded-xl border border-rose-500/30 px-4 py-2.5 text-sm font-medium text-rose-300 transition hover:bg-rose-500/10"
          >
            🗑 Удалить все данные
          </button>
        </section>

        {/* App info */}
        <section className="rounded-xl border border-zinc-800/50 bg-zinc-900/20 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-zinc-100">ℹ️ О приложении</h2>
          <div className="grid gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500">Версия</span>
              <span className="text-zinc-300">1.0.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Хранилище</span>
              <span className="text-zinc-300">Cloud PostgreSQL + local cache</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Хранилищ</span>
              <span className="text-zinc-300">{STORAGE_KEYS.length}</span>
            </div>
          </div>
        </section>

        {/* Keyboard shortcuts */}
        <section className="rounded-xl border border-zinc-800/50 bg-zinc-900/20 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-zinc-100">⌨️ Горячие клавиши</h2>
          <div className="grid gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-400">Глобальный поиск</span>
              <kbd className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                ⌘K
              </kbd>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
