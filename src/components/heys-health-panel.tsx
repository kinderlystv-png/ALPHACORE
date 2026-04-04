"use client";

import { useHeysSync } from "@/lib/use-heys-sync";
import type { HeysDayRecord } from "@/lib/heys-bridge";

/* ── Sparkline ── */

type SparkPoint = { value: number; date: string };

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
}: {
  emoji: string;
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  sparkPoints: SparkPoint[];
  color?: string;
  goal?: number | null;
  status?: "good" | "warn" | "bad";
}) {
  const statusDot =
    status === "bad"
      ? "bg-rose-400"
      : status === "warn"
        ? "bg-amber-400"
        : status === "good"
          ? "bg-emerald-400"
          : "bg-zinc-600";

  return (
    <div className="flex items-center gap-3 rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-3 py-2.5">
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
    </div>
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

function fmtNum(v: number | null | undefined, digits = 1): string {
  if (v == null) return "—";
  return digits === 0 ? String(Math.round(v)) : v.toFixed(digits);
}

function getPrimaryActionState(h: NonNullable<ReturnType<typeof useHeysSync>["signals"]>): {
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

  // Sparkline data
  const sleepHoursSpark = extractSpark(days, "sleepHours");
  const sleepQualitySpark = extractSpark(days, "sleepQuality");
  const stepsSpark = extractSpark(days, "steps");
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
          </div>
          <p className="max-w-md text-[11px] leading-5 text-zinc-400">{actionState.hint}</p>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          emoji="😴"
          label="Сон"
          value={fmtNum(h.sleepHoursAvg)}
          unit="ч / ночь"
          sub={`качество ${fmtNum(h.sleepQualityAvg)}/10`}
          sparkPoints={sleepHoursSpark}
          color="violet"
          goal={snapshot.profile?.sleepHoursGoal}
          status={sleepStatus}
        />

        <MetricCard
          emoji="🌙"
          label="Отход ко сну"
          value={h.lateBedtimeRatio != null ? `${Math.round(h.lateBedtimeRatio * 100)}%` : "—"}
          unit="после 01:00"
          sub={sleepQualitySpark.length > 0 ? `качество сна ↓` : undefined}
          sparkPoints={sleepQualitySpark}
          color={bedtimeStatus === "bad" ? "rose" : bedtimeStatus === "warn" ? "amber" : "emerald"}
          status={bedtimeStatus}
        />

        <MetricCard
          emoji="🚶"
          label="Шаги"
          value={fmtNum(h.stepsAvg, 0)}
          unit={`/ ${snapshot.profile?.stepsGoal ?? "?"}`}
          sub={h.stepsGoalRatio != null ? `${Math.round(h.stepsGoalRatio * 100)}% от цели` : undefined}
          sparkPoints={stepsSpark}
          color="emerald"
          goal={snapshot.profile?.stepsGoal}
          status={stepsStatus}
        />

        <MetricCard
          emoji="🏋️"
          label="Тренировки"
          value={String(h.trainingDaysWeek)}
          unit="дн / нед"
          sub={`${snapshot.month.trainingDays} за 30 дней`}
          sparkPoints={days
            .filter((d) => d.trainingCount != null)
            .map((d) => ({ value: d.trainingCount, date: d.date }))}
          color="emerald"
          status={h.trainingDaysWeek >= 3 ? "good" : h.trainingDaysWeek >= 1 ? "warn" : "bad"}
        />

        <MetricCard
          emoji="⚖️"
          label="Вес"
          value={fmtNum(h.weightCurrent, 1)}
          unit={`кг → ${h.weightGoal ?? "?"}кг`}
          sub={
            weightDelta != null
              ? `${weightDelta > 0 ? "+" : ""}${weightDelta.toFixed(1)}кг / 30д`
              : undefined
          }
          sparkPoints={weightSpark}
          color={weightDelta != null && weightDelta < 0 ? "emerald" : "amber"}
          goal={h.weightGoal}
          status={weightStatus}
        />

        <MetricCard
          emoji="😊"
          label="Настроение"
          value={fmtNum(h.moodAvg)}
          unit="/ 10"
          sparkPoints={moodSpark}
          color="fuchsia"
          status={moodStatus}
        />

        <MetricCard
          emoji="💪"
          label="Самочувствие"
          value={fmtNum(h.wellbeingAvg)}
          unit="/ 10"
          sparkPoints={wellbeingSpark}
          color="teal"
          status={wellbeingStatus}
        />

        <MetricCard
          emoji="💧"
          label="Вода"
          value={fmtNum(h.waterAvg, 0)}
          unit="мл / день"
          sparkPoints={waterSpark}
          color="sky"
          status={(h.waterAvg ?? 0) >= 2000 ? "good" : (h.waterAvg ?? 0) >= 1200 ? "warn" : "bad"}
        />
      </div>

      {/* Stress mini-row — shown only if relevant */}
      {h.stressAvg != null && (
        <div className="mt-2 flex items-center gap-3 rounded-xl border border-zinc-800/40 bg-zinc-900/20 px-3 py-2">
          <span className="text-xs">🧘</span>
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">Стресс</span>
          <span className="text-sm font-semibold tabular-nums text-zinc-50">{fmtNum(h.stressAvg)}</span>
          <span className="text-[10px] text-zinc-500">/ 10</span>
          <div className="ml-auto">
            <Sparkline points={stressSpark} color={h.stressAvg > 5 ? "rose" : "emerald"} height={24} width={90} />
          </div>
        </div>
      )}
    </div>
  );
}
