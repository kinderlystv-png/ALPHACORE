"use client";

import { useEffect, useMemo, useState } from "react";

import {
  getUndoStateSnapshot,
  subscribeUndoHistory,
  undoLastAction,
  type UndoStateSnapshot,
} from "@/lib/storage";

type UndoScope = {
  label: string;
  keys: string[];
};

const GLOBAL_KEYS = ["alphacore_sickness"];

const TAB_UNDO_SCOPES: Record<string, UndoScope> = {
  "/": {
    label: "Дом",
    keys: [
      "alphacore_tasks",
      "alphacore_notes",
      "alphacore_habits",
      "alphacore_medical",
      "alphacore_projects",
      "alphacore_journal",
      "alphacore_schedule_custom",
      "alphacore_schedule_overrides",
      "alphacore_schedule_approvals",
      ...GLOBAL_KEYS,
    ],
  },
  "/tasks": {
    label: "Задачи",
    keys: [
      "alphacore_tasks",
      "alphacore_schedule_custom",
      "alphacore_schedule_approvals",
      ...GLOBAL_KEYS,
    ],
  },
  "/calendar": {
    label: "Неделя",
    keys: [
      "alphacore_tasks",
      "alphacore_schedule_custom",
      "alphacore_schedule_overrides",
      "alphacore_schedule_approvals",
      ...GLOBAL_KEYS,
    ],
  },
  "/projects": {
    label: "Группы",
    keys: ["alphacore_projects", ...GLOBAL_KEYS],
  },
  "/journal": {
    label: "Дневник",
    keys: ["alphacore_journal", ...GLOBAL_KEYS],
  },
  "/notes": {
    label: "Заметки",
    keys: ["alphacore_notes", ...GLOBAL_KEYS],
  },
  "/routines": {
    label: "Ритм",
    keys: ["alphacore_habits", ...GLOBAL_KEYS],
  },
  "/medical": {
    label: "Анализы",
    keys: ["alphacore_medical", ...GLOBAL_KEYS],
  },
};

const EMPTY_UNDO_STATE: UndoStateSnapshot = {
  canUndo: false,
  pendingCount: 0,
  lastActionAt: null,
};

function resolveUndoScope(pathname: string): UndoScope | null {
  if (TAB_UNDO_SCOPES[pathname]) return TAB_UNDO_SCOPES[pathname];

  const matchedPrefix = Object.keys(TAB_UNDO_SCOPES)
    .filter((candidate) => candidate !== "/" && pathname.startsWith(`${candidate}/`))
    .sort((left, right) => right.length - left.length)[0];

  return matchedPrefix ? TAB_UNDO_SCOPES[matchedPrefix] : null;
}

export function TabUndoControl({ pathname }: { pathname: string }) {
  const scope = useMemo(() => resolveUndoScope(pathname), [pathname]);
  const [undoState, setUndoState] = useState<UndoStateSnapshot>(EMPTY_UNDO_STATE);

  useEffect(() => {
    if (!scope) {
      setUndoState(EMPTY_UNDO_STATE);
      return;
    }

    setUndoState(getUndoStateSnapshot(scope.keys));

    return subscribeUndoHistory(scope.keys, setUndoState);
  }, [scope]);

  if (!scope) return null;

  const lastActionLabel = undoState.lastActionAt
    ? new Intl.DateTimeFormat("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(undoState.lastActionAt))
    : null;

  return (
    <div className="flex justify-end pb-3 pt-2">
      <button
        type="button"
        disabled={!undoState.canUndo}
        onClick={() => {
          if (!undoState.canUndo) return;
          undoLastAction(scope.keys);
        }}
        className="inline-flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 px-3.5 py-2 text-xs font-medium text-zinc-300 transition hover:border-zinc-700 hover:text-zinc-50 disabled:cursor-not-allowed disabled:opacity-45"
        title={
          undoState.canUndo
            ? `Отменить последнее действие на вкладке «${scope.label}»`
            : `На вкладке «${scope.label}» пока нечего отменять`
        }
      >
        <span aria-hidden="true">↶</span>
        <span>Отменить последнее</span>
        {undoState.canUndo && (
          <span className="rounded-full border border-zinc-700 bg-zinc-950/70 px-2 py-0.5 text-[10px] text-zinc-500">
            {undoState.pendingCount}
            {lastActionLabel ? ` · ${lastActionLabel}` : ""}
          </span>
        )}
      </button>
    </div>
  );
}