import { timeToMinutes, type ScheduleSlot } from "./schedule";
import type { DayModeId } from "./heys-day-mode";

export type CalendarSlotSupportNoteTone = "amber" | "sky" | "emerald" | "violet" | "rose";

export type CalendarSlotSupportNote = {
  id: "load-fuel" | "recovery" | "base-stack" | "strength-base";
  badge: string;
  timingLabel?: string;
  sequenceLabel?: string;
  title: string;
  summary: string;
  detail?: string;
  points?: string[];
  tone: CalendarSlotSupportNoteTone;
  icon: string;
};

type SupportSlotInput = Pick<ScheduleSlot, "tone" | "tags" | "title" | "source" | "start" | "end">;

type SupportNoteContext = {
  dayModeId?: DayModeId | null;
  previousSlot?: SupportSlotInput | null;
  nextSlot?: SupportSlotInput | null;
};

type SlotDayPart = "morning" | "day" | "evening" | "late-evening";

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

function getSlotDayPart(slot: Pick<SupportSlotInput, "start">): SlotDayPart {
  const [hoursRaw] = slot.start.split(":");
  const hours = Number(hoursRaw ?? 0);

  if (hours < 12) return "morning";
  if (hours < 17) return "day";
  if (hours < 22) return "evening";
  return "late-evening";
}

function getTimingLabel(dayPart: SlotDayPart): string {
  switch (dayPart) {
    case "morning":
      return "утро";
    case "day":
      return "день";
    case "evening":
      return "вечер";
    case "late-evening":
      return "поздний вечер";
  }
}

function getGapMinutes(left: Pick<SupportSlotInput, "end">, right: Pick<SupportSlotInput, "start">): number {
  return timeToMinutes(right.start) - timeToMinutes(left.end);
}

function isTightTransition(
  left: Pick<SupportSlotInput, "end">,
  right: Pick<SupportSlotInput, "start">,
  maxGapMin = 120,
): boolean {
  const gap = getGapMinutes(left, right);
  return gap >= 0 && gap <= maxGapMin;
}

function isNearFutureWindow(
  left: Pick<SupportSlotInput, "end">,
  right: Pick<SupportSlotInput, "start">,
  maxGapMin = 240,
): boolean {
  const gap = getGapMinutes(left, right);
  return gap >= 0 && gap <= maxGapMin;
}

function isWorkLikeSlot(slot: SupportSlotInput): boolean {
  return (
    slot.tone === "work" ||
    slot.tone === "kinderly" ||
    slot.tone === "heys" ||
    slot.tone === "review" ||
    hasAnyTag(slot, ["work", "deep-work", "strategy", "execution", "comms", "ops", "planning", "review"]) ||
    includesAnyToken(slot.title, ["work", "deep work", "strategy", "review", "задач", "стратег", "план", "реализац"])
  );
}

function toContextSlotLabel(slot: Pick<SupportSlotInput, "title">): string {
  return slot.title.replace(/^[^A-Za-zА-Яа-яЁё0-9]+/u, "").trim();
}

