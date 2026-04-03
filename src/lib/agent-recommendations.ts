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
import {
	minutesToTime,
	timeToMinutes,
	type ScheduleSlot,
	type ScheduleTone,
} from "./schedule";
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
	areaKey: AttentionAreaKey;
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
		distribution: TaskDistributionAnalysis;
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
		all: ScheduleSlot[];
		today: ScheduleSlot[];
		studio: ScheduleSlot[];
		cleanup: ScheduleSlot[];
		personal: ScheduleSlot[];
		review: ScheduleSlot[];
		overloadedDays: RecommendationSchedulePressureDay[];
	};
};

export type TaskWindowAssignment = {
	taskId: string;
	title: string;
	project?: string;
	minutes: number;
	reason: string;
};

export type TaskWindowSuggestion = {
	date: string;
	start: string;
	end: string;
	label: string;
	tone: ScheduleTone;
	assignments: TaskWindowAssignment[];
	remainingMinutes: number;
};

export type TaskDistributionAnalysis = {
	suggestions: TaskWindowSuggestion[];
	overflowTasks: Task[];
	candidateWindowCount: number;
	totalTasks: number;
};

export type AgentPracticalPlan = {
	mergedThemes: string[];
	mainDecision: string;
	backupMoves: string[];
	doneCriterion: string;
	review: string | null;
	taskWindows: string[];
	overflowSummary: string | null;
	updates: {
		task: string;
		schedule: string;
		journal: string;
	};
};

type RecoveryAnchor = {
	date: string;
	start: string;
	end: string;
	label: string;
	mode: "protect" | "convert" | "create";
};

type TaskTrack = "kinderly" | "heys" | "birthday" | "ops" | "general";

