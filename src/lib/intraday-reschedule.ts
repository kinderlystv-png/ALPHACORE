import type { HeysMetricKey } from "./heys-day-mode";
import {
	addCustomEvent,
	getCustomEvents,
	getScheduleForDate,
	isEditableScheduleSlot,
	unscheduleCustomTaskEvent,
	updateEditableScheduleSlot,
	type ScheduleTone,
} from "./schedule";
import { getTasks, updateTask, type AutomationOrigin } from "./tasks";

export type IntradayRescheduleAction =
	| {
			type: "compress-slot";
			slotId: string;
			date: string;
			title: string;
			end: string;
			tone: ScheduleTone;
			tags: string[];
			metricKey?: HeysMetricKey | null;
	  }
	| {
			type: "protect-recovery";
			strategy: "update-slot" | "create-event";
			slotId?: string;
			date: string;
			start: string;
			end: string;
			title: string;
			tone: ScheduleTone;
			tags: string[];
			metricKey?: HeysMetricKey | null;
	  }
	| {
			type: "convert-slot";
			slotId: string;
			date: string;
			start: string;
			end: string;
			title: string;
			tone: ScheduleTone;
			tags: string[];
			metricKey?: HeysMetricKey | null;
	  }
	| {
			type: "move-task";
			taskId: string;
			title: string;
			dueDate: string;
	  }
	| {
			type: "unslot";
			eventId: string;
			title: string;
	  };

export type IntradayRescheduleApplyResult = {
	outcome: "applied" | "noop" | "error";
	message: string;
};

function uniqueTags(tags: string[]): string[] {
	return [...new Set(tags.filter(Boolean))];
}

function sameTags(left: string[], right: string[]): boolean {
	if (left.length !== right.length) return false;
	const rightSet = new Set(right);
	return left.every((tag) => rightSet.has(tag));
}

function formatDateLabel(dateKey: string): string {
	const today = new Date().toISOString().slice(0, 10);
	const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
	if (dateKey === today) return "сегодня";
	if (dateKey === tomorrow) return "завтра";

	return new Intl.DateTimeFormat("ru-RU", {
		weekday: "short",
		day: "numeric",
		month: "short",
	}).format(new Date(`${dateKey}T00:00:00`));
}

function buildOrigin(metricKey?: HeysMetricKey | null): AutomationOrigin {
	return {
		source: "heys",
		metricKey: metricKey ?? undefined,
		via: "autopilot",
	};
}

