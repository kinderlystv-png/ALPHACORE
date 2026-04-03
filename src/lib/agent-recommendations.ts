import type {
	AgentControlSnapshot,
	AgentPriority,
	AttentionArea,
	AttentionAreaKey,
	AttentionLevel,
} from "./agent-control";
import { lsGet, lsSet, uid } from "./storage";

export const AGENT_PROMPT_FEEDBACK_KEY = "alphacore_agent_prompt_feedback";

export type RecommendationFeedbackAction = "copied" | "implemented" | "disliked";
export type RecommendationStatus = "new" | RecommendationFeedbackAction;
export type RecommendationEffort = "S" | "M" | "L";

export type RecommendationFeedbackEvent = {
	id: string;
	recommendationId: string;
	action: RecommendationFeedbackAction;
	tags: string[];
	createdAt: string;
};

export type AgentRecommendation = {
	id: string;
	title: string;
	context: string;
	impact: string;
	prompt: string;
	href: string;
	level: AttentionLevel;
	effort: RecommendationEffort;
	tags: string[];
	status: RecommendationStatus;
	score: number;
	latestActionAt: string | null;
	feedback: {
		copied: number;
		implemented: number;
		disliked: number;
	};
};

export type RecommendationProfile = {
	preferredTags: string[];
	avoidedTags: string[];
	copiedCount: number;
	implementedCount: number;
	dislikedCount: number;
};

type RecommendationCandidate = {
	id: string;
	title: string;
	context: string;
	impact: string;
	prompt: string;
	href: string;
	level: AttentionLevel;
	effort: RecommendationEffort;
	tags: string[];
	weight: number;
};

const ACTION_WEIGHTS: Record<RecommendationFeedbackAction, number> = {
	copied: 1.2,
	implemented: 3.6,
	disliked: -4.4,
};

const BASE_WEIGHT: Record<AttentionLevel, number> = {
	critical: 96,
	watch: 72,
	good: 38,
};

const AREA_TAGS: Record<AttentionAreaKey, string[]> = {
	work: ["work", "project", "execution"],
	health: ["health", "energy", "medical"],
	family: ["family", "studio", "calendar"],
	operations: ["operations", "cleanup", "tasks"],
	reflection: ["reflection", "review", "planning"],
	recovery: ["recovery", "rest", "schedule"],
};

const AREA_EFFORT: Record<AttentionAreaKey, RecommendationEffort> = {
	work: "M",
	health: "S",
	family: "M",
	operations: "S",
	reflection: "S",
	recovery: "M",
};

const AREA_GENERIC_TITLE: Record<AttentionAreaKey, string> = {
	work: "Развернуть рабочий следующий шаг",
	health: "Собрать health floor на сегодня",
	family: "Защитить семейные окна на неделе",
	operations: "Снять операционный шум с головы",
	reflection: "Сделать короткий agent review",
	recovery: "Выбить окно восстановления",
};

const AREA_GENERIC_IMPACT: Record<AttentionAreaKey, string> = {
	work: "Получишь один ясный рычаг вместо размазанной фоновой тревоги.",
	health: "Снизишь энергетическую цену дня и не отдашь здоровье на потом.",
	family: "Неделя не съест семейную часть через студийную логистику.",
	operations: "Хвосты перестанут фонить и воровать фокус у главного.",
	reflection: "Вернётся смысл и иерархия вместо ручного перебора списков.",
	recovery: "Восстановление перестанет проигрывать случайной срочности.",
};

function nowIso(): string {
	return new Date().toISOString();
}

function daysSince(dateLike: string): number {
	const delta = Date.now() - new Date(dateLike).getTime();
	return Math.max(0, Math.floor(delta / 86_400_000));
}

function decay(createdAt: string, halfLifeDays = 21): number {
	const ageDays = daysSince(createdAt);
	return Math.exp((-Math.log(2) * ageDays) / halfLifeDays);
}

function isFeedbackEvent(value: unknown): value is RecommendationFeedbackEvent {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<RecommendationFeedbackEvent>;
	return (
		typeof candidate.id === "string" &&
		typeof candidate.recommendationId === "string" &&
		typeof candidate.createdAt === "string" &&
		(candidate.action === "copied" ||
			candidate.action === "implemented" ||
			candidate.action === "disliked") &&
		Array.isArray(candidate.tags)
	);
}

