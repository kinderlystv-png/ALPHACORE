"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { HabitTracker } from "@/components/habit-tracker";
import { DEFAULT_HABITS, type Habit, isActiveOn } from "@/lib/habits";

/* ── Week rhythm data ── */

type DayBlock = {
  day: string;
  theme: string;
  themeColor: string;
  locked?: string;
};

const weekBlocks: DayBlock[] = [
  { day: "Пн", theme: "Стратегия + deep work", themeColor: "text-sky-300" },
  { day: "Вт", theme: "Реализация + коммуникации", themeColor: "text-zinc-300" },
  { day: "Ср", theme: "Лёгкие задачи", themeColor: "text-zinc-300", locked: "18:00–23:00 🥁 Барабаны" },
  { day: "Чт", theme: "Follow-up + закрытие хвостов", themeColor: "text-zinc-300" },
  { day: "Пт", theme: "Weekly review + план", themeColor: "text-amber-300" },
  { day: "Сб", theme: "Семья + лёгкие задачи", themeColor: "text-violet-300" },
  { day: "Вс", theme: "Восстановление + подготовка", themeColor: "text-violet-300" },
];

/* ── Family events ── */

type FamilyEvent = { date: Date; label: string; emoji: string; reminderDays: number[] };
const familyEvents: FamilyEvent[] = [
  { date: new Date(2026, 4, 1), label: "Даня, 7 лет", emoji: "🎂", reminderDays: [14, 7, 3, 1] },
  { date: new Date(2026, 5, 25), label: "Твой ДР, 38", emoji: "🎉", reminderDays: [14, 7, 3, 1] },
  { date: new Date(2026, 9, 29), label: "ДР супруги, 35", emoji: "💐", reminderDays: [14, 7, 3, 1] },
];

function daysUntil(date: Date): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const t = new Date(date);
  t.setHours(0, 0, 0, 0);
  return Math.ceil((t.getTime() - now.getTime()) / 86_400_000);
}

/* ── Today's habits preview ── */

function TodayHabits() {
  const [habits, setHabits] = useState<Habit[]>([]);
  useEffect(() => {
    setHabits(DEFAULT_HABITS.filter((h) => isActiveOn(h, new Date().getDay())));
  }, []);
  return (
    <div className="flex flex-wrap gap-2">
      {habits.map((h) => (
        <span
          key={h.id}
          className="rounded-lg border border-zinc-800/50 bg-zinc-900/30 px-2.5 py-1.5 text-xs text-zinc-300"
        >
          {h.emoji} {h.name}
        </span>
      ))}
    </div>
  );
}

export default function RoutinesPage() {
  const todayIdx = (() => { const d = new Date().getDay(); return d === 0 ? 6 : d - 1; })();

  const upcoming = familyEvents
    .map((e) => ({ ...e, days: daysUntil(e.date) }))
    .filter((e) => e.days >= 0)
    .sort((a, b) => a.days - b.days);

  const alerts = upcoming.filter((e) =>
    e.reminderDays.some((rd) => e.days <= rd),
  );

  return (
    <AppShell>
      <div className="space-y-6 py-2">
        <h1 className="text-2xl font-bold">🔔 Ритм и рутины</h1>

        {/* Alerts */}
        {alerts.length > 0 && (
          <section className="space-y-2">
            <p className="text-[11px] uppercase tracking-widest text-zinc-500">Напоминания</p>
            {alerts.map((e) => (
              <div
                key={e.label}
                className={`flex items-center gap-3 rounded-xl border p-3.5 ${
                  e.days <= 3
                    ? "border-rose-500/25 bg-rose-950/15 text-rose-300"
                    : e.days <= 7
                      ? "border-amber-500/25 bg-amber-950/15 text-amber-300"
                      : "border-violet-500/20 bg-violet-950/10 text-violet-300"
                }`}
              >
                <span className="text-xl">{e.emoji}</span>
                <div className="flex-1">
                  <p className="text-sm font-medium">{e.label}</p>
                  <p className="text-xs opacity-70">
                    {e.date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
                  </p>
                </div>
                <span className="text-sm font-bold">{e.days} д.</span>
              </div>
            ))}
          </section>
        )}

        {/* Habit tracker (full) */}
        <HabitTracker />

        {/* Today's routine */}
        <section className="rounded-xl border border-zinc-800/50 bg-zinc-900/20 p-4 space-y-3">
          <p className="text-[11px] uppercase tracking-widest text-zinc-500">
            Привычки на сегодня
          </p>
          <TodayHabits />
        </section>

        {/* Week rhythm */}
        <section className="space-y-3">
          <p className="text-[11px] uppercase tracking-widest text-zinc-500">Ритм недели</p>
          <div className="space-y-1.5">
            {weekBlocks.map((b, i) => (
              <div
                key={b.day}
                className={`flex items-center gap-3 rounded-xl border p-3.5 transition ${
                  i === todayIdx
                    ? "border-zinc-600 bg-zinc-800/50"
                    : "border-zinc-800/50 bg-zinc-900/20"
                }`}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold ${
                    i === todayIdx ? "bg-zinc-50 text-zinc-950" : "bg-zinc-800 text-zinc-400"
                  }`}
                >
                  {b.day}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${b.themeColor}`}>{b.theme}</p>
                  {b.locked && (
                    <p className="text-xs text-violet-400 mt-0.5">🔒 {b.locked}</p>
                  )}
                </div>
                {i === todayIdx && (
                  <span className="shrink-0 rounded-md bg-zinc-50 px-2 py-0.5 text-[10px] font-bold text-zinc-950">
                    Сегодня
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Personal constraints */}
        <section className="rounded-xl border border-violet-500/15 bg-violet-950/10 p-4 space-y-3">
          <p className="text-[11px] uppercase tracking-widest text-zinc-500">Ограничения</p>
          <ul className="space-y-2 text-sm text-zinc-300">
            <li className="flex gap-2">
              <span>🌙</span>
              <span>Сон: коридор отбоя 23:30–00:00, цель 7 ч.</span>
            </li>
            <li className="flex gap-2">
              <span>🏃</span>
              <span>Бег: 3×/нед по 60 мин, без Ср/Чт. Слоты: Пн/Вт/Пт/Сб.</span>
            </li>
            <li className="flex gap-2">
              <span>🧘</span>
              <span>Растяжка: утром 10–20 мин ежедневно.</span>
            </li>
            <li className="flex gap-2">
              <span>🥁</span>
              <span>Среда 18–23: барабаны. Не планировать ничего критичного.</span>
            </li>
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
