/**
 * Provider-neutral repository identity and Theme/Task resolution.
 *
 * This module is deliberately pure. It never invokes Git, touches the file
 * system, clones a repository, or contacts a provider API.
 */

export const REPOSITORY_PROVIDERS = Object.freeze([
  "github",
  "gitlab",
  "azure_devops",
  "local",
  "generic_git",
  "unknown",
]);

export const REPOSITORY_CONTEXT_MODES = Object.freeze(["inherit", "extend", "override"]);

const providerSet = new Set(REPOSITORY_PROVIDERS);
const modeSet = new Set(REPOSITORY_CONTEXT_MODES);
const secretKeyPattern = /(?:token|secret|password|passwd|credential|authorization|cookie|private[_-]?key)/i;

function text(value) {
  return value == null ? "" : String(value).trim();
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
}

function repositoryContextIdList(value, field) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${field}は配列で指定してください。`);
  return uniqueStrings(value);
}

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error("Repository URLのパスに不正なURLエンコードがあります。");
  }
}

function normalizeRemotePath(value) {
  const segments = [];
  for (const rawSegment of String(value || "").replace(/\\/g, "/").split("/")) {
    const segment = decodeSegment(rawSegment).trim();
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) throw new Error("Repository URLのパスが不正です。");
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (segments.length && /\.git$/i.test(segments.at(-1))) segments[segments.length - 1] = segments.at(-1).slice(0, -4);
  if (!segments.length || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Repository URLからrepository pathを解決できません。");
  }
  return segments;
}

function providerForHost(host) {
  const normalized = host.toLowerCase();
  if (normalized === "github.com" || normalized.endsWith(".github.com")) return "github";
  if (normalized === "gitlab.com") return "gitlab";
  if (normalized === "dev.azure.com" || normalized.endsWith(".visualstudio.com")) return "azure_devops";
  return "generic_git";
}

function parseRemote(value) {
  const source = text(value);
  if (!source) return null;
  if (/^[A-Za-z]:[\\/]/.test(source) || source.startsWith("\\\\")) return null;

  let host = "";
  let authority = "";
  let remotePath = "";
  let transport = "https";
  if (!source.includes("://") && /^[^@/\s]+@[^:/\s]+:.+$/.test(source)) {
    const separator = source.indexOf(":");
    const at = source.lastIndexOf("@", separator);
    host = source.slice(at + 1, separator).toLowerCase();
    authority = host;
    remotePath = source.slice(separator + 1);
    transport = "ssh";
  } else {
    let parsed;
    try {
      parsed = new URL(source);
    } catch {
      throw new Error("Repository URLはHTTPS、SSH、またはscp形式で指定してください。");
    }
    if (!["http:", "https:", "ssh:", "git+ssh:"].includes(parsed.protocol)) {
      throw new Error("Repository URLはHTTPS、SSH、またはscp形式で指定してください。");
    }
    host = parsed.hostname.toLowerCase();
    authority = parsed.host.toLowerCase();
    remotePath = parsed.pathname;
    transport = parsed.protocol === "ssh:" || parsed.protocol === "git+ssh:" ? "ssh" : parsed.protocol.slice(0, -1);
  }
  if (!host) throw new Error("Repository URLのhostを解決できません。");
  const segments = normalizeRemotePath(remotePath);
  const repositorySlug = segments.join("/");
  const name = segments.at(-1);
  const owner = segments.slice(0, -1).join("/") || null;
  const canonicalIdentity = `${authority}/${repositorySlug}`;
  return {
    canonicalUrl: `https://${authority}/${repositorySlug}`,
    canonicalIdentity,
    host: authority,
    provider: providerForHost(host),
    repositorySlug,
    owner,
    name,
    transport,
  };
}

/**
 * HTTPS / SSH / scp remote forms become one credential-free identity.
 * Query, fragment, username, and password are never returned.
 */
export function canonicalizeRepositoryUrl(value) {
  return parseRemote(value);
}

export const canonicalizeRemoteUrl = canonicalizeRepositoryUrl;

function normalizeWindowsPath(value) {
  const source = value.replace(/\//g, "\\");
  const drive = /^[A-Za-z]:\\/.test(source) ? `${source[0].toLowerCase()}:\\` : "";
  const unc = source.startsWith("\\\\");
  const prefixLength = drive ? 3 : unc ? 2 : 0;
  const segments = [];
  for (const segment of source.slice(prefixLength).split("\\")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length) segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const normalized = drive
    ? `${drive}${segments.join("\\")}`
    : unc
      ? `\\\\${segments.join("\\")}`
      : segments.join("\\");
  return normalized.replace(/\\+$/, normalized.length <= 3 ? "\\" : "").toLowerCase();
}

function normalizePosixPath(value) {
  const absolute = value.startsWith("/");
  const segments = [];
  for (const segment of value.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length && segments.at(-1) !== "..") segments.pop();
      else if (!absolute) segments.push("..");
      continue;
    }
    segments.push(segment);
  }
  return `${absolute ? "/" : ""}${segments.join("/")}` || (absolute ? "/" : "");
}