function applySequenceContext(
  note: CalendarSlotSupportNote,
  slot: SupportSlotInput,
  context?: SupportNoteContext,
): CalendarSlotSupportNote {
  const previousSlot = context?.previousSlot ?? null;
  const nextSlot = context?.nextSlot ?? null;
  const dayModeId = context?.dayModeId;

  if (note.id === "recovery") {
    if (previousSlot && isHeavyLoadSlot(previousSlot) && isTightTransition(previousSlot, slot, 120)) {
      const previousLabel = toContextSlotLabel(previousSlot);
      return {
        ...note,
        sequenceLabel: "после нагрузки",
        title:
          dayModeId === "damage-control"
            ? "После нагрузки нужен настоящий reset"
            : "Этот recovery нужен, чтобы погасить хвост после нагрузки",
        summary:
          dayModeId === "execution"
            ? `После «${previousLabel}» не уводи себя сразу в новую волну дел: это окно держит остаток дня ровным.`
            : `После «${previousLabel}» слот нужен под воду, еду и тихий выход, а не под ещё один скрытый sprint.`,
        detail: `Если украсть и это окно, хвост от «${previousLabel}» поедет дальше по дню или в ночь.`,
        points: [
          "Сначала вода/еда, потом любые решения.",
          "Не открывай новый work-хвост прямо из инерции.",
          "Пусть тело реально поймёт, что нагрузка закончилась.",
        ],
      };
    }

    if (nextSlot && isWorkLikeSlot(nextSlot) && isTightTransition(slot, nextSlot, 90)) {
      const nextLabel = toContextSlotLabel(nextSlot);
      return {
        ...note,
        sequenceLabel: "перед work",
        title: "Это recovery-окно — переход перед work-блоком",
        summary: `Дальше уже «${nextLabel}», так что buffer нужен, чтобы выровнять фон перед работой, а не размазаться в телефоне.`,
        detail: `Хороший переход делает «${nextLabel}» дешевле по нервной цене.`,
        points: [
          "Короткая тишина, вода, выдох — и только потом работа.",
          "Не превращай buffer в doom-scroll.",
          "Смысл окна — войти в следующий блок ровно, а не резко.",
        ],
      };
    }
  }

  if (note.id === "base-stack") {
    if (nextSlot && isHeavyLoadSlot(nextSlot) && isNearFutureWindow(slot, nextSlot, 240)) {
      const nextLabel = toContextSlotLabel(nextSlot);
      return {
        ...note,
        sequenceLabel: "перед нагрузкой",
        title: "База здесь работает как prep before heavy load",
        summary: `Позже идёт «${nextLabel}», так что базу и первую нормальную еду лучше закрыть сейчас, а не вспоминать о них уже после нагрузки.`,
        detail: `Чем лучше prep перед «${nextLabel}», тем меньше цена следующего тяжёлого окна.`,
        points: [
          "База + еда до нагрузки работают лучше, чем догонять всё постфактум.",
          "Не жди провала в энергию как триггера.",
          "Креатин — floor заранее, а не rescue после cleanup.",
        ],
      };
    }
  }

  if (note.id === "load-fuel") {
    if (nextSlot && isWorkLikeSlot(nextSlot) && isTightTransition(slot, nextSlot, 120)) {
      const nextLabel = toContextSlotLabel(nextSlot);
      return {
        ...note,
        sequenceLabel: "перед work",
        title: "Не тащи тяжёлый слот хвостом в work-блок",
        summary: `Сразу дальше идёт «${nextLabel}», поэтому здесь нужен чёткий stop: еда, вода, выдох — и только потом работа.`,
        detail: `Иначе «${nextLabel}» стартует уже не на execution, а на остатках cleanup-адреналина.`,
        points: [
          "Заложи hard stop, а не бесконечный хвост слота.",
          "После нагрузки сначала вода/еда, потом клавиатура.",
          "Не воруй fuel у следующего work-окна.",
        ],
      };
    }

    if (nextSlot && isRecoverySlot(nextSlot) && isTightTransition(slot, nextSlot, 120)) {
      const nextLabel = toContextSlotLabel(nextSlot);
      return {
        ...note,
        sequenceLabel: "перед recovery",
        title: "После этого окна recovery уже не случайно стоит в календаре",
        summary: `Дальше идёт «${nextLabel}», и это хорошо: не отдавай этот переход обратно делам, иначе нагрузка поедет в ночь.`,
        detail: `Тут победа — не в extra-effort, а в том, чтобы честно дойти до «${nextLabel}».`,
        points: [
          "Финишируй слот вовремя, не до бесконечности.",
          "Сразу переключайся в calmer режим.",
          "Recovery после heavy load — часть плана, а не бонус.",
        ],
      };
    }
  }

  if (note.id === "strength-base") {
    if (nextSlot && isHeavyLoadSlot(nextSlot) && isNearFutureWindow(slot, nextSlot, 240)) {
      const nextLabel = toContextSlotLabel(nextSlot);
      return {
        ...note,
        sequenceLabel: "в связке с нагрузкой",
        title: "Не превращай силовой слот и heavy load в один марафон",
        summary: `Если дальше ещё «${nextLabel}», силовая должна остаться короткой и технической — иначе ты сожжёшь пользу обеих частей дня.`,
        detail: `Смысл связки — собрать базу, а не устроить двойной стресс-тест подряд.`,
        points: [
          "Оставь запас усилия до следующего тяжёлого окна.",
          "Качество техники важнее объёма.",
          "Связка работает только если между окнами остаётся нервная ёмкость.",
        ],
      };
    }
  }

  return note;
}

