import { lsGet, lsSet, uid } from "./storage";
import type { Task } from "./tasks";

export type StatusTone = "green" | "yellow" | "red";
export type ProjectAccent = "sky" | "orange" | "violet" | "teal" | "rose";
export type ProjectKind = "project" | "category";
export type ProjectLifeArea =
  | "work"
  | "health"
  | "family"
  | "operations"
  | "reflection"
  | "recovery";

export const PROJECT_KIND_LABEL: Record<ProjectKind, string> = {
  project: "Проект",
  category: "Категория задач",
};

export const PROJECT_LIFE_AREA_LABEL: Record<ProjectLifeArea, string> = {
  work: "Работа",
  health: "Здоровье",
  family: "Семья",
  operations: "Операционка",
  reflection: "Осмысление",
  recovery: "Восстановление",
};

const PROJECT_ACCENT_BY_AREA: Record<ProjectLifeArea, ProjectAccent> = {
  work: "sky",
  health: "teal",
  family: "violet",
  operations: "rose",
  reflection: "orange",
  recovery: "violet",
};

export type ProjectKpi = {
  id: string;
  label: string;
  value: string;
};

export type ProjectDeliverable = {
  id: string;
  text: string;
  done: boolean;
};

export type Project = {
  id: string;
  order: number;
  name: string;
  kind: ProjectKind;
  lifeArea: ProjectLifeArea;
  description: string;
  status: StatusTone;
  accent: ProjectAccent;
  kpis: ProjectKpi[];
  deliverables: ProjectDeliverable[];
  nextStep: string;
  parentProjectId?: string;
  sourceTaskId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectInput = Pick<
  Project,
  "name" | "description" | "status" | "accent" | "nextStep" | "parentProjectId" | "sourceTaskId"
> & {
  kind?: ProjectKind;
  lifeArea?: ProjectLifeArea;
  kpis: Array<Pick<ProjectKpi, "label" | "value">>;
  deliverables: Array<Pick<ProjectDeliverable, "text" | "done">>;
};

export type TaskToSubprojectSource = Pick<
  Task,
  "id" | "title" | "dueDate" | "project" | "projectId"
>;

const KEY = "alphacore_projects";

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function sanitizeOptionalId(value?: string): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

function isProjectKind(value: string | undefined): value is ProjectKind {
  return value === "project" || value === "category";
}

function isProjectLifeArea(value: string | undefined): value is ProjectLifeArea {
  return (
    value === "work" ||
    value === "health" ||
    value === "family" ||
    value === "operations" ||
    value === "reflection" ||
    value === "recovery"
  );
}

function inferProjectLifeArea(project: Pick<Project, "name" | "accent">): ProjectLifeArea {
  const label = normalizeName(project.name).toLowerCase();

  if (/kinderly|heys|work|studio|growth|product|launch|sales|pricing|marketing/u.test(label)) {
    return "work";
  }
  if (/health|run|sleep|stretch|wellness|здоров|пробеж|трен|спорт|мед/u.test(label)) {
    return "health";
  }
  if (/family|день рождения|minecraft|дани|dani|сем|реб|child/u.test(label)) {
    return "family";
  }
  if (/ops|admin|cleanup|operations|операц|уборк|документ|finance|налог/u.test(label)) {
    return "operations";
  }
  if (/review|retro|reflect|journal|weekly|осмыс|рефлекс|ревью/u.test(label)) {
    return "reflection";
  }
  if (/personal|rest|recovery|личн|отдых|сон/u.test(label)) {
    return "recovery";
  }

  return project.accent === "teal"
    ? "health"
    : project.accent === "rose"
      ? "operations"
      : project.accent === "orange"
        ? "reflection"
        : project.accent === "violet"
          ? "recovery"
          : "work";
}

function resolveProjectLifeArea(
  project: Project,
  projectById: Map<string, Project>,
  seen = new Set<string>(),
): ProjectLifeArea {
  if (isProjectLifeArea(project.lifeArea)) {
    return project.lifeArea;
  }

  if (seen.has(project.id)) {
    return inferProjectLifeArea(project);
  }

  seen.add(project.id);

  if (project.parentProjectId) {
    const parent = projectById.get(project.parentProjectId);
    if (parent) {
      return resolveProjectLifeArea(parent, projectById, seen);
    }
  }

  return inferProjectLifeArea(project);
}

export function projectAccentForLifeArea(area: ProjectLifeArea): ProjectAccent {
  return PROJECT_ACCENT_BY_AREA[area];
}

function createProjectMap(projects: Project[]): Map<string, Project> {
  return new Map(projects.map((project) => [project.id, project]));
}

function normalizeProjects(projects: Project[]): Project[] {
  const projectById = createProjectMap(projects);

  return [...projects]
    .map((project) => {
      const parentProjectId = sanitizeOptionalId(project.parentProjectId);
      const lifeArea = resolveProjectLifeArea(project, projectById);

      return {
        ...project,
        kind: isProjectKind(project.kind) ? project.kind : "project",
        lifeArea,
        accent: project.accent ?? projectAccentForLifeArea(lifeArea),
        parentProjectId:
          parentProjectId && parentProjectId !== project.id && projectById.has(parentProjectId)
            ? parentProjectId
            : undefined,
        sourceTaskId: sanitizeOptionalId(project.sourceTaskId),
      };
    })
    .sort((a, b) => {
      return (
        (a.order ?? Number.MAX_SAFE_INTEGER) -
          (b.order ?? Number.MAX_SAFE_INTEGER) ||
        a.createdAt.localeCompare(b.createdAt)
      );
    })
    .map((project, index) => ({
      ...project,
      order: index,
    }));
}

function nowIso(): string {
  return new Date().toISOString();
}

function formatShortDate(dateKey?: string): string | null {
  if (!dateKey) return null;

  const parsed = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
  }).format(parsed);
}