/** Normalize without resolving the path against the filesystem. */
export function normalizeLocalRepositoryPath(value) {
  const source = text(value);
  if (!source) return null;
  if (/^[A-Za-z]:[\\/]/.test(source) || source.startsWith("\\\\")) return normalizeWindowsPath(source);
  if (source.startsWith("/")) return normalizePosixPath(source);
  throw new Error("local_pathはabsolute Windows/UNC/POSIX pathで指定してください。");
}

export function normalizeRepositorySubdirectory(value) {
  const source = text(value).replace(/\\/g, "/");
  if (!source) return null;
  if (source.startsWith("/") || /^[A-Za-z]:\//.test(source)) {
    throw new Error("subdirectoryはrepository rootからの相対パスで指定してください。");
  }
  const segments = [];
  for (const segment of source.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) throw new Error("subdirectoryがrepository rootの外を指しています。");
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/") || null;
}

function normalizeMetadataValue(value, depth = 0) {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (depth > 3) throw new Error("Repository metadataの入れ子が深すぎます。");
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => normalizeMetadataValue(entry, depth + 1));
  if (!isRecord(value)) throw new Error("Repository metadataはJSON値で指定してください。");
  const result = {};
  for (const [key, entry] of Object.entries(value).slice(0, 50)) {
    if (secretKeyPattern.test(key)) throw new Error("Repository metadataにcredential/token等を保存できません。");
    result[key] = normalizeMetadataValue(entry, depth + 1);
  }
  return result;
}

export function normalizeRepositoryMetadata(value) {
  if (value == null || value === "") return {};
  if (!isRecord(value)) throw new Error("Repository metadataはobjectで指定してください。");
  return normalizeMetadataValue(value);
}

