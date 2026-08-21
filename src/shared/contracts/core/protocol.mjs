export const TASKEN_CORE_API_VERSION = "1";
export const TASKEN_CORE_DISCOVERY_SCHEMA_VERSION = 1;
export const TASKEN_CORE_DISCOVERY_FILE = "tasken-core.json";
// Discovery advertises callable loopback operations individually. A broad
// query capability must never authorize a named endpoint by implication.
export const TASKEN_CORE_LIST_AGENT_READY_TASKS_CAPABILITY = "list_agent_ready_tasks";
export const TASKEN_CORE_RESOLVE_REPOSITORY_CONTEXT_CAPABILITY = "resolve_repository_context";
export const TASKEN_CORE_FIND_TASKS_FOR_REPOSITORY_CAPABILITY = "find_tasks_for_repository";
export const TASKEN_CORE_FIND_THEMES_FOR_REPOSITORY_CAPABILITY = "find_themes_for_repository";
export const TASKEN_CORE_GET_REPOSITORY_CONTEXT_CAPABILITY = "get_repository_context";
export const TASKEN_CORE_GET_TASK_ASSIGNMENT_CAPABILITY = "get_task_assignment";
export const TASKEN_CORE_GET_TASK_CONTEXT_CAPABILITY = "get_task_context";
export const TASKEN_CORE_SEARCH_ITEMS_CAPABILITY = "search_items";
export const TASKEN_CORE_LIST_OPEN_ITEMS_CAPABILITY = "list_open_items";
export const TASKEN_CORE_GET_NOTE_CAPABILITY = "get_note";
export const TASKEN_CORE_GET_CONVERSATION_CAPABILITY = "get_conversation";
export const TASKEN_CORE_GET_ARTIFACT_METADATA_CAPABILITY = "get_artifact_metadata";
export const TASKEN_CORE_GET_ACTIVITY_ENTRIES_CAPABILITY = "get_activity_entries";
export const TASKEN_CORE_GET_THEME_CONTEXT_CAPABILITY = "get_theme_context";
export const TASKEN_CORE_GET_RECENT_NOTES_CAPABILITY = "get_recent_notes";
export const TASKEN_CORE_SEARCH_KNOWLEDGE_CAPABILITY = "search_knowledge";
export const TASKEN_CORE_GET_KNOWLEDGE_CONTEXT_CAPABILITY = "get_knowledge_context";
export const TASKEN_CORE_GET_PLAN_HEALTH_CAPABILITY = "get_plan_health";
export const TASKEN_CORE_GET_KNOWLEDGE_HEALTH_CAPABILITY = "get_knowledge_health";
// These identify the shared Task capability contract, not loopback endpoints.
export const TASKEN_CORE_TASK_QUERY_CAPABILITY = "task.query";
export const TASKEN_CORE_TASK_COMMAND_CAPABILITY = "task.command";
