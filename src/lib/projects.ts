import { lsGet, lsSet, uid } from "./storage";

export type StatusTone = "green" | "yellow" | "red";
export type ProjectAccent = "sky" | "orange" | "violet" | "teal" | "rose";

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
  description: string;
  status: StatusTone;
  accent: ProjectAccent;
  kpis: ProjectKpi[];
  deliverables: ProjectDeliverable[];
  nextStep: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectInput = Pick<
  Project,
  "name" | "description" | "status" | "accent" | "nextStep"
> & {
  kpis: Array<Pick<ProjectKpi, "label" | "value">>;
  deliverables: Array<Pick<ProjectDeliverable, "text" | "done">>;
};

const KEY = "alphacore_projects";

function normalizeProjects(projects: Project[]): Project[] {
  return [...projects]
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

const DEFAULT_PROJECTS: Project[] = [
  {
    id: "kinderly",
    order: 0,
    name: "Kinderly",
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

function save(projects: Project[]): void {
  lsSet(KEY, normalizeProjects(projects));
}

export function addProject(input: ProjectInput): Project {
  const projects = getProjects();
  const now = nowIso();
  const project: Project = {
    id: uid(),
    order: projects.length,
    name: input.name.trim(),
    description: input.description.trim(),
    status: input.status,
    accent: input.accent,
    kpis: mapKpis(input.kpis),
    deliverables: mapDeliverables(input.deliverables),
    nextStep: input.nextStep.trim(),
    createdAt: now,
    updatedAt: now,
  };
  projects.unshift(project);
  save(projects);
  return project;
}

export function updateProject(id: string, patch: Partial<ProjectInput>): void {
  const projects = getProjects().map((project) => {
    if (project.id !== id) return project;
    return {
      ...project,
      ...(patch.name != null ? { name: patch.name.trim() } : {}),
      ...(patch.description != null ? { description: patch.description.trim() } : {}),
      ...(patch.status != null ? { status: patch.status } : {}),
      ...(patch.accent != null ? { accent: patch.accent } : {}),
      ...(patch.nextStep != null ? { nextStep: patch.nextStep.trim() } : {}),
      ...(patch.kpis != null ? { kpis: mapKpis(patch.kpis) } : {}),
      ...(patch.deliverables != null ? { deliverables: mapDeliverables(patch.deliverables) } : {}),
      updatedAt: nowIso(),
    };
  });
  save(projects);
}

export function deleteProject(id: string): void {
  save(getProjects().filter((project) => project.id !== id));
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
  return [...projects].filter((project) => project.status !== "green");
}

export function reorderProjects(activeId: string, targetId: string): void {
  if (activeId === targetId) return;

  const projects = getProjects();
  const from = projects.findIndex((project) => project.id === activeId);
  const to = projects.findIndex((project) => project.id === targetId);

  if (from < 0 || to < 0) return;

  const next = [...projects];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  save(next);
}

export function moveProject(projectId: string, direction: -1 | 1): void {
  const projects = getProjects();
  const index = projects.findIndex((project) => project.id === projectId);
  const target = index + direction;

  if (index < 0 || target < 0 || target >= projects.length) return;

  const next = [...projects];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  save(next);
}
