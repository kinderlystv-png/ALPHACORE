"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DailyTaskCarryoverBanner } from "@/components/daily-task-carryover";
import { GlobalSearch } from "@/components/global-search";

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

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50">
      <div className="mx-auto max-w-7xl lg:grid lg:grid-cols-[88px_minmax(0,1fr)]">
        {/* ── SIDEBAR (desktop) ── */}
        <aside className="hidden lg:block">
          <div className="sticky top-0 flex h-screen flex-col items-center gap-3 border-r border-zinc-800/60 px-3 py-4">
            <nav className="flex w-full flex-col items-center gap-1.5">
              {routes.map((r) => {
                const active = pathname === r.href;
                return (
                  <Link
                    key={r.href}
                    href={r.href}
                    aria-label={r.label}
                    title={r.label}
                    className={`flex h-11 w-11 items-center justify-center rounded-2xl text-lg transition ${
                      active
                        ? "bg-zinc-800/80 font-medium text-zinc-50"
                        : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
                    }`}
                  >
                    <span>{r.icon}</span>
                    <span className="sr-only">{r.label}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="mt-auto flex w-full flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const e = new KeyboardEvent("keydown", { key: "k", metaKey: true });
                  window.dispatchEvent(e);
                }}
                aria-label="Поиск"
                title="Поиск"
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-800 text-base text-zinc-500 transition hover:border-zinc-700 hover:text-zinc-300"
              >
                <span>🔍</span>
              </button>
              <Link
                href="/settings"
                aria-label="Настройки"
                title="Настройки"
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-800 text-base text-zinc-500 transition hover:border-zinc-700 hover:text-zinc-300"
              >
                <span>⚙️</span>
              </Link>
            </div>
          </div>
        </aside>

        {/* ── MAIN ── */}
        <main className="min-h-screen pb-20 lg:pb-6">
          {/* Mobile header */}
          <header className="flex items-center justify-between px-4 py-4 lg:hidden">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-50 text-sm font-bold text-zinc-950">
                A
              </div>
              <div>
                <p className="text-sm font-semibold">ALPHACORE</p>
                <p className="text-xs capitalize text-zinc-500">
                  {new Intl.DateTimeFormat("ru-RU", {
                    weekday: "short",
                    day: "numeric",
                    month: "long",
                  }).format(new Date())}
                </p>
              </div>
            </Link>
          </header>

          <DailyTaskCarryoverBanner />

          <div className="px-4 sm:px-6 lg:px-5">{children}</div>
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
