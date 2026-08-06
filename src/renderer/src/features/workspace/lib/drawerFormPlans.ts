import { todayIso } from "../../../utils/dataFormat.js";
import { buildArtifactThemeSyncOperations } from "./artifactEntities";
import {
  buildSaveCaptureEntryOperations,
  buildSavePlanNodeOperations,
  buildSaveResourceOperations,
  buildSaveScheduleOperations,
  buildSaveTaskOperations,
  buildSaveWaitingOperations,
} from "../domain-model/persistence";
import type {
  CaptureEntry,
  PlanNode,
  Resource,
  Schedule,
  ScheduleRangeSemantics,
  Task,
  TaskChecklistItem,
  TaskRepeatRule,
  Waiting,
  WorkspaceDomain,
} from "../domain-model/types";
import type { DrawerEntityType, SaveOperation, WorkspaceData } from "../types";
import { inferChatServiceFromUrl } from "./chatServices";
import { resolveSubmittedChatCapturedAt } from "./chatRefs";
import { formText, uuid } from "./format";
import { normalizeReminderDateTime } from "./reminders";
import { listTaskSections, normalizeTaskSectionId } from "./taskSections";
import { normalizeTaskShelf } from "./taskShelves";

export type DrawerFormPlan =
  | {
    kind: "invalid";
    field?: string;
    message: string;
  }
  | {
    kind: "operations";
    operations: SaveOperation[];
    successMessage: string;
    navigateTo?: string;
  };

interface DrawerFormPlanContext {
  type: DrawerEntityType;
  values: FormData;
  base: Record<string, unknown>;
  data: WorkspaceData;
  domain: WorkspaceDomain;
  hasField: (name: string) => boolean;
}

function taskRepeatRuleFromForm(values: FormData, fallbackDay: number): TaskRepeatRule | null {
  const frequency = formText(values, "repeat_frequency");
  if (!frequency) return null;
  const interval = Math.max(1, Number(formText(values, "repeat_interval") || 1));
  const weekdays = values.getAll("repeat_weekdays")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
  const monthDay = Number(formText(values, "repeat_month_day") || fallbackDay || 1);
  return {
    frequency: frequency as TaskRepeatRule["frequency"],
    interval,
    weekdays: frequency === "weekly" ? weekdays : undefined,
    month_day: frequency === "monthly" ? monthDay : null,
    next_from: (formText(values, "repeat_next_from") || "scheduled") as TaskRepeatRule["next_from"],
    until: formText(values, "repeat_until") || null,
  };
}

function taskChecklistFromForm(values: FormData): TaskChecklistItem[] {
  const ids = values.getAll("checklist_id").map(String);
  const titles = values.getAll("checklist_title").map(String);
  return titles.flatMap((title, index): TaskChecklistItem[] => {
    const trimmed = title.trim();
    if (!trimmed) return [];
    const done = values.has(`checklist_done_${index}`);
    return [{
      id: ids[index] || uuid(),
      title: trimmed,
      done,
      sort_order: index,
      completed_at: done
        ? (formText(values, `checklist_completed_at_${index}`) || new Date().toISOString())
        : null,
    }];
  });
}

function monthStart(value: string): string | null {
  return value ? `${value}-01` : null;
}

