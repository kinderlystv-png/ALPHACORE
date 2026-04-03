"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  type MedCategory,
  type MedEntry,
  type MedParam,
  getEntries,
  addEntry,
  deleteEntry,
  updateEntry,
  paramStatus,
  paramHistory,
  allParamNames,
  CATEGORY_LABELS,
  CATEGORY_ICONS,
  BLOOD_PRESETS,
} from "@/lib/medical";
import { subscribeAppDataChange } from "@/lib/storage";

/* ── Status colors ── */

const STATUS_COLORS = {
  low: "text-sky-400",
  normal: "text-emerald-400",
  high: "text-rose-400",
  unknown: "text-zinc-400",
} as const;

const STATUS_BG = {
  low: "bg-sky-400/10 border-sky-400/20",
  normal: "bg-emerald-400/10 border-emerald-400/20",
  high: "bg-rose-400/10 border-rose-400/20",
  unknown: "bg-zinc-800 border-zinc-700",
} as const;

const STATUS_LABELS = {
  low: "↓ ниже нормы",
  normal: "✓ норма",
  high: "↑ выше нормы",
  unknown: "—",
} as const;

/* ── Mini sparkline for parameter trend ── */

function Sparkline({ paramName }: { paramName: string }) {
  const points = paramHistory(paramName);
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 80;
  const h = 24;
  const step = w / (values.length - 1);
  const coords = values.map(
    (v, i) => `${i * step},${h - ((v - min) / range) * (h - 4) - 2}`,
  );
  const last = values[values.length - 1];
  const prev = values[values.length - 2];
  const trend = last > prev ? "text-rose-400" : last < prev ? "text-sky-400" : "text-zinc-500";

  return (
    <div className="flex items-center gap-1.5">
      <svg
        width={w}
        height={h}
        className="overflow-visible"
        viewBox={`0 0 ${w} ${h}`}
      >
        <polyline
          points={coords.join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-zinc-500"
        />
        {/* last dot */}
        {coords.length > 0 && (
          <circle
            cx={coords[coords.length - 1].split(",")[0]}
            cy={coords[coords.length - 1].split(",")[1]}
            r="2.5"
            className={`fill-current ${trend}`}
          />
        )}
        {/* ref range band */}
        {points[0].refMin != null && points[0].refMax != null && (
          <rect
            x="0"
            y={h - ((points[0].refMax! - min) / range) * (h - 4) - 2}
            width={w}
            height={Math.max(
              1,
              ((points[0].refMax! - points[0].refMin!) / range) * (h - 4),
            )}
            className="fill-emerald-500/10"
            rx="2"
          />
        )}
      </svg>
      <span className={`text-[10px] font-medium ${trend}`}>
        {last > prev ? "↑" : last < prev ? "↓" : "="}
      </span>
    </div>
  );
}

/* ── Tabs ── */

type Tab = "all" | MedCategory | "trends";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "all", label: "Все", icon: "📋" },
  { id: "blood", label: "Кровь", icon: "🩸" },
  { id: "ultrasound", label: "УЗИ", icon: "📡" },
  { id: "other", label: "Другое", icon: "🔬" },
  { id: "trends", label: "Тренды", icon: "📈" },
];

/* ── Add entry form ── */

