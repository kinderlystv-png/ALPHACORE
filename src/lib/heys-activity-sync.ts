import {
  addCustomEvent,
  getCustomEvents,
  getScheduleForDate,
  isEditableScheduleSlot,
  minutesToTime,
  timeToMinutes,
  updateCustomEvent,
  updateEditableScheduleSlot,
  type CustomEvent,
  type ScheduleSlot,
  type ScheduleTone,
} from "./schedule";
import { lsGet, lsSet } from "./storage";
import { getTasks, updateTask, type Task } from "./tasks";
import type {
  HeysDayRecord,
  HeysHouseholdActivity,
  HeysSyncSnapshot,
  HeysTrainingRecord,
} from "./heys-bridge";

const HEYS_ACTIVITY_SYNC_KEY = "alphacore_heys_activity_sync";
const RECENT_ACTIVITY_DAYS = 2;
const STALE_ACTIVITY_DAYS = 14;
const TRAINING_SLOT_HINT_RE = /бег|трен|кардио|силов|растяж|workout|run|health|здоров/i;
const HOUSEHOLD_SLOT_HINT_RE = /уборк|cleanup|household|быт|опер|студи|дела/i;

type ActivityKind = "training" | "household";

type HeysActualActivity = {
  syncId: string;
  fingerprint: string;
  kind: ActivityKind;
  date: string;
  start: string;
  end: string;
  startMin: number;
  endMin: number;
  durationMin: number;
  title: string;
  tone: ScheduleTone;
  tags: string[];
  metricKey: string;
  semanticLabel: string;
};

type HeysActivitySyncState = {
  lastAppliedAt: string | null;
  applied: Record<
    string,
    {
      fingerprint: string;
      date: string;
      appliedAt: string;
    }
  >;
};

export type HeysActivitySyncResult = {
  created: number;
  updated: number;
  matchedTasks: number;
  skipped: number;
  processed: number;
};