type RecommendationCandidate = {
	id: string;
	areaKey: AttentionAreaKey;
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
	work: "Попроси агента собрать один рабочий план на сегодня из текущего next step.",
	health: "Попроси агента зафиксировать щадящий health floor на сегодня.",
	family: "Попроси агента заранее защитить семейные окна и логистику недели.",
	operations: "Попроси агента сделать triage хвостов и оставить одно первое действие.",
	reflection: "Опиши агенту, что происходит, и попроси собрать один ясный следующий шаг.",
	recovery: "Попроси агента поставить recovery-окно и защитить его от срочности.",
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

function normalizePromptLine(line: string): string {
	return line
		.replace(/\s+/g, " ")
		.replace(/[.:;!?]+$/g, "")
		.trim()
		.toLowerCase();
}

function uniquePromptLines(lines: Array<string | null | undefined>): string[] {
	const seen = new Set<string>();
	const result: string[] = [];

	for (const line of lines) {
		const value = line?.trim();
		if (!value) continue;

		const normalized = normalizePromptLine(value);
		if (seen.has(normalized)) continue;

		seen.add(normalized);
		result.push(value);
	}

	return result;
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

function slotDurationMinutes(slot: Pick<ScheduleSlot, "start" | "end">): number {
	return Math.max(0, timeToMinutes(slot.end) - timeToMinutes(slot.start));
}

function isStudioPressureSlot(slot: ScheduleSlot): boolean {
	return slot.source === "studio" || slot.tags.includes("party");
}

function isCleanupLoadSlot(slot: ScheduleSlot): boolean {
	return slot.tone === "cleanup";
}

function isBetweenPartiesSupportSlot(slot: ScheduleSlot): boolean {
	return slot.tags.includes("between-parties");
}

function formatCleanupLoadBrief(slot: ScheduleSlot): string {
	const durationHours = Math.round((slotDurationMinutes(slot) / 60) * 10) / 10;
	const loadLabel = isBetweenPartiesSupportSlot(slot) ? "между праздниками" : "cleanup-load";
	return `${formatSlotBrief(slot)} · ${loadLabel} · ${durationHours}ч`;
}

function formatRecoveryAnchorBrief(anchor: RecoveryAnchor): string {
	return `${formatDateKeyRu(anchor.date)} ${anchor.start}–${anchor.end} · ${clipText(anchor.label, 62)}`;
}

function formatTaskWindowSuggestion(window: TaskWindowSuggestion): string {
	const tasks = window.assignments
		.map((assignment) => clipText(assignment.title, 32))
		.join(" + ");

	return `${formatDateKeyRu(window.date)} ${window.start}–${window.end} → ${tasks}`;
}

function normalizeKeywordStems(text: string): string[] {
	return [...new Set(
		text
			.toLowerCase()
			.replace(/ё/g, "е")
			.split(/[^a-zа-я0-9]+/iu)
			.map((token) => token.trim())
			.filter((token) => token.length >= 4)
			.map((token) => token.slice(0, 6)),
	)];
}

function compressDeliverableForSprint(text: string): string {
	const lower = text.toLowerCase();

	if (lower.includes("сценар") && lower.includes("квест")) {
		return "3 квест-блока";
	}

	if (lower.includes("реквиз")) {
		return "список недостающего реквизита";
	}

	if (lower.includes("тайминг")) {
		return "черновой тайминг";
	}

	if (lower.includes("торт")) {
		return "черновик по торту и ингредиентам";
	}

	return clipText(text, 42);
}

function pickRelevantDeliverables(project: Project): string[] {
	const openDeliverables = project.deliverables.filter((item) => !item.done);
	const nextStepStems = normalizeKeywordStems(project.nextStep);

	const scored = openDeliverables
		.map((item) => {
			const text = item.text.toLowerCase();
			const score = nextStepStems.reduce((sum, stem) => {
				return sum + (text.includes(stem) ? 1 : 0);
			}, 0);

			return { item, score };
		})
		.sort((left, right) => right.score - left.score || left.item.text.localeCompare(right.item.text, "ru"));

	const matched = scored.filter((entry) => entry.score > 0).map((entry) => entry.item.text);
	if (matched.length > 0) return matched.slice(0, 2);

	return openDeliverables.slice(0, 2).map((item) => item.text);
}

function buildProjectFocusLabel(project: Project, energyConstrained: boolean): string {
	if (!energyConstrained) {
		return clipText(project.nextStep || "зафиксировать один следующий шаг", 78);
	}

	const relevant = pickRelevantDeliverables(project).map(compressDeliverableForSprint).slice(0, 2);
	if (relevant.length >= 2) {
		return `собрать черновик: ${relevant.join(" + ")}`;
	}

	if (relevant.length === 1) {
		return `собрать черновик: ${relevant[0]}`;
	}

	return clipText(project.nextStep || "зафиксировать один следующий шаг", 78);
}

function daysBetweenDateKeys(from: string, to: string): number {
	const fromDate = new Date(`${from}T00:00:00`).getTime();
	const toDate = new Date(`${to}T00:00:00`).getTime();
	return Math.floor((toDate - fromDate) / 86_400_000);
}

function estimateTaskMinutes(task: Task): number {
	const lower = task.title.toLowerCase();

	if (/купить|заказать|позвонить|написать|проверить|follow-up|чеклист|швабр|тряпк/u.test(lower)) {
		return 30;
	}

	if (/сценар|структур|квест|финализ|стратег|карта|план|тайминг|реквизит/u.test(lower)) {
		return 60;
	}

	if (task.priority === "p1") return 60;
	if (task.priority === "p2") return 45;
	return 30;
}

function getTaskTrack(task: Task): TaskTrack {
	const haystack = `${task.projectId ?? ""} ${task.project ?? ""} ${task.title}`.toLowerCase();

	if (/heys/u.test(haystack)) return "heys";
	if (/minecraft|\bдр\b|день рождения|квест|реквизит/u.test(haystack)) return "birthday";
	if (/kinderly|студи|праздник/u.test(haystack)) return "kinderly";
	if (/купить|заказать|позвонить|написать|операц|follow-up|хвост|check|швабр|тряпк/u.test(haystack)) {
		return "ops";
	}

	return "general";
}

function getWindowTracks(slot: ScheduleSlot): TaskTrack[] {
	const title = slot.title.toLowerCase();

	if (slot.tone === "heys" || /heys/u.test(title)) return ["heys", "general"];
	if (slot.tone === "kinderly" || /kinderly|студи/u.test(title)) {
		return ["kinderly", "birthday", "general"];
	}
	if (slot.tone === "review" || /план|review/u.test(title)) {
		return ["birthday", "general", "ops"];
	}
	if (/операц|follow-up|хвост/u.test(title)) {
		return ["ops", "general"];
	}

	return ["general"];
}

function scoreTaskForWindow(
	task: Task,
	slot: ScheduleSlot,
	today: string,
): { score: number; reason: string } {
	const taskTrack = getTaskTrack(task);
	const windowTracks = getWindowTracks(slot);
	const reasons: string[] = [];
	let score = 0;

	if (windowTracks.includes(taskTrack)) {
		score += windowTracks[0] === taskTrack ? 10 : 6;
		reasons.push("совпадает по контуру");
	} else if (taskTrack === "general") {
		score += 4;
	}

	if (task.priority === "p1") {
		score += 8;
		reasons.push("p1");
	} else if (task.priority === "p2") {
		score += 4;
	}

	if (task.dueDate) {
		const daysToDueFromWindow = daysBetweenDateKeys(slot.date, task.dueDate);
		if (daysToDueFromWindow < 0) {
			score -= 24 + Math.abs(daysToDueFromWindow) * 4;
		} else {
			score += Math.max(0, 12 - daysToDueFromWindow * 3);
			if (daysToDueFromWindow <= 1) reasons.push("срок близко");
		}
	} else {
		const daysFromToday = daysBetweenDateKeys(today, slot.date);
		score += Math.max(0, 6 - daysFromToday);
		if (daysFromToday === 0) reasons.push("окно сегодня");
	}

	if (/операц|follow-up|хвост/u.test(slot.title.toLowerCase()) && taskTrack === "ops") {
		score += 4;
		reasons.push("подходит под ops-слот");
	}

	if (/план|review/u.test(slot.title.toLowerCase()) && (taskTrack === "birthday" || taskTrack === "general")) {
		score += 3;
		reasons.push("хорошо ложится в planning-окно");
	}

	return {
		score,
		reason: reasons.slice(0, 2).join(" · ") || "лучшее свободное окно",
	};
}

function buildTaskDistributionAnalysis(input: {
	today: string;
	tasks: Task[];
	todaySchedule: ScheduleSlot[];
	upcomingSchedule: ScheduleSlot[];
}): TaskDistributionAnalysis {
	const cleanupEndToday = input.todaySchedule
		.filter(isCleanupLoadSlot)
		.reduce((max, slot) => Math.max(max, timeToMinutes(slot.end)), 0);
	const actionable = uniqueTasks(input.tasks)
		.filter((task) => task.status === "active" || task.status === "inbox")
		.sort((left, right) => compareTasksByAttention(left, right, input.today));

	const windowStates = sortSlots(input.upcomingSchedule)
		.filter((slot) => {
			if (!isPlanningSlot(slot)) return false;
			if (slot.date === input.today && timeToMinutes(slot.start) < cleanupEndToday) return false;
			return slotDurationMinutes(slot) >= 30;
		})
		.map((slot) => ({
			slot,
			remainingMinutes: slotDurationMinutes(slot),
			assignments: [] as TaskWindowAssignment[],
		}));

	const overflowTasks: Task[] = [];

	for (const task of actionable) {
		const neededMinutes = estimateTaskMinutes(task);
		const best = windowStates
			.map((state, index) => {
				const scored = scoreTaskForWindow(task, state.slot, input.today);
				return {
					index,
					score: scored.score,
					reason: scored.reason,
					fits: state.remainingMinutes >= neededMinutes,
				};
			})
			.filter((item) => item.fits)
			.sort((left, right) => right.score - left.score || left.index - right.index)[0];

		if (!best || best.score < -12) {
			overflowTasks.push(task);
			continue;
		}

		windowStates[best.index]!.assignments.push({
			taskId: task.id,
			title: task.title,
			project: task.project,
			minutes: neededMinutes,
			reason: best.reason,
		});
		windowStates[best.index]!.remainingMinutes -= neededMinutes;
	}

	return {
		suggestions: windowStates
			.filter((state) => state.assignments.length > 0)
			.map((state) => ({
				date: state.slot.date,
				start: state.slot.start,
				end: state.slot.end,
				label: state.slot.title,
				tone: state.slot.tone,
				assignments: state.assignments,
				remainingMinutes: state.remainingMinutes,
			})),
		overflowTasks,
		candidateWindowCount: windowStates.length,
		totalTasks: actionable.length,
	};
}

function isTrueRecoverySlot(slot: ScheduleSlot): boolean {
	const title = slot.title.toLowerCase();

	if (
		slot.tags.includes("drums") ||
		slot.tags.includes("rehearsal") ||
		title.includes("барабан") ||
		title.includes("репети") ||
		slot.tags.includes("family")
	) {
		return false;
	}

	return (
		slot.tags.includes("stretch") ||
		slot.tags.includes("recovery") ||
		slot.tags.includes("rest") ||
		title.includes("восстанов") ||
		title.includes("растяж")
	);
}

function clampMinutes(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function findRecoveryGap(context: RecommendationRuntimeContext): RecoveryAnchor | null {
	const overloaded = new Set(context.schedule.overloadedDays.map((day) => day.date));
	const byDate = new Map<string, ScheduleSlot[]>();

	for (const slot of context.schedule.all) {
		const bucket = byDate.get(slot.date) ?? [];
		bucket.push(slot);
		byDate.set(slot.date, bucket);
	}

	const dayCandidates = [...byDate.entries()]
		.filter(([date]) => date !== context.today)
		.map(([date, slots]) => ({
			date,
			slots: sortSlots(slots),
			hasStudio: slots.some(isStudioPressureSlot),
			hasCleanup: slots.some(isCleanupLoadSlot),
			load: slots.reduce((sum, slot) => {
				if (isStudioPressureSlot(slot)) return sum + 3;
				if (isCleanupLoadSlot(slot)) return sum + 2.5;
				if (slot.tone === "family") return sum + 1.5;
				return sum + 1;
			}, 0),
		}))
		.sort((left, right) => {
			return (
				Number(overloaded.has(left.date)) - Number(overloaded.has(right.date)) ||
				Number(left.hasCleanup) - Number(right.hasCleanup) ||
				Number(left.hasStudio) - Number(right.hasStudio) ||
				left.load - right.load ||
				left.date.localeCompare(right.date)
			);
		});

	const ranges = [
		{ start: 12 * 60, end: 14 * 60, preferred: 12 * 60 },
		{ start: 11 * 60, end: 14 * 60, preferred: 12 * 60 },
		{ start: 14 * 60, end: 17 * 60, preferred: 15 * 60 },
		{ start: 9 * 60, end: 17 * 60, preferred: 12 * 60 },
	];
	const duration = 60;

	for (const day of dayCandidates) {
		for (const range of ranges) {
			const busy = day.slots
				.map((slot) => ({
					start: Math.max(timeToMinutes(slot.start), range.start),
					end: Math.min(timeToMinutes(slot.end), range.end),
				}))
				.filter((slot) => slot.end > slot.start)
				.sort((left, right) => left.start - right.start);

			let cursor = range.start;

			for (const slot of [...busy, { start: range.end, end: range.end }]) {
				if (slot.start - cursor >= duration) {
					const latestStart = slot.start - duration;
					const chosenStart = clampMinutes(range.preferred, cursor, latestStart);

					return {
						date: day.date,
						start: minutesToTime(chosenStart),
						end: minutesToTime(chosenStart + duration),
						label: "Recovery / stretch + walk",
						mode: "create",
					};
				}

				cursor = Math.max(cursor, slot.end);
			}
		}
	}

	return null;
}

function isPlanningSlot(slot: ScheduleSlot): boolean {
	return (
		(slot.tone === "review" || slot.tone === "work" || slot.tone === "kinderly" || slot.tone === "heys") &&
		!isStudioPressureSlot(slot)
	);
}

function pickPlanningSlot(context: RecommendationRuntimeContext): ScheduleSlot | null {
	const cleanupEnd = context.schedule.today
		.filter(isCleanupLoadSlot)
		.reduce((max, slot) => Math.max(max, timeToMinutes(slot.end)), 0);

	const primary = context.schedule.today.find(
		(slot) => isPlanningSlot(slot) && timeToMinutes(slot.start) >= cleanupEnd,
	);

	return primary ?? context.schedule.today.find(isPlanningSlot) ?? null;
}

function pickRecoveryAnchor(
	context: RecommendationRuntimeContext,
): RecoveryAnchor | null {
	const overloaded = new Set(context.schedule.overloadedDays.map((day) => day.date));
	const pickBest = (slots: ScheduleSlot[]): ScheduleSlot | null => {
		return slots.find((slot) => !overloaded.has(slot.date)) ?? slots[0] ?? null;
	};

	const calmExisting = pickBest(
		context.schedule.all.filter(
			(slot) => isTrueRecoverySlot(slot) && slotDurationMinutes(slot) >= 45,
		),
	);
	if (calmExisting) {
		return {
			date: calmExisting.date,
			start: calmExisting.start,
			end: calmExisting.end,
			label: calmExisting.title,
			mode: "protect",
		};
	}

	const gap = findRecoveryGap(context);
	if (gap) {
		return gap;
	}

	const review = pickBest(context.schedule.review);
	if (review) {
		return {
			date: review.date,
			start: review.start,
			end: review.end,
			label: "Recovery / stretch + walk",
			mode: "convert",
		};
	}

	return null;
}

function buildReviewSummary(
	context: RecommendationRuntimeContext,
	leadProject: Project | null,
	leadTask: Task | null,
): string {
	const moving = context.schedule.cleanup.length > 0 || context.schedule.studio.length > 0
		? "расписание и студийная логика уже видны"
		: context.tasks.actionable.length > 0
			? "контур задач уже собран"
			: "контекст дня уже собран";
	const stuck = leadProject
		? `${leadProject.name} без одного исполнимого узла`
		: leadTask
			? clipText(leadTask.title, 52)
			: "размазанный фокус по нескольким мелким кускам";
	const main = leadProject
		? `сузить ${leadProject.name} до одного следующего шага`
		: leadTask
			? `довести до конца ${clipText(leadTask.title, 42)}`
			: "оставить один главный шаг вместо параллельных намерений";

	return `Движется — ${moving}. Буксует — ${stuck}. Главное — ${main}.`;
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
				if (slot.tone === "cleanup") {
					const durationHours = Math.max(1, slotDurationMinutes(slot) / 60);
					return sum + Math.min(4, 0.8 + durationHours * 0.9 + (isBetweenPartiesSupportSlot(slot) ? 0.3 : 0));
				}
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
	const taskDistribution = buildTaskDistributionAnalysis({
		today: input.today,
		tasks: actionable,
		todaySchedule: sortSlots(input.todaySchedule),
		upcomingSchedule,
	});

	return {
		today: input.today,
		tasks: {
			actionable,
			overdue,
			dueSoon,
			unscheduled,
			p1,
			distribution: taskDistribution,
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
			all: upcomingSchedule,
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
	const energyConstrained = context.schedule.today.some(isCleanupLoadSlot);
	const taskWindows = context.tasks.distribution.suggestions.slice(0, 3);
	const overflowTasks = context.tasks.distribution.overflowTasks.slice(0, 2);
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

	if (taskWindows.length > 0) {
		signals.push(
			`Окна под задачи: ${taskWindows.map((window) => formatTaskWindowSuggestion(window)).join(" · ")}`,
		);
	}

	if (overflowTasks.length > 0) {
		signals.push(
			`Пока без окна: ${overflowTasks.map((task) => clipText(task.title, 28)).join(" · ")}`,
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
				? `Попроси агента превратить ${queue.length} конкурирующих рабочих куска в один понятный план на сегодня.`
				: undefined,
		promptLines: [
			leadProject
				? `Проект в attention: ${leadProject.name} (${formatProjectStatus(leadProject.status)}), next step: ${energyConstrained ? buildProjectFocusLabel(leadProject, true) : leadProject.nextStep}, открытых deliverables: ${projectOpenDeliverables(leadProject)}.`
				: "Отдельного красного проекта нет — нужен один главный рабочий вектор вместо распыления.",
			queue.length > 0
				? `Рабочие задачи под давлением: ${queue.map((task) => formatTaskBrief(task, context.today)).join("; ")}.`
				: "Явных дедлайнов мало, поэтому агент должен сам выбрать один главный шаг и два вторичных.",
			taskWindows.length > 0
				? `Предварительное распределение по окнам: ${taskWindows.map((window) => formatTaskWindowSuggestion(window)).join("; ")}.`
				: overflowTasks.length > 0
					? `Пока без окна: ${overflowTasks.map((task) => formatTaskBrief(task, context.today)).join("; ")}.`
					: "Пока нет явного распределения задач по окнам недели.",
		],
		requestLines: [
			leadProject && energyConstrained
				? "Если день тяжёлый по энергии, сузь next step до одного черновика или skeleton, а не до полной финализации."
				: leadProject
					? "Свяжи план с текущим next step проекта, а не придумывай новый параллельный трек."
				: "Если проекта явно не видно, выбери один центр тяжести по задачам.",
			"Разложи backlog по ближайшим окнам недели и покажи, какие задачи не должны бороться за один и тот же слот.",
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
	const cleanupToday = context.schedule.today.filter(isCleanupLoadSlot);
	const hasCleanupLoadToday = cleanupToday.length > 0;
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

	if (cleanupToday.length > 0) {
		signals.push(
			`Сегодня cleanup-нагрузка: ${cleanupToday.map((slot) => formatCleanupLoadBrief(slot)).join(" · ")}`,
		);
	}

	if (healthJournal) {
		signals.push(`Self-report: “${clipText(healthJournal.text, 64)}”`);
	}

	const habitsLine = missing.length > 0
		? `Сегодня не закрыты привычки: ${missing.map((habit) => `${habit.emoji} ${habit.name}`).join("; ")}.`
		: `Сегодня уже закрыто: ${
			context.habits.completedToday
				.slice(0, 3)
				.map((habit) => `${habit.emoji} ${habit.name}`)
				.join("; ") || "нет отмеченных привычек"
		}.`;
	const medicalLine = flags.length > 0
		? `Медсигналы: ${flags.map((flag) => `${flag.param.name} (${formatFlagStatus(flag.status)}, ${flag.entry.date})`).join("; ")}.`
		: context.medical.latestEntry
			? `Последняя медицинская запись: ${context.medical.latestEntry.name} от ${context.medical.latestEntry.date}.`
			: "Свежих медицинских записей пока нет.";
	const cleanupLine = hasCleanupLoadToday
		? `Сегодня cleanup-нагрузка: ${cleanupToday.map((slot) => formatCleanupLoadBrief(slot)).join("; ")}. Считать это существенной физической нагрузкой; отдельное cardio по умолчанию не форсировать.`
		: null;
	const selfReportLine = healthJournal
		? `Свежий self-report: "${clipText(healthJournal.text, 120)}".`
		: "Если строишь план, считай его через реальную энергию дня, а не через идеальную версию меня.";

	return {
		title:
			hasCleanupLoadToday
				? "Не дублировать cardio на cleanup-дне"
				: flags.length > 0
				? "Собрать health floor с учётом анализов"
				: missing.length >= 2
					? "Вернуть телесную базу до вечера"
					: undefined,
		context:
			flags.length > 0
				? "Есть конкретные медсигналы, поэтому productivity не должна притворяться лечением."
				: hasCleanupLoadToday
					? "Сегодня в расписании уже есть cleanup-нагрузка, поэтому бег не должен считаться обязательным по умолчанию."
				: missing.length > 0
					? "Сегодня база проседает на уровне привычек, а не на уровне мотивационных речей."
					: undefined,
		impact:
			missing.length > 0 || flags.length > 0 || hasCleanupLoadToday
				? hasCleanupLoadToday
					? "Попроси агента собрать щадящий health floor и отдельно решить, нужно ли сегодня вообще дополнительное cardio."
					: "Попроси агента зафиксировать реалистичный health floor без героизма и без потери медицинского контекста."
				: undefined,
		promptLines: [
			habitsLine,
			cleanupLine ?? medicalLine,
			hasCleanupLoadToday ? selfReportLine : selfReportLine,
		],
		requestLines: [
			hasCleanupLoadToday
				? "Если сегодня уже есть cleanup-нагрузка, не форсируй отдельное cardio по умолчанию; максимум mobility или walk, если это помогает восстановлению."
				: "Сделай план щадящим: одна минимальная победа до вечера, один follow-up и один запрет на перегруз.",
			flags.length > 0
				? "Не спорь с медицинскими флагами: сначала объясни безопасный минимум, потом нагрузку."
				: "Если не хватает энергии, снижай план, а не добавляй чувство вины.",
		],
		signals,
		tags: [
			...missing.map((habit) => habit.id),
			flags.length > 0 ? "medical-flag" : null,
			hasCleanupLoadToday ? "cleanup-load" : null,
			cleanupToday.some(isBetweenPartiesSupportSlot) ? "between-parties" : null,
			healthJournal ? "self-report" : null,
		].filter(Boolean) as string[],
		weightBoost:
			flags.length * 10 +
			missing.length * 5 +
			cleanupToday.length * 6 +
			(context.habits.completedToday.length === 0 ? 4 : 0),
	};
}

function buildFamilyRuntimeData(
	context: RecommendationRuntimeContext,
): CandidateRuntimeData {
	const studio = context.schedule.studio.slice(0, 2);
	const cleanup = context.schedule.cleanup[0] ?? null;
	const betweenPartySupport = context.schedule.cleanup.find(isBetweenPartiesSupportSlot) ?? null;
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

	if (betweenPartySupport) {
		signals.push(`Между двойными праздниками нужна помощь Саше: ${formatSlotBrief(betweenPartySupport)}`);
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
				? "Попроси агента заранее разложить буферы, логистику и ключевые решения, пока неделя ещё не захлопнулась."
				: undefined,
		promptLines: [
			studio.length > 0
				? `Ближайшие студийные события: ${studio.map(formatSlotBrief).join("; ")}.`
				: "Явного студийного давления в ближайшие дни нет, но семейную часть всё равно стоит зафиксировать заранее.",
			betweenPartySupport
				? `Между двойными праздниками нужен support-слот: ${formatSlotBrief(betweenPartySupport)}; это обязательная помощь Саше с уборкой пространства.`
				: cleanup
					? `После событий запланирована уборка: ${formatSlotBrief(cleanup)}.`
					: "Пока отдельного cleanup-слота не видно.",
			cleanup
				? `Cleanup-нагрузка на горизонте: ${formatSlotBrief(cleanup)}.`
				: "",
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
	const taskWindows = context.tasks.distribution.suggestions.slice(0, 3);
	const overflowTasks = context.tasks.distribution.overflowTasks.slice(0, 3);
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

	if (taskWindows.length > 0) {
		signals.push(`Разложено по окнам: ${taskWindows.map((window) => formatTaskWindowSuggestion(window)).join(" · ")}`);
	}

	if (overflowTasks.length > 0) {
		signals.push(`Ещё без слота: ${overflowTasks.map((task) => clipText(task.title, 28)).join(" · ")}`);
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
				? "Попроси агента сделать triage хвостов и оставить одно первое действие на сегодня."
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
			taskWindows.length > 0
				? `Предлагаемые task-окна: ${taskWindows.map((window) => formatTaskWindowSuggestion(window)).join("; ")}.`
				: overflowTasks.length > 0
					? `Пока без окна: ${overflowTasks.map((task) => formatTaskBrief(task, context.today)).join("; ")}.`
					: "Текущих рекомендаций по слотам пока нет.",
		],
		requestLines: [
			"Раздели всё на удалить / перенести / сделать первым.",
			"Подбери оптимальные окна недели для всех живых задач и явно покажи, что не помещается без перегруза.",
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
				? "Опиши агенту, что происходит, что буксует и что важно — пусть он соберёт 1–2 решения и один следующий шаг."
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
	const cleanupToday = context.schedule.today.filter(isCleanupLoadSlot);
	const cleanupUpcoming = context.schedule.cleanup.slice(0, 2);
	const betweenPartySupport = cleanupUpcoming.filter(isBetweenPartiesSupportSlot);
	const nextRecoverySlot = context.schedule.all.find(isTrueRecoverySlot) ?? null;
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

	if (cleanupToday.length > 0) {
		signals.push(
			`Сегодня cleanup-нагрузка: ${cleanupToday.map((slot) => formatCleanupLoadBrief(slot)).join(" · ")}`,
		);
	} else if (betweenPartySupport.length > 0) {
		signals.push(
			`Между двойными праздниками нужна помощь Саше: ${betweenPartySupport.map((slot) => formatSlotBrief(slot)).join(" · ")}`,
		);
	} else if (cleanupUpcoming.length > 0) {
		signals.push(
			`Впереди cleanup-нагрузка: ${cleanupUpcoming.map((slot) => formatCleanupLoadBrief(slot)).join(" · ")}`,
		);
	}

	if (nextRecoverySlot) {
		signals.push(`Ближайшее recovery-окно: ${formatSlotBrief(nextRecoverySlot)}`);
	}

	const cleanupPriorityLine = cleanupToday.length > 0 || cleanupUpcoming.length > 0
		? `Cleanup-нагрузка: ${(cleanupToday.length > 0 ? cleanupToday : cleanupUpcoming)
			.map((slot) => formatCleanupLoadBrief(slot))
			.join("; ")}. Считать это полноценной физической нагрузкой.`
		: null;

	return {
		title:
			overloaded.length > 0
				? "Выбить окно восстановления в плотной неделе"
				: sleepMissing
					? "Не отдать recovery случайной срочности"
					: undefined,
		context:
			cleanupToday.length > 0
				? "После cleanup-дня recovery надо бронировать на неделе заранее, а не решать постфактум."
				: sleepMissing
				? "Сегодня recovery уже проседает на базовом уровне, а не на уровне красивых намерений."
				: overloaded.length > 0
					? "Неделя уже местами перегрета — окно отдыха нужно поставить сейчас."
					: undefined,
		impact:
			missingRecovery.length > 0 || overloaded.length > 0 || !nextRecoverySlot || cleanupToday.length > 0 || cleanupUpcoming.length > 0
				? cleanupToday.length > 0 || cleanupUpcoming.length > 0
					? "Попроси агента выбрать одно recovery-окно на неделю и использовать cleanup-пики как аргумент для защиты этого окна."
					: "Попроси агента защитить энергию конкретным слотом, а не абстрактным обещанием отдохнуть потом."
				: undefined,
		promptLines: [
			missingRecovery.length > 0
				? `Сегодня не закрыты recovery-сигналы: ${missingRecovery.map((habit) => `${habit.emoji} ${habit.name}`).join("; ")}.`
				: "Ключевые recovery-привычки сегодня уже частично отмечены.",
			cleanupPriorityLine
				? `${cleanupPriorityLine.replace("Считать это полноценной физической нагрузкой.", "Используй это как аргумент для recovery-окна, а не как повтор отдельного cardio-разговора.")}`
				: (nextRecoverySlot
				? `Ближайшее recovery-окно: ${formatSlotBrief(nextRecoverySlot)}.`
				: "Ближайшее recovery-окно в расписании не видно."),
			betweenPartySupport.length > 0
				? `Между двойными праздниками есть support-слот помочь Саше: ${betweenPartySupport.map((slot) => formatSlotBrief(slot)).join("; ")}.`
				: overloaded.length > 0
				? `Перегруженные дни: ${overloaded.map((day) => formatPressureDay(day)).join("; ")}.`
				: cleanupUpcoming.length > 0
					? `Впереди cleanup-нагрузка: ${cleanupUpcoming.map((slot) => formatCleanupLoadBrief(slot)).join("; ")}.`
					: "Перегруженных дней на горизонте недели не найдено.",
		],
		requestLines: [
			"Найди одно невыбиваемое окно восстановления на неделю и привяжи его к текущему графику.",
			cleanupToday.length > 0 || cleanupUpcoming.length > 0
				? "Не дублируй health-блок: cleanup здесь нужен как аргумент для recovery-окна и разгрузки недели, а не как второй разговор про cardio."
				: "Покажи, чем именно защитить recovery-окно от срочности.",
			"Если день уже перегружен, покажи что именно лучше не делать.",
		],
		signals,
		tags: [
			sleepMissing ? "sleep" : null,
			overloaded.length > 0 ? "overload" : null,
			cleanupToday.length > 0 || cleanupUpcoming.length > 0 ? "cleanup-load" : null,
			betweenPartySupport.length > 0 ? "between-parties" : null,
			nextRecoverySlot ? "scheduled-recovery" : "missing-recovery",
		].filter(Boolean) as string[],
		weightBoost:
			(sleepMissing ? 8 : 0) +
			overloaded.length * 6 +
			cleanupUpcoming.length * 5 +
			betweenPartySupport.length * 4 +
			(nextRecoverySlot ? 0 : 6),
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
	const areaSignals = uniquePromptLines(area.evidence).slice(0, 1);
	const liveSignals = uniquePromptLines(runtimeData?.promptLines ?? []).slice(0, 3);
	const runtimeInstructions = uniquePromptLines(runtimeData?.requestLines ?? []).slice(0, 1);

	const contextLines = [
		`Контекст ALPHACORE:`,
		`- Баланс: ${snapshot.balanceScore}/100`,
		`- Зона: ${area.label} (${area.level})`,
		`- Почему сейчас: ${priority?.reason ?? area.insight}`,
		`- Текущая сводка: ${area.summary}`,
		...areaSignals.map((item) => `- Сигнал: ${item}`),
		"",
	];

	if (liveSignals.length > 0) {
		contextLines.push("- Реальные сигналы из текущих данных:");
		contextLines.push(...liveSignals.map((item) => `- ${item}`));
		contextLines.push("");
	}

	const askByArea: Record<AttentionAreaKey, string[]> = {
		work: [
			"Сделай рабочий prompt для AI-агента в IDE по текущему узлу.",
			"Разверни текущий next step в 2–3 действия и выбери одно главное на сегодня.",
		],
		health: [
			"Сделай щадящий health-prompt на сегодня.",
			"Собери минимальный health floor: сон, растяжка, умеренное движение и follow-up по анализам.",
		],
		family: [
			"Сделай prompt для защиты семейной части недели.",
			"Разложи буферы, логистику и 1–2 решения вокруг студии.",
		],
		operations: [
			"Сделай prompt на разбор хвостов.",
			"Раздели всё на удалить / перенести / сделать первым.",
		],
		reflection: [
			"Сделай короткий review-prompt для AI-агента.",
			"Пусть агент разберёт: что движется, что буксует и какой один следующий шаг сейчас главный.",
		],
		recovery: [
			"Сделай prompt на восстановление и ритм недели.",
			"Найди одно невыбиваемое окно восстановления и привяжи его к текущему графику.",
		],
	};

	const taskLines = uniquePromptLines([
		...askByArea[area.key],
		...runtimeInstructions,
	]).slice(0, 3);

	const taskBlock = [
		"Что нужно от агента:",
		...taskLines.map((line) => `- ${line}`),
		"",
	];

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
		...taskBlock,
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
			areaKey: area.key,
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

export function buildAgentPracticalPlan(
	recommendations: AgentRecommendation[],
	context: RecommendationRuntimeContext | null | undefined,
): AgentPracticalPlan | null {
	if (!context || recommendations.length === 0) return null;

	const areaSet = new Set(recommendations.map((recommendation) => recommendation.areaKey));
	const leadProject = context.projects.attention[0] ?? null;
	const leadTask =
		context.tasks.p1[0] ??
		context.tasks.overdue[0] ??
		context.tasks.dueSoon[0] ??
		context.tasks.unscheduled[0] ??
		null;
	const planningSlot = pickPlanningSlot(context);
	const recoveryAnchor = pickRecoveryAnchor(context);
	const cleanupToday = context.schedule.today.filter(isCleanupLoadSlot);
	const energyConflict =
		cleanupToday.length > 0 ||
		areaSet.has("health") ||
		areaSet.has("recovery");
	const projectTarget = leadProject
		? `${leadProject.name}: ${buildProjectFocusLabel(leadProject, energyConflict)}`
		: leadTask
			? clipText(leadTask.title, 78)
			: "сузить день до одного следующего шага";

	const mainDecision = energyConflict
		? planningSlot
			? `В ${planningSlot.start}–${planningSlot.end} сделать один decision sprint по ${projectTarget}; отдельное cardio сегодня не добавлять.`
			: `Не добавлять отдельное cardio сегодня и сузить работу до одного planning-узла: ${projectTarget}.`
		: planningSlot
			? `В ${planningSlot.start}–${planningSlot.end} развернуть один рабочий узел по ${projectTarget}.`
			: `Оставить на сегодня один главный узел: ${projectTarget}.`;

	const backupMoves = uniquePromptLines([
		energyConflict
			? "Если после cleanup энергии мало — ограничиться task + calendar + journal, без второй рабочей волны."
			: "Если день схлопнется — оставить только один главный узел и убрать всё второстепенное.",
		leadProject
			? `Если появится тихое окно 20–25 минут — сделать только skeleton по ${leadProject.name}, без полировки и новых веток.`
			: leadTask
				? `Если появится короткое окно — закрыть только ${clipText(leadTask.title, 46)}, остальное перенести.`
				: "Если появится короткое окно — использовать его только на одно точечное действие.",
		recoveryAnchor
			? recoveryAnchor.mode === "protect"
				? `Если неделя начнёт съезжать — не трогать ${formatRecoveryAnchorBrief(recoveryAnchor)} и не отдавать его под срочность.`
				: `Если всё поедет — сначала превратить ${formatRecoveryAnchorBrief(recoveryAnchor)} в recovery-окно, а не в ещё одну рабочую сессию.`
			: "Если сил не хватает — сначала поставить recovery-окно, потом решать, что делать ещё.",
	]).slice(0, 2);

	const doneParts = uniquePromptLines([
		energyConflict ? "отдельного cardio не добавлено" : null,
		leadProject || leadTask ? "один рабочий узел зафиксирован" : null,
		recoveryAnchor ? "одно recovery-окно стоит в календаре" : null,
		areaSet.has("reflection") ? "в Journal есть короткий review" : null,
	]);

	const mergedThemes = uniquePromptLines([
		areaSet.has("health") && areaSet.has("recovery")
			? "Здоровье + восстановление → один энергоконтур без дублирования cardio и recovery-советов."
			: null,
		areaSet.has("work") && areaSet.has("reflection")
			? "Работа + review → короткий decision sprint вместо длинной рефлексии."
			: null,
		(context.schedule.cleanup.length > 0 || context.schedule.studio.length > 0) &&
		(areaSet.has("family") || areaSet.has("operations"))
			? "Студия + операционка → сначала логистика и буферы, потом всё остальное."
			: null,
	]);

	const review = areaSet.has("reflection")
		? buildReviewSummary(context, leadProject, leadTask)
		: null;
	const taskWindows = context.tasks.distribution.suggestions
		.slice(0, 4)
		.map((window) => formatTaskWindowSuggestion(window));
	const overflowSummary = context.tasks.distribution.overflowTasks.length > 0
		? `Без слота пока: ${context.tasks.distribution.overflowTasks
			.slice(0, 3)
			.map((task) => clipText(task.title, 34))
			.join(" · ")}`
		: null;

	const scheduleUpdate = recoveryAnchor
		? recoveryAnchor.mode === "protect"
			? `Защитить ${formatRecoveryAnchorBrief(recoveryAnchor)} как recovery без других задач.`
			: recoveryAnchor.mode === "create"
				? `Добавить ${formatRecoveryAnchorBrief(recoveryAnchor)} как невыбиваемое recovery-окно.`
				: `Перевести ${formatRecoveryAnchorBrief(recoveryAnchor)} в recovery / stretch + walk без рабочих задач.`
		: planningSlot
			? `Забронировать ${planningSlot.start}–${planningSlot.end} сегодня под decision sprint без новых параллельных задач.`
			: "Добавить одно recovery-окно на неделе и не смешивать его с работой.";

	const journalLineParts = uniquePromptLines([
		energyConflict ? "Сегодня не форсирую отдельное cardio после cleanup." : "Сегодня режу план до одного главного узла.",
		leadProject
			? `Центр тяжести: ${leadProject.name} — ${buildProjectFocusLabel(leadProject, energyConflict)}.`
			: leadTask
				? `Первое действие: ${clipText(leadTask.title, 72)}.`
				: null,
		recoveryAnchor ? `Recovery-окно: ${formatRecoveryAnchorBrief(recoveryAnchor)}.` : null,
		review,
	]);

	return {
		mergedThemes,
		mainDecision,
		backupMoves,
		doneCriterion:
			doneParts.length > 0
				? `${doneParts.join(", ")}.`
				: "Есть один главный шаг, один защищённый recovery-контур и нет параллельного раздувания дня.",
		review,
		taskWindows,
		overflowSummary,
		updates: {
			task: leadProject
				? `${leadProject.name} — ${buildProjectFocusLabel(leadProject, energyConflict)}`
				: leadTask
					? clipText(leadTask.title, 92)
					: "Один главный следующий шаг на сегодня",
			schedule: scheduleUpdate,
			journal: journalLineParts.join(" "),
		},
	};
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
