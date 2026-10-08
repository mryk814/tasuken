import {
  normalizeLocalRepositoryPath,
  resolveTaskRepositoryContexts,
} from "../../../../../shared/repositoryContext.mjs";
import type { BaseRecord, Theme } from "../types";
import type { Task } from "../domain-model/types";

export interface AgentLaunchWorkspaceOption {
  id: string;
  label: string;
  path: string;
  cwd: string;
  unavailableReason: string;
  preferred: boolean;
}
export interface AgentLaunchWorkspaceGroup {
  id: string;
  label: string;
  related: boolean;
  options: AgentLaunchWorkspaceOption[];
}

function active(record: BaseRecord): boolean {
  return (
    !record.deleted_at &&
    !record.archived_at &&
    record.active !== false &&
    record.status !== "archived" &&
    record.state !== "archived"
  );
}
function option(context: BaseRecord): AgentLaunchWorkspaceOption {
  const raw = String(context.local_path || "");
  let cwd = "";
  try {
    const normalized = normalizeLocalRepositoryPath(raw);
    if (normalized && (/^[a-z]:\\/i.test(normalized) || normalized.startsWith("\\\\")))
      cwd = normalized;
  } catch {
    /* 壊れた登録も理由を示し、他の作業先は選べるようにする。 */
  }
  return {
    id: context.id,
    label: String(context.label || context.repository_slug || "作業先"),
    path: raw,
    cwd,
    unavailableReason: cwd
      ? ""
      : raw
        ? "Windowsの作業フォルダではありません"
        : "このPCのフォルダが未設定です",
    preferred: false,
  };
}

export function agentLaunchWorkspaceGroups(
  task: Pick<
    Task,
    | "id"
    | "project_id"
    | "repository_context_mode"
    | "repository_context_ids"
    | "primary_repository_context_id"
  >,
  themes: Theme[],
  contexts: BaseRecord[],
): AgentLaunchWorkspaceGroup[] {
  const available = contexts.filter(active);
  const currentTheme = themes.find((theme) => theme.id === task.project_id && active(theme));
  const resolution = resolveTaskRepositoryContexts({
    task,
    theme: currentTheme,
    contexts: available,
  }) as { contexts: BaseRecord[]; primaryContextId: string | null };
  const relatedIds = new Set(resolution.contexts.map((context) => context.id));
  const groups: AgentLaunchWorkspaceGroup[] = [];
  const groupedIds = new Set<string>();
  function append(id: string, label: string, entries: BaseRecord[], isTaskTheme = false) {
    if (!entries.length) return;
    const related = isTaskTheme || entries.some((entry) => relatedIds.has(entry.id));
    entries.sort(
      (a, b) =>
        Number(b.id === resolution.primaryContextId) -
          Number(a.id === resolution.primaryContextId) ||
        Number(relatedIds.has(b.id)) - Number(relatedIds.has(a.id)) ||
        String(a.label || "").localeCompare(String(b.label || ""), "ja"),
    );
    groups.push({
      id,
      label,
      related,
      options: entries.map((entry) => ({ ...option(entry), preferred: relatedIds.has(entry.id) })),
    });
    entries.forEach((entry) => groupedIds.add(entry.id));
  }
  const orderedThemes = themes
    .filter(active)
    .sort(
      (a, b) =>
        Number(b.id === task.project_id) - Number(a.id === task.project_id) ||
        a.name.localeCompare(b.name, "ja"),
    );
  for (const theme of orderedThemes) {
    const ids = new Set(theme.repository_context_ids || []);
    append(
      theme.id,
      theme.name,
      available.filter((context) => ids.has(context.id) && !groupedIds.has(context.id)),
      theme.id === task.project_id,
    );
  }
  append(
    "unassigned",
    "Theme未設定",
    available.filter((context) => !groupedIds.has(context.id)),
  );
  return groups;
}

export function isRegisteredAgentLaunchDirectory(
  groups: AgentLaunchWorkspaceGroup[],
  directory: string,
): boolean {
  try {
    const normalized = normalizeLocalRepositoryPath(directory);
    return (
      Boolean(normalized) &&
      groups.some((group) => group.options.some((entry) => entry.cwd === normalized))
    );
  } catch {
    return false;
  }
}

export function initialAgentLaunchDirectory(
  groups: AgentLaunchWorkspaceGroup[],
  previous: string,
): string {
  const all = groups.flatMap((group) => group.options).filter((entry) => entry.cwd);
  const related = groups
    .filter((group) => group.related)
    .flatMap((group) => group.options)
    .filter((entry) => entry.cwd);
  let normalized = "";
  try {
    normalized = normalizeLocalRepositoryPath(previous) || "";
  } catch {
    /* obsolete preference */
  }
  const preferred = all.filter((entry) => entry.preferred);
  const candidates = preferred.length ? preferred : related.length ? related : all;
  return (
    candidates.find((entry) => entry.cwd === normalized)?.cwd ||
    candidates[0]?.cwd ||
    (all.length ? "" : previous)
  );
}
