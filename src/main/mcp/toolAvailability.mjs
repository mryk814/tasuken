import {
  TASKEN_CORE_AI_DIRECT_WRITE_CAPABILITY,
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
  TASKEN_CORE_TASK_START_WORK_CAPABILITY,
  coreWriteProfile,
} from "../../shared/contracts/core/public.mjs";
import { PROPOSALS_PROFILE_CONTENT_KINDS } from "../../shared/contracts/task/public.ts";

/**
 * MCP toolごとに、Coreのどのcapabilityと書き込みの種類を必要とするか。
 * 公開の判定・`tasken.get_capabilities`の報告はどちらもこの表を正本にする。
 * `kind`はpropose_contentの種類で、`proposals`配備はその一部だけを受け付ける。
 * `setting: "direct_write"`は、Desktopで本人が設定で許したときだけ使えるtool。
 * 一覧からは外さず（設定を変えても接続し直さずに使えるように）、使えない理由を報告する。
 */
export const MCP_TOOL_REQUIREMENTS = Object.freeze({
  "tasken.create_task": {
    toolset: "write",
    access: "direct_write",
    capability: TASKEN_CORE_CREATE_AI_ITEM_CAPABILITY,
    setting: "direct_write",
  },
  "tasken.create_note": {
    toolset: "write",
    access: "direct_write",
    capability: TASKEN_CORE_CREATE_AI_ITEM_CAPABILITY,
    setting: "direct_write",
  },
  "tasken.change_task": {
    toolset: "write",
    access: "direct_write",
    capability: TASKEN_CORE_AI_DIRECT_WRITE_CAPABILITY,
    setting: "direct_write",
  },
  "tasken.decide_proposal": {
    toolset: "write",
    access: "direct_write",
    capability: TASKEN_CORE_AI_DIRECT_WRITE_CAPABILITY,
    setting: "direct_write",
  },
  "tasken.edit_note": {
    toolset: "write",
    access: "direct_write",
    capability: TASKEN_CORE_AI_DIRECT_WRITE_CAPABILITY,
    setting: "direct_write",
  },
  "tasken.undo_change": {
    toolset: "write",
    access: "direct_write",
    capability: TASKEN_CORE_AI_DIRECT_WRITE_CAPABILITY,
    setting: "direct_write",
  },
  "tasken.search_items": {
    toolset: "core",
    access: "read",
    capability: TASKEN_CORE_SEARCH_ITEMS_CAPABILITY,
  },
  "tasken.list_open_items": {
    toolset: "core",
    access: "read",
    capability: TASKEN_CORE_LIST_OPEN_ITEMS_CAPABILITY,
  },
  "tasken.list_agent_ready_tasks": {
    toolset: "coding",
    access: "read",
    capability: TASKEN_CORE_LIST_AGENT_READY_TASKS_CAPABILITY,
  },
  "tasken.get_task_assignment": {
    toolset: "coding",
    access: "read",
    capability: TASKEN_CORE_GET_TASK_ASSIGNMENT_CAPABILITY,
  },
  "tasken.get_task_context": {
    toolset: "core",
    access: "read",
    capability: TASKEN_CORE_GET_TASK_CONTEXT_CAPABILITY,
  },
  "tasken.get_note": {
    toolset: "core",
    access: "read",
    capability: TASKEN_CORE_GET_NOTE_CAPABILITY,
  },
  "tasken.search_notes": {
    toolset: "core",
    access: "read",
    capability: TASKEN_CORE_GET_RECENT_NOTES_CAPABILITY,
  },
  "tasken.resolve_repository_context": {
    toolset: "coding",
    access: "read",
    capability: TASKEN_CORE_RESOLVE_REPOSITORY_CONTEXT_CAPABILITY,
  },
  "tasken.get_repository_context": {
    toolset: "coding",
    access: "read",
    capability: TASKEN_CORE_GET_REPOSITORY_CONTEXT_CAPABILITY,
  },
  "tasken.get_agent_session_context": {
    toolset: "coding",
    access: "read",
    capability: TASKEN_CORE_GET_AGENT_SESSION_CONTEXT_CAPABILITY,
  },
  "tasken.get_theme_context": {
    toolset: "context",
    access: "read",
    capability: TASKEN_CORE_GET_THEME_CONTEXT_CAPABILITY,
  },
  "tasken.get_activity": {
    toolset: "core",
    access: "read",
    capability: TASKEN_CORE_GET_ACTIVITY_CAPABILITY,
  },
  "tasken.get_feed_context": {
    toolset: "context",
    access: "read",
    capability: TASKEN_CORE_GET_FEED_CONTEXT_CAPABILITY,
  },
  "tasken.get_proposal_status": {
    toolset: "proposals",
    access: "read",
    capability: TASKEN_CORE_PROPOSAL_STATUS_CAPABILITY,
  },
  "tasken.list_proposals": {
    toolset: "proposals",
    access: "read",
    capability: TASKEN_CORE_LIST_PROPOSALS_CAPABILITY,
  },
  "tasken.get_capabilities": { toolset: "meta", access: "read", capability: null },
  "tasken.start_task_work": {
    toolset: "write",
    access: "direct_write",
    capability: TASKEN_CORE_TASK_START_WORK_CAPABILITY,
  },
  "tasken.report_work": {
    toolset: "write",
    access: "proposal",
    capability: TASKEN_CORE_PROPOSE_TASK_WORK_CAPABILITY,
  },
  "tasken.append_work_receipt": {
    toolset: "legacy",
    access: "proposal",
    capability: TASKEN_CORE_PROPOSE_TASK_WORK_CAPABILITY,
  },
  "tasken.report_task_done": {
    toolset: "legacy",
    access: "proposal",
    capability: TASKEN_CORE_PROPOSE_TASK_WORK_CAPABILITY,
  },
  "tasken.report_task_blocked": {
    toolset: "legacy",
    access: "proposal",
    capability: TASKEN_CORE_PROPOSE_TASK_WORK_CAPABILITY,
  },
  "tasken.propose_note": {
    toolset: "write",
    access: "proposal",
    capability: TASKEN_CORE_PROPOSE_CONTENT_CAPABILITY,
    kind: "note_create",
  },
  "tasken.propose_note_edit": {
    toolset: "write",
    access: "proposal",
    capability: TASKEN_CORE_PROPOSE_CONTENT_CAPABILITY,
    kind: "note_edit",
  },
  "tasken.propose_feed_post": {
    toolset: "write",
    access: "reading",
    capability: TASKEN_CORE_PROPOSE_CONTENT_CAPABILITY,
    kind: "feed_post",
  },
  "tasken.answer_feed_question": {
    toolset: "write",
    access: "reading",
    capability: TASKEN_CORE_PROPOSE_CONTENT_CAPABILITY,
    kind: "feed_reply",
  },
});

