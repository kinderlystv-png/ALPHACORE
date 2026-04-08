"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { getSyncStateSnapshot, subscribeSyncState, type AppSyncState } from "@/lib/storage";

const UI_BLOCK_DELAY_MS = 50;
const UI_BLOCK_MIN_VISIBLE_MS = 180;
const UI_FEEDBACK_VISIBLE_MS = 1800;

type SyncBlockingOverlayProps = {
  appRootId: string;
};

type OverlayMode = "blocking" | "offline" | "error" | null;

function describePendingChanges(syncState: AppSyncState): string {
  const blockingCount = syncState.uiBlockingKeys.length;

  if (blockingCount <= 1) {
    return "Фиксируем действие в облаке — экран вернётся сразу после подтверждения синка.";
  }

  return `Фиксируем ${blockingCount} изменений в облаке — дождись подтверждения синка.`;
}

function describeFeedback(syncState: AppSyncState, mode: Exclude<OverlayMode, "blocking" | null>): string {
  if (mode === "offline") {
    return "Сеть пропала, но изменения остались в очереди и отправятся автоматически, когда соединение вернётся.";
  }

  return syncState.lastError
    ? `Не удалось сразу подтвердить синк: ${syncState.lastError}. Попробуем ещё раз автоматически.`
    : "Не удалось сразу подтвердить синк. Попробуем ещё раз автоматически.";
}

