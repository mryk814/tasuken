export const TASKEN_MOBILE_API_VERSION = 1;
export const TASKEN_MOBILE_SCHEMA_VERSION = 6;
export const TASKEN_MOBILE_MAX_ITEMS = 50;
export const TASKEN_MOBILE_MAX_RESPONSE_BYTES = 256 * 1024;
export const TASKEN_MOBILE_CLIENT_TIMEOUT_MS = 5_000;

const TASK_LOCATOR_PREFIX = "tasken://task/";

function isWellFormedUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function canonicalTaskId(value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 200 ||
    value !== value.trim() ||
    !isWellFormedUnicode(value)
  ) {
    throw new TypeError("Task ID must be a trimmed string between 1 and 200 characters");
  }
  return value;
}

function percentEncodeTaskId(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** @param {unknown} value @returns {string | null} */
export function parseCanonicalTaskId(value) {
  try {
    return canonicalTaskId(value);
  } catch {
    return null;
  }
}

/** Canonical, reversible Task locator. The exact Task ID is UTF-8 percent-encoded once.
 * @param {string} taskId
 */
export function formatTaskLocator(taskId) {
  return `${TASK_LOCATOR_PREFIX}${percentEncodeTaskId(canonicalTaskId(taskId))}`;
}

/** Parse only the canonical one-segment tasken://task locator form.
 * @param {unknown} locator
 * @returns {string | null}
 */
export function parseTaskLocator(locator) {
  if (typeof locator !== "string" || !locator.startsWith(TASK_LOCATOR_PREFIX)) return null;
  const segment = locator.slice(TASK_LOCATOR_PREFIX.length);
  if (!segment || segment.includes("/") || /[?#]/u.test(segment)) return null;
  let taskId;
  try {
    taskId = decodeURIComponent(segment);
    canonicalTaskId(taskId);
  } catch {
    return null;
  }
  return formatTaskLocator(taskId) === locator ? taskId : null;
}

export const TASKEN_MOBILE_CAPABILITIES = Object.freeze({
  health: "mobile.health",
  todayRead: "mobile.today.read",
  syncRead: "mobile.sync.read",
  workReceiptRead: "mobile.work-receipt.read",
  proposalRead: "mobile.proposal.read",
  proposalReview: "mobile.proposal.review",
  humanReview: "mobile.human-review",
  taskContextPreviewRead: "mobile.task-context-preview.read",
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
  taskContextPreview: "/v1/task-context-preview",
  taskDelegations: "/v1/task-delegations",
  bootstrap: "/v1/bootstrap",
  sync: "/v1/sync",
  commands: "/v1/commands",
});