export function applyIntradayRescheduleAction(
	action: IntradayRescheduleAction,
): IntradayRescheduleApplyResult {
	switch (action.type) {
		case "compress-slot": {
			const slot = getScheduleForDate(action.date).find((candidate) => candidate.id === action.slotId);
			if (!slot) {
				return {
					outcome: "noop",
					message: "Слот уже изменился или исчез из расписания.",
				};
			}
			if (!isEditableScheduleSlot(slot)) {
				return {
					outcome: "error",
					message: "Этот слот нельзя сжать автоматически — он уже locked логикой расписания.",
				};
			}

			const nextTags = uniqueTags(action.tags);
			if (
				slot.end === action.end &&
				slot.title === action.title &&
				slot.tone === action.tone &&
				sameTags(slot.tags, nextTags)
			) {
				return {
					outcome: "noop",
					message: `Слот уже сжат: ${slot.start}–${slot.end}.`,
				};
			}

			updateEditableScheduleSlot(slot, {
				end: action.end,
				title: action.title,
				tone: action.tone,
				tags: nextTags,
			});
			return {
				outcome: "applied",
				message: `Слот сжат до ${slot.start}–${action.end} (${formatDateLabel(action.date)}).`,
			};
		}
		case "protect-recovery": {
			if (action.strategy === "update-slot" && action.slotId) {
				const slot = getScheduleForDate(action.date).find((candidate) => candidate.id === action.slotId);
				if (!slot) {
					return {
						outcome: "noop",
						message: "Recovery-окно уже изменилось или исчезло.",
					};
				}
				if (!isEditableScheduleSlot(slot)) {
					return {
						outcome: "error",
						message: "Это recovery-окно нельзя защитить автоматически.",
					};
				}

				const nextTags = uniqueTags(action.tags);
				if (
					slot.title === action.title &&
					slot.tone === action.tone &&
					sameTags(slot.tags, nextTags)
				) {
					return {
						outcome: "noop",
						message: `Recovery-окно уже защищено: ${formatDateLabel(action.date)} ${slot.start}–${slot.end}.`,
					};
				}

				updateEditableScheduleSlot(slot, {
					title: action.title,
					tone: action.tone,
					tags: nextTags,
				});
				return {
					outcome: "applied",
					message: `Recovery-окно защищено: ${formatDateLabel(action.date)} ${slot.start}–${slot.end}.`,
				};
			}

			const existing = getCustomEvents(action.date).find(
				(event) =>
					event.title === action.title &&
					event.start === action.start &&
					event.end === action.end,
			);
			if (existing) {
				return {
					outcome: "noop",
					message: `Recovery-буфер уже стоит: ${formatDateLabel(action.date)} ${action.start}.`,
				};
			}

			addCustomEvent({
				date: action.date,
				start: action.start,
				end: action.end,
				title: action.title,
				tone: action.tone,
				tags: uniqueTags(action.tags),
				kind: "event",
				origin: buildOrigin(action.metricKey),
			});
			return {
				outcome: "applied",
				message: `Recovery-буфер добавлен: ${formatDateLabel(action.date)} ${action.start}–${action.end}.`,
			};
		}
		case "convert-slot": {
			const slot = getScheduleForDate(action.date).find((candidate) => candidate.id === action.slotId);
			if (!slot) {
				return {
					outcome: "noop",
					message: "Слот для конвертации уже изменился или исчез.",
				};
			}
			if (!isEditableScheduleSlot(slot)) {
				return {
					outcome: "error",
					message: "Этот слот нельзя перевести в recovery автоматически.",
				};
			}

			const nextTags = uniqueTags(action.tags);
			if (
				slot.title === action.title &&
				slot.tone === action.tone &&
				sameTags(slot.tags, nextTags)
			) {
				return {
					outcome: "noop",
					message: `Слот уже переведён в recovery: ${formatDateLabel(action.date)} ${action.start}–${action.end}.`,
				};
			}

			updateEditableScheduleSlot(slot, {
				title: action.title,
				tone: action.tone,
				tags: nextTags,
			});
			return {
				outcome: "applied",
				message: `Слот переведён в recovery: ${formatDateLabel(action.date)} ${action.start}–${action.end}.`,
			};
		}
		case "move-task": {
			const task = getTasks().find((candidate) => candidate.id === action.taskId);
			if (!task) {
				return {
					outcome: "noop",
					message: "Задача уже изменилась или исчезла из списка.",
				};
			}
			if (task.dueDate === action.dueDate) {
				return {
					outcome: "noop",
					message: `Задача уже стоит на ${formatDateLabel(action.dueDate)}.`,
				};
			}

			updateTask(action.taskId, { dueDate: action.dueDate });
			return {
				outcome: "applied",
				message: `Задача перенесена на ${formatDateLabel(action.dueDate)}: ${action.title}.`,
			};
		}
		case "unslot": {
			const event = getCustomEvents().find((candidate) => candidate.id === action.eventId);
			if (!event) {
				return {
					outcome: "noop",
					message: "Task-slot уже снят или изменён.",
				};
			}

			const removed = unscheduleCustomTaskEvent(action.eventId);
			if (!removed) {
				return {
					outcome: "error",
					message: "Не удалось снять task-slot автоматически.",
				};
			}

			return {
				outcome: "applied",
				message: `Task-slot снят из календаря: ${action.title}.`,
			};
		}
	}
}
