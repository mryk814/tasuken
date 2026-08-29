export const TASKEN_MOBILE_API_VERSION = 1;
export const TASKEN_MOBILE_SCHEMA_VERSION = 5;
export const TASKEN_MOBILE_MAX_ITEMS = 50;
export const TASKEN_MOBILE_MAX_RESPONSE_BYTES = 256 * 1024;
export const TASKEN_MOBILE_CLIENT_TIMEOUT_MS = 5_000;

export const TASKEN_MOBILE_CAPABILITIES = Object.freeze({
  health: "mobile.health",
  todayRead: "mobile.today.read",
  syncRead: "mobile.sync.read",
  workReceiptRead: "mobile.work-receipt.read",
  proposalRead: "mobile.proposal.read",
  proposalReview: "mobile.proposal.review",
  humanReview: "mobile.human-review",
  taskWrite: "mobile.task.write",
  captureWrite: "mobile.capture.write",
});

export const TASKEN_MOBILE_ENDPOINTS = Object.freeze({
  pair: "/v1/pair",
  health: "/v1/health",
  today: "/v1/today",
  themes: "/v1/themes",
  workReceipt: "/v1/work-receipt",
  proposals: "/v1/proposals",
  proposalDecisions: "/v1/proposal-decisions",
  workReviews: "/v1/work-reviews",
  bootstrap: "/v1/bootstrap",
  sync: "/v1/sync",
  commands: "/v1/commands",
});