function buildHeavyLoadNote(
  dayModeId: DayModeId | null | undefined,
  dayPart: SlotDayPart,
): CalendarSlotSupportNote {
  if (dayPart === "morning") {
    return {
      id: "load-fuel",
      badge: "под нагрузку",
      timingLabel: getTimingLabel(dayPart),
      title:
        dayModeId === "damage-control"
          ? "Утренний тяжёлый слот лучше сократить"
          : "Заправь слот до старта, а не посреди уборки",
      summary:
        dayModeId === "damage-control"
          ? "Если утро уже ватное, cleanup нельзя начинать на пустом баке и без плана, что именно обязательно сделать."
          : "Утреннюю физическую нагрузку проще пережить, если угли, белок и вода уже были до старта, а не догоняют тебя потом.",
      detail:
        dayModeId === "damage-control"
          ? "Смысл не в том, чтобы выдержать всё, а в том, чтобы не сломать остаток дня с самого утра."
          : "Креатин — ежедневный фон, а не пожарный шланг в момент усталости.",
      points: [
        "Первая еда до старта, а не после провала в энергию.",
        "Вода + электролиты рядом заранее.",
        "Если объём спорный — срезай до обязательного ядра.",
      ],
      tone: dayModeId === "damage-control" ? "rose" : "amber",
      icon: "⚡",
    };
  }

  if (dayPart === "evening" || dayPart === "late-evening") {
    return {
      id: "load-fuel",
      badge: "под нагрузку",
      timingLabel: getTimingLabel(dayPart),
      title:
        dayModeId === "execution"
          ? "Не обменивай cleanup на украденный сон"
          : "После вечерней нагрузки должен начаться shutdown",
      summary:
        dayModeId === "execution"
          ? "Даже в хорошем дне вечерний тяжёлый слот не должен тянуть за собой вторую рабочую смену."
          : "Чем позднее тяжёлый слот, тем важнее после него быстро закрыть день, а не разгонять ещё одну волну дел.",
      detail:
        dayModeId === "damage-control"
          ? "Поздний heroic cleanup чаще ломает завтрашнее утро, чем реально спасает неделю."
          : "Вечерний fuel нужен не для продолжения дня, а чтобы аккуратно дойти до сна.",
      points: [
        "После слота — еда/вода и выход в тихий режим.",
        "Не открывай ноутбук «ещё на чуть-чуть».",
        "Если можно — ужимай поздний объём раньше, чем красть сон.",
      ],
      tone: dayModeId === "damage-control" ? "rose" : "amber",
      icon: "⚡",
    };
  }

  switch (dayModeId) {
    case "damage-control":
      return {
        id: "load-fuel",
        badge: "под нагрузку",
        timingLabel: getTimingLabel(dayPart),
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
        timingLabel: getTimingLabel(dayPart),
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
        timingLabel: getTimingLabel(dayPart),
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
        timingLabel: getTimingLabel(dayPart),
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

function buildRecoveryNote(
  dayModeId: DayModeId | null | undefined,
  dayPart: SlotDayPart,
): CalendarSlotSupportNote {
  if (dayPart === "morning") {
    return {
      id: "recovery",
      badge: "recovery",
      timingLabel: getTimingLabel(dayPart),
      title:
        dayModeId === "damage-control"
          ? "Утро лучше не отдавать хаосу"
          : "Утренний recovery — это мягкий запуск дня",
      summary:
        dayModeId === "damage-control"
          ? "Если утро already broken, этот слот нужен под тишину, воду, еду и медленный вход, а не под catch-up после плохой ночи."
          : "Утром recovery-окно лучше тратить на воду, свет, еду и спокойный старт, а не на резкий прыжок в задачи.",
      detail: "Хорошее утро часто чинит день дешевле, чем потом два emergency-слота подряд.",
      points: [
        "Сначала вода и нормальная еда.",
        "Не открывай тяжёлые коммуникации первым движением.",
        "Если фон слабый — входи в день ступеньками.",
      ],
      tone: dayModeId === "damage-control" ? "rose" : "violet",
      icon: "🌙",
    };
  }

  if (dayPart === "day") {
    return {
      id: "recovery",
      badge: "recovery",
      timingLabel: getTimingLabel(dayPart),
      title: "Дневной recovery — это quiet buffer, а не пауза «на потом»",
      summary:
        "Середина дня лучше чинится короткой тишиной, walk/mobility и водой, чем ещё одним сжатым work-блоком через зубы.",
      detail: "Такой слот нужен, чтобы не доезжать до вечера уже сломанным.",
      points: [
        "Тихое окно, немного движения, немного воды.",
        "Не превращай buffer в doom-scroll.",
        "Если throat-watch/разбитость — не спорь с телом.",
      ],
      tone: dayModeId === "damage-control" ? "rose" : "violet",
      icon: "🌙",
    };
  }

  switch (dayModeId) {
    case "damage-control":
      return {
        id: "recovery",
        badge: "recovery",
        timingLabel: getTimingLabel(dayPart),
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
        timingLabel: getTimingLabel(dayPart),
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
        timingLabel: getTimingLabel(dayPart),
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
        timingLabel: getTimingLabel(dayPart),
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

function buildStrengthNote(
  dayModeId: DayModeId | null | undefined,
  dayPart: SlotDayPart,
): CalendarSlotSupportNote {
  if (dayPart === "morning") {
    return {
      id: "strength-base",
      badge: "силовая база",
      timingLabel: getTimingLabel(dayPart),
      title: "Утреннюю силовую держи технической",
      summary:
        "Утренний movement-slot хорош тем, что даёт базу ещё до хаоса дня — если не превращать его в маленький экзамен на волю.",
      detail: "Лучше выйти собранным, чем выжать себя до первой рабочей задачи.",
      points: [
        "Техника и корпус важнее максимума.",
        "Оставь запас на весь день.",
        "Креатин работает как фон, не как pre-workout-драма.",
      ],
      tone: dayModeId === "damage-control" ? "amber" : "sky",
      icon: "🏋️",
    };
  }

  if (dayPart === "evening" || dayPart === "late-evening") {
    return {
      id: "strength-base",
      badge: "силовая база",
      timingLabel: getTimingLabel(dayPart),
      title:
        dayModeId === "execution"
          ? "Вечернее движение не должно съесть сон"
          : "Вечером лучше недожать, чем перевозбудиться",
      summary:
        "Поздний movement-slot полезен только пока не мешает shutdown и не делает из тренировки ещё один стрессор.",
      detail: "Если день уже тяжёлый — mobility или короткий walk могут быть умнее, чем полноценная силовая.",
      points: [
        "Не растягивай вечернюю нагрузку хвостом до ночи.",
        "Оставь себе время на calm-down.",
        "Сон всё равно остаётся главным адаптационным рычагом.",
      ],
      tone: dayModeId === "damage-control" ? "rose" : "sky",
      icon: "🏋️",
    };
  }

  switch (dayModeId) {
    case "damage-control":
      return {
        id: "strength-base",
        badge: "силовая база",
        timingLabel: getTimingLabel(dayPart),
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
        timingLabel: getTimingLabel(dayPart),
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
        timingLabel: getTimingLabel(dayPart),
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
        timingLabel: getTimingLabel(dayPart),
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

function buildBaseStackNote(
  dayModeId: DayModeId | null | undefined,
  dayPart: SlotDayPart,
): CalendarSlotSupportNote {
  if (dayPart === "morning") {
    return {
      id: "base-stack",
      badge: "база",
      timingLabel: getTimingLabel(dayPart),
      title:
        dayModeId === "recovery"
          ? "Базу проще держать утром вместе с первой едой"
          : "Утро — лучший момент не забыть базу",
      summary:
        dayModeId === "recovery"
          ? "Если день мягкий, омега‑3, витамин D и креатин проще встроить в первую еду и потом не вспоминать о них в хаосе дня."
          : "Утренний health-slot хорош тем, что базу можно закрыть без лишних напоминаний и не тащить её хвостом до вечера.",
      detail: "База работает лучше как ритм, а не как реакция на провал в энергии.",
      points: [
        "Привяжи базу к первой нормальной еде.",
        "Не жди момента «когда станет хуже».",
        "Креатин — daily floor, а не emergency-ход.",
      ],
      tone: dayModeId === "damage-control" ? "amber" : dayModeId === "recovery" ? "violet" : "emerald",
      icon: "🫀",
    };
  }

  if (dayPart === "evening" || dayPart === "late-evening") {
    return {
      id: "base-stack",
      badge: "база",
      timingLabel: getTimingLabel(dayPart),
      title: "Вечером база уже не заменит recovery",
      summary:
        "Поздний health-slot — не повод верить, что добавки компенсируют украденный сон или хаос в еде.",
      detail: "Вечером база ок, но главная работа уже у shutdown и тишины.",
      points: [
        "Не лечи поздний разгон стеком.",
        "Если фон едет — выбирай сон, а не новые банки.",
        "Основа всё равно в еде, воде и отключении шума.",
      ],
      tone: dayModeId === "damage-control" ? "rose" : "emerald",
      icon: "🫀",
    };
  }

  switch (dayModeId) {
    case "damage-control":
      return {
        id: "base-stack",
        badge: "база",
        timingLabel: getTimingLabel(dayPart),
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
        timingLabel: getTimingLabel(dayPart),
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
        timingLabel: getTimingLabel(dayPart),
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
        timingLabel: getTimingLabel(dayPart),
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
  const dayPart = getSlotDayPart(slot);
  let note: CalendarSlotSupportNote | null = null;

  if (isHeavyLoadSlot(slot)) {
    note = buildHeavyLoadNote(dayModeId, dayPart);
  }

  if (!note && isRecoverySlot(slot)) {
    note = buildRecoveryNote(dayModeId, dayPart);
  }

  if (!note && isStrengthSlot(slot)) {
    note = buildStrengthNote(dayModeId, dayPart);
  }

  if (!note && isBaseStackSlot(slot)) {
    note = buildBaseStackNote(dayModeId, dayPart);
  }

  return note ? applySequenceContext(note, slot, context) : null;
}