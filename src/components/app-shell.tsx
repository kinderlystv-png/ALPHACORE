"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { DailyTaskCarryoverBanner } from "@/components/daily-task-carryover";
import { ErrorBoundary } from "@/components/error-boundary";
import { GlobalSearch } from "@/components/global-search";
import {
  formatSicknessStartedAt,
  getSicknessLog,
  SICKNESS_KEY,
  startSicknessPeriod,
  stopSicknessPeriod,
  type SicknessLog,
} from "@/lib/sickness";
import { subscribeAppDataChange } from "@/lib/storage";

const routes = [
  { href: "/", icon: "🏠", label: "Дом" },
  { href: "/tasks", icon: "📥", label: "Задачи" },
  { href: "/calendar", icon: "📅", label: "Неделя" },
  { href: "/projects", icon: "📁", label: "Проекты" },
  { href: "/journal", icon: "💬", label: "Дневник" },
  { href: "/notes", icon: "📝", label: "Заметки" },
  { href: "/routines", icon: "🔔", label: "Ритм" },
  { href: "/medical", icon: "🏥", label: "Анализы" },
];

function RailTooltip({
  label,
  shortcut,
  description,
}: {
  label: string;
  shortcut?: string;
  description?: string;
}) {
  const hasDescription = Boolean(description);

  return (
    <span
      className={`pointer-events-none absolute left-full top-1/2 z-90 ml-3 flex -translate-y-1/2 translate-x-1 rounded-xl border border-zinc-700/70 bg-zinc-900/96 px-3 py-2 text-xs font-medium text-zinc-100 opacity-0 shadow-[0_14px_34px_rgba(0,0,0,0.32)] backdrop-blur transition duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100 ${
        hasDescription
          ? "w-72 flex-col items-start gap-1 whitespace-normal"
          : "items-center gap-2 whitespace-nowrap"
      }`}
    >
      <span className="flex items-center gap-2">
        <span>{label}</span>
        {shortcut && (
          <span className="rounded-lg border border-zinc-700 bg-zinc-800/90 px-1.5 py-0.5 text-[10px] text-zinc-300">
            {shortcut}
          </span>
        )}
      </span>
      {description ? (
        <span className="text-[11px] font-normal leading-4 text-zinc-400">{description}</span>
      ) : null}
    </span>
  );
}

