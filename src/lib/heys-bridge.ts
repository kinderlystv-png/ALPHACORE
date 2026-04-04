/* ── HEYS → ALPHACORE read-only bridge (server-side) ── */

const HEYS_REST_BASE = "https://api.heyslab.ru/rest/client_kv_store";
const HEYS_CLIENT_ID = "ccfe6ea3-54d9-4c83-902b-f10e6e8e6d9a";
const HEYS_ORIGIN = "https://app.heyslab.ru";

/* ── Types ── */

export type HeysDayRecord = {
  date: string;
  sleepStart: string | null;
  sleepEnd: string | null;
  sleepHours: number | null;
  sleepQuality: number | null;
  moodAvg: number | null;
  moodMorning: number | null;
  stressAvg: number | null;
  stressMorning: number | null;
  wellbeingAvg: number | null;
  wellbeingMorning: number | null;
  weightMorning: number | null;
  steps: number | null;
  dayScore: number | null;
  dayComment: string | null;
  waterMl: number | null;
  deficitPct: number | null;
  trainingCount: number;
  trainingTypes: string[];
  mealCount: number;
};

export type HeysProfile = {
  firstName: string;
  lastName: string;
  age: number;
  height: number;
  weight: number;
  weightGoal: number;
  stepsGoal: number;
  sleepHoursGoal: number;
  deficitPctTarget: number;
};

export type HeysSyncSnapshot = {
  syncedAt: string;
  profile: HeysProfile | null;
  days: HeysDayRecord[];

  /* ── Computed aggregates (last 7 days) ── */
  week: HeysWeekAggregate;
  /* ── Computed aggregates (last 30 days) ── */
  month: HeysMonthAggregate;
};

export type HeysWeekAggregate = {
  avgSleepHours: number | null;
  avgSleepQuality: number | null;
  avgMood: number | null;
  avgStress: number | null;
  avgWellbeing: number | null;
  avgSteps: number | null;
  avgWater: number | null;
  latestWeight: number | null;
  trainingDays: number;
  lateBedtimeDays: number;
  daysWithData: number;
};

export type HeysMonthAggregate = HeysWeekAggregate & {
  weightChange: number | null;
  weightStart: number | null;
  weightEnd: number | null;
  stepsGoalReachedDays: number;
  stepsGoal: number | null;
};

/* ── Helpers ── */

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

function isLateBedtime(sleepStart: string | null): boolean {
  if (!sleepStart) return false;
  const hour = parseInt(sleepStart.split(":")[0] ?? "0", 10);
  return hour >= 1 && hour < 6;
}

/* ── HEYS REST Fetcher ── */

