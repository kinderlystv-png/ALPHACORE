"use client";

import { useEffect, useState } from "react";
import {
  addCustomEvent,
  getCustomEvents,
  getScheduleForDate,
  timeToMinutes,
  type ScheduleSlot,
  type ScheduleTone,
} from "@/lib/schedule";
import { addTask, getTasks, type TaskPriority } from "@/lib/tasks";
import { useHeysSync } from "@/lib/use-heys-sync";
import type { HeysDayRecord, HeysHealthSignals } from "@/lib/heys-bridge";

/* ── Sparkline ── */

type SparkPoint = { value: number; date: string };
type MetricStatus = "good" | "warn" | "bad";
type MetricKey =
  | "sleep"
  | "bedtime"
  | "steps"
  | "training"
  | "weight"
  | "mood"
  | "wellbeing"
  | "water"
  | "stress";

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
  for (const candidate of getAutopilotSlotCandidates(metricKey)) {
    const date = resolveSlotDate(candidate.start, candidate.dateOffset ?? 0);
    const load = getDayLoad(date);

    if (!isSlotCandidateUsable(date, candidate)) continue;
    if (load.slots.some((slot) => overlapsTimeRange(candidate.start, candidate.end, slot))) continue;
    if (load.cleanup > 0 && ["steps", "training", "wellbeing"].includes(metricKey)) continue;
    if (metricKey === "training" && load.parties > 0) continue;
    if (metricKey === "steps" && load.parties > 1) continue;

    return {
      ...plan.slot,
      date,
      start: candidate.start,
      end: candidate.end,
    };
  }

  return null;
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

function getDefaultMetricKey(h: HeysHealthSignals): MetricKey {
  if (h.lateBedtimeRatio != null && h.lateBedtimeRatio > 0.7) return "bedtime";
  if (h.stepsGoalRatio != null && h.stepsGoalRatio < 0.7) return "steps";
  if ((h.wellbeingAvg ?? 10) < 6.5) return "wellbeing";
  if ((h.waterAvg ?? 0) < 1500) return "water";
  return "sleep";
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
  if (!h.hasRecentData) {
    return {
      tone: "watch",
      title: "Контур пока собирается",
      detail: "HEYS ещё не набрал достаточно свежих точек, чтобы уверенно ловить ритм.",
      hint: "Нужно хотя бы 3–4 дня свежих check-in, чтобы панель стала точнее.",
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
  const defaultMetricKey = h ? getDefaultMetricKey(h) : "sleep";

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
  const topMetric = metrics.find((metric) => metric.key === defaultMetricKey) ?? metrics[0]!;
  const topActionPlan = getMetricActionPlan(topMetric.key);
  const selectedActionPlan = getMetricActionPlan(selectedMetric.key);

  function createTaskFromPlan(plan: MetricActionPlan): void {
    const dueDate = todayDateKey(plan.task.dueOffset ?? 0);
    const existing = getTasks().find(
      (task) =>
        task.title === plan.task.title &&
        task.dueDate === dueDate &&
        (task.status === "active" || task.status === "inbox"),
    );

    if (existing) {
      setActionFeedback({
        tone: "info",
        text: `Такая задача уже есть: ${plan.task.title}`,
      });
      return;
    }

    addTask(plan.task.title, {
      priority: plan.task.priority,
      dueDate,
      status: plan.task.priority === "p1" ? "active" : "inbox",
    });

    setActionFeedback({ tone: "success", text: plan.task.success });
  }

  function createSlotFromPlan(plan: MetricActionPlan): void {
    const date = resolveSlotDate(
      plan.slot.start,
      plan.slot.dateOffset ?? 0,
    );

    const existing = getCustomEvents(date).find(
      (event) =>
        event.title === plan.slot.title &&
        event.start === plan.slot.start &&
        event.end === plan.slot.end,
    );

    if (existing) {
      setActionFeedback({
        tone: "info",
        text: `Такой слот уже есть: ${plan.slot.title}`,
      });
      return;
    }

    addCustomEvent({
      date,
      start: plan.slot.start,
      end: plan.slot.end,
      title: plan.slot.title,
      tone: plan.slot.tone,
      tags: plan.slot.tags,
      kind: "event",
    });

    setActionFeedback({ tone: "success", text: plan.slot.success });
  }

  function handleCreateTaskAction(): void {
    createTaskFromPlan(selectedActionPlan);
  }

  function handleCreateSlotAction(): void {
    createSlotFromPlan(selectedActionPlan);
  }

  function handleApplyRecommendation(): void {
    if (topActionPlan.recommended === "slot") {
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

        addCustomEvent({
          date: resolvedSlot.date,
          start: resolvedSlot.start,
          end: resolvedSlot.end,
          title: resolvedSlot.title,
          tone: resolvedSlot.tone,
          tags: [...resolvedSlot.tags, "autopilot"],
          kind: "event",
        });

        setActionFeedback({
          tone: "success",
          text: `Автопилот: слот поставлен ${formatDateLabel(resolvedSlot.date)} в ${resolvedSlot.start}`,
        });
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
              <span className="text-[11px] text-zinc-400">
                {topActionPlan.recommended === "slot"
                  ? `автопилот подберёт окно для «${topActionPlan.slot.title}»`
                  : `автопилот поставит задачу «${topActionPlan.task.title}»`}
              </span>
            </div>
            <p className="mt-2 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
              Кликни по метрике ниже, чтобы раскрыть контекст и следующий шаг.
            </p>
          </div>
          <div className="max-w-md space-y-2">
            <p className="text-[11px] leading-5 text-zinc-400">{actionState.hint}</p>
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
            onClick={() => setSelectedMetricKey(metric.key)}
          />
        ))}
      </div>

      {/* Stress mini-row */}
      {h.stressAvg != null && (
        <button
          type="button"
          onClick={() => setSelectedMetricKey("stress")}
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
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
