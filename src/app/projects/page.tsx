"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import {
  type Project,
  type ProjectAccent,
  type ProjectDeliverable,
  type ProjectInput,
  type ProjectKind,
  type ProjectLifeArea,
  type ProjectKpi,
  type StatusTone,
  PROJECT_KIND_LABEL,
  PROJECT_LIFE_AREA_LABEL,
  PROJECT_ACCENT_CLS,
  addProject,
  attentionProjects,
  cycleProjectStatus,
  deleteProject,
  getChildProjects,
  getProjectDisplayName,
  getProjectRootId,
  getProjects,
  moveProject,
  projectAccentForLifeArea,
  projectProgress,
  reorderProjects,
  toggleDeliverable,
  updateProject,
} from "@/lib/projects";
import { subscribeAppDataChange } from "@/lib/storage";

const STATUS_DOT: Record<StatusTone, string> = {
  green: "bg-emerald-400",
  yellow: "bg-amber-400",
  red: "bg-rose-400",
};

const STATUS_LABEL: Record<StatusTone, string> = {
  green: "На ходу",
  yellow: "Нужно внимание",
  red: "Блокер",
};

const ACCENT_LABEL: Record<ProjectAccent, string> = {
  sky: "Sky",
  orange: "Orange",
  violet: "Violet",
  teal: "Teal",
  rose: "Rose",
};

const KIND_BADGE_CLS: Record<ProjectKind, string> = {
  project: "border-sky-500/20 bg-sky-500/10 text-sky-200",
  category: "border-violet-500/20 bg-violet-500/10 text-violet-200",
};

type DraftKpi = ProjectKpi;
type DraftDeliverable = ProjectDeliverable;

type ProjectDraft = {
  name: string;
  kind: ProjectKind;
  lifeArea: ProjectLifeArea;
  description: string;
  status: StatusTone;
  accent: ProjectAccent;
  nextStep: string;
  kpis: DraftKpi[];
  deliverables: DraftDeliverable[];
};

type CreateEditorState = {
  mode: "create";
  parentProjectId?: string;
  draft: ProjectDraft;
  isDirty: boolean;
};

type EditorState =
  | CreateEditorState
  | { mode: "edit"; projectId: string; draft: ProjectDraft; isDirty: boolean }
  | null;

function rowId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function createDraft(project?: Project): ProjectDraft {
  if (!project) {
    return {
      name: "",
      kind: "project",
      lifeArea: "work",
      description: "",
      status: "yellow",
      accent: "sky",
      nextStep: "",
      kpis: [
        { id: rowId(), label: "", value: "" },
        { id: rowId(), label: "", value: "" },
      ],
      deliverables: [{ id: rowId(), text: "", done: false }],
    };
  }

  return {
    name: project.name,
    kind: project.kind,
    lifeArea: project.lifeArea,
    description: project.description,
    status: project.status,
    accent: project.accent,
    nextStep: project.nextStep,
    kpis: project.kpis.map((item) => ({ ...item })),
    deliverables: project.deliverables.map((item) => ({ ...item })),
  };
}

function createSubprojectDraft(parentProject: Project): ProjectDraft {
  const base = createDraft();

  return {
    ...base,
    kind: "project",
    lifeArea: parentProject.lifeArea,
    status: parentProject.status,
    accent: parentProject.accent,
    description: `Вложенная группа внутри «${parentProject.name}».`,
  };
}

function toInput(draft: ProjectDraft): ProjectInput {
  return {
    name: draft.name,
    kind: draft.kind,
    lifeArea: draft.lifeArea,
    description: draft.description,
    status: draft.status,
    accent: draft.accent,
    nextStep: draft.nextStep,
    kpis: draft.kpis.map((item) => ({ label: item.label, value: item.value })),
    deliverables: draft.deliverables.map((item) => ({ text: item.text, done: item.done })),
  };
}

function pluralizeSubprojects(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) return "вложенная группа";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "вложенные группы";
  return "вложенных групп";
}

function buildDeletePrompt(project: Project, directChildrenCount: number): string {
  if (directChildrenCount === 0) {
    return `Удалить группу «${project.name}»?`;
  }

  return `Удалить группу «${project.name}»? ${directChildrenCount} ${pluralizeSubprojects(directChildrenCount)} не пропадут: они поднимутся на уровень выше.`;
}

