"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Note,
  addNote,
  deleteNote,
  getNotes,
  togglePin,
  updateNote,
} from "@/lib/notes";
import { AppShell } from "@/components/app-shell";
import { subscribeAppDataChange } from "@/lib/storage";

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [search, setSearch] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => setNotes(getNotes()), []);

  useEffect(() => {
    reload();
    return subscribeAppDataChange((keys) => {
      if (keys.includes("alphacore_notes")) reload();
    });
  }, [reload]);

  const handleSave = useCallback(() => {
    const t = title.trim();
    if (!t) return;
    if (editId) {
      updateNote(editId, { title: t, body });
      setEditId(null);
    } else {
      addNote(t, body);
    }
    setTitle("");
    setBody("");
    reload();
  }, [title, body, editId, reload]);

  const startEdit = useCallback((n: Note) => {
    setEditId(n.id);
    setTitle(n.title);
    setBody(n.body);
    setTimeout(() => titleRef.current?.focus(), 50);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditId(null);
    setTitle("");
    setBody("");
  }, []);

  const handlePin = useCallback(
    (id: string) => {
      togglePin(id);
      reload();
    },
    [reload],
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteNote(id);
      if (editId === id) cancelEdit();
      reload();
    },
    [editId, cancelEdit, reload],
  );

  const lc = search.toLowerCase();
  const filtered = notes
    .filter(
      (n) =>
        !search ||
        n.title.toLowerCase().includes(lc) ||
        n.body.toLowerCase().includes(lc),
    )
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

  return (
    <AppShell>
      <div className="space-y-5 py-2">
        <h1 className="text-2xl font-bold">📝 Заметки</h1>

        {/* Editor */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Заголовок"
            className="w-full bg-transparent text-sm font-semibold text-zinc-100 placeholder:text-zinc-600 outline-none"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Текст заметки…"
            rows={4}
            className="w-full resize-none bg-transparent text-sm text-zinc-300 placeholder:text-zinc-600 outline-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={!title.trim()}
              className="rounded-lg bg-zinc-50 px-4 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:opacity-40"
            >
              {editId ? "Сохранить" : "Добавить"}
            </button>
            {editId && (
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-xs text-zinc-400 hover:text-zinc-200 transition"
              >
                Отмена
              </button>
            )}
          </div>
        </div>

        {/* Search */}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по заметкам…"
          className="w-full rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-600"
        />

        {/* Notes list */}
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.length === 0 && (
            <p className="col-span-full py-8 text-center text-sm text-zinc-600">
              {search ? "Ничего не найдено" : "Нет заметок"}
            </p>
          )}
          {filtered.map((n) => (
            <article
              key={n.id}
              className={`group rounded-xl border p-4 transition ${
                n.pinned
                  ? "border-amber-500/20 bg-amber-950/10"
                  : "border-zinc-800/60 bg-zinc-900/30"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(n)}
                  className="text-left flex-1 min-w-0"
                >
                  <h3 className="text-sm font-semibold text-zinc-100 truncate">
                    {n.pinned && "📌 "}{n.title}
                  </h3>
                  {n.body && (
                    <p className="mt-1.5 text-xs text-zinc-400 line-clamp-3 whitespace-pre-wrap">
                      {n.body}
                    </p>
                  )}
                </button>
                <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100 transition">
                  <button
                    type="button"
                    onClick={() => handlePin(n.id)}
                    className="rounded-lg px-1.5 py-1 text-xs text-amber-400 hover:bg-amber-500/10 transition"
                    title={n.pinned ? "Открепить" : "Закрепить"}
                  >
                    📌
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(n.id)}
                    className="rounded-lg px-1.5 py-1 text-xs text-rose-400 hover:bg-rose-500/10 transition"
                    title="Удалить"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <p className="mt-2 text-[10px] text-zinc-600">
                {new Date(n.updatedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </p>
            </article>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
