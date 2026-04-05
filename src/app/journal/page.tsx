"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import {
  addJournalEntry,
  deleteJournalEntry,
  ensureJournalSeed,
  type JournalAuthor,
  type JournalEntry,
} from "@/lib/journal";
import { subscribeAppDataChange } from "@/lib/storage";

const AUTHOR_META: Record<
  JournalAuthor,
  {
    label: string;
    bubble: string;
    align: string;
    border: string;
  }
> = {
  user: {
    label: "Ты",
    bubble: "bg-emerald-500/12 text-emerald-50",
    align: "ml-auto",
    border: "border-emerald-500/20",
  },
  assistant: {
    label: "Copilot",
    bubble: "bg-sky-500/12 text-sky-50",
    align: "mr-auto",
    border: "border-sky-500/20",
  },
};

function groupByDay(entries: JournalEntry[]): Array<{
  day: string;
  items: JournalEntry[];
}> {
  const groups = new Map<string, JournalEntry[]>();

  for (const entry of entries) {
    const day = new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      weekday: "long",
    }).format(new Date(entry.createdAt));
    groups.set(day, [...(groups.get(day) ?? []), entry]);
  }

  return Array.from(groups.entries()).map(([day, items]) => ({ day, items }));
}

function JournalPageContent() {
  const searchParams = useSearchParams();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [author, setAuthor] = useState<JournalAuthor>("user");
  const [text, setText] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [visibleDays, setVisibleDays] = useState(7);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const openId = searchParams.get("open");

  const reload = useCallback(() => setEntries(ensureJournalSeed()), []);

  useEffect(() => {
    reload();
    return subscribeAppDataChange((keys) => {
      if (keys.includes("alphacore_journal")) reload();
    });
  }, [reload]);

  const grouped = useMemo(() => groupByDay(entries), [entries]);

  const handleAdd = useCallback(() => {
    if (!text.trim()) return;

    addJournalEntry(
      author,
      text,
      tagInput
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    );

    setText("");
    setTagInput("");
    setAuthor("user");
    reload();
    textareaRef.current?.focus();
  }, [author, reload, tagInput, text]);

  return (
    <AppShell>
      <div className="space-y-5 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">💬 Дневник</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Диалоговый лог с датой, временем и тегами — как рабочий мессенджер для головы.
            </p>
          </div>
          <span className="rounded-full border border-zinc-800 px-3 py-1 text-[10px] uppercase tracking-widest text-zinc-500">
            {entries.length} записей
          </span>
        </div>

        <section className="rounded-[2rem] border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex flex-wrap gap-2">
            {(["user", "assistant"] as const).map((candidate) => (
              <button
                key={candidate}
                type="button"
                onClick={() => setAuthor(candidate)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  author === candidate
                    ? candidate === "user"
                      ? "bg-emerald-500 text-zinc-950"
                      : "bg-sky-500 text-zinc-950"
                    : "border border-zinc-800 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {AUTHOR_META[candidate].label}
              </button>
            ))}
          </div>

          <div className="mt-3 space-y-3">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={3}
              placeholder="Что важно зафиксировать прямо сейчас?"
              className="w-full resize-none rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-700"
            />
            <input
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              placeholder="Теги через запятую: studio, cleanup, focus"
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-700"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-zinc-500">
                Быстрый формат: мысль → контекст → теги. Без бюрократии, без боли, почти без экзистенциального кризиса.
              </p>
              <button
                type="button"
                onClick={handleAdd}
                disabled={!text.trim()}
                className="rounded-xl bg-zinc-50 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Добавить запись
              </button>
            </div>
          </div>
        </section>

        <section className="space-y-5">
          {grouped.slice(0, visibleDays).map((group) => (
            <div key={group.day} className="space-y-3">
              <div className="sticky top-2 z-10 inline-flex rounded-full border border-zinc-800 bg-zinc-950/90 px-3 py-1 text-[11px] capitalize tracking-wide text-zinc-500 backdrop-blur">
                {group.day}
              </div>

              <div className="space-y-3">
                {group.items.map((entry) => {
                  const meta = AUTHOR_META[entry.author];
                  const time = new Intl.DateTimeFormat("ru-RU", {
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(entry.createdAt));

                  return (
                    <article
                      key={entry.id}
                      className={`max-w-[48rem] rounded-[1.75rem] border p-4 shadow-xl shadow-black/10 ${meta.align} ${meta.bubble} ${meta.border} ${
                        openId === entry.id ? "ring-1 ring-amber-400/60" : ""
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-white/70">
                            {meta.label}
                          </span>
                          <span className="text-[11px] text-white/50">{time}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (!confirm("Удалить запись из дневника?")) return;
                            deleteJournalEntry(entry.id);
                            reload();
                          }}
                          className="text-[11px] text-white/45 transition hover:text-rose-300"
                        >
                          Удалить
                        </button>
                      </div>

                      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-white/90">
                        {entry.text}
                      </p>

                      {entry.tags.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {entry.tags.map((tag) => (
                            <span
                              key={`${entry.id}-${tag}`}
                              className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/60"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          ))}

          {grouped.length > visibleDays && (
            <button
              type="button"
              onClick={() => setVisibleDays((v) => v + 7)}
              className="mx-auto block rounded-xl border border-zinc-800 px-5 py-2.5 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
            >
              Показать ещё {Math.min(7, grouped.length - visibleDays)} дн.
            </button>
          )}
        </section>
      </div>
    </AppShell>
  );
}

export default function JournalPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <div className="py-8 text-sm text-zinc-600">Загрузка дневника…</div>
        </AppShell>
      }
    >
      <JournalPageContent />
    </Suspense>
  );
}
