"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import {
  HOUR_END,
  QUICK_MENU_ESTIMATED_HEIGHT,
  clamp,
  copyTitle,
  minutesToCalendarTime,
  type EditableSlotDraft,
  type QuickMenuState,
} from "@/components/calendar-grid-types";
import { shiftDateKey } from "@/lib/calendar-slot-attention";
import { getProjects, type Project } from "@/lib/projects";
import {
  addCustomEvent,
  getScheduleWeekday,
  isRecurringScheduleSlot,
  normalizeScheduleRepeatDays,
  removeEditableScheduleSlotWithScope,
  saveEditableScheduleSlotWithScope,
  toggleScheduleSlotApproval,
  unscheduleEditableScheduleSlotWithScope,
  timeToMinutes,
  type ScheduleRepeat,
  type ScheduleRepeatDay,
  type ScheduleSeriesScope,
  type ScheduleSlot,
} from "@/lib/schedule";
import type { Task } from "@/lib/tasks";

type UseCalendarQuickMenuParams = {
  gridRef: RefObject<HTMLDivElement | null>;
  linkedTasksById: Map<string, Task>;
  hideDesktopSlotHint: () => void;
  onVersionBump: () => void;
  onClearHoveredSlot: () => void;
};

function findProjectIdByLabel(projects: Project[], label?: string | null): string {
  if (!label) return "";
  const match = projects.find((project) => project.name === label);
  return match?.id ?? "";
}

function getSlotProjectId(
  slot: Pick<ScheduleSlot, "projectId" | "project">,
  linkedTask: Pick<Task, "projectId" | "project"> | null,
  projects: Project[],
): string {
  if (slot.projectId) return slot.projectId;
  if (linkedTask?.projectId) return linkedTask.projectId;
  return findProjectIdByLabel(projects, slot.project ?? linkedTask?.project);
}

