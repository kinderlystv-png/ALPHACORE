"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getJournalEntries } from "@/lib/journal";
import { getEntries, CATEGORY_LABELS } from "@/lib/medical";
import { getNotes } from "@/lib/notes";
import { getProjects, PROJECT_KIND_LABEL, PROJECT_LIFE_AREA_LABEL } from "@/lib/projects";
import { subscribeAppDataChange } from "@/lib/storage";
import { getTasks } from "@/lib/tasks";

type Result = {
  type: "task" | "note" | "page" | "project" | "medical" | "journal";
  id: string;
  title: string;
  subtitle?: string;
  href: string;
};

const PAGES: Result[] = [
  { type: "page", id: "home", title: "🏠 Главная", href: "/" },
  { type: "page", id: "tasks", title: "📥 Задачи", href: "/tasks" },
  { type: "page", id: "calendar", title: "📅 Календарь", href: "/calendar" },
  { type: "page", id: "projects", title: "📁 Группы", href: "/projects" },
  { type: "page", id: "journal", title: "💬 Дневник", href: "/journal" },
  { type: "page", id: "notes", title: "📝 Заметки", href: "/notes" },
  { type: "page", id: "routines", title: "🔔 Ритм", href: "/routines" },
  { type: "page", id: "medical", title: "🏥 Анализы", href: "/medical" },
  { type: "page", id: "settings", title: "⚙️ Настройки", href: "/settings" },
];

function search(q: string): Result[] {
  const lc = q.toLowerCase();
  if (!lc) return PAGES;

  const results: Result[] = [];

  // Pages
  results.push(...PAGES.filter((p) => p.title.toLowerCase().includes(lc)));

  // Tasks
  const tasks = getTasks();
  tasks
    .filter((t) => t.title.toLowerCase().includes(lc))
    .slice(0, 5)
    .forEach((t) =>
      results.push({
        type: "task",
        id: t.id,
        title: t.title,
        subtitle: `${t.priority.toUpperCase()} · ${t.status}`,
        href: "/tasks",
      }),
    );

  // Notes
  const notes = getNotes();
  notes
    .filter(
      (n) =>
        n.title.toLowerCase().includes(lc) ||
        n.body.toLowerCase().includes(lc),
    )
    .slice(0, 5)
    .forEach((n) =>
      results.push({
        type: "note",
        id: n.id,
        title: n.title,
        subtitle: n.body.slice(0, 60),
        href: "/notes",
      }),
    );

  // Projects
  const projects = getProjects();
  projects
    .filter(
      (p) =>
        p.name.toLowerCase().includes(lc) ||
        p.description.toLowerCase().includes(lc) ||
        p.nextStep.toLowerCase().includes(lc) ||
        p.kpis.some(
          (k) =>
            k.label.toLowerCase().includes(lc) ||
            k.value.toLowerCase().includes(lc),
        ) ||
        p.deliverables.some((d) => d.text.toLowerCase().includes(lc)),
    )
    .slice(0, 5)
    .forEach((p) =>
      results.push({
        type: "project",
        id: p.id,
        title: p.name,
        subtitle: [
          PROJECT_KIND_LABEL[p.kind],
          PROJECT_LIFE_AREA_LABEL[p.lifeArea],
          p.nextStep || p.description,
        ]
          .filter(Boolean)
          .join(" · "),
        href: `/projects?open=${p.id}`,
      }),
    );

  // Medical
  const entries = getEntries();
  entries
    .filter(
      (entry) =>
        entry.name.toLowerCase().includes(lc) ||
        entry.notes.toLowerCase().includes(lc) ||
        CATEGORY_LABELS[entry.category].toLowerCase().includes(lc) ||
        entry.params.some((param) => param.name.toLowerCase().includes(lc)),
    )
    .slice(0, 5)
    .forEach((entry) =>
      results.push({
        type: "medical",
        id: entry.id,
        title: entry.name,
        subtitle: `${CATEGORY_LABELS[entry.category]} · ${new Date(entry.date).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}`,
        href: `/medical?open=${entry.id}`,
      }),
    );

  // Journal
  const journalEntries = getJournalEntries();
  journalEntries
    .filter(
      (entry) =>
        entry.text.toLowerCase().includes(lc) ||
        entry.tags.some((tag) => tag.toLowerCase().includes(lc)),
    )
    .slice(0, 5)
    .forEach((entry) =>
      results.push({
        type: "journal",
        id: entry.id,
        title: entry.text.slice(0, 72),
        subtitle: `${entry.author === "user" ? "Ты" : "Copilot"} · ${entry.tags.map((tag) => `#${tag}`).join(" ")}`,
        href: `/journal?open=${entry.id}`,
      }),
    );

  return results;
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [idx, setIdx] = useState(0);
  const [version, setVersion] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Debounce search query (150ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 150);
    return () => clearTimeout(timer);
  }, [query]);

  const results = useMemo(() => search(debouncedQuery), [debouncedQuery, version]);

  // Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    return subscribeAppDataChange((keys) => {
      if (
        keys.some((key) =>
          [
            "alphacore_tasks",
            "alphacore_notes",
            "alphacore_projects",
            "alphacore_medical",
            "alphacore_journal",
          ].includes(key),
        )
      ) {
        setVersion((value) => value + 1);
      }
    });
  }, []);

  const go = useCallback(
    (r: Result) => {
      setOpen(false);
      router.push(r.href);
    },
    [router],
  );

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIdx((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && results[idx]) {
        go(results[idx]);
      }
    },
    [results, idx, go],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
        aria-label="Закрыть поиск"
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/50">
        {/* Input */}
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
          <span className="text-zinc-500">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIdx(0);
            }}
            onKeyDown={onKey}
            placeholder="Поиск задач, заметок, групп, анализов, дневника…"
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 outline-none"
          />
          <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-64 overflow-y-auto p-2">
          {results.length === 0 && (
            <p className="py-6 text-center text-sm text-zinc-600">
              Ничего не найдено
            </p>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.type}-${r.id}`}
              type="button"
              onClick={() => go(r)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                i === idx
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-zinc-600 w-12">
                {r.type === "task"
                  ? "задача"
                  : r.type === "note"
                    ? "заметк"
                    : r.type === "project"
                      ? "группа"
                      : r.type === "medical"
                        ? "анализ"
                          : r.type === "journal"
                            ? "дневн."
                        : "стр."}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate">{r.title}</p>
                {r.subtitle && (
                  <p className="truncate text-xs text-zinc-600">{r.subtitle}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
