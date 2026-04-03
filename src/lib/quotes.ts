const QUOTES = [
  { text: "Фокус — это искусство знать, что игнорировать.", author: "Джеймс Клир" },
  { text: "Не планируй день — планируй энергию.", author: "Cal Newport" },
  { text: "Делай трудное утром. Лёгкое вечером.", author: "Mark Twain" },
  { text: "Система лучше мотивации. Привычка лучше системы.", author: "Джеймс Клир" },
  { text: "1% улучшение каждый день = 37× за год.", author: "Atomic Habits" },
  { text: "Лучшее время начать — прошлый год. Второе лучшее — сейчас.", author: "" },
  { text: "Не путай занятость с продуктивностью.", author: "Tim Ferriss" },
  { text: "Два самых продуктивных дня: сегодня и завтра.", author: "" },
  { text: "Идеальный план не нужен. Нужен первый шаг.", author: "" },
  { text: "Protect your deep work like a meeting with CEO.", author: "Cal Newport" },
  { text: "Среда — день барабанов. Не планируй ничего критичного 🥁", author: "ALPHACORE" },
  { text: "Weekly review — момент, когда хаос превращается в план.", author: "" },
  { text: "Сон — первый приоритет. Без него всё остальное деградирует.", author: "" },
  { text: "Стрик не цель. Стрик — побочный эффект системы.", author: "" },
];

export function dailyQuote(): { text: string; author: string } {
  const day = Math.floor(Date.now() / 86_400_000);
  return QUOTES[day % QUOTES.length];
}
