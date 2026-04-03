import { lsGet, lsSet } from "./storage";

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
  "Обычная уборка ставится не раньше 10:00; если после вечернего праздника утром уже стоит следующий праздник — уборка переносится на 06:00–09:00.",
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
      start: "09:00",
      end: "10:30",
      title: "Стратег. задачи Kinderly",
      tone: "kinderly",
      tags: ["kinderly", "strategy"],
    },
    {
      start: "11:00",
      end: "12:30",
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
    {
      start: "17:00",
      end: "18:00",
      title: "🏃 Бег 60 мин",
      tone: "health",
      tags: ["run", "health"],
    },
  ],
  2: [
    {
      start: "09:00",
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
    {
      start: "17:00",
      end: "18:00",
      title: "🏃 Бег 60 мин",
      tone: "health",
      tags: ["run", "health"],
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
      start: "09:00",
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
    {
      start: "17:00",
      end: "18:00",
      title: "🏃 Бег 60 мин",
      tone: "health",
      tags: ["run", "health"],
    },
  ],
  6: [
    {
      start: "10:00",
      end: "13:00",
      title: "Семья / активный отдых",
      tone: "personal",
      tags: ["family", "rest"],
    },
    {
      start: "16:00",
      end: "17:00",
      title: "🏃 Бег 60 мин",
      tone: "health",
      tags: ["run", "health"],
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

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes: number): string {
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

function buildTemplateSlots(dateKey: string): ScheduleSlot[] {
  const weekday = parseDate(dateKey).getDay();
  return (TEMPLATE_BY_WEEKDAY[weekday] ?? []).map((slot, index) => ({
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
}

export function getStudioEvents(dateLike: Date | string): ScheduleSlot[] {
  const dateKey = toDateKey(dateLike);
  return STUDIO_EVENTS.filter((event) => event.date === dateKey).map((event) => ({
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
}

function buildCleaningSlots(dateKey: string, todayEvents: ScheduleSlot[]): ScheduleSlot[] {
  const previousDate = shiftDate(dateKey, -1);
  const previousEvents = getStudioEvents(previousDate);
  if (previousEvents.length === 0) return [];

  const earlyWindow =
    todayEvents.some((event) => isMorningEvent(event)) &&
    previousEvents.some((event) => isEveningEvent(event));

  return [
    {
      id: `cleanup-${dateKey}`,
      date: dateKey,
      start: earlyWindow ? "06:00" : "10:00",
      end: earlyWindow ? "09:00" : "13:00",
      title:
        previousEvents.length > 1
          ? `🧹 Уборка студии после ${previousEvents.length} праздников`
          : "🧹 Уборка студии после праздника",
      subtitle: earlyWindow
        ? "Раннее окно: утром уже стоит следующий праздник"
        : "С 1 апреля без уборщицы — следующий день закрываем сами",
      tone: "cleanup",
      tags: ["cleanup", "studio"],
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

  const drafts = todayEvents.map((event) => {
    const evening = isEveningEvent(event);
    const isWednesdayEvening = weekday === 3 && evening;

    return {
      start: addMinutes(event.start, -60),
      end: addMinutes(event.end, 60),
      titles: [event.title.replace(/^🎉\s*/, "")],
      tags: uniqueTags([
        "family",
        "danya",
        "admin",
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
};

const CUSTOM_KEY = "alphacore_schedule_custom";

function loadCustomEvents(): CustomEvent[] {
  return lsGet<CustomEvent[]>(CUSTOM_KEY, []);
}

function saveCustomEvents(events: CustomEvent[]): void {
  lsSet(CUSTOM_KEY, events);
}

export function getCustomEvents(dateKey?: string): CustomEvent[] {
  const all = loadCustomEvents();
  return dateKey ? all.filter((e) => e.date === dateKey) : all;
}

export function addCustomEvent(event: Omit<CustomEvent, "id">): CustomEvent {
  const events = loadCustomEvents();
  const id = `custom-${Date.now().toString(36)}`;
  const full: CustomEvent = { id, ...event };
  events.push(full);
  saveCustomEvents(events);
  return full;
}

export function removeCustomEvent(id: string): boolean {
  const events = loadCustomEvents();
  const idx = events.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  events.splice(idx, 1);
  saveCustomEvents(events);
  return true;
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
    source: "derived" as const,
  }));
}

export function getScheduleForDate(dateLike: Date | string): ScheduleSlot[] {
  const dateKey = toDateKey(dateLike);
  const studioEvents = getStudioEvents(dateKey);
  const cleanupSlots = buildCleaningSlots(dateKey, studioEvents);
  const coverageSlots = buildCoverageSlots(dateKey, studioEvents);
  const customSlots = getCustomSlots(dateKey);
  const lockedSlots = [...cleanupSlots, ...coverageSlots, ...customSlots];
  const templateSlots = filterTemplateSlots(buildTemplateSlots(dateKey), lockedSlots);
  const slots = [
    ...templateSlots,
    ...cleanupSlots,
    ...coverageSlots,
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
  const cleanupSlots = buildCleaningSlots(dateKey, studioEvents);
  const coverageSlots = buildCoverageSlots(dateKey, studioEvents);

  return {
    parties: studioEvents.length,
    cleanup: cleanupSlots.length,
    family: coverageSlots.length,
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
