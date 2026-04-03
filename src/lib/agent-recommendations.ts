import type {
	AgentControlSnapshot,
	AgentPriority,
	AttentionArea,
	AttentionAreaKey,
	AttentionLevel,
} from "./agent-control";
import type { Habit } from "./habits";
import type { JournalEntry } from "./journal";
import { paramStatus, type MedEntry, type MedParam } from "./medical";
import type { Project, StatusTone } from "./projects";
import type { ScheduleSlot } from "./schedule";
import { lsGet, lsSet, uid } from "./storage";
import { compareTasksByAttention, type Task } from "./tasks";

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
	signals: string[];
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

export type RecommendationMedicalFlag = {
	entry: MedEntry;
	param: MedParam;
	status: "low" | "high";
};

export type RecommendationSchedulePressureDay = {
	date: string;
	slots: ScheduleSlot[];
	load: number;
};

export type RecommendationRuntimeInput = {
	today: string;
	tasks: Task[];
	projects: Project[];
	journalEntries: JournalEntry[];
	activeHabitsToday: Habit[];
	habitChecksToday: Record<string, boolean>;
	habitStreak: number;
	medicalEntries: MedEntry[];
	todaySchedule: ScheduleSlot[];
	upcomingSchedule: ScheduleSlot[];
};

export type RecommendationRuntimeContext = {
	today: string;
	tasks: {
		actionable: Task[];
		overdue: Task[];
		dueSoon: Task[];
		unscheduled: Task[];
		p1: Task[];
	};
	projects: {
		attention: Project[];
		birthday: Project | null;
	};
	journal: {
		recent: JournalEntry[];
		hotTags: string[];
	};
	habits: {
		activeToday: Habit[];
		missingToday: Habit[];
		completedToday: Habit[];
		streak: number;
	};
	medical: {
		latestEntry: MedEntry | null;
		flags: RecommendationMedicalFlag[];
	};
	schedule: {
		today: ScheduleSlot[];
		studio: ScheduleSlot[];
		cleanup: ScheduleSlot[];
		personal: ScheduleSlot[];
		review: ScheduleSlot[];
		overloadedDays: RecommendationSchedulePressureDay[];
	};
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
	signals: string[];
	weight: number;
};

