"use client";

import { useCallback, useState } from "react";
import type React from "react";

import {
  DEFAULT_CUSTOM_DURATION_MIN,
  HOUR_END,
  HOUR_START,
  STEP_MIN,
  clamp,
  minutesToCalendarTime,
  toneFromArea,
  type EditableSlotDraft,
  type DragState,
} from "@/components/calendar-grid-types";
import { clearTaskDragData, readTaskDragId, writeTaskDragData } from "@/lib/dashboard-events";
import { taskArea } from "@/lib/life-areas";
import {
  upsertTaskSlot,
  type ScheduleSlot,
  type ScheduleTone,
} from "@/lib/schedule";
import { type Task, updateTask } from "@/lib/tasks";

type UseCalendarTaskDragAndDropParams = {
  linkedTasksById: Map<string, Task>;
  getBlockingSlot: (
    draft: EditableSlotDraft,
    originalSlot: ScheduleSlot | null,
  ) => ScheduleSlot | null;
  onVersionBump: () => void;
};

function inferTaskSlotTone(task: Task): ScheduleTone {
  const projectLabel = `${task.projectId ?? ""} ${task.project ?? ""}`.toLowerCase();

  if (projectLabel.includes("kinderly")) return "kinderly";
  if (projectLabel.includes("heys")) return "heys";

  return toneFromArea(taskArea(task));
}

function buildTaskSlotTags(task: Task): string[] {
  const projectTag = (task.projectId ?? task.project ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return [...new Set([
    "task",
    "task-slot",
    task.priority,
    task.status,
    ...(projectTag ? [projectTag] : []),
  ])];
}

function getTaskDropStartMinutes(
  event: React.DragEvent<HTMLDivElement>,
  hour: number,
): number {
  const rect = event.currentTarget.getBoundingClientRect();
  const pointerOffset = event.clientY - rect.top;
  const minuteOffset = pointerOffset >= rect.height / 2 ? STEP_MIN : 0;

  return clamp(
    hour * 60 + minuteOffset,
    HOUR_START * 60,
    HOUR_END * 60 - DEFAULT_CUSTOM_DURATION_MIN,
  );
}

export function useCalendarTaskDragAndDrop({
  linkedTasksById,
  getBlockingSlot,
  onVersionBump,
}: UseCalendarTaskDragAndDropParams) {
  const [drag, setDrag] = useState<DragState>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const moveTaskToDay = useCallback((taskId: string, targetDay: string) => {
    const task = linkedTasksById.get(taskId);
    if (!task) return false;
    if (task.dueDate === targetDay) return false;

    updateTask(taskId, { dueDate: targetDay });
    return true;
  }, [linkedTasksById]);

  const scheduleTaskFromDrop = useCallback((
    taskId: string,
    targetDay: string,
    startMinutes: number,
  ) => {
    const task = linkedTasksById.get(taskId);
    if (!task) return false;

    const draft: EditableSlotDraft = {
      id: null,
      date: targetDay,
      start: minutesToCalendarTime(startMinutes),
      end: minutesToCalendarTime(startMinutes + DEFAULT_CUSTOM_DURATION_MIN),
      title: task.title,
      tone: inferTaskSlotTone(task),
      tags: buildTaskSlotTags(task),
      kind: "task",
    };

    const blockingSlot = getBlockingSlot(draft, null);
    if (blockingSlot) {
      return false;
    }

    const scheduled = upsertTaskSlot({
      taskId,
      date: draft.date,
      start: draft.start,
      end: draft.end,
      title: draft.title,
      tone: draft.tone,
      tags: draft.tags,
    });

    if (!scheduled) return false;

    onVersionBump();
    return true;
  }, [getBlockingSlot, linkedTasksById, onVersionBump]);

  const beginTaskDrag = useCallback((
    event: React.DragEvent<HTMLElement>,
    taskId: string,
    originDay: string,
  ) => {
    event.dataTransfer.effectAllowed = "move";
    writeTaskDragData(event.dataTransfer, taskId);
    setDrag({ type: "task", taskId, originDay });
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent, dayKey: string) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(dayKey);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropTarget(null);
  }, []);

  const handleDropToDayHeader = useCallback(
    (event: React.DragEvent, targetDay: string) => {
      event.preventDefault();
      setDropTarget(null);
      const taskId = readTaskDragId(event.dataTransfer) ?? drag?.taskId ?? null;
      clearTaskDragData();
      if (!taskId) return;

      moveTaskToDay(taskId, targetDay);
      setDrag(null);
    },
    [drag?.taskId, moveTaskToDay],
  );

  const handleDropToTimeCell = useCallback(
    (event: React.DragEvent<HTMLDivElement>, targetDay: string, hour: number) => {
      event.preventDefault();
      setDropTarget(null);
      const taskId = readTaskDragId(event.dataTransfer) ?? drag?.taskId ?? null;
      clearTaskDragData();
      if (!taskId) return;

      const startMinutes = getTaskDropStartMinutes(event, hour);
      scheduleTaskFromDrop(taskId, targetDay, startMinutes);
      setDrag(null);
    },
    [drag?.taskId, scheduleTaskFromDrop],
  );

  const endTaskDrag = useCallback(() => {
    clearTaskDragData();
    setDrag(null);
    setDropTarget(null);
  }, []);

  return {
    drag,
    dropTarget,
    beginTaskDrag,
    endTaskDrag,
    handleDragOver,
    handleDragLeave,
    handleDropToDayHeader,
    handleDropToTimeCell,
  };
}
