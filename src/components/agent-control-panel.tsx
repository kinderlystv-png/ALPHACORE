"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AGENT_PROMPT_FEEDBACK_KEY,
  buildAgentRecommendations,
  buildRecommendationProfile,
  getRecommendationFeedbackEvents,
  recordRecommendationFeedback,
  type AgentRecommendation,
  type RecommendationFeedbackEvent,
  type RecommendationStatus,
} from "@/lib/agent-recommendations";
import {
  type AgentControlSnapshot,
  type AttentionArea,
  type AttentionLevel,
} from "@/lib/agent-control";
import { subscribeAppDataChange } from "@/lib/storage";

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

const STATUS_LABEL: Record<RecommendationStatus, string> = {
  new: "новое",
  copied: "скопировано",
  implemented: "реализовано",
  disliked: "скрыто",
};

const STATUS_CLS: Record<RecommendationStatus, string> = {
  new: "border-zinc-700 bg-zinc-900/60 text-zinc-300",
  copied: "border-sky-500/20 bg-sky-500/10 text-sky-200",
  implemented: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
  disliked: "border-zinc-800 bg-zinc-950/60 text-zinc-500",
};

type FlashPayload = {
  tone: "success" | "info";
  text: string;
};

async function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard is unavailable");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error("Copy command failed");
  }
}

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

    return { area, angle, x, y, labelX, labelY, scoreX, scoreY };
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

