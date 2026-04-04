"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  addProject,
  updateProject,
  type Project,
  type ProjectAccent,
  type StatusTone,
} from "@/lib/projects";

type ProjectSelectManagerProps = {
  value: string;
  projects: Project[];
  onChange: (projectId: string) => void;
  onProjectsMutate?: (projectId: string) => void;
  noneLabel?: string;
  size?: "sm" | "md";
  suggestedAccent?: ProjectAccent;
  suggestedStatus?: StatusTone;
  creationContextLabel?: string;
  align?: "left" | "right";
};

type ManagerMode = "create" | "rename" | null;

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function ProjectSelectManager({
  value,
  projects,
  onChange,
  onProjectsMutate,
  noneLabel = "Без проекта",
  size = "md",
  suggestedAccent = "sky",
  suggestedStatus = "yellow",
  creationContextLabel = "selector",
  align = "left",
}: ProjectSelectManagerProps) {
  const [mode, setMode] = useState<ManagerMode>(null);
  const [draftName, setDraftName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === value) ?? null,
    [projects, value],
  );

  useEffect(() => {
    if (!mode) return;

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [mode]);

  useEffect(() => {
    if (!mode) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setMode(null);
      setError(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMode(null);
      setError(null);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mode]);

  const duplicateProject = useMemo(() => {
    const normalized = normalizeName(draftName).toLowerCase();
    if (!normalized) return null;

    return (
      projects.find((project) => {
        if (mode === "rename" && project.id === selectedProject?.id) return false;
        return normalizeName(project.name).toLowerCase() === normalized;
      }) ?? null
    );
  }, [draftName, mode, projects, selectedProject?.id]);

  const selectCls =
    size === "sm"
      ? "min-w-0 rounded-lg border border-zinc-800 bg-zinc-900/50 px-2 py-1 text-[10px] text-zinc-300 outline-none"
      : "min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-3 text-xs text-zinc-300 outline-none";
  const iconBtnCls =
    size === "sm"
      ? "rounded-lg border border-zinc-800 bg-zinc-900/50 px-2 py-1 text-[10px] text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100"
      : "rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-3 text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100";
  const panelAlignCls = align === "right" ? "right-0" : "left-0";

  function openCreate(): void {
    setDraftName("");
    setError(null);
    setMode("create");
  }

  function openRename(): void {
    if (!selectedProject) return;
    setDraftName(selectedProject.name);
    setError(null);
    setMode("rename");
  }

  function closeManager(): void {
    setMode(null);
    setError(null);
  }

  function handleSave(): void {
    const nextName = normalizeName(draftName);
    if (!nextName) {
      setError("Нужно название проекта.");
      return;
    }

    if (duplicateProject) {
      setError(`Проект «${duplicateProject.name}» уже существует.`);
      return;
    }

    if (mode === "create") {
      const created = addProject({
        name: nextName,
        description: `Создано из ${creationContextLabel}.`,
        status: suggestedStatus,
        accent: suggestedAccent,
        nextStep: "Определить первый следующий шаг",
        kpis: [],
        deliverables: [],
      });
      onChange(created.id);
      onProjectsMutate?.(created.id);
      closeManager();
      return;
    }

    if (mode === "rename" && selectedProject) {
      if (normalizeName(selectedProject.name) === nextName) {
        closeManager();
        return;
      }
      updateProject(selectedProject.id, { name: nextName });
      onProjectsMutate?.(selectedProject.id);
      closeManager();
    }
  }

  return (
    <div ref={rootRef} className="relative flex min-w-0 items-center gap-1.5">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`flex-1 ${selectCls}`}
      >
        <option value="">{noneLabel}</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={openCreate}
        className={iconBtnCls}
        title="Создать новый проект"
        aria-label="Создать новый проект"
      >
        ＋
      </button>
      <button
        type="button"
        onClick={openRename}
        disabled={!selectedProject}
        className={`${iconBtnCls} disabled:cursor-not-allowed disabled:opacity-35`}
        title={selectedProject ? `Переименовать ${selectedProject.name}` : "Сначала выбери проект"}
        aria-label="Переименовать выбранный проект"
      >
        ✎
      </button>

      {mode && (
        <div className={`absolute ${panelAlignCls} top-full z-30 mt-2 w-72 rounded-2xl border border-zinc-800 bg-zinc-950/95 p-3 shadow-[0_14px_48px_rgba(0,0,0,0.38)] backdrop-blur`}>
          <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
            {mode === "create" ? "Новый проект" : "Переименовать проект"}
          </p>
          <p className="mt-1 text-sm font-medium text-zinc-100">
            {mode === "create"
              ? "Создать проект прямо из выбора"
              : selectedProject?.name ?? "Выбранный проект"}
          </p>

          <input
            ref={inputRef}
            value={draftName}
            onChange={(event) => {
              setDraftName(event.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleSave();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                closeManager();
              }
            }}
            placeholder="Название проекта"
            className="mt-3 w-full rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600"
          />

          {error && <p className="mt-2 text-[11px] text-rose-300">{error}</p>}
          {!error && duplicateProject && (
            <p className="mt-2 text-[11px] text-amber-300">Такой проект уже есть.</p>
          )}

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              className="rounded-xl border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-100 transition hover:border-sky-400/40"
            >
              {mode === "create" ? "Создать" : "Сохранить"}
            </button>
            <button
              type="button"
              onClick={closeManager}
              className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
