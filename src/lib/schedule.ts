import { lsGet, lsSet } from "./storage";
import { addTask, deleteTask, getTasks, updateTask, type TaskPriority } from "./tasks";

export type ScheduleTone =
  | "kinderly"
  | "heys"
  | "work"
  | "health"
  | "personal"
  | "cleanup"
  | "family"
  | "review";

export type ScheduleSource = "template" | "studio" | "derived";
export type EditableScheduleSource = "template" | "studio" | "derived";

export type ScheduleSlot = {
  id: string;
  date: string;
  start: string;
  end: string;
  title: string;
  subtitle?: string;
  tone: ScheduleTone;
  tags: string[];
  source: ScheduleSource;
  kind?: "task" | "event";
  taskId?: string | null;
};

export type ScheduleOverride = {
  originalId: string;
  originalSource: EditableScheduleSource;
  date: string;
  start: string;
  end: string;
  title: string;
  subtitle?: string;
  tone: ScheduleTone;
  tags: string[];
  hidden?: boolean;
};

type StudioEvent = {
  id: string;
  date: string;
  start: string;
  end: string;
  title: string;
  subtitle?: string;
  customer?: string;
};

type CoverageDraft = {
  start: string;
  end: string;
  titles: string[];
  tags: string[];
  isWednesdayEvening: boolean;
};

type TemplateSlot = Omit<ScheduleSlot, "id" | "date" | "source">;

const DAY_MS = 86_400_000;

export const SCHEDULE_TONE_CLS: Record<ScheduleTone, string> = {
  kinderly: "border-sky-500/25 bg-sky-950/20 text-sky-300",
  heys: "border-orange-500/25 bg-orange-950/20 text-orange-300",
  work: "border-zinc-700 bg-zinc-900/40 text-zinc-300",
  health: "border-emerald-500/25 bg-emerald-950/20 text-emerald-300",
  personal: "border-violet-500/25 bg-violet-950/20 text-violet-300",
  cleanup: "border-rose-500/25 bg-rose-950/20 text-rose-300",
  family: "border-fuchsia-500/25 bg-fuchsia-950/20 text-fuchsia-300",
  review: "border-amber-500/25 bg-amber-950/20 text-amber-300",
};

export const SCHEDULE_RULES = [
  "С 1 апреля без уборщицы: если был праздник, на следующий день нужен слот на уборку.",
  "Праздник вечером → уборка на следующий день 11:00–15:00 (сначала пробежка утром). Если утром уже стоит следующий праздник — уборка переносится на 06:00–09:00.",
  "Если в один день стоят утренний и вечерний праздники, между ними нужен support-слот 15:00–17:00: ехать помогать Саше быстро привести пространство в порядок.",
  "Во время праздников нужен семейный буфер: за час до и через час после ты с Даней, пока Саша на админке.",
  "Если в среду есть вечерний праздник, добавляем логистику: отвезти Даню к бабушке перед репетицией.",
  "Мягкие weekly-блоки автоматически скрываются, если конфликтуют с праздником, уборкой или семейным буфером.",
];

