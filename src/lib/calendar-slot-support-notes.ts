import type { ScheduleSlot } from "./schedule";

export type CalendarSlotSupportNoteTone = "amber" | "sky" | "emerald" | "violet";

export type CalendarSlotSupportNote = {
  id: "load-fuel" | "recovery" | "base-stack" | "strength-base";
  badge: string;
  title: string;
  summary: string;
  detail?: string;
  points?: string[];
  tone: CalendarSlotSupportNoteTone;
  icon: string;
};

type SupportSlotInput = Pick<ScheduleSlot, "tone" | "tags" | "title" | "source">;

const HEAVY_LOAD_TAGS = [
  "cleanup",
  "high-load",
  "party",
  "studio",
  "support",
  "between-parties",
  "household",
];

const RECOVERY_TAGS = [
  "recovery",
  "sleep",
  "shutdown",
  "bedtime",
  "quiet-buffer",
  "rest",
  "stress",
  "wellbeing",
];

const STRENGTH_TAGS = ["training", "movement", "strength"];

const BASE_TAGS = ["run", "health", "water", "hydration", "steps", "stretch"];

function hasAnyTag(slot: SupportSlotInput, tags: string[]): boolean {
  return tags.some((tag) => slot.tags.includes(tag));
}

function includesAnyToken(title: string, tokens: string[]): boolean {
  const normalizedTitle = title.toLowerCase();
  return tokens.some((token) => normalizedTitle.includes(token));
}

function isHeavyLoadSlot(slot: SupportSlotInput): boolean {
  return (
    slot.source === "studio" ||
    hasAnyTag(slot, HEAVY_LOAD_TAGS) ||
    includesAnyToken(slot.title, ["уборк", "cleanup", "праздник", "party"])
  );
}

function isRecoverySlot(slot: SupportSlotInput): boolean {
  return (
    slot.tone === "personal" ||
    hasAnyTag(slot, RECOVERY_TAGS) ||
    includesAnyToken(slot.title, [
      "сон",
      "sleep",
      "recovery",
      "quiet",
      "shutdown",
      "stretch",
      "rest",
      "восстанов",
    ])
  );
}

function isStrengthSlot(slot: SupportSlotInput): boolean {
  return (
    hasAnyTag(slot, STRENGTH_TAGS) ||
    includesAnyToken(slot.title, ["тренир", "movement", "strength", "силов"])
  );
}

function isBaseStackSlot(slot: SupportSlotInput): boolean {
  return (
    slot.tone === "health" ||
    hasAnyTag(slot, BASE_TAGS) ||
    includesAnyToken(slot.title, ["run", "water", "hydration", "бег", "вода", "здоров"])
  );
}

export function getCalendarSlotSupportNote(
  slot: SupportSlotInput,
): CalendarSlotSupportNote | null {
  if (isHeavyLoadSlot(slot)) {
    return {
      id: "load-fuel",
      badge: "под нагрузку",
      title: "Не заходи в тяжёлый слот на пустом баке",
      summary:
        "В cleanup / студийной физике опора сначала в воде, электролитах, углях и белке, а не в экзотическом стеке.",
      detail: "Креатин лучше держать как ровную базу каждый день, а не как emergency-кнопку.",
      points: [
        "До и после окна — вода + электролиты.",
        "Не начинать уборку голодным: угли + белок.",
        "После нагрузки сначала еда и сон, потом следующая волна дел.",
      ],
      tone: "amber",
      icon: "⚡",
    };
  }

  if (isRecoverySlot(slot)) {
    return {
      id: "recovery",
      badge: "recovery",
      title: "Главная добавка здесь — сон",
      summary:
        "Если слот про recovery, вечерний shutdown или разбитость — не добивай себя новым стимулом; магний имеет смысл только если реально помогает по сну и напряжению.",
      detail:
        "Геройство обычно бьёт по следующему дню сильнее, чем одна вовремя срезанная задача.",
      points: [
        "Сначала тишина, вода и нормальная еда.",
        "Оставь вечер без второй рабочей смены.",
        "При throat-watch или разбитости выбирай recovery mode.",
      ],
      tone: "violet",
      icon: "🌙",
    };
  }

  if (isStrengthSlot(slot)) {
    return {
      id: "strength-base",
      badge: "силовая база",
      title: "Выносливость строится силовой базой",
      summary:
        "1–2 короткие силовые в неделю + креатин дадут больше resilience для уборок, чем ещё одна новая банка.",
      detail: "Думай неделями: адаптация к тяжёлой нагрузке строится заранее.",
      points: [
        "Иногда меняй слот движения на силовой блок.",
        "Фокус — ноги, корпус, спина и хват.",
        "Цель — легче переносить бытовой heavy load.",
      ],
      tone: "sky",
      icon: "🏋️",
    };
  }

  if (isBaseStackSlot(slot)) {
    return {
      id: "base-stack",
      badge: "база",
      title: "Держи базу простой и стабильной",
      summary:
        "Омега‑3 + витамин D + креатин — достаточно как базовый слой. Смысл в регулярности, а не в длине списка.",
      detail:
        "Если магний заметно помогает по сну или напряжению — держи его как optional helper, без культа.",
      points: [
        "Не дублируй масло на масло без причины.",
        "База работает только поверх еды и сна.",
        "Экзотика вторична по сравнению с режимом.",
      ],
      tone: "emerald",
      icon: "🫀",
    };
  }

  return null;
}