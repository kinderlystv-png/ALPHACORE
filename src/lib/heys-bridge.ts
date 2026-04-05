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
  trainings: HeysTrainingRecord[];
  trainingTypes: string[];
  trainingTimes: string[];
  householdMin: number;
  householdTime: string | null;
  householdActivities: HeysHouseholdActivity[];
  mealCount: number;
  mealTimes: string[];
  mealCheckins: HeysMealCheckin[];
};

export type HeysTrainingRecord = {
  id: string;
  time: string | null;
  type: string | null;
  durationMin: number;
  zones: [number, number, number, number];
  mood: number | null;
  wellbeing: number | null;
  stress: number | null;
  comment: string | null;
};

export type HeysHouseholdActivity = {
  id: string;
  time: string | null;
  minutes: number;
};

export type HeysIntradayMetricKey = "mood" | "stress" | "wellbeing";

export type HeysMealCheckin = {
  id: string;
  name: string;
  time: string | null;
  mood: number | null;
  stress: number | null;
  wellbeing: number | null;
};

export type HeysIntradayMetricShift = {
  metricKey: HeysIntradayMetricKey;
  label: string;
  baseline: number | null;
  latest: number | null;
  delta: number | null;
  tone: "good" | "warn" | "bad" | "neutral";
};

export type HeysIntradaySignal = {
  status: "good" | "watch" | "critical" | "neutral";
  momentum: "improving" | "worsening" | "mixed" | "flat" | "unknown";
  focusMetricKey: HeysIntradayMetricKey | null;
  summary: string;
  detail: string;
  reasons: string[];
  lastCheckInAt: string | null;
  lastEventLabel: string | null;
  mealCountToday: number;
  mealCheckInCountToday: number;
  trainingCountToday: number;
  mealTimesToday: string[];
  trainingTimesToday: string[];
  shifts: {
    mood: HeysIntradayMetricShift;
    stress: HeysIntradayMetricShift;
    wellbeing: HeysIntradayMetricShift;
  };
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

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeTime(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeZones(value: unknown): [number, number, number, number] {
  const source = Array.isArray(value) ? value : [];
  return [0, 1, 2, 3].map((index) => {
    const parsed = toNumber(source[index]);
    return parsed != null && parsed > 0 ? Math.round(parsed) : 0;
  }) as [number, number, number, number];
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value != null;
}

function defaultTrainingDuration(type: string | null): number {
  switch ((type ?? "").trim().toLowerCase()) {
    case "strength":
      return 60;
    case "hobby":
      return 30;
    case "cardio":
    default:
      return 45;
  }
}

function getTrainingDurationMinutes(training: Record<string, unknown>): number {
  const zones = normalizeZones(training.z);
  const fromZones = zones.reduce((sum, value) => sum + value, 0);
  if (fromZones > 0) return fromZones;

  const fromDuration = toNumber(training.duration);
  if (fromDuration != null && fromDuration > 0) {
    return Math.round(fromDuration);
  }

  return defaultTrainingDuration(typeof training.type === "string" ? training.type : null);
}

function compareTimes(left: string | null, right: string | null): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left.localeCompare(right);
}

function russianPlural(count: number, forms: [string, string, string]): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return forms[1];
  return forms[2];
}

function getIntradayMetricLabel(metricKey: HeysIntradayMetricKey): string {
  switch (metricKey) {
    case "mood":
      return "Настроение";
    case "stress":
      return "Стресс";
    case "wellbeing":
      return "Самочувствие";
  }
}