const TEMPLATE_BY_WEEKDAY: Record<number, TemplateSlot[]> = {
  0: [
    {
      start: "10:00",
      end: "13:00",
      title: "Семья / восстановление",
      tone: "personal",
      tags: ["family", "recovery"],
    },
    {
      start: "15:00",
      end: "16:30",
      title: "Подготовка к неделе",
      tone: "review",
      tags: ["planning", "weekly"],
    },
  ],
  1: [
    {
      start: "08:00",
      end: "09:00",
      title: "🏃 Бег 60 мин",
      tone: "health",
      tags: ["run", "health"],
    },
    {
      start: "09:30",
      end: "11:00",
      title: "Стратег. задачи Kinderly",
      tone: "kinderly",
      tags: ["kinderly", "strategy"],
    },
    {
      start: "11:30",
      end: "13:00",
      title: "Стратег. задачи HEYS",
      tone: "heys",
      tags: ["heys", "strategy"],
    },
    {
      start: "14:00",
      end: "16:30",
      title: "Deep work / реализация",
      tone: "work",
      tags: ["deep-work"],
    },
  ],
  2: [
    {
      start: "08:00",
      end: "09:00",
      title: "🏃 Бег 60 мин",
      tone: "health",
      tags: ["run", "health"],
    },
    {
      start: "09:30",
      end: "12:00",
      title: "Реализация + коммуникации",
      tone: "work",
      tags: ["execution", "comms"],
    },
    {
      start: "13:00",
      end: "14:30",
      title: "Kinderly: операционные задачи",
      tone: "kinderly",
      tags: ["kinderly", "ops"],
    },
    {
      start: "15:00",
      end: "16:30",
      title: "HEYS: операционные задачи",
      tone: "heys",
      tags: ["heys", "ops"],
    },
  ],
  3: [
    {
      start: "09:00",
      end: "11:30",
      title: "Лёгкие операционные задачи",
      tone: "work",
      tags: ["ops", "light"],
    },
    {
      start: "14:00",
      end: "17:00",
      title: "Лёгкий рабочий блок",
      tone: "work",
      tags: ["work", "light"],
    },
    {
      start: "18:00",
      end: "23:00",
      title: "🥁 Репетиция / барабаны",
      tone: "personal",
      tags: ["drums", "rehearsal"],
    },
  ],
  4: [
    {
      start: "09:00",
      end: "10:30",
      title: "Follow-up задачи",
      tone: "work",
      tags: ["follow-up"],
    },
    {
      start: "11:00",
      end: "12:30",
      title: "Kinderly: хвосты",
      tone: "kinderly",
      tags: ["kinderly", "follow-up"],
    },
    {
      start: "14:00",
      end: "15:30",
      title: "HEYS: хвосты",
      tone: "heys",
      tags: ["heys", "follow-up"],
    },
    {
      start: "16:00",
      end: "16:30",
      title: "🧘 Лёгкая растяжка / восстановление",
      tone: "health",
      tags: ["stretch", "health"],
    },
  ],
  5: [
    {
      start: "08:00",
      end: "09:00",
      title: "🏃 Бег 60 мин",
      tone: "health",
      tags: ["run", "health"],
    },
    {
      start: "09:30",
      end: "12:00",
      title: "Операционные задачи",
      tone: "work",
      tags: ["ops"],
    },
    {
      start: "14:00",
      end: "15:00",
      title: "📋 Weekly review",
      tone: "review",
      tags: ["review"],
    },
    {
      start: "15:30",
      end: "16:30",
      title: "План следующей недели",
      tone: "review",
      tags: ["planning"],
    },
  ],
  6: [
    {
      start: "08:00",
      end: "09:00",
      title: "🏃 Бег 60 мин",
      tone: "health",
      tags: ["run", "health"],
    },
    {
      start: "10:00",
      end: "13:00",
      title: "Семья / активный отдых",
      tone: "personal",
      tags: ["family", "rest"],
    },
  ],
};

