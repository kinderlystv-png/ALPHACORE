"use client";

import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { WeekPlanner } from "@/components/week-planner";
import {
  formatScheduleTimeRange,
  getHeysSyncedSlotBadgeLabel,
  getScheduleSlotApprovalState,
  SCHEDULE_RULES,
  SCHEDULE_TONE_CLS,
  getMonthDates,
  getMonthLabel,
  getScheduleForDate,
  getScheduleSummary,
  isHeysSyncedScheduleSlot,
  toggleScheduleSlotApproval,
} from "@/lib/schedule";
import { subscribeAppDataChange } from "@/lib/storage";

function formatCompletionLabel(completedAt?: string | null): string | null {
  if (!completedAt) return null;

  const value = new Date(completedAt);
  if (Number.isNaN(value.getTime())) return null;

  return `подтверждено ${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

export default function CalendarPage() {
  const [version, setVersion] = useState(0);
  const [isHydrated, setIsHydrated] = useState(false);
  const monthDates = useMemo(() => getMonthDates(new Date()), []);
  const today = monthDates.find((item) => item.isToday)?.key ?? monthDates[0]?.key;
  const [selectedDate, setSelectedDate] = useState(today);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    return subscribeAppDataChange((keys) => {
      if (
        keys.some((key) =>
          ["alphacore_tasks", "alphacore_schedule_custom", "alphacore_schedule_overrides", "alphacore_schedule_approvals"].includes(key),
        )
      ) {
        setVersion((current) => current + 1);
      }
    });
  }, []);

  const selected = monthDates.find((item) => item.key === selectedDate) ?? monthDates[0];
  const slots = useMemo(
    () => (isHydrated ? getScheduleForDate(selectedDate) : []),
    [isHydrated, selectedDate, version],
  );
  const summary = useMemo(
    () =>
      isHydrated
        ? getScheduleSummary(selectedDate)
        : {
            parties: 0,
            cleanup: 0,
            family: 0,
          },
    [isHydrated, selectedDate, version],
  );

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
          description="Плановые слоты живут внутри дня, а не отдельно от расписания. Всё кроме фиксированных фактов подтверждается вручную."
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
                Чем плотнее день — тем полезнее видеть контекст и вручную подтверждать, что реально произошло, а что осталось только планом.
              </p>
            </div>
            <span className="rounded-full border border-zinc-800 px-3 py-1 text-[10px] uppercase tracking-widest text-zinc-500">
              {slots.length} слотов
            </span>
          </div>

          <div className="mt-4 space-y-2">
            {slots.map((slot) => {
              const isHeysSynced = isHeysSyncedScheduleSlot(slot);
              const heysBadgeLabel = isHeysSynced ? getHeysSyncedSlotBadgeLabel(slot) : null;
              const approvalState = getScheduleSlotApprovalState(slot);
              const requiresApproval = approvalState.requiresApproval;
              const isCompleted = approvalState.isCompleted;
              const isPendingSlot = requiresApproval && !isCompleted;
              const completionLabel = formatCompletionLabel(approvalState.completedAt);
              const shellCls = isPendingSlot
                ? "border-rose-500/60 bg-linear-to-br from-rose-500/30 via-red-500/22 to-rose-950/42 text-rose-50 shadow-[0_10px_24px_rgba(127,29,29,0.28)]"
                : isCompleted
                  ? "border-zinc-700/80 bg-zinc-900/72 text-zinc-300"
                  : `${SCHEDULE_TONE_CLS[slot.tone]} opacity-60`;
              const timeCls = isPendingSlot ? "text-rose-100/85" : "text-zinc-500";
              const titleCls = isPendingSlot
                ? "text-rose-50"
                : isCompleted
                  ? "text-zinc-400 line-through decoration-zinc-500/40 opacity-85"
                  : "text-zinc-300";
              const subtitleCls = isPendingSlot ? "text-rose-100/75" : "text-zinc-500";
              const sourceLabel =
                slot.source === "studio"
                  ? "schedule.xlsx"
                  : slot.source === "derived"
                    ? "rule"
                    : "week";

              return (
                <div
                  key={slot.id}
                  className={`rounded-xl border px-4 py-3 ${shellCls}`}
                >
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className={`font-mono text-xs ${timeCls}`}>
                          {formatScheduleTimeRange(slot.start, slot.end)}
                        </p>
                        {requiresApproval && (
                          <button
                            type="button"
                            onClick={() => {
                              toggleScheduleSlotApproval(slot);
                              setVersion((current) => current + 1);
                            }}
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold leading-none transition ${
                              isCompleted
                                ? "border-zinc-600/80 bg-zinc-900/85 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
                                : "border-rose-200/40 bg-black/20 text-rose-50 hover:border-rose-100/70 hover:bg-black/30"
                            }`}
                            aria-label={isCompleted ? "Снять подтверждение слота" : "Подтвердить слот"}
                            title={isCompleted ? "Снять подтверждение" : "Подтвердить выполнение"}
                          >
                            {isCompleted ? "✓" : "○"}
                          </button>
                        )}
                      </div>
                      <p className={`mt-1 min-w-0 text-sm font-medium ${titleCls}`}>
                          {slot.title}
                      </p>
                      {completionLabel && (
                        <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                          {completionLabel}
                        </p>
                      )}
                      {slot.subtitle && (
                        <p className={`mt-1 text-xs ${subtitleCls}`}>{slot.subtitle}</p>
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
                    <div className={`flex shrink-0 flex-wrap items-center gap-2 ${isPendingSlot ? "" : "opacity-70"}`}>
                      {heysBadgeLabel && (
                        <span className="rounded-full border border-orange-400/25 bg-orange-500/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-orange-200">
                          {heysBadgeLabel}
                        </span>
                      )}
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-white/70">
                        {sourceLabel}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
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
