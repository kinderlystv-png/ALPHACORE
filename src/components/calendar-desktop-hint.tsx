import { DESKTOP_SLOT_HINT_WIDTH, type DesktopSlotHintState } from "./calendar-grid-types";

export function CalendarDesktopHint({ hint }: { hint: DesktopSlotHintState }) {
  const toneClass = hint.tone === "rose"
    ? "border-rose-400/45 bg-rose-950/94 text-rose-50"
    : hint.tone === "amber"
      ? "border-amber-400/45 bg-amber-950/94 text-amber-50"
      : hint.tone === "emerald"
        ? "border-emerald-400/45 bg-emerald-950/94 text-emerald-50"
        : hint.tone === "violet"
          ? "border-violet-400/45 bg-violet-950/94 text-violet-50"
          : hint.tone === "sky"
            ? "border-sky-400/40 bg-zinc-950/94 text-zinc-50"
            : "border-zinc-700/80 bg-zinc-950/94 text-zinc-50";

  const eyebrowClass = hint.tone === "rose"
    ? "text-rose-200/90"
    : hint.tone === "amber"
      ? "text-amber-200/90"
      : hint.tone === "emerald"
        ? "text-emerald-200/90"
        : hint.tone === "violet"
          ? "text-violet-200/90"
          : hint.tone === "sky"
            ? "text-sky-300/90"
            : "text-zinc-400";

  const summaryClass = hint.tone === "rose"
    ? "text-rose-100/78"
    : hint.tone === "amber"
      ? "text-amber-100/78"
      : hint.tone === "emerald"
        ? "text-emerald-100/82"
        : hint.tone === "violet"
          ? "text-violet-100/82"
          : "text-zinc-200/80";

  const detailClass = hint.tone === "rose"
    ? "text-rose-200/78"
    : hint.tone === "amber"
      ? "text-amber-200/78"
      : hint.tone === "emerald"
        ? "text-emerald-200/78"
        : hint.tone === "violet"
          ? "text-violet-200/78"
          : hint.tone === "sky"
            ? "text-sky-200/78"
            : "text-zinc-400";

  return (
    <div
      className="pointer-events-none fixed z-40"
      style={{ left: hint.left, top: hint.top, width: DESKTOP_SLOT_HINT_WIDTH }}
    >
      <div className={`rounded-2xl border px-3 py-3 shadow-[0_18px_40px_rgba(0,0,0,0.35)] backdrop-blur ${toneClass}`}>
        <div className="flex items-start gap-2">
          {hint.icon && (
            <span className="mt-0.5 text-base" aria-hidden="true">
              {hint.icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className={`text-[10px] font-medium uppercase tracking-[0.16em] ${eyebrowClass}`}>
              {hint.eyebrow}
            </p>
            <p className="mt-1 text-[13px] font-semibold leading-5">
              {hint.title}
            </p>
          </div>
        </div>
        <p className={`mt-1 text-[11px] leading-5 ${summaryClass}`}>
          {hint.summary}
        </p>
        {hint.points && hint.points.length > 0 && (
          <ul className={`mt-2 space-y-1 text-[10px] leading-4 ${detailClass}`}>
            {hint.points.map((point) => (
              <li key={point} className="flex items-start gap-2">
                <span className="mt-0.5 text-[8px]">●</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        )}
        {hint.detail && (
          <p className={`mt-2 text-[10px] leading-4 ${detailClass}`}>
            {hint.detail}
          </p>
        )}
      </div>
    </div>
  );
}