function mapKpis(kpis: Array<Pick<ProjectKpi, "label" | "value">>): ProjectKpi[] {
  return kpis
    .filter((k) => k.label.trim() || k.value.trim())
    .map((k) => ({
      id: uid(),
      label: k.label.trim(),
      value: k.value.trim(),
    }));
}

function mapDeliverables(
  deliverables: Array<Pick<ProjectDeliverable, "text" | "done">>,
): ProjectDeliverable[] {
  return deliverables
    .filter((d) => d.text.trim())
    .map((d) => ({
      id: uid(),
      text: d.text.trim(),
      done: d.done,
    }));
}

function buildChildrenByParentId(projects: Project[]): Map<string, Project[]> {
  const childrenByParentId = new Map<string, Project[]>();

  for (const project of projects) {
    if (!project.parentProjectId) continue;

    const siblings = childrenByParentId.get(project.parentProjectId) ?? [];
    siblings.push(project);
    childrenByParentId.set(project.parentProjectId, siblings);
  }

  for (const children of childrenByParentId.values()) {
    children.sort(
      (left, right) =>
        left.order - right.order || left.createdAt.localeCompare(right.createdAt),
    );
  }

  return childrenByParentId;
}

function collectProjectTreeIds(projectId: string, projects: Project[]): Set<string> {
  const childrenByParentId = buildChildrenByParentId(projects);
  const ids = new Set<string>();

  const visit = (currentId: string) => {
    if (ids.has(currentId)) return;
    ids.add(currentId);

    for (const child of childrenByParentId.get(currentId) ?? []) {
      visit(child.id);
    }
  };

  visit(projectId);
  return ids;
}

function moveProjectBlock(
  projects: Project[],
  activeId: string,
  targetId: string,
  placement: "before" | "after",
): Project[] {
  const activeProject = projects.find((project) => project.id === activeId);
  const targetProject = projects.find((project) => project.id === targetId);

  if (!activeProject || !targetProject) return projects;
  if ((activeProject.parentProjectId ?? "") !== (targetProject.parentProjectId ?? "")) {
    return projects;
  }

  const activeBlockIds = collectProjectTreeIds(activeId, projects);
  if (activeBlockIds.has(targetId)) return projects;

  const targetBlockIds = collectProjectTreeIds(targetId, projects);
  const activeBlock = projects.filter((project) => activeBlockIds.has(project.id));
  const remainder = projects.filter((project) => !activeBlockIds.has(project.id));

  const insertIndex =
    placement === "before"
      ? remainder.findIndex((project) => project.id === targetId)
      : (() => {
          let lastTargetIndex = -1;

          remainder.forEach((project, index) => {
            if (targetBlockIds.has(project.id)) {
              lastTargetIndex = index;
            }
          });

          return lastTargetIndex >= 0 ? lastTargetIndex + 1 : -1;
        })();

  if (insertIndex < 0) return projects;

  const next = [...remainder];
  next.splice(insertIndex, 0, ...activeBlock);
  return next;
}