function monthEnd(value: string): string | null {
  if (!value) return null;
  const [year, month] = value.split("-").map(Number);
  const last = new Date(year, month, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
}

/** フォームの選択値だけを信じる。未知の値と空欄は「未分類」に倒す（#309）。 */
function normalizeRangeSemantics(value: string): ScheduleRangeSemantics | null {
  return value === "once_within_window" || value === "ongoing" ? value : null;
}

function normalizeChatReferenceStatus(value: string): string {
  return value === "adopted" ? "adopted" : "inbox";
}

export function buildDomainDrawerFormPlan(context: DrawerFormPlanContext): DrawerFormPlan | null {
  const { type, values, base, data, domain, hasField } = context;

  if (type === "task") {
    const title = formText(values, "title");
    if (!title) return { kind: "invalid", field: "title", message: "タイトルを入力してください。" };
    const taskId = (base.id as string) || uuid();
    const projectId = formText(values, "theme_id") || null;
    const taskSections = projectId ? listTaskSections(data.views || [], projectId) : [];
    const task: Task = {
      id: taskId,
      title,
      project_id: projectId,
      section_id: normalizeTaskSectionId(formText(values, "section_id"), taskSections, projectId),
      state: (formText(values, "state") || "todo") as Task["state"],
      priority: values.has("priority_flag") ? "high" : "normal",
      planning_shelf: normalizeTaskShelf(formText(values, "planning_shelf")),
      reminder_at: normalizeReminderDateTime(formText(values, "reminder_at")),
      description: formText(values, "description") || null,
      completion_note: hasField("completion_note")
        ? formText(values, "completion_note") || null
        : (base.completion_note as string | null) ?? null,
      repeat_rule: taskRepeatRuleFromForm(
        values,
        Number((formText(values, "end_date") || todayIso()).slice(-2)),
      ),
      repeat_series_id: formText(values, "repeat_frequency")
        ? String(base.repeat_series_id || base.id || taskId)
        : null,
      repeat_parent_task_id: (base.repeat_parent_task_id as string | null) ?? null,
      checklist_items: taskChecklistFromForm(values),
      legacy_item_id: (base.legacy_item_id as string | null) ?? null,
      created_at: (base.created_at as string) || new Date().toISOString(),
    };
    const operations = buildSaveTaskOperations(task);
    const startDate = formText(values, "start_date") || null;
    const endDate = formText(values, "end_date") || null;
    const scheduleId = formText(values, "_schedule_id");
    if (startDate || endDate || scheduleId) {
      const isRange = Boolean(startDate && endDate && endDate > startDate);
      const schedule: Schedule = {
        id: scheduleId || uuid(),
        owner_type: "task",
        owner_id: taskId,
        start_date: startDate,
        end_date: endDate,
        date_kind: startDate && endDate && startDate !== endDate
          ? "range"
          : endDate
            ? "deadline"
            : startDate
              ? "point"
              : "unknown",
        // 範囲の意味は値から推定せず、フォームで選ばれたものだけを保存する（#309）。
        // 既存の未分類データは、編集画面で触られるまで未分類のまま残す。
        range_semantics: isRange ? normalizeRangeSemantics(formText(values, "range_semantics")) : null,
        confidence: "fixed",
        granularity: "day",
      };
      operations.push(...buildSaveScheduleOperations(schedule));
    }
    operations.push(...buildArtifactThemeSyncOperations(data.artifacts || [], {
      sourceTypes: ["task"],
      sourceId: taskId,
      themeId: projectId,
    }));
    return {
      kind: "operations",
      operations,
      successMessage: base.id ? "変更を保存しました。" : "タスクを追加しました。",
    };
  }

  if (type === "waiting") {
    const title = formText(values, "title");
    const waitingFor = formText(values, "waiting_for");
    if (!title) return { kind: "invalid", field: "title", message: "タイトルを入力してください。" };
    if (!waitingFor) return { kind: "invalid", field: "waiting_for", message: "相手を入力してください。" };
    const waitingId = (base.id as string) || uuid();
    const waiting: Waiting = {
      id: waitingId,
      title,
      waiting_for: waitingFor,
      project_id: formText(values, "theme_id") || null,
      state: (formText(values, "state") || "waiting") as Waiting["state"],
      check_reminder_at: normalizeReminderDateTime(formText(values, "check_reminder_at")),
      next_action: formText(values, "next_action") || null,
      description: formText(values, "description") || null,
      legacy_item_id: (base.legacy_item_id as string | null) ?? null,
      created_at: (base.created_at as string) || new Date().toISOString(),
    };
    const operations = buildSaveWaitingOperations(waiting);
    const endDate = formText(values, "end_date") || null;
    const scheduleId = formText(values, "_schedule_id");
    if (endDate || scheduleId) {
      operations.push(...buildSaveScheduleOperations({
        id: scheduleId || uuid(),
        owner_type: "waiting",
        owner_id: waitingId,
        end_date: endDate,
        date_kind: endDate ? "deadline" : "unknown",
        confidence: "fixed",
        granularity: "day",
      }));
    }
    return {
      kind: "operations",
      operations,
      successMessage: base.id ? "変更を保存しました。" : "待ちを追加しました。",
    };
  }

  if (type === "plan_node") {
    const title = formText(values, "title");
    if (!title) return { kind: "invalid", field: "title", message: "タイトルを入力してください。" };
    const nodeId = (base.id as string) || uuid();
    let parentPlanNodeId = (base.parent_plan_node_id as string | null) ?? null;
    if (!parentPlanNodeId && base._parent_plan_node_item_id) {
      const parentItemId = base._parent_plan_node_item_id as string;
      const parentNode = domain.plan_nodes.find(
        (node) => node.legacy_item_id === parentItemId || node.id === parentItemId,
      );
      parentPlanNodeId = parentNode?.id || parentItemId;
    }
    const planNode: PlanNode = {
      id: nodeId,
      title,
      project_id: formText(values, "theme_id") || null,
      parent_plan_node_id: parentPlanNodeId,
      type: (formText(values, "node_type") || "phase") as PlanNode["type"],
      state: (formText(values, "node_state") || "planned") as PlanNode["state"],
      sort_order: Number(base.sort_order) || 0,
      description: formText(values, "description") || null,
      legacy_item_id: (base.legacy_item_id as string | null) ?? null,
      created_at: (base.created_at as string) || new Date().toISOString(),
    };
    const operations = buildSavePlanNodeOperations(planNode);
    const inputUnit = formText(values, "schedule_input_unit")
      || formText(values, "schedule_granularity")
      || "day";
    const startInput = formText(values, "start_date");
    const endInput = formText(values, "end_date");
    const startDate = inputUnit === "month" ? monthStart(startInput) : (startInput || null);
    const endDate = planNode.type === "milestone"
      ? startDate
      : inputUnit === "month"
        ? monthEnd(endInput)
        : (endInput || null);
    const scheduleId = formText(values, "_schedule_id");
    if (planNode.type !== "phase" || startDate || endDate || scheduleId) {
      operations.push(...buildSaveScheduleOperations({
        id: scheduleId || uuid(),
        owner_type: "plan_node",
        owner_id: nodeId,
        start_date: startDate,
        end_date: endDate,
        date_kind: startDate && endDate && startDate !== endDate
          ? "range"
          : endDate
            ? "deadline"
            : startDate
              ? "point"
              : "unknown",
        confidence: inputUnit === "month" ? "tentative" : "fixed",
        granularity: inputUnit === "month" ? "month" : "day",
      }));
    }
    return {
      kind: "operations",
      operations,
      successMessage: base.id ? "変更を保存しました。" : "計画ノードを追加しました。",
    };
  }

  if (type === "capture_entry") {
    const text = formText(values, "text") || formText(values, "title");
    if (!text) return { kind: "invalid", field: "title", message: "内容を入力してください。" };
    const entry: CaptureEntry = {
      id: (base.id as string) || uuid(),
      text,
      title: formText(values, "title") || null,
      kind: (base.kind as string | null) ?? null,
      captured_at: formText(values, "captured_at")
        || (base.captured_at as string)
        || new Date().toISOString().slice(0, 10),
      state: (formText(values, "entry_state") || "untriaged") as CaptureEntry["state"],
      legacy_item_id: (base.legacy_item_id as string | null) ?? null,
    };
    return {
      kind: "operations",
      operations: buildSaveCaptureEntryOperations(entry),
      successMessage: base.id ? "変更を保存しました。" : "Inboxに追加しました。Inboxで整理できます。",
      navigateTo: base.id ? undefined : "inbox",
    };
  }

  if (type === "resource") {
    const title = formText(values, "title");
    const url = formText(values, "url");
    if (!title) return { kind: "invalid", field: "title", message: "タイトルを入力してください。" };
    const bodyMarkdown = hasField("body_markdown")
      ? formText(values, "body_markdown")
      : String(base.body_markdown || "");
    if (!url && !bodyMarkdown) return { kind: "invalid", field: "url", message: "URLまたは会話ログを入力してください。" };
    const submittedLinkType = formText(values, "link_type");
    const inferredLinkType = inferChatServiceFromUrl(url);
    const sortOrder = Number(formText(values, "sort_order") || base.sort_order || 0);
    const resource: Resource = {
      id: (base.id as string) || uuid(),
      title,
      url: url || null,
      project_id: formText(values, "project_id") || formText(values, "theme_id") || null,
      description: formText(values, "description") || null,
      body_markdown: hasField("body_markdown")
        ? (formText(values, "body_markdown") || null)
        : ((base.body_markdown as string | null) ?? null),
      source_record_id: (base.source_record_id as string | null) ?? null,
      link_type: hasField("link_type")
        ? (submittedLinkType || (inferredLinkType !== "other" ? inferredLinkType : null))
        : ((base.link_type as string | null) ?? null),
      reference_status: formText(values, "reference_status")
        ? normalizeChatReferenceStatus(formText(values, "reference_status"))
        : base.reference_status
          ? normalizeChatReferenceStatus(String(base.reference_status))
          : null,
      importance: formText(values, "importance") || null,
      resource_scope: (base.resource_scope as Resource["resource_scope"]) ?? null,
      captured_at: resolveSubmittedChatCapturedAt(
        formText(values, "captured_at"),
        (base.captured_at as string | null) ?? null,
      ),
      chat_group: formText(values, "chat_group") || null,
      parent_resource_id: formText(values, "parent_resource_id") || null,
      sort_order: Number.isFinite(sortOrder) && sortOrder > 0 ? sortOrder : null,
      archived_at: (base.archived_at as string | null | undefined) ?? null,
      source_format: (base.source_format as string | null) ?? null,
      fidelity: (base.fidelity as string | null) ?? null,
      parser_version: (base.parser_version as string | null) ?? null,
      message_count: typeof base.message_count === "number" ? base.message_count : null,
    };
    return {
      kind: "operations",
      operations: [
        ...buildSaveResourceOperations(resource),
        ...buildArtifactThemeSyncOperations(data.artifacts || [], {
          sourceTypes: ["chat_ref"],
          sourceId: resource.id,
          themeId: resource.project_id || null,
        }),
      ],
      successMessage: base.id ? "変更を保存しました。" : "リソースを追加しました。",
    };
  }

  return null;
}