export function useCalendarQuickMenu({
  gridRef,
  linkedTasksById,
  hideDesktopSlotHint,
  onVersionBump,
  onClearHoveredSlot,
}: UseCalendarQuickMenuParams) {
  const [quickMenu, setQuickMenu] = useState<QuickMenuState | null>(null);
  const quickMenuRef = useRef<HTMLDivElement>(null);

  const clearQuickMenu = useCallback(() => {
    setQuickMenu(null);
  }, []);

  const closeQuickMenu = useCallback(() => {
    hideDesktopSlotHint();
    clearQuickMenu();
  }, [clearQuickMenu, hideDesktopSlotHint]);

  const openQuickMenu = useCallback(
    (element: HTMLElement, slot: ScheduleSlot) => {
      const rect = element.getBoundingClientRect();
      const mobile = window.innerWidth < 640;
      const desktopPanelWidth = Math.min(48 * 16, Math.max(320, window.innerWidth - 24));
      const desktopHalfWidth = desktopPanelWidth / 2;
      const maxTop = Math.max(12, window.innerHeight - QUICK_MENU_ESTIMATED_HEIGHT - 12);
      const linkedTask = slot.taskId ? linkedTasksById.get(slot.taskId) ?? null : null;
      const projects = getProjects();

      onClearHoveredSlot();
      hideDesktopSlotHint();
      setQuickMenu({
        slot,
        top: clamp(rect.top + Math.min(rect.height, 28) + 10, 12, maxTop),
        left: clamp(
          rect.left + rect.width / 2,
          16 + desktopHalfWidth,
          window.innerWidth - 16 - desktopHalfWidth,
        ),
        mobile,
        draftTitle: slot.title,
        draftTone: slot.tone,
        draftKind: slot.kind === "event" ? "event" : "task",
        draftProjectId: getSlotProjectId(slot, linkedTask, projects),
        draftRepeat: slot.repeat ?? "once",
        draftRepeatDays: normalizeScheduleRepeatDays(
          slot.repeat ?? "once",
          slot.date,
          slot.repeatDays,
        ) ?? [getScheduleWeekday(slot.date)],
        draftSeriesScope: isRecurringScheduleSlot(slot) ? "single" : "following",
      });
    },
    [hideDesktopSlotHint, linkedTasksById, onClearHoveredSlot],
  );

  const updateQuickMenuDraft = useCallback(
    (
      patch: Partial<
        Pick<
          QuickMenuState,
          | "draftTitle"
          | "draftTone"
          | "draftKind"
          | "draftProjectId"
          | "draftRepeat"
          | "draftRepeatDays"
          | "draftSeriesScope"
        >
      >,
    ) => {
      setQuickMenu((current) => (current ? { ...current, ...patch } : current));
    },
    [],
  );

  const applyQuickSlotPatch = useCallback(
    (
      slot: ScheduleSlot,
      patch: Partial<EditableSlotDraft>,
      scope: ScheduleSeriesScope = "single",
    ) => {
      saveEditableScheduleSlotWithScope(slot, {
        date: patch.date,
        start: patch.start,
        end: patch.end,
        title: patch.title,
        tone: patch.tone,
        tags: patch.tags,
      }, scope);
      onVersionBump();
      clearQuickMenu();
    },
    [clearQuickMenu, onVersionBump],
  );

  const saveQuickMenuDraft = useCallback(() => {
    if (!quickMenu) return;

    const nextTitle = quickMenu.draftTitle.trim();
    if (!nextTitle) return;

    const projects = getProjects();
    const selectedProject = projects.find((project) => project.id === quickMenu.draftProjectId);
    const currentProjectId = getSlotProjectId(
      quickMenu.slot,
      quickMenu.slot.taskId ? linkedTasksById.get(quickMenu.slot.taskId) ?? null : null,
      projects,
    );

    const isCustomSlot = quickMenu.slot.id.startsWith("custom-");
    const nextKind = isCustomSlot ? quickMenu.draftKind : quickMenu.slot.kind ?? "event";
    const nextRepeat: ScheduleRepeat = quickMenu.draftRepeat;
    const currentRepeatDays = normalizeScheduleRepeatDays(
      quickMenu.slot.repeat ?? "once",
      quickMenu.slot.date,
      quickMenu.slot.repeatDays,
    ) ?? [getScheduleWeekday(quickMenu.slot.date)];
    const nextRepeatDays: ScheduleRepeatDay[] = nextRepeat === "weekly"
      ? quickMenu.draftRepeatDays
      : [];

    if (nextRepeat === "weekly" && nextRepeatDays.length === 0) {
      return;
    }

    if (
      nextTitle === quickMenu.slot.title &&
      quickMenu.draftTone === quickMenu.slot.tone &&
      nextKind === (quickMenu.slot.kind ?? "event") &&
      quickMenu.draftProjectId === currentProjectId &&
      nextRepeat === (quickMenu.slot.repeat ?? "once") &&
      JSON.stringify(nextRepeatDays) === JSON.stringify(currentRepeatDays)
    ) {
      clearQuickMenu();
      return;
    }

    saveEditableScheduleSlotWithScope(quickMenu.slot, {
      title: nextTitle,
      tone: quickMenu.draftTone,
      kind: nextKind,
      projectId: selectedProject?.id,
      project: selectedProject?.name,
      repeat: nextRepeat,
      repeatDays: nextRepeat === "weekly" ? nextRepeatDays : undefined,
    }, quickMenu.draftSeriesScope);
    onVersionBump();
    clearQuickMenu();
  }, [clearQuickMenu, linkedTasksById, onVersionBump, quickMenu]);

  const duplicateQuickSlot = useCallback(() => {
    if (!quickMenu) return;

    const duration = timeToMinutes(quickMenu.slot.end) - timeToMinutes(quickMenu.slot.start);
    const sourceStart = timeToMinutes(quickMenu.slot.start);
    const sourceEnd = timeToMinutes(quickMenu.slot.end);
    const sameDayStart = sourceEnd;
    const sameDayEnd = sameDayStart + duration;
    const nextTitle = quickMenu.draftTitle.trim() || quickMenu.slot.title;

    const duplicateDate =
      sameDayEnd <= HOUR_END * 60 ? quickMenu.slot.date : shiftDateKey(quickMenu.slot.date, 1);
    const duplicateStart = sameDayEnd <= HOUR_END * 60 ? sameDayStart : sourceStart;
    const duplicateEnd = sameDayEnd <= HOUR_END * 60 ? sameDayEnd : sourceEnd;

    addCustomEvent({
      date: duplicateDate,
      start: minutesToCalendarTime(duplicateStart),
      end: minutesToCalendarTime(duplicateEnd),
      title: copyTitle(nextTitle),
      tone: quickMenu.draftTone,
      tags: [...new Set([...quickMenu.slot.tags, "copy"])],
      kind: quickMenu.draftKind,
      taskId: null,
      projectId: quickMenu.draftProjectId || undefined,
      project: getProjects().find((project) => project.id === quickMenu.draftProjectId)?.name,
    });
    onVersionBump();
    clearQuickMenu();
  }, [clearQuickMenu, onVersionBump, quickMenu]);

  const unscheduleQuickSlot = useCallback(
    (slot: ScheduleSlot, scope: ScheduleSeriesScope = "single") => {
      unscheduleEditableScheduleSlotWithScope(slot, scope);
      onVersionBump();
      clearQuickMenu();
    },
    [clearQuickMenu, onVersionBump],
  );

  const deleteQuickSlot = useCallback(
    (slot: ScheduleSlot, scope: ScheduleSeriesScope = "single") => {
      removeEditableScheduleSlotWithScope(slot, scope);
      onVersionBump();
      clearQuickMenu();
    },
    [clearQuickMenu, onVersionBump],
  );

  const toggleQuickSlotApproval = useCallback(
    (slot: ScheduleSlot) => {
      toggleScheduleSlotApproval(slot);
      onVersionBump();
    },
    [onVersionBump],
  );

  useEffect(() => {
    if (!quickMenu) return;
    const container = gridRef.current;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && quickMenuRef.current?.contains(target)) return;
      clearQuickMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearQuickMenu();
    };

    const handleScroll = () => clearQuickMenu();

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    container?.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      container?.removeEventListener("scroll", handleScroll);
    };
  }, [clearQuickMenu, gridRef, quickMenu]);

  return {
    quickMenu,
    quickMenuRef,
    clearQuickMenu,
    closeQuickMenu,
    openQuickMenu,
    updateQuickMenuDraft,
    applyQuickSlotPatch,
    saveQuickMenuDraft,
    duplicateQuickSlot,
    unscheduleQuickSlot,
    deleteQuickSlot,
    toggleQuickSlotApproval,
  };
}