function normalizeWebUrl(value) {
  const source = text(value);
  if (!source) return null;
  let parsed;
  try { parsed = new URL(source); } catch { throw new Error("Repository web URLが不正です。"); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("Repository web URLはHTTP(S)で指定してください。");
  const pathSegments = parsed.pathname
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => decodeSegment(segment).trim())
    .filter((segment) => segment && segment !== ".");
  return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathSegments.length ? `/${pathSegments.join("/")}` : ""}`;
}

/** Normalize the persisted RepositoryContext shape and drop unsafe input. */
export function normalizeRepositoryContext(input = {}) {
  if (!isRecord(input)) throw new Error("RepositoryContextはobjectで指定してください。");
  const explicitProvider = text(input.provider);
  if (explicitProvider && !providerSet.has(explicitProvider)) throw new Error("RepositoryContext.providerが不正です。");
  const remote = parseRemote(input.remote_url ?? input.canonical_url ?? input.repository_url ?? input.url);
  const localPath = normalizeLocalRepositoryPath(input.local_path);
  if (!remote && !localPath) throw new Error("Repository URLまたはlocal repository pathを指定してください。");
  const aliases = uniqueStrings(input.remote_aliases).map((alias) => parseRemote(alias)?.canonicalUrl).filter(Boolean);
  const repositorySlug = remote?.repositorySlug || text(input.repository_slug) || null;
  return {
    ...(text(input.id) ? { id: text(input.id) } : {}),
    // A local path is private implementation data; never use it as the
    // display label fallback where it could cross an AI/public projection.
    label: text(input.label) || repositorySlug || (localPath ? "Local repository" : "Repository"),
    provider: explicitProvider || remote?.provider || "local",
    canonical_url: remote?.canonicalUrl || null,
    canonical_identity: remote?.canonicalIdentity || (localPath ? `local:${localPath}` : null),
    web_url: normalizeWebUrl(input.web_url) || remote?.canonicalUrl || null,
    local_path: localPath,
    repository_slug: repositorySlug,
    owner: remote?.owner || null,
    name: remote?.name || null,
    remote_aliases: [...new Set([...(aliases || []), ...(remote?.canonicalUrl ? [remote.canonicalUrl] : [])])],
    repository_root_hint: normalizeRepositorySubdirectory(input.repository_root_hint),
    default_branch: text(input.default_branch) || null,
    subdirectory: normalizeRepositorySubdirectory(input.subdirectory),
    active: input.active !== false,
    metadata: normalizeRepositoryMetadata(input.metadata),
  };
}

export function normalizeRepositoryLinkFields(type, input = {}) {
  if (!isRecord(input)) throw new Error(`${type}はobjectで指定してください。`);
  if (type === "theme" || type === "project") {
    const ids = repositoryContextIdList(input.repository_context_ids, `${type}.repository_context_ids`);
    const primary = text(input.primary_repository_context_id) || null;
    if (primary && !ids.includes(primary)) throw new Error(`${type}.primary_repository_context_idはrepository_context_ids内に指定してください。`);
    return { repository_context_ids: ids, primary_repository_context_id: primary };
  }
  if (type === "task") {
    const mode = text(input.repository_context_mode) || "inherit";
    if (!modeSet.has(mode)) throw new Error("task.repository_context_modeが不正です。");
    const ids = repositoryContextIdList(input.repository_context_ids, "task.repository_context_ids");
    const primary = text(input.primary_repository_context_id) || null;
    if (primary && mode !== "inherit" && !ids.includes(primary)) throw new Error("task.primary_repository_context_idはTaskのRepositoryContext選択内に指定してください。");
    return {
      repository_context_mode: mode,
      repository_context_ids: ids,
      primary_repository_context_id: primary,
      repository_subdirectory: normalizeRepositorySubdirectory(input.repository_subdirectory),
      repository_branch_hint: text(input.repository_branch_hint) || null,
    };
  }
  return {};
}

function themeRepositoryIds(theme) {
  return uniqueStrings(theme?.repository_context_ids);
}

function contextRemoteIdentities(context) {
  const identities = new Set();
  if (context?.canonical_identity) identities.add(String(context.canonical_identity));
  for (const alias of Array.isArray(context?.remote_aliases) ? context.remote_aliases : []) {
    try {
      const parsed = parseRemote(alias);
      if (parsed) identities.add(parsed.canonicalIdentity);
    } catch {
      // A stale alias cannot make a candidate match.
    }
  }
  return identities;
}

export function resolveThemeRepositoryContexts(theme, contexts = []) {
  const contextById = new Map(contexts.filter((entry) => entry).map((entry) => [String(entry.id), entry]));
  const contextIds = themeRepositoryIds(theme);
  const resolved = contextIds.flatMap((id) => {
    const context = contextById.get(id);
    return context && !context.deleted_at && context.active !== false ? [context] : [];
  });
  const unavailableContextIds = contextIds.filter((id) => !resolved.some((entry) => String(entry.id) === id));
  const missingContextReasons = Object.fromEntries(unavailableContextIds.map((id) => {
    const context = contextById.get(id);
    return [id, context?.deleted_at ? "deleted" : context?.active === false ? "inactive" : "unknown"];
  }));
  const primaryCandidate = text(theme?.primary_repository_context_id);
  return {
    mode: "theme",
    contextIds,
    contexts: resolved,
    missingContextIds: unavailableContextIds,
    missingContextReasons,
    primaryContextId: resolved.some((entry) => String(entry.id) === primaryCandidate)
      ? primaryCandidate
      : String(resolved[0]?.id || "") || null,
  };
}

export function resolveTaskRepositoryContexts({ task, theme, contexts = [] } = {}) {
  const mode = modeSet.has(text(task?.repository_context_mode)) ? task.repository_context_mode : "inherit";
  const explicitIds = uniqueStrings(task?.repository_context_ids);
  const themeIds = themeRepositoryIds(theme);
  const contextIds = mode === "override"
    ? explicitIds
    : mode === "extend"
      ? [...new Set([...themeIds, ...explicitIds])]
      : themeIds;
  const contextById = new Map(contexts.filter((entry) => entry).map((entry) => [String(entry.id), entry]));
  const resolvedContexts = contextIds.flatMap((id) => {
    const context = contextById.get(id);
    return context && !context.deleted_at && context.active !== false ? [context] : [];
  });
  const unavailableContextIds = contextIds.filter((id) => !resolvedContexts.some((entry) => String(entry.id) === id));
  const missingContextReasons = Object.fromEntries(unavailableContextIds.map((id) => {
    const context = contextById.get(id);
    return [id, context?.deleted_at ? "deleted" : context?.active === false ? "inactive" : "unknown"];
  }));
  const primaryTaskId = text(task?.primary_repository_context_id);
  const primaryThemeId = text(theme?.primary_repository_context_id);
  return {
    mode,
    contextIds,
    contexts: resolvedContexts,
    missingContextIds: unavailableContextIds,
    missingContextReasons,
    primaryContextId: contextIds.includes(primaryTaskId) && resolvedContexts.some((entry) => String(entry.id) === primaryTaskId)
      ? primaryTaskId
      : contextIds.includes(primaryThemeId) && resolvedContexts.some((entry) => String(entry.id) === primaryThemeId)
        ? primaryThemeId
        : String(resolvedContexts[0]?.id || "") || null,
    subdirectory: normalizeRepositorySubdirectory(task?.repository_subdirectory),
    branchHint: text(task?.repository_branch_hint) || null,
  };
}

function pathWithin(candidate, root) {
  if (!candidate || !root) return false;
  const normalizedCandidate = candidate.replace(/[\\/]$/, "");
  const normalizedRoot = root.replace(/[\\/]$/, "");
  if (normalizedCandidate === normalizedRoot) return true;
  const separator = normalizedRoot.includes("\\") ? "\\" : "/";
  return normalizedCandidate.startsWith(`${normalizedRoot}${separator}`);
}

function currentRepositoryIdentity(current = {}) {
  const remoteValues = [current.remote_url, ...(Array.isArray(current.remote_urls) ? current.remote_urls : [])];
  const remotes = remoteValues.map((value) => parseRemote(value)).filter(Boolean);
  const identities = new Set(remotes.map((remote) => remote.canonicalIdentity));
  const gitRoot = (() => {
    try { return normalizeLocalRepositoryPath(current.git_root || current.gitRoot); } catch { return null; }
  })();
  const workspaceRaw = current.workspace_folder || current.workspaceFolder;
  const workspaceFolder = (() => {
    if (!workspaceRaw) return null;
    try {
      const normalized = normalizeLocalRepositoryPath(workspaceRaw);
      if (!gitRoot || !pathWithin(normalized, gitRoot)) return null;
      return normalized === gitRoot
        ? null
        : normalizeRepositorySubdirectory(normalized.slice(gitRoot.length).replace(/^[\\/]+/, ""));
    } catch {
      return normalizeRepositorySubdirectory(workspaceRaw);
    }
  })();
  return {
    repositoryId: text(current.repository_id || current.repositoryId),
    provider: text(current.provider),
    repositorySlug: text(current.repository_slug || current.repositorySlug),
    remoteIdentities: identities,
    gitRoot,
    cwd: (() => {
      try { return normalizeLocalRepositoryPath(current.cwd || current.working_directory || current.workingDirectory); } catch { return null; }
    })(),
    workspaceFolder,
  };
}

function candidateForContext(context, current) {
  const reasons = [];
  let score = 0;
  if (current.repositoryId && String(context.id) === current.repositoryId) {
    score = Math.max(score, 1000);
    reasons.push("stable_repository_id");
  }
  if ([...contextRemoteIdentities(context)].some((identity) => current.remoteIdentities.has(identity))) {
    score = Math.max(score, 800);
    reasons.push("canonical_remote_url");
  }
  if (current.repositorySlug && String(context.repository_slug || "") === current.repositorySlug
    && (!current.provider || current.provider === context.provider)) {
    score = Math.max(score, 600);
    reasons.push("provider_and_repository_slug");
  }
  const localRoot = normalizeLocalRepositoryPath(context.local_path);
  if (localRoot && current.gitRoot && localRoot === current.gitRoot) {
    score = Math.max(score, 500);
    reasons.push("registered_git_root");
  } else if (localRoot && current.cwd && pathWithin(current.cwd, localRoot)) {
    score = Math.max(score, 450);
    reasons.push("registered_local_ancestor");
  }
  if (context.subdirectory) {
    if (!current.workspaceFolder || !subdirectoryWithin(current.workspaceFolder, context.subdirectory)) return null;
    score += 25;
    reasons.push("subdirectory");
  }
  return score ? { context, score, reasons } : null;
}

function subdirectoryWithin(candidate, root) {
  const normalizedCandidate = normalizeRepositorySubdirectory(candidate);
  const normalizedRoot = normalizeRepositorySubdirectory(root);
  if (!normalizedCandidate || !normalizedRoot) return normalizedCandidate === normalizedRoot;
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

/** Resolve a current workspace without ever selecting an arbitrary tie. */
export function resolveRepositoryContext({ current = {}, contexts = [] } = {}) {
  const normalizedCurrent = currentRepositoryIdentity(current);
  const candidates = contexts
    .filter((context) => context && !context.deleted_at && context.active !== false)
    .map((context) => {
      try { return candidateForContext(context, normalizedCurrent); } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || String(a.context.id).localeCompare(String(b.context.id)));
  if (!candidates.length) {
    return {
      status: "unknown",
      reason_code: "no_matching_repository_context",
      reason: "現在のworkspaceを登録済みRepositoryContextへ対応付けられませんでした。remote URL、repository slug、git rootを確認してください。",
      selected: null,
      candidates: [],
    };
  }
  const highest = candidates[0].score;
  const top = candidates.filter((candidate) => candidate.score === highest);
  if (top.length > 1) {
    return {
      status: "ambiguous",
      reason_code: "multiple_equal_repository_contexts",
      reason: "同じ優先度で一致するRepositoryContextが複数あります。候補を確認して一つに絞ってください。",
      selected: null,
      candidates: top,
    };
  }
  return {
    status: "matched",
    reason_code: "repository_context_matched",
    reason: `RepositoryContextを${top[0].reasons.join(" / ")}で一致させました。`,
    selected: top[0].context,
    candidates: top,
  };
}

function contextIdsFromMatch(match) {
  return new Set((match?.candidates || []).map((candidate) => String(candidate.context.id)));
}

export function findThemesForRepository({ current = {}, contexts = [], themes = [] } = {}) {
  const match = resolveRepositoryContext({ current, contexts });
  const ids = contextIdsFromMatch(match);
  const matches = themes.filter((theme) => themeRepositoryIds(theme).some((id) => ids.has(id)));
  return { ...match, themes: matches, matched_context_ids: [...ids] };
}

export function findTasksForRepository({ current = {}, contexts = [], themes = [], tasks = [] } = {}) {
  const match = resolveRepositoryContext({ current, contexts });
  const ids = contextIdsFromMatch(match);
  const normalizedCurrent = currentRepositoryIdentity(current);
  const themesById = new Map(themes.map((theme) => [String(theme.id), theme]));
  const matches = tasks.filter((task) => {
    const theme = themesById.get(String(task.project_id || task.theme_id || ""));
    const resolved = resolveTaskRepositoryContexts({ task, theme, contexts });
    if (!resolved.contextIds.some((id) => ids.has(id))) return false;
    if (!resolved.subdirectory) return true;
    if (!normalizedCurrent.workspaceFolder) return false;
    return subdirectoryWithin(normalizedCurrent.workspaceFolder, resolved.subdirectory);
  });
  return { ...match, tasks: matches, matched_context_ids: [...ids] };
}

export function publicRepositoryContext(context) {
  if (!context) return null;
  const remote = [context.canonical_url, context.remote_url, context.repository_url, context.url]
    .map((value) => {
      try { return parseRemote(value); } catch { return null; }
    })
    .find(Boolean) || null;
  const localPath = (() => {
    try { return normalizeLocalRepositoryPath(context.local_path); } catch { return null; }
  })();
  const normalized = (() => {
    try { return normalizeRepositoryContext(context); } catch { return null; }
  })();
  const safeWebUrl = (() => {
    try { return normalizeWebUrl(context.web_url); } catch { return null; }
  })();
  const isLocal = context.provider === "local"
    || String(context.canonical_identity || "").startsWith("local:")
    || (!remote && Boolean(localPath));
  const canonicalUrl = remote?.canonicalUrl || (!isLocal ? normalized?.canonical_url || null : null);
  const canonicalIdentity = remote?.canonicalIdentity || (!isLocal ? normalized?.canonical_identity || null : null);
  const repositorySlug = remote?.repositorySlug || (!isLocal ? normalized?.repository_slug || null : null);
  const label = text(context.label) || repositorySlug || (isLocal ? "Local repository" : "Repository");
  const aliases = uniqueStrings(context.remote_aliases)
    .map((alias) => {
      try { return parseRemote(alias)?.canonicalUrl || null; } catch { return null; }
    })
    .filter(Boolean);
  return {
    ...(context.id ? { id: context.id } : {}),
    label,
    provider: providerSet.has(context.provider) ? context.provider : remote?.provider || "unknown",
    canonical_url: isLocal ? null : canonicalUrl,
    canonical_identity: isLocal ? null : canonicalIdentity,
    web_url: isLocal ? null : safeWebUrl,
    repository_slug: isLocal ? null : repositorySlug,
    owner: isLocal ? null : remote?.owner || normalized?.owner || null,
    name: isLocal ? null : remote?.name || normalized?.name || null,
    remote_aliases: isLocal ? [] : [...new Set([...(aliases || []), ...(remote?.canonicalUrl ? [remote.canonicalUrl] : [])])],
    default_branch: text(context.default_branch) || null,
    subdirectory: normalized?.subdirectory || null,
    active: context.active !== false,
    metadata: {},
  };
}
