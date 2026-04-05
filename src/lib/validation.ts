/* ── Input validation helpers for ALPHACORE ── */

const MAX_TITLE_LENGTH = 500;
const MAX_BODY_LENGTH = 10_000;
const MAX_TAG_LENGTH = 50;
const MAX_TAGS_COUNT = 20;
const MAX_ENTRY_TEXT_LENGTH = 10_000;

export function sanitizeText(text: string, maxLength: number): string {
  return text.slice(0, maxLength).trim();
}

export function validateTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) throw new Error("Title cannot be empty");
  return sanitizeText(trimmed, MAX_TITLE_LENGTH);
}

export function validateBody(body: string): string {
  return sanitizeText(body, MAX_BODY_LENGTH);
}

export function validateEntryText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new Error("Entry text cannot be empty");
  return sanitizeText(trimmed, MAX_ENTRY_TEXT_LENGTH);
}

export function validateTags(tags: string[]): string[] {
  return tags
    .map((tag) => tag.trim().toLowerCase().slice(0, MAX_TAG_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_TAGS_COUNT);
}

export function validateDate(dateStr: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid date format: ${dateStr}. Expected YYYY-MM-DD`);
  }
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${dateStr}`);
  }
  return dateStr;
}

export function validateTime(timeStr: string): string {
  if (!/^\d{1,2}:\d{2}$/.test(timeStr)) {
    throw new Error(`Invalid time format: ${timeStr}. Expected HH:MM`);
  }
  const [h, m] = timeStr.split(":").map(Number);
  if (h! < 0 || h! > 23 || m! < 0 || m! > 59) {
    throw new Error(`Invalid time: ${timeStr}`);
  }
  return timeStr.padStart(5, "0");
}

export function validatePriority(p: string): "p1" | "p2" | "p3" {
  if (p === "p1" || p === "p2" || p === "p3") return p;
  throw new Error(`Invalid priority: ${p}. Use p1, p2, or p3`);
}

/** Max payload size in bytes (10 MB) */
export const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;

export function checkPayloadSize(body: string): void {
  const size = new TextEncoder().encode(body).length;
  if (size > MAX_PAYLOAD_BYTES) {
    throw new Error(`Payload too large: ${Math.round(size / 1024 / 1024)}MB exceeds ${MAX_PAYLOAD_BYTES / 1024 / 1024}MB limit`);
  }
}
