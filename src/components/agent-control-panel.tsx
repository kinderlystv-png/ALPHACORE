import Link from "next/link";

import {
  type AgentControlSnapshot,
  type AttentionArea,
  type AttentionLevel,
} from "@/lib/agent-control";

const LEVEL_LABEL: Record<AttentionLevel, string> = {
  good: "под контролем",
  watch: "нужно внимание",
  critical: "слепая зона",
};

const LEVEL_CARD_CLS: Record<AttentionLevel, string> = {
  good: "border-emerald-500/20 bg-emerald-950/10 text-emerald-300",
  watch: "border-amber-500/20 bg-amber-950/10 text-amber-300",
  critical: "border-rose-500/20 bg-rose-950/10 text-rose-300",
};

const LEVEL_PILL_CLS: Record<AttentionLevel, string> = {
  good: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  watch: "border-amber-500/20 bg-amber-500/10 text-amber-300",
  critical: "border-rose-500/20 bg-rose-500/10 text-rose-300",
};

function RadarWheel({ areas, balanceScore }: { areas: AttentionArea[]; balanceScore: number }) {
  const size = 280;
  const center = size / 2;
  const radius = 82;
  const labelRadius = 112;
  const angleStep = (Math.PI * 2) / areas.length;

  const axisPoints = areas.map((area, index) => {
    const angle = -Math.PI / 2 + index * angleStep;
    const x = center + Math.cos(angle) * radius;
    const y = center + Math.sin(angle) * radius;
    const labelX = center + Math.cos(angle) * labelRadius;
    const labelY = center + Math.sin(angle) * labelRadius;
    const scoreX = center + Math.cos(angle) * (radius + 18);
    const scoreY = center + Math.sin(angle) * (radius + 18);

    return {
      area,
      angle,
      x,
      y,
      labelX,
      labelY,
      scoreX,
      scoreY,
    };
  });

  const polygonPoints = axisPoints
    .map(({ angle, area }) => {
      const scaledRadius = (radius * area.score) / 100;
      return `${center + Math.cos(angle) * scaledRadius},${center + Math.sin(angle) * scaledRadius}`;
    })
    .join(" ");

  const ringPoints = [0.25, 0.5, 0.75, 1].map((factor) =>
    axisPoints
      .map(({ angle }) => {
        const scaledRadius = radius * factor;
        return `${center + Math.cos(angle) * scaledRadius},${center + Math.sin(angle) * scaledRadius}`;
      })
      .join(" "),
  );

  return (
    <div className="rounded-3xl border border-zinc-800/60 bg-zinc-950/40 p-4">
      <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-70 w-70 overflow-visible">
        {ringPoints.map((points, index) => (
          <polygon
            key={index}
            points={points}
            fill="none"
            stroke="currentColor"
            className="text-zinc-800"
            strokeWidth="1"
          />
        ))}

        {axisPoints.map(({ x, y }, index) => (
          <line
            key={index}
            x1={center}
            y1={center}
            x2={x}
            y2={y}
            stroke="currentColor"
            className="text-zinc-800"
            strokeWidth="1"
          />
        ))}

        <polygon
          points={polygonPoints}
          fill="rgba(244, 244, 245, 0.14)"
          stroke="rgba(244, 244, 245, 0.85)"
          strokeWidth="2"
        />

        {axisPoints.map(({ area, angle, labelX, labelY, scoreX, scoreY }) => {
          const scaledRadius = (radius * area.score) / 100;
          const dotX = center + Math.cos(angle) * scaledRadius;
          const dotY = center + Math.sin(angle) * scaledRadius;
          const textAnchor = labelX < center - 8 ? "end" : labelX > center + 8 ? "start" : "middle";

          return (
            <g key={area.key}>
              <circle cx={dotX} cy={dotY} r="4" fill="currentColor" className="text-zinc-50" />
              <text
                x={labelX}
                y={labelY}
                textAnchor={textAnchor}
                dominantBaseline="middle"
                fontSize="14"
                fill="currentColor"
                className="text-zinc-200"
              >
                {area.emoji}
              </text>
              <text
                x={scoreX}
                y={scoreY}
                textAnchor={textAnchor}
                dominantBaseline="middle"
                fontSize="10"
                fill="currentColor"
                className="text-zinc-500"
              >
                {area.score}
              </text>
            </g>
          );
        })}

        <circle cx={center} cy={center} r="28" fill="#09090b" stroke="rgba(244, 244, 245, 0.08)" />
        <text
          x={center}
          y={center - 4}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="26"
          fontWeight="700"
          fill="#fafafa"
        >
          {balanceScore}
        </text>
        <text
          x={center}
          y={center + 16}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="10"
          fill="#71717a"
        >
          balance
        </text>
      </svg>
    </div>
  );
}

export function AgentControlPanel({ snapshot }: { snapshot: AgentControlSnapshot }) {
  return (
    <section className="rounded-4xl border border-zinc-800/60 bg-linear-to-br from-zinc-900/50 to-zinc-950/90 p-5 shadow-2xl shadow-black/20 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h2 className="text-lg font-semibold text-zinc-50">🧭 Agent cockpit</h2>
          <p className="mt-1 text-sm text-zinc-400">{snapshot.modeStatement}</p>
          <p className="mt-3 text-sm text-zinc-300">{snapshot.narrative}</p>
        </div>

        <div className="rounded-2xl border border-zinc-800/70 bg-zinc-950/50 px-4 py-3 text-right">
          <p className="text-[10px] uppercase tracking-widest text-zinc-500">Индекс баланса</p>
          <p className="mt-1 text-3xl font-bold text-zinc-50">{snapshot.balanceScore}</p>
          <p className="text-[11px] text-zinc-500">чем ровнее, тем меньше хаоса</p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <RadarWheel areas={snapshot.areas} balanceScore={snapshot.balanceScore} />

        <div className="grid gap-3 md:grid-cols-3">
          {snapshot.priorities.map((priority) => (
            <Link
              key={priority.id}
              href={priority.href}
              className={`rounded-3xl border p-4 transition hover:border-zinc-600 ${LEVEL_CARD_CLS[priority.level]}`}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-zinc-50">{priority.title}</p>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${LEVEL_PILL_CLS[priority.level]}`}
                >
                  {LEVEL_LABEL[priority.level]}
                </span>
              </div>
              <p className="mt-3 text-xs text-zinc-400">{priority.reason}</p>
              <p className="mt-3 text-sm text-zinc-200">{priority.action}</p>
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {snapshot.areas.map((area) => (
          <Link
            key={area.key}
            href={area.href}
            className="rounded-3xl border border-zinc-800/60 bg-zinc-950/40 p-4 transition hover:border-zinc-600"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-zinc-50">
                  {area.emoji} {area.label}
                </p>
                <p className="mt-1 text-xs text-zinc-500">{area.summary}</p>
              </div>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${LEVEL_PILL_CLS[area.level]}`}
              >
                {LEVEL_LABEL[area.level]}
              </span>
            </div>

            <div className="mt-3 h-2 rounded-full bg-zinc-800">
              <div
                className={`h-full rounded-full ${
                  area.level === "good"
                    ? "bg-emerald-400"
                    : area.level === "watch"
                      ? "bg-amber-400"
                      : "bg-rose-400"
                }`}
                style={{ width: `${area.score}%` }}
              />
            </div>

            <p className="mt-3 text-sm text-zinc-200">{area.insight}</p>

            <ul className="mt-3 space-y-1.5 text-xs text-zinc-500">
              {area.evidence.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-0.5 text-zinc-700">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Link>
        ))}
      </div>
    </section>
  );
}
