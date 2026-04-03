export const POMODORO_FOCUS_EVENT = "alphacore:pomodoro-focus-task";
export const TASK_DRAG_MIME = "application/x-alphacore-task";

export type PomodoroFocusDetail = {
  taskId?: string;
  autoStart?: boolean;
};

export function writeTaskDragData(dataTransfer: DataTransfer, taskId: string): void {
  dataTransfer.setData(TASK_DRAG_MIME, taskId);
  dataTransfer.setData("text/plain", taskId);
}

export function readTaskDragId(dataTransfer: DataTransfer): string | null {
  return dataTransfer.getData(TASK_DRAG_MIME) || dataTransfer.getData("text/plain") || null;
}
