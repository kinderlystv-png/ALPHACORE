import { shiftDateKey } from "@/lib/calendar-slot-attention";

export type SlotQuickRescheduleOption = {
  key: string;
  dateKey: string;
  buttonLabel: string;
  description: string;
  priority: "primary" | "secondary";
};

const SHORT_LABEL_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  weekday: "short",
  day: "numeric",
});

const LONG_LABEL_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

function toLocalDate(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00`);
}

function normalizeShortLabel(label: string): string {
  return label.replace(/\./g, "");
}

export function getSlotQuickRescheduleLabel(
  dateKey: string,
  todayKey: string,
): Pick<SlotQuickRescheduleOption, "buttonLabel" | "description"> {
  const tomorrowKey = shiftDateKey(todayKey, 1);

  if (dateKey === todayKey) {
    return {
      buttonLabel: "Сегодня",
      description: "на сегодня",
    };
  }

  if (dateKey === tomorrowKey) {
    return {
      buttonLabel: "Завтра",
      description: "на завтра",
    };
  }

  return {
    buttonLabel: normalizeShortLabel(SHORT_LABEL_FORMATTER.format(toLocalDate(dateKey))),
    description: `на ${LONG_LABEL_FORMATTER.format(toLocalDate(dateKey))}`,
  };
}

export function getSlotQuickRescheduleOptions(
  slotDateKey: string,
  todayKey: string,
): SlotQuickRescheduleOption[] {
  const candidateDates =
    slotDateKey < todayKey
      ? [todayKey, shiftDateKey(todayKey, 1), shiftDateKey(todayKey, 2)]
      : slotDateKey === todayKey
        ? [shiftDateKey(todayKey, 1), shiftDateKey(todayKey, 2), shiftDateKey(todayKey, 7)]
        : [shiftDateKey(slotDateKey, 1), shiftDateKey(slotDateKey, 2), shiftDateKey(slotDateKey, 7)];

  return [...new Set(candidateDates)]
    .filter((dateKey) => dateKey !== slotDateKey)
    .map((dateKey, index) => {
      const labels = getSlotQuickRescheduleLabel(dateKey, todayKey);

      return {
        key: `reschedule-${dateKey}`,
        dateKey,
        buttonLabel: labels.buttonLabel,
        description: labels.description,
        priority: index === 0 ? "primary" : "secondary",
      } satisfies SlotQuickRescheduleOption;
    });
}