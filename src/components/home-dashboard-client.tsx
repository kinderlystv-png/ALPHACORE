"use client";

import dynamic from "next/dynamic";

function HomeDashboardLoading() {
  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-zinc-800/70 bg-zinc-900/30 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-zinc-100">ALPHACORE</p>
            <p className="mt-1 text-xs text-zinc-500">
              Поднимаю локальные данные и собираю dashboard без SSR-рассинхрона.
            </p>
          </div>
          <span className="rounded-full border border-zinc-800 bg-zinc-950/70 px-3 py-1 text-[10px] uppercase tracking-widest text-zinc-500">
            loading
          </span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-12">
        <div className="md:col-span-2 xl:col-span-8 rounded-3xl border border-zinc-800/60 bg-zinc-900/30 p-4">
          <div className="h-5 w-40 animate-pulse rounded-full bg-zinc-800" />
          <div className="mt-3 h-28 animate-pulse rounded-2xl bg-zinc-950/60" />
        </div>
        <div className="md:col-span-2 xl:col-span-4 rounded-3xl border border-zinc-800/60 bg-zinc-900/30 p-4">
          <div className="h-5 w-32 animate-pulse rounded-full bg-zinc-800" />
          <div className="mt-3 space-y-2">
            <div className="h-12 animate-pulse rounded-2xl bg-zinc-950/60" />
            <div className="h-12 animate-pulse rounded-2xl bg-zinc-950/60" />
            <div className="h-12 animate-pulse rounded-2xl bg-zinc-950/60" />
          </div>
        </div>
      </div>
    </div>
  );
}

const AlphacoreDashboard = dynamic(
  () => import("@/components/alphacore-dashboard").then((module) => module.AlphacoreDashboard),
  {
    ssr: false,
    loading: () => <HomeDashboardLoading />,
  },
);

export function HomeDashboardClient() {
  return <AlphacoreDashboard />;
}