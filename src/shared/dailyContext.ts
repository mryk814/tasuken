import { markdownSignature } from "./canonicalMarkdown.mjs";
import {
  queryActivityEvents,
  type ActivityProjectionEvent,
  type ActivityProjectionResult,
} from "./activityProjection.mjs";
import { collectionKeyForEntityType, domainCollectionKeyForEntityType } from "./entityRegistry.mjs";
import { buildPublicSourceProjection, type PublicSourceProjection } from "./publicSourceProjection";

export const DAILY_CONTEXT_SCHEMA = "tasken-daily-context/v1";
export const DAILY_CONTEXT_DIRECTORY = "Tasken Context";
export const DAILY_CONTEXT_MANIFEST = ".tasken-context.json";

export interface DailyContextSelection {
  date: string;
  timezone: string;
  themeId: string | null;
  includeFullText?: boolean;
}
export interface DailyContextPublishResult {
  status: "written";
  path: string;
  contentHash: string;
  generatedAt: string;
  cloudStatus: "unknown";
}
export interface DailyContextSource {
  type: string;
  id: string;
  revision: number | null;
}
export interface DailyContextRow {
  id: string;
  kind: string;
  stage: string;
  title: string;
  summary: string;
  source: DailyContextSource;
  themeId: string | null;
  themeTitle: string | null;
  time: string;
  occurredAt: string;
  dateBasis: string;
  authority: string;
  sourceRefs: Array<{ type: string; id: string }>;
}
export interface DailyContextPlan {
  schema: "tasken-daily-context/v1";
  workspaceId: string;
  selection: DailyContextSelection;
  generatedAt: string;
  sourceRevision: string;
  contentHash: string;
  relativePath: string;
  content: string;
  rows: DailyContextRow[];
  sources: DailyContextSource[];
  includedCount: number;
  sourceCount: number;
  excludedCount: number;
  excludedReasons: Array<{ type: string; reason: string; count: number }>;
  partial: boolean;
  matchedVisibleCount: number | null;
  publicSources?: PublicSourceProjection[];
  recoveryRoot?: string;
}

