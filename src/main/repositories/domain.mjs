import { hasAiMetadataContract, normalizeAiMetadata } from "../../shared/aiMetadata.mjs";
import { inferArtifactLinkType } from "../../shared/artifactLinks.mjs";
import { normalizeActivityEvent, ACTIVITY_EVENT_KINDS } from "../../shared/activityEvent.mjs";
import { normalizeRepositoryContext, normalizeRepositoryLinkFields } from "../../shared/repositoryContext.mjs";
import { normalizeExternalReferences } from "../../shared/externalReference.mjs";
import { normalizeReferenceAssertion } from "../../shared/relationAssertion.mjs";
import { validateAudioArtifactMetadata, validateAudioCaptureEntry } from "../../shared/mediaArtifact.mjs";
import {
  assertEntityPayload,
  assertEntityType as assertRegistryEntityType,
  entityTypes,
  requiredFieldsForEntityType,
} from "../../shared/entityRegistry.mjs";

export const workspaceEntityTypes = entityTypes;

const isoDateFields = [
  "baseline_start",
  "baseline_end",
  "planned_start",
  "planned_end",
  "actual_start",
  "actual_end",
  "due_date",
  "date",
  "value_date",
  "start_date",
  "end_date",
];

const urlFields = ["url", "source_url"];
const allowedUrlProtocols = new Set(["https:", "http:", "mailto:"]);
const knowledgeNodeTypes = new Set(["source", "evidence", "claim", "question", "decision", "insight"]);
const knowledgeEdgeTypes = new Set([
  "supports",
  "contradicts",
  "explains",
  "causes",
  "example_of",
  "generalizes",
  "depends_on",
  "derived_from",
  "answers",
  "raises",
  "similar_to",
  "leads_to",
]);
const knowledgeDirectionalRelationTypes = new Set(["depends_on", "causes", "leads_to"]);
const confidenceValues = new Set(["low", "medium", "high"]);
const knowledgeStatusValues = new Set(["active", "resolved", "deprecated", "rejected"]);
const proposalSources = new Set(["mcp", "ai_import", "manual", "embedded_llm"]);
const proposalPayloadTypes = new Set(["items", "notes", "links", "knowledge_nodes", "sketches", "artifacts", "status_update", "task_work", "repository_contexts"]);
const proposalStatuses = new Set(["pending", "accepted", "rejected", "partially_accepted", "quarantined"]);
const projectStates = new Set(["idea", "active", "paused", "closed"]);
const captureEntryStates = new Set(["untriaged", "triaged", "archived"]);
const taskStates = new Set(["todo", "doing", "waiting", "review", "done", "cancelled"]);
const taskRequesters = new Set(["self", "human", "ai_agent", "external", "unknown"]);
const taskIntendedExecutors = new Set(["self", "human", "ai_agent", "unassigned"]);
const taskExecutorKinds = new Set(["self", "human", "ai_agent", "external", "unknown"]);
const taskWorkStates = new Set(["not_delegated", "ready_for_agent", "in_progress", "reported_done", "needs_human_review", "accepted", "blocked", "failed"]);
const taskAssignmentInFlightStates = new Set(["in_progress", "reported_done", "needs_human_review"]);
const taskRepeatFrequencies = new Set(["daily", "weekly", "monthly"]);
const taskRepeatNextFromValues = new Set(["scheduled", "completed"]);
const waitingStates = new Set(["waiting", "received", "cancelled"]);
const planNodeTypes = new Set(["phase", "milestone", "deliverable"]);
const planNodeStates = new Set(["planned", "active", "done", "cancelled"]);
const scheduleOwnerTypes = new Set(["task", "waiting", "plan_node"]);
const scheduleDateKinds = new Set(["point", "deadline", "range", "unknown"]);
const scheduleConfidenceValues = new Set(["rough", "tentative", "fixed"]);
const scheduleGranularityValues = new Set(["day", "week", "month"]);
// 日付範囲の意味（#309）。start/endの値からは推定せず、明示された値だけを信じる。
// 未設定は「未分類の既存範囲」を意味し、#95の既存Today表示規則をそのまま使う。
const scheduleRangeSemantics = new Set(["once_within_window", "ongoing"]);
// Themeの種別（#282）。personal_default は常設の既定Themeで、削除・アーカイブ・改名できない。
// 表示名の文字列比較で特別扱いせず、この値と安定IDで識別する。
const themeSystemKinds = new Set(["personal_default"]);
const entityRefTypes = new Set(["project", "capture_entry", "task", "waiting", "plan_node", "note", "resource", "knowledge_node", "sketch", "artifact"]);
const changeEventEntityTypes = new Set(entityTypes.filter((type) => type !== "change_event"));
const changeTypes = new Set(["created", "updated", "completed", "rescheduled", "triaged", "deleted"]);
const changeSources = new Set(["manual", "import", "ai", "migration"]);
const repositoryContextRecordFields = new Set([
  "id", "created_at", "updated_at", "deleted_at", "device_id", "source", "version",
  "label", "provider", "canonical_url", "canonical_identity", "web_url", "local_path",
  "repository_slug", "owner", "name", "remote_aliases", "repository_root_hint",
  "default_branch", "subdirectory", "active", "metadata",
]);

