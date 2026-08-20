export const TASKEN_MOBILE_API_VERSION = 1;
export const TASKEN_MOBILE_SCHEMA_VERSION = 1;
export const TASKEN_MOBILE_MAX_ITEMS = 50;
export const TASKEN_MOBILE_MAX_RESPONSE_BYTES = 256 * 1024;
export const TASKEN_MOBILE_CLIENT_TIMEOUT_MS = 5_000;

export const TASKEN_MOBILE_CAPABILITIES = Object.freeze({
  health: "mobile.health",
  todayRead: "mobile.today.read",
  taskCreate: "mobile.task.create",
});

export const TASKEN_MOBILE_ENDPOINTS = Object.freeze({
  health: "/v1/health",
  today: "/v1/today",
  taskCommands: "/v1/commands/tasks",
});