const STUDIO_EVENTS: StudioEvent[] = [
  {
    id: "evt-2026-04-02-1700",
    date: "2026-04-02",
    start: "17:00",
    end: "22:00",
    title: "🎉 День рождения — Сима",
    subtitle: "Источник: schedule.xlsx · Основной",
    customer: "сима",
  },
  {
    id: "evt-2026-04-03-1700",
    date: "2026-04-03",
    start: "17:00",
    end: "22:00",
    title: "🎉 День рождения — Анжелика",
    subtitle: "Источник: schedule.xlsx · Основной",
    customer: "Анжелика",
  },
  {
    id: "evt-2026-04-04-1000",
    date: "2026-04-04",
    start: "10:00",
    end: "15:00",
    title: "🎉 День рождения — Элла",
    subtitle: "Источник: schedule.xlsx · Основной",
    customer: "Элла",
  },
  {
    id: "evt-2026-04-04-1700",
    date: "2026-04-04",
    start: "17:00",
    end: "22:00",
    title: "🎉 День рождения — Эла",
    subtitle: "Источник: schedule.xlsx · Основной",
    customer: "Эла",
  },
  {
    id: "evt-2026-04-05-1000",
    date: "2026-04-05",
    start: "10:00",
    end: "15:00",
    title: "🎉 День рождения — Андрей",
    subtitle: "Источник: schedule.xlsx · Основной",
    customer: "Андрей",
  },
  {
    id: "evt-2026-04-05-1700",
    date: "2026-04-05",
    start: "17:00",
    end: "22:00",
    title: "🎉 День рождения — Алёна",
    subtitle: "Источник: schedule.xlsx · Основной",
    customer: "Алёна",
  },
  {
    id: "evt-2026-04-06-1700",
    date: "2026-04-06",
    start: "17:00",
    end: "21:00",
    title: "🎉 День рождения — базовый слот",
    subtitle: "Источник: schedule.xlsx · Основной",
    customer: "БАЗОВЫЙ",
  },
  {
    id: "evt-2026-04-09-1700",
    date: "2026-04-09",
    start: "17:00",
    end: "22:00",
    title: "🎉 День рождения — Нина",
    subtitle: "Источник: schedule.xlsx · Основной",
    customer: "Нина",
  },
  {
    id: "evt-2026-04-10-1700",
    date: "2026-04-10",
    start: "17:00",
    end: "22:00",
    title: "🎉 День рождения — Анна и Антон",
    subtitle: "Источник: schedule.xlsx · Основной",
    customer: "Анна и Антон",
  },
  {
    id: "evt-2026-04-11-1700",
    date: "2026-04-11",
    start: "17:00",
    end: "22:00",
    title: "🎉 День рождения — Гридина",
    subtitle: "Источник: schedule.xlsx · Основной",
    customer: "Гридина",
  },
  {
    id: "evt-2026-04-12-1100",
    date: "2026-04-12",
    start: "11:00",
    end: "15:00",
    title: "🎈 Тусовка с детьми — Кристина",
    subtitle: "Источник: schedule.xlsx · Основной",
    customer: "Кристина",
  },
  {
    id: "evt-2026-04-12-1700",
    date: "2026-04-12",
    start: "17:00",
    end: "22:00",
    title: "🎉 День рождения — Елена",
    subtitle: "Источник: schedule.xlsx · Основной",
    customer: "Елена",
  },
  {
    id: "evt-2026-04-17-1700",
    date: "2026-04-17",
    start: "17:00",
    end: "19:00",
    title: "🎉 День рождения — Дина",
    subtitle: "Источник: schedule.xlsx · Основной",
    customer: "Дина",
  },
  {
    id: "evt-2026-04-18-1700",
    date: "2026-04-18",
    start: "17:00",
    end: "22:00",
    title: "🎉 День рождения — Лиза",
    subtitle: "Источник: schedule.xlsx · Основной",
    customer: "Лиза",
  },
  {
    id: "evt-2026-04-24-1700",
    date: "2026-04-24",
    start: "17:00",
    end: "21:00",
    title: "🎉 День рождения — Ольга / базовый",
    subtitle: "Источник: schedule.xlsx · Основной",
    customer: "Ольга",
  },
  {
    id: "evt-2026-04-25-1000",
    date: "2026-04-25",
    start: "10:00",
    end: "15:00",
    title: "🎉 День рождения — Наталья",
    subtitle: "Источник: schedule.xlsx · Основной",
    customer: "Наталья",
  },
  {
    id: "evt-2026-04-25-1700",
    date: "2026-04-25",
    start: "17:00",
    end: "22:00",
    title: "🎉 День рождения — Оксана",
    subtitle: "Источник: schedule.xlsx · Основной",
    customer: "Оксана",
  },
  {
    id: "evt-2026-04-26-1700",
    date: "2026-04-26",
    start: "17:00",
    end: "18:00",
    title: "🎨 Воскресный праздник / мастер-класс — Алина",
    subtitle: "Источник: schedule.xlsx · Основной",
    customer: "Алина",
  },
  {
    id: "evt-2026-04-27-1500",
    date: "2026-04-27",
    start: "15:00",
    end: "20:00",
    title: "🎉 День рождения — Мария",
    subtitle: "Источник: schedule.xlsx · Основной",
    customer: "Мария",
  },
];

function toDateKey(dateLike: Date | string): string {
  if (typeof dateLike === "string") return dateLike.slice(0, 10);
  return `${dateLike.getFullYear()}-${String(dateLike.getMonth() + 1).padStart(2, "0")}-${String(dateLike.getDate()).padStart(2, "0")}`;
}

