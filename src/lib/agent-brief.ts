/**
 * Agent morning brief and evening review generators.
 *
 * Produces human-readable text summaries from an AgentControlSnapshot,
 * suitable for CLI output and agent consumption.
 */

import type { AgentControlSnapshot } from "./agent-control";

function todayLabel(): string {
  const d = new Date();
  const days = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
  const months = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
  ];
  return `${d.getDate()} ${months[d.getMonth()]}, ${days[d.getDay()]}`;
}

export function generateMorningBrief(snapshot: AgentControlSnapshot): string {
  const lines: string[] = [];

  lines.push(`☀️ Утренний брифинг — ${todayLabel()}`);
  lines.push(`Баланс: ${snapshot.balanceScore}/100`);
  lines.push("");
  lines.push(snapshot.modeStatement);
  lines.push("");

  // Critical / watch areas
  const critical = snapshot.areas.filter((a) => a.level === "critical");
  const watch = snapshot.areas.filter((a) => a.level === "watch");

  if (critical.length > 0) {
    lines.push("🔴 Требуют внимания:");
    for (const a of critical) {
      lines.push(`  ${a.emoji} ${a.label} (${a.score}) — ${a.insight}`);
    }
    lines.push("");
  }

  if (watch.length > 0) {
    lines.push("🟡 На контроле:");
    for (const a of watch) {
      lines.push(`  ${a.emoji} ${a.label} (${a.score}) — ${a.summary}`);
    }
    lines.push("");
  }

  // Top priorities as action items
  if (snapshot.priorities.length > 0) {
    lines.push("📌 Фокус на сегодня:");
    for (let i = 0; i < snapshot.priorities.length; i++) {
      const p = snapshot.priorities[i]!;
      lines.push(`  ${i + 1}. ${p.title}`);
      lines.push(`     → ${p.action}`);
    }
    lines.push("");
  }

  lines.push(snapshot.narrative);

  return lines.join("\n");
}

export function generateEveningReview(snapshot: AgentControlSnapshot): string {
  const lines: string[] = [];

  lines.push(`🌙 Вечерний review — ${todayLabel()}`);
  lines.push(`Баланс: ${snapshot.balanceScore}/100`);
  lines.push("");

  // All areas with scores
  lines.push("Состояние зон:");
  for (const a of snapshot.areas) {
    const icon = a.level === "critical" ? "🔴" : a.level === "watch" ? "🟡" : "🟢";
    const bar = "█".repeat(Math.round(a.score / 10)) + "░".repeat(10 - Math.round(a.score / 10));
    lines.push(`  ${icon} ${a.emoji} ${a.label.padEnd(14)} ${bar} ${a.score}`);
    lines.push(`     ${a.summary}`);
  }
  lines.push("");

  // What moved today (insights)
  const movedAreas = snapshot.areas.filter(
    (a) => a.level !== "good" && a.evidence.length > 0,
  );
  if (movedAreas.length > 0) {
    lines.push("Что заметил:");
    for (const a of movedAreas) {
      for (const e of a.evidence) {
        lines.push(`  • ${e}`);
      }
    }
    lines.push("");
  }

  // Tomorrow's carry-over priorities
  if (snapshot.priorities.length > 0) {
    lines.push("На завтра:");
    for (const p of snapshot.priorities) {
      const icon = p.level === "critical" ? "🔴" : p.level === "watch" ? "🟡" : "🟢";
      lines.push(`  ${icon} ${p.title} — ${p.reason}`);
    }
    lines.push("");
  }

  lines.push(snapshot.narrative);

  return lines.join("\n");
}
