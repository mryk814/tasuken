import {
  TASKEN_CORE_PROPOSE_AGENT_SESSION_CAPABILITY,
  TASKEN_CORE_PROPOSE_CONTENT_CAPABILITY,
  TASKEN_CORE_PROPOSE_REPOSITORY_TASK_CAPABILITY,
  TASKEN_CORE_PROPOSE_TASK_WORK_CAPABILITY,
  TASKEN_CORE_TASK_COMMAND_CAPABILITY,
} from "./protocol.mjs";

/**
 * 書き込みcapability。配備によって公開範囲が変わるため、読み取りとは別に扱う。
 * `proposals`配備はテキストのFeed投稿・Note案・Task案・Task作業報告だけを公開する。
 * 直接書き込み（`task.command`）とAgent Sessionは`full`だけが公開する。
 */
export const TASKEN_CORE_WRITE_CAPABILITIES = Object.freeze([
  TASKEN_CORE_PROPOSE_TASK_WORK_CAPABILITY,
  TASKEN_CORE_PROPOSE_AGENT_SESSION_CAPABILITY,
  TASKEN_CORE_PROPOSE_REPOSITORY_TASK_CAPABILITY,
  TASKEN_CORE_PROPOSE_CONTENT_CAPABILITY,
  TASKEN_CORE_TASK_COMMAND_CAPABILITY,
]);

const PROPOSALS_ONLY_CAPABILITIES = Object.freeze([
  TASKEN_CORE_PROPOSE_REPOSITORY_TASK_CAPABILITY,
  TASKEN_CORE_PROPOSE_CONTENT_CAPABILITY,
  TASKEN_CORE_PROPOSE_TASK_WORK_CAPABILITY,
]);

/**
 * `proposals`配備が`propose_content`で受け付ける種類。画像付きNoteは含まない。
 * Coreの拒否とMCP bridgeの公開判定は、どちらもこの一覧を正本にする。
 */
export const TASKEN_CORE_PROPOSALS_CONTENT_KINDS = Object.freeze(["feed_post", "note_create"]);

/** `proposals`配備が`propose_repository_task`で受け付ける種類。 */
export const TASKEN_CORE_PROPOSALS_REPOSITORY_TASK_KINDS = Object.freeze(["task"]);

/**
 * @typedef {"full" | "proposals" | "read-only" | "partial"} CoreWriteProfile
 * @typedef {{ profile: CoreWriteProfile, missingWrites: string[] }} CoreWriteProfileResult
 */

/**
 * Coreが公開している書き込みの範囲。
 * `partial`は既知の配備と一致しない組み合わせで、更新や設定の不一致として扱う。
 * @param {unknown} capabilities
 * @returns {CoreWriteProfileResult}
 */
export function coreWriteProfile(capabilities) {
  const advertised = Array.isArray(capabilities) ? capabilities : [];
  const present = (capability) => advertised.includes(capability);
  const presentWrites = TASKEN_CORE_WRITE_CAPABILITIES.filter(present);
  const missingWrites = TASKEN_CORE_WRITE_CAPABILITIES.filter((capability) => !present(capability));
  if (presentWrites.length === 0) return { profile: "read-only", missingWrites };
  if (missingWrites.length === 0) return { profile: "full", missingWrites };
  if (
    presentWrites.length === PROPOSALS_ONLY_CAPABILITIES.length &&
    PROPOSALS_ONLY_CAPABILITIES.every(present)
  ) {
    return { profile: "proposals", missingWrites };
  }
  return { profile: "partial", missingWrites };
}
