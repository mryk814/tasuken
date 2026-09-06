import { buildActivityEvent, themeRefFromEntity } from "./activityEvent.mjs";
import { resolveAiAuthority } from "./aiMetadata.mjs";

const PLAN_FIELDS = new Set([
  "state",
  "priority",
  "project_id",
  "theme_id",
  "plan_node_id",
  "parent_id",
  "parent_task_id",
  "today_date",
  "planning_shelf",
  "planned_start_time",
  "planned_duration_minutes",
  "requester",
  "intended_executor",
  "executor_identity",
  "repeat_rule",
  "start_date",
  "end_date",
  "date_kind",
  "range_semantics",
  "confidence",
  "granularity",
]);

export function isRecallPlanChange(event) {
  return (
    ["task_updated", "plan_node_updated", "schedule_updated"].includes(event.event_kind) &&
    (event.changed_fields || []).some((field) => PLAN_FIELDS.has(field))
  );
}

export function isCaptureInput(event) {
  return (
    event.entity_ref?.type === "capture_entry" &&
    event.event_kind === "entity_updated" &&
    event.change_type === "created"
  );
}

// Older desktop captures have no creation event. The read model supplies one
// stable source row; it never persists an event or duplicates an existing one.
export function recallCaptureInputs(events, captures) {
  const represented = new Set(events.filter(isCaptureInput).map((event) => event.entity_ref.id));
  return captures
    .filter(
      (capture) =>
        capture?.id &&
        !capture.deleted_at &&
        capture.state === "untriaged" &&
        !represented.has(capture.id) &&
        Number.isFinite(Date.parse(capture.captured_at)),
    )
    .map((capture) =>
      buildActivityEvent({
        id: `capture-input:${capture.id}`,
        entity_type: "capture_entry",
        entity_id: capture.id,
        change_type: "created",
        occurred_at: capture.captured_at,
        after: capture,
        theme_ref: themeRefFromEntity(capture),
        summary: capture.text || capture.title || "Capture",
        origin: { kind: "capture_read_model" },
        metadata: { dedupe_key: `capture-input:${capture.id}` },
      }),
    );
}

export function recallEvidence(event, entity) {
  const kind = event.event_kind;
  const stage = isCaptureInput(event)
    ? "input"
    : kind === "task_ai_reported"
      ? "ai_reported"
      : kind === "task_ai_accepted"
        ? "human_accepted"
        : kind === "task_work_recorded" || kind === "task_completed"
          ? "work_recorded"
          : kind === "task_created" || kind === "plan_node_created" || isRecallPlanChange(event)
            ? "planned"
            : kind === "capture_formalized"
              ? "organized"
              : "changed";
  const authority = resolveAiAuthority(event.entity_ref.type, entity);
  return {
    stage,
    authority: authority.authority,
    authority_origin: authority.origin,
    source_ref: { type: event.entity_ref.type, id: event.entity_ref.id },
  };
}
