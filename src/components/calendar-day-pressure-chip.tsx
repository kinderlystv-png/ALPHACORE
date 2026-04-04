import type { CalendarDayPressure } from "@/lib/calendar-day-pressure";

type CalendarDayPressureChipProps = {
  pressure: CalendarDayPressure;
  variant?: "pill" | "compact" | "full";
  className?: string;
};

const TONE_STYLES = {
  sky: {
    badge: "border-sky-400/25 bg-sky-500/10 text-sky-200",
    surface: "border-sky-500/20 bg-sky-950/10",
    summary: "text-sky-100",
    detail: "text-sky-200/78",
  },
  violet: {
    badge: "border-violet-400/25 bg-violet-500/10 text-violet-200",
    surface: "border-violet-500/20 bg-violet-950/10",
    summary: "text-violet-100",
    detail: "text-violet-200/78",
  },
  amber: {
    badge: "border-amber-400/25 bg-amber-500/10 text-amber-200",
    surface: "border-amber-500/20 bg-amber-950/10",
    summary: "text-amber-100",
    detail: "text-amber-200/78",
  },
  rose: {
    badge: "border-rose-400/25 bg-rose-500/10 text-rose-200",
    surface: "border-rose-500/20 bg-rose-950/10",
    summary: "text-rose-100",
    detail: "text-rose-200/78",
  },
  zinc: {
    badge: "border-zinc-700 bg-zinc-900/80 text-zinc-300",
    surface: "border-zinc-800/70 bg-zinc-900/50",
    summary: "text-zinc-100",
    detail: "text-zinc-400",
  },
} as const;

export function CalendarDayPressureChip({
  pressure,
  variant = "compact",
  className,
}: CalendarDayPressureChipProps) {
  const styles = TONE_STYLES[pressure.tone];
  const wrapperClassName = className ? className : "";
  const title = `${pressure.summary}. ${pressure.detail}`;

  if (variant === "pill") {
    return (
      <span
        title={title}
        className={`${wrapperClassName} inline-flex max-w-full truncate rounded-full border px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.16em] ${styles.badge}`}
      >
        {pressure.badge}
      </span>
    );
  }

  if (variant === "full") {
    return (
      <div className={`${wrapperClassName} rounded-2xl border px-3 py-2 ${styles.surface}`}>
        <span
          title={title}
          className={`inline-flex max-w-full truncate rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] ${styles.badge}`}
        >
          {pressure.badge}
        </span>
        <p className={`mt-2 text-sm font-semibold ${styles.summary}`}>{pressure.summary}</p>
        <p className={`mt-1 text-xs leading-5 ${styles.detail}`}>{pressure.detail}</p>
      </div>
    );
  }

  return (
    <div className={`${wrapperClassName} space-y-1`}>
      <span
        title={title}
        className={`inline-flex max-w-full truncate rounded-full border px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.16em] ${styles.badge}`}
      >
        {pressure.badge}
      </span>
      <p className={`text-[10px] leading-4 ${styles.detail}`}>{pressure.summary}</p>
    </div>
  );
}