function parseDate(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00`);
}

function shiftDate(dateKey: string, days: number): string {
  const next = new Date(parseDate(dateKey).getTime() + days * DAY_MS);
  return toDateKey(next);
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const safe = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function addMinutes(time: string, delta: number): string {
  return minutesToTime(timeToMinutes(time) + delta);
}

function uniqueTags(tags: string[]): string[] {
  return [...new Set(tags)];
}

function overlaps(
  left: Pick<ScheduleSlot, "start" | "end">,
  right: Pick<ScheduleSlot, "start" | "end">,
): boolean {
  return (
    timeToMinutes(left.start) < timeToMinutes(right.end) &&
    timeToMinutes(left.end) > timeToMinutes(right.start)
  );
}

function isMorningEvent(slot: { start: string }): boolean {
  return timeToMinutes(slot.start) < 12 * 60;
}

function isEveningEvent(slot: { start: string }): boolean {
  return timeToMinutes(slot.start) >= 17 * 60;
}

function hasMorningAndEveningEvents(slots: Array<{ start: string }>): boolean {
  return slots.some((slot) => isMorningEvent(slot)) && slots.some((slot) => isEveningEvent(slot));
}

function buildTemplateSlots(dateKey: string): ScheduleSlot[] {
  const weekday = parseDate(dateKey).getDay();
  const baseSlots: ScheduleSlot[] = (TEMPLATE_BY_WEEKDAY[weekday] ?? []).map((slot, index) => ({
    id: `tpl-${dateKey}-${index}`,
    date: dateKey,
    start: slot.start,
    end: slot.end,
    title: slot.title,
    subtitle: slot.subtitle,
    tone: slot.tone,
    tags: slot.tags,
    source: "template",
  }));

  return applyOverrides(baseSlots, dateKey, "template");
}

export function getStudioEvents(dateLike: Date | string): ScheduleSlot[] {
  const dateKey = toDateKey(dateLike);
  const baseSlots: ScheduleSlot[] = STUDIO_EVENTS.filter((event) => event.date === dateKey).map((event) => ({
    id: event.id,
    date: event.date,
    start: event.start,
    end: event.end,
    title: event.title,
    subtitle: event.subtitle,
    tone: "kinderly",
    tags: ["party", "studio", ...(event.customer ? [event.customer.toLowerCase()] : [])],
    source: "studio",
  }));

  return applyOverrides(baseSlots, dateKey, "studio");
}

function buildCleaningSlots(dateKey: string, todayEvents: ScheduleSlot[]): ScheduleSlot[] {
  const previousDate = shiftDate(dateKey, -1);
  const previousEvents = getStudioEvents(previousDate);
  if (previousEvents.length === 0) return [];

  // Evening party yesterday → cleanup today 11:00–15:00
  // Morning party today AND evening party yesterday → early cleanup 06:00–09:00
  const hasMorningToday = todayEvents.some((event) => isMorningEvent(event));
  const hadEveningYesterday = previousEvents.some((event) => isEveningEvent(event));
  const earlyWindow = hasMorningToday && hadEveningYesterday;

  return [
    {
      id: `cleanup-${dateKey}`,
      date: dateKey,
      start: earlyWindow ? "06:00" : "11:00",
      end: earlyWindow ? "09:00" : "15:00",
      title:
        previousEvents.length > 1
          ? `🧹 Уборка студии после ${previousEvents.length} праздников`
          : "🧹 Уборка студии после праздника",
      subtitle: earlyWindow
        ? "Раннее окно: утром уже стоит следующий праздник"
        : "Уборка с 11 до 15 — сначала пробежка утром, потом студия",
      tone: "cleanup",
      tags: ["cleanup", "studio"],
      source: "derived",
    },
  ];
}

function buildBetweenPartySupportSlots(
  dateKey: string,
  todayEvents: ScheduleSlot[],
): ScheduleSlot[] {
  if (!hasMorningAndEveningEvents(todayEvents)) return [];

  return [
    {
      id: `between-parties-cleanup-${dateKey}`,
      date: dateKey,
      start: "15:00",
      end: "17:00",
      title: "🧹 Помочь Саше с уборкой между праздниками",
      subtitle:
        "Если утром и вечером стоят праздники, с 15:00 до 17:00 едешь помочь Саше быстро привести пространство в порядок между слотами.",
      tone: "cleanup",
      tags: ["cleanup", "studio", "sasha", "support", "between-parties", "high-load"],
      source: "derived",
    },
  ];
}

function mergeCoverageDrafts(drafts: CoverageDraft[]): CoverageDraft[] {
  if (drafts.length === 0) return [];

  const sorted = [...drafts].sort(
    (a, b) => timeToMinutes(a.start) - timeToMinutes(b.start),
  );
  const result: CoverageDraft[] = [];

  for (const draft of sorted) {
    const last = result[result.length - 1];

    if (!last) {
      result.push({ ...draft, titles: [...draft.titles], tags: [...draft.tags] });
      continue;
    }

    if (timeToMinutes(draft.start) <= timeToMinutes(last.end)) {
      last.end = minutesToTime(
        Math.max(timeToMinutes(last.end), timeToMinutes(draft.end)),
      );
      last.titles = [...last.titles, ...draft.titles];
      last.tags = uniqueTags([...last.tags, ...draft.tags]);
      last.isWednesdayEvening = last.isWednesdayEvening || draft.isWednesdayEvening;
      continue;
    }

    result.push({ ...draft, titles: [...draft.titles], tags: [...draft.tags] });
  }

  return result;
}

function buildCoverageSlots(dateKey: string, todayEvents: ScheduleSlot[]): ScheduleSlot[] {
  const weekday = parseDate(dateKey).getDay();
  const hasBetweenPartySupport = hasMorningAndEveningEvents(todayEvents);

  const drafts = todayEvents.map((event) => {
    const evening = isEveningEvent(event);
    const morning = isMorningEvent(event);
    const isWednesdayEvening = weekday === 3 && evening;
    const start = hasBetweenPartySupport && evening ? event.start : addMinutes(event.start, -60);
    const end = hasBetweenPartySupport && morning ? event.end : addMinutes(event.end, 60);

    return {
      start,
      end,
      titles: [event.title.replace(/^🎉\s*/, "")],
      tags: uniqueTags([
        "family",
        "danya",
        "admin",
        "childcare-window",
        "vibe-coding",
        "studio",
        ...(isWednesdayEvening ? ["grandma", "rehearsal"] : []),
      ]),
      isWednesdayEvening,
    } satisfies CoverageDraft;
  });

  return mergeCoverageDrafts(drafts).map((draft, index) => {
    const singleEvent = draft.titles.length === 1;
    const title = singleEvent
      ? `🎉 ${draft.titles[0]} в студии`
      : `🎉 ${draft.titles.length} события в студии`;

    const details = singleEvent ? draft.titles[0] : draft.titles.join(" · ");
    const logistics = draft.isWednesdayEvening
      ? "По средам при вечернем празднике: логистика с Даней/бабушкой и дальше репетиция."
      : "Саша едет работать админом, ты — с Даней.";

    return {
      id: `coverage-${dateKey}-${index}`,
      date: dateKey,
      start: draft.start,
      end: draft.end,
      title,
      subtitle: `${details}. ${logistics} В спокойные окна можно параллельно делать тихие задачи на ноутбуке / vibe coding.`,
      tone: "family",
      tags: draft.tags,
      source: "derived" as const,
    };
  });
}

function buildDerivedSlots(dateKey: string, todayEvents: ScheduleSlot[]): ScheduleSlot[] {
  return applyOverrides(
    [
      ...buildCleaningSlots(dateKey, todayEvents),
      ...buildBetweenPartySupportSlots(dateKey, todayEvents),
      ...buildCoverageSlots(dateKey, todayEvents),
    ],
    dateKey,
    "derived",
  );
}

function filterTemplateSlots(
  templateSlots: ScheduleSlot[],
  lockedSlots: ScheduleSlot[],
): ScheduleSlot[] {
  return templateSlots.filter(
    (slot) => !lockedSlots.some((locked) => overlaps(slot, locked)),
  );
}

// ── Custom events (agent-managed) ───────────────────────────────────────────

export type CustomEvent = {
  id: string;
  date: string;
  start: string;
  end: string;
  title: string;
  tone: ScheduleTone;
  tags: string[];
  kind?: "task" | "event";
  taskId?: string | null;
};

const CUSTOM_KEY = "alphacore_schedule_custom";
const OVERRIDE_KEY = "alphacore_schedule_overrides";

function loadOverrides(): ScheduleOverride[] {
  return lsGet<ScheduleOverride[]>(OVERRIDE_KEY, []);
}

function saveOverrides(overrides: ScheduleOverride[]): void {
  lsSet(OVERRIDE_KEY, overrides);
}

function applyOverrides(
  baseSlots: ScheduleSlot[],
  dateKey: string,
  source: EditableScheduleSource,
): ScheduleSlot[] {
  const overrides = loadOverrides().filter((override) => override.originalSource === source);
  const overrideMap = new Map(overrides.map((override) => [override.originalId, override]));

  const slots = baseSlots
    .filter((slot) => !overrideMap.has(slot.id))
    .concat(
      overrides
        .filter((override) => override.date === dateKey && !override.hidden)
        .map((override) => ({
          id: override.originalId,
          date: override.date,
          start: override.start,
          end: override.end,
          title: override.title,
          subtitle: override.subtitle,
          tone: override.tone,
          tags: override.tags,
          source,
        })),
    );

  return slots;
}

function upsertOverride(
  slot: ScheduleSlot,
  patch: Partial<Omit<ScheduleOverride, "originalId" | "originalSource">>,
): ScheduleOverride | null {
  const overrides = loadOverrides();
  const next: ScheduleOverride = {
    originalId: slot.id,
    originalSource: slot.source,
    date: patch.date ?? slot.date,
    start: patch.start ?? slot.start,
    end: patch.end ?? slot.end,
    title: patch.title ?? slot.title,
    subtitle: patch.subtitle ?? slot.subtitle,
    tone: patch.tone ?? slot.tone,
    tags: patch.tags ?? slot.tags,
    hidden: patch.hidden ?? false,
  };

  const index = overrides.findIndex((override) => override.originalId === slot.id);
  if (index >= 0) overrides[index] = next;
  else overrides.push(next);
  saveOverrides(overrides);
  return next;
}

function loadCustomEvents(): CustomEvent[] {
  return lsGet<CustomEvent[]>(CUSTOM_KEY, []);
}

function saveCustomEvents(events: CustomEvent[]): void {
  lsSet(CUSTOM_KEY, events);
}

function isTaskLikeCustomEvent(event: Pick<CustomEvent, "kind">): boolean {
  return event.kind !== "event";
}

function defaultCustomEventTaskPriority(_event: Pick<CustomEvent, "tone">): TaskPriority {
  return "p2";
}

function syncCustomEventTask(event: CustomEvent): CustomEvent {
  const kind = event.kind ?? "task";

  if (!isTaskLikeCustomEvent({ kind })) {
    return {
      ...event,
      kind,
      taskId: null,
    };
  }

  const nextTaskId = event.taskId ?? event.id;
  const linkedTask = getTasks().find((task) => task.id === nextTaskId);

  if (!linkedTask) {
    addTask(event.title, {
      id: nextTaskId,
      priority: defaultCustomEventTaskPriority(event),
      dueDate: event.date,
      status: "active",
    });
  } else {
    updateTask(linkedTask.id, {
      title: event.title,
      dueDate: event.date,
      status: "active",
    });
  }

  return {
    ...event,
    kind,
    taskId: nextTaskId,
  };
}

export function getCustomEvents(dateKey?: string): CustomEvent[] {
  const all = loadCustomEvents();
  return dateKey ? all.filter((e) => e.date === dateKey) : all;
}

export function getScheduledTaskIds(dateKey?: string): string[] {
  return getCustomEvents(dateKey)
    .filter(isTaskLikeCustomEvent)
    .map((event) => event.taskId)
    .filter((taskId): taskId is string => typeof taskId === "string" && taskId.length > 0);
}

export function addCustomEvent(event: Omit<CustomEvent, "id">): CustomEvent {
  const events = loadCustomEvents();
  const id = `custom-${Date.now().toString(36)}`;
  const full = syncCustomEventTask({ id, kind: "task", ...event });
  events.push(full);
  saveCustomEvents(events);
  return full;
}

export function removeCustomEvent(id: string): boolean {
  const events = loadCustomEvents();
  const idx = events.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  const [removed] = events.splice(idx, 1);
  saveCustomEvents(events);

  if (removed && isTaskLikeCustomEvent(removed) && removed.taskId) {
    deleteTask(removed.taskId);
  }

  return true;
}

export function updateCustomEvent(
  id: string,
  patch: Partial<Omit<CustomEvent, "id">>,
): CustomEvent | null {
  const events = loadCustomEvents();
  const idx = events.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  const previous = events[idx]!;
  const next = syncCustomEventTask({ ...previous, ...patch });

  if (!isTaskLikeCustomEvent(next) && previous.taskId) {
    deleteTask(previous.taskId);
  }

  events[idx] = next;
  saveCustomEvents(events);
  return events[idx];
}

export function isEditableScheduleSlot(slot: ScheduleSlot): boolean {
  return slot.id.startsWith("custom-") || slot.source === "template" || slot.source === "studio";
}

export function updateEditableScheduleSlot(
  slot: ScheduleSlot,
  patch: Partial<Omit<CustomEvent, "id">>,
): ScheduleSlot | null {
  if (slot.id.startsWith("custom-")) {
    const updated = updateCustomEvent(slot.id, patch);
    return updated
      ? {
          id: updated.id,
          date: updated.date,
          start: updated.start,
          end: updated.end,
          title: updated.title,
          tone: updated.tone,
          tags: updated.tags,
          kind: updated.kind,
          taskId: updated.taskId,
          source: "derived",
        }
      : null;
  }

  const override = upsertOverride(slot, patch);
  return override
    ? {
        id: override.originalId,
        date: override.date,
        start: override.start,
        end: override.end,
        title: override.title,
        subtitle: override.subtitle,
        tone: override.tone,
        tags: override.tags,
        source: override.originalSource,
      }
    : null;
}

export function removeEditableScheduleSlot(slot: ScheduleSlot): boolean {
  if (slot.id.startsWith("custom-")) {
    return removeCustomEvent(slot.id);
  }

  return upsertOverride(slot, { hidden: true }) !== null;
}

function getCustomSlots(dateKey: string): ScheduleSlot[] {
  return getCustomEvents(dateKey).map((e) => ({
    id: e.id,
    date: e.date,
    start: e.start,
    end: e.end,
    title: e.title,
    tone: e.tone,
    tags: e.tags,
    kind: e.kind ?? "task",
    taskId: e.taskId ?? null,
    source: "derived" as const,
  }));
}

export function getScheduleForDate(dateLike: Date | string): ScheduleSlot[] {
  const dateKey = toDateKey(dateLike);
  const studioEvents = getStudioEvents(dateKey);
  const derivedSlots = buildDerivedSlots(dateKey, studioEvents);
  const customSlots = getCustomSlots(dateKey);
  const cleanupLikeSlots = derivedSlots.filter((slot) => slot.tone === "cleanup");
  const lockedSlots = [...cleanupLikeSlots, ...customSlots];
  const templateSlots = filterTemplateSlots(buildTemplateSlots(dateKey), lockedSlots);
  const slots = [
    ...templateSlots,
    ...derivedSlots,
    ...customSlots,
  ];

  return slots.sort((a, b) => {
    return (
      timeToMinutes(a.start) - timeToMinutes(b.start) ||
      timeToMinutes(a.end) - timeToMinutes(b.end) ||
      a.title.localeCompare(b.title, "ru")
    );
  });
}

export function getScheduleSummary(dateLike: Date | string): {
  parties: number;
  cleanup: number;
  family: number;
} {
  const dateKey = toDateKey(dateLike);
  const studioEvents = getStudioEvents(dateKey);
  const derivedSlots = buildDerivedSlots(dateKey, studioEvents);

  return {
    parties: studioEvents.length,
    cleanup: derivedSlots.filter((slot) => slot.tone === "cleanup").length,
    family: derivedSlots.filter((slot) => slot.tone === "family").length,
  };
}

export function getMonthDates(anchor: Date = new Date()): Array<{
  key: string;
  day: string;
  label: string;
  isToday: boolean;
}> {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const total = new Date(year, month + 1, 0).getDate();
  const todayKey = toDateKey(new Date());

  return Array.from({ length: total }, (_, index) => {
    const date = new Date(year, month, index + 1);
    return {
      key: toDateKey(date),
      day: new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(date),
      label: new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(date),
      isToday: toDateKey(date) === todayKey,
    };
  });
}

export function getMonthLabel(anchor: Date = new Date()): string {
  return new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
  }).format(anchor);
}