const STAGES = Object.freeze({
  work_recorded: "実績・作業記録",
  input: "未整理の入力",
  planned: "計画・予定の変更",
  ai_reported: "AIからの報告（人間の確認とは別）",
  human_accepted: "人間による採用",
  organized: "入力の整理",
  changed: "その他の変更",
});

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}
function inline(value: unknown) {
  return text(value)
    .replace(/[\r\n]+/g, " ")
    .replace(/[\\`*_{}[\]()<>#!|]/g, "\\$&");
}
function quote(value: unknown) {
  return text(value)
    .split(/\r?\n/)
    .map((line) => `> ${inline(line)}`)
    .join("\n");
}
function sourceKey(ref: { type: string; id: string }) {
  return `${ref.type}:${ref.id}`;
}

function workspaceEntity(workspace: Record<string, unknown>, type: string, id: string) {
  const keys = [
    collectionKeyForEntityType(type as Parameters<typeof collectionKeyForEntityType>[0]),
    domainCollectionKeyForEntityType(type),
  ];
  return keys
    .flatMap((key) =>
      key && Array.isArray(workspace[key])
        ? (workspace[key] as Array<Record<string, unknown>>)
        : [],
    )
    .find((entity) => entity.id === id);
}

export function validateDailyContextSelection(value: unknown): DailyContextSelection {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("公開する日を指定してください。");
  const input = value as Record<string, unknown>;
  const date = text(input.date);
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== date
  )
    throw new Error("公開する日付が不正です。");
  const timezone = text(input.timezone);
  if (!timezone || timezone.length > 100) throw new Error("タイムゾーンを指定してください。");
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    throw new Error("タイムゾーンが不正です。");
  }
  const themeId = input.themeId == null || input.themeId === "" ? null : text(input.themeId);
  if (themeId !== null && (!themeId || themeId.length > 200))
    throw new Error("公開するThemeが不正です。");
  if (input.includeFullText !== undefined && typeof input.includeFullText !== "boolean")
    throw new Error("本文公開の指定が不正です。");
  return {
    date,
    timezone,
    themeId,
    ...(input.includeFullText === true ? { includeFullText: true } : {}),
  };
}

/** Uses the same visibility and opaque pagination contract as recall readers. No canonical writes. */
export function buildDailyContextPlan({
  workspace,
  workspaceId,
  selection,
  workspaceDefault,
  roots = {},
  generatedAt,
  maxPages = 100,
}: {
  workspace: Record<string, unknown>;
  workspaceId: string;
  selection: unknown;
  workspaceDefault?: unknown;
  roots?: Record<string, unknown>;
  generatedAt: string;
  maxPages?: number;
}): DailyContextPlan {
  const selected = validateDailyContextSelection(selection);
  if (typeof workspaceId !== "string" || !workspaceId.trim())
    throw new Error("Workspaceの識別子がありません。");
  if (
    typeof generatedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(generatedAt) ||
    !Number.isFinite(Date.parse(generatedAt))
  )
    throw new Error("公開物の生成日時が不正です。");
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100)
    throw new Error("取得ページの上限が不正です。");
  const events: ActivityProjectionEvent[] = [];
  let result: ActivityProjectionResult | undefined;
  let cursor: string | null = null;
  let revision: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    result = queryActivityEvents({
      workspace,
      events: (workspace.change_events || []) as Array<Record<string, unknown>>,
      profile: "recall",
      audience: "m365",
      workspaceDefault,
      roots,
      date: selected.date,
      timezone: selected.timezone,
      themeId: selected.themeId || undefined,
      limit: 500,
      cursor,
    });
    if (result.page.status !== "ok" || (revision && revision !== result.page.revision))
      throw new Error("記録が変わりました。公開内容を先頭から確認し直してください。");
    revision = result.page.revision;
    events.push(...result.events);
    cursor = result.page.next_cursor;
    if (!cursor) break;
  }
  if (!result) throw new Error("公開対象の取得に失敗しました。");
  const rows: DailyContextRow[] = events.map((event) => {
    const ref = event.recall?.source_ref || event.entity_ref;
    const currentSource = workspaceEntity(workspace, ref.type, ref.id);
    const stage = event.recall && event.recall.stage in STAGES ? event.recall.stage : "changed";
    return {
      id: event.id,
      kind: event.event_kind,
      stage,
      title: event.entity_title,
      summary: event.summary,
      source: {
        type: ref.type,
        id: ref.id,
        revision: typeof currentSource?.version === "number" ? currentSource.version : null,
      },
      themeId: event.theme_ref?.id || null,
      themeTitle: event.recall?.history?.theme_title || null,
      time: event.local_time,
      occurredAt: event.occurred_at,
      dateBasis: event.recall?.date_basis || "event_time",
      authority: event.recall?.authority || "unknown",
      sourceRefs: event.source_refs
        .filter((item) => typeof item.type === "string" && typeof item.id === "string")
        .map((item) => ({ type: String(item.type), id: String(item.id) })),
    };
  });
  const sources = [...new Map(rows.map((row) => [sourceKey(row.source), row.source])).values()];
  const publicSources = sources.flatMap((source) => {
    const entity = workspaceEntity(workspace, source.type, source.id);
    if (!entity) return [];
    const themeId = entity.project_id || entity.theme_id;
    const theme = themeId ? workspaceEntity(workspace, "theme", String(themeId)) : undefined;
    const projection = buildPublicSourceProjection({
      type: source.type,
      entity,
      theme,
      workspaceDefault: workspaceDefault as Parameters<
        typeof buildPublicSourceProjection
      >[0]["workspaceDefault"],
      generatedAt,
      explicitlyAllowed: selected.includeFullText === true,
    });
    return projection ? [projection] : [];
  });
  const sourceRevision = markdownSignature(
    JSON.stringify([selected, revision, publicSources.map((source) => source.contentHash)]),
  );
  const partial = Boolean(cursor);
  const excludedReasons = result.excluded_reasons.map((item) => ({
    type: text(item.type),
    reason: text(item.reason),
    count: Number(item.count) || 0,
  }));
  const lines = [
    `# ${selected.date} の記録`,
    "",
    "> Taskenが生成した読み取り専用の公開物です。編集しても正本には取り込まれません。",
    "> 記録のない期間を「何もしなかった」と解釈しないでください。予定・AI報告は実績とは別です。",
    "",
    `- 対象日: ${selected.date} (${inline(selected.timezone)})`,
    `- 公開範囲: ${selected.themeId ? `当時のTheme ID ${inline(selected.themeId)}` : "全Theme・Theme未設定"}のうち、現在M365公開を許可した記録`,
    `- 生成日時: ${generatedAt}`,
    `- 基準revision: ${sourceRevision}`,
    `- 収録状態: ${partial ? "部分取得（続きは未収録）" : "対象範囲を取得済み"}`,
    `- 収録: ${rows.length}件の記録項目 / ${sources.length}件の異なる出典（実績件数ではありません）`,
    `- 公開対象外: ${result.excluded_count}件`,
    "- クラウド同期・外部AIの索引更新: 未観測",
    "",
  ];
  if (partial)
    lines.push(
      "**取得上限に達したため不完全です。この出力だけで一日全体を判断しないでください。**",
      "",
    );
  if (!rows.length)
    lines.push(
      "公開対象の記録はありません。未公開の記録や、Desktopにまだ届いていない入力の有無は分かりません。",
      "",
    );
  for (const [stage, label] of Object.entries(STAGES)) {
    const selectedRows = rows.filter((row) => row.stage === stage);
    if (!selectedRows.length) continue;
    lines.push(`## ${label}`, "");
    for (const row of selectedRows) {
      lines.push(
        `### ${inline(row.title)}`,
        `- 種類: ${row.kind === "task_completed" ? "Task完了の操作" : inline(row.kind)}`,
        `- 日付の意味: ${row.dateBasis === "performed_day" ? "本人が申告した実施日（時刻・作業時間は不明）" : `記録された操作・出来事の日時 ${inline(row.time)}`}`,
        `- Theme（当時）: ${inline(row.themeTitle || (row.themeId ? "名称不明" : "未設定"))}`,
        `- 出典: \`${inline(sourceKey(row.source))}\` ([Taskenで開く](tasken://${encodeURIComponent(row.source.type)}/${encodeURIComponent(row.source.id)}))`,
        `- 出典の現在revision: ${row.source.revision ?? "不明"}（当時の版ではありません） / 記録ID: ${inline(row.id)}`,
        `- Authority: ${inline(row.authority)} / 入力・操作日時: ${inline(row.occurredAt)}`,
      );
      if (row.sourceRefs.length)
        lines.push(
          `- 関連出典: ${row.sourceRefs.map((ref) => `\`${inline(sourceKey(ref))}\``).join(", ")}`,
        );
      if (row.summary) lines.push("", quote(row.summary));
      const publishedBody = publicSources.find(
        (entry) => sourceKey(entry.source) === sourceKey(row.source),
      );
      if (publishedBody)
        lines.push(
          "",
          `[公開した現在版の本文](../${publishedBody.relativePath})（過去版の再現ではありません）`,
        );
      lines.push("");
    }
  }
  lines.push("## 除外と収録範囲", "");
  lines.push(
    ...(excludedReasons.length
      ? excludedReasons.map(
          (item) => `- ${inline(item.type)}: ${inline(item.reason)} (${item.count}件)`,
        )
      : ["- 公開policyによる除外なし。"]),
  );
  lines.push(
    publicSources.length
      ? "- 日別は抜粋です。明示許可した現在版の本文はSourcesへのリンクから読めます。保存されていない過去版・添付・未同期の入力は含みません。"
      : "- 本文は振り返り用の抜粋です。長文の全文、保存されていない過去版、未同期の入力は含みません。",
    "",
  );
  const content = lines.join("\n");
  const contentHash = markdownSignature(content);
  return {
    schema: DAILY_CONTEXT_SCHEMA,
    workspaceId,
    selection: selected,
    generatedAt,
    sourceRevision,
    contentHash,
    relativePath: `Days/${selected.date}.md`,
    content,
    rows,
    sources,
    includedCount: rows.length,
    sourceCount: sources.length,
    excludedCount: result.excluded_count,
    excludedReasons,
    partial,
    matchedVisibleCount: result.page.matched_visible_count,
    publicSources,
  };
}
