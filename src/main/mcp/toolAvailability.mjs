import {
  TASKEN_CORE_CREATE_AI_ITEM_CAPABILITY,
  TASKEN_CORE_GET_ACTIVITY_CAPABILITY,
  TASKEN_CORE_GET_AGENT_SESSION_CONTEXT_CAPABILITY,
  TASKEN_CORE_GET_FEED_CONTEXT_CAPABILITY,
  TASKEN_CORE_GET_NOTE_CAPABILITY,
  TASKEN_CORE_GET_RECENT_NOTES_CAPABILITY,
  TASKEN_CORE_GET_REPOSITORY_CONTEXT_CAPABILITY,
  TASKEN_CORE_GET_TASK_ASSIGNMENT_CAPABILITY,
  TASKEN_CORE_GET_TASK_CONTEXT_CAPABILITY,
  TASKEN_CORE_GET_THEME_CONTEXT_CAPABILITY,
  TASKEN_CORE_LIST_AGENT_READY_TASKS_CAPABILITY,
  TASKEN_CORE_LIST_OPEN_ITEMS_CAPABILITY,
  TASKEN_CORE_LIST_PROPOSALS_CAPABILITY,
  TASKEN_CORE_PROPOSAL_STATUS_CAPABILITY,
  TASKEN_CORE_PROPOSE_CONTENT_CAPABILITY,
  TASKEN_CORE_PROPOSE_TASK_WORK_CAPABILITY,
  TASKEN_CORE_RESOLVE_REPOSITORY_CONTEXT_CAPABILITY,
  TASKEN_CORE_SEARCH_ITEMS_CAPABILITY,
  TASKEN_CORE_TASK_COMMAND_CAPABILITY,
  TASKEN_CORE_TASK_START_WORK_CAPABILITY,
  coreWriteProfile,
} from "../../shared/contracts/core/public.mjs";
import { PROPOSALS_PROFILE_CONTENT_KINDS } from "../../shared/contracts/task/public.ts";

/**
 * MCP toolごとに、Coreのどのcapabilityと書き込みの種類を必要とするか。
 * 公開の判定・`tasken.get_capabilities`の報告はどちらもこの表を正本にする。
 * `kind`はpropose_contentの種類で、`proposals`配備はその一部だけを受け付ける。
 */
export const MCP_TOOL_REQUIREMENTS = Object.freeze({
  "tasken.create_task": {
    access: "direct_write",
    capability: TASKEN_CORE_CREATE_AI_ITEM_CAPABILITY,
  },
  "tasken.create_note": {
    access: "direct_write",
    capability: TASKEN_CORE_CREATE_AI_ITEM_CAPABILITY,
  },
  "tasken.search_items": { access: "read", capability: TASKEN_CORE_SEARCH_ITEMS_CAPABILITY },
  "tasken.list_open_items": { access: "read", capability: TASKEN_CORE_LIST_OPEN_ITEMS_CAPABILITY },
  "tasken.list_agent_ready_tasks": {
    access: "read",
    capability: TASKEN_CORE_LIST_AGENT_READY_TASKS_CAPABILITY,
  },
  "tasken.get_task_assignment": {
    access: "read",
    capability: TASKEN_CORE_GET_TASK_ASSIGNMENT_CAPABILITY,
  },
  "tasken.get_task_context": {
    access: "read",
    capability: TASKEN_CORE_GET_TASK_CONTEXT_CAPABILITY,
  },
  "tasken.get_note": { access: "read", capability: TASKEN_CORE_GET_NOTE_CAPABILITY },
  "tasken.search_notes": { access: "read", capability: TASKEN_CORE_GET_RECENT_NOTES_CAPABILITY },
  "tasken.resolve_repository_context": {
    access: "read",
    capability: TASKEN_CORE_RESOLVE_REPOSITORY_CONTEXT_CAPABILITY,
  },
  "tasken.get_repository_context": {
    access: "read",
    capability: TASKEN_CORE_GET_REPOSITORY_CONTEXT_CAPABILITY,
  },
  "tasken.get_agent_session_context": {
    access: "read",
    capability: TASKEN_CORE_GET_AGENT_SESSION_CONTEXT_CAPABILITY,
  },
  "tasken.get_theme_context": {
    access: "read",
    capability: TASKEN_CORE_GET_THEME_CONTEXT_CAPABILITY,
  },
  "tasken.get_activity": { access: "read", capability: TASKEN_CORE_GET_ACTIVITY_CAPABILITY },
  "tasken.get_feed_context": {
    access: "read",
    capability: TASKEN_CORE_GET_FEED_CONTEXT_CAPABILITY,
  },
  "tasken.get_proposal_status": {
    access: "read",
    capability: TASKEN_CORE_PROPOSAL_STATUS_CAPABILITY,
  },
  "tasken.list_proposals": { access: "read", capability: TASKEN_CORE_LIST_PROPOSALS_CAPABILITY },
  "tasken.get_capabilities": { access: "read", capability: null },
  "tasken.start_task_work": {
    access: "direct_write",
    capability: TASKEN_CORE_TASK_START_WORK_CAPABILITY,
    alternativeCapability: TASKEN_CORE_TASK_COMMAND_CAPABILITY,
  },
  "tasken.append_work_receipt": {
    access: "proposal",
    capability: TASKEN_CORE_PROPOSE_TASK_WORK_CAPABILITY,
  },
  "tasken.report_task_done": {
    access: "proposal",
    capability: TASKEN_CORE_PROPOSE_TASK_WORK_CAPABILITY,
  },
  "tasken.report_task_blocked": {
    access: "proposal",
    capability: TASKEN_CORE_PROPOSE_TASK_WORK_CAPABILITY,
  },
  "tasken.propose_note": {
    access: "proposal",
    capability: TASKEN_CORE_PROPOSE_CONTENT_CAPABILITY,
    kind: "note_create",
  },
  "tasken.propose_note_edit": {
    access: "proposal",
    capability: TASKEN_CORE_PROPOSE_CONTENT_CAPABILITY,
    kind: "note_edit",
  },
  "tasken.propose_feed_post": {
    access: "reading",
    capability: TASKEN_CORE_PROPOSE_CONTENT_CAPABILITY,
    kind: "feed_post",
  },
  "tasken.answer_feed_question": {
    access: "reading",
    capability: TASKEN_CORE_PROPOSE_CONTENT_CAPABILITY,
    kind: "feed_reply",
  },
});