function formatSigned(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${round1(value).toFixed(1)}`;
}

function formatMetricValue(value: number | null | undefined): string {
  if (value == null) return "—";
  return round1(value).toFixed(1);
}

function formatEventContext(mealCount: number, trainingCount: number): string | null {
  const parts: string[] = [];

  if (mealCount > 0) {
    parts.push(`${mealCount} ${russianPlural(mealCount, ["приём пищи", "приёма пищи", "приёмов пищи"])}`);
  }

  if (trainingCount > 0) {
    parts.push(`${trainingCount} ${russianPlural(trainingCount, ["тренировка", "тренировки", "тренировок"])}`);
  }

  if (parts.length === 0) return null;
  return `после ${parts.join(" и ")} сегодня`;
}

function buildIntradayMetricShift(
  metricKey: HeysIntradayMetricKey,
  baseline: number | null,
  latest: number | null,
): HeysIntradayMetricShift {
  const delta = baseline != null && latest != null ? round1(latest - baseline) : null;
  const adverseDelta =
    delta == null
      ? null
      : metricKey === "stress"
        ? delta
        : -delta;
  const beneficialDelta = adverseDelta == null ? null : -adverseDelta;

  let tone: HeysIntradayMetricShift["tone"] = "neutral";
  if (adverseDelta != null && adverseDelta >= 1.2) tone = "bad";
  else if (adverseDelta != null && adverseDelta >= 0.6) tone = "warn";
  else if (beneficialDelta != null && beneficialDelta >= 0.6) tone = "good";

  return {
    metricKey,
    label: getIntradayMetricLabel(metricKey),
    baseline,
    latest,
    delta,
    tone,
  };
}

function getLatestCheckinMetric(
  checkins: HeysMealCheckin[],
  metricKey: HeysIntradayMetricKey,
): { value: number; time: string | null } | null {
  const sorted = [...checkins].sort((a, b) => compareTimes(a.time, b.time));

  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const current = sorted[index]!;
    const value = current[metricKey];
    if (value != null) {
      return { value, time: current.time };
    }
  }

  return null;
}

function getAdverseDelta(shift: HeysIntradayMetricShift): number | null {
  if (shift.delta == null) return null;
  return shift.metricKey === "stress" ? shift.delta : -shift.delta;
}

function getBeneficialDelta(shift: HeysIntradayMetricShift): number | null {
  const adverse = getAdverseDelta(shift);
  return adverse == null ? null : -adverse;
}

function formatShiftReason(shift: HeysIntradayMetricShift): string | null {
  if (shift.delta == null || Math.abs(shift.delta) < 0.4) return null;
  return `${shift.label.toLowerCase()} ${formatSigned(shift.delta)}`;
}

function formatIntradayState(
  label: string,
  baseline: number | null,
  latest: number | null,
): string {
  return `${label} ${formatMetricValue(baseline)} → ${formatMetricValue(latest)}`;
}

function buildIntradaySignal(days: HeysDayRecord[]): HeysIntradaySignal | null {
  const today = days.find((day) => day.date === dateStr(0)) ?? days[days.length - 1] ?? null;
  if (!today) return null;

  const latestMood = getLatestCheckinMetric(today.mealCheckins, "mood")?.value ?? today.moodAvg ?? today.moodMorning;
  const latestStress = getLatestCheckinMetric(today.mealCheckins, "stress")?.value ?? today.stressAvg ?? today.stressMorning;
  const latestWellbeing = getLatestCheckinMetric(today.mealCheckins, "wellbeing")?.value ?? today.wellbeingAvg ?? today.wellbeingMorning;

  const shifts = {
    mood: buildIntradayMetricShift("mood", today.moodMorning, latestMood),
    stress: buildIntradayMetricShift("stress", today.stressMorning, latestStress),
    wellbeing: buildIntradayMetricShift("wellbeing", today.wellbeingMorning, latestWellbeing),
  } satisfies HeysIntradaySignal["shifts"];

  const shiftList = Object.values(shifts);
  const adverse = shiftList
    .map((shift) => ({ shift, score: getAdverseDelta(shift) ?? Number.NEGATIVE_INFINITY }))
    .filter((entry) => entry.score >= 0.6)
    .sort((left, right) => right.score - left.score);
  const positive = shiftList
    .map((shift) => ({ shift, score: getBeneficialDelta(shift) ?? Number.NEGATIVE_INFINITY }))
    .filter((entry) => entry.score >= 0.6)
    .sort((left, right) => right.score - left.score);

  const latestCheckinAt = [
    getLatestCheckinMetric(today.mealCheckins, "mood")?.time ?? null,
    getLatestCheckinMetric(today.mealCheckins, "stress")?.time ?? null,
    getLatestCheckinMetric(today.mealCheckins, "wellbeing")?.time ?? null,
  ]
    .filter((value): value is string => value != null)
    .sort(compareTimes)
    .at(-1) ?? null;
  const lastTrainingAt = [...today.trainingTimes].sort(compareTimes).at(-1) ?? null;
  const lastEventLabel =
    compareTimes(lastTrainingAt, latestCheckinAt) < 0
      ? latestCheckinAt
        ? `последний meal-check-in ${latestCheckinAt}`
        : null
      : lastTrainingAt
        ? `последняя тренировка ${lastTrainingAt}`
        : latestCheckinAt
          ? `последний meal-check-in ${latestCheckinAt}`
          : null;
  const eventContext = formatEventContext(today.mealCount, today.trainingCount);
  const baseReasons = uniqueReasons(
    [
      ...adverse.slice(0, 2).map((entry) => formatShiftReason(entry.shift)),
      ...positive.slice(0, 2).map((entry) => formatShiftReason(entry.shift)),
      eventContext ? eventContext.replace(/^после\s+/, "") : null,
    ].filter((value): value is string => Boolean(value)),
  );

  const hasAnyBaselineOrLatest = shiftList.some(
    (shift) => shift.baseline != null || shift.latest != null,
  );

  if (!hasAnyBaselineOrLatest) {
    return {
      status: "neutral",
      momentum: "unknown",
      focusMetricKey: null,
      summary: eventContext
        ? `Внутри дня уже есть ${eventContext.replace(/^после\s+/, "")}, но свежего сигнала по состоянию пока мало.`
        : "Внутри дня пока мало свежих check-in по состоянию.",
      detail: lastEventLabel
        ? `${lastEventLabel}; как только в HEYS появится новый сигнал по настроению / стрессу / самочувствию, ALPHACORE начнёт перестраивать день быстрее.`
        : "Как только в HEYS появится новый сигнал по настроению / стрессу / самочувствию, ALPHACORE начнёт перестраивать день быстрее.",
      reasons: uniqueReasons([eventContext, lastEventLabel]),
      lastCheckInAt: latestCheckinAt,
      lastEventLabel,
      mealCountToday: today.mealCount,
      mealCheckInCountToday: today.mealCheckins.filter(
        (meal) => meal.mood != null || meal.stress != null || meal.wellbeing != null,
      ).length,
      trainingCountToday: today.trainingCount,
      mealTimesToday: today.mealTimes,
      trainingTimesToday: today.trainingTimes,
      shifts,
    };
  }

  const hasAdverse = adverse.length > 0;
  const hasPositive = positive.length > 0;
  const strongestAdverse = adverse[0] ?? null;
  const strongestPositive = positive[0] ?? null;

  let status: HeysIntradaySignal["status"] = "neutral";
  let momentum: HeysIntradaySignal["momentum"] = "flat";
  let summary = "Внутри дня резкого drift нет: фон близок к утренней базе.";

  if (hasAdverse && hasPositive) {
    momentum = "mixed";
    status = strongestAdverse != null && strongestAdverse.score >= 1.2 ? "critical" : "watch";
    summary = `Внутри дня сигнал mixed: ${positive
      .slice(0, 1)
      .map((entry) => formatShiftReason(entry.shift))
      .join(", ")}, но ${adverse
      .slice(0, 2)
      .map((entry) => formatShiftReason(entry.shift))
      .join(", ")}${eventContext ? ` ${eventContext}` : ""}.`;
  } else if (hasAdverse) {
    momentum = "worsening";
    const totalAdverse = adverse.reduce((sum, entry) => sum + entry.score, 0);
    status = strongestAdverse != null && (strongestAdverse.score >= 1.2 || totalAdverse >= 1.8)
      ? "critical"
      : "watch";
    summary = `Внутри дня фон поехал: ${adverse
      .slice(0, 2)
      .map((entry) => formatShiftReason(entry.shift))
      .join(", ")}${eventContext ? ` ${eventContext}` : ""}.`;
  } else if (hasPositive) {
    momentum = "improving";
    status = "good";
    summary = `Внутри дня фон выровнялся: ${positive
      .slice(0, 2)
      .map((entry) => formatShiftReason(entry.shift))
      .join(", ")}${eventContext ? ` ${eventContext}` : ""}.`;
  }

  const focusMetricKey = hasAdverse
    ? strongestAdverse?.shift.metricKey ?? null
    : strongestPositive?.shift.metricKey ?? null;
  const detail = [
    lastEventLabel,
    [
      formatIntradayState("настроение", today.moodMorning, latestMood),
      formatIntradayState("стресс", today.stressMorning, latestStress),
      formatIntradayState("самочувствие", today.wellbeingMorning, latestWellbeing),
    ].join(" · "),
  ]
    .filter(Boolean)
    .join(". ");

  return {
    status,
    momentum,
    focusMetricKey,
    summary,
    detail,
    reasons: baseReasons.slice(0, 3),
    lastCheckInAt: latestCheckinAt,
    lastEventLabel,
    mealCountToday: today.mealCount,
    mealCheckInCountToday: today.mealCheckins.filter(
      (meal) => meal.mood != null || meal.stress != null || meal.wellbeing != null,
    ).length,
    trainingCountToday: today.trainingCount,
    mealTimesToday: today.mealTimes,
    trainingTimesToday: today.trainingTimes,
    shifts,
  };
}

function uniqueReasons(reasons: Array<string | null | undefined>): string[] {
  return [...new Set(reasons.map((reason) => reason?.trim()).filter(Boolean) as string[])];
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

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;

  const rows = (await response.json()) as Array<{ v: unknown }>;
  if (!rows.length) return null;

  const raw = rows[0]!.v;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function fetchDayRecord(date: string): Promise<HeysDayRecord | null> {
  const raw = (await fetchKV(`heys_dayv2_${date}`)) as Record<string, unknown> | null;
  if (!raw) return null;

  const trainings = Array.isArray(raw.trainings) ? raw.trainings : [];
  const meals = Array.isArray(raw.meals) ? raw.meals : [];
  const parsedTrainings = trainings
    .map((training, index) => {
      const trainingRecord = training as Record<string, unknown>;
      const time = normalizeTime(trainingRecord.time);
      const durationMin = getTrainingDurationMinutes(trainingRecord);
      const zones = normalizeZones(trainingRecord.z);

      if (time == null || durationMin <= 0) {
        return null;
      }

      return {
        id: String(trainingRecord.id ?? `training-${date}-${index}`),
        time,
        type: typeof trainingRecord.type === "string" && trainingRecord.type.trim() !== ""
          ? trainingRecord.type
          : null,
        durationMin,
        zones,
        mood: toNumber(trainingRecord.mood),
        wellbeing: toNumber(trainingRecord.wellbeing),
        stress: toNumber(trainingRecord.stress),
        comment: typeof trainingRecord.comment === "string" && trainingRecord.comment.trim() !== ""
          ? trainingRecord.comment
          : null,
      };
    })
    .filter(isPresent)
    .sort((left, right) => compareTimes(left.time, right.time));
  const trainingTimes = parsedTrainings
    .map((training) => training.time)
    .filter((value): value is string => value != null)
    .sort(compareTimes);
  const householdActivitiesRaw = Array.isArray(raw.householdActivities)
    ? raw.householdActivities
    : [];
  const parsedHouseholdActivities = householdActivitiesRaw
    .map((activity, index) => {
      const activityRecord = activity as Record<string, unknown>;
      const minutes = toNumber(activityRecord.minutes);
      const time = normalizeTime(activityRecord.time);

      if (minutes == null || minutes <= 0) {
        return null;
      }

      return {
        id: String(activityRecord.id ?? `household-${date}-${index}`),
        time,
        minutes: Math.round(minutes),
      };
    })
    .filter(isPresent)
    .sort((left, right) => compareTimes(left.time, right.time));
  const householdTime = normalizeTime(raw.householdTime);
  const householdMin = toNumber(raw.householdMin);
  const householdActivities = parsedHouseholdActivities.length > 0
    ? parsedHouseholdActivities
    : householdMin != null && householdMin > 0
      ? [
          {
            id: `household-${date}-legacy`,
            time: householdTime,
            minutes: Math.round(householdMin),
          } satisfies HeysHouseholdActivity,
        ]
      : [];
  const mealTimes = meals
    .map((meal) => normalizeTime((meal as Record<string, unknown>).time))
    .filter((value): value is string => value != null)
    .sort(compareTimes);
  const mealCheckins = meals
    .map((meal, index) => {
      const mealRecord = meal as Record<string, unknown>;
      const time = normalizeTime(mealRecord.time);
      const mood = toNumber(mealRecord.mood);
      const stress = toNumber(mealRecord.stress);
      const wellbeing = toNumber(mealRecord.wellbeing);

      if (time == null && mood == null && stress == null && wellbeing == null) {
        return null;
      }

      return {
        id: String(mealRecord.id ?? `meal-${date}-${index}`),
        name: typeof mealRecord.name === "string" && mealRecord.name.trim() !== ""
          ? mealRecord.name
          : `meal-${index + 1}`,
        time,
        mood,
        stress,
        wellbeing,
      } satisfies HeysMealCheckin;
    })
    .filter((value): value is HeysMealCheckin => value != null)
    .sort((left, right) => compareTimes(left.time, right.time));

  return {
    date,
    sleepStart: (raw.sleepStart as string) ?? null,
    sleepEnd: (raw.sleepEnd as string) ?? null,
    sleepHours: toNumber(raw.sleepHours),
    sleepQuality: toNumber(raw.sleepQuality),
    moodAvg: toNumber(raw.moodAvg),
    moodMorning: toNumber(raw.moodMorning),
    stressAvg: toNumber(raw.stressAvg),
    stressMorning: toNumber(raw.stressMorning),
    wellbeingAvg: toNumber(raw.wellbeingAvg),
    wellbeingMorning: toNumber(raw.wellbeingMorning),
    weightMorning: toNumber(raw.weightMorning),
    steps: toNumber(raw.steps),
    dayScore: toNumber(raw.dayScore),
    dayComment: (raw.dayComment as string) ?? null,
    waterMl: toNumber(raw.waterMl),
    deficitPct: toNumber(raw.deficitPct),
    trainingCount: parsedTrainings.length,
    trainings: parsedTrainings,
    trainingTypes: parsedTrainings.map((training) => training.type ?? "unknown"),
    trainingTimes,
    householdMin: householdMin != null && householdMin > 0
      ? Math.round(householdMin)
      : householdActivities.reduce((sum, activity) => sum + activity.minutes, 0),
    householdTime,
    householdActivities,
    mealCount: meals.length,
    mealTimes,
    mealCheckins,
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
  intraday: HeysIntradaySignal | null;
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
    intraday: buildIntradaySignal(snapshot.days),
    hasRecentData: week.daysWithData >= 3,
  };
}