export function SyncBlockingOverlay({ appRootId }: SyncBlockingOverlayProps) {
  const [syncState, setSyncState] = useState<AppSyncState>(() => getSyncStateSnapshot());
  const [mode, setMode] = useState<OverlayMode>(null);
  const showTimerRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const visibleSinceRef = useRef<number | null>(null);
  const shouldBlockUi = syncState.uiBlockingKeys.length > 0;
  const isBlockingVisible = mode === "blocking";

  useEffect(() => subscribeSyncState((state) => setSyncState(state)), []);

  useEffect(() => {
    return () => {
      if (showTimerRef.current != null) {
        window.clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }

      if (settleTimerRef.current != null) {
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }

      if (feedbackTimerRef.current != null) {
        window.clearTimeout(feedbackTimerRef.current);
        feedbackTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (shouldBlockUi) {
      if (settleTimerRef.current != null) {
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }

      if (feedbackTimerRef.current != null) {
        window.clearTimeout(feedbackTimerRef.current);
        feedbackTimerRef.current = null;
      }

      if (mode === "blocking" || showTimerRef.current != null) {
        return;
      }

      showTimerRef.current = window.setTimeout(() => {
        showTimerRef.current = null;
        visibleSinceRef.current = Date.now();
        setMode("blocking");
      }, UI_BLOCK_DELAY_MS);
      return;
    }

    if (showTimerRef.current != null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }

    if (mode == null) {
      return;
    }

    const visibleFor = visibleSinceRef.current == null ? 0 : Date.now() - visibleSinceRef.current;
    const settleDelay = Math.max(0, UI_BLOCK_MIN_VISIBLE_MS - visibleFor);
    const nextMode = syncState.status === "offline"
      ? "offline"
      : syncState.status === "error"
        ? "error"
        : null;

    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;

      if (nextMode == null) {
        visibleSinceRef.current = null;
        setMode(null);
        return;
      }

      visibleSinceRef.current = Date.now();
      setMode(nextMode);
      feedbackTimerRef.current = window.setTimeout(() => {
        feedbackTimerRef.current = null;
        visibleSinceRef.current = null;
        setMode(null);
      }, UI_FEEDBACK_VISIBLE_MS);
    }, settleDelay);
  }, [mode, shouldBlockUi, syncState.status]);

  useEffect(() => {
    const appRoot = document.getElementById(appRootId);
    const prevBodyOverflow = document.body.style.overflow;
    const prevBodyTouchAction = document.body.style.touchAction;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevAriaHidden = appRoot?.getAttribute("aria-hidden");

    if (!isBlockingVisible) {
      appRoot?.removeAttribute("inert");
      if (prevAriaHidden == null) {
        appRoot?.removeAttribute("aria-hidden");
      }
      return;
    }

    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    document.documentElement.style.overflow = "hidden";

    if (appRoot) {
      appRoot.setAttribute("inert", "");
      appRoot.setAttribute("aria-hidden", "true");
    }

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.body.style.touchAction = prevBodyTouchAction;
      document.documentElement.style.overflow = prevHtmlOverflow;

      appRoot?.removeAttribute("inert");

      if (prevAriaHidden == null) {
        appRoot?.removeAttribute("aria-hidden");
      } else {
        appRoot?.setAttribute("aria-hidden", prevAriaHidden);
      }
    };
  }, [appRootId, isBlockingVisible]);

  const detailText = useMemo(() => describePendingChanges(syncState), [syncState]);
  const feedbackText = useMemo(
    () => (mode === "offline" || mode === "error" ? describeFeedback(syncState, mode) : null),
    [mode, syncState],
  );

  const title = mode === "blocking"
    ? "Синхронизируем изменения…"
    : mode === "offline"
      ? "Синк ждёт сеть"
      : mode === "error"
        ? "Синк не подтвердился"
        : null;

  const iconTone = mode === "offline"
    ? "border-amber-400/25 bg-amber-400/10 text-amber-200"
    : mode === "error"
      ? "border-rose-400/25 bg-rose-400/10 text-rose-200"
      : "border-sky-400/25 bg-sky-400/10 text-sky-200";

  const panelTone = mode === "offline"
    ? "border-amber-500/30 bg-zinc-950/94"
    : mode === "error"
      ? "border-rose-500/30 bg-zinc-950/94"
      : "border-zinc-800/80 bg-zinc-950/92";

  const badgeTone = mode === "offline"
    ? "border-amber-500/25 bg-amber-500/10 text-amber-200"
    : mode === "error"
      ? "border-rose-500/25 bg-rose-500/10 text-rose-200"
      : "border-zinc-800/80 bg-zinc-900/80 text-zinc-400";

  if (mode == null) {
    return null;
  }

  return (
    <div
      className={`fixed inset-0 z-140 flex items-center justify-center px-5 ${
        isBlockingVisible
          ? "bg-zinc-950/46 backdrop-blur-md"
          : "pointer-events-none bg-zinc-950/18 backdrop-blur-[2px]"
      }`}
    >
      <div
        role={isBlockingVisible ? "dialog" : "status"}
        aria-modal={isBlockingVisible ? "true" : undefined}
        aria-labelledby="alphacore-sync-overlay-title"
        aria-describedby="alphacore-sync-overlay-description"
        aria-live={isBlockingVisible ? undefined : "polite"}
        className={`w-full max-w-sm rounded-3xl border p-5 text-center shadow-[0_24px_90px_rgba(0,0,0,0.45)] ${panelTone}`}
      >
        <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full border ${iconTone}`}>
          {mode === "blocking" ? (
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-sky-300/25 border-t-sky-300 motion-reduce:animate-none" />
          ) : mode === "offline" ? (
            <span className="text-xl">📡</span>
          ) : (
            <span className="text-xl">⚠️</span>
          )}
        </div>

        <p id="alphacore-sync-overlay-title" className="mt-4 text-base font-semibold text-zinc-50">
          {title}
        </p>

        <p id="alphacore-sync-overlay-description" className="mt-2 text-sm leading-6 text-zinc-300">
          {mode === "blocking" ? detailText : feedbackText}
        </p>

        <div className={`mt-4 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] ${badgeTone}`}>
          <span
            className={`h-2 w-2 rounded-full ${
              mode === "offline"
                ? "bg-amber-300 shadow-[0_0_14px_rgba(252,211,77,0.8)]"
                : mode === "error"
                  ? "bg-rose-300 shadow-[0_0_14px_rgba(253,164,175,0.8)]"
                  : "bg-sky-300 shadow-[0_0_14px_rgba(125,211,252,0.8)]"
            }`}
          />
          <span>
            {mode === "blocking" ? "sync lock" : mode === "offline" ? "offline queue" : "retrying"}
          </span>
        </div>
      </div>
    </div>
  );
}