import type React from "react";

import { ProjectSelectManager } from "@/components/project-select-manager";
import { SlotCarryoverDecision } from "@/components/slot-carryover-decision";
import { SlotQuickRescheduleActions } from "@/components/slot-quick-reschedule-actions";
import {
  formatCompletionLabel,
} from "@/lib/calendar-slot-attention";
import {
  formatScheduleTimeRange,
  getScheduleSlotApprovalState,
  timeToMinutes,
  type ScheduleRepeat,
  type ScheduleSlot,
} from "@/lib/schedule";
import { toneColor } from "@/lib/life-areas";
import type { Project } from "@/lib/projects";
import type { Task } from "@/lib/tasks";

import {
  HOUR_START,
  HOUR_END,
  STEP_MIN,
  MIN_SLOT_MIN,
  QUICK_TONE_OPTIONS,
  minutesToCalendarTime,
  type DayColumn,
  type QuickMenuState,
} from "./calendar-grid-types";

/* ── Helpers to resolve project IDs / labels ── */

function findProjectIdByLabel(projects: Project[], label?: string | null): string {
  if (!label) return "";
  const match = projects.find((project) => project.name === label);
  return match?.id ?? "";
}

const QUICK_REPEAT_OPTIONS: Array<{
  value: ScheduleRepeat;
  label: string;
  meta: string;
}> = [
  { value: "once", label: "Один раз", meta: "без серии" },
  { value: "weekly", label: "Каждую неделю", meta: "+26 слотов" },
  { value: "monthly", label: "Каждый месяц", meta: "+12 слотов" },
];

const QUICK_REPEAT_LABEL: Record<ScheduleRepeat, string> = {
  once: "1×",
  weekly: "Каждую неделю",
  monthly: "Каждый месяц",
};
function getSlotProjectId(
  slot: Pick<ScheduleSlot, "projectId" | "project">,
  linkedTask: Pick<Task, "projectId" | "project"> | null,
  projects: Project[],
): string {
  if (slot.projectId) return slot.projectId;
  if (linkedTask?.projectId) return linkedTask.projectId;
  return findProjectIdByLabel(projects, slot.project ?? linkedTask?.project);
}

function getSlotProjectLabel(
  slot: Pick<ScheduleSlot, "projectId" | "project">,
  linkedTask: Pick<Task, "projectId" | "project"> | null,
  projectNameById: Map<string, string>,
): string | null {
  if (slot.projectId) return projectNameById.get(slot.projectId) ?? slot.project ?? null;
  if (linkedTask?.projectId) {
    return projectNameById.get(linkedTask.projectId) ?? linkedTask.project ?? slot.project ?? null;
  }
  return slot.project ?? linkedTask?.project ?? null;
}

/* ── Props ── */

export type CalendarQuickMenuProps = {
  menuRef: React.RefObject<HTMLDivElement | null>;
  quickMenu: QuickMenuState;
  linkedTasksById: Map<string, Task>;
  projects: Project[];
  projectNameById: Map<string, string>;
  columns: DayColumn[];
  today: string;
  onClose: () => void;
  onUpdateDraft: (patch: Partial<Pick<QuickMenuState, "draftTitle" | "draftTone" | "draftKind" | "draftProjectId" | "draftRepeat">>) => void;
  onSaveDraft: () => void;
  onDuplicate: () => void;
  onApplyPatch: (slot: ScheduleSlot, patch: Partial<Pick<ScheduleSlot, "start" | "end" | "date">>) => void;
  onDelete: (slot: ScheduleSlot) => void;
  onUnschedule: (slot: ScheduleSlot) => void;
  onToggleApproval: (slot: ScheduleSlot) => void;
  onVersionBump: () => void;
};

type QuickMenuMetaChipProps = {
  label: string;
  className?: string;
};

