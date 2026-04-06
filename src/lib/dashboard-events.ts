export const POMODORO_FOCUS_EVENT = "alphacore:pomodoro-focus-task";
export const TASK_DRAG_MIME = "application/x-alphacore-task";

let activeTaskDragId: string | null = null;
let dragCleanupAttached = false;

function ensureTaskDragCleanup(): void {
  if (dragCleanupAttached || typeof window === "undefined") return;

  const clear = () => {
    activeTaskDragId = null;
  };

  window.addEventListener("dragend", clear);
  window.addEventListener("drop", clear);
  dragCleanupAttached = true;
}

export type PomodoroFocusDetail = {
  taskId?: string;
  autoStart?: boolean;
};

export function writeTaskDragData(dataTransfer: DataTransfer, taskId: string): void {
  ensureTaskDragCleanup();
  activeTaskDragId = taskId;
  dataTransfer.setData(TASK_DRAG_MIME, taskId);
  dataTransfer.setData("text/plain", taskId);
}

export function readTaskDragId(dataTransfer: DataTransfer): string | null {
  return dataTransfer.getData(TASK_DRAG_MIME) || dataTransfer.getData("text/plain") || activeTaskDragId || null;
}

export function clearTaskDragData(): void {
  activeTaskDragId = null;
}