function resolveParentProject(
  task: TaskToSubprojectSource,
  projects: Project[],
  explicitParentProjectId?: string,
): Project | null {
  const projectById = createProjectMap(projects);

  if (explicitParentProjectId) {
    return projectById.get(explicitParentProjectId) ?? null;
  }

  if (task.projectId) {
    return projectById.get(task.projectId) ?? null;
  }

  const normalizedTaskProject = normalizeName(task.project ?? "").toLowerCase();
  if (!normalizedTaskProject) return null;

  return (
    projects.find(
      (project) => normalizeName(project.name).toLowerCase() === normalizedTaskProject,
    ) ?? null
  );
}

const DEFAULT_PROJECTS: Project[] = [
  {
    id: "kinderly",
    order: 0,
    name: "Kinderly",
    kind: "project",
    lifeArea: "work",
    description:
      "Студия детских праздников. Подпроекты: PVA, Pricing, воронка бронирования.",
    status: "yellow",
    accent: "sky",
    kpis: [
      { id: "kinderly-kpi-1", label: "CR1", value: "pricing → lead" },
      { id: "kinderly-kpi-2", label: "TTR", value: "время ответа на заявку" },
      { id: "kinderly-kpi-3", label: "CR2", value: "lead → confirmed date" },
    ],
    deliverables: [
      { id: "kinderly-del-1", text: "Карта воронки и точки потерь", done: false },
      { id: "kinderly-del-2", text: "Финальная структура pricing-лендинга", done: false },
      { id: "kinderly-del-3", text: "Шаблон заявки на проверку даты", done: false },
      { id: "kinderly-del-4", text: "Таблица статусов заявок", done: false },
    ],
    nextStep: "Собрать карту воронки + точки потерь",
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
  },
  {
    id: "heys",
    order: 1,
    name: "HEYS",
    kind: "project",
    lifeArea: "work",
    description:
      "Умный трекер здоровья и питания. Стадия: тестирование + оргподготовка.",
    status: "yellow",
    accent: "orange",
    kpis: [
      { id: "heys-kpi-1", label: "CR1", value: "visitor → lead" },
      { id: "heys-kpi-2", label: "CAC", value: "стоимость привлечения" },
      { id: "heys-kpi-3", label: "Орг-блок", value: "ЮKassa / ИП / ОКВЭД" },
    ],
    deliverables: [
      { id: "heys-del-1", text: "Чеклист ЮKassa с этапами", done: false },
      { id: "heys-del-2", text: "Юридическая карта (ИП/ОКВЭД/АУСН)", done: false },
      { id: "heys-del-3", text: "ТЗ на лендинг v1", done: false },
      { id: "heys-del-4", text: "План поиска первых клиентов", done: false },
    ],
    nextStep: "Закрыть чеклист ЮKassa / ИП / ОКВЭД",
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
  },
  {
    id: "bday",
    order: 2,
    name: "ДР Minecraft",
    kind: "project",
    lifeArea: "family",
    description:
      "День рождения Дани, 1 мая 2026. Тема — Minecraft. Локация: Kinderly.",
    status: "yellow",
    accent: "violet",
    kpis: [
      { id: "bday-kpi-1", label: "Дата", value: "1 мая 2026" },
      { id: "bday-kpi-2", label: "Бюджет", value: "определить" },
      { id: "bday-kpi-3", label: "Гости", value: "определить" },
    ],
    deliverables: [
      { id: "bday-del-1", text: "Сценарий квестов для детей", done: false },
      { id: "bday-del-2", text: "Торт-крипер (рецепт + ингредиенты)", done: false },
      { id: "bday-del-3", text: "Фотозона Minecraft", done: false },
      { id: "bday-del-4", text: "Список реквизита + закупки", done: false },
      { id: "bday-del-5", text: "Тайминг программы праздника", done: false },
    ],
    nextStep: "Финализировать сценарий квестов и реквизит",
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
  },
];

export const PROJECT_ACCENT_CLS: Record<ProjectAccent, string> = {
  sky: "border-sky-500/25 bg-gradient-to-br from-sky-950/15 to-zinc-950",
  orange: "border-orange-500/25 bg-gradient-to-br from-orange-950/15 to-zinc-950",
  violet: "border-violet-500/25 bg-gradient-to-br from-violet-950/15 to-zinc-950",
  teal: "border-teal-500/25 bg-gradient-to-br from-teal-950/15 to-zinc-950",
  rose: "border-rose-500/25 bg-gradient-to-br from-rose-950/15 to-zinc-950",
};

export function getProjects(): Project[] {
  return normalizeProjects(lsGet<Project[]>(KEY, DEFAULT_PROJECTS));
}