async function fetchKV(key: string): Promise<unknown | null> {
  const url = `${HEYS_REST_BASE}?client_id=eq.${HEYS_CLIENT_ID}&k=eq.${encodeURIComponent(key)}&select=v`;
  const response = await fetch(url, {
    headers: { Origin: HEYS_ORIGIN },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) return null;

  const rows = (await response.json()) as Array<{ v: unknown }>;
  if (!rows.length) return null;

  const raw = rows[0]!.v;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function fetchDayRecord(date: string): Promise<HeysDayRecord | null> {
  const raw = (await fetchKV(`heys_dayv2_${date}`)) as Record<string, unknown> | null;
  if (!raw) return null;

  const trainings = Array.isArray(raw.trainings) ? raw.trainings : [];
  const realTrainings = trainings.filter(
    (t: Record<string, unknown>) =>
      t.time && Array.isArray(t.z) && (t.z as number[]).some((z: number) => z > 0),
  );

  return {
    date,
    sleepStart: (raw.sleepStart as string) ?? null,
    sleepEnd: (raw.sleepEnd as string) ?? null,
    sleepHours: (raw.sleepHours as number) ?? null,
    sleepQuality: (raw.sleepQuality as number) ?? null,
    moodAvg: (raw.moodAvg as number) ?? null,
    moodMorning: (raw.moodMorning as number) ?? null,
    stressAvg: (raw.stressAvg as number) ?? null,
    stressMorning: (raw.stressMorning as number) ?? null,
    wellbeingAvg: (raw.wellbeingAvg as number) ?? null,
    wellbeingMorning: (raw.wellbeingMorning as number) ?? null,
    weightMorning: (raw.weightMorning as number) ?? null,
    steps: (raw.steps as number) ?? null,
    dayScore: (raw.dayScore as number) ?? null,
    dayComment: (raw.dayComment as string) ?? null,
    waterMl: (raw.waterMl as number) ?? null,
    deficitPct: (raw.deficitPct as number) ?? null,
    trainingCount: realTrainings.length,
    trainingTypes: realTrainings.map(
      (t: Record<string, unknown>) => (t.type as string) ?? "unknown",
    ),
    mealCount: Array.isArray(raw.meals) ? raw.meals.length : 0,
  };
}

async function fetchProfile(): Promise<HeysProfile | null> {
  const raw = (await fetchKV("heys_profile")) as Record<string, unknown> | null;
  if (!raw) return null;

  return {
    firstName: (raw.firstName as string) ?? "",
    lastName: (raw.lastName as string) ?? "",
    age: (raw.age as number) ?? 0,
    height: (raw.height as number) ?? 0,
    weight: (raw.weight as number) ?? 0,
    weightGoal: (raw.weightGoal as number) ?? 0,
    stepsGoal: (raw.stepsGoal as number) ?? 7000,
    sleepHoursGoal: (raw.sleepHours as number) ?? 8,
    deficitPctTarget: (raw.deficitPctTarget as number) ?? 0,
  };
}

/* ── Aggregate builders ── */

function buildWeekAggregate(days: HeysDayRecord[]): HeysWeekAggregate {
  const sleepHours = days.map((d) => d.sleepHours).filter((v): v is number => v != null);
  const sleepQuality = days.map((d) => d.sleepQuality).filter((v): v is number => v != null);
  const moods = days.map((d) => d.moodAvg ?? d.moodMorning).filter((v): v is number => v != null);
  const stress = days.map((d) => d.stressAvg ?? d.stressMorning).filter((v): v is number => v != null);
  const wellbeing = days.map((d) => d.wellbeingAvg ?? d.wellbeingMorning).filter((v): v is number => v != null);
  const steps = days.map((d) => d.steps).filter((v): v is number => v != null);
  const water = days.map((d) => d.waterMl).filter((v): v is number => v != null);
  const weights = days.filter((d) => d.weightMorning != null);

  return {
    avgSleepHours: avg(sleepHours),
    avgSleepQuality: avg(sleepQuality),
    avgMood: avg(moods),
    avgStress: avg(stress),
    avgWellbeing: avg(wellbeing),
    avgSteps: avg(steps),
    avgWater: avg(water),
    latestWeight: weights.length > 0 ? weights[weights.length - 1]!.weightMorning : null,
    trainingDays: days.filter((d) => d.trainingCount > 0).length,
    lateBedtimeDays: days.filter((d) => isLateBedtime(d.sleepStart)).length,
    daysWithData: days.length,
  };
}

function buildMonthAggregate(days: HeysDayRecord[], stepsGoal: number | null): HeysMonthAggregate {
  const week = buildWeekAggregate(days);
  const weights = days.filter((d) => d.weightMorning != null);
  const steps = days.filter((d) => d.steps != null);

  return {
    ...week,
    weightChange:
      weights.length >= 2
        ? Math.round((weights[weights.length - 1]!.weightMorning! - weights[0]!.weightMorning!) * 10) / 10
        : null,
    weightStart: weights.length > 0 ? weights[0]!.weightMorning : null,
    weightEnd: weights.length > 0 ? weights[weights.length - 1]!.weightMorning : null,
    stepsGoalReachedDays: stepsGoal
      ? steps.filter((d) => d.steps! >= stepsGoal).length
      : 0,
    stepsGoal,
  };
}

/* ── Main: fetch & synthesize ── */

function dateStr(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

export async function syncFromHeys(): Promise<HeysSyncSnapshot> {
  // Fetch profile
  const profile = await fetchProfile();

  // Fetch last 30 days in parallel (batches of 10 to not hammer the API)
  const dates: string[] = [];
  for (let i = 0; i < 30; i++) {
    dates.push(dateStr(-i));
  }

  const days: HeysDayRecord[] = [];

  for (let batch = 0; batch < 3; batch++) {
    const batchDates = dates.slice(batch * 10, (batch + 1) * 10);
    const results = await Promise.all(batchDates.map((d) => fetchDayRecord(d)));
    for (const result of results) {
      if (result) days.push(result);
    }
  }

  // Sort chronologically
  days.sort((a, b) => a.date.localeCompare(b.date));

  // Build aggregates
  const last7 = days.filter((d) => {
    const diff = Math.round(
      (Date.now() - new Date(d.date).getTime()) / 86_400_000,
    );
    return diff <= 7;
  });

  return {
    syncedAt: new Date().toISOString(),
    profile,
    days,
    week: buildWeekAggregate(last7),
    month: buildMonthAggregate(days, profile?.stepsGoal ?? null),
  };
}

/* ── Quick accessors for agent-control ── */

export type HeysHealthSignals = {
  sleepHoursAvg: number | null;
  sleepQualityAvg: number | null;
  lateBedtimeRatio: number | null;
  moodAvg: number | null;
  stressAvg: number | null;
  wellbeingAvg: number | null;
  stepsAvg: number | null;
  stepsGoalRatio: number | null;
  weightCurrent: number | null;
  weightGoal: number | null;
  weightDelta30d: number | null;
  trainingDaysWeek: number;
  waterAvg: number | null;
  hasRecentData: boolean;
};

export function extractHealthSignals(snapshot: HeysSyncSnapshot): HeysHealthSignals {
  const { week, month, profile } = snapshot;

  return {
    sleepHoursAvg: week.avgSleepHours,
    sleepQualityAvg: week.avgSleepQuality,
    lateBedtimeRatio:
      week.daysWithData > 0
        ? Math.round((week.lateBedtimeDays / week.daysWithData) * 100) / 100
        : null,
    moodAvg: week.avgMood,
    stressAvg: week.avgStress,
    wellbeingAvg: week.avgWellbeing,
    stepsAvg: week.avgSteps,
    stepsGoalRatio:
      week.avgSteps != null && profile?.stepsGoal
        ? Math.round((week.avgSteps / profile.stepsGoal) * 100) / 100
        : null,
    weightCurrent: week.latestWeight,
    weightGoal: profile?.weightGoal ?? null,
    weightDelta30d: month.weightChange,
    trainingDaysWeek: week.trainingDays,
    waterAvg: week.avgWater,
    hasRecentData: week.daysWithData >= 3,
  };
}