type CandidateRuntimeData = {
	title?: string;
	context?: string;
	impact?: string;
	promptLines: string[];
	requestLines: string[];
	signals: string[];
	tags: string[];
	weightBoost: number;
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

const PROJECT_STATUS_LABEL: Record<StatusTone, string> = {
	green: "green",
	yellow: "yellow",
	red: "red",
};

const HEALTH_SIGNAL_TAGS = new Set([
	"sleep",
	"health",
	"run",
	"stretch",
	"mood",
	"medical",
	"energy",
]);

function nowIso(): string {
	return new Date().toISOString();
}

function formatDateKey(dateKey: string): string {
	const [year, month, day] = dateKey.split("-").map(Number);
	const safeDate = new Date(year, (month ?? 1) - 1, day ?? 1);

	return `${safeDate.getFullYear()}-${String(safeDate.getMonth() + 1).padStart(2, "0")}-${String(safeDate.getDate()).padStart(2, "0")}`;
}

function shiftDate(dateKey: string, days: number): string {
	const [year, month, day] = dateKey.split("-").map(Number);
	const next = new Date(year, (month ?? 1) - 1, day ?? 1);
	next.setDate(next.getDate() + days);
	return formatDateKey(
		`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`,
	);
}

function formatDateKeyRu(dateKey: string): string {
	const [year, month, day] = dateKey.split("-").map(Number);
	return new Intl.DateTimeFormat("ru-RU", {
		day: "numeric",
		month: "short",
	}).format(new Date(year, (month ?? 1) - 1, day ?? 1));
}

function daysSince(dateLike: string): number {
	const delta = Date.now() - new Date(dateLike).getTime();
	return Math.max(0, Math.floor(delta / 86_400_000));
}

function decay(createdAt: string, halfLifeDays = 21): number {
	const ageDays = daysSince(createdAt);
	return Math.exp((-Math.log(2) * ageDays) / halfLifeDays);
}

function clipText(text: string, max = 96): string {
	const clean = text.replace(/\s+/g, " ").trim();
	if (clean.length <= max) return clean;
	return `${clean.slice(0, max - 1).trimEnd()}…`;
}

function uniqueTasks(tasks: Task[]): Task[] {
	const seen = new Set<string>();

	return tasks.filter((task) => {
		if (seen.has(task.id)) return false;
		seen.add(task.id);
		return true;
	});
}

function sortSlots(slots: ScheduleSlot[]): ScheduleSlot[] {
	return [...slots].sort((left, right) => {
		return (
			left.date.localeCompare(right.date) ||
			left.start.localeCompare(right.start) ||
			left.end.localeCompare(right.end) ||
			left.title.localeCompare(right.title, "ru")
		);
	});
}

function projectOpenDeliverables(project: Project): number {
	return project.deliverables.filter((item) => !item.done).length;
}

function formatProjectStatus(status: StatusTone): string {
	return PROJECT_STATUS_LABEL[status];
}

function formatFlagStatus(status: "low" | "high"): string {
	return status === "low" ? "low" : "high";
}

function formatTaskBrief(task: Task, today: string): string {
	const meta = [task.priority.toUpperCase()];

	if (task.dueDate) {
		meta.push(task.dueDate < today ? `просрочена ${formatDateKeyRu(task.dueDate)}` : `до ${formatDateKeyRu(task.dueDate)}`);
	}

	if (task.project) meta.push(task.project);

	return `${clipText(task.title, 62)} (${meta.join(" · ")})`;
}

function formatSlotBrief(slot: ScheduleSlot): string {
	return `${formatDateKeyRu(slot.date)} ${slot.start}–${slot.end} · ${clipText(slot.title, 62)}`;
}

function formatPressureDay(day: RecommendationSchedulePressureDay): string {
	const highlights = day.slots.slice(0, 2).map((slot) => clipText(slot.title, 34)).join(" + ");
	return `${formatDateKeyRu(day.date)} · load ${Math.round(day.load)} · ${highlights}`;
}

function isStudioPressureSlot(slot: ScheduleSlot): boolean {
	return slot.source === "studio" || slot.tags.includes("party");
}

function buildHotTags(entries: JournalEntry[]): string[] {
	const counts = new Map<string, number>();

	for (const entry of entries) {
		for (const tag of entry.tags) {
			counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
	}

	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, 4)
		.map(([tag]) => tag);
}

function buildSchedulePressureDays(
	slots: ScheduleSlot[],
): RecommendationSchedulePressureDay[] {
	const byDate = new Map<string, ScheduleSlot[]>();

	for (const slot of slots) {
		const bucket = byDate.get(slot.date) ?? [];
		bucket.push(slot);
		byDate.set(slot.date, bucket);
	}

	return [...byDate.entries()]
		.map(([date, daySlots]) => {
			const load = daySlots.reduce((sum, slot) => {
				if (isStudioPressureSlot(slot)) return sum + 3;
				if (slot.tone === "cleanup") return sum + 2.5;
				if (slot.tone === "family") return sum + 1.5;
				return sum + 1;
			}, 0);

			return {
				date,
				slots: sortSlots(daySlots),
				load,
			};
		})
		.filter((day) => day.load >= 4.5 || day.slots.length >= 4)
		.sort((a, b) => b.load - a.load || a.date.localeCompare(b.date))
		.slice(0, 3);
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

export function buildRecommendationRuntimeContext(
	input: RecommendationRuntimeInput,
): RecommendationRuntimeContext {
	const actionable = input.tasks
		.filter((task) => task.status === "inbox" || task.status === "active")
		.sort((left, right) => compareTasksByAttention(left, right, input.today));
	const dueSoonLimit = shiftDate(input.today, 3);
	const overdue = actionable.filter(
		(task) => !!task.dueDate && task.dueDate < input.today,
	);
	const dueSoon = actionable.filter(
		(task) => !!task.dueDate && task.dueDate >= input.today && task.dueDate <= dueSoonLimit,
	);
	const unscheduled = actionable.filter((task) => !task.dueDate);
	const p1 = actionable.filter((task) => task.priority === "p1");
	const attentionProjects = [...input.projects].filter((project) => project.status !== "green").sort((left, right) => {
		const leftWeight = (left.status === "red" ? 2 : 1) * 10 + projectOpenDeliverables(left);
		const rightWeight = (right.status === "red" ? 2 : 1) * 10 + projectOpenDeliverables(right);
		return rightWeight - leftWeight || left.updatedAt.localeCompare(right.updatedAt);
	});
	const birthdayProject =
		input.projects.find((project) => /др|день рождения|minecraft/i.test(project.name)) ?? null;
	const recentJournal = [...input.journalEntries]
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		.slice(0, 4);
	const missingToday = input.activeHabitsToday.filter(
		(habit) => !input.habitChecksToday[habit.id],
	);
	const completedToday = input.activeHabitsToday.filter(
		(habit) => !!input.habitChecksToday[habit.id],
	);
	const latestEntry = [...input.medicalEntries].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
	const flags = [...input.medicalEntries]
		.sort((a, b) => b.date.localeCompare(a.date))
		.flatMap((entry) => {
			return entry.params
				.map((param) => {
					const status = paramStatus(param);
					return status === "low" || status === "high"
						? { entry, param, status }
						: null;
				})
				.filter(Boolean) as RecommendationMedicalFlag[];
		})
		.slice(0, 4);
	const upcomingSchedule = sortSlots(input.upcomingSchedule);

	return {
		today: input.today,
		tasks: {
			actionable,
			overdue,
			dueSoon,
			unscheduled,
			p1,
		},
		projects: {
			attention: attentionProjects,
			birthday: birthdayProject,
		},
		journal: {
			recent: recentJournal,
			hotTags: buildHotTags(recentJournal),
		},
		habits: {
			activeToday: input.activeHabitsToday,
			missingToday,
			completedToday,
			streak: input.habitStreak,
		},
		medical: {
			latestEntry,
			flags,
		},
		schedule: {
			today: sortSlots(input.todaySchedule),
			studio: upcomingSchedule.filter(isStudioPressureSlot).slice(0, 4),
			cleanup: upcomingSchedule.filter((slot) => slot.tone === "cleanup").slice(0, 4),
			personal: upcomingSchedule.filter((slot) => slot.tone === "personal").slice(0, 4),
			review: upcomingSchedule.filter((slot) => slot.tone === "review").slice(0, 4),
			overloadedDays: buildSchedulePressureDays(upcomingSchedule),
		},
	};
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

function buildWorkRuntimeData(
	context: RecommendationRuntimeContext,
): CandidateRuntimeData {
	const leadProject = context.projects.attention[0] ?? null;
	const leadTask =
		context.tasks.p1[0] ??
		context.tasks.overdue[0] ??
		context.tasks.dueSoon[0] ??
		context.tasks.unscheduled[0] ??
		null;
	const queue = uniqueTasks([
		...context.tasks.p1,
		...context.tasks.overdue,
		...context.tasks.dueSoon,
		...context.tasks.unscheduled,
	]).slice(0, 3);
	const signals: string[] = [];

	if (leadProject) {
		signals.push(
			`Проект в tension: ${leadProject.name} (${formatProjectStatus(leadProject.status)}) · next: ${clipText(leadProject.nextStep, 48)}`,
		);
	}

	if (leadTask) {
		signals.push(
			`Главная живая задача: ${formatTaskBrief(leadTask, context.today)}`,
		);
	}

	if (queue.length > 1) {
		signals.push(
			`Ещё под давлением: ${queue.slice(1).map((task) => clipText(task.title, 28)).join(" · ")}`,
		);
	}

	return {
		title: leadProject
			? `Развернуть ${leadProject.name} без размазывания`
			: undefined,
		context: leadTask
			? `Сейчас лучше атаковать не абстрактную работу, а конкретный узел: ${clipText(leadTask.title, 72)}.`
			: undefined,
		impact:
			queue.length > 0
				? `Хороший prompt превратит ${queue.length} конкурирующих рабочих куска в одну последовательность на сегодня.`
				: undefined,
		promptLines: [
			leadProject
				? `Проект в attention: ${leadProject.name} (${formatProjectStatus(leadProject.status)}), next step: ${leadProject.nextStep}, открытых deliverables: ${projectOpenDeliverables(leadProject)}.`
				: "Отдельного красного проекта нет — нужен один главный рабочий вектор вместо распыления.",
			queue.length > 0
				? `Рабочие задачи под давлением: ${queue.map((task) => formatTaskBrief(task, context.today)).join("; ")}.`
				: "Явных дедлайнов мало, поэтому агент должен сам выбрать один главный шаг и два вторичных.",
		],
		requestLines: [
			leadProject
				? "Свяжи план с текущим next step проекта, а не придумывай новый параллельный трек."
				: "Если проекта явно не видно, выбери один центр тяжести по задачам.",
			"Расставь задачи по порядку и объясни, что не делать сегодня.",
		],
		signals,
		tags: [
			leadProject?.id,
			leadTask?.priority,
			leadTask?.dueDate ? "deadline" : null,
			context.tasks.overdue.length > 0 ? "overdue" : null,
		].filter(Boolean) as string[],
		weightBoost:
			context.tasks.overdue.length * 5 +
			context.tasks.p1.length * 4 +
			(leadProject?.status === "red" ? 12 : leadProject ? 6 : 0),
	};
}

function buildHealthRuntimeData(
	context: RecommendationRuntimeContext,
): CandidateRuntimeData {
	const missing = context.habits.missingToday.slice(0, 3);
	const flags = context.medical.flags.slice(0, 2);
	const healthJournal =
		context.journal.recent.find((entry) =>
			entry.tags.some((tag) => HEALTH_SIGNAL_TAGS.has(tag)),
		) ?? null;
	const signals: string[] = [];

	if (missing.length > 0) {
		signals.push(
			`Сегодня не закрыты: ${missing.map((habit) => `${habit.emoji} ${habit.name}`).join(" · ")}`,
		);
	}

	if (flags.length > 0) {
		signals.push(
			`Медсигналы: ${flags.map((flag) => `${flag.param.name} (${formatFlagStatus(flag.status)})`).join(" · ")}`,
		);
	}

	if (healthJournal) {
		signals.push(`Self-report: “${clipText(healthJournal.text, 64)}”`);
	}

	return {
		title:
			flags.length > 0
				? "Собрать health floor с учётом анализов"
				: missing.length >= 2
					? "Вернуть телесную базу до вечера"
					: undefined,
		context:
			flags.length > 0
				? "Есть конкретные медсигналы, поэтому productivity не должна притворяться лечением."
				: missing.length > 0
					? "Сегодня база проседает на уровне привычек, а не на уровне мотивационных речей."
					: undefined,
		impact:
			missing.length > 0 || flags.length > 0
				? "Агент сможет собрать реалистичный floor без героизма и без потери медицинского контекста."
				: undefined,
		promptLines: [
			missing.length > 0
				? `Сегодня не закрыты привычки: ${missing.map((habit) => `${habit.emoji} ${habit.name}`).join("; ")}.`
				: `Сегодня уже закрыто: ${
					context.habits.completedToday
						.slice(0, 3)
						.map((habit) => `${habit.emoji} ${habit.name}`)
						.join("; ") || "нет отмеченных привычек"
				}.`,
			flags.length > 0
				? `Медсигналы: ${flags.map((flag) => `${flag.param.name} (${formatFlagStatus(flag.status)}, ${flag.entry.date})`).join("; ")}.`
				: context.medical.latestEntry
					? `Последняя медицинская запись: ${context.medical.latestEntry.name} от ${context.medical.latestEntry.date}.`
					: "Свежих медицинских записей пока нет.",
			healthJournal
				? `Свежий self-report: "${clipText(healthJournal.text, 120)}".`
				: "Если строишь план, считай его через реальную энергию дня, а не через идеальную версию меня.",
		],
		requestLines: [
			"Сделай план щадящим: одна минимальная победа до вечера, один follow-up и один запрет на перегруз.",
			flags.length > 0
				? "Не спорь с медицинскими флагами: сначала объясни безопасный минимум, потом нагрузку."
				: "Если не хватает энергии, снижай план, а не добавляй чувство вины.",
		],
		signals,
		tags: [
			...missing.map((habit) => habit.id),
			flags.length > 0 ? "medical-flag" : null,
			healthJournal ? "self-report" : null,
		].filter(Boolean) as string[],
		weightBoost:
			flags.length * 10 +
			missing.length * 5 +
			(context.habits.completedToday.length === 0 ? 4 : 0),
	};
}

function buildFamilyRuntimeData(
	context: RecommendationRuntimeContext,
): CandidateRuntimeData {
	const studio = context.schedule.studio.slice(0, 2);
	const cleanup = context.schedule.cleanup[0] ?? null;
	const birthday = context.projects.birthday;
	const nextPressureDay =
		context.schedule.overloadedDays.find((day) =>
			day.slots.some((slot) => isStudioPressureSlot(slot)),
		) ?? null;
	const signals: string[] = [];

	if (studio.length > 0) {
		signals.push(
			`Студия впереди: ${studio.map(formatSlotBrief).join(" · ")}`,
		);
	}

	if (cleanup) {
		signals.push(`После событий висит уборка: ${formatSlotBrief(cleanup)}`);
	}

	if (birthday) {
		signals.push(
			`Семейный проект: ${birthday.name} · next: ${clipText(birthday.nextStep, 42)}`,
		);
	}

	return {
		title:
			studio[0]
				? `Защитить семью вокруг ${formatDateKeyRu(studio[0].date)}`
				: birthday
					? `Поддержать семейный проект ${birthday.name}`
					: undefined,
		context:
			studio.length > 0
				? "Семейную часть недели лучше защитить сейчас, пока студийная нагрузка ещё видна и управляема."
				: birthday
					? "Есть семейный проект, но он легко теряется между студией и операционкой."
					: undefined,
		impact:
			studio.length > 0 || birthday
				? "Агент сможет заранее разложить буферы, логистику и решения, пока неделя ещё не захлопнулась."
				: undefined,
		promptLines: [
			studio.length > 0
				? `Ближайшие студийные события: ${studio.map(formatSlotBrief).join("; ")}.`
				: "Явного студийного давления в ближайшие дни нет, но семейную часть всё равно стоит зафиксировать заранее.",
			cleanup
				? `После событий запланирована уборка: ${formatSlotBrief(cleanup)}.`
				: "Пока отдельного cleanup-слота не видно.",
			birthday
				? `Семейный проект: ${birthday.name}; next step: ${birthday.nextStep}; незакрытых deliverables: ${projectOpenDeliverables(birthday)}.`
				: "Отдельного семейного проекта в системе сейчас нет.",
			nextPressureDay
				? `Наиболее плотный день по давлению: ${formatPressureDay(nextPressureDay)}.`
				: "Явного перегруза по дням пока нет.",
		],
		requestLines: [
			"Разложи неделю так, чтобы семейные окна были защищены до и после студии, а не искались постфактум.",
			"Если есть конфликт, предложи буферы, логистику и один конкретный разговор или решение заранее.",
		],
		signals,
		tags: [
			studio.length > 0 ? "studio-pressure" : null,
			cleanup ? "cleanup" : null,
			birthday ? birthday.id : null,
		].filter(Boolean) as string[],
		weightBoost: studio.length * 6 + (cleanup ? 5 : 0) + (birthday ? 4 : 0),
	};
}

function buildOperationsRuntimeData(
	context: RecommendationRuntimeContext,
): CandidateRuntimeData {
	const overdue = context.tasks.overdue.slice(0, 3);
	const dueSoon = context.tasks.dueSoon.slice(0, 2);
	const unscheduled = context.tasks.unscheduled.slice(0, 2);
	const cleanup = context.schedule.cleanup[0] ?? null;
	const signals: string[] = [];

	if (overdue.length > 0) {
		signals.push(
			`Просрочка: ${overdue.map((task) => clipText(task.title, 28)).join(" · ")}`,
		);
	}

	if (unscheduled.length > 0) {
		signals.push(
			`Без даты висят: ${unscheduled.map((task) => clipText(task.title, 24)).join(" · ")}`,
		);
	}

	if (cleanup) {
		signals.push(`Операционное окно: ${formatSlotBrief(cleanup)}`);
	}

	return {
		title:
			overdue.length > 0
				? `Разгрести ${context.tasks.overdue.length} хвоста до нового планирования`
				: cleanup
					? "Снять операционный шум вокруг недели"
					: undefined,
		context:
			overdue.length > 0
				? "Сейчас операционка фонит конкретными хвостами, а не абстрактным бардаком."
				: unscheduled.length > 0
					? "Есть задачи без даты — они тихо крадут фокус из рабочего контура."
					: undefined,
		impact:
			overdue.length > 0 || unscheduled.length > 0 || cleanup
				? "После triage агент вернёт одно первое действие вместо вязкого списка хвостов."
				: undefined,
		promptLines: [
			overdue.length > 0
				? `Просрочка: ${overdue.map((task) => formatTaskBrief(task, context.today)).join("; ")}.`
				: "Явной просрочки нет, но нужен triage по шумным задачам.",
			dueSoon.length > 0
				? `Скоро дедлайн: ${dueSoon.map((task) => formatTaskBrief(task, context.today)).join("; ")}.`
				: "Критичных дедлайнов на 3 дня не видно.",
			unscheduled.length > 0
				? `Без даты висят: ${unscheduled.map((task) => clipText(task.title, 48)).join("; ")}.`
				: "Почти все живые задачи уже привязаны ко времени.",
			cleanup
				? `Операционное окно недели: ${formatSlotBrief(cleanup)}.`
				: "Отдельного cleanup-окна пока нет.",
		],
		requestLines: [
			"Раздели всё на удалить / перенести / сделать первым.",
			"Не размазывай ответ — нужен triage и один первый слот на сегодня.",
		],
		signals,
		tags: [
			overdue.length > 0 ? "overdue" : null,
			unscheduled.length > 0 ? "unscheduled" : null,
			cleanup ? "cleanup" : null,
		].filter(Boolean) as string[],
		weightBoost:
			context.tasks.overdue.length * 7 +
			unscheduled.length * 3 +
			(cleanup ? 4 : 0),
	};
}

function buildReflectionRuntimeData(
	context: RecommendationRuntimeContext,
): CandidateRuntimeData {
	const recent = context.journal.recent.slice(0, 3);
	const hotTags = context.journal.hotTags.slice(0, 3);
	const nextReview = context.schedule.review[0] ?? null;
	const signals: string[] = [];

	if (recent.length > 0) {
		signals.push(
			`Последние мысли: ${recent.map((entry) => `“${clipText(entry.text, 26)}”`).join(" · ")}`,
		);
	}

	if (hotTags.length > 0) {
		signals.push(`Повторяются теги: ${hotTags.map((tag) => `#${tag}`).join(" ")}`);
	}

	if (nextReview) {
		signals.push(`Review-окно: ${formatSlotBrief(nextReview)}`);
	}

	return {
		title: recent.length > 0 ? "Собрать курс из последних записей" : undefined,
		context:
			recent.length > 0
				? "Материал для осмысления уже есть — задача не в поиске новых мыслей, а в сжатии их в курс."
				: undefined,
		impact:
			recent.length > 0 || hotTags.length > 0
				? "Агент может превратить заметки в решения, а не в ещё один склад наблюдений."
				: undefined,
		promptLines: [
			recent.length > 0
				? `Последние записи: ${recent.map((entry) => `"${clipText(entry.text, 70)}"`).join(" · ")}.`
				: "Свежих записей мало — попроси агента сначала вытащить контекст из разговора.",
			hotTags.length > 0
				? `Чаще всплывают теги: ${hotTags.map((tag) => `#${tag}`).join(" ")}.`
				: "Устойчивых тегов пока не набралось.",
			nextReview
				? `Следующее review-окно в календаре: ${formatSlotBrief(nextReview)}.`
				: "Отдельного review-окна впереди не видно.",
		],
		requestLines: [
			"Собери не пересказ, а 1–2 решения и один главный следующий шаг.",
			"Если замечаешь повторяющийся паттерн, назови его прямо.",
		],
		signals,
		tags: [...hotTags.slice(0, 2), recent.length > 0 ? "journal-live" : null].filter(Boolean) as string[],
		weightBoost: recent.length * 3 + (nextReview ? 0 : 6),
	};
}

function buildRecoveryRuntimeData(
	context: RecommendationRuntimeContext,
): CandidateRuntimeData {
	const missingRecovery = context.habits.missingToday.filter((habit) =>
		["sleep", "stretch", "run"].includes(habit.id),
	);
	const sleepMissing = missingRecovery.some((habit) => habit.id === "sleep");
	const nextPersonal = context.schedule.personal[0] ?? null;
	const overloaded = context.schedule.overloadedDays.slice(0, 2);
	const signals: string[] = [];

	if (missingRecovery.length > 0) {
		signals.push(
			`Recovery проседает на базе: ${missingRecovery.map((habit) => `${habit.emoji} ${habit.name}`).join(" · ")}`,
		);
	}

	if (overloaded.length > 0) {
		signals.push(
			`Перегретые дни: ${overloaded.map((day) => formatDateKeyRu(day.date)).join(" · ")}`,
		);
	}

	if (nextPersonal) {
		signals.push(`Ближайшее personal-окно: ${formatSlotBrief(nextPersonal)}`);
	}

	return {
		title:
			overloaded.length > 0
				? "Выбить окно восстановления в плотной неделе"
				: sleepMissing
					? "Не отдать recovery случайной срочности"
					: undefined,
		context:
			sleepMissing
				? "Сегодня recovery уже проседает на базовом уровне, а не на уровне красивых намерений."
				: overloaded.length > 0
					? "Неделя уже местами перегрета — окно отдыха нужно поставить сейчас."
					: undefined,
		impact:
			missingRecovery.length > 0 || overloaded.length > 0 || !nextPersonal
				? "Агент поможет защитить энергию конкретным слотом, а не абстрактным обещанием отдохнуть потом."
				: undefined,
		promptLines: [
			missingRecovery.length > 0
				? `Сегодня не закрыты recovery-сигналы: ${missingRecovery.map((habit) => `${habit.emoji} ${habit.name}`).join("; ")}.`
				: "Ключевые recovery-привычки сегодня уже частично отмечены.",
			nextPersonal
				? `Ближайшее personal-окно: ${formatSlotBrief(nextPersonal)}.`
				: "Ближайшее personal-окно в расписании не видно.",
			overloaded.length > 0
				? `Перегруженные дни: ${overloaded.map((day) => formatPressureDay(day)).join("; ")}.`
				: "Перегруженных дней на горизонте недели не найдено.",
		],
		requestLines: [
			"Предложи одно невыбиваемое окно восстановления и чем его защитить от срочности.",
			"Если день уже перегружен, покажи что именно лучше не делать.",
		],
		signals,
		tags: [
			sleepMissing ? "sleep" : null,
			overloaded.length > 0 ? "overload" : null,
			nextPersonal ? "scheduled-recovery" : "missing-recovery",
		].filter(Boolean) as string[],
		weightBoost:
			(sleepMissing ? 8 : 0) + overloaded.length * 6 + (nextPersonal ? 0 : 6),
	};
}

function buildCandidateRuntimeData(
	areaKey: AttentionAreaKey,
	context: RecommendationRuntimeContext,
): CandidateRuntimeData {
	switch (areaKey) {
		case "work":
			return buildWorkRuntimeData(context);
		case "health":
			return buildHealthRuntimeData(context);
		case "family":
			return buildFamilyRuntimeData(context);
		case "operations":
			return buildOperationsRuntimeData(context);
		case "reflection":
			return buildReflectionRuntimeData(context);
		case "recovery":
			return buildRecoveryRuntimeData(context);
		default:
			return {
				tags: [],
				signals: [],
				promptLines: [],
				requestLines: [],
				weightBoost: 0,
			};
	}
}

function buildPrompt(
	snapshot: AgentControlSnapshot,
	area: AttentionArea,
	priority: AgentPriority | null,
	runtimeData?: CandidateRuntimeData,
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

	if (runtimeData && runtimeData.promptLines.length > 0) {
		contextLines.push("- Реальные сигналы из текущих данных:");
		contextLines.push(...runtimeData.promptLines.map((item) => `- ${item}`));
		contextLines.push("");
	}

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

	return [
		...contextLines,
		...askByArea[area.key],
		...(runtimeData?.requestLines ?? []),
		...formatLines,
	].join("\n");
}

function buildCandidates(
	snapshot: AgentControlSnapshot,
	runtimeContext?: RecommendationRuntimeContext | null,
): RecommendationCandidate[] {
	return snapshot.areas.map((area) => {
		const priority = findPriorityForArea(area, snapshot.priorities);
		const baseTags = [...AREA_TAGS[area.key]];
		const runtimeData = runtimeContext ? buildCandidateRuntimeData(area.key, runtimeContext) : null;

		if (priority?.id.startsWith("project-")) baseTags.push("next-step");
		if (priority?.id === "ops-overdue") baseTags.push("overdue");
		if (priority?.id === "reflection-reset") baseTags.push("review");
		if (priority?.id === "health-floor") baseTags.push("routine");

		return {
			id: priority ? `advice-${priority.id}` : `advice-area-${area.key}`,
			title: runtimeData?.title ?? priority?.title ?? AREA_GENERIC_TITLE[area.key],
			context: runtimeData?.context ?? priority?.reason ?? area.insight,
			impact: runtimeData?.impact ?? priority?.action ?? AREA_GENERIC_IMPACT[area.key],
			prompt: buildPrompt(snapshot, area, priority, runtimeData ?? undefined),
			href: priority?.href ?? area.href,
			level: priority?.level ?? area.level,
			effort: AREA_EFFORT[area.key],
			tags: [...new Set([...baseTags, ...(runtimeData?.tags ?? [])])],
			signals: runtimeData?.signals.slice(0, 3) ?? [],
			weight:
				BASE_WEIGHT[priority?.level ?? area.level] +
				Math.max(0, Math.round((100 - area.score) / 3)) +
				(priority ? 12 : 0) +
				(runtimeData?.weightBoost ?? 0),
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
	options?: {
		limit?: number;
		runtimeContext?: RecommendationRuntimeContext | null;
	},
): AgentRecommendation[] {
	const limit = options?.limit ?? 3;
	const candidates = buildCandidates(snapshot, options?.runtimeContext ?? null);
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
			const tagAffinity = candidate.tags.reduce(
				(sum, tag) => sum + (tagScores.get(tag) ?? 0),
				0,
			);
			const counts = buildFeedbackCounts(directEvents);

			return {
				...candidate,
				status:
					latest && daysSince(latest.createdAt) <= 21 ? latest.action : "new",
				score:
					Math.round((candidate.weight + directScore * 6 + tagAffinity * 4) * 10) /
					10,
				latestActionAt: latest?.createdAt ?? null,
				feedback: counts,
			} satisfies AgentRecommendation;
		})
		.sort((a, b) => b.score - a.score)
		.slice(0, limit);
}