export const MCP_TOOLSETS = Object.freeze([
  "all",
  "core",
  "coding",
  "context",
  "proposals",
  "meta",
  "write",
  "legacy",
]);

/** 未指定だけをallとし、不正・空指定は黙って全公開しない。 */
export function parseMcpToolsets(value) {
  if (value === undefined) return ["all"];
  const sets = typeof value === "string" ? value.split(",").map((entry) => entry.trim()) : value;
  if (
    !Array.isArray(sets) ||
    sets.length === 0 ||
    sets.some((entry) => !MCP_TOOLSETS.includes(entry))
  )
    throw new Error("MCP_TOOLSETS_INVALID");
  return [...new Set(sets)];
}

export function mcpToolsetEnabled(requirement, toolsets) {
  return (
    toolsets.includes(requirement.toolset) ||
    (requirement.toolset !== "legacy" && toolsets.includes("all"))
  );
}

function contentKindAllowed(profile, kind) {
  return (
    !["proposals", "create-only", "proposals-and-start", "create-and-start"].includes(profile) ||
    PROPOSALS_PROFILE_CONTENT_KINDS.includes(kind)
  );
}

/**
 * Coreが公開するcapabilityから、各toolを実際に使えるかを判定する。
 * 使えない理由は機械が読める短い文字列で返す（例: `missing_capability:task.start_work`）。
 * @param {readonly string[] | undefined} capabilities
 * @param {{ readOnly?: boolean, toolsets?: string[] | string, directWriteEnabled?: boolean }} [options]
 *   `directWriteEnabled`はDesktop Coreが返す本人の設定。falseのときだけ`setting`付きのtoolを使えないとする。
 */
export function mcpToolAvailability(capabilities, options = {}) {
  const advertised = new Set(Array.isArray(capabilities) ? capabilities : []);
  const { profile } = coreWriteProfile([...advertised]);
  const toolsets = parseMcpToolsets(options.toolsets);
  const tools = {};
  for (const [name, requirement] of Object.entries(MCP_TOOL_REQUIREMENTS)) {
    let reason = null;
    if (requirement.access !== "read" && options.readOnly) reason = "bridge_read_only";
    else if (!mcpToolsetEnabled(requirement, toolsets)) reason = "toolset_not_enabled";
    else if (
      Array.isArray(capabilities) &&
      requirement.capability &&
      !advertised.has(requirement.capability)
    )
      reason = `missing_capability:${requirement.capability}`;
    else if (requirement.kind && !contentKindAllowed(profile, requirement.kind))
      reason = `kind_not_allowed:${requirement.kind}`;
    else if (requirement.setting === "direct_write" && options.directWriteEnabled === false)
      reason = "disabled_in_settings";
    tools[name] = {
      toolset: requirement.toolset,
      access: requirement.access,
      available: reason === null,
      reason,
    };
  }
  const writeEnabled =
    !options.readOnly && (toolsets.includes("all") || toolsets.includes("write"));
  const canContent = (kind) =>
    writeEnabled &&
    advertised.has(TASKEN_CORE_PROPOSE_CONTENT_CAPABILITY) &&
    contentKindAllowed(profile, kind);
  return {
    write_profile: profile,
    writes: {
      task_create: tools["tasken.create_task"].available,
      note_direct_create: tools["tasken.create_note"].available,
      task_edit: tools["tasken.change_task"].available,
      undo: tools["tasken.undo_change"].available,
      note_edit_direct: tools["tasken.edit_note"].available,
      proposal_decision: tools["tasken.decide_proposal"].available,
      feed_post: canContent("feed_post"),
      feed_reply: canContent("feed_reply"),
      note_create: canContent("note_create"),
      // proposals配備は画像のstage先を持たないため、画像付きNoteを受け付けない。
      note_images:
        canContent("note_create") &&
        !["proposals", "create-only", "proposals-and-start", "create-and-start"].includes(profile),
      note_edit: canContent("note_edit"),
      task_work_report:
        [
          "tasken.report_work",
          "tasken.append_work_receipt",
          "tasken.report_task_done",
          "tasken.report_task_blocked",
        ].some((name) => tools[name].available) &&
        advertised.has(TASKEN_CORE_PROPOSE_TASK_WORK_CAPABILITY),
      task_start: writeEnabled && advertised.has(TASKEN_CORE_TASK_START_WORK_CAPABILITY),
    },
    tools,
  };
}
