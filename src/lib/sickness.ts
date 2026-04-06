import { lsGet, lsSet, uid } from "./storage";

export type ActiveSicknessPeriod = {
  id: string;
  startedAt: string;
};

export type ClosedSicknessPeriod = {
  id: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  durationDays: number;
  durationLabel: string;
  calendarDays: number;
  summary: string;
};

export type SicknessLog = {
  activePeriod: ActiveSicknessPeriod | null;
  history: ClosedSicknessPeriod[];
  updatedAt: string | null;
};

export const SICKNESS_KEY = "alphacore_sickness";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const EMPTY_LOG: SicknessLog = {
  activePeriod: null,
  history: [],
  updatedAt: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toIsoString(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString();
}

function round(value: number, precision = 2): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function formatShortDateTime(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function countCalendarDays(start: Date, end: Date): number {
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(1, Math.round((endDay.getTime() - startDay.getTime()) / DAY_MS) + 1);
}

function formatDurationLabel(durationMs: number): string {
  const safeDuration = Math.max(0, durationMs);
  const totalMinutes = Math.max(0, Math.round(safeDuration / MINUTE_MS));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];

  if (days > 0) parts.push(`${days} д`);
  if (hours > 0) parts.push(`${hours} ч`);
  if (days === 0 && minutes > 0) parts.push(`${minutes} мин`);

  return parts.length > 0 ? parts.join(" ") : "0 мин";
}

function buildClosedPeriod(
  id: string,
  startedAt: string,
  endedAt: string,
): ClosedSicknessPeriod {
  const start = new Date(startedAt);
  const rawEnd = new Date(endedAt);
  const end = rawEnd.getTime() >= start.getTime() ? rawEnd : start;
  const durationMs = Math.max(0, end.getTime() - start.getTime());
  const durationDays = round(durationMs / DAY_MS, 2);
  const durationLabel = formatDurationLabel(durationMs);
  const calendarDays = countCalendarDays(start, end);
  const summary = `${durationLabel} • ${formatShortDateTime(start)} → ${formatShortDateTime(end)} • ${calendarDays} календ. дн.`;

  return {
    id,
    startedAt: start.toISOString(),
    endedAt: end.toISOString(),
    durationMs,
    durationDays,
    durationLabel,
    calendarDays,
    summary,
  };
}

function normalizeActivePeriod(value: unknown): ActiveSicknessPeriod | null {
  if (!isRecord(value)) return null;

  const startedAt = toIsoString(value.startedAt);
  if (!startedAt) return null;

  return {
    id:
      typeof value.id === "string" && value.id.trim().length > 0
        ? value.id
        : `sickness-${startedAt}`,
    startedAt,
  };
}

function normalizeClosedPeriod(value: unknown): ClosedSicknessPeriod | null {
  if (!isRecord(value)) return null;

  const startedAt = toIsoString(value.startedAt);
  const endedAt = toIsoString(value.endedAt);

  if (!startedAt || !endedAt) return null;

  const id =
    typeof value.id === "string" && value.id.trim().length > 0
      ? value.id
      : `sickness-${startedAt}`;

  return buildClosedPeriod(id, startedAt, endedAt);
}

function normalizeLog(value: unknown): SicknessLog {
  if (!isRecord(value)) return EMPTY_LOG;

  const activePeriod = normalizeActivePeriod(value.activePeriod);
  const history = Array.isArray(value.history)
    ? value.history
        .map((entry) => normalizeClosedPeriod(entry))
        .filter((entry): entry is ClosedSicknessPeriod => entry !== null)
        .sort((a, b) => b.endedAt.localeCompare(a.endedAt))
    : [];

  return {
    activePeriod,
    history,
    updatedAt: toIsoString(value.updatedAt) ?? activePeriod?.startedAt ?? history[0]?.endedAt ?? null,
  };
}

function save(log: SicknessLog): void {
  lsSet(SICKNESS_KEY, log);
}

export function getSicknessLog(): SicknessLog {
  return normalizeLog(lsGet<SicknessLog | null>(SICKNESS_KEY, null));
}

export function startSicknessPeriod(at: Date = new Date()): ActiveSicknessPeriod {
  const log = getSicknessLog();
  if (log.activePeriod) return log.activePeriod;

  const activePeriod: ActiveSicknessPeriod = {
    id: uid(),
    startedAt: at.toISOString(),
  };

  save({
    ...log,
    activePeriod,
    updatedAt: activePeriod.startedAt,
  });

  return activePeriod;
}

export function stopSicknessPeriod(at: Date = new Date()): ClosedSicknessPeriod | null {
  const log = getSicknessLog();
  const activePeriod = log.activePeriod;

  if (!activePeriod) return null;

  const closedPeriod = buildClosedPeriod(activePeriod.id, activePeriod.startedAt, at.toISOString());

  save({
    activePeriod: null,
    history: [closedPeriod, ...log.history],
    updatedAt: closedPeriod.endedAt,
  });

  return closedPeriod;
}

export function formatSicknessStartedAt(value: string): string {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}