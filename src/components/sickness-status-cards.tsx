"use client";

import Link from "next/link";

import {
  formatSicknessDateTime,
  getActiveSicknessSummary,
  getLatestClosedSicknessPeriod,
} from "@/lib/sickness";
import { useSicknessLog } from "@/lib/use-sickness-log";

function StatCell({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "rose" | "emerald" }) {
  const toneClass =
    tone === "rose"
      ? "text-rose-200"
      : tone === "emerald"
        ? "text-emerald-200"
        : "text-zinc-100";

  return (
    <div className="rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-3">
      <p className="text-[10px] uppercase tracking-widest text-zinc-600">{label}</p>
      <p className={`mt-1 text-sm font-medium ${toneClass}`}>{value}</p>
    </div>
  );
}

export function SicknessHomeBadge() {
  const log = useSicknessLog();
  const active = getActiveSicknessSummary(log);
  const latest = getLatestClosedSicknessPeriod(log);

  return (
    <section
      className={`rounded-2xl border p-4 transition ${
        active
          ? "border-rose-500/30 bg-linear-to-br from-rose-950/25 to-zinc-950"
          : "border-zinc-800/60 bg-zinc-900/30"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-50">
              {active ? "🤒 Режим болезни" : "🩹 История болезни"}
            </h3>
            <span
              className={`rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest ${
                active
                  ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
                  : "border-zinc-700 bg-zinc-900/60 text-zinc-400"
              }`}
            >
              {active ? active.durationLabel : latest ? latest.durationLabel : "пусто"}
            </span>
          </div>
          <p className="mt-2 text-sm text-zinc-300">
            {active
              ? `Идёт активный период болезни: с ${formatSicknessDateTime(active.startedAt)} · ${active.calendarDays} календ. дн. Сейчас фокус лучше держать в recovery mode и одном щадящем шаге.`
              : latest
                ? `Последний период: ${formatSicknessDateTime(latest.startedAt)} → ${formatSicknessDateTime(latest.endedAt)} · ${latest.durationLabel}.`
                : "Периоды болезни пока не фиксировались. Когда переключатель «Болею» включится, история появится здесь и в облаке."}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/medical"
            className="rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
          >
            Открыть medical
          </Link>
          <Link
            href="/settings"
            className="rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
          >
            Настройки / backup
          </Link>
        </div>
      </div>
    </section>
  );
}

export function SicknessHistoryPanel({
  title = "🤒 Периоды болезни",
  subtitle = "История хранится в облаке и переживает перезагрузки/устройства.",
  maxItems = 6,
}: {
  title?: string;
  subtitle?: string;
  maxItems?: number;
}) {
  const log = useSicknessLog();
  const active = getActiveSicknessSummary(log);
  const latest = getLatestClosedSicknessPeriod(log);
  const totalCalendarDays = log.history.reduce((sum, period) => sum + period.calendarDays, 0);
  const visibleHistory = log.history.slice(0, maxItems);

  return (
    <section className="space-y-4 rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
          <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>
        </div>

        <span
          className={`rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest ${
            active
              ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
              : "border-zinc-700 bg-zinc-900/60 text-zinc-400"
          }`}
        >
          {active ? "активно сейчас" : `${log.history.length} завершено`}
        </span>
      </div>

      {active ? (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-rose-100">🤒 Сейчас идёт период болезни</p>
            <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest text-rose-200">
              {active.durationLabel}
            </span>
          </div>
          <p className="mt-2 text-sm text-rose-100/90">
            Старт: {formatSicknessDateTime(active.startedAt)} · {active.calendarDays} календ. дн.
          </p>
          <p className="mt-1 text-xs leading-5 text-rose-100/75">
            Закрой день в режиме recovery: один щадящий шаг, без лишнего hero mode.
          </p>
        </div>
      ) : latest ? (
        <div className="rounded-2xl border border-zinc-800/70 bg-zinc-950/40 p-4">
          <p className="text-sm font-medium text-zinc-100">🩹 Последний период</p>
          <p className="mt-2 text-sm text-zinc-300">
            {formatSicknessDateTime(latest.startedAt)} → {formatSicknessDateTime(latest.endedAt)}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {latest.durationLabel} · {latest.calendarDays} календ. дн.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-zinc-800 px-4 py-5 text-sm text-zinc-500">
          История периодов болезни пока пуста.
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        <StatCell label="Периодов" value={String(log.history.length)} />
        <StatCell label="Календ. дней" value={String(totalCalendarDays)} tone={totalCalendarDays > 0 ? "emerald" : "default"} />
        <StatCell
          label="Последняя длительность"
          value={active ? active.durationLabel : latest?.durationLabel ?? "—"}
          tone={active ? "rose" : "default"}
        />
      </div>

      {visibleHistory.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-widest text-zinc-600">Последние эпизоды</p>
          <div className="space-y-2">
            {visibleHistory.map((period) => (
              <div key={period.id} className="rounded-xl border border-zinc-800/70 bg-zinc-950/35 px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-zinc-200">
                    {formatSicknessDateTime(period.startedAt)} → {formatSicknessDateTime(period.endedAt)}
                  </p>
                  <span className="rounded-full border border-zinc-700 bg-zinc-900/60 px-2 py-1 text-[10px] text-zinc-300">
                    {period.durationLabel}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">{period.calendarDays} календ. дн. · {period.durationDays} сут.</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}