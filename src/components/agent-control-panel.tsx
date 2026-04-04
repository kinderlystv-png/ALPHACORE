"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AGENT_CLARIFICATION_FEEDBACK_KEY,
  FEEDBACK_REASON_LABEL,
  FEEDBACK_REASON_ORDER,
  FEEDBACK_REASON_SHORT_LABEL,
  AGENT_PROMPT_FEEDBACK_KEY,
  buildAgentPracticalPlan,
  buildClarificationLearningProfile,
  buildAgentRecommendations,
  buildRecommendationProfile,
  buildRecommendationRuntimeContext,
  getClarificationAnswerEvents,
  getRecommendationFeedbackEvents,
  recordRecommendationFeedback,
  type AgentClarificationAnswerEvent,
  type AgentRecommendation,
  type AgentPracticalPlan,
  type RecommendationFeedbackEvent,
  type RecommendationFeedbackReason,
  type RecommendationRuntimeContext,
  type RecommendationStatus,
} from "@/lib/agent-recommendations";
import {
  type AgentControlSnapshot,
  type AttentionArea,
  type AttentionLevel,
} from "@/lib/agent-control";
import { getMetricLabel } from "@/lib/heys-day-mode";
import { activeHabits, getChecks, streak, todayStr } from "@/lib/habits";
import { getJournalEntries } from "@/lib/journal";
import { getEntries as getMedicalEntries } from "@/lib/medical";
import { getProjects } from "@/lib/projects";
import { getScheduleForDate } from "@/lib/schedule";
import { subscribeAppDataChange } from "@/lib/storage";
import { getTasks } from "@/lib/tasks";

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

type DayModeTone = NonNullable<AgentControlSnapshot["heysDayMode"]>["tone"];

function getDayModePillCls(tone: DayModeTone): string {
  if (tone === "good") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
  if (tone === "warn") return "border-amber-500/20 bg-amber-500/10 text-amber-300";
  if (tone === "bad") return "border-rose-500/20 bg-rose-500/10 text-rose-300";
  return "border-zinc-800 bg-zinc-900/60 text-zinc-300";
}

const STATUS_LABEL: Record<RecommendationStatus, string> = {
  new: "новое",
  copied: "скопировано",
  implemented: "реализовано",
  disliked: "скрыто",
  stale: "устарело",
};

const STATUS_CLS: Record<RecommendationStatus, string> = {
  new: "border-zinc-700 bg-zinc-900/60 text-zinc-300",
  copied: "border-sky-500/20 bg-sky-500/10 text-sky-200",
  implemented: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
  disliked: "border-zinc-800 bg-zinc-950/60 text-zinc-500",
  stale: "border-amber-500/20 bg-amber-500/10 text-amber-100",
};

type FlashPayload = {
  tone: "success" | "info";
  text: string;
};

const RUNTIME_CONTEXT_KEYS = new Set([
  "alphacore_tasks",
  "alphacore_projects",
  "alphacore_journal",
  "alphacore_habits",
  "alphacore_medical",
  "alphacore_schedule_custom",
  "alphacore_schedule_overrides",
]);

function dateFromKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

function collectUpcomingSchedule(today: string, days = 7) {
  const start = dateFromKey(today);
  const slots = [] as ReturnType<typeof getScheduleForDate>;

  for (let index = 0; index < days; index += 1) {
    const next = new Date(start);
    next.setDate(start.getDate() + index);
    slots.push(...getScheduleForDate(next));
  }

  return slots;
}

function loadRuntimeContext(snapshot: AgentControlSnapshot): RecommendationRuntimeContext {
  const today = todayStr();
  const todayDate = dateFromKey(today);

  return buildRecommendationRuntimeContext({
    today,
    tasks: getTasks(),
    projects: getProjects(),
    journalEntries: getJournalEntries(),
    activeHabitsToday: activeHabits(todayDate),
    habitChecksToday: getChecks(today),
    habitStreak: streak(),
    medicalEntries: getMedicalEntries(),
    todaySchedule: getScheduleForDate(today),
    upcomingSchedule: collectUpcomingSchedule(today, 7),
    heysDayMode: snapshot.heysDayMode,
  });
}

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

