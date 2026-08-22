export const TASKEN_MOBILE_API_VERSION = 1;
export const TASKEN_MOBILE_SCHEMA_VERSION = 2;
export const TASKEN_MOBILE_MAX_ITEMS = 50;
export const TASKEN_MOBILE_MAX_RESPONSE_BYTES = 256 * 1024;
export const TASKEN_MOBILE_CLIENT_TIMEOUT_MS = 5_000;

export const TASKEN_MOBILE_CAPABILITIES = Object.freeze({
  health: "mobile.health",
  todayRead: "mobile.today.read",
  syncRead: "mobile.sync.read",
  taskWrite: "mobile.task.write",
});

export const TASKEN_MOBILE_ENDPOINTS = Object.freeze({
  pair: "/v1/pair",
  health: "/v1/health",
  today: "/v1/today",
  themes: "/v1/themes",
  bootstrap: "/v1/bootstrap",
  sync: "/v1/sync",
  commands: "/v1/commands",
});