function AddEntryForm({
  initialEntry,
  onAdd,
  onCancel,
}: {
  initialEntry?: MedEntry;
  onAdd: () => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(
    initialEntry?.date ?? new Date().toISOString().slice(0, 10),
  );
  const [category, setCategory] = useState<MedCategory>(initialEntry?.category ?? "blood");
  const [name, setName] = useState(initialEntry?.name ?? "");
  const [notes, setNotes] = useState(initialEntry?.notes ?? "");
  const [params, setParams] = useState<MedParam[]>(initialEntry?.params ?? []);
  const isEdit = Boolean(initialEntry);

  const addParam = useCallback(() => {
    setParams((prev) => [
      ...prev,
      { name: "", value: 0, unit: "", refMin: undefined, refMax: undefined },
    ]);
  }, []);

  const updateParam = useCallback(
    (idx: number, patch: Partial<MedParam>) => {
      setParams((prev) =>
        prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
      );
    },
    [],
  );

  const removeParam = useCallback((idx: number) => {
    setParams((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const applyPreset = useCallback(
    (preset: (typeof BLOOD_PRESETS)[number]) => {
      setParams((prev) => [
        ...prev,
        {
          name: preset.name,
          value: 0,
          unit: preset.unit,
          refMin: preset.refMin,
          refMax: preset.refMax,
        },
      ]);
    },
    [],
  );

  const handleSubmit = useCallback(() => {
    if (!name.trim() || !date) return;
    const validParams = params.filter((p) => p.name.trim());
    if (initialEntry) {
      updateEntry(initialEntry.id, {
        date,
        category,
        name: name.trim(),
        params: validParams,
        notes: notes.trim(),
      });
    } else {
      addEntry(date, category, name.trim(), validParams, notes.trim());
    }
    onAdd();
  }, [category, date, initialEntry, name, notes, onAdd, params]);

  return (
    <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
      <h3 className="text-sm font-semibold">
        {isEdit ? "Редактировать запись" : "Новая запись"}
      </h3>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Дата</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 [color-scheme:dark]"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Категория</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as MedCategory)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
          >
            <option value="blood">🩸 Кровь</option>
            <option value="ultrasound">📡 УЗИ</option>
            <option value="other">🔬 Другое</option>
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs text-zinc-500">Название</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Общий анализ крови, УЗИ щитовидной..."
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
        />
      </div>

      {/* Parameters */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-400">Параметры</span>
          <button
            type="button"
            onClick={addParam}
            className="text-xs text-sky-400 hover:text-sky-300"
          >
            + Добавить
          </button>
        </div>

        {category === "blood" && params.length === 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-zinc-600">Быстрые пресеты:</p>
            <div className="flex flex-wrap gap-1">
              {BLOOD_PRESETS.map((pr) => (
                <button
                  key={pr.name}
                  type="button"
                  onClick={() => applyPreset(pr)}
                  className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
                >
                  {pr.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {params.map((p, idx) => (
          <div
            key={idx}
            className="rounded-lg border border-zinc-800 bg-zinc-900 p-2.5"
          >
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={p.name}
                onChange={(e) => updateParam(idx, { name: e.target.value })}
                placeholder="Название"
                className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600"
              />
              <button
                type="button"
                onClick={() => removeParam(idx)}
                className="rounded border border-zinc-700 px-2 py-1 text-zinc-600 transition hover:border-rose-500/30 hover:text-rose-400"
              >
                ✕
              </button>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <input
                type="number"
                value={p.value || ""}
                onChange={(e) =>
                  updateParam(idx, { value: parseFloat(e.target.value) || 0 })
                }
                placeholder="Значение"
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600"
              />
              <input
                type="text"
                value={p.unit}
                onChange={(e) => updateParam(idx, { unit: e.target.value })}
                placeholder="Ед."
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600"
              />
              <input
                type="number"
                value={p.refMin ?? ""}
                onChange={(e) =>
                  updateParam(idx, {
                    refMin: e.target.value ? parseFloat(e.target.value) : undefined,
                  })
                }
                placeholder="Min"
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600"
              />
              <input
                type="number"
                value={p.refMax ?? ""}
                onChange={(e) =>
                  updateParam(idx, {
                    refMax: e.target.value ? parseFloat(e.target.value) : undefined,
                  })
                }
                placeholder="Max"
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600"
              />
            </div>
          </div>
        ))}
      </div>

      <div>
        <label className="mb-1 block text-xs text-zinc-500">Заметки</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Комментарий врача, рекомендации..."
          rows={2}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!name.trim()}
          className="rounded-xl bg-teal-500 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-teal-400 disabled:opacity-40"
        >
          {isEdit ? "Сохранить изменения" : "Сохранить"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-400 transition hover:border-zinc-600"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}

/* ── Entry card ── */

function EntryCard({
  entry,
  onEdit,
  onDelete,
  forceOpen = false,
}: {
  entry: MedEntry;
  onEdit: () => void;
  onDelete: () => void;
  forceOpen?: boolean;
}) {
  const [expanded, setExpanded] = useState(forceOpen);
  const d = new Date(entry.date);
  const dateStr = d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  useEffect(() => {
    if (forceOpen) setExpanded(true);
  }, [forceOpen]);

  const outOfRange = entry.params.filter((p) => {
    const s = paramStatus(p);
    return s === "low" || s === "high";
  }).length;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 transition hover:border-zinc-700">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-xl">
            {CATEGORY_ICONS[entry.category]}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-100">{entry.name}</p>
            <p className="text-xs text-zinc-500">
              {dateStr} · {CATEGORY_LABELS[entry.category]}
              {entry.params.length > 0 && (
                <span> · {entry.params.length} пар.</span>
              )}
              {outOfRange > 0 && (
                <span className="ml-1 text-rose-400">
                  · {outOfRange} вне нормы
                </span>
              )}
            </p>
          </div>
        </div>
        <span
          className={`text-zinc-500 transition ${expanded ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="mt-3 space-y-3 border-t border-zinc-800 pt-3">
          {entry.params.length > 0 && (
            <div className="space-y-1.5">
              {entry.params.map((p, i) => {
                const status = paramStatus(p);
                return (
                  <div
                    key={i}
                    className={`rounded-lg border px-3 py-2 ${STATUS_BG[status]}`}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-xs text-zinc-300">{p.name}</span>
                        <Sparkline paramName={p.name} />
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`text-sm font-semibold ${STATUS_COLORS[status]}`}
                        >
                          {p.value}
                        </span>
                        <span className="text-xs text-zinc-500">{p.unit}</span>
                        {(p.refMin != null || p.refMax != null) && (
                          <span className="text-[10px] text-zinc-600">
                            ({p.refMin ?? ""}–{p.refMax ?? ""})
                          </span>
                        )}
                        <span
                          className={`text-[10px] ${STATUS_COLORS[status]}`}
                        >
                          {STATUS_LABELS[status]}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {entry.notes && (
            <p className="text-xs leading-relaxed text-zinc-400">
              {entry.notes}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="text-xs text-sky-400 transition hover:text-sky-300"
            >
              Редактировать
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm("Удалить запись?")) onDelete();
              }}
              className="text-xs text-zinc-600 transition hover:text-rose-400"
            >
              Удалить запись
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Trends view ── */

function TrendsView() {
  const names = allParamNames();

  if (names.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-zinc-600">
        Добавьте анализы с параметрами, чтобы увидеть тренды
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {names.map((name) => {
        const points = paramHistory(name);
        if (points.length < 1) return null;
        const last = points[points.length - 1];
        const status =
          last.refMin != null && last.value < last.refMin
            ? "low"
            : last.refMax != null && last.value > last.refMax
              ? "high"
              : last.refMin != null || last.refMax != null
                ? "normal"
                : "unknown";
        return (
          <div
            key={name}
            className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="text-sm font-medium text-zinc-200">{name}</p>
              <p className="text-xs text-zinc-500">
                {points.length} измерений · последнее:{" "}
                <span className={`font-medium ${STATUS_COLORS[status]}`}>
                  {last.value}
                </span>
                {last.refMin != null && last.refMax != null && (
                  <span className="text-zinc-600">
                    {" "}
                    (норма {last.refMin}–{last.refMax})
                  </span>
                )}
              </p>
            </div>
            <Sparkline paramName={name} />
          </div>
        );
      })}
    </div>
  );
}

/* ── Main page ── */

function MedicalPageContent() {
  const searchParams = useSearchParams();
  const [entries, setEntries] = useState<MedEntry[]>([]);
  const [tab, setTab] = useState<Tab>("all");
  const [adding, setAdding] = useState(false);
  const [editingEntry, setEditingEntry] = useState<MedEntry | null>(null);
  const openId = searchParams.get("open");

  const reload = useCallback(() => setEntries(getEntries()), []);

  useEffect(() => {
    reload();
    return subscribeAppDataChange((keys) => {
      if (keys.includes("alphacore_medical")) reload();
    });
  }, [reload]);

  const filtered =
    tab === "all" || tab === "trends"
      ? entries
      : entries.filter((e) => e.category === tab);

  const grouped = filtered.reduce<Record<string, MedEntry[]>>((acc, e) => {
    const month = new Date(e.date).toLocaleDateString("ru-RU", {
      month: "long",
      year: "numeric",
    });
    (acc[month] ??= []).push(e);
    return acc;
  }, {});

  return (
    <AppShell>
      <div className="space-y-5 pb-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold">🏥 Анализы</h1>
            <p className="text-xs text-zinc-500">
              {entries.length} записей · динамика параметров
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditingEntry(null);
              setAdding(!adding);
            }}
            className="rounded-xl bg-teal-500 px-3.5 py-2 text-sm font-medium text-zinc-950 transition hover:bg-teal-400"
          >
            {editingEntry ? "Закрыть редактор" : "+ Запись"}
          </button>
        </div>

        {/* Add form */}
        {(adding || editingEntry) && (
          <AddEntryForm
            key={editingEntry?.id ?? "new-entry"}
            initialEntry={editingEntry ?? undefined}
            onAdd={() => {
              reload();
              setAdding(false);
              setEditingEntry(null);
            }}
            onCancel={() => {
              setAdding(false);
              setEditingEntry(null);
            }}
          />
        )}

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/30 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                tab === t.id
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
              {t.id !== "trends" && t.id !== "all" && (
                <span className="text-[10px] text-zinc-600">
                  {entries.filter(
                    (e) => e.category === t.id,
                  ).length || ""}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        {tab === "trends" ? (
          <TrendsView />
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-2xl">🏥</p>
            <p className="mt-2 text-sm text-zinc-500">
              Нет записей
              {tab !== "all" ? ` в категории «${CATEGORY_LABELS[tab as MedCategory]}»` : ""}
            </p>
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-3 text-xs text-teal-400 hover:text-teal-300"
            >
              Добавить первую запись
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {Object.entries(grouped).map(([month, items]) => (
              <div key={month} className="space-y-2">
                <h3 className="text-xs font-medium capitalize text-zinc-500">
                  {month}
                </h3>
                <div className="space-y-2">
                  {items.map((e) => (
                    <EntryCard
                      key={e.id}
                      entry={e}
                      forceOpen={openId === e.id}
                      onEdit={() => {
                        setAdding(false);
                        setEditingEntry(e);
                      }}
                      onDelete={() => {
                        deleteEntry(e.id);
                        reload();
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Summary stats */}
        {entries.length > 0 && tab !== "trends" && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-center">
              <p className="text-lg font-bold text-zinc-100">
                {entries.filter((e) => e.category === "blood").length}
              </p>
              <p className="text-[10px] text-zinc-500">🩸 Кровь</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-center">
              <p className="text-lg font-bold text-zinc-100">
                {entries.filter((e) => e.category === "ultrasound").length}
              </p>
              <p className="text-[10px] text-zinc-500">📡 УЗИ</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-center">
              <p className="text-lg font-bold text-zinc-100">
                {allParamNames().length}
              </p>
              <p className="text-[10px] text-zinc-500">📊 Параметров</p>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default function MedicalPage() {
  return (
    <Suspense fallback={<AppShell><div className="py-8 text-sm text-zinc-600">Загрузка анализов…</div></AppShell>}>
      <MedicalPageContent />
    </Suspense>
  );
}