function QuickMenuMetaChip({ label, className }: QuickMenuMetaChipProps) {
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${className ?? "border-zinc-800 bg-zinc-900/70 text-zinc-300"}`}
      title={label}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}

type QuickActionButtonProps = {
  label: string;
  meta: string;
  disabled?: boolean;
  onClick: () => void;
};

function QuickActionButton({ label, meta, disabled = false, onClick }: QuickActionButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-xl border border-zinc-800 bg-zinc-950/80 px-2.5 py-2 text-left transition hover:border-zinc-600 hover:text-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="block text-[11px] font-semibold text-zinc-100">{label}</span>
      <span className="mt-0.5 block text-[10px] text-zinc-500">{meta}</span>
    </button>
  );
}

/* ── Component ── */

export function CalendarQuickMenu({
  menuRef,
  quickMenu,
  linkedTasksById,
  projects,
  projectNameById,
  columns,
  today,
  onClose,
  onUpdateDraft,
  onSaveDraft,
  onDuplicate,
  onApplyPatch,
  onDelete,
  onUnschedule,
  onToggleApproval,
  onVersionBump,
}: CalendarQuickMenuProps) {
  const slot = quickMenu.slot;
  const linkedTask = slot.taskId ? linkedTasksById.get(slot.taskId) ?? null : null;
  const currentProjectId = getSlotProjectId(slot, linkedTask, projects);
  const projectLabel = getSlotProjectLabel(slot, linkedTask, projectNameById);
  const draftProjectLabel = quickMenu.draftProjectId
    ? projectNameById.get(quickMenu.draftProjectId) ?? projectLabel
    : null;
  const isCustomSlot = slot.id.startsWith("custom-");
  const approvalState = getScheduleSlotApprovalState(slot);
  const requiresApproval = approvalState.requiresApproval;
  const isCompletedSlot = approvalState.isCompleted;
  const completionLabel = formatCompletionLabel(approvalState.completedAt);
  const startMin = timeToMinutes(slot.start);
  const endMin = timeToMinutes(slot.end);
  const durationMin = endMin - startMin;
  const draftTitle = quickMenu.draftTitle.trim();
  const draftRepeat = quickMenu.draftRepeat;
  const saveDisabled =
    !draftTitle ||
    (draftTitle === slot.title &&
      quickMenu.draftTone === slot.tone &&
      quickMenu.draftKind === (slot.kind === "event" ? "event" : "task") &&
      quickMenu.draftProjectId === currentProjectId &&
      draftRepeat === (slot.repeat ?? "once"));
  const earlierDisabled = startMin <= HOUR_START * 60;
  const laterDisabled = endMin >= HOUR_END * 60;
  const shorterDisabled = durationMin <= MIN_SLOT_MIN;
  const longerDisabled = endMin + STEP_MIN > HOUR_END * 60;
  const dayIndex = columns.findIndex((column) => column.key === slot.date);
  const prevDay = dayIndex > 0 ? columns[dayIndex - 1]?.key : null;
  const nextDay = dayIndex >= 0 && dayIndex < columns.length - 1 ? columns[dayIndex + 1]?.key : null;
  const shouldShowCarryoverDecision = !isCompletedSlot && slot.date < today;
  const shouldShowQuickReschedule = !isCompletedSlot && slot.date === today;
  const kindLabel = slot.kind === "event" ? "Событие" : slot.taskId ? "Задача" : "Слот";
  const statusChipLabel = requiresApproval
    ? isCompletedSlot
      ? completionLabel ?? "Подтверждено"
      : "Ждёт чека"
    : kindLabel;
  const showUnscheduleAsGridButton = Boolean(slot.taskId) && !shouldShowCarryoverDecision && !requiresApproval;
  const showUnscheduleBelowGrid = Boolean(slot.taskId) && !shouldShowCarryoverDecision && requiresApproval;
  const hasMiddlePrimaryAction = requiresApproval || showUnscheduleAsGridButton;

  return (
    <div
      ref={menuRef}
      className={quickMenu.mobile ? "fixed bottom-20 left-1/2 z-50 w-[min(22rem,calc(100vw-1rem))] -translate-x-1/2" : "fixed z-50 w-[min(24rem,calc(100vw-1.5rem))] -translate-x-1/2"}
      style={quickMenu.mobile ? undefined : { top: quickMenu.top, left: quickMenu.left }}
    >
      <div className={`overflow-y-auto overscroll-contain rounded-[1.75rem] border border-zinc-800 bg-zinc-950/95 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur ${quickMenu.mobile ? "max-h-[min(70vh,34rem)] p-2.5" : "max-h-[min(72vh,38rem)] p-2.5"}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[10px] uppercase tracking-[0.18em] text-zinc-500">Слот</p>
            <p className="mt-1 truncate text-sm font-semibold text-zinc-50">{slot.title}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <QuickMenuMetaChip label={formatScheduleTimeRange(slot.start, slot.end)} />
              <QuickMenuMetaChip label={`${durationMin} мин`} />
              <QuickMenuMetaChip label={QUICK_REPEAT_LABEL[draftRepeat]} />
              {draftProjectLabel ? (
                <QuickMenuMetaChip
                  label={draftProjectLabel}
                  className="border-violet-500/25 bg-violet-500/10 text-violet-200"
                />
              ) : null}
              <QuickMenuMetaChip
                label={statusChipLabel}
                className={
                  requiresApproval
                    ? isCompletedSlot
                      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
                      : "border-amber-500/25 bg-amber-500/10 text-amber-100"
                    : "border-zinc-800 bg-zinc-900/70 text-zinc-300"
                }
              />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-zinc-800 px-2 py-1 text-[10px] text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-100"
          >
            ✕
          </button>
        </div>

        <div className="mt-2.5 space-y-2">
          <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/50 p-2.5">
            <div className="space-y-2.5">
              <div className="space-y-1.5">
                <label className="block text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                  Название
                </label>
                <input
                  value={quickMenu.draftTitle}
                  onChange={(event) => onUpdateDraft({ draftTitle: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      onSaveDraft();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      onClose();
                    }
                  }}
                  className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/75 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600"
                  placeholder="Название слота"
                />
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">Тон</p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_TONE_OPTIONS.map((option) => {
                    const tone = toneColor(option.value);
                    const active = quickMenu.draftTone === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => onUpdateDraft({ draftTone: option.value })}
                        className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition ${
                          active
                            ? `${tone.border} ${tone.bg} ${tone.text}`
                            : "border-zinc-800 bg-zinc-900/60 text-zinc-500 hover:border-zinc-600 hover:text-zinc-200"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">Повтор</p>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                  {QUICK_REPEAT_OPTIONS.map((option) => {
                    const active = draftRepeat === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => onUpdateDraft({ draftRepeat: option.value })}
                        className={`rounded-2xl border px-3 py-2 text-left transition ${
                          active
                            ? "border-sky-400/40 bg-sky-500/12 text-sky-100"
                            : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                        }`}
                      >
                        <span className="block text-[11px] font-semibold">{option.label}</span>
                        <span className="mt-0.5 block text-[10px] opacity-70">{option.meta}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] leading-4 text-zinc-500">
                  Повтор применится от этого слота вперёд: текущий слот сохранится, а будущие копии соберутся автоматически.
                </p>
              </div>

              {isCustomSlot && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">Проект</p>
                  <ProjectSelectManager
                    value={quickMenu.draftProjectId}
                    projects={projects}
                    onChange={(projectId) => onUpdateDraft({ draftProjectId: projectId })}
                    onProjectsMutate={(projectId) => {
                      onVersionBump();
                      onUpdateDraft({ draftProjectId: projectId });
                    }}
                    creationContextLabel="выбора проекта в календарном слоте"
                    suggestedAccent={
                      quickMenu.draftTone === "heys"
                        ? "orange"
                        : quickMenu.draftTone === "health"
                          ? "teal"
                          : quickMenu.draftTone === "cleanup"
                            ? "rose"
                            : quickMenu.draftTone === "personal" || quickMenu.draftTone === "review" || quickMenu.draftTone === "family"
                              ? "violet"
                              : "sky"
                    }
                    size="sm"
                    align="right"
                  />
                </div>
              )}
            </div>
          </div>

          {shouldShowCarryoverDecision && (
            <SlotCarryoverDecision
              slot={slot}
              todayKey={today}
              requiresApproval={requiresApproval}
              isCompleted={isCompletedSlot}
              compact
              terse
              className="mb-0"
              onApplied={() => {
                onVersionBump();
                onClose();
              }}
            />
          )}

          <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/50 p-2.5">
            <div className="space-y-2.5">
              <div>
                <p className="mb-1.5 text-[10px] uppercase tracking-[0.16em] text-zinc-600">Положение</p>
                {shouldShowQuickReschedule && (
                  <div className="mb-1.5">
                    <SlotQuickRescheduleActions
                      slot={slot}
                      todayKey={today}
                      compact
                      showLabel={false}
                      className="space-y-0"
                      onApplied={() => {
                        onVersionBump();
                        onClose();
                      }}
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-1.5">
                  <QuickActionButton
                    label="Раньше"
                    meta="−30 мин"
                    disabled={earlierDisabled}
                    onClick={() =>
                      onApplyPatch(slot, {
                        start: minutesToCalendarTime(startMin - STEP_MIN),
                        end: minutesToCalendarTime(endMin - STEP_MIN),
                      })
                    }
                  />
                  <QuickActionButton
                    label="Позже"
                    meta="+30 мин"
                    disabled={laterDisabled}
                    onClick={() =>
                      onApplyPatch(slot, {
                        start: minutesToCalendarTime(startMin + STEP_MIN),
                        end: minutesToCalendarTime(endMin + STEP_MIN),
                      })
                    }
                  />
                  <QuickActionButton
                    label="День назад"
                    meta="−1 день"
                    disabled={!prevDay}
                    onClick={() => prevDay && onApplyPatch(slot, { date: prevDay })}
                  />
                  <QuickActionButton
                    label="День вперёд"
                    meta="+1 день"
                    disabled={!nextDay}
                    onClick={() => nextDay && onApplyPatch(slot, { date: nextDay })}
                  />
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[10px] uppercase tracking-[0.16em] text-zinc-600">Длительность</p>
                <div className="grid grid-cols-2 gap-1.5">
                  <QuickActionButton
                    label="Короче"
                    meta="−30 мин"
                    disabled={shorterDisabled}
                    onClick={() =>
                      onApplyPatch(slot, {
                        end: minutesToCalendarTime(endMin - STEP_MIN),
                      })
                    }
                  />
                  <QuickActionButton
                    label="Длиннее"
                    meta="+30 мин"
                    disabled={longerDisabled}
                    onClick={() =>
                      onApplyPatch(slot, {
                        end: minutesToCalendarTime(endMin + STEP_MIN),
                      })
                    }
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="sticky bottom-0 -mx-2.5 border-t border-zinc-800/80 bg-linear-to-t from-zinc-950 via-zinc-950/98 to-zinc-950/82 px-2.5 pt-2.5">
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={onSaveDraft}
                disabled={saveDisabled}
                className="rounded-2xl border border-sky-500/30 bg-sky-950/30 px-3 py-2 text-sm font-semibold text-sky-200 transition hover:border-sky-400/50 hover:bg-sky-950/50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Сохранить
              </button>
              <button
                type="button"
                onClick={onDuplicate}
                className="rounded-2xl border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-900"
              >
                Дублировать
              </button>

              {requiresApproval ? (
                <button
                  type="button"
                  onClick={() => onToggleApproval(slot)}
                  className={`rounded-2xl border px-3 py-2 text-sm font-semibold transition ${
                    isCompletedSlot
                      ? "border-emerald-500/30 bg-emerald-950/30 text-emerald-100 hover:border-emerald-400/50 hover:bg-emerald-950/45"
                      : "border-sky-500/30 bg-sky-950/30 text-sky-100 hover:border-sky-400/50 hover:bg-sky-950/45"
                  }`}
                >
                  {isCompletedSlot ? "Снять" : "Подтвердить"}
                </button>
              ) : showUnscheduleAsGridButton ? (
                <button
                  type="button"
                  onClick={() => onUnschedule(slot)}
                  className="rounded-2xl border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-sm font-semibold text-amber-100 transition hover:border-amber-400/50 hover:bg-amber-950/35"
                >
                  Убрать слот
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => onDelete(slot)}
                className={`rounded-2xl border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-sm font-semibold text-rose-200 transition hover:border-rose-400/50 hover:bg-rose-950/50 ${hasMiddlePrimaryAction ? "" : "col-span-2"}`}
              >
                Удалить
              </button>
            </div>

            {showUnscheduleBelowGrid && (
              <button
                type="button"
                onClick={() => onUnschedule(slot)}
                className="mt-1.5 w-full rounded-2xl border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-sm font-semibold text-amber-100 transition hover:border-amber-400/50 hover:bg-amber-950/35"
              >
                Убрать слот
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