function shiftDate(dateKey: string, days: number): string {
  const next = new Date(`${dateKey}T00:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function isRecentDate(dateKey: string, anchor = new Date()): boolean {
  const anchorKey = anchor.toISOString().slice(0, 10);
  const cutoffKey = shiftDate(anchorKey, -(RECENT_ACTIVITY_DAYS - 1));
  return dateKey >= cutoffKey && dateKey <= anchorKey;
}

function isStaleDate(dateKey: string, anchor = new Date()): boolean {
  const anchorKey = anchor.toISOString().slice(0, 10);
  const cutoffKey = shiftDate(anchorKey, -STALE_ACTIVITY_DAYS);
  return dateKey < cutoffKey;
}

function uniqueTags(tags: string[]): string[] {
  return [...new Set(tags.filter(Boolean))];
}

function buildTrainingLabel(training: HeysTrainingRecord): string {
  switch ((training.type ?? "").trim().toLowerCase()) {
    case "strength":
      return "Силовая тренировка";
    case "hobby":
      return "Активность / хобби";
    case "cardio":
      return "Кардио";
    default:
      return "Тренировка";
  }
}

function buildTrainingTitle(training: HeysTrainingRecord): string {
  const label = buildTrainingLabel(training);
  return `✅ ${label}`;
}

function buildHouseholdTitle(): string {
  return "✅ Бытовая активность";
}

function buildEndTime(start: string, minutes: number): string {
  return minutesToTime(timeToMinutes(start) + minutes);
}

function buildTrainingActivity(
  day: HeysDayRecord,
  training: HeysTrainingRecord,
  index: number,
): HeysActualActivity | null {
  if (!training.time || training.durationMin <= 0) return null;

  const syncId = `training:${day.date}:${index}`;
  const start = training.time;
  const end = buildEndTime(start, training.durationMin);
  const semanticLabel = buildTrainingLabel(training);

  return {
    syncId,
    fingerprint: `${syncId}:${start}:${end}:${training.type ?? "training"}:${training.durationMin}`,
    kind: "training",
    date: day.date,
    start,
    end,
    startMin: timeToMinutes(start),
    endMin: timeToMinutes(end),
    durationMin: training.durationMin,
    title: buildTrainingTitle(training),
    tone: "health",
    tags: uniqueTags([
      "heys",
      "heys-actual",
      "training",
      training.type ?? "training",
    ]),
    metricKey: "training",
    semanticLabel,
  };
}

function buildHouseholdActivityEntry(
  day: HeysDayRecord,
  activity: HeysHouseholdActivity,
  index: number,
): HeysActualActivity | null {
  if (!activity.time || activity.minutes <= 0) return null;

  const syncId = `household:${day.date}:${index}`;
  const start = activity.time;
  const end = buildEndTime(start, activity.minutes);

  return {
    syncId,
    fingerprint: `${syncId}:${start}:${end}:household:${activity.minutes}`,
    kind: "household",
    date: day.date,
    start,
    end,
    startMin: timeToMinutes(start),
    endMin: timeToMinutes(end),
    durationMin: activity.minutes,
    title: buildHouseholdTitle(),
    tone: "cleanup",
    tags: uniqueTags(["heys", "heys-actual", "household", "cleanup"]),
    metricKey: "household",
    semanticLabel: "Бытовая активность",
  };
}

function collectActualActivities(snapshot: HeysSyncSnapshot): HeysActualActivity[] {
  return [...snapshot.days]
    .sort((left, right) => left.date.localeCompare(right.date))
    .filter((day) => isRecentDate(day.date))
    .flatMap((day) => {
      const trainingActivities = [...day.trainings]
        .sort((left, right) => (left.time ?? "").localeCompare(right.time ?? ""))
        .map((training, index) => buildTrainingActivity(day, training, index))
        .filter((value): value is HeysActualActivity => value != null);

      const householdActivities = [...day.householdActivities]
        .sort((left, right) => (left.time ?? "").localeCompare(right.time ?? ""))
        .map((activity, index) => buildHouseholdActivityEntry(day, activity, index))
        .filter((value): value is HeysActualActivity => value != null);

      return [...trainingActivities, ...householdActivities];
    });
}

function loadSyncState(): HeysActivitySyncState {
  const stored = lsGet<HeysActivitySyncState>(HEYS_ACTIVITY_SYNC_KEY, {
    lastAppliedAt: null,
    applied: {},
  });

  const nextApplied = Object.fromEntries(
    Object.entries(stored.applied ?? {}).filter(([, value]) => !isStaleDate(value.date)),
  );

  return {
    lastAppliedAt: stored.lastAppliedAt ?? null,
    applied: nextApplied,
  };
}

function saveSyncState(state: HeysActivitySyncState): void {
  lsSet(HEYS_ACTIVITY_SYNC_KEY, state);
}

function isTaskOpen(task: Task): boolean {
  return task.status === "inbox" || task.status === "active";
}

function markTaskDone(taskId: string): boolean {
  const task = getTasks().find((candidate) => candidate.id === taskId);
  if (!task || task.status === "done") return false;

  updateTask(taskId, {
    status: "done",
    completedAt: new Date().toISOString(),
  });
  return true;
}

function intervalGapMinutes(
  left: Pick<HeysActualActivity, "startMin" | "endMin">,
  right: Pick<ScheduleSlot, "start" | "end">,
): number {
  const rightStart = timeToMinutes(right.start);
  const rightEnd = timeToMinutes(right.end);

  if (left.startMin < rightEnd && left.endMin > rightStart) {
    return 0;
  }

  if (left.endMin <= rightStart) {
    return rightStart - left.endMin;
  }

  return left.startMin - rightEnd;
}

function startDiffMinutes(
  left: Pick<HeysActualActivity, "startMin">,
  right: Pick<ScheduleSlot, "start">,
): number {
  return Math.abs(left.startMin - timeToMinutes(right.start));
}

function slotSemanticallyMatches(slot: ScheduleSlot, activity: HeysActualActivity): boolean {
  const haystack = `${slot.title} ${slot.subtitle ?? ""} ${slot.tags.join(" ")}`.toLowerCase();

  if (activity.kind === "training") {
    return slot.tone === "health" || TRAINING_SLOT_HINT_RE.test(haystack);
  }

  return slot.tone === "cleanup" || HOUSEHOLD_SLOT_HINT_RE.test(haystack);
}

function findNearbyPlannedSlot(activity: HeysActualActivity): ScheduleSlot | null {
  const maxGap = activity.kind === "training" ? 150 : 180;

  return getScheduleForDate(activity.date)
    .filter(isEditableScheduleSlot)
    .filter((slot) => slotSemanticallyMatches(slot, activity))
    .map((slot) => ({
      slot,
      gap: intervalGapMinutes(activity, slot),
      startGap: startDiffMinutes(activity, slot),
    }))
    .filter((entry) => entry.gap <= maxGap || entry.startGap <= maxGap)
    .sort((left, right) => {
      return (
        left.gap - right.gap ||
        left.startGap - right.startGap ||
        timeToMinutes(left.slot.start) - timeToMinutes(right.slot.start)
      );
    })[0]?.slot ?? null;
}

function taskSemanticallyMatches(task: Task, activity: HeysActualActivity): boolean {
  if (!isTaskOpen(task)) return false;
  if (task.dueDate && task.dueDate !== activity.date) return false;

  const haystack = `${task.title} ${task.project ?? ""} ${task.origin?.metricKey ?? ""}`.toLowerCase();

  if (activity.kind === "training") {
    return TRAINING_SLOT_HINT_RE.test(haystack);
  }

  return HOUSEHOLD_SLOT_HINT_RE.test(haystack);
}

function findOpenTaskCandidate(activity: HeysActualActivity): Task | null {
  return getTasks()
    .filter((task) => taskSemanticallyMatches(task, activity))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0] ?? null;
}

function findExistingSyncEvent(activity: HeysActualActivity): CustomEvent | null {
  return (
    getCustomEvents(activity.date).find(
      (event) =>
        event.origin?.source === "heys" &&
        event.origin?.bundleLabel === "heys-activity-sync" &&
        event.origin?.bundleId === activity.syncId,
    ) ?? null
  );
}

function createOrigin(activity: HeysActualActivity): NonNullable<CustomEvent["origin"]> {
  return {
    source: "heys",
    via: "autopilot",
    metricKey: activity.metricKey,
    bundleId: activity.syncId,
    bundleLabel: "heys-activity-sync",
    bundlePart: activity.kind,
    bundleRunId: activity.fingerprint,
  };
}

function ensureCustomEventFromActivity(
  activity: HeysActualActivity,
  existingTask: Task | null,
): void {
  addCustomEvent({
    date: activity.date,
    start: activity.start,
    end: activity.end,
    title: existingTask ? `✅ ${existingTask.title}` : activity.title,
    tone: activity.tone,
    tags: activity.tags,
    kind: "event",
    taskId: null,
    origin: createOrigin(activity),
  });
}

function updateExistingSyncEvent(activity: HeysActualActivity, existing: CustomEvent): boolean {
  const nextTitle = existing.title || activity.title;

  if (
    existing.start === activity.start &&
    existing.end === activity.end &&
    existing.title === nextTitle &&
    existing.tone === activity.tone
  ) {
    return false;
  }

  updateCustomEvent(existing.id, {
    start: activity.start,
    end: activity.end,
    title: nextTitle,
    tone: activity.tone,
    tags: activity.tags,
    kind: "event",
    taskId: null,
    origin: createOrigin(activity),
  });
  return true;
}

function reconcileSingleActivity(activity: HeysActualActivity): Omit<HeysActivitySyncResult, "processed"> {
  const existingSyncEvent = findExistingSyncEvent(activity);
  if (existingSyncEvent) {
    return {
      created: 0,
      updated: updateExistingSyncEvent(activity, existingSyncEvent) ? 1 : 0,
      matchedTasks: 0,
      skipped: existingSyncEvent.start === activity.start && existingSyncEvent.end === activity.end ? 1 : 0,
    };
  }

  const nearbySlot = findNearbyPlannedSlot(activity);
  if (nearbySlot) {
    const changed =
      nearbySlot.start !== activity.start ||
      nearbySlot.end !== activity.end;

    if (changed) {
      updateEditableScheduleSlot(nearbySlot, {
        start: activity.start,
        end: activity.end,
      });
    }

    const matchedTaskDone = nearbySlot.taskId ? markTaskDone(nearbySlot.taskId) : false;

    return {
      created: 0,
      updated: changed ? 1 : 0,
      matchedTasks: matchedTaskDone ? 1 : 0,
      skipped: changed || matchedTaskDone ? 0 : 1,
    };
  }

  const openTask = findOpenTaskCandidate(activity);
  const matchedTaskDone = openTask ? markTaskDone(openTask.id) : false;
  ensureCustomEventFromActivity(activity, openTask);

  return {
    created: 1,
    updated: 0,
    matchedTasks: matchedTaskDone ? 1 : 0,
    skipped: 0,
  };
}

export function reconcileHeysActualActivities(snapshot: HeysSyncSnapshot): HeysActivitySyncResult {
  const state = loadSyncState();
  const nowIso = new Date().toISOString();
  const activities = collectActualActivities(snapshot);
  const nextApplied = { ...state.applied };
  let created = 0;
  let updated = 0;
  let matchedTasks = 0;
  let skipped = 0;
  let processed = 0;

  const seenSyncIds = new Set(activities.map((activity) => activity.syncId));

  for (const activity of activities) {
    const previous = state.applied[activity.syncId];
    if (previous?.fingerprint === activity.fingerprint) {
      skipped += 1;
      continue;
    }

    const result = reconcileSingleActivity(activity);
    created += result.created;
    updated += result.updated;
    matchedTasks += result.matchedTasks;
    skipped += result.skipped;
    processed += 1;

    nextApplied[activity.syncId] = {
      fingerprint: activity.fingerprint,
      date: activity.date,
      appliedAt: nowIso,
    };
  }

  for (const [syncId, value] of Object.entries(nextApplied)) {
    if (!seenSyncIds.has(syncId) && isStaleDate(value.date)) {
      delete nextApplied[syncId];
    }
  }

  saveSyncState({
    lastAppliedAt: nowIso,
    applied: nextApplied,
  });

  return {
    created,
    updated,
    matchedTasks,
    skipped,
    processed,
  };
}
