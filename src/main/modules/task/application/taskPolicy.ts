import { canonicalThemeId } from "../../../../shared/themeRef.mjs";
import { entityDefinition, referenceRelationTypes, referenceTargetEntityTypes } from "../../../../shared/entityRegistry.mjs";
import type { Entity, EntityType, SaveOperation } from "../../../../shared/types/workspace.ts";
import { ApplicationCommandError, type ApplicationCommandName, type CommandEnvelope } from "../../../../shared/applicationCommand.ts";
import type { TaskEntityAccess } from "../ports/taskRepository.ts";
import { normalizeTaskAssignment } from "../domain/taskAssignment.ts";

const taskDefinition = entityDefinition("task");
const referenceDefinition = entityDefinition("reference");
const taskWorkStates = new Set(["not_delegated", "ready_for_agent", "in_progress", "reported_done", "needs_human_review", "accepted", "blocked", "failed"]);

export function currentTaskWorkState(task: Entity): string {
  if (typeof task.work_state === "string" && taskWorkStates.has(task.work_state)) return task.work_state;
  return task.intended_executor === "ai_agent" ? "ready_for_agent" : "not_delegated";
}

export function assertHumanAcceptBeforeTaskCompletion(task: Entity): void {
  if (task.intended_executor === "ai_agent" && currentTaskWorkState(task) !== "accepted") {
    throw new ApplicationCommandError("INVALID_TRANSITION", "AIの報告だけではTaskを完了できません。人間がWork Receiptを確認してから完了してください。", { id: task.id });
  }
}

export function taskFromPayload(payload: unknown): Entity {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", "Task payloadが不正です。");
  }
  const task = (payload as { task?: unknown }).task;
  if (!task || typeof task !== "object" || Array.isArray(task)) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", "Task recordが不正です。");
  }
  taskDefinition.parseCreate(task);
  if (typeof (task as Entity).id !== "string" || !(task as Entity).id.trim()) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", "Task IDがありません。");
  }
  const title = (task as Record<string, unknown>).title;
  if (typeof title !== "string" || !title.trim()) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", "Taskタイトルがありません。");
  }
  return task as Entity;
}

export function taskIdFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", "Task command payloadが不正です。");
  }
  const taskId = (payload as { taskId?: unknown }).taskId;
  if (typeof taskId !== "string" || !taskId.trim()) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", "Task IDがありません。");
  }
  return taskId;
}

export function taskChangeType(before: Entity | null, after: Entity, _command: ApplicationCommandName): "created" | "updated" | "completed" {
  if (!before) return "created";
  if (before.state !== "done" && after.state === "done") return "completed";
  return "updated";
}

export function normalizeCanonicalTask(entity: Entity, fallbackThemeId?: string): Entity {
  const next: Entity = {
    ...entity,
    project_id: canonicalThemeId(entity.project_id ?? entity.theme_id ?? fallbackThemeId, { defaultPersonal: true }),
  };
  delete next.theme_id;
  return next;
}

export function normalizeTaskForSave(input: Entity, current?: Entity): Entity {
  return normalizeTaskAssignment({
    ...input,
    project_id: canonicalThemeId(input.project_id, { defaultPersonal: true }),
  }, current);
}

export function assertTaskThemeExists(repository: TaskEntityAccess, task: Entity): void {
  const themeId = task.project_id;
  if (typeof themeId !== "string" || !themeId.trim()) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", "Taskのcanonical Theme IDがありません。");
  }
  if (!repository.list("theme").some((theme) => theme.id === themeId)) {
    throw new ApplicationCommandError("INVALID_PAYLOAD", `Themeが存在しません: ${themeId}`, { themeId });
  }
}

export function validateTaskScheduleWrite(
  repository: TaskEntityAccess,
  command: CommandEnvelope,
  schedule: Entity | null | undefined,
  taskId: string,
  isCreate: boolean,
  expectedVersionFor: (type: EntityType, id: string) => boolean,
  assertExpectedVersion: (type: EntityType, id: string, current: Entity | null) => void,
): Entity | null {
  if (!schedule) return null;
  if (schedule.owner_type !== "task" || schedule.owner_id !== taskId) {
    throw new ApplicationCommandError("CONFLICT", "Scheduleのownerを別Taskへ変更できません。", { id: schedule.id });
  }
  const existing = repository.get("schedule", schedule.id, true);
  const otherActiveSchedule = repository.list("schedule").find((candidate) => (
    candidate.owner_type === "task"
    && candidate.owner_id === taskId
    && candidate.id !== schedule.id
  ));
  if (otherActiveSchedule) {
    throw new ApplicationCommandError("CONFLICT", "Taskにはactive Scheduleを1件だけ保存できます。", {
      type: "schedule",
      id: otherActiveSchedule.id,
      conflictReason: "other_conflict",
    });
  }
  if (existing) {
    if (isCreate) throw new ApplicationCommandError("CONFLICT", "CreateTaskで既存Schedule IDを再利用できません。", { id: schedule.id });
    if (existing.owner_type !== "task" || existing.owner_id !== taskId) {
      throw new ApplicationCommandError("CONFLICT", "Scheduleのownerを別Taskへ変更できません。", { id: schedule.id });
    }
    if (!expectedVersionFor("schedule", schedule.id)) {
      throw new ApplicationCommandError("CONFLICT", "既存Scheduleの更新にはexpected versionが必要です。", { type: "schedule", id: schedule.id });
    }
    assertExpectedVersion("schedule", schedule.id, existing);
  }
  return { ...schedule, owner_type: "task", owner_id: taskId };
}

export function taskReferenceOperations(repository: TaskEntityAccess, command: CommandEnvelope, taskId: string): SaveOperation[] {
  const references = (command.payload as { references?: Entity[] }).references || [];
  return references.map((reference) => {
    referenceDefinition.parseCreate(reference);
    if (!referenceTargetEntityTypes.includes(reference.source_type as never)
      || !referenceTargetEntityTypes.includes(reference.target_type as never)
      || !referenceRelationTypes.includes(reference.relation_type as never)) {
      throw new ApplicationCommandError("INVALID_PAYLOAD", "Referenceのsource/target typeまたはrelationが不正です。", { id: reference.id });
    }
    if (reference.source_id !== taskId && reference.target_id !== taskId) {
      throw new ApplicationCommandError("INVALID_PAYLOAD", "Task Commandのreferenceは対象Taskを参照する必要があります。", { id: reference.id });
    }
    if (repository.get("reference", reference.id, true)) {
      throw new ApplicationCommandError("CONFLICT", "既存Reference IDをCommandで再利用できません。", { id: reference.id });
    }
    for (const [side, type, id] of [
      ["source", reference.source_type, reference.source_id],
      ["target", reference.target_type, reference.target_id],
    ] as const) {
      const referenceType = type as EntityType;
      const referenceId = String(id);
      if (referenceType === "task" && referenceId === taskId) continue;
      const active = repository.get(referenceType, referenceId);
      if (!active) {
        const deleted = repository.get(referenceType, referenceId, true);
        throw new ApplicationCommandError("NOT_FOUND", deleted
          ? `Referenceの${side} entityが削除済みです。`
          : `Referenceの${side} entityが存在しません。`, { type: referenceType, id: referenceId, side });
      }
    }
    return { action: "save", type: "reference", entity: reference };
  });
}
