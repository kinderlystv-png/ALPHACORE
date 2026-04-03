export const STORAGE_KEYS = [
  "alphacore_tasks",
  "alphacore_notes",
  "alphacore_habits",
  "alphacore_medical",
  "alphacore_projects",
  "alphacore_journal",
  "alphacore_agent_prompt_feedback",
  "alphacore_pomodoro",
  "alphacore_schedule_custom",
  "alphacore_schedule_overrides",
] as const;

export type StorageKey = (typeof STORAGE_KEYS)[number];

export function isStorageKey(value: string): value is StorageKey {
  return STORAGE_KEYS.includes(value as StorageKey);
}