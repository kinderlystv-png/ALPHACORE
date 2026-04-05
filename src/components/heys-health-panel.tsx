"use client";

import { useEffect, useState } from "react";
import {
  addCustomEvent,
  getCustomEvents,
  getScheduleForDate,
  isEditableScheduleSlot,
  minutesToTime,
  timeToMinutes,
  type CustomEvent,
  type ScheduleSlot,
  type ScheduleTone,
} from "@/lib/schedule";
import {
  addTask,
  getTasks,
  type AutomationOrigin,
  type Task,
  type TaskPriority,
} from "@/lib/tasks";
import {
  applyIntradayRescheduleAction,
  type IntradayRescheduleAction,
} from "@/lib/intraday-reschedule";
import { useHeysSync } from "@/lib/use-heys-sync";
import type {
  HeysDayRecord,
  HeysHealthSignals,
  HeysIntradayMetricShift,
  HeysIntradaySignal,
} from "@/lib/heys-bridge";
import {
  buildBundleContextProfile,
  getDefaultMetricKey,
  getHeysDayMode,
  type BundleContextProfile,
  type DayMode,
  type HeysMetricKey as MetricKey,
} from "@/lib/heys-day-mode";

/* ── Sparkline ── */

type SparkPoint = { value: number; date: string };
type MetricStatus = "good" | "warn" | "bad";

type DrilldownStat = {
  label: string;
  value: string;
  sub?: string;
  tone?: MetricStatus | "neutral";
};

type MetricDefinition = {
  key: MetricKey;
  emoji: string;
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  sparkPoints: SparkPoint[];
  color?: string;
  goal?: number | null;
  status?: MetricStatus;
  drilldown: {
    summary: string;
    insight: string;
    action: string;
    stats: DrilldownStat[];
  };
};

type MetricActionPlan = {
  recommended: "task" | "slot";
  task: {
    title: string;
    priority: TaskPriority;
    dueOffset?: number;
    success: string;
  };
  slot: {
    title: string;
    tone: ScheduleTone;
    start: string;
    end: string;
    dateOffset?: number;
    tags: string[];
    success: string;
  };
};

type ActionFeedback = {
  tone: "success" | "info";
  text: string;
};

type SlotCandidate = {
  start: string;
  end: string;
  dateOffset?: number;
};

type ResolvedSlotPlan = MetricActionPlan["slot"] & {
  date: string;
};

type WeeklySlotOption = ResolvedSlotPlan & {
  loadScore: number;
};

type CorrelationInsight = {
  id: string;
  metricKey: MetricKey;
  title: string;
  detail: string;
  tone: MetricStatus | "neutral";
};

type IntradayRescheduleHint = {
  id: string;
  title: string;
  detail: string;
  tone: MetricStatus | "neutral";
  action?: IntradayRescheduleAction;
};

type TraceItem = {
  id: string;
  kind: "task" | "slot";
  title: string;
  subtitle: string;
  statusLabel: string;
  statusTone: MetricStatus | "neutral";
  impact: ImpactEvaluation;
  metricKey: MetricKey | null;
  createdAt: number;
};

type ImpactEvaluation = {
  kind: "pending" | "needs-completion" | "improved" | "worse" | "flat" | "no-data";
  label: string;
  detail: string;
  tone: MetricStatus | "neutral";
};

type ImpactConfig = {
  direction: "higher" | "lower";
  mode: "avg" | "sum";
  threshold: number;
  beforeCount: number;
  afterCount: number;
  minBefore: number;
  minAfter: number;
  waitDays: number;
  getValue: (day: HeysDayRecord, weightGoal: number | null | undefined) => number | null;
  formatChange: (rawDelta: number, outcome: "improved" | "worse" | "flat") => string;
  formatValue: (value: number) => string;
  windowLabel: string;
};

type LearnedActionStat = {
  id: string;
  metricKey: MetricKey;
  actionKind: "task" | "slot";
  improved: number;
  worse: number;
  flat: number;
  pending: number;
  resolved: number;
  score: number;
  confidence: "low" | "medium" | "high";
};

type CompoundActionItem = {
  id: string;
  metricKey: MetricKey;
  kind: "task" | "slot";
};

type CompoundActionBundle = {
  id: string;
  label: string;
  summary: string;
  appliesTo: MetricKey[];
  items: CompoundActionItem[];
};

type LearnedBundleStat = {
  id: string;
  label: string;
  improved: number;
  worse: number;
  flat: number;
  pending: number;
  resolved: number;
  score: number;
  confidence: "low" | "medium" | "high";
};

type ActionCreateResult = {
  kind: "task" | "slot";
  status: "created" | "existing";
  title: string;
  dateLabel?: string;
};

type CompoundBundleChoice = {
  bundle: CompoundActionBundle;
  score: number;
  reasons: string[];
  learning: LearnedBundleStat | null;
};

function Sparkline({
  points,
  color = "sky",
  goal,
  height = 32,
  width = 120,
}: {
  points: SparkPoint[];
  color?: string;
  goal?: number | null;
  height?: number;
  width?: number;
}) {
  if (points.length < 2) return null;

  const values = points.map((p) => p.value);
  const allValues = goal != null ? [...values, goal] : values;
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;

  const pad = 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const coords = points.map((p, i) => ({
    x: pad + (i / (points.length - 1)) * innerW,
    y: pad + innerH - ((p.value - min) / range) * innerH,
  }));

  const pathD = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x},${c.y}`).join(" ");

  // gradient fill
  const fillD = `${pathD} L${coords[coords.length - 1]!.x},${height} L${coords[0]!.x},${height} Z`;

  const colorMap: Record<string, { stroke: string; fill: string; goalStroke: string }> = {
    sky: { stroke: "#38bdf8", fill: "#38bdf808", goalStroke: "#38bdf830" },
    emerald: { stroke: "#34d399", fill: "#34d39908", goalStroke: "#34d39930" },
    violet: { stroke: "#a78bfa", fill: "#a78bfa08", goalStroke: "#a78bfa30" },
    rose: { stroke: "#fb7185", fill: "#fb718508", goalStroke: "#fb718530" },
    amber: { stroke: "#fbbf24", fill: "#fbbf2408", goalStroke: "#fbbf2430" },
    fuchsia: { stroke: "#e879f9", fill: "#e879f908", goalStroke: "#e879f930" },
    teal: { stroke: "#2dd4bf", fill: "#2dd4bf08", goalStroke: "#2dd4bf30" },
  };
  const c = colorMap[color] ?? colorMap.sky!;

  const goalY = goal != null ? pad + innerH - ((goal - min) / range) * innerH : null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0"
    >
      {/* fill */}
      <path d={fillD} fill={c.fill} />
      {/* goal line */}
      {goalY != null && (
        <line
          x1={pad}
          y1={goalY}
          x2={width - pad}
          y2={goalY}
          stroke={c.goalStroke}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      )}
      {/* line */}
      <path d={pathD} fill="none" stroke={c.stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {/* last-point dot */}
      <circle cx={coords[coords.length - 1]!.x} cy={coords[coords.length - 1]!.y} r={2.5} fill={c.stroke} />
    </svg>
  );
}

/* ── Metric card ── */

function MetricCard({
  emoji,
  label,
  value,
  unit,
  sub,
  sparkPoints,
  color = "sky",
  goal,
  status,
  active = false,
  onClick,
}: {
  emoji: string;
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  sparkPoints: SparkPoint[];
  color?: string;
  goal?: number | null;
  status?: MetricStatus;
  active?: boolean;
  onClick?: () => void;
}) {
  const statusDot =
    status === "bad"
      ? "bg-rose-400"
      : status === "warn"
        ? "bg-amber-400"
        : status === "good"
          ? "bg-emerald-400"
          : "bg-zinc-600";
  const activeClass = active
    ? "border-zinc-600 bg-zinc-900/60 ring-1 ring-sky-400/15"
    : "border-zinc-800/60 bg-zinc-900/30 hover:border-zinc-700 hover:bg-zinc-900/40";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${activeClass}`}
    >
      {/* Left: emoji + label + value */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs">{emoji}</span>
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</span>
          <span className={`ml-auto h-1.5 w-1.5 rounded-full ${statusDot}`} />
        </div>
        <div className="mt-0.5 flex items-baseline gap-1">
          <span className="text-lg font-semibold tabular-nums text-zinc-50">{value}</span>
          {unit && <span className="text-[10px] text-zinc-500">{unit}</span>}
        </div>
        {sub && <p className="mt-0.5 text-[10px] text-zinc-500">{sub}</p>}
      </div>
      {/* Right: sparkline */}
      <Sparkline points={sparkPoints} color={color} goal={goal} />
    </button>
  );
}

/* ── Helpers to extract sparkline data ── */

function extractSpark(
  days: HeysDayRecord[],
  field: keyof HeysDayRecord,
): SparkPoint[] {
  return days
    .filter((d) => d[field] != null)
    .map((d) => ({ value: d[field] as number, date: d.date }));
}

function parseSleepStartToHour(value: string | null): number | null {
  if (!value) return null;

  const [hoursRaw, minutesRaw] = value.split(":");
  const hours = Number(hoursRaw ?? 0);
  const minutes = Number(minutesRaw ?? 0);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;

  const total = hours + minutes / 60;
  return total < 12 ? total + 24 : total;
}

function todayDateKey(offset = 0): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function resolveSlotDate(start: string, offset = 0): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);

  if (offset === 0) {
    const [hour, minute] = start.split(":").map(Number);
    const now = new Date();
    if (now.getHours() * 60 + now.getMinutes() >= hour * 60 + minute) {
      date.setDate(date.getDate() + 1);
    }
  }

  return date.toISOString().slice(0, 10);
}