function buildBundleOrchestrationPrompt(
  recommendations: AgentRecommendation[],
  practicalPlan: AgentPracticalPlan | null,
): string {
  const titles = recommendations.map((recommendation) => `«${recommendation.title}»`);
  const titleLine =
    titles.length > 0
      ? `Фокус текущего пакета: ${titles.join(", ")}.`
      : null;

  return [
    "Ниже — пакет рекомендаций из ALPHACORE.",
    titleLine,
    "Сначала посмотри на готовый synthesis ниже, потом используй сырые сигналы только чтобы уточнить решение.",
    "Не отвечай на них как на отдельные длинные заметки.",
    "Сначала убери дубли и пересечения, потом собери один практический план.",
    "Перед финальным ответом обязательно сделай task-evaluation pass по живым задачам из ALPHACORE.",
    "Если хотя бы одна задача требует раскрытия, definition of done, срока, слота или развязки приоритетов — не отвечай сразу.",
    "Сначала задай до 5 коротких уточняющих вопросов.",
    "Если среда поддерживает интерактивные вопросы с вариантами выбора и свободным вводом — используй их; иначе задай те же вопросы текстом.",
    "После ответов пользователя, если у тебя есть доступ к ALPHACORE CLI/API, сохрани learning-signal из этих ответов и только потом давай финальный synthesis.",
    practicalPlan?.planningContourSummary ?? null,
    practicalPlan?.clarificationQuestions.length
      ? `Ниже уже есть suggested question-pass на ${practicalPlan.clarificationQuestions.length} вопрос(а/ов).`
      : null,
    "",
    "Что мне нужно:",
    "- выбери 1 главный шаг на сегодня;",
    "- если один из блоков про восстановление — выбери 1 невыбиваемое окно восстановления на неделю;",
    "- если один из блоков про review / осмысление — собери 1 короткий review: что движется, что буксует, что сейчас главное;",
    "- если блоки пересекаются — объедини их, а не дублируй;",
    "- не пересказывай контекст обратно, используй его только для решения.",
    "",
    "Формат ответа:",
    "- Главное решение сейчас",
    "- 2 запасных хода",
    "- Критерий done",
    "- Что обновить в ALPHACORE:",
    "  - 1 запись в Tasks",
    "  - 1 изменение в Calendar / Schedule",
    "  - 1 запись в Journal",
    "",
    "Важно:",
    "- без коучинговой воды;",
    "- без повторов между блоками;",
    "- без 10 равновесных советов;",
    "- если видишь конфликт между задачами и энергией — режь план, а не раздувай его;",
    "- если идея из пакета реально внедрена — после этого отметь карточку как «Уже реализовано»;",
    "- если совет не подошёл или сознательно отвергнут — поставь «Дизлайк» с причиной: timing-stale / wrong-scope / energy-mismatch / duplicate / too-broad;",
    "- не оставляй сильные сигналы нейтральными: иначе ALPHACORE хуже учится семантике;",
    "- ответ должен помогать действовать сегодня, а не просто красиво анализировать ситуацию.",
    "",
    "Ниже сами сигналы из ALPHACORE:",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPracticalPlanSection(plan: AgentPracticalPlan): string {
  const sections = [
    "### 0. Практический plan ALPHACORE",
    ...(plan.planningContourSummary
      ? ["Единый контур", plan.planningContourSummary, ""]
      : []),
    ...(plan.clarificationQuestions.length > 0
      ? [
          "Сначала уточнить у пользователя",
          "Если среда умеет интерактивные уточнения с вариантами выбора — используй их; свободный ввод не отключай.",
          ...plan.clarificationQuestions.flatMap((question, index) => [
            `${index + 1}. ${question.question}`,
            `   Варианты: ${question.options.join(" · ")}${question.allowFreeform ? " · свой вариант" : ""}`,
          ]),
          "",
          "Ниже — черновой synthesis до ответов на эти вопросы.",
          "",
        ]
      : []),
    ...(plan.mergedThemes.length > 0
      ? [
          "Сшитые пересечения:",
          ...plan.mergedThemes.map((theme) => `- ${theme}`),
          "",
        ]
      : []),
    ...(plan.dayModeLabel
      ? [
          "Режим дня",
          `${plan.dayModeLabel}${plan.dayModeFocus ? ` → ${plan.dayModeFocus.toLowerCase()}` : ""}`,
          ...(plan.dayModeSummary ? [plan.dayModeSummary] : []),
          ...(plan.dayModeTactics.length > 0
            ? ["Тактика режима", ...plan.dayModeTactics.map((item) => `- ${item}`)]
            : []),
          ...(plan.dayModeNoGo.length > 0
            ? ["Не делать", ...plan.dayModeNoGo.map((item) => `- ${item}`)]
            : []),
          "",
        ]
      : []),
    "Главное решение сейчас",
    plan.mainDecision,
    "",
    "2 запасных хода",
    ...plan.backupMoves.map((move) => `- ${move}`),
    "",
    ...(plan.review
      ? ["Короткий review", plan.review, ""]
      : []),
    ...(plan.taskWindows.length > 0
      ? [
          "Окна под накопившиеся задачи",
          ...plan.taskWindows.map((window) => `- ${window}`),
          ...(plan.overflowSummary ? [plan.overflowSummary] : []),
          "",
        ]
      : plan.overflowSummary
        ? ["Окна под накопившиеся задачи", plan.overflowSummary, ""]
        : []),
    "Критерий done",
    plan.doneCriterion,
    "",
    "Что обновить в ALPHACORE:",
    `- Tasks: ${plan.updates.task}`,
    `- Calendar / Schedule: ${plan.updates.schedule}`,
    `- Journal: ${plan.updates.journal}`,
  ];

  return sections.join("\n");
}

function buildPromptBundle(
  recommendations: AgentRecommendation[],
  practicalPlan: AgentPracticalPlan | null,
): string {
  const orchestrationPrompt = buildBundleOrchestrationPrompt(recommendations, practicalPlan);
  const promptSections = recommendations
    .map((recommendation, index) => [`### ${index + 1}. ${recommendation.title}`, recommendation.prompt].join("\n"))
    .join("\n\n---\n\n");

  return [
    orchestrationPrompt,
    practicalPlan ? buildPracticalPlanSection(practicalPlan) : null,
    promptSections,
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");
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

function LearningProfile({
  feedbackEvents,
  clarificationAnswerEvents,
}: {
  feedbackEvents: RecommendationFeedbackEvent[];
  clarificationAnswerEvents: AgentClarificationAnswerEvent[];
}) {
  const profile = useMemo(() => buildRecommendationProfile(feedbackEvents), [feedbackEvents]);
  const clarificationProfile = useMemo(
    () => buildClarificationLearningProfile(clarificationAnswerEvents),
    [clarificationAnswerEvents],
  );

  if (feedbackEvents.length === 0 && clarificationAnswerEvents.length === 0) {
    return (
      <div className="rounded-3xl border border-zinc-800/60 bg-zinc-950/40 p-4">
        <p className="text-[10px] uppercase tracking-widest text-zinc-500">Система учится по реакциям</p>
        <p className="mt-2 text-sm text-zinc-300">
          Если идея реально пошла в работу — отмечай её как «Уже реализовано». Если совет мимо — жми дизлайк. Иначе блок видит только копирование и хуже учится твоей реальной семантике.
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
            copied {profile.copiedCount} · implemented {profile.implementedCount} · disliked {profile.dislikedCount} · clarify {clarificationProfile.totalAnswers}
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

        <div className="md:col-span-2">
          <p className="text-[10px] uppercase tracking-widest text-zinc-600">Почему советы чаще мимо</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {profile.topDislikeReasons.length > 0 ? (
              profile.topDislikeReasons.map(({ reason, count }) => (
                <span
                  key={reason}
                  className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-100"
                  title={FEEDBACK_REASON_LABEL[reason]}
                >
                  {FEEDBACK_REASON_SHORT_LABEL[reason]} · {count}
                </span>
              ))
            ) : (
              <span className="text-xs text-zinc-500">Пока мало reason-coded сигнала.</span>
            )}
          </div>
        </div>

        <div className="md:col-span-2">
          <p className="text-[10px] uppercase tracking-widest text-zinc-600">Что видно по ответам на уточнения</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {clarificationProfile.topSignals.length > 0 ? (
              clarificationProfile.topSignals.map(({ signal, label, count }) => (
                <span
                  key={signal}
                  className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-1 text-[10px] text-sky-100"
                  title={label}
                >
                  {label} · {count}
                </span>
              ))
            ) : (
              <span className="text-xs text-zinc-500">
                Когда агент начнёт сохранять ответы на уточняющие вопросы, здесь появятся паттерны вроде «черновик &gt; финал» и «сначала слот, потом делать».
              </span>
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
  onOpenReasonPicker,
  onDislikeWithReason,
  onImplemented,
  reasonPickerOpen,
}: {
  recommendation: AgentRecommendation;
  onCopy: (recommendation: AgentRecommendation) => void;
  onOpenReasonPicker: (recommendation: AgentRecommendation) => void;
  onDislikeWithReason: (recommendation: AgentRecommendation, reason: RecommendationFeedbackReason) => void;
  onImplemented: (recommendation: AgentRecommendation) => void;
  reasonPickerOpen: boolean;
}) {
  return (
    <article className={`flex h-full flex-col rounded-3xl border p-4 shadow-lg shadow-black/10 ${LEVEL_CARD_CLS[recommendation.level]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-50">{recommendation.title}</p>
          <p className="mt-2 text-xs text-zinc-400">{recommendation.context}</p>
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${LEVEL_PILL_CLS[recommendation.level]}`}>
            {LEVEL_LABEL[recommendation.level]}
          </span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${STATUS_CLS[recommendation.status]}`}>
            {STATUS_LABEL[recommendation.status]}
          </span>
        </div>
      </div>

      <p className="mt-3 text-sm text-zinc-200">{recommendation.impact}</p>

      {recommendation.staleReason && (
        <div className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          Авто-stale: {FEEDBACK_REASON_LABEL[recommendation.staleReason]}.

          {recommendation.replacementAction && (
            <p className="mt-2 text-amber-50">
              Вместо этого: {recommendation.replacementAction}
            </p>
          )}
        </div>
      )}

      {recommendation.signals.length > 0 && (
        <ul className="mt-3 space-y-1.5 rounded-2xl border border-zinc-800/70 bg-zinc-950/35 p-3 text-xs text-zinc-300">
          {recommendation.signals.map((signal) => (
            <li key={signal} className="flex gap-2">
              <span className="mt-0.5 text-zinc-600">•</span>
              <span>{signal}</span>
            </li>
          ))}
        </ul>
      )}

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
          onClick={() => onOpenReasonPicker(recommendation)}
          className="rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
        >
          Почему мимо…
        </button>
        <button
          type="button"
          onClick={() => onImplemented(recommendation)}
          className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100 transition hover:border-emerald-400/40"
        >
          Уже реализовано
        </button>
      </div>

      {reasonPickerOpen && (
        <div className="mt-3 flex flex-wrap gap-1.5 rounded-2xl border border-zinc-800/70 bg-zinc-950/35 p-3">
          {FEEDBACK_REASON_ORDER.map((reason) => (
            <button
              key={reason}
              type="button"
              onClick={() => onDislikeWithReason(recommendation, reason)}
              className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] text-amber-100 transition hover:border-amber-400/40"
              title={FEEDBACK_REASON_LABEL[reason]}
            >
              {FEEDBACK_REASON_SHORT_LABEL[reason]}
            </button>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-3 pt-3 text-[10px] text-zinc-500">
        <span>
          copy {recommendation.feedback.copied} · impl {recommendation.feedback.implemented} · dislike {recommendation.feedback.disliked}
        </span>
        <Link href={recommendation.href} className="text-zinc-400 transition hover:text-zinc-200">
          открыть источник →
        </Link>
      </div>

      {(recommendation.latestReason || recommendation.staleReason) && (
        <p className="mt-2 text-[10px] text-zinc-500">
          {recommendation.latestReason
            ? `Последняя причина: ${FEEDBACK_REASON_LABEL[recommendation.latestReason]}`
            : `Stale-сигнал: ${FEEDBACK_REASON_LABEL[recommendation.staleReason!]}`}
        </p>
      )}
    </article>
  );
}

function PracticalPlanCard({ plan }: { plan: AgentPracticalPlan }) {
  return (
    <section className="rounded-3xl border border-sky-500/20 bg-linear-to-br from-sky-950/20 via-zinc-950/70 to-zinc-950/90 p-4 shadow-lg shadow-black/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-50">🎯 One practical plan</p>
          <p className="mt-1 text-xs text-zinc-500">
            Сначала одно решение, потом уже сырьё карточек. Этот synthesis также попадает в copy-all bundle.
          </p>
        </div>

        {plan.mergedThemes.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {plan.mergedThemes.map((theme) => (
              <span
                key={theme}
                className="rounded-full border border-sky-500/15 bg-sky-500/10 px-2 py-1 text-[10px] text-sky-100"
              >
                {theme}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.9fr)]">
        <div className="space-y-4">
          {plan.dayModeLabel && (
            <div className="rounded-3xl border border-sky-500/20 bg-sky-500/5 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[10px] text-sky-100">
                  {plan.dayModeLabel}
                </span>
                {plan.dayModeFocus && (
                  <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-[10px] text-zinc-400">
                    фокус: {plan.dayModeFocus.toLowerCase()}
                  </span>
                )}
              </div>

              {plan.dayModeSummary && (
                <p className="mt-3 text-sm text-zinc-300">{plan.dayModeSummary}</p>
              )}

              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {plan.dayModeTactics.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500">Тактика режима</p>
                    <ul className="mt-2 space-y-2 text-sm text-zinc-300">
                      {plan.dayModeTactics.map((item) => (
                        <li key={item} className="flex gap-2">
                          <span className="mt-0.5 text-zinc-600">•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {plan.dayModeNoGo.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500">Не делать</p>
                    <ul className="mt-2 space-y-2 text-sm text-zinc-400">
                      {plan.dayModeNoGo.map((item) => (
                        <li key={item} className="flex gap-2">
                          <span className="mt-0.5 text-zinc-600">•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {plan.planningContourSummary && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-zinc-500">Единый контур</p>
              <p className="mt-2 text-sm text-zinc-300">{plan.planningContourSummary}</p>
            </div>
          )}

          {plan.clarificationQuestions.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-zinc-500">Сначала спросить</p>
              <ul className="mt-2 space-y-3 text-sm text-zinc-200">
                {plan.clarificationQuestions.map((question) => (
                  <li key={question.id} className="rounded-2xl border border-zinc-800/70 bg-zinc-950/35 p-3">
                    <p>{question.question}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {question.options.map((option) => (
                        <span
                          key={option}
                          className="rounded-full border border-sky-500/15 bg-sky-500/10 px-2 py-1 text-[10px] text-sky-100"
                        >
                          {option}
                        </span>
                      ))}
                      {question.allowFreeform && (
                        <span className="rounded-full border border-zinc-800 bg-zinc-950/60 px-2 py-1 text-[10px] text-zinc-400">
                          свой вариант
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-zinc-500">
                Если среда умеет интерактивные уточнения с вариантами выбора, сначала прогоняй этот mini-interview, а уже потом давай финальный план.
              </p>
            </div>
          )}

          <div>
            <p className="text-[10px] uppercase tracking-widest text-zinc-500">Главное решение сейчас</p>
            <p className="mt-2 text-sm text-zinc-100">{plan.mainDecision}</p>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest text-zinc-500">2 запасных хода</p>
            <ul className="mt-2 space-y-2 text-sm text-zinc-300">
              {plan.backupMoves.map((move) => (
                <li key={move} className="flex gap-2">
                  <span className="mt-0.5 text-zinc-600">•</span>
                  <span>{move}</span>
                </li>
              ))}
            </ul>
          </div>

          {plan.review && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-zinc-500">Короткий review</p>
              <p className="mt-2 text-sm text-zinc-300">{plan.review}</p>
            </div>
          )}

          {(plan.taskWindows.length > 0 || plan.overflowSummary) && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-zinc-500">Окна под накопившиеся задачи</p>
              <ul className="mt-2 space-y-2 text-sm text-zinc-300">
                {plan.taskWindows.map((window) => (
                  <li key={window} className="flex gap-2">
                    <span className="mt-0.5 text-zinc-600">•</span>
                    <span>{window}</span>
                  </li>
                ))}
                {plan.overflowSummary && (
                  <li className="flex gap-2 text-zinc-400">
                    <span className="mt-0.5 text-zinc-600">•</span>
                    <span>{plan.overflowSummary}</span>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        <div className="space-y-4 rounded-3xl border border-zinc-800/70 bg-zinc-950/45 p-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-zinc-500">Критерий done</p>
            <p className="mt-2 text-sm text-zinc-100">{plan.doneCriterion}</p>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest text-zinc-500">Что обновить в ALPHACORE</p>
            <ul className="mt-2 space-y-2 text-sm text-zinc-300">
              <li>
                <span className="text-zinc-500">Tasks:</span> {plan.updates.task}
              </li>
              <li>
                <span className="text-zinc-500">Calendar / Schedule:</span> {plan.updates.schedule}
              </li>
              <li>
                <span className="text-zinc-500">Journal:</span> {plan.updates.journal}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
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
  const [clarificationAnswerEvents, setClarificationAnswerEvents] = useState<AgentClarificationAnswerEvent[]>([]);
  const [runtimeContext, setRuntimeContext] = useState<RecommendationRuntimeContext | null>(null);
  const [inlineFlash, setInlineFlash] = useState<FlashPayload | null>(null);
  const [reasonPickerId, setReasonPickerId] = useState<string | null>(null);

  const refreshRuntimeContext = useCallback(() => {
    setRuntimeContext(loadRuntimeContext(snapshot));
  }, [snapshot]);

  useEffect(() => {
    setFeedbackEvents(getRecommendationFeedbackEvents());
    setClarificationAnswerEvents(getClarificationAnswerEvents());
    refreshRuntimeContext();

    return subscribeAppDataChange((keys) => {
      if (keys.includes(AGENT_PROMPT_FEEDBACK_KEY)) {
        setFeedbackEvents(getRecommendationFeedbackEvents());
      }

      if (keys.includes(AGENT_CLARIFICATION_FEEDBACK_KEY)) {
        setClarificationAnswerEvents(getClarificationAnswerEvents());
      }

      if (keys.some((key) => RUNTIME_CONTEXT_KEYS.has(key))) {
        refreshRuntimeContext();
      }
    });
  }, [refreshRuntimeContext]);

  useEffect(() => {
    if (!inlineFlash) return;

    const timeoutId = window.setTimeout(() => setInlineFlash(null), 2200);
    return () => window.clearTimeout(timeoutId);
  }, [inlineFlash]);

  const recommendations = useMemo(
    () => buildAgentRecommendations(snapshot, feedbackEvents, { runtimeContext }),
    [feedbackEvents, runtimeContext, snapshot],
  );

  const practicalPlan = useMemo(
    () => buildAgentPracticalPlan(recommendations, runtimeContext, clarificationAnswerEvents),
    [clarificationAnswerEvents, recommendations, runtimeContext],
  );

  const notify = useCallback((payload: FlashPayload) => {
    if (onFlash) {
      onFlash(payload);
      return;
    }

    setInlineFlash(payload);
  }, [onFlash]);

  const commitFeedback = useCallback((
    recommendation: AgentRecommendation,
    action: "copied" | "implemented" | "disliked",
    reason?: RecommendationFeedbackReason,
  ) => {
    recordRecommendationFeedback({
      recommendationId: recommendation.id,
      action,
      tags: recommendation.tags,
      reason: reason ?? null,
      contextHash: recommendation.contextHash,
    });

    setFeedbackEvents(getRecommendationFeedbackEvents());
    setReasonPickerId(null);

    if (action === "copied") {
      notify({ tone: "success", text: `Prompt скопирован: ${recommendation.title}` });
      return;
    }

    notify({
      tone: action === "implemented" ? "success" : "info",
      text:
        action === "implemented"
          ? `Отмечено как реализованное: ${recommendation.title}`
          : `Скрыто из активных советов: ${recommendation.title}${reason ? ` · ${FEEDBACK_REASON_SHORT_LABEL[reason]}` : ""}`,
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

  const handleCopyAll = useCallback(async () => {
    if (recommendations.length === 0) return;

    try {
      await copyText(buildPromptBundle(recommendations, practicalPlan));

      for (const recommendation of recommendations) {
        recordRecommendationFeedback({
          recommendationId: recommendation.id,
          action: "copied",
          tags: recommendation.tags,
          contextHash: recommendation.contextHash,
        });
      }

      setFeedbackEvents(getRecommendationFeedbackEvents());
      notify({ tone: "success", text: `Скопирован пакет для агента: plan + ${recommendations.length} prompts` });
    } catch {
      notify({
        tone: "info",
        text: "Не удалось скопировать bundle prompts. Попробуй ещё раз или копируй по одному.",
      });
    }
  }, [notify, practicalPlan, recommendations]);

  return (
    <section className="rounded-4xl border border-zinc-800/60 bg-linear-to-br from-zinc-900/50 to-zinc-950/90 p-5 shadow-2xl shadow-black/20 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h2 className="text-lg font-semibold text-zinc-50">🧭 Agent cockpit</h2>
          <p className="mt-1 text-sm text-zinc-400">{snapshot.modeStatement}</p>
          {snapshot.heysDayMode && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-[10px] ${getDayModePillCls(snapshot.heysDayMode.tone)}`}>
                {snapshot.heysDayMode.label}
              </span>
              <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-[10px] text-zinc-400">
                фокус: {getMetricLabel(snapshot.heysDayMode.focusMetricKey).toLowerCase()}
              </span>
              {snapshot.heysDayMode.reasons.slice(0, 2).map((reason) => (
                <span
                  key={reason}
                  className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-[10px] text-zinc-400"
                >
                  {reason}
                </span>
              ))}
            </div>
          )}
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

      <div className="mt-5 grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <RadarWheel areas={snapshot.areas} balanceScore={snapshot.balanceScore} />

        <div className="space-y-3">
          <div className="rounded-3xl border border-zinc-800/60 bg-zinc-950/40 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-zinc-50">🤖 AI prompts для среды разработки</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {runtimeContext
                    ? `Карточки уже grounded в живых данных: ${runtimeContext.planning.unslottedTasks.length} задач без слота, ${runtimeContext.planning.calendarTasks.length} дел уже стоят в календаре, ${runtimeContext.projects.attention.length} проектов в tension, ${runtimeContext.schedule.studio.length} студийных событий и ${runtimeContext.journal.recent.length} свежих записей.${runtimeContext.heys.dayMode ? ` Текущий режим: ${runtimeContext.heys.dayMode.label}.` : ""}`
                    : "Карточки строятся из текущего контекста ALPHACORE и подстраиваются по copy / dislike / implemented."}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleCopyAll}
                  disabled={recommendations.length === 0}
                  className="rounded-xl border border-sky-500/20 bg-sky-500/10 px-3 py-1.5 text-[11px] font-medium text-sky-100 transition hover:border-sky-400/40 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900/60 disabled:text-zinc-500"
                >
                  Скопировать пакет prompts
                </button>
                <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-[10px] text-zinc-400">
                  {recommendations.length} активных
                </span>
                {runtimeContext?.heys.dayMode && (
                  <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-[10px] text-zinc-400">
                    mode-aware: {runtimeContext.heys.dayMode.label}
                  </span>
                )}
              </div>
            </div>
          </div>

          <LearningProfile
            feedbackEvents={feedbackEvents}
            clarificationAnswerEvents={clarificationAnswerEvents}
          />
        </div>
      </div>

      {practicalPlan && <div className="mt-4"><PracticalPlanCard plan={practicalPlan} /></div>}

      {recommendations.length > 0 ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {recommendations.map((recommendation) => (
            <RecommendationCard
              key={recommendation.id}
              recommendation={recommendation}
              onCopy={handleCopy}
              onOpenReasonPicker={(item) => setReasonPickerId((current) => current === item.id ? null : item.id)}
              onDislikeWithReason={(item, reason) => commitFeedback(item, "disliked", reason)}
              onImplemented={(item) => commitFeedback(item, "implemented")}
              reasonPickerOpen={reasonPickerId === recommendation.id}
            />
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-3xl border border-dashed border-zinc-800 bg-zinc-950/30 p-6 text-sm text-zinc-500">
          Активные советы скрыты твоим недавним feedback. Как только контекст поменяется или появятся новые сигналы, блок предложит следующую волну prompts.
        </div>
      )}

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
