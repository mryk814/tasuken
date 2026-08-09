import { normalizeRepositoryContext, publicRepositoryContext } from "./repositoryContext.mjs";

const PROPOSAL_ACTIONS = new Set(["create", "merge", "ignore"]);

function text(value) {
  return value == null ? "" : String(value).trim();
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function contextVersion(context) {
  return Number(context?.version || 0);
}

/** Build the credential-free MCP proposal input without overriding provider inference. */
export function repositoryContextProposalInput(args = {}) {
  const provider = text(args.provider);
  return {
    action: "create",
    label: text(args.label),
    ...(provider ? { provider } : {}),
    remote_url: text(args.remote_url) || null,
    local_path: text(args.local_path) || null,
    web_url: text(args.web_url) || null,
    repository_slug: text(args.repository_slug) || null,
    subdirectory: text(args.subdirectory) || null,
    default_branch: text(args.default_branch) || null,
    reason: text(args.reason),
  };
}

/**
 * Normalize a RepositoryContext proposal for the review UI.
 *
 * `entry` is the credential-free/public preview shape. `normalized` is kept
 * separately for the accept boundary so a private local path never reaches
 * the preview projection. MCP proposals intentionally cannot create a local
 * context: local paths stay in the user-controlled Theme/Task UI.
 */
export function buildRepositoryContextProposalCandidate(input, contexts = []) {
  if (!plainObject(input)) throw new Error("repository_contextsの候補はJSON objectにしてください。");
  const requestedAction = text(input.action);
  const action = PROPOSAL_ACTIONS.has(requestedAction) ? requestedAction : "ignore";
  const targetId = text(input.target_id);
  const target = targetId ? contexts.find((context) => String(context.id) === targetId) : undefined;
  const issues = [];
  let normalized;
  try {
    normalized = normalizeRepositoryContext(input);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  if (normalized?.provider === "local" || String(normalized?.canonical_identity || "").startsWith("local:")) {
    issues.push("local repositoryはprivate pathを含むため、ThemeのRepository context UIから作成してください。");
  }
  if (action === "merge" && !targetId) issues.push("mergeにはtarget_idが必要です。");
  if (action === "merge" && targetId && !target) issues.push("merge対象のRepositoryContextが見つかりません。");
  if (action === "merge" && target && (target.deleted_at || target.active === false)) {
    issues.push("deleted/inactiveなRepositoryContextはmerge対象にできません。");
  }
  if (action === "merge" && target && !Number.isInteger(input.base_version)) {
    issues.push("mergeにはbase_versionが必要です。");
  }
  if (action === "merge" && target && Number.isInteger(input.base_version)
    && Number(input.base_version) !== contextVersion(target)) {
    issues.push(`RepositoryContextが更新されています（提案 ${Number(input.base_version)} / 現在 ${contextVersion(target)}）`);
  }
  const publicEntry = normalized ? publicRepositoryContext(normalized) : null;
  const entry = {
    ...(publicEntry || {}),
    action,
    ...(targetId ? { target_id: targetId } : {}),
    ...(input.base_version != null ? { base_version: Number(input.base_version) } : {}),
    reason: text(input.reason),
  };
  return {
    entry,
    normalized,
    duplicate: target,
    action: issues.length && action !== "ignore" ? "ignore" : action,
    issues,
  };
}

/**
 * Recheck merge targets at the human accept boundary and build save-only
 * operations. The caller must still save the proposal status in the same
 * transaction/batch as these operations.
 */
export function buildRepositoryContextProposalOperations(candidates, contexts, idFactory = () => crypto.randomUUID()) {
  return candidates.flatMap((candidate) => {
    if (candidate.action === "ignore") return [];
    if (candidate.issues?.length) throw new Error(`確認事項が残っているRepositoryContext候補があります: ${candidate.issues.join(" / ")}`);
    if (!candidate.normalized) throw new Error("RepositoryContext候補の正規化結果がありません。");
    const targetId = text(candidate.entry?.target_id);
    const target = targetId ? contexts.find((context) => String(context.id) === targetId) : undefined;
    if (candidate.action === "merge") {
      if (!target) throw new Error("RepositoryContextのmerge対象が見つかりません。再読み込みしてPreviewし直してください。");
      if (target.deleted_at || target.active === false) throw new Error("deleted/inactiveなRepositoryContextはmerge対象にできません。");
      const baseVersion = Number(candidate.entry?.base_version);
      if (!Number.isInteger(baseVersion) || baseVersion !== contextVersion(target)) {
        throw new Error("RepositoryContextのmerge対象がPreview後に更新されています。再読み込みしてPreviewし直してください。");
      }
    }
    const entity = {
      ...(candidate.action === "merge" && target ? target : {}),
      ...candidate.normalized,
      id: candidate.action === "merge" && target ? target.id : candidate.normalized.id || idFactory(),
    };
    if (entity.local_path == null) delete entity.local_path;
    if (entity.repository_root_hint == null) delete entity.repository_root_hint;
    return [{ action: "save", type: "repository_context", entity, options: { source: "ai_proposal" } }];
  });
}
