"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  addProject,
  getProjectDisplayName,
  isSubproject,
  updateProject,
  type Project,
  type ProjectAccent,
  type StatusTone,
} from "@/lib/projects";

type ProjectSelectManagerProps = {
  value: string;
  projects: Project[];
  quickProjects?: Project[];
  compactValueOnly?: boolean;
  desktopSingleRow?: boolean;
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

const PROJECT_DOT_CLS: Record<ProjectAccent, string> = {
  sky: "bg-sky-400",
  orange: "bg-orange-400",
  violet: "bg-violet-400",
  teal: "bg-teal-400",
  rose: "bg-rose-400",
};

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function ProjectSelectManager({
  value,
  projects,
  quickProjects,
  compactValueOnly = false,
  desktopSingleRow = false,
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
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === value) ?? null,
    [projects, value],
  );
  const projectLabelById = useMemo(
    () =>
      new Map(
        projects.map((project) => [project.id, getProjectDisplayName(project, projects)]),
      ),
    [projects],
  );
  const visibleQuickProjects = useMemo(() => {
    if (!quickProjects?.length) return [];

    const seen = new Set<string>();
    const shortlist = quickProjects.filter((project) => {
      if (seen.has(project.id)) return false;
      seen.add(project.id);
      return true;
    });

    if (selectedProject && !seen.has(selectedProject.id)) {
      shortlist.push(selectedProject);
    }

    return shortlist;
  }, [quickProjects, selectedProject, size]);
  const usesQuickProjects = visibleQuickProjects.length > 0;
  const usesCompactValueTrigger = compactValueOnly && !!selectedProject;
  const isOverlayOpen = mode !== null || showAllProjects;
  const selectedProjectLabel = selectedProject
    ? projectLabelById.get(selectedProject.id) ?? selectedProject.name
    : noneLabel;

  function getQuickProjectLabel(project: Project): string {
    return isSubproject(project) ? `↳ ${project.name}` : project.name;
  }

  function getFullProjectLabel(project: Project): string {
    return projectLabelById.get(project.id) ?? project.name;
  }

  useEffect(() => {
    if (!mode) return;

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [mode]);

  useEffect(() => {
    if (!isOverlayOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setShowAllProjects(false);
      setMode(null);
      setError(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setShowAllProjects(false);
      setMode(null);
      setError(null);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOverlayOpen]);

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
  const quickProjectBtnCls =
    `flex min-w-0 items-center ${size === "sm" ? "gap-1.5 rounded-lg px-2 py-1 text-[10px]" : "gap-2 rounded-xl px-3 py-3 text-xs"} border transition ${
      desktopSingleRow ? "shrink-0" : ""
    }`;
  const quickProjectDotCls = size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2";
  const quickToggleBtnCls =
    size === "sm"
      ? `rounded-lg border border-zinc-800 bg-zinc-900/40 px-2 py-1 text-[10px] text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100 ${desktopSingleRow ? "shrink-0" : ""}`
      : `rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-3 text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100 ${desktopSingleRow ? "shrink-0" : ""}`;
  const compactValueBtnCls =
    size === "sm"
      ? "flex w-full min-w-0 items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/50 px-2 py-1 text-[10px] text-zinc-300 transition hover:border-zinc-700 hover:text-zinc-100"
      : "flex w-full min-w-0 items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-3 text-xs text-zinc-300 transition hover:border-zinc-700 hover:text-zinc-100";
  const controlsWrapCls = desktopSingleRow ? "flex min-w-0 items-center gap-1.5 lg:flex-nowrap" : "flex min-w-0 flex-wrap items-center gap-1.5";
  const quickProjectsWrapCls = desktopSingleRow
    ? "flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pr-1 lg:flex-nowrap"
    : "flex min-w-0 flex-1 flex-wrap items-center gap-1.5";

  function closeOverlays(): void {
    setShowAllProjects(false);
    setMode(null);
    setError(null);
  }

  function openCreate(): void {
    setShowAllProjects(false);
    setDraftName("");
    setError(null);
    setMode("create");
  }

  function openRename(): void {
    if (!selectedProject) return;
    setShowAllProjects(false);
    setDraftName(selectedProject.name);
    setError(null);
    setMode("rename");
  }

  function closeManager(): void {
    closeOverlays();
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
    <div ref={rootRef} className="relative w-full min-w-0">
      <div className={controlsWrapCls}>
        {usesCompactValueTrigger ? (
          <button
            type="button"
            onClick={() => {
              setMode(null);
              setError(null);
              setShowAllProjects((current) => !current);
            }}
            aria-expanded={showAllProjects}
            className={compactValueBtnCls}
            title={selectedProject ? `Сменить проект ${selectedProject.name}` : "Выбрать проект"}
          >
            {selectedProject && (
              <span className={`${quickProjectDotCls} shrink-0 rounded-full ${PROJECT_DOT_CLS[selectedProject.accent]}`} />
            )}
            <span className="min-w-0 flex-1 truncate text-left">{selectedProjectLabel}</span>
            <span className="shrink-0 text-zinc-500">▾</span>
          </button>
        ) : usesQuickProjects ? (
          <div className={quickProjectsWrapCls}>
            {visibleQuickProjects.map((project) => {
              const isActive = value === project.id;

              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => onChange(isActive ? "" : project.id)}
                  aria-pressed={isActive}
                  title={isActive ? `Снять проект ${getFullProjectLabel(project)}` : `Выбрать проект ${getFullProjectLabel(project)}`}
                  className={`${quickProjectBtnCls} ${
                    isActive
                      ? "border-zinc-100 bg-zinc-100 text-zinc-950 shadow-[0_8px_24px_rgba(255,255,255,0.08)]"
                      : "border-zinc-800 bg-zinc-900/50 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100"
                  }`}
                >
                  <span className={`${quickProjectDotCls} shrink-0 rounded-full ${PROJECT_DOT_CLS[project.accent]}`} />
                  <span className="min-w-0 truncate">{getQuickProjectLabel(project)}</span>
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => {
                setMode(null);
                setError(null);
                setShowAllProjects((current) => !current);
              }}
              aria-expanded={showAllProjects}
              className={quickToggleBtnCls}
            >
                {showAllProjects ? "Скрыть список" : "Все"}
            </button>
          </div>
        ) : (
          <select
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className={`flex-1 ${selectCls}`}
          >
            <option value="">{noneLabel}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {getFullProjectLabel(project)}
              </option>
            ))}
          </select>
        )}

        {!compactValueOnly && (
          <>
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
          </>
        )}
      </div>

      {(usesQuickProjects || usesCompactValueTrigger) && showAllProjects && (
        <div className={`absolute ${panelAlignCls} top-full z-30 mt-2 w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-zinc-800 bg-zinc-950/95 p-3 shadow-[0_14px_48px_rgba(0,0,0,0.38)] backdrop-blur`}>
          <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Все проекты</p>
          <p className="mt-1 text-sm font-medium text-zinc-100">
            {usesCompactValueTrigger
              ? "Нажми на проект, если нужно быстро перекинуть задачу в другой список."
              : "Если нужного нет среди быстрых кнопок — он ждёт здесь."}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setShowAllProjects(false);
              }}
              aria-pressed={value === ""}
              className={`rounded-xl border px-3 py-2 text-xs transition ${
                value === ""
                  ? "border-zinc-100 bg-zinc-100 text-zinc-950"
                  : "border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100"
              }`}
            >
              {noneLabel}
            </button>

            {projects.map((project) => {
              const isActive = value === project.id;

              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => {
                    onChange(project.id);
                    setShowAllProjects(false);
                  }}
                  aria-pressed={isActive}
                  className={`flex min-w-0 max-w-full items-center gap-2 rounded-xl border px-3 py-2 text-xs transition ${
                    isActive
                      ? "border-zinc-100 bg-zinc-100 text-zinc-950"
                      : "border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100"
                  }`}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${PROJECT_DOT_CLS[project.accent]}`} />
                  <span className="truncate">{getFullProjectLabel(project)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

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