function formatDateLabel(dateKey: string): string {
  if (dateKey === todayDateKey()) return "сегодня";
  if (dateKey === todayDateKey(1)) return "завтра";

  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${dateKey}T00:00:00`));
}

function overlapsTimeRange(
  start: string,
  end: string,
  slot: Pick<ScheduleSlot, "start" | "end">,
): boolean {
  return timeToMinutes(start) < timeToMinutes(slot.end) && timeToMinutes(end) > timeToMinutes(slot.start);
}

function getDayLoad(dateKey: string): {
  slots: ScheduleSlot[];
  score: number;
  parties: number;
  cleanup: number;
  family: number;
} {
  const slots = getScheduleForDate(dateKey);
  const parties = slots.filter((slot) => slot.tone === "kinderly").length;
  const cleanup = slots.filter((slot) => slot.tone === "cleanup").length;
  const family = slots.filter((slot) => slot.tone === "family").length;

  return {
    slots,
    parties,
    cleanup,
    family,
    score: parties * 6 + cleanup * 5 + family * 2 + slots.length,
  };
}

function isSlotCandidateUsable(dateKey: string, candidate: SlotCandidate): boolean {
  if (dateKey !== todayDateKey()) return true;

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return nowMinutes < timeToMinutes(candidate.start) - 5;
}

function getAutopilotSlotCandidates(metricKey: MetricKey): SlotCandidate[] {
  switch (metricKey) {
    case "sleep":
      return [
        { start: "23:15", end: "23:45", dateOffset: 0 },
        { start: "23:15", end: "23:45", dateOffset: 1 },
        { start: "23:30", end: "23:55", dateOffset: 1 },
      ];
    case "bedtime":
      return [
        { start: "23:30", end: "23:55", dateOffset: 0 },
        { start: "23:30", end: "23:55", dateOffset: 1 },
        { start: "23:15", end: "23:40", dateOffset: 2 },
      ];
    case "steps":
      return [
        { start: "17:30", end: "17:50", dateOffset: 0 },
        { start: "12:30", end: "12:50", dateOffset: 1 },
        { start: "17:00", end: "17:20", dateOffset: 1 },
        { start: "12:30", end: "12:50", dateOffset: 2 },
      ];
    case "training":
      return [
        { start: "08:00", end: "09:00", dateOffset: 1 },
        { start: "18:30", end: "19:30", dateOffset: 2 },
        { start: "08:00", end: "09:00", dateOffset: 3 },
        { start: "18:30", end: "19:30", dateOffset: 4 },
      ];
    case "weight":
      return [
        { start: "19:30", end: "19:50", dateOffset: 0 },
        { start: "19:30", end: "19:50", dateOffset: 1 },
      ];
    case "mood":
      return [
        { start: "20:45", end: "21:05", dateOffset: 0 },
        { start: "20:45", end: "21:05", dateOffset: 1 },
      ];
    case "wellbeing":
      return [
        { start: "20:30", end: "21:00", dateOffset: 0 },
        { start: "20:30", end: "21:00", dateOffset: 1 },
        { start: "21:00", end: "21:30", dateOffset: 2 },
      ];
    case "water":
      return [
        { start: "11:30", end: "11:40", dateOffset: 0 },
        { start: "15:30", end: "15:40", dateOffset: 0 },
        { start: "11:30", end: "11:40", dateOffset: 1 },
      ];
    case "stress":
      return [
        { start: "16:30", end: "16:50", dateOffset: 0 },
        { start: "20:30", end: "20:50", dateOffset: 0 },
        { start: "20:30", end: "20:50", dateOffset: 1 },
      ];
    default:
      return [{ start: "20:00", end: "20:15", dateOffset: 0 }];
  }
}

function resolveAutopilotSlot(metricKey: MetricKey, plan: MetricActionPlan): ResolvedSlotPlan | null {
  return getAutopilotSlotOptions(metricKey, plan)[0] ?? null;
}

function resolveAutopilotTaskDate(metricKey: MetricKey, priority: TaskPriority): string {
  const offsets = priority === "p1" ? [0, 1, 2] : [1, 2, 3, 4];
  const ranked = offsets
    .map((offset) => {
      const date = todayDateKey(offset);
      const load = getDayLoad(date);
      const extraPenalty =
        (metricKey === "training" && load.parties > 0 ? 8 : 0) +
        ((metricKey === "wellbeing" || metricKey === "stress") && load.cleanup > 0 ? 5 : 0);

      return {
        date,
        score: load.score + offset * 1.5 + extraPenalty,
      };
    })
    .sort((left, right) => left.score - right.score);

  return ranked[0]?.date ?? todayDateKey(priority === "p1" ? 0 : 1);
}

function getAutopilotSlotOptions(
  metricKey: MetricKey,
  plan: MetricActionPlan,
): WeeklySlotOption[] {
  const ranked = getAutopilotSlotCandidates(metricKey)
    .map((candidate) => {
      const date = resolveSlotDate(candidate.start, candidate.dateOffset ?? 0);
      const load = getDayLoad(date);

      if (!isSlotCandidateUsable(date, candidate)) return null;
      if (load.slots.some((slot) => overlapsTimeRange(candidate.start, candidate.end, slot))) {
        return null;
      }
      if (load.cleanup > 0 && ["steps", "training", "wellbeing"].includes(metricKey)) {
        return null;
      }
      if (metricKey === "training" && load.parties > 0) return null;
      if (metricKey === "steps" && load.parties > 1) return null;

      return {
        ...plan.slot,
        date,
        start: candidate.start,
        end: candidate.end,
        loadScore: load.score,
      } satisfies WeeklySlotOption;
    })
    .filter((option): option is WeeklySlotOption => option != null)
    .sort(
      (left, right) =>
        left.loadScore - right.loadScore ||
        left.date.localeCompare(right.date) ||
        timeToMinutes(left.start) - timeToMinutes(right.start),
    );

  const seen = new Set<string>();
  return ranked.filter((option) => {
    const key = `${option.date}-${option.start}-${option.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractBedtimeSpark(days: HeysDayRecord[]): SparkPoint[] {
  return days
    .map((day) => ({
      date: day.date,
      value: parseSleepStartToHour(day.sleepStart),
    }))
    .filter((point): point is SparkPoint => point.value != null);
}

function lastSparkValue(points: SparkPoint[]): number | null {
  return points.length > 0 ? points[points.length - 1]!.value : null;
}

function averageSpark(points: SparkPoint[]): number | null {
  if (!points.length) return null;
  return points.reduce((sum, point) => sum + point.value, 0) / points.length;
}

function fmtNum(v: number | null | undefined, digits = 1): string {
  if (v == null) return "—";
  return digits === 0 ? String(Math.round(v)) : v.toFixed(digits);
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${Math.round(v * 100)}%`;
}

function fmtSigned(v: number | null | undefined, digits = 1, suffix = ""): string {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${digits === 0 ? Math.round(v) : v.toFixed(digits)}${suffix}`;
}

function fmtClock(v: number | null | undefined): string {
  if (v == null) return "—";

  let normalized = v >= 24 ? v - 24 : v;
  let hours = Math.floor(normalized);
  let minutes = Math.round((normalized - hours) * 60);

  if (minutes === 60) {
    hours += 1;
    minutes = 0;
  }

  hours = hours % 24;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function toneCardClass(tone: MetricStatus | "neutral" = "neutral"): string {
  if (tone === "bad") return "border-rose-500/15 bg-rose-500/6";
  if (tone === "warn") return "border-amber-500/15 bg-amber-500/6";
  if (tone === "good") return "border-emerald-500/15 bg-emerald-500/6";
  return "border-zinc-800/60 bg-zinc-900/25";
}

function toneBadgeClass(tone: MetricStatus | "neutral" = "neutral"): string {
  if (tone === "bad") return "border-rose-500/20 bg-rose-500/10 text-rose-200";
  if (tone === "warn") return "border-amber-500/20 bg-amber-500/10 text-amber-200";
  if (tone === "good") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
  return "border-zinc-800 bg-zinc-900/60 text-zinc-300";
}

function intradayStatusToTone(status: HeysIntradaySignal["status"]): MetricStatus | "neutral" {
  if (status === "critical") return "bad";
  if (status === "watch") return "warn";
  if (status === "good") return "good";
  return "neutral";
}

function getIntradayMomentumLabel(momentum: HeysIntradaySignal["momentum"]): string {
  switch (momentum) {
    case "worsening":
      return "Live drift вниз";
    case "improving":
      return "Фон выравнивается";
    case "mixed":
      return "Mixed signal";
    case "flat":
      return "Фон стабилен";
    default:
      return "Мало intraday-точек";
  }
}

function getIntradayStatusLabel(status: HeysIntradaySignal["status"]): string {
  switch (status) {
    case "critical":
      return "реагировать сейчас";
    case "watch":
      return "лучше подстроить день";
    case "good":
      return "можно опираться";
    default:
      return "ждём больше сигнала";
  }
}

function formatIntradayShiftDelta(shift: HeysIntradayMetricShift | null | undefined): string {
  return shift?.delta != null ? fmtSigned(shift.delta, 1) : "—";
}

function buildIntradaySub(
  shift: HeysIntradayMetricShift | null | undefined,
  signal: HeysIntradaySignal | null | undefined,
): string | undefined {
  if (shift?.delta == null) return undefined;
  return `с утра ${fmtSigned(shift.delta, 1)}${signal?.lastCheckInAt ? ` · ${signal.lastCheckInAt}` : ""}`;
}

function shortenLabel(text: string, maxLength = 52): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function buildIntradayRescheduleHints(input: {
  signal: HeysIntradaySignal | null | undefined;
  topMetricKey: MetricKey;
  todaySchedule: ScheduleSlot[];
  slotOptions: WeeklySlotOption[];
  tasks: Task[];
}): IntradayRescheduleHint[] {
  const { signal, topMetricKey, todaySchedule, slotOptions, tasks } = input;

  if (
    !signal ||
    (signal.status !== "critical" && signal.status !== "watch") ||
    (signal.momentum !== "worsening" && signal.momentum !== "mixed")
  ) {
    return [];
  }

  const today = todayDateKey();
  const focusLabel = signal.focusMetricKey ? getMetricLabel(signal.focusMetricKey).toLowerCase() : getMetricLabel(topMetricKey).toLowerCase();
  const hints: IntradayRescheduleHint[] = [];
  const nextSlot = slotOptions[0] ?? null;
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const livePlanningSlot = todaySchedule.find(
    (slot) =>
      isEditableScheduleSlot(slot) &&
      timeToMinutes(slot.end) > nowMinutes + 5 &&
      (slot.tone === "work" || slot.tone === "review" || slot.tone === "kinderly" || slot.tone === "heys"),
  ) ?? null;

  if (livePlanningSlot) {
    const compressedEndMinutes = Math.min(
      timeToMinutes(livePlanningSlot.end),
      timeToMinutes(livePlanningSlot.start) + 30,
    );
    hints.push({
      id: `slot-${livePlanningSlot.date}-${livePlanningSlot.start}`,
      title: "Сжать ближайший слот",
      detail:
        `${livePlanningSlot.start}–${livePlanningSlot.end} оставить только под один 25–30 мин sprint, а остаток дня не раздувать на фоне просадки ${focusLabel}.`,
      tone: signal.status === "critical" ? "bad" : "warn",
      action: {
        type: "compress-slot",
        slotId: livePlanningSlot.id,
        date: livePlanningSlot.date,
        title: `Decision sprint · ${shortenLabel(getMetricLabel(topMetricKey), 20)}`,
        end: minutesToTime(compressedEndMinutes),
        tone: livePlanningSlot.tone,
        tags: [...new Set([...livePlanningSlot.tags, "intraday-rescue", "decision-sprint"])],
        metricKey: signal.focusMetricKey ?? topMetricKey,
      },
    });
  } else if (nextSlot) {
    hints.push({
      id: `buffer-${nextSlot.date}-${nextSlot.start}`,
      title: "Поставить quiet buffer",
      detail:
        nextSlot.date === today
          ? `${nextSlot.start}–${nextSlot.end} лучше отдать под quiet recovery buffer, а не под ещё одну рабочую волну на фоне просадки ${focusLabel}.`
          : `Следующее спокойное окно ${nextSlot.date} ${nextSlot.start}–${nextSlot.end} можно сразу занять recovery-buffer, если ${focusLabel} продолжит ехать.`,
      tone: signal.status === "critical" ? "bad" : "warn",
      action: {
        type: "protect-recovery",
        strategy: "create-event",
        date: nextSlot.date,
        start: nextSlot.start,
        end: nextSlot.end,
        title: "Recovery / quiet buffer",
        tone: "personal",
        tags: ["recovery", "protected", "intraday-rescue", "quiet-buffer"],
        metricKey: signal.focusMetricKey ?? topMetricKey,
      },
    });
  }

  const deferrableTask =
    tasks.find((task) => task.dueDate === today && task.priority !== "p1" && task.status === "active") ??
    tasks.find((task) => task.dueDate === today && task.status === "inbox") ??
    null;

  if (deferrableTask) {
    hints.push({
      id: `task-${deferrableTask.id}`,
      title: "Вынести один хвост из сегодня",
      detail: `${shortenLabel(deferrableTask.title)} лучше не держать в остатке дня: перенеси или преврати в soft task, чтобы не усиливать drift по ${focusLabel}.`,
      tone: signal.status === "critical" ? "bad" : "warn",
      action: {
        type: "move-task",
        taskId: deferrableTask.id,
        title: deferrableTask.title,
        dueDate: resolveAutopilotTaskDate(topMetricKey, deferrableTask.priority),
      },
    });
  }

  if (signal.trainingCountToday > 0 || signal.mealCountToday > 1) {
    hints.push({
      id: "recovery-buffer",
      title: "Оставить тихий recovery-буфер",
      detail:
        signal.trainingCountToday > 0
          ? `После тренировки не добавляй вторую рабочую волну: лучше оставить quiet buffer на воду, шаги и нормализацию ${focusLabel}.`
          : `После плотных приёмов пищи лучше оставить короткий quiet buffer, а не добивать день новыми переключениями, пока едет ${focusLabel}.`,
      tone: "warn",
    });
  }

  return hints.slice(0, 3);
}

function createHeysOrigin(
  metricKey: MetricKey,
  via: AutomationOrigin["via"],
  extra?: Partial<AutomationOrigin>,
): AutomationOrigin {
  return {
    source: "heys",
    metricKey,
    via,
    ...extra,
  };
}

function toMetricKey(value: string | null | undefined): MetricKey | null {
  switch (value) {
    case "sleep":
    case "bedtime":
    case "steps":
    case "training":
    case "weight":
    case "mood":
    case "wellbeing":
    case "water":
    case "stress":
      return value;
    default:
      return null;
  }
}

function getMetricLabel(metricKey: MetricKey | null): string {
  switch (metricKey) {
    case "sleep":
      return "Сон";
    case "bedtime":
      return "Отход ко сну";
    case "steps":
      return "Шаги";
    case "training":
      return "Тренировки";
    case "weight":
      return "Вес";
    case "mood":
      return "Настроение";
    case "wellbeing":
      return "Самочувствие";
    case "water":
      return "Вода";
    case "stress":
      return "Стресс";
    default:
      return "HEYS";
  }
}

function getMetricEmoji(metricKey: MetricKey | null): string {
  switch (metricKey) {
    case "sleep":
      return "😴";
    case "bedtime":
      return "🌙";
    case "steps":
      return "🚶";
    case "training":
      return "🏋️";
    case "weight":
      return "⚖️";
    case "mood":
      return "😊";
    case "wellbeing":
      return "💪";
    case "water":
      return "💧";
    case "stress":
      return "🧘";
    default:
      return "🫀";
  }
}

function getViaLabel(via: AutomationOrigin["via"] | undefined): string {
  if (via === "autopilot") return "автопилот";
  if (via === "slot") return "слот";
  return "задача";
}

function getActionKindLabel(actionKind: "task" | "slot"): string {
  return actionKind === "slot" ? "защищённые окна" : "конкретные задачи";
}

function getActionKindShortLabel(actionKind: "task" | "slot"): string {
  return actionKind === "slot" ? "слоты" : "задачи";
}

function getBundlePartLabel(item: CompoundActionItem): string {
  return `${getMetricEmoji(item.metricKey)} ${getMetricLabel(item.metricKey)} · ${getActionKindShortLabel(item.kind)}`;
}

function getCompoundActionBundles(): CompoundActionBundle[] {
  return [
    {
      id: "sleep-hydration-reset",
      label: "Сон + вода",
      summary: "Поздний ритм и recovery часто лучше выправлять не одной кнопкой, а связкой bedtime protection + hydration checkpoint.",
      appliesTo: ["sleep", "bedtime", "water"],
      items: [
        { id: "bedtime-slot", metricKey: "bedtime", kind: "slot" },
        { id: "water-slot", metricKey: "water", kind: "slot" },
      ],
    },
    {
      id: "movement-recovery-pair",
      label: "Walking window + recovery",
      summary: "Когда база просела, движение и recovery вместе обычно работают лучше, чем героическая попытка лечить всё одной привычкой.",
      appliesTo: ["steps", "wellbeing", "stress", "training"],
      items: [
        { id: "steps-slot", metricKey: "steps", kind: "slot" },
        { id: "recovery-slot", metricKey: "wellbeing", kind: "slot" },
      ],
    },
    {
      id: "review-shutdown-pair",
      label: "Review + shutdown",
      summary: "Для настроения и нервной системы часто важнее не ещё одна задача, а связка короткого review и защищённого раннего shutdown.",
      appliesTo: ["mood"],
      items: [
        { id: "mood-task", metricKey: "mood", kind: "task" },
        { id: "bedtime-slot", metricKey: "bedtime", kind: "slot" },
      ],
    },
    {
      id: "weight-rhythm-pair",
      label: "Контур веса: шаги + контур",
      summary: "Для веса чаще полезнее мягкая связка ритма, а не очередной жёсткий one-shot — движение плюс контур питания/сна.",
      appliesTo: ["weight"],
      items: [
        { id: "weight-task", metricKey: "weight", kind: "task" },
        { id: "steps-slot", metricKey: "steps", kind: "slot" },
      ],
    },
  ];
}

function getRecommendedCompoundAction(metricKey: MetricKey): CompoundActionBundle | null {
  return getCompoundActionBundles().find((bundle) => bundle.appliesTo.includes(metricKey)) ?? null;
}

function scoreCompoundActionBundle(
  bundle: CompoundActionBundle,
  metricKey: MetricKey,
  context: BundleContextProfile,
  learning: LearnedBundleStat | null,
  dayMode: DayMode,
): CompoundBundleChoice {
  let score = 4;
  const reasons: string[] = [];

  if (learning) {
    score += Math.max(-2, Math.min(4, learning.score));
    if (learning.improved > 0) {
      reasons.push(`история ${learning.improved}/${learning.resolved}`);
    }
  }

  if (dayMode.bundleBiasIds.includes(bundle.id)) {
    score += dayMode.id === "damage-control" ? 3 : dayMode.id === "recovery" ? 2 : 1;
    reasons.push(
      dayMode.id === "damage-control"
        ? "под emergency-режим"
        : dayMode.id === "recovery"
          ? "под recovery-режим"
          : dayMode.id === "execution"
            ? "не ломает execution"
            : "держит мягкий ритм",
    );
  }

  switch (bundle.id) {
    case "sleep-hydration-reset":
      if (["sleep", "bedtime", "water"].includes(metricKey)) score += 3;
      if (context.isEvening || context.isLateEvening) {
        score += 3;
        reasons.push("вечернее окно");
      }
      if (context.dayLoad >= 9 || context.cleanup > 0 || context.parties > 0) {
        score += 2;
        reasons.push("день плотный");
      }
      if (context.isMorning) score -= 1;
      break;
    case "movement-recovery-pair":
      if (["steps", "wellbeing", "stress", "training"].includes(metricKey)) score += 3;
      if (context.isMorning || context.isDaytime) {
        score += 2;
        reasons.push("можно встроить движение днём");
      }
      if (context.dayLoad >= 10 || context.parties > 0) {
        score -= 2;
      }
      if (context.cleanup > 0) score -= 1;
      break;
    case "review-shutdown-pair":
      if (metricKey === "mood" || metricKey === "stress" || metricKey === "bedtime") score += 3;
      if (context.isEvening || context.isLateEvening) {
        score += 3;
        reasons.push("время мягко закрыть день");
      }
      if (context.dayLoad >= 8) {
        score += 1;
        reasons.push("много шума за день");
      }
      if (context.isMorning) score -= 2;
      break;
    case "weight-rhythm-pair":
      if (metricKey === "weight") score += 4;
      if (context.isDaytime || context.isMorning) {
        score += 1;
      }
      if (context.dayLoad <= 7 && context.tomorrowLoad <= 9) {
        score += 2;
        reasons.push("есть шанс стабилизировать ритм");
      }
      if (context.parties > 1 || context.cleanup > 0) score -= 2;
      break;
  }

  if (dayMode.id === "damage-control") {
    if (bundle.id === "weight-rhythm-pair") score -= 3;
    if (bundle.id === "movement-recovery-pair" && context.dayLoad >= 10) score -= 1;
  }

  if (dayMode.id === "recovery") {
    if (bundle.id === "weight-rhythm-pair") score -= 2;
    if (bundle.id === "review-shutdown-pair" && !context.isEvening && !context.isLateEvening) {
      score -= 1;
    }
  }

  if (dayMode.id === "execution") {
    if (bundle.id === "sleep-hydration-reset" && !context.isEvening && !context.isLateEvening) {
      score -= 1;
    }
    if (bundle.id === "review-shutdown-pair" && context.isMorning) score -= 2;
  }

  if (context.isWeekend && bundle.id === "sleep-hydration-reset") {
    score += 1;
    reasons.push("выходной recovery");
  }

  if (context.isLateEvening && bundle.id !== "sleep-hydration-reset" && bundle.id !== "review-shutdown-pair") {
    score -= 1;
  }

  return {
    bundle,
    score,
    reasons: reasons.slice(0, 3),
    learning,
  };
}

function getRankedCompoundActionBundles(
  metricKey: MetricKey,
  context: BundleContextProfile,
  stats: LearnedBundleStat[],
  dayMode: DayMode,
): CompoundBundleChoice[] {
  return getCompoundActionBundles()
    .filter((bundle) => bundle.appliesTo.includes(metricKey))
    .map((bundle) =>
      scoreCompoundActionBundle(
        bundle,
        metricKey,
        context,
        getPreferredBundleStat(bundle.id, stats),
        dayMode,
      ),
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        (right.learning?.improved ?? 0) - (left.learning?.improved ?? 0),
    );
}

function makeBundleRunId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `bundle-${crypto.randomUUID()}`;
  }

  return `bundle-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildBundleLearningStats(
  tasks: Task[],
  events: CustomEvent[],
  days: HeysDayRecord[],
  weightGoal: number | null | undefined,
): LearnedBundleStat[] {
  const bundleLabels = new Map(
    getCompoundActionBundles().map((bundle) => [bundle.id, bundle.label]),
  );
  const runs = new Map<
    string,
    { bundleId: string; improved: number; worse: number; flat: number; pending: number }
  >();

  const pushRunImpact = (bundleId: string | undefined, bundleRunId: string | undefined, impact: ImpactEvaluation) => {
    if (!bundleId || !bundleRunId) return;

    const current = runs.get(bundleRunId) ?? {
      bundleId,
      improved: 0,
      worse: 0,
      flat: 0,
      pending: 0,
    };

    if (impact.kind === "improved") current.improved += 1;
    else if (impact.kind === "worse") current.worse += 1;
    else if (impact.kind === "flat") current.flat += 1;
    else current.pending += 1;

    runs.set(bundleRunId, current);
  };

  tasks
    .filter((task) => task.origin?.source === "heys" && task.origin?.bundleId)
    .forEach((task) => {
      const metricKey = toMetricKey(task.origin?.metricKey);
      if (!metricKey) return;

      pushRunImpact(
        task.origin?.bundleId,
        task.origin?.bundleRunId,
        evaluateTraceImpactForTask(task, metricKey, days, weightGoal),
      );
    });

  events
    .filter((event) => event.origin?.source === "heys" && event.origin?.bundleId)
    .forEach((event) => {
      const metricKey = extractMetricKeyFromEvent(event);
      if (!metricKey) return;

      pushRunImpact(
        event.origin?.bundleId,
        event.origin?.bundleRunId,
        evaluateTraceImpactForEvent(event, metricKey, days, weightGoal),
      );
    });

  const aggregate = new Map<string, LearnedBundleStat>();

  for (const run of runs.values()) {
    const current = aggregate.get(run.bundleId) ?? {
      id: run.bundleId,
      label: bundleLabels.get(run.bundleId) ?? run.bundleId,
      improved: 0,
      worse: 0,
      flat: 0,
      pending: 0,
      resolved: 0,
      score: 0,
      confidence: "low",
    };

    if (run.improved > run.worse && run.improved > 0) {
      current.improved += 1;
      current.resolved += 1;
    } else if (run.worse > run.improved && run.worse > 0) {
      current.worse += 1;
      current.resolved += 1;
    } else if (run.improved === 0 && run.worse === 0 && run.flat === 0) {
      current.pending += 1;
    } else {
      current.flat += 1;
      current.resolved += 1;
    }

    aggregate.set(run.bundleId, current);
  }

  return [...aggregate.values()]
    .map((bucket) => {
      const score = bucket.improved * 3 - bucket.worse * 2 - bucket.flat;
      const confidence: LearnedBundleStat["confidence"] =
        bucket.resolved >= 3 ? "high" : bucket.resolved >= 2 ? "medium" : "low";

      return {
        ...bucket,
        score,
        confidence,
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.improved - left.improved ||
        right.resolved - left.resolved,
    );
}

function getPreferredBundleStat(
  bundleId: string | undefined,
  stats: LearnedBundleStat[],
): LearnedBundleStat | null {
  if (!bundleId) return null;
  return stats.find((stat) => stat.id === bundleId) ?? null;
}

function isLateSleepStart(value: string | null): boolean {
  const hour = parseSleepStartToHour(value);
  return hour != null && hour >= 25;
}

function averageFromDays(
  days: HeysDayRecord[],
  selector: (day: HeysDayRecord) => number | null | undefined,
): number | null {
  const values = days
    .map(selector)
    .filter((value): value is number => value != null && Number.isFinite(value));

  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageNumbers(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sumNumbers(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

function dateDiffDays(laterDateKey: string, earlierDateKey: string): number {
  const later = new Date(`${laterDateKey}T00:00:00`).getTime();
  const earlier = new Date(`${earlierDateKey}T00:00:00`).getTime();
  return Math.round((later - earlier) / 86_400_000);
}

function dateKeyFromTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function getImpactConfig(metricKey: MetricKey): ImpactConfig {
  switch (metricKey) {
    case "sleep":
      return {
        direction: "higher",
        mode: "avg",
        threshold: 0.4,
        beforeCount: 3,
        afterCount: 2,
        minBefore: 1,
        minAfter: 1,
        waitDays: 2,
        getValue: (day) => day.sleepHours,
        formatChange: (rawDelta) => `${rawDelta >= 0 ? "+" : ""}${fmtNum(rawDelta)}ч сна`,
        formatValue: (value) => `${fmtNum(value)}ч`,
        windowLabel: "смотрим 3 дня до / 2 дня после",
      };
    case "bedtime":
      return {
        direction: "lower",
        mode: "avg",
        threshold: 0.25,
        beforeCount: 3,
        afterCount: 2,
        minBefore: 1,
        minAfter: 1,
        waitDays: 2,
        getValue: (day) => parseSleepStartToHour(day.sleepStart),
        formatChange: (rawDelta, outcome) => {
          const minutes = Math.round(Math.abs(rawDelta) * 60);
          if (outcome === "improved") return `${minutes} мин раньше`;
          if (outcome === "worse") return `${minutes} мин позже`;
          return `≈ ${minutes} мин без сдвига`;
        },
        formatValue: (value) => fmtClock(value),
        windowLabel: "смотрим 3 дня до / 2 дня после",
      };
    case "steps":
      return {
        direction: "higher",
        mode: "avg",
        threshold: 800,
        beforeCount: 3,
        afterCount: 2,
        minBefore: 1,
        minAfter: 1,
        waitDays: 2,
        getValue: (day) => day.steps,
        formatChange: (rawDelta) => `${rawDelta >= 0 ? "+" : ""}${fmtNum(rawDelta, 0)} шагов`,
        formatValue: (value) => `${fmtNum(value, 0)} шагов`,
        windowLabel: "смотрим 3 дня до / 2 дня после",
      };
    case "training":
      return {
        direction: "higher",
        mode: "sum",
        threshold: 1,
        beforeCount: 7,
        afterCount: 7,
        minBefore: 3,
        minAfter: 3,
        waitDays: 7,
        getValue: (day) => day.trainingCount,
        formatChange: (rawDelta) => `${rawDelta >= 0 ? "+" : ""}${fmtNum(rawDelta, 0)} трен. сессии`,
        formatValue: (value) => `${fmtNum(value, 0)} сессии`,
        windowLabel: "смотрим неделю до / после",
      };
    case "weight":
      return {
        direction: "lower",
        mode: "avg",
        threshold: 0.3,
        beforeCount: 7,
        afterCount: 7,
        minBefore: 3,
        minAfter: 3,
        waitDays: 7,
        getValue: (day, weightGoal) =>
          day.weightMorning != null && weightGoal != null
            ? Math.abs(day.weightMorning - weightGoal)
            : null,
        formatChange: (rawDelta, outcome) => {
          if (outcome === "improved") return `${fmtNum(Math.abs(rawDelta))} кг ближе к цели`;
          if (outcome === "worse") return `${fmtNum(Math.abs(rawDelta))} кг дальше от цели`;
          return `≈ ${fmtNum(Math.abs(rawDelta))} кг без сдвига`;
        },
        formatValue: (value) => `${fmtNum(value)} кг до цели`,
        windowLabel: "смотрим неделю до / после",
      };
    case "mood":
      return {
        direction: "higher",
        mode: "avg",
        threshold: 0.4,
        beforeCount: 3,
        afterCount: 2,
        minBefore: 1,
        minAfter: 1,
        waitDays: 2,
        getValue: (day) => day.moodAvg ?? day.moodMorning,
        formatChange: (rawDelta) => `${rawDelta >= 0 ? "+" : ""}${fmtNum(rawDelta)} к настроению`,
        formatValue: (value) => `${fmtNum(value)}/10`,
        windowLabel: "смотрим 3 дня до / 2 дня после",
      };
    case "wellbeing":
      return {
        direction: "higher",
        mode: "avg",
        threshold: 0.4,
        beforeCount: 3,
        afterCount: 2,
        minBefore: 1,
        minAfter: 1,
        waitDays: 2,
        getValue: (day) => day.wellbeingAvg ?? day.wellbeingMorning,
        formatChange: (rawDelta) => `${rawDelta >= 0 ? "+" : ""}${fmtNum(rawDelta)} к самочувствию`,
        formatValue: (value) => `${fmtNum(value)}/10`,
        windowLabel: "смотрим 3 дня до / 2 дня после",
      };
    case "water":
      return {
        direction: "higher",
        mode: "avg",
        threshold: 250,
        beforeCount: 3,
        afterCount: 2,
        minBefore: 1,
        minAfter: 1,
        waitDays: 2,
        getValue: (day) => day.waterMl,
        formatChange: (rawDelta) => `${rawDelta >= 0 ? "+" : ""}${fmtNum(rawDelta, 0)} мл`,
        formatValue: (value) => `${fmtNum(value, 0)} мл`,
        windowLabel: "смотрим 3 дня до / 2 дня после",
      };
    case "stress":
      return {
        direction: "lower",
        mode: "avg",
        threshold: 0.4,
        beforeCount: 3,
        afterCount: 2,
        minBefore: 1,
        minAfter: 1,
        waitDays: 2,
        getValue: (day) => day.stressAvg ?? day.stressMorning,
        formatChange: (rawDelta, outcome) => {
          if (outcome === "improved") return `${fmtNum(Math.abs(rawDelta))} меньше стресса`;
          if (outcome === "worse") return `${fmtNum(Math.abs(rawDelta))} больше стресса`;
          return `≈ ${fmtNum(Math.abs(rawDelta))} без сдвига`;
        },
        formatValue: (value) => `${fmtNum(value)}/10`,
        windowLabel: "смотрим 3 дня до / 2 дня после",
      };
  }
}

function evaluateImpactFromAnchor(
  metricKey: MetricKey,
  anchorDate: string,
  days: HeysDayRecord[],
  weightGoal: number | null | undefined,
): ImpactEvaluation {
  const config = getImpactConfig(metricKey);
  const latestDate = days[days.length - 1]?.date;

  if (!latestDate) {
    return {
      kind: "no-data",
      label: "нет данных",
      detail: "HEYS ещё не вернул достаточно данных для проверки эффекта.",
      tone: "neutral",
    };
  }

  const beforeValues = days
    .filter((day) => day.date < anchorDate)
    .map((day) => config.getValue(day, weightGoal))
    .filter((value): value is number => value != null && Number.isFinite(value))
    .slice(-config.beforeCount);

  const afterValues = days
    .filter((day) => day.date > anchorDate)
    .map((day) => config.getValue(day, weightGoal))
    .filter((value): value is number => value != null && Number.isFinite(value))
    .slice(0, config.afterCount);

  if (afterValues.length < config.minAfter) {
    if (dateDiffDays(latestDate, anchorDate) < config.waitDays) {
      return {
        kind: "pending",
        label: config.waitDays >= 7 ? "ждём недельный сигнал" : "ждём 24–48ч",
        detail: `После действия ещё слишком рано судить об эффекте — ${config.windowLabel}.`,
        tone: "neutral",
      };
    }

    return {
      kind: "no-data",
      label: "нет свежих check-in",
      detail: `После действия не хватает точек по метрике «${getMetricLabel(metricKey)}».`,
      tone: "neutral",
    };
  }

  if (beforeValues.length < config.minBefore) {
    return {
      kind: "no-data",
      label: "нет baseline",
      detail: `До действия мало исторических точек, поэтому сравнение пока шумное.`,
      tone: "neutral",
    };
  }

  const beforeAggregate =
    config.mode === "sum" ? sumNumbers(beforeValues) : averageNumbers(beforeValues);
  const afterAggregate =
    config.mode === "sum" ? sumNumbers(afterValues) : averageNumbers(afterValues);

  if (beforeAggregate == null || afterAggregate == null) {
    return {
      kind: "no-data",
      label: "нет сигнала",
      detail: `Недостаточно данных, чтобы оценить сдвиг по «${getMetricLabel(metricKey)}».`,
      tone: "neutral",
    };
  }

  const rawDelta = afterAggregate - beforeAggregate;
  const directionalDelta = config.direction === "higher" ? rawDelta : -rawDelta;

  if (Math.abs(directionalDelta) < config.threshold) {
    return {
      kind: "flat",
      label: "без заметного сдвига",
      detail: `${config.windowLabel} · было ${config.formatValue(beforeAggregate)} → стало ${config.formatValue(afterAggregate)}.`,
      tone: "neutral",
    };
  }

  const outcome = directionalDelta > 0 ? "improved" : "worse";

  return {
    kind: outcome,
    label: config.formatChange(rawDelta, outcome),
    detail: `${config.windowLabel} · было ${config.formatValue(beforeAggregate)} → стало ${config.formatValue(afterAggregate)}.`,
    tone: outcome === "improved" ? "good" : "bad",
  };
}

function evaluateTraceImpactForTask(
  task: Task,
  metricKey: MetricKey | null,
  days: HeysDayRecord[],
  weightGoal: number | null | undefined,
): ImpactEvaluation {
  if (!metricKey) {
    return {
      kind: "no-data",
      label: "метрика не определена",
      detail: "Для этой задачи пока не удалось однозначно определить связанный сигнал HEYS.",
      tone: "neutral",
    };
  }

  if (task.status !== "done") {
    const isOverdue = !!task.dueDate && task.dueDate < todayDateKey();
    return {
      kind: "needs-completion",
      label: isOverdue ? "ждёт выполнения" : "ещё не выполнено",
      detail: "Сначала нужно завершить задачу, и только потом HEYS сможет показать отклик по этой метрике.",
      tone: isOverdue ? "warn" : "neutral",
    };
  }

  const anchorDate = dateKeyFromTimestamp(
    new Date(task.completedAt ?? task.createdAt).getTime(),
  );

  return evaluateImpactFromAnchor(metricKey, anchorDate, days, weightGoal);
}

function evaluateTraceImpactForEvent(
  event: CustomEvent,
  metricKey: MetricKey | null,
  days: HeysDayRecord[],
  weightGoal: number | null | undefined,
): ImpactEvaluation {
  if (!metricKey) {
    return {
      kind: "no-data",
      label: "метрика не определена",
      detail: "Для этого слота пока не удалось однозначно определить связанный сигнал HEYS.",
      tone: "neutral",
    };
  }

  const endTimestamp = new Date(`${event.date}T${event.end}:00`).getTime();

  if (Date.now() < endTimestamp) {
    return {
      kind: "pending",
      label: "слот впереди",
      detail: "Слот ещё не прошёл, поэтому оценивать эффект рано.",
      tone: "neutral",
    };
  }

  return evaluateImpactFromAnchor(metricKey, event.date, days, weightGoal);
}

function buildCorrelationInsights(
  days: HeysDayRecord[],
  profileStepsGoal: number | null | undefined,
  sleepGoal: number | null | undefined,
): CorrelationInsight[] {
  const candidates: Array<CorrelationInsight & { score: number }> = [];

  const lateDays = days.filter((day) => isLateSleepStart(day.sleepStart));
  const earlyDays = days.filter(
    (day) => day.sleepStart != null && !isLateSleepStart(day.sleepStart),
  );
  const lateWellbeing = averageFromDays(
    lateDays,
    (day) => day.wellbeingAvg ?? day.wellbeingMorning,
  );
  const earlyWellbeing = averageFromDays(
    earlyDays,
    (day) => day.wellbeingAvg ?? day.wellbeingMorning,
  );

  if (
    lateDays.length >= 2 &&
    earlyDays.length >= 2 &&
    lateWellbeing != null &&
    earlyWellbeing != null
  ) {
    const delta = earlyWellbeing - lateWellbeing;
    if (delta >= 0.4) {
      candidates.push({
        id: "bedtime-vs-wellbeing",
        metricKey: "bedtime",
        title: `До 01:00 самочувствие выше на ${fmtNum(delta)}`,
        detail: `В более ранние дни среднее самочувствие ${fmtNum(earlyWellbeing)}/10 против ${fmtNum(lateWellbeing)}/10 после 01:00.`,
        tone: "good",
        score: delta + 0.3,
      });
    }
  }

  const sleepThreshold = Math.max((sleepGoal ?? 8) - 0.5, 6.5);
  const enoughSleepDays = days.filter((day) => (day.sleepHours ?? 0) >= sleepThreshold);
  const shortSleepDays = days.filter(
    (day) => day.sleepHours != null && day.sleepHours < sleepThreshold,
  );
  const enoughSleepMood = averageFromDays(
    enoughSleepDays,
    (day) => day.moodAvg ?? day.moodMorning,
  );
  const shortSleepMood = averageFromDays(
    shortSleepDays,
    (day) => day.moodAvg ?? day.moodMorning,
  );

  if (
    enoughSleepDays.length >= 2 &&
    shortSleepDays.length >= 2 &&
    enoughSleepMood != null &&
    shortSleepMood != null
  ) {
    const delta = enoughSleepMood - shortSleepMood;
    if (delta >= 0.4) {
      candidates.push({
        id: "sleep-vs-mood",
        metricKey: "sleep",
        title: `Сон даёт +${fmtNum(delta)} к настроению`,
        detail: `Когда сна хотя бы ${fmtNum(sleepThreshold)}ч, настроение в среднем ${fmtNum(enoughSleepMood)}/10 против ${fmtNum(shortSleepMood)}/10 при более коротких ночах.`,
        tone: "good",
        score: delta,
      });
    }
  }

  const stepsThreshold = Math.max(5000, Math.round((profileStepsGoal ?? 7000) * 0.85));
  const activeDays = days.filter((day) => (day.steps ?? 0) >= stepsThreshold);
  const lowMovementDays = days.filter(
    (day) => day.steps != null && day.steps < stepsThreshold,
  );
  const activeStress = averageFromDays(
    activeDays,
    (day) => day.stressAvg ?? day.stressMorning,
  );
  const lowMovementStress = averageFromDays(
    lowMovementDays,
    (day) => day.stressAvg ?? day.stressMorning,
  );

  if (
    activeDays.length >= 2 &&
    lowMovementDays.length >= 2 &&
    activeStress != null &&
    lowMovementStress != null
  ) {
    const delta = lowMovementStress - activeStress;
    if (delta >= 0.4) {
      candidates.push({
        id: "steps-vs-stress",
        metricKey: "steps",
        title: `Шаги снимают около ${fmtNum(delta)} стресса`,
        detail: `Когда шагов хотя бы ${stepsThreshold}, средний стресс ${fmtNum(activeStress)}/10 против ${fmtNum(lowMovementStress)}/10 в малоподвижные дни.`,
        tone: "good",
        score: delta,
      });
    }
  }

  const hydratedDays = days.filter((day) => (day.waterMl ?? 0) >= 1800);
  const lowWaterDays = days.filter((day) => day.waterMl != null && day.waterMl < 1800);
  const hydratedWellbeing = averageFromDays(
    hydratedDays,
    (day) => day.wellbeingAvg ?? day.wellbeingMorning,
  );
  const lowWaterWellbeing = averageFromDays(
    lowWaterDays,
    (day) => day.wellbeingAvg ?? day.wellbeingMorning,
  );

  if (
    hydratedDays.length >= 2 &&
    lowWaterDays.length >= 2 &&
    hydratedWellbeing != null &&
    lowWaterWellbeing != null
  ) {
    const delta = hydratedWellbeing - lowWaterWellbeing;
    if (delta >= 0.4) {
      candidates.push({
        id: "water-vs-wellbeing",
        metricKey: "water",
        title: `Вода возвращает +${fmtNum(delta)} к самочувствию`,
        detail: `При гидрации 1800+ мл среднее самочувствие ${fmtNum(hydratedWellbeing)}/10 против ${fmtNum(lowWaterWellbeing)}/10 в сухие дни.`,
        tone: "good",
        score: delta,
      });
    }
  }

  return candidates
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map(({ score: _score, ...insight }) => insight);
}

function extractMetricKeyFromEvent(event: CustomEvent): MetricKey | null {
  const originMetric = toMetricKey(event.origin?.metricKey);
  if (originMetric) return originMetric;

  for (const tag of event.tags) {
    const metricKey = toMetricKey(tag);
    if (metricKey) return metricKey;
  }

  return null;
}

function parseEventCreatedAt(event: CustomEvent): number {
  if (event.createdAt) {
    const parsed = new Date(event.createdAt).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }

  const match = event.id.match(/^custom-([0-9a-z]+)$/i);
  if (match?.[1]) {
    const decoded = Number.parseInt(match[1], 36);
    if (Number.isFinite(decoded)) return decoded;
  }

  return new Date(`${event.date}T${event.start}:00`).getTime();
}

function getTraceStatusForTask(task: Task): {
  label: string;
  tone: MetricStatus | "neutral";
} {
  if (task.status === "done") return { label: "выполнено", tone: "good" };
  if (task.status === "active") {
    if (task.dueDate && task.dueDate < todayDateKey()) {
      return { label: "просрочено", tone: "bad" };
    }

    return { label: "в работе", tone: "warn" };
  }

  return { label: "в inbox", tone: "neutral" };
}

function getTraceStatusForEvent(event: CustomEvent): {
  label: string;
  tone: MetricStatus | "neutral";
} {
  const now = Date.now();
  const start = new Date(`${event.date}T${event.start}:00`).getTime();
  const end = new Date(`${event.date}T${event.end}:00`).getTime();

  if (now < start) return { label: "в календаре", tone: "good" };
  if (now <= end) return { label: "идёт сейчас", tone: "good" };
  return { label: "окно прошло", tone: "neutral" };
}

function buildTraceItems(
  tasks: Task[],
  events: CustomEvent[],
  days: HeysDayRecord[],
  weightGoal: number | null | undefined,
): TraceItem[] {
  const taskItems = tasks
    .filter((task) => task.origin?.source === "heys")
    .map((task) => {
      const metricKey = toMetricKey(task.origin?.metricKey);
      const status = getTraceStatusForTask(task);
      const impact = evaluateTraceImpactForTask(task, metricKey, days, weightGoal);

      return {
        id: `task-${task.id}`,
        kind: "task" as const,
        title: task.title,
        subtitle: `${getMetricEmoji(metricKey)} ${getMetricLabel(metricKey)} · ${getViaLabel(task.origin?.via)}${task.dueDate ? ` · ${formatDateLabel(task.dueDate)}` : ""}`,
        statusLabel: status.label,
        statusTone: status.tone,
        impact,
        metricKey,
        createdAt: new Date(task.createdAt).getTime(),
      };
    });

  const slotItems = events
    .filter((event) => event.origin?.source === "heys" || event.tags.includes("heys-action"))
    .map((event) => {
      const metricKey = extractMetricKeyFromEvent(event);
      const status = getTraceStatusForEvent(event);
      const impact = evaluateTraceImpactForEvent(event, metricKey, days, weightGoal);

      return {
        id: `slot-${event.id}`,
        kind: "slot" as const,
        title: event.title,
        subtitle: `${getMetricEmoji(metricKey)} ${getMetricLabel(metricKey)} · ${getViaLabel(event.origin?.via ?? "slot")} · ${formatDateLabel(event.date)} · ${event.start}`,
        statusLabel: status.label,
        statusTone: status.tone,
        impact,
        metricKey,
        createdAt: parseEventCreatedAt(event),
      };
    });

  return [...slotItems, ...taskItems]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, 6);
}

function formatTraceTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function getWeekSlotLoadLabel(loadScore: number): {
  label: string;
  tone: MetricStatus | "neutral";
} {
  if (loadScore <= 4) return { label: "лёгкий день", tone: "good" };
  if (loadScore <= 8) return { label: "умеренно", tone: "warn" };
  return { label: "плотно", tone: "bad" };
}

function summarizeTraceImpact(items: TraceItem[]): {
  improved: number;
  worse: number;
  pending: number;
  flat: number;
} {
  return items.reduce(
    (acc, item) => {
      if (item.impact.kind === "improved") acc.improved += 1;
      else if (item.impact.kind === "worse") acc.worse += 1;
      else if (item.impact.kind === "flat") acc.flat += 1;
      else acc.pending += 1;
      return acc;
    },
    { improved: 0, worse: 0, pending: 0, flat: 0 },
  );
}

function buildLearningStats(
  tasks: Task[],
  events: CustomEvent[],
  days: HeysDayRecord[],
  weightGoal: number | null | undefined,
): LearnedActionStat[] {
  const buckets = new Map<
    string,
    Omit<LearnedActionStat, "score" | "confidence">
  >();

  const touchBucket = (metricKey: MetricKey, actionKind: "task" | "slot", impact: ImpactEvaluation) => {
    const id = `${metricKey}-${actionKind}`;
    const current = buckets.get(id) ?? {
      id,
      metricKey,
      actionKind,
      improved: 0,
      worse: 0,
      flat: 0,
      pending: 0,
      resolved: 0,
    };

    if (impact.kind === "improved") {
      current.improved += 1;
      current.resolved += 1;
    } else if (impact.kind === "worse") {
      current.worse += 1;
      current.resolved += 1;
    } else if (impact.kind === "flat") {
      current.flat += 1;
      current.resolved += 1;
    } else {
      current.pending += 1;
    }

    buckets.set(id, current);
  };

  tasks
    .filter((task) => task.origin?.source === "heys")
    .forEach((task) => {
      const metricKey = toMetricKey(task.origin?.metricKey);
      if (!metricKey) return;

      touchBucket(
        metricKey,
        "task",
        evaluateTraceImpactForTask(task, metricKey, days, weightGoal),
      );
    });

  events
    .filter((event) => event.origin?.source === "heys" || event.tags.includes("heys-action"))
    .forEach((event) => {
      const metricKey = extractMetricKeyFromEvent(event);
      if (!metricKey) return;

      touchBucket(
        metricKey,
        "slot",
        evaluateTraceImpactForEvent(event, metricKey, days, weightGoal),
      );
    });

  return [...buckets.values()]
    .map((bucket) => {
      const score = bucket.improved * 2 - bucket.worse * 2 - bucket.flat * 0.5;
      const confidence: LearnedActionStat["confidence"] =
        bucket.resolved >= 3 ? "high" : bucket.resolved >= 2 ? "medium" : "low";

      return {
        ...bucket,
        score,
        confidence,
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.improved - left.improved ||
        right.resolved - left.resolved,
    );
}

function getPreferredLearningForMetric(
  metricKey: MetricKey,
  stats: LearnedActionStat[],
): LearnedActionStat | null {
  return (
    stats.find(
      (stat) => stat.metricKey === metricKey && stat.resolved > 0 && stat.score > 0,
    ) ??
    stats.find(
      (stat) => stat.metricKey === metricKey && stat.improved > 0,
    ) ??
    null
  );
}

function getConfidenceLabel(confidence: LearnedActionStat["confidence"]): string {
  if (confidence === "high") return "уверенно";
  if (confidence === "medium") return "уже видно";
  return "пока тонко";
}

function getMetricActionPlan(metricKey: MetricKey): MetricActionPlan {
  switch (metricKey) {
    case "sleep":
      return {
        recommended: "slot",
        task: {
          title: "Защитить вечерний shutdown и сон",
          priority: "p1",
          success: "HEYS → задача: вечерний shutdown добавлен",
        },
        slot: {
          title: "🌙 Вечерний shutdown",
          tone: "personal",
          start: "23:15",
          end: "23:45",
          tags: ["heys", "heys-action", "sleep", "shutdown", "recovery"],
          success: "HEYS → слот: вечерний shutdown защищён в календаре",
        },
      };
    case "bedtime":
      return {
        recommended: "slot",
        task: {
          title: "Сдвинуть подготовку ко сну на 15 минут раньше",
          priority: "p1",
          success: "HEYS → задача: сдвиг засыпания добавлен",
        },
        slot: {
          title: "🌙 Подготовка ко сну",
          tone: "personal",
          start: "23:30",
          end: "23:55",
          tags: ["heys", "heys-action", "bedtime", "sleep"],
          success: "HEYS → слот: подготовка ко сну защищена",
        },
      };
    case "steps":
      return {
        recommended: "slot",
        task: {
          title: "Добавить 2 walking windows по 10–15 минут",
          priority: "p1",
          success: "HEYS → задача: walking windows добавлены",
        },
        slot: {
          title: "🚶 Walking window",
          tone: "health",
          start: "17:30",
          end: "17:50",
          tags: ["heys", "heys-action", "steps", "walk", "neat"],
          success: "HEYS → слот: walking window добавлен в календарь",
        },
      };
    case "training":
      return {
        recommended: "slot",
        task: {
          title: "Защитить тренировочный слот на неделе",
          priority: "p2",
          dueOffset: 1,
          success: "HEYS → задача: тренировочный слот добавлен",
        },
        slot: {
          title: "🏋️ Тренировка / движение",
          tone: "health",
          start: "18:30",
          end: "19:30",
          dateOffset: 1,
          tags: ["heys", "heys-action", "training", "movement"],
          success: "HEYS → слот: тренировочный блок защищён",
        },
      };
    case "weight":
      return {
        recommended: "task",
        task: {
          title: "Собрать мягкий контур: сон + шаги + еда",
          priority: "p2",
          success: "HEYS → задача: мягкий контур веса добавлен",
        },
        slot: {
          title: "⚖️ Контур веса / ужин без хаоса",
          tone: "review",
          start: "19:30",
          end: "19:50",
          tags: ["heys", "heys-action", "weight", "review"],
          success: "HEYS → слот: контур веса добавлен в календарь",
        },
      };
    case "mood":
      return {
        recommended: "task",
        task: {
          title: "Сделать короткий review и телесный reset",
          priority: "p2",
          success: "HEYS → задача: mood reset добавлен",
        },
        slot: {
          title: "😊 Review + reset",
          tone: "review",
          start: "20:45",
          end: "21:05",
          tags: ["heys", "heys-action", "mood", "review"],
          success: "HEYS → слот: review + reset защищён",
        },
      };
    case "wellbeing":
      return {
        recommended: "slot",
        task: {
          title: "Облегчить день и защитить recovery",
          priority: "p1",
          success: "HEYS → задача: recovery-защита добавлена",
        },
        slot: {
          title: "💪 Recovery block",
          tone: "personal",
          start: "20:30",
          end: "21:00",
          tags: ["heys", "heys-action", "wellbeing", "recovery"],
          success: "HEYS → слот: recovery block добавлен",
        },
      };
    case "water":
      return {
        recommended: "slot",
        task: {
          title: "Поставить 2 water checkpoints",
          priority: "p2",
          success: "HEYS → задача: water checkpoints добавлены",
        },
        slot: {
          title: "💧 Water checkpoint",
          tone: "health",
          start: "11:30",
          end: "11:40",
          tags: ["heys", "heys-action", "water", "hydration"],
          success: "HEYS → слот: water checkpoint добавлен",
        },
      };
    case "stress":
      return {
        recommended: "slot",
        task: {
          title: "Снизить шум и добавить recovery-слот",
          priority: "p1",
          success: "HEYS → задача: anti-stress действие добавлено",
        },
        slot: {
          title: "🧘 Recovery / снижение шума",
          tone: "personal",
          start: "16:30",
          end: "16:50",
          tags: ["heys", "heys-action", "stress", "recovery"],
          success: "HEYS → слот: anti-stress окно защищено",
        },
      };
    default:
      return {
        recommended: "task",
        task: {
          title: "Проверить сигнал HEYS и превратить его в действие",
          priority: "p2",
          success: "HEYS → задача добавлена",
        },
        slot: {
          title: "🫀 HEYS check",
          tone: "review",
          start: "20:00",
          end: "20:15",
          tags: ["heys", "heys-action"],
          success: "HEYS → слот добавлен",
        },
      };
  }
}

function getPrimaryActionState(h: HeysHealthSignals): {
  tone: "good" | "watch" | "critical";
  title: string;
  detail: string;
  hint: string;
} {
  const intraday = h.intraday;

  if (!h.hasRecentData) {
    return {
      tone: "watch",
      title: "Контур пока собирается",
      detail: "HEYS ещё не набрал достаточно свежих точек, чтобы уверенно ловить ритм.",
      hint: "Нужно хотя бы 3–4 дня свежих check-in, чтобы панель стала точнее.",
    };
  }

  if (
    intraday != null &&
    (intraday.momentum === "worsening" || intraday.momentum === "mixed") &&
    (intraday.status === "watch" || intraday.status === "critical")
  ) {
    return {
      tone: intraday.status === "critical" ? "critical" : "watch",
      title:
        intraday.status === "critical"
          ? "День уже уехал внутри дня"
          : "Нужно поймать live-сдвиг до вечера",
      detail: intraday.summary,
      hint:
        intraday.status === "critical"
          ? "Сразу режь остаток дня до одного мягкого узла, защити recovery-окно и не добавляй новый execution поверх drift’а."
          : "Подстрой ближайшие окна и убери лишнее до того, как фон окончательно испортит вечер и сон.",
    };
  }

  if (intraday?.momentum === "improving" && intraday.status === "good") {
    return {
      tone: "good",
      title: "Внутри дня фон уже выровнялся",
      detail: intraday.summary,
      hint: "Можно брать execution мягко и осознанно, но не тратить выровнявшийся фон на хаотичный дожим дня.",
    };
  }

  if (h.lateBedtimeRatio != null && h.lateBedtimeRatio > 0.7) {
    return {
      tone: "critical",
      title: "Главный рычаг — засыпание",
      detail: `${Math.round(h.lateBedtimeRatio * 100)}% дней уходят после 01:00, поэтому даже нормальные шаги и настроение работают вполсилы.`,
      hint: "Сдвигай подготовку ко сну на 15 минут раньше каждые 3 дня и держи 00:00 как hard stop.",
    };
  }

  if (h.stepsGoalRatio != null && h.stepsGoalRatio < 0.7) {
    return {
      tone: "watch",
      title: "Главный рычаг — NEAT / шаги",
      detail: `Сейчас только ${Math.round(h.stepsGoalRatio * 100)}% от цели по шагам — тело не добирает базового движения.`,
      hint: "Добавь 1–2 walking windows по 10–15 минут и не складывай всю активность в одну тренировку.",
    };
  }

  if ((h.wellbeingAvg ?? 10) < 6.5) {
    return {
      tone: "watch",
      title: "Главный рычаг — восстановление",
      detail: `Самочувствие ${fmtNum(h.wellbeingAvg)}/10 просело сильнее, чем настроение — база recovery держится неустойчиво.`,
      hint: "Сегодня лучше защищать мягкий ритм: сон, вода, прогулка и меньше героического дожима.",
    };
  }

  if ((h.waterAvg ?? 0) < 1500) {
    return {
      tone: "watch",
      title: "Главный рычаг — вода",
      detail: `Среднее ${fmtNum(h.waterAvg, 0)} мл/день — это уже может тихо бить по энергии и recovery.`,
      hint: "Поставь 2 опорные точки: стакан воды утром и отдельный water block после обеда.",
    };
  }

  return {
    tone: "good",
    title: "База держится",
    detail: "HEYS не показывает явной красной дыры — значит, главный фокус можно отдавать execution, не ломая ритм.",
    hint: "Удерживай сон и не давай позднему отходу снова стать нормой.",
  };
}

/* ── Main panel ── */

export function HeysHealthPanel() {
  const { signals: h, snapshot, loading, error, lastSynced, refresh } = useHeysSync();
  const [selectedMetricKey, setSelectedMetricKey] = useState<MetricKey | null>(null);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null);
  const [analysisExpanded, setAnalysisExpanded] = useState(false);
  const bundleContext = buildBundleContextProfile();
  const fallbackMetricKey = h ? getDefaultMetricKey(h) : "sleep";
  const previewDayMode = h
    ? getHeysDayMode(h, bundleContext, fallbackMetricKey, snapshot?.profile?.sleepHoursGoal)
    : null;
  const defaultMetricKey = previewDayMode?.focusMetricKey ?? fallbackMetricKey;

  useEffect(() => {
    setSelectedMetricKey((current) => current ?? defaultMetricKey);
  }, [defaultMetricKey]);

  useEffect(() => {
    if (!actionFeedback) return;

    const timeoutId = window.setTimeout(() => setActionFeedback(null), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [actionFeedback]);

  if (loading && !snapshot) {
    return (
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/20 p-4">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-600 border-t-sky-400" />
          Загрузка данных HEYS…
        </div>
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/20 p-3">
        <p className="text-xs text-zinc-500">HEYS недоступен</p>
      </div>
    );
  }

  if (!snapshot || !h) return null;

  const dayMode =
    previewDayMode ??
    getHeysDayMode(h, bundleContext, fallbackMetricKey, snapshot.profile?.sleepHoursGoal);

  const days = [...snapshot.days].sort((a, b) => a.date.localeCompare(b.date));
  const latestDayWithSleep = [...days].reverse().find((day) => day.sleepStart);

  // Sparkline data
  const sleepHoursSpark = extractSpark(days, "sleepHours");
  const sleepQualitySpark = extractSpark(days, "sleepQuality");
  const bedtimeSpark = extractBedtimeSpark(days);
  const stepsSpark = extractSpark(days, "steps");
  const trainingSpark = days.map((day) => ({ value: day.trainingCount, date: day.date }));
  const weightSpark = extractSpark(days, "weightMorning");
  const moodSpark = extractSpark(days, "moodAvg");
  const wellbeingSpark = extractSpark(days, "wellbeingAvg");
  const stressSpark = extractSpark(days, "stressAvg");
  const waterSpark = extractSpark(days, "waterMl");

  // Statuses
  const sleepStatus: "good" | "warn" | "bad" =
    (h.sleepQualityAvg ?? 10) < 4
      ? "bad"
      : (h.sleepQualityAvg ?? 10) < 6
        ? "warn"
        : "good";

  const stepsStatus: "good" | "warn" | "bad" =
    (h.stepsGoalRatio ?? 1) < 0.5
      ? "bad"
      : (h.stepsGoalRatio ?? 1) < 0.8
        ? "warn"
        : "good";

  const bedtimeStatus: "good" | "warn" | "bad" =
    (h.lateBedtimeRatio ?? 0) > 0.8
      ? "bad"
      : (h.lateBedtimeRatio ?? 0) > 0.5
        ? "warn"
        : "good";

  const weightDelta = h.weightDelta30d;
  const weightGoalDelta =
    h.weightCurrent != null && h.weightGoal != null
      ? h.weightCurrent - h.weightGoal
      : null;
  const weightStatus: "good" | "warn" | "bad" =
    weightGoalDelta != null && weightGoalDelta > 10
      ? "bad"
      : weightGoalDelta != null && weightGoalDelta > 5
        ? "warn"
        : "good";

  const moodStatus: "good" | "warn" | "bad" =
    (h.moodAvg ?? 10) < 5
      ? "bad"
      : (h.moodAvg ?? 10) < 7
        ? "warn"
        : "good";

  const wellbeingStatus: "good" | "warn" | "bad" =
    (h.wellbeingAvg ?? 10) < 5
      ? "bad"
      : (h.wellbeingAvg ?? 10) < 6.5
        ? "warn"
        : "good";
  const stressStatus: MetricStatus =
    (h.stressAvg ?? 0) > 5 ? "bad" : (h.stressAvg ?? 0) > 3 ? "warn" : "good";
  const intradaySignal = h.intraday;
  const intradayTone = intradaySignal ? intradayStatusToTone(intradaySignal.status) : "neutral";
  const intradayShifts = intradaySignal
    ? [intradaySignal.shifts.mood, intradaySignal.shifts.wellbeing, intradaySignal.shifts.stress].filter(
        (shift) => shift.delta != null,
      )
    : [];
  const actionState = getPrimaryActionState(h);
  const actionToneClass =
    actionState.tone === "critical"
      ? "border-rose-500/20 bg-rose-500/8"
      : actionState.tone === "watch"
        ? "border-amber-500/20 bg-amber-500/8"
        : "border-emerald-500/20 bg-emerald-500/8";
  const actionTextClass =
    actionState.tone === "critical"
      ? "text-rose-200"
      : actionState.tone === "watch"
        ? "text-amber-200"
        : "text-emerald-200";
  const monthLateRatio =
    snapshot.month.daysWithData > 0
      ? snapshot.month.lateBedtimeDays / snapshot.month.daysWithData
      : null;
  const tasks = getTasks();
  const customEvents = getCustomEvents();
  const metrics: MetricDefinition[] = [
    {
      key: "sleep",
      emoji: "😴",
      label: "Сон",
      value: fmtNum(h.sleepHoursAvg),
      unit: "ч / ночь",
      sub: `качество ${fmtNum(h.sleepQualityAvg)}/10`,
      sparkPoints: sleepHoursSpark,
      color: "violet",
      goal: snapshot.profile?.sleepHoursGoal,
      status: sleepStatus,
      drilldown: {
        summary:
          h.lateBedtimeRatio != null && h.lateBedtimeRatio > 0.7
            ? "По длительности сон выглядит терпимо, но ритм засыпания ломает recovery сильнее, чем кажется по часам."
            : (h.sleepQualityAvg ?? 10) < 5
              ? "Часов не катастрофически мало, но качество сна просело — тело не успевает по-настоящему восстановиться."
              : "Сон уже держит базу и даёт хороший фундамент для остального дня.",
        insight:
          latestDayWithSleep?.sleepHours != null
            ? `Последняя ночь: ${fmtNum(latestDayWithSleep.sleepHours)}ч${latestDayWithSleep.sleepQuality != null ? ` · качество ${fmtNum(latestDayWithSleep.sleepQuality)}/10` : ""}.`
            : "Последняя ночь пока не зафиксирована отдельно, поэтому ориентируемся по среднему ритму недели.",
        action:
          h.lateBedtimeRatio != null && h.lateBedtimeRatio > 0.7
            ? "Сейчас важнее не добирать ещё 20–30 минут сна утром, а стабилизировать более раннее засыпание вечером."
            : (h.sleepHoursAvg ?? 0) < ((snapshot.profile?.sleepHoursGoal ?? 8) - 0.5)
              ? "Увеличь защиту сна: меньше поздних work-slots и жёсткий stop по экрану вечером."
              : "Главная задача — не дать хорошему ритму снова расползтись из-за случайных срочностей.",
        stats: [
          {
            label: "Последняя ночь",
            value: latestDayWithSleep?.sleepHours != null ? `${fmtNum(latestDayWithSleep.sleepHours)}ч` : "—",
            sub: latestDayWithSleep?.sleepQuality != null ? `качество ${fmtNum(latestDayWithSleep.sleepQuality)}/10` : undefined,
            tone: sleepStatus,
          },
          {
            label: "7 дней",
            value: `${fmtNum(snapshot.week.avgSleepHours)}ч`,
            sub: `качество ${fmtNum(snapshot.week.avgSleepQuality)}/10`,
          },
          {
            label: "30 дней / цель",
            value: `${fmtNum(snapshot.month.avgSleepHours)}ч`,
            sub: `цель ${fmtNum(snapshot.profile?.sleepHoursGoal, 0)}ч`,
          },
        ],
      },
    },
    {
      key: "bedtime",
      emoji: "🌙",
      label: "Отход ко сну",
      value: fmtPct(h.lateBedtimeRatio),
      unit: "после 01:00",
      sub: latestDayWithSleep?.sleepStart ? `последний ${latestDayWithSleep.sleepStart}` : "ритм за 30 дней",
      sparkPoints: bedtimeSpark,
      color: bedtimeStatus === "bad" ? "rose" : bedtimeStatus === "warn" ? "amber" : "emerald",
      goal: 24,
      status: bedtimeStatus,
      drilldown: {
        summary:
          h.lateBedtimeRatio != null && h.lateBedtimeRatio > 0.8
            ? "Поздний отход ко сну — главный системный bottleneck: он режет качество сна, recovery и следующую энергию днём."
            : h.lateBedtimeRatio != null && h.lateBedtimeRatio > 0.5
              ? "Ритм сна уже плывёт: поздние отходы стали достаточно частыми, чтобы бить по устойчивости недели."
              : "Ритм засыпания пока в рабочем диапазоне — его важно просто не отдать обратно ночным дожимам.",
        insight:
          bedtimeSpark.length > 0
            ? `Средний отход за 30 дней около ${fmtClock(averageSpark(bedtimeSpark))}, последний — ${latestDayWithSleep?.sleepStart ?? "—"}.`
            : "Недостаточно точек, чтобы оценить ритм отхода ко сну.",
        action:
          h.lateBedtimeRatio != null && h.lateBedtimeRatio > 0.7
            ? "Самый выгодный шаг — сдвигать подготовку ко сну на 15 минут раньше каждые 3 дня и держать 00:00 как закрытие дня."
            : "Сохраняй текущий ритм и не позволяй поздним спринтам снова стать нормой.",
        stats: [
          {
            label: "Последний отход",
            value: latestDayWithSleep?.sleepStart ?? "—",
            sub: latestDayWithSleep?.sleepHours != null ? `${fmtNum(latestDayWithSleep.sleepHours)}ч сна` : undefined,
            tone: bedtimeStatus,
          },
          {
            label: "7 дней",
            value: fmtPct(h.lateBedtimeRatio),
            sub: "после 01:00",
          },
          {
            label: "30 дней / ориентир",
            value: fmtPct(monthLateRatio),
            sub: "лучше <20%",
          },
        ],
      },
    },
    {
      key: "steps",
      emoji: "🚶",
      label: "Шаги",
      value: fmtNum(h.stepsAvg, 0),
      unit: `/ ${snapshot.profile?.stepsGoal ?? "?"}`,
      sub: h.stepsGoalRatio != null ? `${Math.round(h.stepsGoalRatio * 100)}% от цели` : undefined,
      sparkPoints: stepsSpark,
      color: "emerald",
      goal: snapshot.profile?.stepsGoal,
      status: stepsStatus,
      drilldown: {
        summary:
          (h.stepsGoalRatio ?? 1) < 0.5
            ? "Базовое движение просело слишком сильно: это уже не про спорт, а про цену любой рабочей нагрузки для тела."
            : (h.stepsGoalRatio ?? 1) < 0.8
              ? "NEAT-активность ниже цели, поэтому даже при тренировках неделя ощущается тяжелее, чем должна."
              : "База движения держится и помогает телу не застаиваться между work-блоками.",
        insight:
          lastSparkValue(stepsSpark) != null
            ? `Последняя точка — ${fmtNum(lastSparkValue(stepsSpark), 0)} шагов; среднее за 30 дней — ${fmtNum(snapshot.month.avgSteps, 0)}.`
            : "Последний шаговый сигнал пока не зафиксирован отдельно.",
        action:
          (h.stepsGoalRatio ?? 1) < 0.7
            ? "Не пытайся закрыть всё одной прогулкой вечером: лучше 1–2 walking windows по 10–15 минут внутри дня."
            : "Сохраняй текущий ритм и не отдавай движение только тренировкам.",
        stats: [
          {
            label: "Последний день",
            value: lastSparkValue(stepsSpark) != null ? fmtNum(lastSparkValue(stepsSpark), 0) : "—",
            sub: "шагов",
            tone: stepsStatus,
          },
          {
            label: "7 дней",
            value: fmtNum(snapshot.week.avgSteps, 0),
            sub: fmtPct(h.stepsGoalRatio),
          },
          {
            label: "30 дней / цель",
            value: fmtNum(snapshot.month.avgSteps, 0),
            sub: `${snapshot.profile?.stepsGoal ?? "?"} шагов`,
          },
        ],
      },
    },
    {
      key: "training",
      emoji: "🏋️",
      label: "Тренировки",
      value: String(h.trainingDaysWeek),
      unit: "дн / нед",
      sub: `${snapshot.month.trainingDays} за 30 дней`,
      sparkPoints: trainingSpark,
      color: "emerald",
      status: h.trainingDaysWeek >= 3 ? "good" : h.trainingDaysWeek >= 1 ? "warn" : "bad",
      drilldown: {
        summary:
          h.trainingDaysWeek === 0
            ? "Тренировочный ритм исчез — база движения держится только на случайной активности."
            : h.trainingDaysWeek < 3
              ? "Тренировки есть, но ритм пока хрупкий и легко рассыпается от занятости недели."
              : "Ритм тренировок уже живой и поддерживает здоровье как систему, а не как случайный подвиг.",
        insight:
          `За 7 дней — ${h.trainingDaysWeek} тренировочных дня, за 30 дней — ${snapshot.month.trainingDays}.`,
        action:
          h.trainingDaysWeek < 3
            ? "Главная цель — не heroic session, а предсказуемый ритм 3–4 дней в неделю."
            : "Сохраняй ритм и не подменяй восстановление ещё одной лишней нагрузкой.",
        stats: [
          {
            label: "Последний день",
            value: String(lastSparkValue(trainingSpark) ?? 0),
            sub: "сессий",
            tone: h.trainingDaysWeek >= 3 ? "good" : h.trainingDaysWeek >= 1 ? "warn" : "bad",
          },
          {
            label: "7 дней",
            value: `${h.trainingDaysWeek}`,
            sub: "тренировочных дней",
          },
          {
            label: "30 дней / ритм",
            value: `${snapshot.month.trainingDays}`,
            sub: "норма 3–4 / нед",
          },
        ],
      },
    },
    {
      key: "weight",
      emoji: "⚖️",
      label: "Вес",
      value: fmtNum(h.weightCurrent, 1),
      unit: `кг → ${h.weightGoal ?? "?"}кг`,
      sub: weightDelta != null ? `${fmtSigned(weightDelta, 1, "кг")} / 30д` : undefined,
      sparkPoints: weightSpark,
      color: weightDelta != null && weightDelta < 0 ? "emerald" : "amber",
      goal: h.weightGoal,
      status: weightStatus,
      drilldown: {
        summary:
          weightDelta != null && weightDelta > 0.4
            ? "Вес двигается вверх, а значит тело, скорее всего, недобирает движения и recovery-предсказуемости."
            : weightDelta != null && weightDelta < -0.4
              ? "Вес уже смещается в нужную сторону — важно удержать ритм, а не сорваться в слишком жёсткий режим."
              : "Вес пока стоит почти на месте: здесь важнее стабильность ритма, чем разовые усилия.",
        insight:
          h.weightGoal != null && h.weightCurrent != null
            ? `До цели остаётся ${fmtSigned(h.weightCurrent - h.weightGoal, 1, "кг")}; 30-дневный вектор ${fmtSigned(weightDelta, 1, "кг")}.`
            : "Целевой вес ещё не определён, поэтому смотрим только на динамику.",
        action:
          weightDelta != null && weightDelta > 0
            ? "Лучший рычаг здесь — сон + шаги + спокойный дефицит, а не очередная попытка резко ужать систему."
            : "Сохраняй ритм и следи, чтобы улучшение не опиралось только на силу воли.",
        stats: [
          {
            label: "Последний замер",
            value: h.weightCurrent != null ? `${fmtNum(h.weightCurrent, 1)}кг` : "—",
            sub: h.weightGoal != null ? `цель ${fmtNum(h.weightGoal, 0)}кг` : undefined,
            tone: weightStatus,
          },
          {
            label: "30 дней",
            value: fmtSigned(weightDelta, 1, "кг"),
            sub: "изменение",
          },
          {
            label: "До цели",
            value:
              h.weightCurrent != null && h.weightGoal != null
                ? fmtSigned(h.weightCurrent - h.weightGoal, 1, "кг")
                : "—",
            sub: "текущий разрыв",
          },
        ],
      },
    },
    {
      key: "mood",
      emoji: "😊",
      label: "Настроение",
      value: fmtNum(h.moodAvg),
      unit: "/ 10",
      sub: buildIntradaySub(intradaySignal?.shifts.mood, intradaySignal),
      sparkPoints: moodSpark,
      color: "fuchsia",
      status: moodStatus,
      drilldown: {
        summary:
          (h.moodAvg ?? 10) < 6
            ? "Настроение заметно просело и уже само становится частью рабочей цены дня."
            : "Настроение остаётся рабочим; дальше важно смотреть, не проседает ли тело сильнее, чем голова.",
        insight:
          lastSparkValue(moodSpark) != null
            ? `Последняя точка — ${fmtNum(lastSparkValue(moodSpark))}/10; 30-дневное среднее ${fmtNum(snapshot.month.avgMood)}/10.`
            : "Последняя оценка настроения пока не зафиксирована.",
        action:
          (h.moodAvg ?? 10) < 7
            ? "Если настроение держится ниже 7/10, не пытайся лечить это только работой — добавь телесный ресурс и review."
            : "Настроение можно использовать как подушку для execution, но не путать её с бесконечным запасом ресурса.",
        stats: [
          {
            label: "Последняя точка",
            value: lastSparkValue(moodSpark) != null ? fmtNum(lastSparkValue(moodSpark)) : "—",
            sub: "/10",
            tone: moodStatus,
          },
          {
            label: "7 дней",
            value: fmtNum(snapshot.week.avgMood),
            sub: "среднее",
          },
          {
            label: "30 дней / ориентир",
            value: fmtNum(snapshot.month.avgMood),
            sub: "лучше ≥ 7/10",
          },
        ],
      },
    },
    {
      key: "wellbeing",
      emoji: "💪",
      label: "Самочувствие",
      value: fmtNum(h.wellbeingAvg),
      unit: "/ 10",
      sub: buildIntradaySub(intradaySignal?.shifts.wellbeing, intradaySignal),
      sparkPoints: wellbeingSpark,
      color: "teal",
      status: wellbeingStatus,
      drilldown: {
        summary:
          (h.wellbeingAvg ?? 10) < 6
            ? "Самочувствие ниже здоровой базы — это уже прямой сигнал, что тело не успевает переваривать текущий ритм."
            : (h.wellbeingAvg ?? 10) < 7
              ? "Самочувствие держится на тонкой границе: день ещё тянется, но цена уже заметна."
              : "Самочувствие выглядит устойчиво и даёт право на нормальный execution mode.",
        insight:
          lastSparkValue(wellbeingSpark) != null
            ? `Последняя точка — ${fmtNum(lastSparkValue(wellbeingSpark))}/10; настроение ${fmtNum(h.moodAvg)}/10 и стресс ${fmtNum(h.stressAvg)}/10 помогают понять контекст.`
            : "Последний сигнал самочувствия пока не зафиксирован отдельно.",
        action:
          (h.wellbeingAvg ?? 10) < 6.5
            ? "Сейчас лучше не ужесточать день: защити сон, воду, прогулку и не строй план на голом энтузиазме."
            : "Удерживай телесную базу и не позволяй ей раствориться под очередной срочностью.",
        stats: [
          {
            label: "Последняя точка",
            value: lastSparkValue(wellbeingSpark) != null ? fmtNum(lastSparkValue(wellbeingSpark)) : "—",
            sub: "/10",
            tone: wellbeingStatus,
          },
          {
            label: "7 дней",
            value: fmtNum(snapshot.week.avgWellbeing),
            sub: "среднее",
          },
          {
            label: "30 дней / ориентир",
            value: fmtNum(snapshot.month.avgWellbeing),
            sub: "лучше ≥ 7/10",
          },
        ],
      },
    },
    {
      key: "water",
      emoji: "💧",
      label: "Вода",
      value: fmtNum(h.waterAvg, 0),
      unit: "мл / день",
      sparkPoints: waterSpark,
      color: "sky",
      status: (h.waterAvg ?? 0) >= 2000 ? "good" : (h.waterAvg ?? 0) >= 1200 ? "warn" : "bad",
      drilldown: {
        summary:
          (h.waterAvg ?? 0) < 1200
            ? "Вода уже тихо бьёт по энергии и recovery — это слишком дешёвый рычаг, чтобы его игнорировать."
            : (h.waterAvg ?? 0) < 2000
              ? "Гидрация средняя: жить можно, но это не та база, на которой день ощущается лёгким."
              : "Гидрация уже помогает recovery и дневной стабильности.",
        insight:
          lastSparkValue(waterSpark) != null
            ? `Последняя точка — ${fmtNum(lastSparkValue(waterSpark), 0)} мл; среднее за 30 дней ${fmtNum(snapshot.month.avgWater, 0)} мл.`
            : "Последний water-check пока не зафиксирован отдельно.",
        action:
          (h.waterAvg ?? 0) < 1800
            ? "Сделай воду не намерением, а частью контура: стакан после подъёма и отдельный block после обеда."
            : "Оставь текущий ритм и следи, чтобы вода не проваливалась в busy-дни.",
        stats: [
          {
            label: "Последняя точка",
            value: lastSparkValue(waterSpark) != null ? fmtNum(lastSparkValue(waterSpark), 0) : "—",
            sub: "мл",
            tone: (h.waterAvg ?? 0) >= 2000 ? "good" : (h.waterAvg ?? 0) >= 1200 ? "warn" : "bad",
          },
          {
            label: "7 дней",
            value: fmtNum(snapshot.week.avgWater, 0),
            sub: "мл / день",
          },
          {
            label: "30 дней / ориентир",
            value: fmtNum(snapshot.month.avgWater, 0),
            sub: "лучше ≥ 2000 мл",
          },
        ],
      },
    },
    {
      key: "stress",
      emoji: "🧘",
      label: "Стресс",
      value: fmtNum(h.stressAvg),
      unit: "/ 10",
      sub: buildIntradaySub(intradaySignal?.shifts.stress, intradaySignal),
      sparkPoints: stressSpark,
      color: h.stressAvg != null && h.stressAvg > 5 ? "rose" : "emerald",
      status: stressStatus,
      drilldown: {
        summary:
          (h.stressAvg ?? 0) > 5
            ? "Стресс сам по себе стал отдельной рабочей нагрузкой и будет портить и сон, и восстановление."
            : (h.stressAvg ?? 0) > 3
              ? "Стресс не критический, но уже заметен в фоне и может съедать ресурс исподтишка."
              : "По данным HEYS стресс сейчас не главный враг — значит, проблема скорее в ритме тела, а не в чистом перегрузе.",
        insight:
          lastSparkValue(stressSpark) != null
            ? `Последняя точка — ${fmtNum(lastSparkValue(stressSpark))}/10; 30-дневное среднее ${fmtNum(snapshot.month.avgStress)}/10.`
            : "Последняя оценка стресса пока не зафиксирована отдельно.",
        action:
          (h.stressAvg ?? 0) > 4
            ? "Снизь шум и добавь короткий recovery-слот, прежде чем пытаться дожать день продуктивностью."
            : "Стресс можно считать фоном, а главный управленческий рычаг искать в сне, шагах и recovery.",
        stats: [
          {
            label: "Последняя точка",
            value: lastSparkValue(stressSpark) != null ? fmtNum(lastSparkValue(stressSpark)) : "—",
            sub: "/10",
            tone: stressStatus,
          },
          {
            label: "7 дней",
            value: fmtNum(snapshot.week.avgStress),
            sub: "среднее",
          },
          {
            label: "30 дней / ориентир",
            value: fmtNum(snapshot.month.avgStress),
            sub: "лучше ≤ 3/10",
          },
        ],
      },
    },
  ];
  const selectedMetric =
    metrics.find((metric) => metric.key === selectedMetricKey) ??
    metrics.find((metric) => metric.key === defaultMetricKey) ??
    metrics[0]!;
  const topMetric =
    metrics.find((metric) => metric.key === dayMode.focusMetricKey) ??
    metrics.find((metric) => metric.key === defaultMetricKey) ??
    metrics[0]!;
  const topActionPlan = getMetricActionPlan(topMetric.key);
  const selectedActionPlan = getMetricActionPlan(selectedMetric.key);
  const learningStats = buildLearningStats(
    tasks,
    customEvents,
    days,
    snapshot.profile?.weightGoal,
  );
  const bundleLearningStats = buildBundleLearningStats(
    tasks,
    customEvents,
    days,
    snapshot.profile?.weightGoal,
  );
  const recommendedBundleChoices = getRankedCompoundActionBundles(
    topMetric.key,
    bundleContext,
    bundleLearningStats,
    dayMode,
  );
  const selectedBundleChoices = getRankedCompoundActionBundles(
    selectedMetric.key,
    bundleContext,
    bundleLearningStats,
    dayMode,
  );
  const recommendedBundleChoice = recommendedBundleChoices[0] ?? null;
  const selectedBundleChoice = selectedBundleChoices[0] ?? null;
  const recommendedBundle = recommendedBundleChoice?.bundle ?? null;
  const selectedBundle = selectedBundleChoice?.bundle ?? null;
  const topMetricLearning = getPreferredLearningForMetric(topMetric.key, learningStats);
  const selectedMetricLearning = getPreferredLearningForMetric(selectedMetric.key, learningStats);
  const recommendedBundleLearning = recommendedBundleChoice?.learning ?? null;
  const selectedBundleLearning = selectedBundleChoice?.learning ?? null;
  const learnedBundleHighlights = bundleLearningStats
    .filter((stat) => stat.improved > 0 && stat.resolved > 0)
    .slice(0, 3);
  const recommendedBundleAlternatives = recommendedBundleChoices.slice(1, 3);
  const learnedHighlights = learningStats
    .filter((stat) => stat.improved > 0 && stat.resolved > 0)
    .slice(0, 3);
  const effectiveTopRecommendation =
    dayMode.forceActionKind ?? topMetricLearning?.actionKind ?? topActionPlan.recommended;
  const isLearnedOverride =
    dayMode.forceActionKind == null &&
    topMetricLearning != null &&
    topMetricLearning.actionKind !== topActionPlan.recommended;
  const shouldBiasToBundle =
    recommendedBundleChoice != null &&
    (dayMode.preferBundle ||
      recommendedBundleChoice.score >= 8 ||
      (recommendedBundleLearning != null &&
        recommendedBundleLearning.score > 1 &&
        recommendedBundleLearning.resolved >= 2));
  const weeklySlotOptions =
    effectiveTopRecommendation === "slot"
      ? getAutopilotSlotOptions(topMetric.key, topActionPlan).slice(0, 3)
      : [];
  const intradayRescheduleHints = buildIntradayRescheduleHints({
    signal: intradaySignal,
    topMetricKey: topMetric.key,
    todaySchedule: getScheduleForDate(todayDateKey()),
    slotOptions: weeklySlotOptions,
    tasks,
  });
  const correlationInsights = buildCorrelationInsights(
    days,
    snapshot.profile?.stepsGoal,
    snapshot.profile?.sleepHoursGoal,
  );
  const traceItems = buildTraceItems(
    tasks,
    customEvents,
    days,
    snapshot.profile?.weightGoal,
  );
  const traceSummary = summarizeTraceImpact(traceItems);
  const summaryReasons = [...new Set([...(intradaySignal?.reasons ?? []), ...dayMode.reasons])].slice(0, 3);
  const topRescheduleHint = intradayRescheduleHints[0] ?? null;
  const resolvedTopSlot = effectiveTopRecommendation === "slot"
    ? resolveAutopilotSlot(topMetric.key, topActionPlan)
    : null;
  const summaryModeBadge = dayMode.preferBundle
    ? "compound-first"
    : dayMode.forceActionKind === "slot"
      ? "windows-first"
      : "execution-safe";
  const summarySupportText = recommendedBundleLearning
    ? `Опора: связка уже давала эффект ${recommendedBundleLearning.improved}/${recommendedBundleLearning.resolved} · ${getConfidenceLabel(recommendedBundleLearning.confidence)}.`
    : topMetricLearning
      ? `Опора: по ${getMetricLabel(topMetric.key).toLowerCase()} лучше заходят ${getActionKindLabel(topMetricLearning.actionKind)} — ${topMetricLearning.improved}/${topMetricLearning.resolved}.`
      : "Опора: в основном текущий сигнал HEYS и календарный контекст — личной истории ещё мало.";
  const summaryNextTitle = topRescheduleHint
    ? topRescheduleHint.title
    : shouldBiasToBundle && recommendedBundle
      ? `Связка «${recommendedBundle.label}»`
      : effectiveTopRecommendation === "slot"
        ? resolvedTopSlot
          ? `${topActionPlan.slot.title} · ${formatDateLabel(resolvedTopSlot.date)} ${resolvedTopSlot.start}`
          : topActionPlan.slot.title
        : topActionPlan.task.title;
  const summaryNextDetail = topRescheduleHint
    ? shortenLabel(topRescheduleHint.detail, 150)
    : shouldBiasToBundle && recommendedBundle
      ? shortenLabel(recommendedBundle.summary, 150)
      : effectiveTopRecommendation === "slot"
        ? resolvedTopSlot
          ? `Автопилот уже нашёл тихое окно и не будет пихать ещё один случайный слот.`
          : `Автопилот подберёт ближайшее окно с минимальным конфликтом по нагрузке.`
        : `Автопилот поставит одну конкретную задачу вместо длинного разбора.`;

  function handleSelectMetric(metricKey: MetricKey): void {
    setSelectedMetricKey(metricKey);
    setAnalysisExpanded(true);
  }

  function ensureTaskFromPlan(
    plan: MetricActionPlan,
    metricKey: MetricKey,
    via: AutomationOrigin["via"] = "task",
    originExtra?: Partial<AutomationOrigin>,
  ): ActionCreateResult {
    const dueDate = todayDateKey(plan.task.dueOffset ?? 0);
    const existing = getTasks().find(
      (task) =>
        task.title === plan.task.title &&
        task.dueDate === dueDate &&
        (task.status === "active" || task.status === "inbox"),
    );

    if (existing) {
      return {
        kind: "task",
        status: "existing",
        title: plan.task.title,
        dateLabel: formatDateLabel(dueDate),
      };
    }

    addTask(plan.task.title, {
      priority: plan.task.priority,
      dueDate,
      status: plan.task.priority === "p1" ? "active" : "inbox",
      origin: createHeysOrigin(metricKey, via, originExtra),
    });

    return {
      kind: "task",
      status: "created",
      title: plan.task.title,
      dateLabel: formatDateLabel(dueDate),
    };
  }

  function ensureSlotFromResolvedPlan(
    plan: ResolvedSlotPlan,
    metricKey: MetricKey,
    via: AutomationOrigin["via"] = "slot",
    originExtra?: Partial<AutomationOrigin>,
  ): ActionCreateResult {
    const existing = getCustomEvents(plan.date).find(
      (event) =>
        event.title === plan.title && event.start === plan.start && event.end === plan.end,
    );

    if (existing) {
      return {
        kind: "slot",
        status: "existing",
        title: plan.title,
        dateLabel: `${formatDateLabel(plan.date)} · ${plan.start}`,
      };
    }

    addCustomEvent({
      date: plan.date,
      start: plan.start,
      end: plan.end,
      title: plan.title,
      tone: plan.tone,
      tags: plan.tags,
      origin: createHeysOrigin(metricKey, via, originExtra),
      kind: "event",
    });

    return {
      kind: "slot",
      status: "created",
      title: plan.title,
      dateLabel: `${formatDateLabel(plan.date)} · ${plan.start}`,
    };
  }

  function ensureSlotFromPlan(
    plan: MetricActionPlan,
    metricKey: MetricKey,
    via: AutomationOrigin["via"] = "slot",
    originExtra?: Partial<AutomationOrigin>,
  ): ActionCreateResult {
    const date = resolveSlotDate(plan.slot.start, plan.slot.dateOffset ?? 0);

    return ensureSlotFromResolvedPlan(
      {
        ...plan.slot,
        date,
      },
      metricKey,
      via,
      originExtra,
    );
  }

  function createTaskFromPlan(
    plan: MetricActionPlan,
    metricKey: MetricKey,
    via: AutomationOrigin["via"] = "task",
    originExtra?: Partial<AutomationOrigin>,
  ): void {
    const result = ensureTaskFromPlan(plan, metricKey, via, originExtra);
    setActionFeedback(
      result.status === "created"
        ? { tone: "success", text: plan.task.success }
        : { tone: "info", text: `Такая задача уже есть: ${plan.task.title}` },
    );
  }

  function createSlotFromResolvedPlan(
    plan: ResolvedSlotPlan,
    metricKey: MetricKey,
    via: AutomationOrigin["via"] = "slot",
    successText: string = plan.success,
    originExtra?: Partial<AutomationOrigin>,
  ): void {
    const result = ensureSlotFromResolvedPlan(plan, metricKey, via, originExtra);
    setActionFeedback(
      result.status === "created"
        ? { tone: "success", text: successText }
        : { tone: "info", text: `Такой слот уже есть: ${plan.title}` },
    );
  }

  function createSlotFromPlan(
    plan: MetricActionPlan,
    metricKey: MetricKey,
    via: AutomationOrigin["via"] = "slot",
    originExtra?: Partial<AutomationOrigin>,
  ): void {
    const result = ensureSlotFromPlan(plan, metricKey, via, originExtra);
    setActionFeedback(
      result.status === "created"
        ? { tone: "success", text: plan.slot.success }
        : { tone: "info", text: `Такой слот уже есть: ${plan.slot.title}` },
    );
  }

  function handleCreateTaskAction(): void {
    createTaskFromPlan(selectedActionPlan, selectedMetric.key);
  }

  function handleCreateSlotAction(): void {
    createSlotFromPlan(selectedActionPlan, selectedMetric.key);
  }

  function handleCreateSuggestedSlot(option: WeeklySlotOption): void {
    createSlotFromResolvedPlan(
      option,
      topMetric.key,
      "autopilot",
      `Окно защищено ${formatDateLabel(option.date)} в ${option.start}`,
    );
  }

  function handleTraceItemFocus(metricKey: MetricKey | null): void {
    if (!metricKey) return;
    setSelectedMetricKey(metricKey);
    setAnalysisExpanded(true);
  }

  function handleApplyIntradayHint(hint: IntradayRescheduleHint): void {
    if (!hint.action) {
      setActionFeedback({
        tone: "info",
        text: `Для «${hint.title}» пока нет безопасного автоприменения.`,
      });
      return;
    }

    const result = applyIntradayRescheduleAction(hint.action);
    setActionFeedback({
      tone: result.outcome === "applied" ? "success" : "info",
      text: result.message,
    });
  }

  function handleApplyCompoundBundle(bundle: CompoundActionBundle): void {
    const bundleRunId = makeBundleRunId();
    let created = 0;
    let existing = 0;

    for (const item of bundle.items) {
      const originExtra: Partial<AutomationOrigin> = {
        bundleId: bundle.id,
        bundleLabel: bundle.label,
        bundlePart: item.id,
        bundleRunId,
      };
      const plan = getMetricActionPlan(item.metricKey);
      const result =
        item.kind === "task"
          ? ensureTaskFromPlan(plan, item.metricKey, "task", originExtra)
          : ensureSlotFromPlan(plan, item.metricKey, "slot", originExtra);

      if (result.status === "created") created += 1;
      else existing += 1;
    }

    if (created === 0) {
      setActionFeedback({
        tone: "info",
        text: `Связка уже стоит: ${bundle.label}`,
      });
      return;
    }

    setActionFeedback({
      tone: "success",
      text:
        existing > 0
          ? `Связка «${bundle.label}»: добавил ${created}, уже стояло ${existing}`
          : `Связка «${bundle.label}» применена`,
    });
  }

  function handleApplyRecommendation(): void {
    if (shouldBiasToBundle && recommendedBundle) {
      handleApplyCompoundBundle(recommendedBundle);
      return;
    }

    if (effectiveTopRecommendation === "slot") {
      const resolvedSlot = resolveAutopilotSlot(topMetric.key, topActionPlan);

      if (resolvedSlot) {
        const existingSlot = getCustomEvents().find(
          (event) =>
            event.title === resolvedSlot.title &&
            event.start === resolvedSlot.start &&
            event.end === resolvedSlot.end &&
            event.date >= todayDateKey(),
        );

        if (existingSlot) {
          setActionFeedback({
            tone: "info",
            text: `Автопилот: слот уже стоит ${formatDateLabel(existingSlot.date)} в ${existingSlot.start}`,
          });
          return;
        }

        createSlotFromResolvedPlan(
          {
            ...resolvedSlot,
            tags: [...resolvedSlot.tags, "autopilot"],
          },
          topMetric.key,
          "autopilot",
          `Автопилот: слот поставлен ${formatDateLabel(resolvedSlot.date)} в ${resolvedSlot.start}`,
        );
        return;
      }

      const fallbackDate = resolveAutopilotTaskDate(topMetric.key, topActionPlan.task.priority);
      const existingTask = getTasks().find(
        (task) => task.title === topActionPlan.task.title && (task.status === "active" || task.status === "inbox"),
      );

      if (existingTask) {
        setActionFeedback({
          tone: "info",
          text: `Автопилот: задача уже есть (${existingTask.title})`,
        });
        return;
      }

      addTask(topActionPlan.task.title, {
        priority: topActionPlan.task.priority,
        dueDate: fallbackDate,
        status: topActionPlan.task.priority === "p1" ? "active" : "inbox",
        origin: createHeysOrigin(topMetric.key, "autopilot"),
      });

      setActionFeedback({
        tone: "success",
        text: `Автопилот: календарь плотный — добавил задачу на ${formatDateLabel(fallbackDate)}`,
      });
      return;
    }

    const dueDate = resolveAutopilotTaskDate(topMetric.key, topActionPlan.task.priority);
    const existingTask = getTasks().find(
      (task) => task.title === topActionPlan.task.title && (task.status === "active" || task.status === "inbox"),
    );

    if (existingTask) {
      setActionFeedback({
        tone: "info",
        text: `Автопилот: задача уже есть (${existingTask.title})`,
      });
      return;
    }

    addTask(topActionPlan.task.title, {
      priority: topActionPlan.task.priority,
      dueDate,
      status: topActionPlan.task.priority === "p1" ? "active" : "inbox",
      origin: createHeysOrigin(topMetric.key, "autopilot"),
    });

    setActionFeedback({
      tone: "success",
      text: `Автопилот: задача поставлена на ${formatDateLabel(dueDate)}`,
    });
  }

  return (
    <div className="rounded-2xl border border-sky-500/15 bg-linear-to-br from-sky-950/8 to-zinc-950 p-4">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-50">🫀 HEYS — здоровье</h3>
          <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 text-[9px] text-zinc-500">
            live
          </span>
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-zinc-600 border-t-sky-400" />
          )}
          <button
            type="button"
            onClick={refresh}
            className="text-[10px] text-zinc-500 transition hover:text-zinc-300"
          >
            {lastSynced
              ? `обновлено ${new Date(lastSynced).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
              : "обновить"}
          </button>
        </div>
      </div>

      <div className={`mb-3 rounded-xl border px-3 py-3 ${actionToneClass}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">HEYS · кратко</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold text-zinc-100">{dayMode.label}</h4>
              <span className={`rounded-full border px-2 py-1 text-[10px] ${toneBadgeClass(dayMode.tone)}`}>
                фокус: {getMetricEmoji(topMetric.key)} {getMetricLabel(topMetric.key)}
              </span>
              <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-[10px] text-zinc-400">
                {summaryModeBadge}
              </span>
            </div>
            <p className="mt-2 text-sm text-zinc-100">{shortenLabel(actionState.detail, 170)}</p>
            <div className="mt-3 grid gap-2 lg:grid-cols-3">
              <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/25 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Сейчас</p>
                <p className="mt-1 text-sm font-medium text-zinc-100">{actionState.title}</p>
                <p className="mt-1 text-[12px] leading-5 text-zinc-400">{shortenLabel(dayMode.summary, 110)}</p>
              </div>
              <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/25 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Почему</p>
                <p className="mt-1 text-sm font-medium text-zinc-100">
                  {summaryReasons.length > 0 ? summaryReasons.join(" · ") : "Сигнал пока без жёстких флагов"}
                </p>
                <p className="mt-1 text-[12px] leading-5 text-zinc-400">{shortenLabel(summarySupportText, 130)}</p>
              </div>
              <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/25 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Следующий ход</p>
                <p className="mt-1 text-sm font-medium text-zinc-100">{summaryNextTitle}</p>
                <p className="mt-1 text-[12px] leading-5 text-zinc-400">{summaryNextDetail}</p>
              </div>
            </div>
            {summaryReasons.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {summaryReasons.map((reason) => (
                  <span
                    key={reason}
                    className={`rounded-full border px-2 py-1 text-[10px] ${toneBadgeClass(dayMode.tone)}`}
                  >
                    {reason}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex max-w-sm flex-col items-start gap-2">
            <button
              type="button"
              onClick={handleApplyRecommendation}
              className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
                actionState.tone === "critical"
                  ? "border-rose-400/35 bg-rose-500/15 text-rose-100 hover:border-rose-300/60"
                  : actionState.tone === "watch"
                    ? "border-amber-400/35 bg-amber-500/15 text-amber-100 hover:border-amber-300/60"
                    : "border-emerald-400/35 bg-emerald-500/15 text-emerald-100 hover:border-emerald-300/60"
              }`}
            >
              ✨ Применить рекомендацию
            </button>
            {recommendedBundle && (
              <button
                type="button"
                onClick={() => handleApplyCompoundBundle(recommendedBundle)}
                className="rounded-lg border border-sky-400/25 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-100 transition hover:border-sky-300/50"
              >
                🧩 Применить связку
              </button>
            )}
            <button
              type="button"
              onClick={() => setAnalysisExpanded((current) => !current)}
              className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:border-zinc-600 hover:text-zinc-50"
            >
              {analysisExpanded ? "Свернуть анализ" : "Развернуть анализ"}
            </button>
            <p className="text-[11px] leading-5 text-zinc-400">
              Здесь оставлен только вывод, причины и ближайший ход; длинный разбор открывается по кнопке.
            </p>
            {actionFeedback && (
              <span
                className={`inline-flex rounded-full border px-2 py-1 text-[10px] ${
                  actionFeedback.tone === "success"
                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                    : "border-zinc-700 bg-zinc-900/50 text-zinc-300"
                }`}
              >
                {actionFeedback.text}
              </span>
            )}
          </div>
        </div>
      </div>

      {analysisExpanded && (
        <>
      <div className={`mb-3 rounded-xl border px-3 py-3 ${actionToneClass}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className={`text-[10px] uppercase tracking-[0.18em] ${actionTextClass}`}>
              {actionState.title}
            </p>
            <p className="mt-1 text-sm text-zinc-100">{actionState.detail}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleApplyRecommendation}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
                  actionState.tone === "critical"
                    ? "border-rose-400/35 bg-rose-500/15 text-rose-100 hover:border-rose-300/60"
                    : actionState.tone === "watch"
                      ? "border-amber-400/35 bg-amber-500/15 text-amber-100 hover:border-amber-300/60"
                      : "border-emerald-400/35 bg-emerald-500/15 text-emerald-100 hover:border-emerald-300/60"
                }`}
              >
                ✨ Применить рекомендацию
              </button>
              {recommendedBundle && (
                <button
                  type="button"
                  onClick={() => handleApplyCompoundBundle(recommendedBundle)}
                  className="rounded-lg border border-sky-400/25 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-100 transition hover:border-sky-300/50"
                >
                  🧩 Применить связку
                </button>
              )}
              <span className="text-[11px] text-zinc-400">
                {shouldBiasToBundle && recommendedBundle
                  ? `${dayMode.label}: автопилот тянет в связку «${recommendedBundle.label}»`
                  : effectiveTopRecommendation === "slot"
                  ? `${dayMode.label}: автопилот подберёт окно для «${topActionPlan.slot.title}»`
                  : `${dayMode.label}: автопилот поставит задачу «${topActionPlan.task.title}»`}
              </span>
              {topMetricLearning && (
                <span className={`rounded-full border px-2 py-1 text-[10px] ${toneBadgeClass(topMetricLearning.score > 0 ? "good" : "warn")}`}>
                  работает лучше: {getActionKindShortLabel(topMetricLearning.actionKind)}
                </span>
              )}
              {recommendedBundleLearning && (
                <span className={`rounded-full border px-2 py-1 text-[10px] ${toneBadgeClass(recommendedBundleLearning.score > 0 ? "good" : "warn")}`}>
                  связка: {recommendedBundleLearning.improved}/{recommendedBundleLearning.resolved}
                </span>
              )}
            </div>
            <p className="mt-2 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
              Кликни по метрике ниже, чтобы раскрыть контекст и следующий шаг.
            </p>
          </div>
          <div className="max-w-md space-y-2">
            <p className="text-[11px] leading-5 text-zinc-400">{actionState.hint}</p>
            {topMetricLearning ? (
              <p className="text-[11px] leading-5 text-zinc-400">
                Learning layer: по метрике «{getMetricLabel(topMetric.key)}» лучше всего заходят {getActionKindLabel(topMetricLearning.actionKind)} — {topMetricLearning.improved} из {topMetricLearning.resolved} закрытых циклов дали улучшение, {getConfidenceLabel(topMetricLearning.confidence)}.
                {isLearnedOverride ? " Поэтому автопилот смещён в сторону этого рычага." : ""}
              </p>
            ) : (
              <p className="text-[11px] leading-5 text-zinc-400">
                Learning layer ещё собирает resolved cycles — пока автопилот опирается в основном на текущий сигнал, а не на личную статистику эффекта.
              </p>
            )}
            {recommendedBundle && (
              <p className="text-[11px] leading-5 text-zinc-400">
                Compound layer: рядом доступна связка «{recommendedBundle.label}». {recommendedBundleLearning
                  ? `По ней уже есть ${recommendedBundleLearning.improved}/${recommendedBundleLearning.resolved} улучшений — ${getConfidenceLabel(recommendedBundleLearning.confidence)}.`
                  : "Это новый уровень рычага: статистика по связке начнёт копиться после первых применений."}
                {recommendedBundleChoice?.reasons.length
                  ? ` Почему сейчас: ${recommendedBundleChoice.reasons.join(" · ")}.`
                  : ""}
              </p>
            )}
          </div>
        </div>
      </div>

      {intradaySignal && (
        <div className={`mb-3 rounded-xl border p-3 ${toneCardClass(intradayTone)}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Внутри дня</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold text-zinc-100">{getIntradayMomentumLabel(intradaySignal.momentum)}</h4>
                <span className={`rounded-full border px-2 py-1 text-[10px] ${toneBadgeClass(intradayTone)}`}>
                  {getIntradayStatusLabel(intradaySignal.status)}
                </span>
                {intradaySignal.lastCheckInAt && (
                  <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-[10px] text-zinc-400">
                    check-in {intradaySignal.lastCheckInAt}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-zinc-300">{intradaySignal.summary}</p>
              <p className="mt-2 text-[12px] leading-5 text-zinc-400">{intradaySignal.detail}</p>
            </div>

            <div className="max-w-md space-y-2">
              <div className="flex flex-wrap gap-2">
                {intradayShifts.map((shift) => (
                  <span
                    key={shift.metricKey}
                    className={`rounded-full border px-2 py-1 text-[10px] ${toneBadgeClass(shift.tone)}`}
                  >
                    {getMetricEmoji(shift.metricKey)} {shift.label.toLowerCase()}: {formatIntradayShiftDelta(shift)}
                  </span>
                ))}
                {intradaySignal.mealCountToday > 0 && (
                  <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-[10px] text-zinc-400">
                    приёмы: {intradaySignal.mealCountToday}
                  </span>
                )}
                {intradaySignal.trainingCountToday > 0 && (
                  <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-[10px] text-zinc-400">
                    тренировки: {intradaySignal.trainingCountToday}
                  </span>
                )}
              </div>
              <p className="text-[11px] leading-5 text-zinc-500">
                Этот live-сигнал уже влияет на day mode, автопилот и выбор между слотами, recovery и задачами.
              </p>

              {intradayRescheduleHints.length > 0 && (
                <div className="rounded-2xl border border-zinc-800/70 bg-zinc-950/35 p-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Reschedule now</p>
                  <div className="mt-2 space-y-2">
                    {intradayRescheduleHints.map((hint) => (
                      <div key={hint.id} className="rounded-2xl border border-zinc-800/70 bg-zinc-950/40 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-zinc-100">{hint.title}</p>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${toneBadgeClass(hint.tone)}`}>
                            {hint.tone === "bad" ? "now" : hint.tone === "warn" ? "watch" : "hint"}
                          </span>
                        </div>
                        <p className="mt-1 text-[12px] leading-5 text-zinc-400">{hint.detail}</p>
                        {hint.action && (
                          <button
                            type="button"
                            onClick={() => handleApplyIntradayHint(hint)}
                            className="mt-3 rounded-xl border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-100 transition hover:border-sky-400/40"
                          >
                            Применить
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className={`mb-3 rounded-xl border p-3 ${toneCardClass(dayMode.tone)}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Режим дня</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold text-zinc-100">{dayMode.label}</h4>
              <span className={`rounded-full border px-2 py-1 text-[10px] ${toneBadgeClass(dayMode.tone)}`}>
                фокус: {getMetricEmoji(dayMode.focusMetricKey)} {getMetricLabel(dayMode.focusMetricKey)}
              </span>
              <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-[10px] text-zinc-400">
                {dayMode.preferBundle
                  ? "compound-first"
                  : dayMode.forceActionKind === "slot"
                    ? "windows-first"
                    : "execution-safe"}
              </span>
            </div>
            <p className="mt-2 text-sm text-zinc-300">{dayMode.summary}</p>
            <p className="mt-2 text-[12px] leading-5 text-zinc-400">{dayMode.detail}</p>
          </div>

          <div className="max-w-md space-y-2">
            <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Почему сейчас</p>
            <div className="flex flex-wrap gap-2">
              {dayMode.reasons.length > 0 ? (
                dayMode.reasons.map((reason) => (
                  <span
                    key={reason}
                    className={`rounded-full border px-2 py-1 text-[10px] ${toneBadgeClass(dayMode.tone)}`}
                  >
                    {reason}
                  </span>
                ))
              ) : (
                <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-[10px] text-zinc-400">
                  режим пока без жёстких флагов
                </span>
              )}
            </div>
            <p className="text-[11px] leading-5 text-zinc-400">{dayMode.calendarStrategy}</p>
          </div>
        </div>
      </div>

      {recommendedBundle && (
        <div className="mb-3 rounded-xl border border-sky-500/15 bg-zinc-950/30 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Compound action</p>
              <h4 className="mt-1 text-sm font-semibold text-zinc-100">🧩 {recommendedBundle.label}</h4>
              <p className="mt-1 max-w-2xl text-sm text-zinc-300">{recommendedBundle.summary}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {recommendedBundle.items.map((item) => (
                  <span
                    key={item.id}
                    className="rounded-full border border-zinc-800 bg-zinc-900/50 px-2 py-1 text-[10px] text-zinc-300"
                  >
                    {getBundlePartLabel(item)}
                  </span>
                ))}
              </div>
              {recommendedBundleChoice?.reasons.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {recommendedBundleChoice.reasons.map((reason) => (
                    <span
                      key={reason}
                      className="rounded-full border border-sky-500/15 bg-sky-500/8 px-2 py-1 text-[10px] text-sky-100"
                    >
                      {reason}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="max-w-sm space-y-2">
              <button
                type="button"
                onClick={() => handleApplyCompoundBundle(recommendedBundle)}
                className="rounded-lg border border-sky-400/25 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-100 transition hover:border-sky-300/50"
              >
                Применить связку целиком
              </button>
              <p className="text-[11px] leading-5 text-zinc-400">
                {recommendedBundleLearning
                  ? `Связка уже дала ${recommendedBundleLearning.improved} улучшений из ${recommendedBundleLearning.resolved} закрытых циклов — ${getConfidenceLabel(recommendedBundleLearning.confidence)}.`
                  : "Пока это новый compound move: после первых прогонов панель начнёт оценивать его как отдельный рычаг."}
              </p>
              {recommendedBundleAlternatives.length > 0 && (
                <p className="text-[11px] leading-5 text-zinc-500">
                  Альтернативы: {recommendedBundleAlternatives
                    .map((choice) => choice.bundle.label.toLowerCase())
                    .join(" · ")}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {weeklySlotOptions.length > 0 && (
        <div className="mb-3 rounded-xl border border-zinc-800/60 bg-zinc-950/30 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                Лучшие окна недели
              </p>
              <p className="mt-1 max-w-2xl text-sm text-zinc-300">
                Автопилот уже ранжировал реальные слоты по загрузке и конфликтам календаря.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {weeklySlotOptions.map((option) => {
                const load = getWeekSlotLoadLabel(option.loadScore);

                return (
                  <button
                    key={`${option.date}-${option.start}-${option.end}`}
                    type="button"
                    onClick={() => handleCreateSuggestedSlot(option)}
                    className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 px-3 py-2 text-left transition hover:border-zinc-700 hover:bg-zinc-900/60"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-200">
                        {formatDateLabel(option.date)} · {option.start}
                      </span>
                      <span className={`rounded-full border px-1.5 py-0.5 text-[9px] ${toneBadgeClass(load.tone)}`}>
                        {load.label}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] uppercase tracking-wide text-zinc-500">
                      {topActionPlan.slot.title}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
        </>
      )}

      {/* Metrics grid */}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.filter((metric) => metric.key !== "stress").map((metric) => (
          <MetricCard
            key={metric.key}
            emoji={metric.emoji}
            label={metric.label}
            value={metric.value}
            unit={metric.unit}
            sub={metric.sub}
            sparkPoints={metric.sparkPoints}
            color={metric.color}
            goal={metric.goal}
            status={metric.status}
            active={selectedMetric.key === metric.key}
            onClick={() => handleSelectMetric(metric.key)}
          />
        ))}
      </div>

      {/* Stress mini-row */}
      {h.stressAvg != null && (
        <button
          type="button"
          onClick={() => handleSelectMetric("stress")}
          className={`mt-2 flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${
            selectedMetric.key === "stress"
              ? "border-zinc-600 bg-zinc-900/50 ring-1 ring-sky-400/15"
              : "border-zinc-800/40 bg-zinc-900/20 hover:border-zinc-700 hover:bg-zinc-900/35"
          }`}
        >
          <span className="text-xs">🧘</span>
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">Стресс</span>
          <span className="text-sm font-semibold tabular-nums text-zinc-50">{fmtNum(h.stressAvg)}</span>
          <span className="text-[10px] text-zinc-500">/ 10</span>
          <span className={`h-1.5 w-1.5 rounded-full ${stressStatus === "bad" ? "bg-rose-400" : stressStatus === "warn" ? "bg-amber-400" : "bg-emerald-400"}`} />
          <div className="ml-auto">
            <Sparkline points={stressSpark} color={h.stressAvg > 5 ? "rose" : "emerald"} height={24} width={90} />
          </div>
        </button>
      )}

      {analysisExpanded && (
        <>
      {correlationInsights.length > 0 && (
        <div className="mt-3 rounded-2xl border border-zinc-800/60 bg-zinc-900/20 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">HEYS → связи</p>
              <p className="mt-1 text-sm text-zinc-300">
                Что в твоих данных реально тянет состояние вверх, а не просто выглядит красиво на графике.
              </p>
            </div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
              клик по карточке откроет нужную метрику
            </p>
          </div>

          <div className="mt-3 grid gap-2 lg:grid-cols-3">
            {correlationInsights.map((insight) => (
              <button
                key={insight.id}
                type="button"
                onClick={() => handleSelectMetric(insight.metricKey)}
                className={`rounded-xl border p-3 text-left transition hover:border-zinc-700 hover:bg-zinc-900/40 ${toneCardClass(insight.tone)}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                    {getMetricEmoji(insight.metricKey)} {getMetricLabel(insight.metricKey)}
                  </p>
                  <span className={`rounded-full border px-1.5 py-0.5 text-[9px] ${toneBadgeClass(insight.tone)}`}>
                    паттерн
                  </span>
                </div>
                <p className="mt-2 text-sm font-medium leading-5 text-zinc-100">{insight.title}</p>
                <p className="mt-2 text-[12px] leading-5 text-zinc-400">{insight.detail}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {learnedHighlights.length > 0 && (
        <div className="mt-3 rounded-2xl border border-zinc-800/60 bg-zinc-900/20 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Что реально работает</p>
              <p className="mt-1 text-sm text-zinc-300">
                Здесь не теория, а уже наблюдённые рычаги, которые у тебя давали сдвиг по сигналу.
              </p>
            </div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
              top learned levers
            </p>
          </div>

          <div className="mt-3 grid gap-2 lg:grid-cols-3">
            {learnedHighlights.map((stat) => (
              <button
                key={stat.id}
                type="button"
                onClick={() => handleSelectMetric(stat.metricKey)}
                className="rounded-xl border border-zinc-800/60 bg-zinc-950/30 p-3 text-left transition hover:border-zinc-700 hover:bg-zinc-900/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                    {getMetricEmoji(stat.metricKey)} {getMetricLabel(stat.metricKey)}
                  </p>
                  <span className={`rounded-full border px-1.5 py-0.5 text-[9px] ${toneBadgeClass("good")}`}>
                    {getActionKindShortLabel(stat.actionKind)}
                  </span>
                </div>
                <p className="mt-2 text-sm font-medium text-zinc-100">
                  {stat.improved} из {stat.resolved} циклов дали улучшение
                </p>
                <p className="mt-1 text-[12px] leading-5 text-zinc-400">
                  {getActionKindLabel(stat.actionKind)} · {getConfidenceLabel(stat.confidence)} · flat {stat.flat}{stat.worse > 0 ? ` · хуже ${stat.worse}` : ""}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {learnedBundleHighlights.length > 0 && (
        <div className="mt-3 rounded-2xl border border-zinc-800/60 bg-zinc-900/20 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Рабочие связки</p>
              <p className="mt-1 text-sm text-zinc-300">
                Здесь уже видны не отдельные рычаги, а короткие комбинации действий, которые у тебя давали лучший отклик.
              </p>
            </div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
              compound patterns
            </p>
          </div>

          <div className="mt-3 grid gap-2 lg:grid-cols-3">
            {learnedBundleHighlights.map((stat) => (
              <div
                key={stat.id}
                className="rounded-xl border border-zinc-800/60 bg-zinc-950/30 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">🧩 {stat.label}</p>
                  <span className={`rounded-full border px-1.5 py-0.5 text-[9px] ${toneBadgeClass("good")}`}>
                    {getConfidenceLabel(stat.confidence)}
                  </span>
                </div>
                <p className="mt-2 text-sm font-medium text-zinc-100">
                  {stat.improved} из {stat.resolved} прогонов дали улучшение
                </p>
                <p className="mt-1 text-[12px] leading-5 text-zinc-400">
                  flat {stat.flat}{stat.worse > 0 ? ` · хуже ${stat.worse}` : ""} · ждут сигнала {stat.pending}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedMetric && (
        <div className={`mt-3 rounded-2xl border p-4 ${toneCardClass(selectedMetric.status ?? "neutral")}`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Drilldown</p>
              <h4 className="mt-1 text-base font-semibold text-zinc-50">
                {selectedMetric.emoji} {selectedMetric.label}
              </h4>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">
                {selectedMetric.drilldown.summary}
              </p>
            </div>

            {selectedMetric.sparkPoints.length > 1 && (
              <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/35 p-3">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">30 дней</p>
                <div className="mt-2">
                  <Sparkline
                    points={selectedMetric.sparkPoints}
                    color={selectedMetric.color}
                    goal={selectedMetric.goal}
                    height={56}
                    width={220}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {selectedMetric.drilldown.stats.map((stat) => (
              <div
                key={stat.label}
                className={`rounded-xl border px-3 py-3 ${toneCardClass(stat.tone ?? "neutral")}`}
              >
                <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{stat.label}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-50">{stat.value}</p>
                {stat.sub && <p className="mt-1 text-[11px] text-zinc-500">{stat.sub}</p>}
              </div>
            ))}
          </div>

          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/30 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Что это значит</p>
              <p className="mt-1 text-sm leading-6 text-zinc-200">{selectedMetric.drilldown.insight}</p>
            </div>

            <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/30 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Следующее действие</p>
              <p className="mt-1 text-sm leading-6 text-zinc-200">{selectedMetric.drilldown.action}</p>
              <p className="mt-2 text-[11px] leading-5 text-zinc-400">
                Общий режим сейчас — {dayMode.label}: {dayMode.calendarStrategy}
              </p>
              {selectedMetricLearning && (
                <p className="mt-2 text-[11px] leading-5 text-zinc-400">
                  По этой метрике у тебя лучше всего срабатывают {getActionKindLabel(selectedMetricLearning.actionKind)} — {selectedMetricLearning.improved}/{selectedMetricLearning.resolved} улучшений.
                </p>
              )}
              {selectedBundle && (
                <p className="mt-2 text-[11px] leading-5 text-zinc-400">
                  Связка для этой метрики: «{selectedBundle.label}». {selectedBundleLearning
                    ? `${selectedBundleLearning.improved}/${selectedBundleLearning.resolved} прогонов уже дали улучшение.`
                    : "Пока без истории, но можно начать копить сигнал уже сейчас."}
                  {selectedBundleChoice?.reasons.length
                    ? ` Контекст: ${selectedBundleChoice.reasons.join(" · ")}.`
                    : ""}
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleCreateTaskAction}
                  className="rounded-lg border border-sky-500/20 bg-sky-500/10 px-2.5 py-1.5 text-[11px] text-sky-200 transition hover:border-sky-400/40"
                >
                  ＋ В задачи
                </button>
                <button
                  type="button"
                  onClick={handleCreateSlotAction}
                  className="rounded-lg border border-violet-500/20 bg-violet-500/10 px-2.5 py-1.5 text-[11px] text-violet-200 transition hover:border-violet-400/40"
                >
                  🗓 Защитить слот
                </button>
                {selectedBundle && (
                  <button
                    type="button"
                    onClick={() => handleApplyCompoundBundle(selectedBundle)}
                    className="rounded-lg border border-sky-500/20 bg-sky-500/10 px-2.5 py-1.5 text-[11px] text-sky-200 transition hover:border-sky-400/40"
                  >
                    🧩 Применить связку
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 rounded-2xl border border-zinc-800/60 bg-zinc-900/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">HEYS feedback loop</p>
            <p className="mt-1 text-sm text-zinc-300">
              Что уже было превращено из сигнала в действие — и дал ли этот шаг заметный эффект после 24–48 часов или на недельном окне.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`rounded-full border px-2 py-1 text-[10px] ${toneBadgeClass("good")}`}>
              улучшение {traceSummary.improved}
            </span>
            <span className={`rounded-full border px-2 py-1 text-[10px] ${toneBadgeClass("neutral")}`}>
              ждут сигнала {traceSummary.pending}
            </span>
            {traceSummary.flat > 0 && (
              <span className={`rounded-full border px-2 py-1 text-[10px] ${toneBadgeClass("warn")}`}>
                без сдвига {traceSummary.flat}
              </span>
            )}
            {traceSummary.worse > 0 && (
              <span className={`rounded-full border px-2 py-1 text-[10px] ${toneBadgeClass("bad")}`}>
                ухудшение {traceSummary.worse}
              </span>
            )}
          </div>
        </div>

        {traceItems.length > 0 ? (
          <div className="mt-3 space-y-2">
            {traceItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleTraceItemFocus(item.metricKey)}
                className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800/60 bg-zinc-950/30 px-3 py-3 text-left transition hover:border-zinc-700 hover:bg-zinc-900/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs">{item.kind === "slot" ? "🗓" : "✓"}</span>
                    <p className="truncate text-sm font-medium text-zinc-100">{item.title}</p>
                  </div>
                  <p className="mt-1 text-[12px] text-zinc-400">{item.subtitle}</p>
                  <p className="mt-1 text-[11px] text-zinc-500">{item.impact.detail}</p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                    {formatTraceTimestamp(item.createdAt)}
                  </span>
                  <span className={`rounded-full border px-2 py-1 text-[10px] ${toneBadgeClass(item.statusTone)}`}>
                    {item.statusLabel}
                  </span>
                  <span className={`rounded-full border px-2 py-1 text-[10px] ${toneBadgeClass(item.impact.tone)}`}>
                    {item.impact.label}
                  </span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-dashed border-zinc-800/70 bg-zinc-950/25 px-3 py-4 text-sm text-zinc-500">
            Пока trace пустой — как только сигнал HEYS будет превращён в задачу или слот, он появится здесь.
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}