export function getProjectById(
  projectId: string,
  projects: Project[] = getProjects(),
): Project | null {
  return projects.find((project) => project.id === projectId) ?? null;
}

export function isSubproject(project: Pick<Project, "parentProjectId">): boolean {
  return Boolean(project.parentProjectId);
}

export function getProjectParent(
  project: Pick<Project, "parentProjectId">,
  projects: Project[] = getProjects(),
): Project | null {
  if (!project.parentProjectId) return null;
  return getProjectById(project.parentProjectId, projects);
}

export function getProjectLineage(
  project: Project,
  projects: Project[] = getProjects(),
): Project[] {
  const projectById = createProjectMap(projects);
  const lineage: Project[] = [];
  const seen = new Set<string>();

  let current: Project | null = project;

  while (current && !seen.has(current.id)) {
    lineage.unshift(current);
    seen.add(current.id);
    current = current.parentProjectId ? projectById.get(current.parentProjectId) ?? null : null;
  }

  return lineage;
}

export function getProjectDisplayName(
  project: Project,
  projects: Project[] = getProjects(),
): string {
  return getProjectLineage(project, projects)
    .map((item) => item.name)
    .join(" / ");
}

export function getProjectRootId(
  projectId: string,
  projects: Project[] = getProjects(),
): string {
  const projectById = createProjectMap(projects);
  const seen = new Set<string>();

  let current = projectById.get(projectId) ?? null;

  while (current?.parentProjectId && !seen.has(current.parentProjectId)) {
    seen.add(current.id);
    current = projectById.get(current.parentProjectId) ?? current;
  }

  return current?.id ?? projectId;
}

export function getChildProjects(
  parentProjectId: string,
  projects: Project[] = getProjects(),
): Project[] {
  return projects
    .filter((project) => project.parentProjectId === parentProjectId)
    .sort(
      (left, right) =>
        left.order - right.order || left.createdAt.localeCompare(right.createdAt),
    );
}

export function findProjectBySourceTaskId(
  taskId: string,
  projects: Project[] = getProjects(),
): Project | null {
  return projects.find((project) => project.sourceTaskId === taskId) ?? null;
}

function save(projects: Project[]): void {
  lsSet(KEY, normalizeProjects(projects));
}

export function addProject(input: ProjectInput): Project {
  const projects = getProjects();
  const now = nowIso();
  const lifeArea = input.lifeArea ?? inferProjectLifeArea({ name: input.name, accent: input.accent });
  const project: Project = {
    id: uid(),
    order: projects.length,
    name: normalizeName(input.name),
    kind: input.kind ?? "project",
    lifeArea,
    description: input.description.trim(),
    status: input.status,
    accent: input.accent ?? projectAccentForLifeArea(lifeArea),
    kpis: mapKpis(input.kpis),
    deliverables: mapDeliverables(input.deliverables),
    nextStep: input.nextStep.trim(),
    parentProjectId: sanitizeOptionalId(input.parentProjectId),
    sourceTaskId: sanitizeOptionalId(input.sourceTaskId),
    createdAt: now,
    updatedAt: now,
  };

  const next = [...projects];
  const insertIndex = project.parentProjectId
    ? Math.max(0, next.findIndex((item) => item.id === project.parentProjectId) + 1)
    : 0;

  next.splice(insertIndex, 0, project);
  save(next);
  return project;
}

export function updateProject(id: string, patch: Partial<ProjectInput>): void {
  const projects = getProjects().map((project) => {
    if (project.id !== id) return project;
    const nextLifeArea = patch.lifeArea ?? project.lifeArea;
    return {
      ...project,
      ...(patch.name != null ? { name: normalizeName(patch.name) } : {}),
      ...(patch.kind != null ? { kind: patch.kind } : {}),
      ...(patch.lifeArea != null ? { lifeArea: patch.lifeArea } : {}),
      ...(patch.description != null ? { description: patch.description.trim() } : {}),
      ...(patch.status != null ? { status: patch.status } : {}),
      ...(patch.accent != null
        ? { accent: patch.accent }
        : patch.lifeArea != null
          ? { accent: projectAccentForLifeArea(nextLifeArea) }
          : {}),
      ...(patch.nextStep != null ? { nextStep: patch.nextStep.trim() } : {}),
      ...("parentProjectId" in patch
        ? { parentProjectId: sanitizeOptionalId(patch.parentProjectId) }
        : {}),
      ...("sourceTaskId" in patch
        ? { sourceTaskId: sanitizeOptionalId(patch.sourceTaskId) }
        : {}),
      ...(patch.kpis != null ? { kpis: mapKpis(patch.kpis) } : {}),
      ...(patch.deliverables != null ? { deliverables: mapDeliverables(patch.deliverables) } : {}),
      updatedAt: nowIso(),
    };
  });
  save(projects);
}

