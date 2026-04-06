import { lsGet, lsSet, uid } from "./storage";

export type SicknessSeverity = 1 | 2 | 3 | 4 | 5;

export type ActiveSicknessPeriod = {
  id: string;
  startedAt: string;
  severity: SicknessSeverity;
};

export type ClosedSicknessPeriod = {
  id: string;
  startedAt: string;
  endedAt: string;
  severity: SicknessSeverity;
  severityLabel: string;
  durationMs: number;
  durationDays: number;
  durationLabel: string;
  calendarDays: number;
  summary: string;
};

export type ActiveSicknessSummary = {
  startedAt: string;
  severity: SicknessSeverity;
  severityLabel: string;
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
export const DEFAULT_SICKNESS_SEVERITY: SicknessSeverity = 3;
export const SICKNESS_SEVERITY_SCALE: SicknessSeverity[] = [1, 2, 3, 4, 5];

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const SICKNESS_SEVERITY_LABELS: Record<SicknessSeverity, string> = {
  1: "слегка",
  2: "умеренно",
  3: "заметно",
  4: "тяжело",
  5: "очень тяжело",
};

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

function normalizeSicknessSeverity(
  value: unknown,
  fallback: SicknessSeverity = DEFAULT_SICKNESS_SEVERITY,
): SicknessSeverity {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5
    ? (value as SicknessSeverity)
    : fallback;
}

export function getSicknessSeverityLabel(severity: SicknessSeverity): string {
  return SICKNESS_SEVERITY_LABELS[severity];
}

export function formatSicknessSeverity(severity: SicknessSeverity): string {
  return `${severity}/5 · ${getSicknessSeverityLabel(severity)}`;
}

function buildClosedPeriod(
  id: string,
  startedAt: string,
  endedAt: string,
  severity: SicknessSeverity = DEFAULT_SICKNESS_SEVERITY,
): ClosedSicknessPeriod {
  const start = new Date(startedAt);
  const rawEnd = new Date(endedAt);
  const end = rawEnd.getTime() >= start.getTime() ? rawEnd : start;
  const durationMs = Math.max(0, end.getTime() - start.getTime());
  const durationDays = round(durationMs / DAY_MS, 2);
  const durationLabel = formatDurationLabel(durationMs);
  const calendarDays = countCalendarDays(start, end);
  const normalizedSeverity = normalizeSicknessSeverity(severity);
  const severityLabel = getSicknessSeverityLabel(normalizedSeverity);
  const summary = `${durationLabel} • ${formatShortDateTime(start)} → ${formatShortDateTime(end)} • ${calendarDays} календ. дн. • ${formatSicknessSeverity(normalizedSeverity)}`;

  return {
    id,
    startedAt: start.toISOString(),
    endedAt: end.toISOString(),
    severity: normalizedSeverity,
    severityLabel,
    durationMs,
    durationDays,
    durationLabel,
    calendarDays,
    summary,
  };
}

function buildActiveSummary(
  startedAt: string,
  severity: SicknessSeverity = DEFAULT_SICKNESS_SEVERITY,
  at: Date = new Date(),
): ActiveSicknessSummary {
  const start = new Date(startedAt);
  const rawEnd = at;
  const end = rawEnd.getTime() >= start.getTime() ? rawEnd : start;
  const durationMs = Math.max(0, end.getTime() - start.getTime());
  const durationDays = round(durationMs / DAY_MS, 2);
  const durationLabel = formatDurationLabel(durationMs);
  const calendarDays = countCalendarDays(start, end);
  const normalizedSeverity = normalizeSicknessSeverity(severity);
  const severityLabel = getSicknessSeverityLabel(normalizedSeverity);

  return {
    startedAt: start.toISOString(),
    severity: normalizedSeverity,
    severityLabel,
    durationMs,
    durationDays,
    durationLabel,
    calendarDays,
    summary: `${durationLabel} · с ${formatShortDateTime(start)} · ${calendarDays} календ. дн. · ${formatSicknessSeverity(normalizedSeverity)}`,
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
    severity: normalizeSicknessSeverity(value.severity),
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

  return buildClosedPeriod(id, startedAt, endedAt, normalizeSicknessSeverity(value.severity));
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
    updatedAt:
      toIsoString(value.updatedAt) ?? activePeriod?.startedAt ?? history[0]?.endedAt ?? null,
  };
}

function save(log: SicknessLog): void {
  lsSet(SICKNESS_KEY, log);
}

export function getSicknessLog(): SicknessLog {
  return normalizeLog(lsGet<SicknessLog | null>(SICKNESS_KEY, null));
}

export function startSicknessPeriod(
  at: Date = new Date(),
  severity: SicknessSeverity = DEFAULT_SICKNESS_SEVERITY,
): ActiveSicknessPeriod {
  const log = getSicknessLog();
  if (log.activePeriod) return log.activePeriod;

  const activePeriod: ActiveSicknessPeriod = {
    id: uid(),
    startedAt: at.toISOString(),
    severity: normalizeSicknessSeverity(severity),
  };

  save({
    ...log,
    activePeriod,
    updatedAt: new Date().toISOString(),
  });

  return activePeriod;
}

export function stopSicknessPeriod(at: Date = new Date()): ClosedSicknessPeriod | null {
  const log = getSicknessLog();
  const activePeriod = log.activePeriod;

  if (!activePeriod) return null;

  const closedPeriod = buildClosedPeriod(
    activePeriod.id,
    activePeriod.startedAt,
    at.toISOString(),
    activePeriod.severity,
  );

  save({
    activePeriod: null,
    history: [closedPeriod, ...log.history],
    updatedAt: new Date().toISOString(),
  });

  return closedPeriod;
}

export function updateActiveSicknessPeriod(patch: {
  startedAt?: string;
  severity?: SicknessSeverity | null;
}): ActiveSicknessPeriod | null {
  const log = getSicknessLog();
  if (!log.activePeriod) return null;

  const nextStartedAt = toIsoString(patch.startedAt) ?? log.activePeriod.startedAt;
  const nextSeverity = Object.prototype.hasOwnProperty.call(patch, "severity")
    ? normalizeSicknessSeverity(patch.severity, log.activePeriod.severity)
    : log.activePeriod.severity;
  const activePeriod: ActiveSicknessPeriod = {
    ...log.activePeriod,
    startedAt: nextStartedAt,
    severity: nextSeverity,
  };

  save({
    ...log,
    activePeriod,
    updatedAt: new Date().toISOString(),
  });

  return activePeriod;
}

export function updateClosedSicknessPeriod(
  periodId: string,
  patch: {
    startedAt?: string;
    endedAt?: string;
    severity?: SicknessSeverity | null;
  },
): ClosedSicknessPeriod | null {
  const log = getSicknessLog();
  const current = log.history.find((period) => period.id === periodId) ?? null;

  if (!current) return null;

  const nextStartedAt = toIsoString(patch.startedAt) ?? current.startedAt;
  const nextEndedAt = toIsoString(patch.endedAt) ?? current.endedAt;
  const nextSeverity = Object.prototype.hasOwnProperty.call(patch, "severity")
    ? normalizeSicknessSeverity(patch.severity, current.severity)
    : current.severity;
  const updated = buildClosedPeriod(periodId, nextStartedAt, nextEndedAt, nextSeverity);

  save({
    ...log,
    history: log.history
      .map((period) => (period.id === periodId ? updated : period))
      .sort((left, right) => right.endedAt.localeCompare(left.endedAt)),
    updatedAt: new Date().toISOString(),
  });

  return updated;
}

export function getLatestClosedSicknessPeriod(
  log: SicknessLog = getSicknessLog(),
): ClosedSicknessPeriod | null {
  return log.history[0] ?? null;
}

export function getActiveSicknessSummary(
  value: SicknessLog | ActiveSicknessPeriod | null,
  at: Date = new Date(),
): ActiveSicknessSummary | null {
  if (!value) return null;

  const startedAt = "activePeriod" in value ? value.activePeriod?.startedAt : value.startedAt;
  const severity = "activePeriod" in value
    ? value.activePeriod?.severity ?? DEFAULT_SICKNESS_SEVERITY
    : value.severity ?? DEFAULT_SICKNESS_SEVERITY;

  if (!startedAt) return null;

  return buildActiveSummary(startedAt, severity, at);
}

export function formatSicknessDateTime(value: string): string {
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

export function formatSicknessStartedAt(value: string): string {
  return formatSicknessDateTime(value);
}