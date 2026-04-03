"use client";

import { useMemo, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { WeekPlanner } from "@/components/week-planner";
import {
  SCHEDULE_RULES,
  SCHEDULE_TONE_CLS,
  getMonthDates,
  getMonthLabel,
  getScheduleForDate,
  getScheduleSummary,
} from "@/lib/schedule";

export default function CalendarPage() {
  const monthDates = useMemo(() => getMonthDates(new Date()), []);
  const today = monthDates.find((item) => item.isToday)?.key ?? monthDates[0]?.key;
  const [selectedDate, setSelectedDate] = useState(today);

  const selected = monthDates.find((item) => item.key === selectedDate) ?? monthDates[0];
  const slots = useMemo(() => getScheduleForDate(selectedDate), [selectedDate]);
  const summary = useMemo(() => getScheduleSummary(selectedDate), [selectedDate]);

  return (
    <AppShell>
      <div className="space-y-5 py-2">
        <div>
          <h1 className="text-2xl font-bold">📅 Календарь апреля</h1>
          <p className="mt-1 text-sm capitalize text-zinc-500">
            {getMonthLabel(new Date())} · события из `schedule.xlsx` + правила уборки и семейных буферов
          </p>
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {monthDates.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setSelectedDate(item.key)}
              className={`flex min-w-18 shrink-0 flex-col items-center rounded-2xl px-3 py-2 transition ${
                selectedDate === item.key
                  ? "bg-zinc-50 text-zinc-950"
                  : item.isToday
                    ? "border border-zinc-700 text-zinc-200"
                    : "border border-zinc-900 text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <span className="text-[10px] uppercase tracking-widest">{item.day}</span>
              <span className="mt-1 text-xs font-semibold">{item.label}</span>
            </button>
          ))}
        </div>

        <WeekPlanner
          anchorDate={selectedDate}
          title="🗓 Week view / 7-дневный горизонт"
          description="Due-задачи живут внутри дня, а не отдельно от расписания. Ниже остаётся детальный разбор выбранной даты."
        />

        <section className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-sky-500/20 bg-sky-950/10 p-3">
            <p className="text-[10px] uppercase tracking-widest text-zinc-500">Праздники</p>
            <p className="mt-1 text-xl font-bold text-sky-300">{summary.parties}</p>
          </div>
          <div className="rounded-xl border border-rose-500/20 bg-rose-950/10 p-3">
            <p className="text-[10px] uppercase tracking-widest text-zinc-500">Уборка</p>
            <p className="mt-1 text-xl font-bold text-rose-300">{summary.cleanup}</p>
          </div>
          <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-950/10 p-3">
            <p className="text-[10px] uppercase tracking-widest text-zinc-500">Семья</p>
            <p className="mt-1 text-xl font-bold text-fuchsia-300">{summary.family}</p>
          </div>
        </section>

        <section className="rounded-4xl border border-zinc-800/50 bg-zinc-900/20 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-zinc-50">План на {selected?.label}</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Чем плотнее день — тем полезнее, что это теперь считается автоматически, а не держится в голове на честном слове.
              </p>
            </div>
            <span className="rounded-full border border-zinc-800 px-3 py-1 text-[10px] uppercase tracking-widest text-zinc-500">
              {slots.length} слотов
            </span>
          </div>

          <div className="mt-4 space-y-2">
            {slots.map((slot) => (
              <div
                key={slot.id}
                className={`rounded-xl border px-4 py-3 ${SCHEDULE_TONE_CLS[slot.tone]}`}
              >
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-mono text-xs opacity-70">
                      {slot.start}–{slot.end}
                    </p>
                    <p className="mt-1 text-sm font-medium">{slot.title}</p>
                    {slot.subtitle && (
                      <p className="mt-1 text-xs opacity-70">{slot.subtitle}</p>
                    )}
                    {slot.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {slot.tags.map((tag) => (
                          <span
                            key={`${slot.id}-${tag}`}
                            className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/65"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-white/70">
                    {slot.source === "studio"
                      ? "schedule.xlsx"
                      : slot.source === "derived"
                        ? "rule"
                        : "week"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-4xl border border-zinc-800/50 bg-zinc-900/20 p-5">
          <h2 className="text-lg font-semibold text-zinc-50">Правила синхронизации</h2>
          <div className="mt-4 space-y-2">
            {SCHEDULE_RULES.map((rule) => (
              <div
                key={rule}
                className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-4 py-3 text-sm text-zinc-300"
              >
                {rule}
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
