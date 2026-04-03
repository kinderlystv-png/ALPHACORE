"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type DaySummary,
  type Habit,
  type HabitCategory,
  activeHabits,
  getChecks,
  streak as getStreak,
  todayStr,
  toggle,
  weekSummary,
} from "@/lib/habits";
import { subscribeAppDataChange } from "@/lib/storage";

/* ── SVG progress ring ── */
function Ring({ pct, size = 56 }: { pct: number; size?: number }) {
  const sw = 5;
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (pct / 100) * c;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={sw}
        className="stroke-zinc-800"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={sw}
        strokeDasharray={c}
        strokeDashoffset={off}
        strokeLinecap="round"
        className="stroke-emerald-400 transition-all duration-500"
      />
    </svg>
  );
}

/* ── Weekly bar chart ── */
function Bars({ data }: { data: DaySummary[] }) {
  const maxH = 44;
  return (
    <div className="flex items-end gap-1.5">
      {data.map((d, i) => {
        const pct = d.total > 0 ? (d.done / d.total) * 100 : 0;
        const h = Math.max(4, (pct / 100) * maxH);
        const last = i === data.length - 1;
        return (
          <div key={d.date} className="flex flex-col items-center gap-1">
            <div
              className={`w-5 rounded-md transition-all duration-300 ${
                pct === 100
                  ? "bg-emerald-400"
                  : pct > 0
                    ? "bg-emerald-400/40"
                    : "bg-zinc-800"
              } ${last ? "ring-1 ring-emerald-400/30" : ""}`}
              style={{ height: `${h}px` }}
            />
            <span
              className={`text-[10px] ${
                last ? "font-semibold text-emerald-400" : "text-zinc-600"
              }`}
            >
              {d.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const CAT_LABEL: Record<string, string> = {
  health: "здоровье",
  work: "работа",
  personal: "личное",
};
const CAT_CLS: Record<string, string> = {
  health: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  work: "border-sky-500/20 bg-sky-500/10 text-sky-400",
  personal: "border-violet-500/20 bg-violet-500/10 text-violet-400",
};

/* ── Main component ── */
export function HabitTracker() {
  const [today, setToday] = useState("");
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [habits, setHabits] = useState<Habit[]>([]);
  const [week, setWeek] = useState<DaySummary[]>([]);
  const [str, setStr] = useState(0);
  const [categoryFilter, setCategoryFilter] = useState<HabitCategory | "all">("all");
  const [showOnlyPending, setShowOnlyPending] = useState(false);

  const reload = useCallback(() => {
    const t = todayStr();
    setToday(t);
    setChecks(getChecks(t));
    setHabits(activeHabits(new Date()));
    setWeek(weekSummary());
    setStr(getStreak());
  }, []);

  useEffect(() => {
    reload();
    return subscribeAppDataChange((keys) => {
      if (keys.includes("alphacore_habits")) reload();
    });
  }, [reload]);

  const onToggle = useCallback(
    (id: string) => {
      const v = toggle(id, today);
      setChecks((p) => ({ ...p, [id]: v }));
      setWeek(weekSummary());
      setStr(getStreak());
    },
    [today],
  );

  const done = habits.filter((h) => checks[h.id]).length;
  const total = habits.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const filteredHabits = habits.filter((habit) => {
    if (categoryFilter !== "all" && habit.category !== categoryFilter) return false;
    if (showOnlyPending && checks[habit.id]) return false;
    return true;
  });
  const visiblePending = filteredHabits.filter((habit) => !checks[habit.id]);

  const completeVisible = useCallback(() => {
    let changed = false;
    for (const habit of filteredHabits) {
      if (!checks[habit.id]) {
        toggle(habit.id, today);
        changed = true;
      }
    }

    if (changed) reload();
  }, [checks, filteredHabits, reload, today]);

  return (
    <section className="rounded-4xl border border-emerald-500/20 bg-linear-to-br from-emerald-950/15 to-zinc-950 p-5 shadow-2xl shadow-black/20 sm:p-6">
      {/* Header: title + ring */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-50">✅ Привычки</h2>
          <p className="mt-0.5 text-sm text-zinc-400">
            {done}/{total} сегодня
            {str > 0 && (
              <span className="ml-2 text-amber-400">🔥 {str} д.</span>
            )}
          </p>
        </div>
        <div className="relative flex items-center justify-center">
          <Ring pct={pct} />
          <span className="absolute text-xs font-bold text-emerald-400">
            {pct}%
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {([
          { key: "all", label: "все" },
          { key: "health", label: "здоровье" },
          { key: "work", label: "работа" },
          { key: "personal", label: "личное" },
        ] as const).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setCategoryFilter(item.key)}
            className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition ${
              categoryFilter === item.key
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                : "border-zinc-800 bg-zinc-900/40 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
            }`}
          >
            {item.label}
          </button>
        ))}

        <button
          type="button"
          onClick={() => setShowOnlyPending((current) => !current)}
          className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition ${
            showOnlyPending
              ? "border-amber-500/25 bg-amber-500/10 text-amber-300"
              : "border-zinc-800 bg-zinc-900/40 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
          }`}
        >
          только незакрытые
        </button>

        {visiblePending.length > 0 && (
          <button
            type="button"
            onClick={completeVisible}
            className="ml-auto rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-medium text-emerald-300 transition hover:border-emerald-400/40"
          >
            закрыть видимое · {visiblePending.length}
          </button>
        )}
      </div>

      {/* Checklist */}
      <div className="mt-4 space-y-1.5">
        {filteredHabits.map((h) => {
          const on = checks[h.id] ?? false;
          return (
            <button
              key={h.id}
              type="button"
              onClick={() => onToggle(h.id)}
              className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-all ${
                on
                  ? "border-emerald-500/25 bg-emerald-500/5"
                  : "border-zinc-800/80 bg-zinc-900/40 hover:border-zinc-700"
              }`}
            >
              <div
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all ${
                  on
                    ? "border-emerald-400 bg-emerald-400 text-zinc-950"
                    : "border-zinc-600"
                }`}
              >
                {on && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2 6L5 9L10 3"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>
              <span className="text-base">{h.emoji}</span>
              <span
                className={`text-sm ${on ? "text-emerald-300/80 line-through" : "text-zinc-200"}`}
              >
                {h.name}
              </span>
              <span
                className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] font-medium ${CAT_CLS[h.category]}`}
              >
                {CAT_LABEL[h.category]}
              </span>
            </button>
          );
        })}
        {filteredHabits.length === 0 && (
          <p className="py-3 text-center text-sm text-zinc-500">
            {habits.length === 0
              ? "На сегодня нет запланированных привычек"
              : "По текущему фильтру ничего не осталось — уже красиво."}
          </p>
        )}
      </div>

      {/* Weekly summary chart */}
      <div className="mt-5 rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-3.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-widest text-zinc-500">
            Неделя
          </span>
          <span className="text-[11px] text-zinc-500">
            {week.reduce((s, d) => s + d.done, 0)}/
            {week.reduce((s, d) => s + d.total, 0)}
          </span>
        </div>
        <div className="mt-2.5 flex justify-center">
          <Bars data={week} />
        </div>
      </div>
    </section>
  );
}
