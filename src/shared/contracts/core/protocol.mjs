export const TASKEN_CORE_API_VERSION = "1";
export const TASKEN_CORE_DISCOVERY_SCHEMA_VERSION = 1;
export const TASKEN_CORE_DISCOVERY_FILE = "tasken-core.json";
// Discovery advertises callable loopback operations individually. A broad
// query capability must never authorize a named endpoint by implication.
export const TASKEN_CORE_LIST_AGENT_READY_TASKS_CAPABILITY = "list_agent_ready_tasks";
export const TASKEN_CORE_RESOLVE_REPOSITORY_CONTEXT_CAPABILITY = "resolve_repository_context";
export const TASKEN_CORE_FIND_TASKS_FOR_REPOSITORY_CAPABILITY = "find_tasks_for_repository";
export const TASKEN_CORE_GET_TASK_ASSIGNMENT_CAPABILITY = "get_task_assignment";
export const TASKEN_CORE_GET_TASK_CONTEXT_CAPABILITY = "get_task_context";
// These identify the shared Task capability contract, not loopback endpoints.
export const TASKEN_CORE_TASK_QUERY_CAPABILITY = "task.query";
export const TASKEN_CORE_TASK_COMMAND_CAPABILITY = "task.command";