function formatTodayLabel(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "long",
  }).format(date);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sicknessLog, setSicknessLog] = useState<SicknessLog>({
    activePeriod: null,
    history: [],
    updatedAt: null,
  });
  const todayLabel = formatTodayLabel(new Date());

  useEffect(() => {
    const refresh = () => {
      setSicknessLog(getSicknessLog());
    };

    refresh();

    return subscribeAppDataChange((keys) => {
      if (keys.includes(SICKNESS_KEY)) {
        refresh();
      }
    });
  }, []);

  const sicknessActive = Boolean(sicknessLog.activePeriod);
  const sicknessTooltip = sicknessLog.activePeriod
    ? `Старт болезни: ${formatSicknessStartedAt(sicknessLog.activePeriod.startedAt)}`
    : sicknessLog.history[0]?.summary ?? "Нажми, чтобы зафиксировать начало периода болезни.";

  const handleSicknessToggle = () => {
    if (sicknessLog.activePeriod) {
      stopSicknessPeriod();
    } else {
      startSicknessPeriod();
    }

    setSicknessLog(getSicknessLog());
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50">
      <div className="mx-auto max-w-7xl lg:grid lg:grid-cols-[88px_minmax(0,1fr)] lg:overflow-visible">
        {/* ── SIDEBAR (desktop) ── */}
        <aside className="relative z-40 hidden isolate lg:block">
          <div className="sticky top-0 flex h-screen flex-col items-center gap-3 overflow-visible border-r border-zinc-800/60 px-3 py-4">
            <nav className="flex w-full flex-col items-center gap-1.5">
              {routes.map((r) => {
                const active = pathname === r.href;
                return (
                  <Link
                    key={r.href}
                    href={r.href}
                    aria-label={r.label}
                    className={`group relative z-0 flex h-11 w-11 items-center justify-center rounded-2xl text-lg transition hover:z-20 focus-within:z-20 ${
                      active
                        ? "bg-zinc-800/80 font-medium text-zinc-50"
                        : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
                    }`}
                  >
                    <span>{r.icon}</span>
                    <span className="sr-only">{r.label}</span>
                    <RailTooltip label={r.label} />
                  </Link>
                );
              })}
            </nav>

            <div className="mt-auto flex w-full flex-col items-center gap-2">
              <button
                type="button"
                onClick={handleSicknessToggle}
                aria-label={sicknessActive ? "Завершить период болезни" : "Начать период болезни"}
                aria-pressed={sicknessActive}
                className={`group relative z-0 flex h-11 w-11 items-center justify-center rounded-2xl border text-base transition hover:z-20 focus-within:z-20 ${
                  sicknessActive
                    ? "border-rose-500/60 bg-rose-500/15 text-rose-100 hover:border-rose-400 hover:text-white"
                    : "border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
                }`}
              >
                {sicknessActive ? (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-rose-400 shadow-[0_0_12px_rgba(251,113,133,0.7)]" />
                ) : null}
                <span>{sicknessActive ? "🤒" : "🩹"}</span>
                <span className="sr-only">
                  {sicknessActive ? "Остановить отметку болезни" : "Включить отметку болезни"}
                </span>
                <RailTooltip label="Болею" description={sicknessTooltip} />
              </button>
              <button
                type="button"
                onClick={() => {
                  const e = new KeyboardEvent("keydown", { key: "k", metaKey: true });
                  window.dispatchEvent(e);
                }}
                aria-label="Поиск"
                className="group relative z-0 flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-800 text-base text-zinc-500 transition hover:z-20 focus-within:z-20 hover:border-zinc-700 hover:text-zinc-300"
              >
                <span>🔍</span>
                <RailTooltip label="Поиск" shortcut="⌘K" />
              </button>
              <Link
                href="/settings"
                aria-label="Настройки"
                className="group relative z-0 flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-800 text-base text-zinc-500 transition hover:z-20 focus-within:z-20 hover:border-zinc-700 hover:text-zinc-300"
              >
                <span>⚙️</span>
                <RailTooltip label="Настройки" />
              </Link>
            </div>
          </div>
        </aside>

        {/* ── MAIN ── */}
        <main className="relative z-0 min-h-screen pb-20 lg:pb-6">
          {/* Mobile header */}
          <header className="flex items-center justify-between px-4 py-4 lg:hidden">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-50 text-sm font-bold text-zinc-950">
                A
              </div>
              <div>
                <p className="text-sm font-semibold">ALPHACORE</p>
                <p className="text-xs capitalize text-zinc-500" suppressHydrationWarning>
                  {todayLabel || " "}
                </p>
              </div>
            </Link>
          </header>

          <DailyTaskCarryoverBanner />

          <ErrorBoundary>
            <div className="px-4 sm:px-6 lg:px-5">{children}</div>
          </ErrorBoundary>
        </main>
      </div>

      <GlobalSearch />

      {/* ── MOBILE NAV ── */}
      <nav className="fixed inset-x-3 bottom-3 z-30 rounded-2xl border border-zinc-800 bg-zinc-950/95 p-1.5 shadow-2xl shadow-black/40 backdrop-blur lg:hidden">
        <div className="grid grid-cols-8 gap-0.5">
          {routes.map((r) => {
            const active = pathname === r.href;
            return (
              <Link
                key={r.href}
                href={r.href}
                className={`flex flex-col items-center gap-0.5 rounded-xl px-1 py-2 transition ${
                  active
                    ? "bg-zinc-800/80 text-zinc-50"
                    : "text-zinc-500 hover:text-zinc-200"
                }`}
              >
                <span className="text-base">{r.icon}</span>
                <span className="text-[9px] font-medium">{r.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
