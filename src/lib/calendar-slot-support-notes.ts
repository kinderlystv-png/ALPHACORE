import type { ScheduleSlot } from "./schedule";
import type { DayModeId } from "./heys-day-mode";

export type CalendarSlotSupportNoteTone = "amber" | "sky" | "emerald" | "violet" | "rose";

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

type SupportNoteContext = {
  dayModeId?: DayModeId | null;
};

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

function buildHeavyLoadNote(dayModeId?: DayModeId | null): CalendarSlotSupportNote {
  switch (dayModeId) {
    case "damage-control":
      return {
        id: "load-fuel",
        badge: "под нагрузку",
        title: "Сегодня нагрузку нужно удешевить",
        summary:
          "В damage control этот cleanup-слот стоит проходить только через воду, еду и сжатый объём, а не через силу воли.",
        detail: "Это день на удержание базы, а не на рекорды по уборке.",
        points: [
          "Сначала вода + электролиты + нормальная еда.",
          "Если можно — оставь только обязательное ядро слота.",
          "После окна не открывай вторую рабочую смену.",
        ],
        tone: "rose",
        icon: "⚡",
      };
    case "recovery":
      return {
        id: "load-fuel",
        badge: "под нагрузку",
        title: "Топливо важнее силы воли",
        summary:
          "В recovery mode физический слот должен быть подпитан заранее и не забирать вечер у сна.",
        detail: "Креатин — фоновая база, а не rescue-кнопка в моменте.",
        points: [
          "До окна — угли + белок, после — вода + электролиты.",
          "Не заходи в уборку голодным и раздражённым.",
          "Если слот можно сжать — сжимай.",
        ],
        tone: "amber",
        icon: "⚡",
      };
    case "execution":
      return {
        id: "load-fuel",
        badge: "под нагрузку",
        title: "Подпитай execution, а не только слот",
        summary:
          "Тяжёлое окно ок, если входишь сытым и не занимаешь энергию у следующего recovery anchor.",
        detail: "Стек здесь вторичен по сравнению с fuel, водой и защищённым сном.",
        points: [
          "Перед окном — угли + белок, после — вода и электролиты.",
          "Не тащи cleanup в late-night хвост.",
          "Креатин держи как daily floor, не как emergency.",
        ],
        tone: "emerald",
        icon: "⚡",
      };
    default:
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
}

function buildRecoveryNote(dayModeId?: DayModeId | null): CalendarSlotSupportNote {
  switch (dayModeId) {
    case "damage-control":
      return {
        id: "recovery",
        badge: "recovery",
        title: "Recovery сейчас важнее любой ещё одной задачи",
        summary:
          "Если день в damage control, этот слот нельзя красть под работу: сначала сон, тишина, вода и базовая еда.",
        detail: "Когда фон ломается, спасает не ещё один sprint, а вовремя защищённый вечер.",
        points: [
          "Не превращай окно в catch-up для хвостов.",
          "Убери шум и яркий свет заранее.",
          "Магний — только если правда помогает уснуть.",
        ],
        tone: "rose",
        icon: "🌙",
      };
    case "execution":
      return {
        id: "recovery",
        badge: "recovery",
        title: "Не сжигай execution поздним шумом",
        summary:
          "Даже в хорошем дне recovery-окно держит завтрашний execution стабильным и дешёвым по цене.",
        detail: "Сильный день ломается чаще украденным вечером, чем недостающей задачей.",
        points: [
          "Оставь вечерний shutdown неприкосновенным.",
          "Если усталость уже пришла — не спорь с ней.",
          "Сон всё ещё главный multiplier для следующего дня.",
        ],
        tone: "sky",
        icon: "🌙",
      };
    case "recovery":
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
    default:
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
}

function buildStrengthNote(dayModeId?: DayModeId | null): CalendarSlotSupportNote {
  switch (dayModeId) {
    case "damage-control":
      return {
        id: "strength-base",
        badge: "силовая база",
        title: "Сегодня не PR-день",
        summary:
          "В damage control движение держим коротким и техническим: база строится регулярностью, не добиванием.",
        detail: "Если тело ватное, mobility или walk полезнее, чем тяжёлый силовой героизм.",
        points: [
          "Оставь запас усилия.",
          "Если нужно — замени силовую на walk + mobility.",
          "Смысл сегодня в стабилизации, а не в прогрессе любой ценой.",
        ],
        tone: "rose",
        icon: "🏋️",
      };
    case "recovery":
      return {
        id: "strength-base",
        badge: "силовая база",
        title: "Силовая база — без героизма",
        summary:
          "В recovery mode тренировка нужна как сигнал устойчивости, а не как экзамен на характер.",
        detail: "Оставь RPE ниже, чем подсказывает амбиция.",
        points: [
          "Коротко и технично — уже достаточно.",
          "Фокус — корпус, спина, ноги и хват.",
          "Главное — выйти лучше, а не выжатым.",
        ],
        tone: "amber",
        icon: "🏋️",
      };
    case "execution":
      return {
        id: "strength-base",
        badge: "силовая база",
        title: "Вот где строится выносливость под cleanup",
        summary:
          "1–2 короткие силовые в неделю + креатин дают больше resilience для тяжёлых бытовых окон, чем ещё одна новая банка.",
        detail: "Это инвестиция в будущие cleanup-дни, а не только в форму ради формы.",
        points: [
          "Держи опору на ноги, корпус, спину и хват.",
          "Используй хороший день, чтобы укрепить базу заранее.",
          "Recovery anchors всё равно должны остаться на месте.",
        ],
        tone: "sky",
        icon: "🏋️",
      };
    default:
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
}

function buildBaseStackNote(dayModeId?: DayModeId | null): CalendarSlotSupportNote {
  switch (dayModeId) {
    case "damage-control":
      return {
        id: "base-stack",
        badge: "база",
        title: "Не лечи хаос новыми банками",
        summary:
          "В damage control база — омега‑3, витамин D, креатин, вода и еда. Не надо сверху добавлять panic-stack.",
        detail: "Сон и еда дадут больше эффекта, чем новая капсула, купленная на тревоге.",
        points: [
          "Сначала вода, еда и сон.",
          "База — да, хаотичное расширение стека — нет.",
          "Магний только если реально работает по сну.",
        ],
        tone: "rose",
        icon: "🫀",
      };
    case "recovery":
      return {
        id: "base-stack",
        badge: "база",
        title: "База должна поддерживать recovery",
        summary:
          "Омега‑3 + витамин D + креатин достаточно; смысл — не забывать базу, пока день мягкий и фон чинится.",
        detail:
          "Если магний заметно помогает по сну или напряжению — держи его как опциональную поддержку, без культа.",
        points: [
          "База работает только поверх еды и сна.",
          "Не превращай recovery в погоню за новым стеком.",
          "Регулярность важнее длины списка.",
        ],
        tone: "violet",
        icon: "🫀",
      };
    case "execution":
      return {
        id: "base-stack",
        badge: "база",
        title: "База держит execution ровным",
        summary:
          "Простая база снижает цену длинных work- и cleanup-дней — без перегруза лишними банками.",
        detail:
          "Креатин — daily floor, а не спасение в последний момент; питание и сон всё равно решают первыми.",
        points: [
          "Омега‑3 + витамин D + креатин — уже достаточно.",
          "Не дублируй масло на масло без причины.",
          "Экзотика вторична по сравнению с режимом.",
        ],
        tone: "emerald",
        icon: "🫀",
      };
    default:
      return {
        id: "base-stack",
        badge: "база",
        title: "Держи базу простой и стабильной",
        summary:
          "Омега‑3 + витамин D + креатин — достаточно как базовый слой. Смысл в регулярности, а не в длине списка.",
        detail:
          "Если магний заметно помогает по сну или напряжению — держи его как опциональную поддержку, без культа.",
        points: [
          "Не дублируй масло на масло без причины.",
          "База работает только поверх еды и сна.",
          "Экзотика вторична по сравнению с режимом.",
        ],
        tone: "emerald",
        icon: "🫀",
      };
  }
}

export function getCalendarSlotSupportNote(
  slot: SupportSlotInput,
  context?: SupportNoteContext,
): CalendarSlotSupportNote | null {
  const dayModeId = context?.dayModeId;

  if (isHeavyLoadSlot(slot)) {
    return buildHeavyLoadNote(dayModeId);
  }

  if (isRecoverySlot(slot)) {
    return buildRecoveryNote(dayModeId);
  }

  if (isStrengthSlot(slot)) {
    return buildStrengthNote(dayModeId);
  }

  if (isBaseStackSlot(slot)) {
    return buildBaseStackNote(dayModeId);
  }

  return null;
}