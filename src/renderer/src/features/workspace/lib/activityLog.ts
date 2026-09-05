import type { StatusUpdate, Theme } from "../types";
import type { WorkspaceDomain } from "../domain-model/types";
import { compareCapturesNewestFirst } from "../domain-model/selectors";
import {
  PERSONAL_DEFAULT_THEME_ID,
  resolveThemeRef,
  themeRefFromId,
} from "../../../../../shared/themeRef.mjs";
import {
  projectActivityMarkdown,
  queryActivityEvents,
} from "../../../../../shared/activityProjection.mjs";
import type { CanonicalRootStatusMap } from "../../../../../shared/types/workspace";

export interface ActivityLogInput {
  date: string;
  domain: Pick<
    WorkspaceDomain,
    "tasks" | "waitings" | "notes" | "resources" | "knowledge_nodes" | "capture_entries"
  >;
  statusUpdates: StatusUpdate[];
  themes: Theme[];
  /** Structured event source. Undefined keeps the legacy display-only path for old callers. */
  changeEvents?: Array<Record<string, unknown>>;
  references?: Array<Record<string, unknown>>;
  artifacts?: Array<Record<string, unknown>>;
  roots?: CanonicalRootStatusMap;
  timezone?: string;
  audience?: "m365";
  workspaceDefault?: ("m365" | "coding_agent" | "external_ai")[];
  workspace?: Record<string, unknown>;
}

export type ActivityLogEntries = {
  completedTasks: WorkspaceDomain["tasks"];
  receivedWaitings: WorkspaceDomain["waitings"];
  notes: WorkspaceDomain["notes"];
  resources: WorkspaceDomain["resources"];
  knowledge: WorkspaceDomain["knowledge_nodes"];
  updates: StatusUpdate[];
  captures: WorkspaceDomain["capture_entries"];
  events: Array<Record<string, unknown>>;
};

/** Activity Log 用の Theme 表示。ID から現時点の正式名・識別子・概要を解決する。 */
export type ActivityThemeRef = {
  id: string | null;
  /** 表示名（正式な Theme 名、またはフォールバック） */
  name: string;
  /** Theme.code。未設定・参照切れ時は空 */
  code: string;
  /** Theme.description（概要） */
  description: string;
  /** themes 一覧に存在しない（削除済みなど） */
  missing: boolean;
};

function recordDate(value: unknown): string {
  return String(value || "").slice(0, 10);
}

function timestampOf(record: unknown): unknown {
  const row = record as Record<string, unknown>;
  return row.updated_at || row.created_at;
}

function text(value: unknown): string {
  return String(value || "").trim();
}

/**
 * project_id / theme_id から現在の Theme を解決する。
 * - 未所属: 個人業務
 * - 削除済み・参照切れ: 削除済みTheme + 短い ID 断片（後から辿れる程度）
 */
export function resolveActivityTheme(themes: Theme[], projectId?: string | null): ActivityThemeRef {
  const ref = themeRefFromId(projectId, { legacyNullMeansPersonal: true });
  const resolved = resolveThemeRef(themes, ref);
  if (resolved.id === PERSONAL_DEFAULT_THEME_ID && !resolved.theme) {
    return {
      id: PERSONAL_DEFAULT_THEME_ID,
      name: "個人業務",
      code: "",
      description: "",
      missing: false,
    };
  }
  if (resolved.missing || !resolved.theme) {
    const id = resolved.id || PERSONAL_DEFAULT_THEME_ID;
    return {
      id,
      name: "削除済みTheme",
      code: id.slice(0, 8),
      description: "",
      missing: true,
    };
  }
  const theme = resolved.theme;
  return {
    id: theme.id,
    name: text(theme.name) || "無題のTheme",
    code: text(theme.code),
    description: text(theme.description),
    missing: false,
  };
}

/** 各行の短い Theme ラベル。例: 材料A (MAT-A) */
export function formatActivityThemeLabel(ref: ActivityThemeRef): string {
  if (ref.code) return `${ref.name} (${ref.code})`;
  return ref.name;
}

/** Theme 一覧セクションの1行。Theme名 / 識別子 / 概要 */
export function formatActivityThemeDetail(ref: ActivityThemeRef): string {
  const code = ref.code || "—";
  const description = ref.description || "—";
  return `- ${ref.name} / ${code} / ${description}`;
}