function SubprojectTree({
  parentId,
  projects,
  highlightedId,
  depth = 1,
  onEdit,
  onDelete,
  onCreateSubproject,
}: {
  parentId: string;
  projects: Project[];
  highlightedId: string | null;
  depth?: number;
  onEdit: (project: Project) => void;
  onDelete: (project: Project, directChildrenCount: number) => void;
  onCreateSubproject: (project: Project) => void;
}) {
  const children = getChildProjects(parentId, projects);

  if (children.length === 0) return null;

  return (
    <div className={depth === 1 ? "space-y-3" : "mt-3 space-y-3 border-l border-zinc-800/70 pl-4"}>
      {children.map((project) => {
        const pct = projectProgress(project);
        const displayName = getProjectDisplayName(project, projects);
        const nestedChildren = getChildProjects(project.id, projects);
        const isHighlighted = highlightedId === project.id;

        return (
          <article
            key={project.id}
            className={`rounded-2xl border p-4 shadow-lg shadow-black/10 ${PROJECT_ACCENT_CLS[project.accent]} ${
              isHighlighted ? "ring-1 ring-sky-400/40" : ""
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                  {depth === 1 ? "Вложенная группа" : `Уровень ${depth + 1}`}
                </p>
                <h3 className="mt-1 text-sm font-semibold text-zinc-100">{project.name}</h3>
                <p className="mt-1 text-xs text-zinc-500">{displayName}</p>
                <p className="mt-2 text-xs text-zinc-400">{project.description}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-[10px] ${KIND_BADGE_CLS[project.kind]}`}>
                  {PROJECT_KIND_LABEL[project.kind]}
                </span>
                <span className="rounded-full border border-zinc-700/80 px-2 py-0.5 text-[10px] text-zinc-400">
                  {PROJECT_LIFE_AREA_LABEL[project.lifeArea]}
                </span>
                <span className="rounded-full border border-zinc-700/80 px-2 py-0.5 text-[10px] text-zinc-400">
                  {pct}%
                </span>
                {nestedChildren.length > 0 && (
                  <span className="rounded-full border border-zinc-700/80 px-2 py-0.5 text-[10px] text-zinc-400">
                    {nestedChildren.length} {pluralizeSubprojects(nestedChildren.length)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => cycleProjectStatus(project.id)}
                  className="flex items-center gap-1.5 rounded-full border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 transition hover:border-zinc-500"
                >
                  <span className={`h-2 w-2 rounded-full ${STATUS_DOT[project.status]}`} />
                  {STATUS_LABEL[project.status]}
                </button>
                <button
                  type="button"
                  onClick={() => onCreateSubproject(project)}
                  className="rounded-full border border-sky-500/20 px-2 py-1 text-[10px] text-sky-300 transition hover:bg-sky-500/10"
                  title="Добавить вложенную группу"
                >
                  ↳＋
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(project)}
                  className="rounded-full border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
                >
                  ✎
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(project, nestedChildren.length)}
                  className="rounded-full border border-rose-500/20 px-2 py-1 text-[10px] text-rose-300 transition hover:bg-rose-500/10"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="mt-3 h-1.5 rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-emerald-400 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>

            {project.deliverables.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {project.deliverables.slice(0, 3).map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
                      item.done
                        ? "border-emerald-500/20 bg-emerald-500/5 text-zinc-500"
                        : "border-zinc-800/60 bg-zinc-900/20 text-zinc-300"
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        item.done ? "border-emerald-400 bg-emerald-400 text-zinc-950" : "border-zinc-700"
                      }`}
                    >
                      {item.done ? "✓" : ""}
                    </span>
                    <span className={item.done ? "line-through" : ""}>{item.text}</span>
                  </div>
                ))}

                {project.deliverables.length > 3 && (
                  <p className="text-[11px] text-zinc-500">
                    Ещё {project.deliverables.length - 3} пунктов внутри вложенной группы.
                  </p>
                )}
              </div>
            )}

            <div className="mt-3 rounded-xl border border-zinc-800/50 bg-zinc-900/30 p-3">
              <p className="text-[10px] uppercase tracking-widest text-zinc-500">Следующий шаг</p>
              <p className="mt-1.5 text-sm font-medium text-zinc-200">
                {project.nextStep || "Зафиксировать следующий шаг"}
              </p>
            </div>

            <SubprojectTree
              parentId={project.id}
              projects={projects}
              highlightedId={highlightedId}
              depth={depth + 1}
              onEdit={onEdit}
              onDelete={onDelete}
              onCreateSubproject={onCreateSubproject}
            />
          </article>
        );
      })}
    </div>
  );
}

function ProjectEditor({
  state,
  parentProjectLabel,
  onChange,
  onSave,
  onCancel,
}: {
  state: Exclude<EditorState, null>;
  parentProjectLabel?: string | null;
  onChange: (draft: ProjectDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { draft } = state;
  const isCreatingSubproject = state.mode === "create" && !!parentProjectLabel;

  const updateKpi = useCallback(
    (id: string, patch: Partial<DraftKpi>) => {
      onChange({
        ...draft,
        kpis: draft.kpis.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      });
    },
    [draft, onChange],
  );

  const updateDeliverable = useCallback(
    (id: string, patch: Partial<DraftDeliverable>) => {
      onChange({
        ...draft,
        deliverables: draft.deliverables.map((item) =>
          item.id === id ? { ...item, ...patch } : item,
        ),
      });
    },
    [draft, onChange],
  );

  return (
    <section className="rounded-4xl border border-zinc-800 bg-zinc-900/40 p-5 shadow-2xl shadow-black/20">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-50">
            {isCreatingSubproject
              ? "Новая вложенная группа"
              : state.mode === "create"
                ? "Новая группа"
                : "Редактирование группы"}
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            {isCreatingSubproject
              ? `Будет вложен в ${parentProjectLabel}.`
              : "Хранится локально и обновляется сразу на дашборде и в поиске."}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
        >
          Закрыть
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Название</label>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder="Например, HEYS Growth или Здоровье"
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Следующий шаг</label>
          <input
            type="text"
            value={draft.nextStep}
            onChange={(e) => onChange({ ...draft, nextStep: e.target.value })}
            placeholder="Что должно быть сделано следующим?"
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600"
          />
        </div>
      </div>

      <div className="mt-3">
        <label className="mb-1 block text-xs text-zinc-500">Описание</label>
        <textarea
          value={draft.description}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
          rows={3}
          placeholder="Краткий контекст, цель, зона ответственности..."
          className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600"
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Тип группы</label>
          <div className="grid grid-cols-2 gap-2">
            {(["project", "category"] as const).map((kind) => {
              const active = draft.kind === kind;

              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() =>
                    onChange({
                      ...draft,
                      kind,
                      accent: projectAccentForLifeArea(draft.lifeArea),
                    })
                  }
                  className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
                    active
                      ? kind === "category"
                        ? "border-violet-400/45 bg-violet-500/14 text-violet-100"
                        : "border-sky-400/45 bg-sky-500/14 text-sky-100"
                      : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100"
                  }`}
                >
                  <span className="block font-semibold">{PROJECT_KIND_LABEL[kind]}</span>
                  <span className="mt-0.5 block text-[10px] opacity-70">
                    {kind === "category" ? "общая тема / корзина задач" : "отдельное направление"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Сфера</label>
          <select
            value={draft.lifeArea}
            onChange={(e) =>
              onChange({
                ...draft,
                lifeArea: e.target.value as ProjectLifeArea,
                accent: projectAccentForLifeArea(e.target.value as ProjectLifeArea),
              })
            }
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-sm text-zinc-100"
          >
            {Object.entries(PROJECT_LIFE_AREA_LABEL).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Статус</label>
          <select
            value={draft.status}
            onChange={(e) => onChange({ ...draft, status: e.target.value as StatusTone })}
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-sm text-zinc-100"
          >
            {Object.entries(STATUS_LABEL).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Акцент карточки</label>
          <select
            value={draft.accent}
            onChange={(e) => onChange({ ...draft, accent: e.target.value as ProjectAccent })}
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-sm text-zinc-100"
          >
            {Object.entries(ACCENT_LABEL).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="space-y-2 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-100">KPI / метрики</h3>
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...draft,
                  kpis: [...draft.kpis, { id: rowId(), label: "", value: "" }],
                })
              }
              className="text-xs text-sky-400 transition hover:text-sky-300"
            >
              + KPI
            </button>
          </div>

          {draft.kpis.map((item) => (
            <div key={item.id} className="grid grid-cols-[120px_minmax(0,1fr)_32px] gap-2">
              <input
                type="text"
                value={item.label}
                onChange={(e) => updateKpi(item.id, { label: e.target.value })}
                placeholder="CR1"
                className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-600"
              />
              <input
                type="text"
                value={item.value}
                onChange={(e) => updateKpi(item.id, { value: e.target.value })}
                placeholder="lead → confirmed"
                className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-600"
              />
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...draft,
                    kpis: draft.kpis.filter((kpi) => kpi.id !== item.id),
                  })
                }
                className="rounded-lg border border-zinc-800 text-zinc-500 transition hover:border-rose-500/30 hover:text-rose-400"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="space-y-2 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-100">Deliverables</h3>
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...draft,
                  deliverables: [...draft.deliverables, { id: rowId(), text: "", done: false }],
                })
              }
              className="text-xs text-emerald-400 transition hover:text-emerald-300"
            >
              + Пункт
            </button>
          </div>

          {draft.deliverables.map((item) => (
            <div key={item.id} className="grid grid-cols-[24px_minmax(0,1fr)_32px] items-center gap-2">
              <button
                type="button"
                onClick={() => updateDeliverable(item.id, { done: !item.done })}
                className={`flex h-5 w-5 items-center justify-center rounded-md border transition ${
                  item.done
                    ? "border-emerald-400 bg-emerald-400 text-zinc-950"
                    : "border-zinc-700 text-zinc-500"
                }`}
              >
                {item.done ? "✓" : ""}
              </button>
              <input
                type="text"
                value={item.text}
                onChange={(e) => updateDeliverable(item.id, { text: e.target.value })}
                placeholder="Что должно быть готово"
                className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-600"
              />
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...draft,
                    deliverables: draft.deliverables.filter((d) => d.id !== item.id),
                  })
                }
                className="rounded-lg border border-zinc-800 text-zinc-500 transition hover:border-rose-500/30 hover:text-rose-400"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={!draft.name.trim()}
          className="rounded-xl bg-zinc-50 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isCreatingSubproject
            ? "Создать вложенную группу"
            : state.mode === "create"
              ? "Создать группу"
              : "Сохранить изменения"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-zinc-800 px-4 py-2.5 text-sm text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
        >
          Отмена
        </button>
      </div>
    </section>
  );
}

function ProjectsPageContent() {
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const reload = useCallback(() => {
    setProjects(getProjects());
  }, []);

  useEffect(() => {
    reload();
    return subscribeAppDataChange((keys) => {
      if (keys.includes("alphacore_projects")) reload();
    });
  }, [reload]);

  useEffect(() => {
    const requestedOpen = searchParams.get("open");
    if (requestedOpen) setOpenId(requestedOpen);
  }, [searchParams]);

  // Warn on browser close with unsaved editor changes
  useEffect(() => {
    if (!editor?.isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [editor?.isDirty]);

  const topLevelProjects = useMemo(
    () => projects.filter((project) => !project.parentProjectId),
    [projects],
  );
  const subprojectCount = projects.length - topLevelProjects.length;
  const projectCount = useMemo(
    () => projects.filter((project) => project.kind === "project").length,
    [projects],
  );
  const categoryCount = useMemo(
    () => projects.filter((project) => project.kind === "category").length,
    [projects],
  );
  const attentionCount = useMemo(() => attentionProjects(projects).length, [projects]);
  const openRootId = useMemo(
    () => (openId ? getProjectRootId(openId, projects) : null),
    [openId, projects],
  );
  const editorParentProject = useMemo(() => {
    if (!editor || editor.mode !== "create" || !editor.parentProjectId) return null;
    return projects.find((project) => project.id === editor.parentProjectId) ?? null;
  }, [editor, projects]);
  const editorParentProjectLabel = useMemo(
    () => (editorParentProject ? getProjectDisplayName(editorParentProject, projects) : null),
    [editorParentProject, projects],
  );

  const openCreateProject = useCallback(() => {
    setEditor({ mode: "create", draft: createDraft(), isDirty: false });
  }, []);

  const openCreateSubproject = useCallback((parentProject: Project) => {
    setOpenId(parentProject.id);
    setEditor({
      mode: "create",
      parentProjectId: parentProject.id,
      draft: createSubprojectDraft(parentProject),
      isDirty: false,
    });
  }, []);

  const handleSaveEditor = useCallback(() => {
    if (!editor) return;
    if (editor.mode === "create") {
      const created = addProject({
        ...toInput(editor.draft),
        parentProjectId: editor.parentProjectId,
      });
      setOpenId(created.id);
    } else {
      updateProject(editor.projectId, toInput(editor.draft));
      setOpenId(editor.projectId);
    }
    reload();
    setEditor(null);
  }, [editor, reload]);

  const handleReorder = useCallback(
    (activeId: string, targetId: string) => {
      reorderProjects(activeId, targetId);
      reload();
    },
    [reload],
  );

  const handleEditProject = useCallback((project: Project) => {
    setEditor({ mode: "edit", projectId: project.id, draft: createDraft(project), isDirty: false });
  }, []);

  const handleDeleteProject = useCallback(
    (project: Project, directChildrenCount: number) => {
      if (!window.confirm(buildDeletePrompt(project, directChildrenCount))) return;

      deleteProject(project.id);

      if (openId === project.id) {
        setOpenId(project.parentProjectId ?? null);
      } else if (openRootId === project.id) {
        setOpenId(null);
      }

      reload();
    },
    [openId, openRootId, reload],
  );

  return (
    <AppShell>
      <div className="space-y-5 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">📁 Группы</h1>
            <p className="mt-1 text-sm text-zinc-500">
              {projectCount} проектов · {categoryCount} категорий · {subprojectCount} вложенных групп · {attentionCount} требуют внимания
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateProject}
            className="rounded-xl bg-zinc-50 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200"
          >
            + Группа
          </button>
        </div>

        {editor && (
          <ProjectEditor
            state={editor}
            parentProjectLabel={editorParentProjectLabel}
            onChange={(draft) => setEditor((prev) => (prev ? { ...prev, draft, isDirty: true } : prev))}
            onSave={handleSaveEditor}
            onCancel={() => {
              if (editor.isDirty && !window.confirm("Есть несохранённые изменения. Закрыть без сохранения?")) return;
              setEditor(null);
            }}
          />
        )}

        <div className="space-y-4">
          {topLevelProjects.length === 0 && (
            <div className="rounded-4xl border border-zinc-800 bg-zinc-900/30 p-8 text-center">
              <p className="text-sm text-zinc-500">Групп пока нет</p>
            </div>
          )}

          {topLevelProjects.map((project, index) => {
            const isOpen = openRootId === project.id;
            const pct = projectProgress(project);
            const childProjects = getChildProjects(project.id, projects);

            return (
              <article
                key={project.id}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (draggedId && draggedId !== project.id) {
                    handleReorder(draggedId, project.id);
                  }
                  setDraggedId(null);
                }}
                className={`rounded-4xl border p-5 shadow-2xl shadow-black/20 ${PROJECT_ACCENT_CLS[project.accent]} ${
                  draggedId === project.id ? "opacity-60" : "opacity-100"
                }`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <button
                    type="button"
                    onClick={() => setOpenId(isOpen ? null : project.id)}
                    className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-lg font-semibold text-zinc-100">{project.name}</h2>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] ${KIND_BADGE_CLS[project.kind]}`}>
                          {PROJECT_KIND_LABEL[project.kind]}
                        </span>
                        <span className="rounded-full border border-zinc-700/80 px-2 py-0.5 text-[10px] text-zinc-400">
                          {PROJECT_LIFE_AREA_LABEL[project.lifeArea]}
                        </span>
                        <span className="rounded-full border border-zinc-700/80 px-2 py-0.5 text-[10px] text-zinc-400">
                          {project.kpis.length} KPI
                        </span>
                        {childProjects.length > 0 && (
                          <span className="rounded-full border border-zinc-700/80 px-2 py-0.5 text-[10px] text-zinc-400">
                            {childProjects.length} {pluralizeSubprojects(childProjects.length)}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{project.description}</p>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-xs text-zinc-500">{pct}%</span>
                      <span className={`text-zinc-500 transition ${isOpen ? "rotate-180" : ""}`}>▾</span>
                    </div>
                  </button>

                  <div className="flex shrink-0 items-center gap-2 self-start">
                    <button
                      type="button"
                      draggable
                      onDragStart={() => setDraggedId(project.id)}
                      onDragEnd={() => setDraggedId(null)}
                      className="cursor-grab rounded-full border border-zinc-700 px-2 py-1 text-[10px] text-zinc-500 transition hover:border-zinc-500 hover:text-zinc-200 active:cursor-grabbing"
                      title="Перетащить для приоритизации"
                    >
                      ⋮⋮
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        moveProject(project.id, -1);
                        reload();
                      }}
                      disabled={index === 0}
                      className="rounded-full border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
                      title="Поднять выше"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        moveProject(project.id, 1);
                        reload();
                      }}
                      disabled={index === topLevelProjects.length - 1}
                      className="rounded-full border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
                      title="Опустить ниже"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => cycleProjectStatus(project.id)}
                      className="flex items-center gap-1.5 rounded-full border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 transition hover:border-zinc-500"
                    >
                      <span className={`h-2 w-2 rounded-full ${STATUS_DOT[project.status]}`} />
                      {STATUS_LABEL[project.status]}
                    </button>
                    <button
                      type="button"
                      onClick={() => openCreateSubproject(project)}
                      className="rounded-full border border-sky-500/20 px-2 py-1 text-[10px] text-sky-300 transition hover:bg-sky-500/10"
                      title="Добавить вложенную группу"
                    >
                      ↳＋
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEditProject(project)}
                      className="rounded-full border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
                    >
                      ✎
                    </button>
                  </div>
                </div>

                <div className="mt-3 h-1.5 rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-emerald-400 transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>

                {isOpen && (
                  <div className="mt-5 space-y-4">
                    {childProjects.length > 0 && (
                      <section>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-[11px] uppercase tracking-widest text-zinc-500">Вложенные группы</p>
                          <span className="text-[10px] text-zinc-500">
                            {childProjects.length} {pluralizeSubprojects(childProjects.length)}
                          </span>
                        </div>

                        <SubprojectTree
                          parentId={project.id}
                          projects={projects}
                          highlightedId={openId}
                          onEdit={handleEditProject}
                          onDelete={handleDeleteProject}
                          onCreateSubproject={openCreateSubproject}
                        />
                      </section>
                    )}

                    <div className="grid gap-2 sm:grid-cols-3">
                      {project.kpis.map((kpi) => (
                        <div
                          key={kpi.id}
                          className="rounded-xl border border-zinc-800/50 bg-zinc-900/30 p-3"
                        >
                          <p className="text-[10px] uppercase tracking-widest text-zinc-500">{kpi.label}</p>
                          <p className="mt-1 text-sm text-zinc-200">{kpi.value}</p>
                        </div>
                      ))}
                    </div>

                    <div>
                      <p className="mb-2 text-[11px] uppercase tracking-widest text-zinc-500">Deliverables</p>
                      <div className="space-y-1.5">
                        {project.deliverables.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => toggleDeliverable(project.id, item.id)}
                            className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                              item.done
                                ? "border-emerald-500/20 bg-emerald-500/5"
                                : "border-zinc-800/60 bg-zinc-900/20 hover:border-zinc-700"
                            }`}
                          >
                            <div
                              className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border transition ${
                                item.done
                                  ? "border-emerald-400 bg-emerald-400 text-zinc-950"
                                  : "border-zinc-600"
                              }`}
                            >
                              {item.done ? "✓" : ""}
                            </div>
                            <span className={`text-sm ${item.done ? "text-zinc-500 line-through" : "text-zinc-200"}`}>
                              {item.text}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/30 p-3">
                      <p className="text-[10px] uppercase tracking-widest text-zinc-500">Следующий шаг</p>
                      <p className="mt-1.5 text-sm font-medium text-zinc-200">{project.nextStep}</p>
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => openCreateSubproject(project)}
                        className="rounded-xl border border-sky-500/20 px-3 py-2 text-xs text-sky-200 transition hover:bg-sky-500/10"
                      >
                        Добавить вложенную группу
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEditProject(project)}
                        className="rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
                      >
                        Редактировать
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteProject(project, childProjects.length)}
                        className="rounded-xl border border-rose-500/20 px-3 py-2 text-xs text-rose-300 transition hover:bg-rose-500/10"
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={<AppShell><div className="py-8 text-sm text-zinc-600">Загрузка групп…</div></AppShell>}>
      <ProjectsPageContent />
    </Suspense>
  );
}
