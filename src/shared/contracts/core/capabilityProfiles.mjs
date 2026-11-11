import {
  TASKEN_CORE_AI_DIRECT_WRITE_CAPABILITY,
  TASKEN_CORE_AI_TASK_CHANGE_CAPABILITY,
  TASKEN_CORE_CREATE_AI_ITEM_CAPABILITY,
  TASKEN_CORE_PROPOSE_AGENT_SESSION_CAPABILITY,
  TASKEN_CORE_PROPOSE_CONTENT_CAPABILITY,
  TASKEN_CORE_PROPOSE_REPOSITORY_TASK_CAPABILITY,
  TASKEN_CORE_PROPOSE_TASK_WORK_CAPABILITY,
  TASKEN_CORE_TASK_START_WORK_CAPABILITY,
} from "./protocol.mjs";

/** テキストの提案（Feed投稿・Note案・Task案・Task作業報告）。NAS replicaの`proposals`配備はこれだけを公開する。 */
const PROPOSAL_CAPABILITIES = Object.freeze([
  TASKEN_CORE_PROPOSE_REPOSITORY_TASK_CAPABILITY,
  TASKEN_CORE_PROPOSE_CONTENT_CAPABILITY,
  TASKEN_CORE_PROPOSE_TASK_WORK_CAPABILITY,
]);

/**
 * Desktop（`full`）が必ず公開する書き込み。Agent Sessionの提案とAI Ready Taskの開始は`full`だけが持つ。
 * 足りない分は`partial`の`missingWrites`として報告する。
 */
const FULL_CAPABILITIES = Object.freeze([
  ...PROPOSAL_CAPABILITIES,
  TASKEN_CORE_PROPOSE_AGENT_SESSION_CAPABILITY,
  TASKEN_CORE_TASK_START_WORK_CAPABILITY,
]);

/**
 * 書き込みcapabilityの全部。配備によって公開範囲が変わるため、読み取りとは別に扱う
 * （doctorは、ここに無いものを読み取りの必須として確かめる）。
 * Task・Noteの新規作成は、それだけでは配備の形を決めない追加の許可。
 * 既存Taskの直接変更も、新規作成の配備に足す追加の許可で、配備の名前は変えない。
 */
export const TASKEN_CORE_WRITE_CAPABILITIES = Object.freeze([
  ...FULL_CAPABILITIES,
  TASKEN_CORE_CREATE_AI_ITEM_CAPABILITY,
  TASKEN_CORE_AI_TASK_CHANGE_CAPABILITY,
  TASKEN_CORE_AI_DIRECT_WRITE_CAPABILITY,
]);

/**
 * @typedef {"full" | "proposals" | "read-only" | "partial" | "create-only" | "start-only" | "proposals-and-start" | "create-and-start"} CoreWriteProfile
 * @typedef {{ profile: CoreWriteProfile, missingWrites: string[] }} CoreWriteProfileResult
 */

/**
 * Coreが公開している書き込みの範囲。
 * `partial`は既知の配備と一致しない組み合わせで、更新や設定の不一致として扱う。
 * 汎用のTask変更（`task.command`）はloopbackに出さないので、どの配備の判定にも使わない。
 * @param {unknown} capabilities
 * @returns {CoreWriteProfileResult}
 */
export function coreWriteProfile(capabilities) {
  const advertised = Array.isArray(capabilities) ? capabilities : [];
  const has = (capability) => advertised.includes(capability);
  const missingWrites = FULL_CAPABILITIES.filter((capability) => !has(capability));
  const proposals = PROPOSAL_CAPABILITIES.every(has);
  const anyProposal = PROPOSAL_CAPABILITIES.some(has);
  const agentSession = has(TASKEN_CORE_PROPOSE_AGENT_SESSION_CAPABILITY);
  const start = has(TASKEN_CORE_TASK_START_WORK_CAPABILITY);
  const create = has(TASKEN_CORE_CREATE_AI_ITEM_CAPABILITY);
  /** @param {CoreWriteProfile} profile */
  const result = (profile) => ({ profile, missingWrites });
  if (missingWrites.length === 0) return result("full");
  // 取り消せない直接の書き込み（Noteの編集・採否）はDesktop（full）だけが持つ。
  if (has(TASKEN_CORE_AI_DIRECT_WRITE_CAPABILITY)) return result("partial");
  // 既存Taskの直接変更は、新規作成を許した配備（NASのcreate-only）にだけ足せる。
  if (has(TASKEN_CORE_AI_TASK_CHANGE_CAPABILITY) && !create) return result("partial");
  if (!anyProposal && !agentSession && !create) return result(start ? "start-only" : "read-only");
  // Agent Sessionの提案は`full`だけが公開する。一部だけ揃っていれば更新・設定の食い違い。
  if (!proposals || agentSession) return result("partial");
  if (create) return result(start ? "create-and-start" : "create-only");
  return result(start ? "proposals-and-start" : "proposals");
}