// Artifactのsource_typeは意味ラベル。実体エンティティ種別への対応はこの1箇所で管理する
// （chat_refはresource、reportはnoteとして保存されている）。
export const artifactSourceEntityTypes = {
  chat_ref: "resource",
  task: "task",
  note: "note",
  report: "note",
  theme: "theme",
  capture_entry: "capture_entry",
  ai_proposal: "ai_proposal",
};
const artifactSourceTypes = new Set(Object.keys(artifactSourceEntityTypes));
const artifactGeneratedByValues = new Set(["chatgpt", "claude", "copilot", "gemini", "openai", "manual"]);
const artifactStorageModes = new Set(["managed", "linked"]);
const artifactLinkTypes = new Set(["url", "local_path", "shared_path", "onedrive", "sharepoint", "teams"]);
const artifactLinkStatuses = new Set(["unknown", "ok", "broken", "inaccessible"]);
const mediaAvailabilities = new Set(["available", "missing", "changed", "unsafe_source", "unsupported_codec"]);

function localDateIso(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateWorkItemList(value, field, maxItems = 100) {
  if (value == null) return;
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${field}は${maxItems}件以内の配列にしてください。`);
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) throw new Error(`${field}は空でない文字列の配列にしてください。`);
    if (item.length > 1000) throw new Error(`${field}の各項目は1000文字以内にしてください。`);
  }
}

function isIsoDate(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function isAllowedExternalUrl(value) {
  try {
    return allowedUrlProtocols.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

function validateTaskRepeatRule(rule) {
  if (rule == null || rule === "") return;
  if (!isPlainObject(rule)) throw new Error("task.repeat_ruleが不正です。");
  if (!taskRepeatFrequencies.has(rule.frequency)) throw new Error("task.repeat_rule.frequencyが不正です。");
  const interval = Number(rule.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) {
    throw new Error("task.repeat_rule.intervalは1以上365以下で指定してください。");
  }
  if (!taskRepeatNextFromValues.has(rule.next_from)) throw new Error("task.repeat_rule.next_fromが不正です。");
  if (rule.until != null && rule.until !== "" && !isIsoDate(rule.until)) {
    throw new Error("task.repeat_rule.untilはYYYY-MM-DD形式で指定してください。");
  }
  if (rule.weekdays != null) {
    if (!Array.isArray(rule.weekdays)) throw new Error("task.repeat_rule.weekdaysが不正です。");
    for (const weekday of rule.weekdays) {
      if (!Number.isInteger(Number(weekday)) || Number(weekday) < 0 || Number(weekday) > 6) {
        throw new Error("task.repeat_rule.weekdaysは0から6で指定してください。");
      }
    }
  }
  if (rule.month_day != null && rule.month_day !== "") {
    const monthDay = Number(rule.month_day);
    if (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31) {
      throw new Error("task.repeat_rule.month_dayは1から31で指定してください。");
    }
  }
}

function validateTaskChecklist(items) {
  if (items == null) return;
  if (!Array.isArray(items)) throw new Error("task.checklist_itemsが不正です。");
  if (items.length > 100) throw new Error("task.checklist_itemsは100件以内にしてください。");
  for (const item of items) {
    if (!isPlainObject(item)) throw new Error("task.checklist_itemsが不正です。");
    if (typeof item.id !== "string" || !item.id.trim()) throw new Error("task.checklist_items.idを入力してください。");
    if (typeof item.title !== "string" || !item.title.trim()) throw new Error("task.checklist_items.titleを入力してください。");
    if (item.title.length > 200) throw new Error("task.checklist_items.titleは200文字以内で入力してください。");
    if (typeof item.done !== "boolean") throw new Error("task.checklist_items.doneが不正です。");
    if (!Number.isFinite(Number(item.sort_order))) throw new Error("task.checklist_items.sort_orderが不正です。");
    if (item.completed_at != null && item.completed_at !== "" && Number.isNaN(new Date(item.completed_at).getTime())) {
      throw new Error("task.checklist_items.completed_atが不正です。");
    }
  }
}

function validateSketchDocument(document) {
  if (!isPlainObject(document)) throw new Error("sketch.documentが不正です。");
  if (document.schema_version !== 1) throw new Error("sketch.document.schema_versionが不正です。");
  if (document.mode != null && !["page", "infinite"].includes(document.mode)) {
    throw new Error("sketch.document.modeが不正です。");
  }
  if (document.viewport != null) {
    if (
      !isPlainObject(document.viewport)
      || !Number.isFinite(document.viewport.x)
      || !Number.isFinite(document.viewport.y)
      || !Number.isFinite(document.viewport.zoom)
      || document.viewport.zoom < 0.1
      || document.viewport.zoom > 8
    ) {
      throw new Error("sketch.document.viewportが不正です。");
    }
  }
  if (!Array.isArray(document.pages) || !document.pages.length) {
    throw new Error("sketch.document.pagesを1件以上指定してください。");
  }
  if (document.pages.length > 200) throw new Error("sketch.document.pagesは200ページ以内にしてください。");
  for (const page of document.pages) {
    if (!isPlainObject(page) || typeof page.id !== "string" || !page.id.trim()) {
      throw new Error("sketch.document.pagesの形式が不正です。");
    }
    if (
      !Number.isInteger(page.width)
      || !Number.isInteger(page.height)
      || page.width <= 0
      || page.height <= 0
      || page.width > 100000
      || page.height > 100000
    ) {
      throw new Error("sketchのページ幅・高さが不正です。");
    }
    if (!Array.isArray(page.objects) || page.objects.length > 5000) {
      throw new Error("sketchの1ページは5000要素以内にしてください。");
    }
  }
}

export function hasPath(edges, fromId, toId) {
  const graph = new Map();
  for (const [sourceId, targetId] of edges) {
    if (!sourceId || !targetId) continue;
    const targets = graph.get(sourceId) || [];
    targets.push(targetId);
    graph.set(sourceId, targets);
  }
  const stack = [fromId];
  const seen = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    if (current === toId) return true;
    seen.add(current);
    stack.push(...(graph.get(current) || []));
  }
  return false;
}

export function assertItemParentAcyclic(items, entity, message = "親Itemに自分自身または子孫を指定すると循環します。別の親Itemを選んでください。") {
  if (!entity.parent_item_id) return;
  const entityId = String(entity.id);
  const byId = new Map(items.filter((item) => !item.deleted_at).map((item) => [String(item.id), item]));
  byId.set(entityId, entity);

  const seen = new Set([entityId]);
  let currentId = String(entity.parent_item_id);
  while (currentId) {
    if (seen.has(currentId)) throw new Error(message);
    seen.add(currentId);
    currentId = String(byId.get(currentId)?.parent_item_id || "");
  }
}


export function assertEntityType(type) {
  return assertRegistryEntityType(type);
}

export function validateEntity(type, input) {
  assertEntityType(type);
  assertEntityPayload(type, input);
  if (!isPlainObject(input)) throw new Error(`${type}の保存内容が不正です。`);

  // Legacy rows remain readable/importable. Validation uses their canonical
  // projection without mutating the persisted input.
  if (type === "reference") input = normalizeReferenceAssertion(input);

  // AI共通metadata（#294）は正規化と同じ規則で検証する。規則の正本は aiMetadata.mjs 側。
  if (hasAiMetadataContract(type)) normalizeAiMetadata(type, input);

  for (const field of requiredFieldsForEntityType(type)) {
    if (typeof input[field] !== "string" || !input[field].trim()) {
      throw new Error(`${type}.${field}を入力してください。`);
    }
  }

  if (type === "repository_context") normalizeRepositoryContext(input);
  if (type === "theme" || type === "project" || type === "task") normalizeRepositoryLinkFields(type, input);

  for (const field of isoDateFields) {
    if (input[field] != null && input[field] !== "" && !isIsoDate(input[field])) {
      throw new Error(`${type}.${field}はYYYY-MM-DD形式で指定してください。`);
    }
  }

  for (const field of urlFields) {
    if (input[field] != null && input[field] !== "" && !isAllowedExternalUrl(input[field])) {
      throw new Error(`${type}.${field}はhttps、http、mailtoのURLを指定してください。fileや未知の形式は開けません。`);
    }
  }

  if (type === "item") {
    const progress = Number(input.progress ?? 0);
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
      throw new Error("item.progressは0から100で指定してください。");
    }
    if (input.planned_start && input.planned_end && input.planned_end < input.planned_start) {
      throw new Error("item.planned_endはplanned_start以降にしてください。");
    }
    if (input.id && input.parent_item_id && String(input.id) === String(input.parent_item_id)) {
      throw new Error("Item自身を親Itemにはできません。");
    }
  }

  if (type === "knowledge_node") {
    if (!knowledgeNodeTypes.has(input.node_type)) throw new Error("knowledge_node.node_typeが不正です。");
    if (input.confidence != null && input.confidence !== "" && !confidenceValues.has(input.confidence)) {
      throw new Error("knowledge_node.confidenceが不正です。");
    }
    if (input.status != null && input.status !== "" && !knowledgeStatusValues.has(input.status)) {
      throw new Error("knowledge_node.statusが不正です。");
    }
    if (String(input.title || "").length > 200) throw new Error("knowledge_node.titleは200文字以内で入力してください。");
    if (String(input.body || "").length > 20000) throw new Error("knowledge_node.bodyは20000文字以内で入力してください。");
  }

  if (type === "ai_proposal") {
    if (!proposalSources.has(input.source)) throw new Error("ai_proposal.sourceが不正です。");
    if (!proposalPayloadTypes.has(input.payload_type)) throw new Error("ai_proposal.payload_typeが不正です。");
    if (!proposalStatuses.has(input.status)) throw new Error("ai_proposal.statusが不正です。");
    if (input.payload == null) throw new Error("ai_proposal.payloadを入力してください。");
  }

  if (type === "project" && !projectStates.has(input.state)) throw new Error("project.stateが不正です。");
  if (type === "capture_entry") {
    if (!captureEntryStates.has(input.state)) throw new Error("capture_entry.stateが不正です。");
    if (input.content_type === "audio" || input.kind === "voice_memo") validateAudioCaptureEntry(input);
    if (input.triaged_to_type != null && input.triaged_to_type !== "" && !entityRefTypes.has(input.triaged_to_type)) {
      throw new Error("capture_entry.triaged_to_typeが不正です。");
    }
  }
  if (type === "task") {
    if (!taskStates.has(input.state)) throw new Error("task.stateが不正です。");
    if (input.priority != null && input.priority !== "" && !["normal", "high"].includes(input.priority)) {
      throw new Error("task.priorityが不正です。");
    }
    validateTaskRepeatRule(input.repeat_rule);
    validateTaskChecklist(input.checklist_items);
    if (input.requester != null && !taskRequesters.has(input.requester)) throw new Error("task.requesterが不正です。");
    if (input.intended_executor != null && !taskIntendedExecutors.has(input.intended_executor)) throw new Error("task.intended_executorが不正です。");
    if (input.executor_identity != null && input.executor_identity !== "" && (typeof input.executor_identity !== "string" || input.executor_identity.length > 200)) throw new Error("task.executor_identityは200文字以内で入力してください。");
    if (input.work_state != null && !taskWorkStates.has(input.work_state)) throw new Error("task.work_stateが不正です。");
    if (input.intended_executor === "ai_agent" && input.state === "done" && input.work_state !== "accepted") {
      throw new Error("AI担当のdone Taskは、人間確認済みのwork_state=acceptedだけ保存できます。");
    }
    for (const field of ["work_started_at", "work_reported_at"]) {
      if (input[field] != null && input[field] !== "" && Number.isNaN(new Date(input[field]).getTime())) throw new Error(`task.${field}が不正です。`);
    }
    if (input.work_review_note != null && input.work_review_note.length > 2000) throw new Error("task.work_review_noteは2000文字以内で入力してください。");
  }
  if (type === "work_receipt") {
    if (typeof input.task_id !== "string" || !input.task_id.trim()) throw new Error("work_receipt.task_idを入力してください。");
    if (!taskExecutorKinds.has(input.executor_kind)) throw new Error("work_receipt.executor_kindが不正です。");
    if (typeof input.executor_label !== "string" || !input.executor_label.trim() || input.executor_label.length > 200) throw new Error("work_receipt.executor_labelは1〜200文字で入力してください。");
    if (typeof input.reported_at !== "string" || Number.isNaN(new Date(input.reported_at).getTime())) throw new Error("work_receipt.reported_atが不正です。");
    if (input.started_at != null && input.started_at !== "" && Number.isNaN(new Date(input.started_at).getTime())) throw new Error("work_receipt.started_atが不正です。");
    if (typeof input.summary !== "string" || !input.summary.trim() || input.summary.length > 10000) throw new Error("work_receipt.summaryは1〜10000文字で入力してください。");
    validateWorkItemList(input.completed_items, "work_receipt.completed_items");
    validateWorkItemList(input.changed_or_created_items, "work_receipt.changed_or_created_items");
    validateWorkItemList(input.verification, "work_receipt.verification");
    validateWorkItemList(input.remaining_work, "work_receipt.remaining_work");
    if (input.external_references != null) normalizeExternalReferences(input.external_references);
    for (const field of ["repository_context", "runtime_metadata"]) {
      if (input[field] != null && !isPlainObject(input[field])) throw new Error(`work_receipt.${field}が不正です。`);
    }
    if (input.source_session != null && input.source_session !== "" && (typeof input.source_session !== "string" || input.source_session.length > 200)) throw new Error("work_receipt.source_sessionは200文字以内で入力してください。");
    if (input.provenance != null && !isPlainObject(input.provenance)) throw new Error("work_receipt.provenanceが不正です。");
  }
  if (type === "waiting" && !waitingStates.has(input.state)) throw new Error("waiting.stateが不正です。");
  if (type === "plan_node") {
    if (!planNodeTypes.has(input.type)) throw new Error("plan_node.typeが不正です。");
    if (!planNodeStates.has(input.state)) throw new Error("plan_node.stateが不正です。");
  }
  // 既定Themeの識別子（#282）。未知の種別を保存させない。
  if (type === "theme" && input.system_kind != null && input.system_kind !== "" && !themeSystemKinds.has(input.system_kind)) {
    throw new Error("theme.system_kindが不正です。");
  }
  if (type === "schedule") {
    if (!scheduleOwnerTypes.has(input.owner_type)) throw new Error("schedule.owner_typeが不正です。");
    if (!scheduleDateKinds.has(input.date_kind)) throw new Error("schedule.date_kindが不正です。");
    if (!scheduleConfidenceValues.has(input.confidence)) throw new Error("schedule.confidenceが不正です。");
    if (!scheduleGranularityValues.has(input.granularity)) throw new Error("schedule.granularityが不正です。");
    if (input.start_date && input.end_date && input.end_date < input.start_date) {
      throw new Error("schedule.end_dateはstart_date以降にしてください。");
    }
    if (input.range_semantics != null && input.range_semantics !== "" && !scheduleRangeSemantics.has(input.range_semantics)) {
      throw new Error("schedule.range_semanticsが不正です。");
    }
    if (input.range_semantics && !(input.start_date && input.end_date && input.end_date > input.start_date)) {
      throw new Error("schedule.range_semanticsは開始日と終了日が異なる範囲にだけ設定できます。");
    }
  }
  if (type === "reference") {
    // normalizeReferenceAssertion owns the complete assertion validation.
    // Keep this branch explicit so Reference does not silently fall back to a
    // generic record contract.
    normalizeReferenceAssertion(input);
  }
  if (type === "task_dependency" && input.task_id === input.depends_on_task_id) {
    throw new Error("TaskDependencyで自分自身は参照できません。");
  }
  if (type === "plan_dependency" && input.plan_node_id === input.depends_on_plan_node_id) {
    throw new Error("PlanDependencyで自分自身は参照できません。");
  }
  if (type === "knowledge_edge" && input.source_node_id === input.target_node_id) {
    throw new Error("KnowledgeEdgeで自分自身は参照できません。");
  }
  if (type === "knowledge_edge" && !knowledgeEdgeTypes.has(input.relation_type)) {
    throw new Error("KnowledgeEdge.relation_typeが不正です。");
  }
  if (type === "change_event") {
    if (!changeEventEntityTypes.has(input.entity_type)) throw new Error("change_event.entity_typeが不正です。");
    if (!changeTypes.has(input.change_type)) throw new Error("change_event.change_typeが不正です。");
    if (!changeSources.has(input.source)) throw new Error("change_event.sourceが不正です。");
    if (input.event_kind != null || input.entity_ref != null || input.occurred_at != null) {
      const normalized = normalizeActivityEvent(input);
      if (!ACTIVITY_EVENT_KINDS.includes(normalized.event_kind)) throw new Error("change_event.event_kindが不正です。");
      if (!normalized.entity_ref?.type || !normalized.entity_ref?.id) throw new Error("change_event.entity_refが不正です。");
      if (Number.isNaN(new Date(normalized.occurred_at).getTime())) throw new Error("change_event.occurred_atが不正です。");
    }
  }
  if (type === "sketch") {
    validateSketchDocument(input.document);
    if (input.project_id != null && typeof input.project_id !== "string") {
      throw new Error("sketch.project_idが不正です。");
    }
    if (input.origin_capture_id != null && typeof input.origin_capture_id !== "string") {
      throw new Error("sketch.origin_capture_idが不正です。");
    }
  }
  if (type === "artifact") {
    if (!artifactSourceTypes.has(input.source_type)) throw new Error("artifact.source_typeが不正です。");
    if (input.generated_by != null && input.generated_by !== "" && !artifactGeneratedByValues.has(input.generated_by)) {
      throw new Error("artifact.generated_byが不正です。");
    }
    if (input.file_size != null && (!Number.isFinite(Number(input.file_size)) || Number(input.file_size) < 0)) {
      throw new Error("artifact.file_sizeが不正です。");
    }
    const storageMode = input.storage_mode === "linked" ? "linked" : "managed";
    if (input.storage_mode != null && input.storage_mode !== "" && !artifactStorageModes.has(input.storage_mode)) {
      throw new Error("artifact.storage_modeが不正です。");
    }
    if (storageMode === "managed") {
      if (typeof input.stored_path !== "string" || !input.stored_path.trim()) {
        throw new Error("artifact.stored_pathを入力してください。");
      }
    } else {
      if (typeof input.target !== "string" || !input.target.trim()) {
        throw new Error("artifact.targetを入力してください。");
      }
      if (!artifactLinkTypes.has(input.link_type)) {
        throw new Error("artifact.link_typeが不正です。");
      }
    }
    if (input.link_status != null && input.link_status !== "" && !artifactLinkStatuses.has(input.link_status)) {
      throw new Error("artifact.link_statusが不正です。");
    }
    if (input.origin_note_id != null && typeof input.origin_note_id !== "string") {
      throw new Error("artifact.origin_note_idが不正です。");
    }
    if (input.export_format != null && input.export_format !== "" && !["markdown", "pdf"].includes(input.export_format)) {
      throw new Error("artifact.export_formatが不正です。");
    }
    if (input.media_kind != null) validateAudioArtifactMetadata(input);
    if (input.media_availability != null && !mediaAvailabilities.has(input.media_availability)) {
      throw new Error("artifact.media_availabilityが不正です。");
    }
  }

  return input;
}

/**
 * Assignment変更はフォームのhidden work_stateを信頼せず、この関数へ正規化規則を集約する。
 * Repositoryが最終write時にも同じ関数を適用する。
 * 作業中・確認中の再割当は、暗黙にReceiptの帰属を変えないため拒否する。
 * @template {Record<string, unknown>} T
 * @param {T} input
 * @param {T | null | undefined} [previous]
 * @returns {T}
 */
export function normalizeTaskAssignment(input, previous = null) {
  const normalized = { ...input };
  if (!Object.prototype.hasOwnProperty.call(normalized, "intended_executor")) return normalized;
  if (!taskIntendedExecutors.has(normalized.intended_executor)) return normalized;

  const changed = !previous || previous.intended_executor !== normalized.intended_executor;
  if (!changed) return normalized;

  const previousWorkState = previous?.work_state
    || (previous?.intended_executor === "ai_agent" ? "ready_for_agent" : "not_delegated");
  if (previous && taskAssignmentInFlightStates.has(previousWorkState)) {
    throw new Error("作業中または確認中のTaskは、先にWork Receiptを受け入れるか差し戻してから再割当してください。");
  }

  const assignedToAi = normalized.intended_executor === "ai_agent";
  normalized.work_state = assignedToAi ? "ready_for_agent" : "not_delegated";
  normalized.work_started_at = null;
  normalized.work_reported_at = null;
  normalized.work_review_note = null;
  return normalized;
}

export function normalizeEntity(type, input) {
  const normalized = { ...input };
  if (type === "reference") Object.assign(normalized, normalizeReferenceAssertion(normalized, { writeBoundary: true }));
  if (type === "change_event") Object.assign(normalized, normalizeActivityEvent(normalized));
  // AI共通metadata（#294）。本文フィールドには触れず、概要・鮮度・根拠・公開範囲だけを揃える。
  if (hasAiMetadataContract(type)) Object.assign(normalized, normalizeAiMetadata(type, normalized));
  if (type === "repository_context") {
    const safeContext = normalizeRepositoryContext(normalized);
    for (const key of Object.keys(normalized)) {
      if (!repositoryContextRecordFields.has(key)) delete normalized[key];
    }
    Object.assign(normalized, safeContext);
  }
  if (type === "work_receipt" && normalized.external_references != null) {
    normalized.external_references = normalizeExternalReferences(normalized.external_references);
  }
  if (type === "theme" || type === "project" || type === "task") {
    Object.assign(normalized, normalizeRepositoryLinkFields(type, normalized));
  }
  for (const field of requiredFieldsForEntityType(type)) {
    if (typeof normalized[field] === "string") normalized[field] = normalized[field].trim();
  }
  if (type === "item") {
    normalized.schedule_status = normalized.planned_start || normalized.planned_end ? "scheduled" : "unscheduled";
    normalized.progress = Math.max(0, Math.min(100, Number(normalized.progress ?? 0)));
    if (normalized.status === "done") {
      normalized.progress = 100;
      normalized.completed_at ||= new Date().toISOString();
      normalized.actual_end ||= localDateIso();
    } else if (normalized.completed_at) {
      normalized.completed_at = null;
    }
  }
  if (type === "knowledge_node") {
    normalized.status ||= "active";
    normalized.confidence ||= "medium";
  }
  if (type === "ai_proposal") normalized.status ||= "pending";
  if (type === "task") {
    if (normalized.repeat_rule) {
      normalized.repeat_rule = {
        ...normalized.repeat_rule,
        interval: Number(normalized.repeat_rule.interval || 1),
        weekdays: Array.isArray(normalized.repeat_rule.weekdays)
          ? [...new Set(normalized.repeat_rule.weekdays.map((weekday) => Number(weekday)))].sort((a, b) => a - b)
          : undefined,
        month_day: normalized.repeat_rule.month_day == null || normalized.repeat_rule.month_day === "" ? null : Number(normalized.repeat_rule.month_day),
        until: normalized.repeat_rule.until || null,
      };
    }
    if (Array.isArray(normalized.checklist_items)) {
      normalized.checklist_items = normalized.checklist_items
        .map((item, index) => ({
          ...item,
          title: typeof item.title === "string" ? item.title.trim() : item.title,
          sort_order: Number(item.sort_order ?? index),
        }))
        .filter((item) => item.title);
    }
  }
  if (type === "schedule") {
    // 範囲でなくなったscheduleに範囲の意味を残さない（#309）。
    // 例: 8/10〜8/15 の「期間内に一度」を 8/12 単日へ直したら point に戻す。
    const isRange = Boolean(normalized.start_date && normalized.end_date && normalized.end_date > normalized.start_date);
    // 未分類は「キーがない」ではなく null として明示的に持つ。
    if (!isRange || !normalized.range_semantics) normalized.range_semantics = null;
  }
  if (type === "artifact") {
    // 既存データ互換: storage_mode 未設定は managed。物理パスは移動しない。
    normalized.storage_mode = normalized.storage_mode === "linked" ? "linked" : "managed";
    if (typeof normalized.stored_path === "string") normalized.stored_path = normalized.stored_path.trim();
    else if (normalized.storage_mode === "linked") normalized.stored_path = "";
    if (typeof normalized.target === "string") normalized.target = normalized.target.trim();
    if (typeof normalized.filename === "string") normalized.filename = normalized.filename.trim();
    if (normalized.storage_mode === "linked" && !normalized.link_type && normalized.target) {
      normalized.link_type = inferArtifactLinkType(normalized.target);
    }
  }
  validateEntity(type, normalized);
  return normalized;
}

export function isKnowledgeDirectionalRelationType(value) {
  return knowledgeDirectionalRelationTypes.has(value);
}
