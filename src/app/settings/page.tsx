"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { SicknessHistoryPanel } from "@/components/sickness-status-cards";
import { STORAGE_KEYS } from "@/lib/app-data-keys";
import {
  exportAppDataJson,
  getCachedAppDataSizeKb,
  getLocalRecoverySnapshots,
  getSyncStateSnapshot,
  importAppData,
  lsRemove,
  lsSet,
  restoreLocalRecoverySnapshot,
  subscribeAppDataChange,
  subscribeLocalRecoverySnapshots,
  subscribeSyncState,
  type AppSyncState,
  type LocalRecoverySnapshot,
} from "@/lib/storage";

const RECOVERY_KEY_LABELS: Record<string, string> = {
  alphacore_tasks: "задачи",
  alphacore_projects: "группы",
  alphacore_journal: "дневник",
  alphacore_notes: "заметки",
  alphacore_habits: "привычки",
  alphacore_medical: "анализы",
  alphacore_sickness: "болезнь",
  alphacore_schedule_custom: "календарь",
  alphacore_schedule_overrides: "оверрайды недели",
};

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

function describeRecoverySnapshot(snapshot: LocalRecoverySnapshot): string {
  const labels = snapshot.keys.map((key) => RECOVERY_KEY_LABELS[key] ?? key.replace(/^alphacore_/, ""));
  const taskCount = Array.isArray(snapshot.items.alphacore_tasks)
    ? snapshot.items.alphacore_tasks.length
    : null;
  const projectCount = Array.isArray(snapshot.items.alphacore_projects)
    ? snapshot.items.alphacore_projects.length
    : null;

  const stats = [
    taskCount != null ? `${taskCount} задач` : null,
    projectCount != null ? `${projectCount} групп` : null,
  ].filter(Boolean);

  return [labels.join(" · "), ...stats].filter(Boolean).join(" · ");
}

export default function SettingsPage() {
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [storageSize, setStorageSize] = useState(() => getCachedAppDataSizeKb());
  const [syncState, setSyncState] = useState<AppSyncState>(() => getSyncStateSnapshot());
  const [recoverySnapshots, setRecoverySnapshots] = useState<LocalRecoverySnapshot[]>(() => getLocalRecoverySnapshots());
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribeData = subscribeAppDataChange(() => {
      setStorageSize(getCachedAppDataSizeKb());
    });

    const unsubscribeSync = subscribeSyncState((state) => {
      setSyncState(state);
    });

    const unsubscribeRecovery = subscribeLocalRecoverySnapshots((snapshots) => {
      setRecoverySnapshots(snapshots);
    });

    return () => {
      unsubscribeData();
      unsubscribeSync();
      unsubscribeRecovery();
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

  const handleRestoreRecoverySnapshot = useCallback((snapshot: LocalRecoverySnapshot) => {
    const ok = confirm(
      `Восстановить snapshot «${snapshot.summary}» и отправить его в облако? Это перезапишет текущие значения для: ${describeRecoverySnapshot(snapshot)}.`,
    );
    if (!ok) return;

    const result = restoreLocalRecoverySnapshot(snapshot.id);
    if (result.restoredKeys.length === 0) {
      setMsg({ text: "Snapshot не найден или уже недоступен", ok: false });
      return;
    }

    setMsg({
      text: `Восстановлено ${result.restoredKeys.length} хранилищ из recovery snapshot. Синк уже отправляет их в облако.`,
      ok: true,
    });
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

          <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-4 text-sm text-zinc-300">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-amber-200">🛟 Recovery snapshots</h3>
                <p className="mt-1 text-xs text-zinc-400">
                  Если облако или stale-сессия перезапишет локальные задачи, предыдущая локальная копия важных данных сохраняется здесь автоматически.
                  Это как подушка безопасности, только без удара в лицо.
                </p>
              </div>
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-200">
                {recoverySnapshots.length}
              </span>
            </div>

            {recoverySnapshots.length === 0 ? (
              <p className="mt-3 text-xs text-zinc-500">
                Пока пусто. После этого фикса старый браузер / устройство с локальными задачами не должно терять их бесследно: копия появится здесь до remote replace или sync conflict.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {recoverySnapshots.slice(0, 8).map((snapshot) => (
                  <div
                    key={snapshot.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800/70 bg-zinc-950/40 px-3 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-100">{snapshot.summary}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {new Date(snapshot.createdAt).toLocaleString("ru-RU")}
                        {snapshot.remoteUpdatedAt ? ` · cloud ${new Date(snapshot.remoteUpdatedAt).toLocaleString("ru-RU")}` : ""}
                      </p>
                      <p className="mt-1 text-xs text-zinc-400">{describeRecoverySnapshot(snapshot)}</p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRestoreRecoverySnapshot(snapshot)}
                      className="rounded-xl border border-amber-500/30 px-3 py-2 text-xs font-medium text-amber-200 transition hover:bg-amber-500/10"
                    >
                      Восстановить
                    </button>
                  </div>
                ))}
              </div>
            )}
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