export function deleteProject(id: string): void {
  const projects = getProjects();
  const target = projects.find((project) => project.id === id) ?? null;
  const fallbackParentId = target?.parentProjectId;

  save(
    projects
      .filter((project) => project.id !== id)
      .map((project) =>
        project.parentProjectId === id
          ? {
              ...project,
              parentProjectId: fallbackParentId,
              updatedAt: nowIso(),
            }
          : project,
      ),
  );
}

export function toggleDeliverable(projectId: string, deliverableId: string): void {
  const projects = getProjects().map((project) => {
    if (project.id !== projectId) return project;
    return {
      ...project,
      deliverables: project.deliverables.map((item) =>
        item.id === deliverableId ? { ...item, done: !item.done } : item,
      ),
      updatedAt: nowIso(),
    };
  });
  save(projects);
}

export function cycleProjectStatus(projectId: string): void {
  const order: StatusTone[] = ["green", "yellow", "red"];
  const projects = getProjects().map((project) => {
    if (project.id !== projectId) return project;
    const next = order[(order.indexOf(project.status) + 1) % order.length];
    return { ...project, status: next, updatedAt: nowIso() };
  });
  save(projects);
}

export function projectProgress(project: Project): number {
  const total = project.deliverables.length;
  if (total === 0) return 0;
  const done = project.deliverables.filter((item) => item.done).length;
  return Math.round((done / total) * 100);
}

export function attentionProjects(projects: Project[] = getProjects()): Project[] {
  return [...projects].filter(
    (project) => project.kind === "project" && project.status !== "green",
  );
}

export function convertTaskToSubproject(input: {
  task: TaskToSubprojectSource;
  parentProjectId?: string;
}): Project | null {
  const title = normalizeName(input.task.title);
  if (!title) return null;

  const projects = getProjects();
  const parentProject = resolveParentProject(input.task, projects, input.parentProjectId);

  if (!parentProject) return null;

  const existingFromTask = findProjectBySourceTaskId(input.task.id, projects);
  if (existingFromTask) return existingFromTask;

  const existingSibling = projects.find(
    (project) =>
      project.parentProjectId === parentProject.id &&
      normalizeName(project.name).toLowerCase() === title.toLowerCase(),
  );

  if (existingSibling) {
    updateProject(existingSibling.id, { sourceTaskId: input.task.id });
    return getProjectById(existingSibling.id);
  }

  const dueLabel = formatShortDate(input.task.dueDate);

  return addProject({
    name: title,
    kind: "project",
    lifeArea: parentProject.lifeArea,
    description: `Выделено из проекта «${parentProject.name}». Исходная задача выросла до отдельного подпроекта.${dueLabel ? ` Исходный срок: ${dueLabel}.` : ""}`,
    status: parentProject.status === "red" ? "red" : "yellow",
    accent: parentProject.accent,
    nextStep: dueLabel
      ? `Разбить подпроект на дочерние задачи до ${dueLabel}`
      : "Разбить подпроект на первые дочерние задачи",
    kpis: [],
    deliverables: [{ text: "Разбить подпроект на 2–5 конкретных задач", done: false }],
    parentProjectId: parentProject.id,
    sourceTaskId: input.task.id,
  });
}

export function reorderProjects(activeId: string, targetId: string): void {
  if (activeId === targetId) return;

  const projects = getProjects();
  const next = moveProjectBlock(projects, activeId, targetId, "before");
  if (next === projects) return;
  save(next);
}

export function moveProject(projectId: string, direction: -1 | 1): void {
  const projects = getProjects();

  const currentProject = projects.find((project) => project.id === projectId);
  if (!currentProject) return;

  const siblingProjects = projects
    .filter(
      (project) =>
        (project.parentProjectId ?? "") === (currentProject.parentProjectId ?? ""),
    )
    .sort(
      (left, right) =>
        left.order - right.order || left.createdAt.localeCompare(right.createdAt),
    );

  const index = siblingProjects.findIndex((project) => project.id === projectId);
  const targetProject = siblingProjects[index + direction];

  if (index < 0 || !targetProject) return;

  const next = moveProjectBlock(
    projects,
    projectId,
    targetProject.id,
    direction === -1 ? "before" : "after",
  );

  if (next === projects) return;
  save(next);
}