function contentKindAllowed(profile, kind) {
  return (
    !["proposals", "create-only", "proposals-and-start", "create-and-start"].includes(profile) ||
    PROPOSALS_PROFILE_CONTENT_KINDS.includes(kind)
  );
}

/**
 * Coreが公開するcapabilityから、各toolを実際に使えるかを判定する。
 * 使えない理由は機械が読める短い文字列で返す（例: `missing_capability:task.command`）。
 * @param {readonly string[]} capabilities
 * @param {{ readOnly?: boolean }} [options]
 */
export function mcpToolAvailability(capabilities, options = {}) {
  const advertised = new Set(Array.isArray(capabilities) ? capabilities : []);
  const { profile } = coreWriteProfile([...advertised]);
  const tools = {};
  for (const [name, requirement] of Object.entries(MCP_TOOL_REQUIREMENTS)) {
    let reason = null;
    if (requirement.access !== "read" && options.readOnly) reason = "bridge_read_only";
    else if (
      requirement.capability &&
      !advertised.has(requirement.capability) &&
      !(requirement.alternativeCapability && advertised.has(requirement.alternativeCapability))
    )
      reason = `missing_capability:${requirement.capability}`;
    else if (requirement.kind && !contentKindAllowed(profile, requirement.kind))
      reason = `kind_not_allowed:${requirement.kind}`;
    tools[name] = { access: requirement.access, available: reason === null, reason };
  }
  const canContent = (kind) =>
    !options.readOnly &&
    advertised.has(TASKEN_CORE_PROPOSE_CONTENT_CAPABILITY) &&
    contentKindAllowed(profile, kind);
  return {
    write_profile: profile,
    writes: {
      task_create: !options.readOnly && advertised.has(TASKEN_CORE_CREATE_AI_ITEM_CAPABILITY),
      note_direct_create:
        !options.readOnly && advertised.has(TASKEN_CORE_CREATE_AI_ITEM_CAPABILITY),
      feed_post: canContent("feed_post"),
      feed_reply: canContent("feed_reply"),
      note_create: canContent("note_create"),
      // proposals配備は画像のstage先を持たないため、画像付きNoteを受け付けない。
      note_images:
        canContent("note_create") &&
        !["proposals", "create-only", "proposals-and-start", "create-and-start"].includes(profile),
      note_edit: canContent("note_edit"),
      task_work_report:
        !options.readOnly && advertised.has(TASKEN_CORE_PROPOSE_TASK_WORK_CAPABILITY),
      task_start:
        !options.readOnly &&
        (advertised.has(TASKEN_CORE_TASK_START_WORK_CAPABILITY) ||
          advertised.has(TASKEN_CORE_TASK_COMMAND_CAPABILITY)),
    },
    tools,
  };
}