function LearningProfile({ feedbackEvents }: { feedbackEvents: RecommendationFeedbackEvent[] }) {
  const profile = useMemo(() => buildRecommendationProfile(feedbackEvents), [feedbackEvents]);

  if (feedbackEvents.length === 0) {
    return (
      <div className="rounded-3xl border border-zinc-800/60 bg-zinc-950/40 p-4">
        <p className="text-[10px] uppercase tracking-widest text-zinc-500">Система учится по реакциям</p>
        <p className="mt-2 text-sm text-zinc-300">
          Копируй сильные prompts и жми дизлайк на шум — блок начнёт подстраиваться под твои реальные вкусы, а не под абстрактную "умность".
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-zinc-800/60 bg-zinc-950/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-zinc-500">Система учится по семантике</p>
          <p className="mt-1 text-sm text-zinc-300">
            copied {profile.copiedCount} · implemented {profile.implementedCount} · disliked {profile.dislikedCount}
          </p>
        </div>
        <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-[10px] text-zinc-400">
          feedback cloud-synced
        </span>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-zinc-600">Что чаще заходит</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {profile.preferredTags.length > 0 ? (
              profile.preferredTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-200"
                >
                  #{tag}
                </span>
              ))
            ) : (
              <span className="text-xs text-zinc-500">Пока мало сигнала — система ещё присматривается.</span>
            )}
          </div>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-widest text-zinc-600">Что лучше не форсить</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {profile.avoidedTags.length > 0 ? (
              profile.avoidedTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-rose-500/20 bg-rose-500/10 px-2 py-1 text-[10px] text-rose-200"
                >
                  #{tag}
                </span>
              ))
            ) : (
              <span className="text-xs text-zinc-500">Пока нет устойчивых анти-паттернов.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RecommendationCard({
  recommendation,
  onCopy,
  onDislike,
  onImplemented,
}: {
  recommendation: AgentRecommendation;
  onCopy: (recommendation: AgentRecommendation) => void;
  onDislike: (recommendation: AgentRecommendation) => void;
  onImplemented: (recommendation: AgentRecommendation) => void;
}) {
  return (
    <article className={`rounded-3xl border p-4 shadow-lg shadow-black/10 ${LEVEL_CARD_CLS[recommendation.level]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-50">{recommendation.title}</p>
          <p className="mt-2 text-xs text-zinc-400">{recommendation.context}</p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${LEVEL_PILL_CLS[recommendation.level]}`}>
            {LEVEL_LABEL[recommendation.level]}
          </span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${STATUS_CLS[recommendation.status]}`}>
            {STATUS_LABEL[recommendation.status]}
          </span>
        </div>
      </div>

      <p className="mt-3 text-sm text-zinc-200">{recommendation.impact}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="rounded-full border border-zinc-800 bg-zinc-950/60 px-2 py-1 text-[10px] text-zinc-400">
          effort {recommendation.effort}
        </span>
        {recommendation.tags.map((tag) => (
          <span key={tag} className="rounded-full border border-zinc-800 bg-zinc-950/60 px-2 py-1 text-[10px] text-zinc-400">
            #{tag}
          </span>
        ))}
      </div>

      <details className="mt-3 rounded-2xl border border-zinc-800/70 bg-zinc-950/35 p-3">
        <summary className="cursor-pointer list-none text-xs font-medium text-zinc-300">
          Показать prompt для IDE
        </summary>
        <pre className="mt-3 whitespace-pre-wrap text-xs leading-5 text-zinc-400">{recommendation.prompt}</pre>
      </details>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onCopy(recommendation)}
          className="rounded-xl border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-100 transition hover:border-sky-400/40"
        >
          {recommendation.status === "copied" ? "Скопировать снова" : "Скопировать prompt"}
        </button>
        <button
          type="button"
          onClick={() => onDislike(recommendation)}
          className="rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
        >
          Дизлайк
        </button>
        <button
          type="button"
          onClick={() => onImplemented(recommendation)}
          className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100 transition hover:border-emerald-400/40"
        >
          Уже реализовано
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-[10px] text-zinc-500">
        <span>
          copy {recommendation.feedback.copied} · impl {recommendation.feedback.implemented} · dislike {recommendation.feedback.disliked}
        </span>
        <Link href={recommendation.href} className="text-zinc-400 transition hover:text-zinc-200">
          открыть источник →
        </Link>
      </div>
    </article>
  );
}

export function AgentControlPanel({
  snapshot,
  onFlash,
}: {
  snapshot: AgentControlSnapshot;
  onFlash?: (payload: FlashPayload) => void;
}) {
  const [feedbackEvents, setFeedbackEvents] = useState<RecommendationFeedbackEvent[]>([]);
  const [inlineFlash, setInlineFlash] = useState<FlashPayload | null>(null);

  useEffect(() => {
    setFeedbackEvents(getRecommendationFeedbackEvents());

    return subscribeAppDataChange((keys) => {
      if (keys.includes(AGENT_PROMPT_FEEDBACK_KEY)) {
        setFeedbackEvents(getRecommendationFeedbackEvents());
      }
    });
  }, []);

  useEffect(() => {
    if (!inlineFlash) return;

    const timeoutId = window.setTimeout(() => setInlineFlash(null), 2200);
    return () => window.clearTimeout(timeoutId);
  }, [inlineFlash]);

  const recommendations = useMemo(
    () => buildAgentRecommendations(snapshot, feedbackEvents),
    [feedbackEvents, snapshot],
  );

  const notify = useCallback((payload: FlashPayload) => {
    if (onFlash) {
      onFlash(payload);
      return;
    }

    setInlineFlash(payload);
  }, [onFlash]);

  const commitFeedback = useCallback((recommendation: AgentRecommendation, action: "copied" | "implemented" | "disliked") => {
    recordRecommendationFeedback({
      recommendationId: recommendation.id,
      action,
      tags: recommendation.tags,
    });

    setFeedbackEvents(getRecommendationFeedbackEvents());

    if (action === "copied") {
      notify({ tone: "success", text: `Prompt скопирован: ${recommendation.title}` });
      return;
    }

    notify({
      tone: action === "implemented" ? "success" : "info",
      text:
        action === "implemented"
          ? `Отмечено как реализованное: ${recommendation.title}`
          : `Скрыто из активных советов: ${recommendation.title}`,
    });
  }, [notify]);

  const handleCopy = useCallback(async (recommendation: AgentRecommendation) => {
    try {
      await copyText(recommendation.prompt);
      commitFeedback(recommendation, "copied");
    } catch {
      notify({
        tone: "info",
        text: "Не удалось записать в буфер обмена. Открой prompt и скопируй вручную.",
      });
    }
  }, [commitFeedback, notify]);

  return (
    <section className="rounded-4xl border border-zinc-800/60 bg-linear-to-br from-zinc-900/50 to-zinc-950/90 p-5 shadow-2xl shadow-black/20 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h2 className="text-lg font-semibold text-zinc-50">🧭 Agent cockpit</h2>
          <p className="mt-1 text-sm text-zinc-400">{snapshot.modeStatement}</p>
          <p className="mt-3 text-sm text-zinc-300">{snapshot.narrative}</p>

          {inlineFlash && (
            <div
              className={`mt-3 inline-flex rounded-2xl border px-3 py-2 text-xs shadow-lg shadow-black/20 ${
                inlineFlash.tone === "success"
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                  : "border-sky-500/20 bg-sky-500/10 text-sky-200"
              }`}
            >
              {inlineFlash.text}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-zinc-800/70 bg-zinc-950/50 px-4 py-3 text-right">
          <p className="text-[10px] uppercase tracking-widest text-zinc-500">Индекс баланса</p>
          <p className="mt-1 text-3xl font-bold text-zinc-50">{snapshot.balanceScore}</p>
          <p className="text-[11px] text-zinc-500">чем ровнее, тем меньше хаоса</p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <RadarWheel areas={snapshot.areas} balanceScore={snapshot.balanceScore} />

        <div className="space-y-3">
          <div className="rounded-3xl border border-zinc-800/60 bg-zinc-950/40 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-zinc-50">🤖 AI prompts для среды разработки</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Карточки строятся из текущего контекста ALPHACORE и подстраиваются по copy / dislike / implemented.
                </p>
              </div>
              <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-[10px] text-zinc-400">
                {recommendations.length} активных
              </span>
            </div>
          </div>

          {recommendations.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-3">
              {recommendations.map((recommendation) => (
                <RecommendationCard
                  key={recommendation.id}
                  recommendation={recommendation}
                  onCopy={handleCopy}
                  onDislike={(item) => commitFeedback(item, "disliked")}
                  onImplemented={(item) => commitFeedback(item, "implemented")}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed border-zinc-800 bg-zinc-950/30 p-6 text-sm text-zinc-500">
              Активные советы скрыты твоим недавним feedback. Как только контекст поменяется или появятся новые сигналы, блок предложит следующую волну prompts.
            </div>
          )}

          <LearningProfile feedbackEvents={feedbackEvents} />
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
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${LEVEL_PILL_CLS[area.level]}`}>
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