function sortEvents(events: RecommendationFeedbackEvent[]): RecommendationFeedbackEvent[] {
	return [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getRecommendationFeedbackEvents(): RecommendationFeedbackEvent[] {
	const raw = lsGet<unknown[]>(AGENT_PROMPT_FEEDBACK_KEY, []);
	return sortEvents(raw.filter(isFeedbackEvent));
}

export function recordRecommendationFeedback(input: {
	recommendationId: string;
	action: RecommendationFeedbackAction;
	tags: string[];
}): RecommendationFeedbackEvent {
	const event: RecommendationFeedbackEvent = {
		id: uid(),
		recommendationId: input.recommendationId,
		action: input.action,
		tags: [...new Set(input.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))],
		createdAt: nowIso(),
	};

	const next = sortEvents([...getRecommendationFeedbackEvents(), event]);
	lsSet(AGENT_PROMPT_FEEDBACK_KEY, next);
	return event;
}

function findPriorityForArea(
	area: AttentionArea,
	priorities: AgentPriority[],
): AgentPriority | null {
	switch (area.key) {
		case "work":
			return (
				priorities.find((priority) => priority.id.startsWith("project-")) ?? null
			);
		case "health":
			return priorities.find((priority) => priority.id === "health-floor") ?? null;
		case "family":
			return priorities.find((priority) => priority.id === "family-protection") ?? null;
		case "operations":
			return priorities.find((priority) => priority.id === "ops-overdue") ?? null;
		case "reflection":
			return priorities.find((priority) => priority.id === "reflection-reset") ?? null;
		case "recovery":
			return priorities.find((priority) => priority.id === "recovery-protect") ?? null;
		default:
			return null;
	}
}

function buildPrompt(
	snapshot: AgentControlSnapshot,
	area: AttentionArea,
	priority: AgentPriority | null,
): string {
	const contextLines = [
		`Контекст ALPHACORE:`,
		`- Баланс: ${snapshot.balanceScore}/100`,
		`- Зона: ${area.label} (${area.level})`,
		`- Почему сейчас: ${priority?.reason ?? area.insight}`,
		`- Текущая сводка: ${area.summary}`,
		...area.evidence.slice(0, 2).map((item) => `- Сигнал: ${item}`),
		"",
	];

	const askByArea: Record<AttentionAreaKey, string[]> = {
		work: [
			"Сделай сильный запрос для AI-агента в IDE по рабочему направлению.",
			"Разверни текущий next step в 2–3 конкретных действия и выбери одно главное на сегодня.",
			"Добавь критерий done и короткий follow-up, который потом можно внести обратно в ALPHACORE.",
		],
		health: [
			"Сделай рабочий health-prompt для AI-агента.",
			"Собери минимальный health floor на сегодня: сон, растяжка, бег/прогулка, follow-up по анализам.",
			"План должен быть реалистичным, без героизма и с одной минимальной победой до вечера.",
		],
		family: [
			"Сделай prompt для защиты семейной части недели.",
			"Накидай буферы, логистику и 1–2 решения, как не дать студии съесть семейные окна.",
			"Нужен короткий план на 3–7 дней вперёд с минимальным ручным контролем.",
		],
		operations: [
			"Сделай prompt на операционный разбор хвостов.",
			"Раздели всё на удалить / перенести / сделать первым и убери лишний шум из inbox.",
			"Ответ нужен в формате triage, без воды и с одним первым действием на сегодня.",
		],
		reflection: [
			"Сделай короткий review-prompt для AI-агента.",
			"Пусть агент разберёт: что движется, что буксует, какой один следующий шаг даст максимум эффекта.",
			"Ответ должен обновить фокус, а не породить новый склад задач.",
		],
		recovery: [
			"Сделай prompt на восстановление и ритм недели.",
			"Найди хотя бы одно невыбиваемое окно восстановления и увяжи его с текущим графиком.",
			"План должен защищать энергию, а не требовать отдельного подвига.",
		],
	};

	const formatLines = [
		"",
		"Формат ответа:",
		"- 1 главный шаг",
		"- 2 запасных хода",
		"- критерий done",
		"- что обновить в ALPHACORE после выполнения",
	];

	return [...contextLines, ...askByArea[area.key], ...formatLines].join("\n");
}

function buildCandidates(snapshot: AgentControlSnapshot): RecommendationCandidate[] {
	return snapshot.areas.map((area) => {
		const priority = findPriorityForArea(area, snapshot.priorities);
		const tags = [...AREA_TAGS[area.key]];

		if (priority?.id.startsWith("project-")) tags.push("next-step");
		if (priority?.id === "ops-overdue") tags.push("overdue");
		if (priority?.id === "reflection-reset") tags.push("review");
		if (priority?.id === "health-floor") tags.push("routine");

		return {
			id: priority ? `advice-${priority.id}` : `advice-area-${area.key}`,
			title: priority?.title ?? AREA_GENERIC_TITLE[area.key],
			context: priority?.reason ?? area.insight,
			impact: priority?.action ?? AREA_GENERIC_IMPACT[area.key],
			prompt: buildPrompt(snapshot, area, priority),
			href: priority?.href ?? area.href,
			level: priority?.level ?? area.level,
			effort: AREA_EFFORT[area.key],
			tags: [...new Set(tags)],
			weight:
				BASE_WEIGHT[priority?.level ?? area.level] +
				Math.max(0, Math.round((100 - area.score) / 3)) +
				(priority ? 12 : 0),
		};
	});
}

function buildFeedbackCounts(events: RecommendationFeedbackEvent[]): {
	copied: number;
	implemented: number;
	disliked: number;
} {
	return events.reduce(
		(acc, event) => {
			acc[event.action] += 1;
			return acc;
		},
		{ copied: 0, implemented: 0, disliked: 0 },
	);
}

function buildTagScores(events: RecommendationFeedbackEvent[]): Map<string, number> {
	const scores = new Map<string, number>();

	for (const event of events) {
		const weight = ACTION_WEIGHTS[event.action] * decay(event.createdAt);

		for (const tag of event.tags) {
			scores.set(tag, (scores.get(tag) ?? 0) + weight);
		}
	}

	return scores;
}

export function buildRecommendationProfile(
	feedbackEvents: RecommendationFeedbackEvent[],
): RecommendationProfile {
	const counts = buildFeedbackCounts(feedbackEvents);
	const scores = buildTagScores(feedbackEvents);
	const entries = [...scores.entries()].sort((a, b) => b[1] - a[1]);

	return {
		preferredTags: entries
			.filter(([, score]) => score > 0.85)
			.slice(0, 3)
			.map(([tag]) => tag),
		avoidedTags: [...entries]
			.reverse()
			.filter(([, score]) => score < -0.85)
			.slice(0, 3)
			.map(([tag]) => tag),
		copiedCount: counts.copied,
		implementedCount: counts.implemented,
		dislikedCount: counts.disliked,
	};
}

export function buildAgentRecommendations(
	snapshot: AgentControlSnapshot,
	feedbackEvents: RecommendationFeedbackEvent[],
	limit = 3,
): AgentRecommendation[] {
	const candidates = buildCandidates(snapshot);
	const tagScores = buildTagScores(feedbackEvents);

	return candidates
		.filter((candidate) => {
			const latest = [...feedbackEvents]
				.reverse()
				.find((event) => event.recommendationId === candidate.id);

			if (!latest) return true;

			return !(
				(latest.action === "implemented" || latest.action === "disliked") &&
				daysSince(latest.createdAt) <= 14
			);
		})
		.map((candidate) => {
			const directEvents = feedbackEvents.filter(
				(event) => event.recommendationId === candidate.id,
			);
			const latest = directEvents[directEvents.length - 1] ?? null;
			const directScore = directEvents.reduce((sum, event) => {
				return sum + ACTION_WEIGHTS[event.action] * decay(event.createdAt);
			}, 0);
			const tagAffinity = candidate.tags.reduce((sum, tag) => sum + (tagScores.get(tag) ?? 0), 0);
			const counts = buildFeedbackCounts(directEvents);

			return {
				...candidate,
				status:
					latest && daysSince(latest.createdAt) <= 21 ? latest.action : "new",
				score: Math.round((candidate.weight + directScore * 6 + tagAffinity * 4) * 10) / 10,
				latestActionAt: latest?.createdAt ?? null,
				feedback: counts,
			} satisfies AgentRecommendation;
		})
		.sort((a, b) => b.score - a.score)
		.slice(0, limit);
}