function collectThemeIds(ids: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const raw of ids) {
    const id = text(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
}

export function collectActivityLogEntries(input: ActivityLogInput): ActivityLogEntries {
  const { date, domain, statusUpdates } = input;
  if (input.changeEvents !== undefined) {
    const result = queryActivityEvents({
      events: input.changeEvents,
      workspace: {
        ...input.workspace,
        tasks: domain.tasks,
        waitings: domain.waitings,
        notes: domain.notes,
        resources: domain.resources,
        knowledge_nodes: domain.knowledge_nodes,
        capture_entrys: domain.capture_entries,
        references: input.references || [],
        artifacts: input.artifacts || [],
        roots: input.roots || {},
        status_updates: statusUpdates,
      },
      themes: input.themes,
      date,
      timezone: input.timezone,
      audience: input.audience,
      workspaceDefault: input.workspaceDefault,
      roots: input.roots,
    });
    const entity = (type: string, id: string) => {
      const records =
        type === "task"
          ? domain.tasks
          : type === "waiting"
            ? domain.waitings
            : type === "note"
              ? domain.notes
              : type === "resource"
                ? domain.resources
                : type === "knowledge_node"
                  ? domain.knowledge_nodes
                  : type === "capture_entry"
                    ? domain.capture_entries
                    : [];
      return records.find((record) => record.id === id);
    };
    const empty = {
      completedTasks: [] as WorkspaceDomain["tasks"],
      receivedWaitings: [] as WorkspaceDomain["waitings"],
      notes: [] as WorkspaceDomain["notes"],
      resources: [] as WorkspaceDomain["resources"],
      knowledge: [] as WorkspaceDomain["knowledge_nodes"],
      updates: [] as StatusUpdate[],
      captures: [] as WorkspaceDomain["capture_entries"],
    };
    for (const event of result.events) {
      const type = String(event.entity_ref?.type || "");
      const id = String(event.entity_ref?.id || "");
      const current = entity(type, id);
      if (event.event_kind === "task_completed" && current)
        empty.completedTasks.push(current as WorkspaceDomain["tasks"][number]);
      else if (event.event_kind === "waiting_received" && current)
        empty.receivedWaitings.push(current as WorkspaceDomain["waitings"][number]);
      else if (
        [
          "note_created",
          "note_updated",
          "report_created",
          "report_updated",
          "prompt_created",
          "prompt_updated",
        ].includes(String(event.event_kind)) &&
        current
      )
        empty.notes.push(current as WorkspaceDomain["notes"][number]);
      else if (["resource_added", "resource_updated"].includes(String(event.event_kind)) && current)
        empty.resources.push(current as WorkspaceDomain["resources"][number]);
      else if (
        ["knowledge_created", "knowledge_updated"].includes(String(event.event_kind)) &&
        current
      )
        empty.knowledge.push(current as WorkspaceDomain["knowledge_nodes"][number]);
      else if (type === "capture_entry" && current)
        empty.captures.push(current as WorkspaceDomain["capture_entries"][number]);
    }
    return { ...empty, events: result.events };
  }
  const completedTasks = domain.tasks
    .filter(
      (task) => task.state === "done" && recordDate(task.completed_at || task.updated_at) === date,
    )
    .sort((a, b) => String(a.title).localeCompare(String(b.title), "ja"));
  const receivedWaitings = domain.waitings
    .filter((waiting) => waiting.state === "received" && recordDate(waiting.updated_at) === date)
    .sort((a, b) => String(a.title).localeCompare(String(b.title), "ja"));
  const notes = domain.notes
    .filter((note) => recordDate(timestampOf(note)) === date)
    .sort((a, b) => String(a.title).localeCompare(String(b.title), "ja"));
  const resources = domain.resources
    .filter((resource) => recordDate(resource.captured_at || timestampOf(resource)) === date)
    .sort((a, b) => String(a.title).localeCompare(String(b.title), "ja"));
  const knowledge = domain.knowledge_nodes
    .filter((node) => recordDate(timestampOf(node)) === date)
    .sort((a, b) => String(a.title).localeCompare(String(b.title), "ja"));
  const updates = statusUpdates
    .filter((entry) => recordDate(entry.date || entry.updated_at || entry.created_at) === date)
    .sort((a, b) => String(a.summary).localeCompare(String(b.summary), "ja"));
  const captures = domain.capture_entries
    .filter((entry) => recordDate(entry.captured_at) === date)
    .sort(compareCapturesNewestFirst);

  return {
    completedTasks,
    receivedWaitings,
    notes,
    resources,
    knowledge,
    updates,
    captures,
    events: [],
  };
}

export function buildActivityLog(input: ActivityLogInput): string {
  if (input.audience && input.changeEvents === undefined) {
    throw new Error("公開用の日誌を生成できません。活動履歴を再読み込みしてください。");
  }
  if (input.changeEvents !== undefined) {
    const result = queryActivityEvents({
      events: input.changeEvents,
      workspace: {
        ...input.workspace,
        tasks: input.domain.tasks,
        waitings: input.domain.waitings,
        notes: input.domain.notes,
        resources: input.domain.resources,
        knowledge_nodes: input.domain.knowledge_nodes,
        capture_entrys: input.domain.capture_entries,
        references: input.references || [],
        artifacts: input.artifacts || [],
        roots: input.roots || {},
        status_updates: input.statusUpdates,
      },
      themes: input.themes,
      date: input.date,
      timezone: input.timezone,
      audience: input.audience,
      workspaceDefault: input.workspaceDefault,
      roots: input.roots,
    });
    return projectActivityMarkdown(result, { title: "Activity", date: input.date });
  }
  const { date, themes } = input;
  const { completedTasks, receivedWaitings, notes, resources, knowledge, updates, captures } =
    collectActivityLogEntries(input);
  const labelOf = (projectId?: string | null) =>
    formatActivityThemeLabel(resolveActivityTheme(themes, projectId));

  const themeIds = collectThemeIds([
    ...completedTasks.map((task) => task.project_id),
    ...receivedWaitings.map((waiting) => waiting.project_id),
    ...notes.map((note) => note.project_id),
    ...resources.map((resource) => resource.project_id),
    ...knowledge.map((node) => node.project_id),
    ...updates.map((entry) => entry.theme_id),
  ]);
  const themeDetails = themeIds.map((id) =>
    formatActivityThemeDetail(resolveActivityTheme(themes, id)),
  );

  return [
    `# Activity Log ${date}`,
    "",
    "## 登場したTheme",
    ...(themeDetails.length ? themeDetails : ["- なし"]),
    "",
    "## 完了したタスク",
    ...(completedTasks.length
      ? completedTasks.map((task) => {
          // 完了時のひとことは本文と分けて保存しているので、記録側でも別項として出す（#308）。
          const note = text(task.completion_note);
          return `- [x] ${labelOf(task.project_id)} / ${task.title}${note ? ` — ${note}` : ""}`;
        })
      : ["- なし"]),
    "",
    "## 受け取ったWaiting",
    ...(receivedWaitings.length
      ? receivedWaitings.map(
          (waiting) =>
            `- ${labelOf(waiting.project_id)} / ${waiting.title} / ${waiting.waiting_for}`,
        )
      : ["- なし"]),
    "",
    "## 作成・更新したNotes",
    ...(notes.length
      ? notes.map((note) => `- ${labelOf(note.project_id)} / ${note.title}`)
      : ["- なし"]),
    "",
    "## 追加・更新したリンク/資料",
    ...(resources.length
      ? resources.map(
          (resource) =>
            `- ${labelOf(resource.project_id)} / ${resource.title}${resource.url ? ` (${resource.url})` : ""}`,
        )
      : ["- なし"]),
    "",
    "## Knowledge",
    ...(knowledge.length
      ? knowledge.map((node) => `- ${labelOf(node.project_id)} / ${node.node_type}: ${node.title}`)
      : ["- なし"]),
    "",
    "## 現在地更新",
    ...(updates.length
      ? updates.map((entry) => {
          const theme = resolveActivityTheme(themes, entry.theme_id);
          // Theme なしの現在地は「全体」（個人業務にしない）
          const head = entry.theme_id ? formatActivityThemeLabel(theme) : "全体";
          return `- ${head}: ${entry.summary || entry.next_actions || entry.risks}`;
        })
      : ["- なし"]),
    "",
    "## Capture / やったこと記録",
    ...(captures.length ? captures.map((entry) => `- ${entry.title || entry.text}`) : ["- なし"]),
  ].join("\n");
}

export type ActivitySessionLogEntry = {
  time_label: string;
  client_label: string;
  theme_names: string[];
  intent: string;
  outcome?: string;
  repository_names?: string[];
  remaining_work?: string[];
};

function logLine(value: unknown): string {
  return text(value).replace(/\s+/g, " ");
}

export function appendActivitySessionsToLog(
  base: string,
  sessions: ActivitySessionLogEntry[],
): string {
  if (!sessions.length) return base;
  const rows = sessions.flatMap((session) => {
    const heading = `- ${logLine(session.time_label)} [${logLine(session.client_label)}] ${logLine(session.intent) || "意図未記録"}`;
    const details: string[] = [];
    if (session.theme_names.length) {
      details.push(`  - Theme: ${session.theme_names.map(logLine).join(" / ")}`);
    }
    if (logLine(session.outcome)) details.push(`  - 結果: ${logLine(session.outcome)}`);
    if (session.repository_names?.length) {
      details.push(`  - リポジトリ: ${session.repository_names.map(logLine).join(" / ")}`);
    }
    if (session.remaining_work?.length) {
      details.push(`  - 残作業: ${session.remaining_work.map(logLine).join(" / ")}`);
    }
    return [heading, ...details];
  });
  return `${base.trimEnd()}\n\n## AI作業\n\n${rows.join("\n")}\n`;
}

export function buildActivityReviewLog(
  input: ActivityLogInput,
  sessions: ActivitySessionLogEntry[],
): string {
  return appendActivitySessionsToLog(buildActivityLog(input), sessions);
}
