import fs from "node:fs";
import path from "node:path";

import { normalizeReferenceAssertion } from "../../shared/relationAssertion.mjs";

/**
 * Knowledge の節と線（knowledge_node・knowledge_edge）を、テーマごとの Markdown に書き出す（#755 束8）。
 *
 * 棚卸しの画面と節・線の入力を外す版の起動で走る。記録そのものは消さず、種類の登録に読むだけで
 * 残るが、画面が無くなると本人は読めなくなるので、読める形の控えを本人の操作なしで残す
 * （開発に使っていない端末の記録は、こちらから見えないため）。
 *
 * - 置き場は userData と、同期ルート（設定してある時だけ）の Exports/retired/knowledge/。
 * - テーマ 1 つにつき 1 ファイル。0 件なら何も書かず、済んだ印も付けない。
 * - 済んだ印には、書き出した時の節と線の件数と、いちばん新しい更新の時刻を持たせる。次の起動で
 *   どちらかが変わっていれば（印の後に同期で届いた節や、別の端末での編集）、もう一度書き出す。
 * - 既にあるファイルは上書きしない。中身が同じなら書かずに済ませ、違えば番号を付ける
 *   （失敗した次の起動のやり直しや、同じ同期ルートを使う別の端末の書き出しで増えないようにする）。
 * - 中身には書き出した時刻を入れない（同じ記録からは同じファイルになる）。
 * - 失敗しても起動は止めない。済んだ印を付けないので、次の起動でやり直す。
 */

type RecordLike = Record<string, unknown>;

export interface KnowledgeExportSource {
  /** WorkspaceDatabase.list と同じ形。includeDeleted を省くと、削除した記録を除く。 */
  list(type: string, includeDeleted?: boolean): RecordLike[];
}

export interface KnowledgeExportDocument {
  /** テーマの ID。テーマに結び付いていない節は null。 */
  themeId: string | null;
  /** 拡張子の無いファイル名。Windows で使えない文字は置き換え済み。 */
  baseName: string;
  nodeCount: number;
  edgeCount: number;
  markdown: string;
}

const RETIRED_EXPORT_SEGMENTS = ["Exports", "retired", "knowledge"] as const;
const NO_THEME_LABEL = "テーマなし";
const NODE_TYPE_ORDER = ["question", "claim", "evidence", "decision", "source", "insight"];
const NODE_TYPE_LABELS: Record<string, string> = {
  question: "Question",
  claim: "Claim",
  evidence: "Evidence",
  decision: "Decision",
  source: "Source",
  insight: "Insight",
};
// 画面の語（renderer の domain-model/labels.ts）の写し。Main から renderer は読めないので、
// 一度きりの書き出しに要る分だけを持つ。
const RECORD_TYPE_LABELS: Record<string, string> = {
  project: "テーマ",
  theme: "テーマ",
  capture_entry: "付箋",
  task: "Task",
  waiting: "待ち",
  plan_node: "計画",
  note: "ノート",
  feed_post: "近況の投稿",
  resource: "資料",
  knowledge_node: "節",
  sketch: "手書き",
  artifact: "添付",
  repository_context: "Repository",
  agent_session: "Agent Session",
};
const AI_FRESHNESS_LABELS: Record<string, string> = {
  current: "現在有効",
  stale: "要再確認",
  superseded: "置き換え済み",
  unknown: "未判定",
};
const AI_AUTHORITY_LABELS: Record<string, string> = {
  user_confirmed: "ユーザー確認済み",
  imported: "取り込み原文",
  ai_generated: "AI生成",
  inferred: "推定",
  external_source: "外部資料の要約",
};
const AI_SOURCE_REF_KIND_LABELS: Record<string, string> = {
  url: "URL",
  file: "ファイル",
  canonical_document: "正本文書",
  conversation: "会話",
  meeting: "会議",
  repository: "リポジトリ",
  external_system: "外部システム",
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordLike) : null;
}

function dateText(value: unknown): string {
  const raw = text(value);
  return /^\d{4}-\d{2}-\d{2}/u.test(raw) ? raw.slice(0, 10) : "";
}

function isLive(entry: RecordLike): boolean {
  return !entry.deleted_at;
}

function oneLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function nodeTitle(node: RecordLike | undefined, fallbackId = ""): string {
  return oneLine(text(node?.title)) || (fallbackId ? `（見つからない節 ${fallbackId}）` : "無題");
}

function nodeTypeLabel(node: RecordLike | undefined): string {
  const type = text(node?.node_type);
  return NODE_TYPE_LABELS[type] || type || "Knowledge";
}

function byCreated(left: RecordLike, right: RecordLike): number {
  return (
    text(left.created_at).localeCompare(text(right.created_at)) ||
    text(left.id).localeCompare(text(right.id))
  );
}

/** Windows のファイル名に使えない文字を除き、長さを抑える。 */
function fileBaseName(label: string): string {
  const cleaned = `Knowledge - ${label}`
    .replace(/[\\/:*?"<>|]+/gu, "-")
    // 制御文字は名前に残さない。
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[. ]+$/u, "")
    .slice(0, 80);
  return cleaned || "Knowledge";
}

/**
 * 節の相手（ノート・Task など）を「種類「題名」（ID）」で書くための索引。種類ごとに一度だけ読む。
 * 削除した記録の題名は出さない（本人が消した物の中身を、控えに新しく書き写さないため）。
 */
class RecordIndex {
  private readonly byType = new Map<string, Map<string, RecordLike>>();

  constructor(private readonly source: KnowledgeExportSource) {}

  private records(type: string): Map<string, RecordLike> {
    let index = this.byType.get(type);
    if (!index) {
      index = new Map();
      let entries: RecordLike[] = [];
      try {
        entries = this.source.list(type, true);
      } catch {
        // 登録の無い種類（古い差分の関係が指す物など）は、題名なしで書く。
      }
      for (const entry of entries) {
        const id = text(entry.id);
        if (id) index.set(id, entry);
      }
      this.byType.set(type, index);
    }
    return index;
  }

  label(type: string, id: string): string {
    const kind = RECORD_TYPE_LABELS[type] || type || "記録";
    const entry = this.records(type).get(id);
    if (!entry) return `${kind}（${id}）`;
    if (!isLive(entry)) return `削除した${kind}（${id}）`;
    const title = oneLine(
      text(entry.title) || text(entry.name) || text(entry.summary) || text(entry.text),
    ).slice(0, 120);
    return title ? `${kind}「${title}」（${id}）` : `${kind}（${id}）`;
  }
}

/** 節の出どころ。元のノートなどが分かる時は、相手の種類と題名で書く。 */
function nodeOrigin(node: RecordLike, index: RecordIndex): string {
  const noteId =
    text(node.source_note_id) || (text(node.source_type) === "note" ? text(node.source_id) : "");
  if (noteId) return index.label("note", noteId);
  if (text(node.source_type) && text(node.source_id))
    return index.label(text(node.source_type), text(node.source_id));
  if (text(node.source_link_id)) return `link（${text(node.source_link_id)}）`;
  if (text(node.source_item_id)) return `item（${text(node.source_item_id)}）`;
  return "";
}

/** 節を端に持つ記録どうしの関係（reference）。節⇄Task・ノートなど。 */
interface NodeReference {
  outgoing: boolean;
  predicate: string;
  peer: { type: string; id: string };
}

function referencesByNode(source: KnowledgeExportSource): Map<string, NodeReference[]> {
  const result = new Map<string, NodeReference[]>();
  const push = (nodeId: string, entry: NodeReference) => {
    const list = result.get(nodeId) || [];
    list.push(entry);
    result.set(nodeId, list);
  };
  let references: RecordLike[] = [];
  try {
    references = source.list("reference").filter(isLive).sort(byCreated);
  } catch {
    return result;
  }
  for (const reference of references) {
    // 読み取りの形（RelationAssertionReadView）は Omit で index signature に寄るので、使う欄だけを型にする。
    let assertion: {
      subject: { type: string; id: string };
      object: { type: string; id: string };
      predicate: string;
      status: string;
    };
    try {
      assertion = normalizeReferenceAssertion(reference, {
        legacyRead: true,
      }) as unknown as typeof assertion;
    } catch {
      continue; // 形の崩れた古い関係は、図と同じく読まない。
    }
    if (assertion.status === "rejected") continue;
    const subject = { type: String(assertion.subject.type), id: String(assertion.subject.id) };
    const object = { type: String(assertion.object.type), id: String(assertion.object.id) };
    const predicate = String(assertion.predicate || "related");
    if (subject.type === "knowledge_node")
      push(subject.id, { outgoing: true, predicate, peer: object });
    if (object.type === "knowledge_node")
      push(object.id, { outgoing: false, predicate, peer: subject });
  }
  return result;
}

function knowledgeThemeMarkdown(input: {
  themeLabel: string;
  nodes: readonly RecordLike[];
  edges: readonly RecordLike[];
  /** 節ごとの関係には、別のテーマのファイルに入る線も出す。 */
  allEdges: readonly RecordLike[];
  nodesById: ReadonlyMap<string, RecordLike>;
  themeLabelOfNode: (node: RecordLike | undefined) => string;
  index: RecordIndex;
  references: ReadonlyMap<string, NodeReference[]>;
}): string {
  const { themeLabel, nodes, edges, allEdges, nodesById, themeLabelOfNode, index, references } =
    input;
  const lines = [
    `# Knowledge - ${themeLabel}`,
    "",
    "Tasken の Knowledge（節と線）から書き出した記録です（#755 で棚卸しの画面を外す前の控え）。",
    "",
    `- Theme: ${themeLabel}`,
    `- 節: ${nodes.length} 件`,
    `- 線: ${edges.length} 件`,
  ];
  /** 相手の節を「題名（種類）」で書く。別のテーマの節には、テーマの名前を添える。 */
  const peer = (id: string) => {
    const node = nodesById.get(id);
    if (!node) return nodeTitle(undefined, id);
    const otherTheme = themeLabelOfNode(node);
    return `${nodeTitle(node)}（${nodeTypeLabel(node)}${otherTheme === themeLabel ? "" : ` / ${otherTheme}`}）`;
  };
  /** 節なら節の書き方、それ以外は種類と題名。 */
  const anyPeer = (type: string, id: string) =>
    type === "knowledge_node" && nodesById.has(id) ? peer(id) : index.label(type, id);
  const types = [
    ...NODE_TYPE_ORDER,
    ...[...new Set(nodes.map((node) => text(node.node_type)))]
      .filter((type) => !NODE_TYPE_ORDER.includes(type))
      .sort(),
  ];
  for (const type of types) {
    const group = nodes.filter((node) => text(node.node_type) === type);
    if (group.length === 0) continue;
    lines.push("", `## ${NODE_TYPE_LABELS[type] || type || "Knowledge"}`);
    for (const node of group) {
      const id = text(node.id);
      const supersededBy = record(node.ai_superseded_by);
      const facts: [string, string][] = [
        ["状態", text(node.status)],
        ["確からしさ", text(node.confidence)],
        ["出どころ", nodeOrigin(node, index)],
        ["AI 向け概要", oneLine(text(node.ai_summary))],
        ["鮮度", AI_FRESHNESS_LABELS[text(node.ai_freshness)] || text(node.ai_freshness)],
        ["根拠", AI_AUTHORITY_LABELS[text(node.ai_authority)] || text(node.ai_authority)],
        ["最後に確かめた日", dateText(node.ai_last_verified_at)],
        [
          "置き換え先",
          supersededBy && text(supersededBy.type) && text(supersededBy.id)
            ? anyPeer(text(supersededBy.type), text(supersededBy.id))
            : "",
        ],
        ["作った日", dateText(node.created_at)],
        ["更新した日", dateText(node.updated_at)],
        ["Tasken の ID", id],
      ];
      lines.push(
        "",
        `### ${nodeTitle(node)}`,
        "",
        ...facts.filter(([, value]) => value).map(([label, value]) => `- ${label}: ${value}`),
      );
      const body = typeof node.body === "string" ? node.body.trim() : "";
      if (body) lines.push("", body);
      const sources = (Array.isArray(node.ai_source_refs) ? node.ai_source_refs : [])
        .map(record)
        .filter((entry): entry is RecordLike => Boolean(entry && text(entry.locator)))
        .map((entry) => {
          const kind = AI_SOURCE_REF_KIND_LABELS[text(entry.kind)] || text(entry.kind) || "出典";
          const title = oneLine(text(entry.title));
          return `- ${kind}: ${title ? `${title} — ` : ""}${oneLine(text(entry.locator))}`;
        });
      if (sources.length > 0) lines.push("", "出典:", "", ...sources);
      const relations = allEdges
        .filter((edge) => text(edge.source_node_id) === id || text(edge.target_node_id) === id)
        .map((edge) => {
          const outgoing = text(edge.source_node_id) === id;
          const other = outgoing ? text(edge.target_node_id) : text(edge.source_node_id);
          const note = oneLine(text(edge.description) || text(edge.note));
          return `- ${outgoing ? "→" : "←"} ${text(edge.relation_type) || "related"}: ${peer(other)}${note ? ` — ${note}` : ""}`;
        });
      if (relations.length > 0) lines.push("", "関係:", "", ...relations);
      const linked = (references.get(id) || []).map(
        (entry) =>
          `- ${entry.outgoing ? "→" : "←"} ${entry.predicate}: ${anyPeer(entry.peer.type, entry.peer.id)}`,
      );
      if (linked.length > 0) lines.push("", "ほかの記録との関係:", "", ...linked);
    }
  }
  if (edges.length > 0) {
    lines.push(
      "",
      "## 線の一覧",
      "",
      "| 元 | 関係 | 先 | メモ | Tasken の ID |",
      "| --- | --- | --- | --- | --- |",
    );
    const cell = (value: string) => oneLine(value).replace(/\|/gu, "\\|") || "—";
    for (const edge of edges) {
      lines.push(
        `| ${cell(peer(text(edge.source_node_id)))} | ${cell(text(edge.relation_type))} | ${cell(
          peer(text(edge.target_node_id)),
        )} | ${cell(text(edge.description) || text(edge.note))} | ${cell(text(edge.id))} |`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * 削除していない節と線を、テーマごとの Markdown にする。節も線も無ければ空の配列。
 * 線は、元の節のテーマのファイルに入れる（元の節が見つからない線は、先の節のテーマ、
 * それも無ければ「テーマなし」）。
 */
export function buildKnowledgeExport(source: KnowledgeExportSource): KnowledgeExportDocument[] {
  const nodes = source.list("knowledge_node").filter(isLive).sort(byCreated);
  const edges = source.list("knowledge_edge").filter(isLive).sort(byCreated);
  if (nodes.length === 0 && edges.length === 0) return [];

  // 削除したテーマの名前も引けるようにする（節は残っていることがある）。
  const themeNames = new Map<string, string>();
  for (const theme of [...source.list("theme", true), ...source.list("project", true)]) {
    const id = text(theme.id);
    const name = oneLine(text(theme.name) || text(theme.title));
    if (id && name && !themeNames.has(id)) themeNames.set(id, name);
  }
  const index = new RecordIndex(source);
  const references = referencesByNode(source);
  const nodesById = new Map(nodes.map((node) => [text(node.id), node]));
  const themeIdOfNode = (node: RecordLike | undefined) =>
    text(node?.theme_id) || text(node?.project_id) || null;
  const themeLabel = (themeId: string | null) =>
    themeId ? themeNames.get(themeId) || `名前の分からないテーマ ${themeId}` : NO_THEME_LABEL;
  const themeLabelOfNode = (node: RecordLike | undefined) => themeLabel(themeIdOfNode(node));
  const themeIdOfEdge = (edge: RecordLike) =>
    themeIdOfNode(
      nodesById.get(text(edge.source_node_id)) || nodesById.get(text(edge.target_node_id)),
    );

  const themeIds = [
    ...new Set<string | null>([...nodes.map(themeIdOfNode), ...edges.map(themeIdOfEdge)]),
  ];
  const documents = themeIds.map((themeId) => {
    const themeNodes = nodes.filter((node) => themeIdOfNode(node) === themeId);
    const themeEdges = edges.filter((edge) => themeIdOfEdge(edge) === themeId);
    const label = themeLabel(themeId);
    return {
      themeId,
      baseName: fileBaseName(label),
      nodeCount: themeNodes.length,
      edgeCount: themeEdges.length,
      markdown: knowledgeThemeMarkdown({
        themeLabel: label,
        nodes: themeNodes,
        edges: themeEdges,
        allEdges: edges,
        nodesById,
        themeLabelOfNode,
        index,
        references,
      }),
    };
  });
  documents.sort(
    (left, right) =>
      left.baseName.localeCompare(right.baseName, "ja") ||
      String(left.themeId).localeCompare(String(right.themeId)),
  );
  // 同じ名前のテーマが 2 つあっても、テーマごとに別のファイルにする。
  const used = new Map<string, number>();
  return documents.map((document) => {
    const key = document.baseName.toLocaleLowerCase("ja");
    const count = (used.get(key) || 0) + 1;
    used.set(key, count);
    return count === 1 ? document : { ...document, baseName: `${document.baseName} [${count}]` };
  });
}

/**
 * 書き出しの元の状態。削除していない節と線の件数と、削除した物も含めたいちばん新しい
 * 更新・作成・削除の時刻。どちらかが変われば、中身が変わったとみなして書き出し直す。
 */
export function knowledgeExportSignature(source: KnowledgeExportSource): {
  count: number;
  latest: string;
} {
  let count = 0;
  let latest = "";
  for (const type of ["knowledge_node", "knowledge_edge"]) {
    for (const entry of source.list(type, true)) {
      if (isLive(entry)) count += 1;
      for (const field of ["updated_at", "created_at", "deleted_at"]) {
        const value = text(entry[field]);
        if (value > latest) latest = value;
      }
    }
  }
  return { count, latest };
}

/** 済んだ印（{at, count, latest}）が、今の記録の件数と時刻に合うか。束4 の文字起こしの書き出しも使う。 */
export function retiredExportMarkMatches(
  raw: string | null,
  signature: { count: number; latest: string },
): boolean {
  if (!raw) return false;
  try {
    const mark = JSON.parse(raw) as { count?: unknown; latest?: unknown };
    return mark.count === signature.count && mark.latest === signature.latest;
  } catch {
    return false; // 形の分からない印は、書き出し直す（中身が同じファイルは増えない）。
  }
}

export type ExportFiles = Pick<typeof fs, "mkdirSync" | "readFileSync" | "writeFileSync">;

/**
 * 1 つの置き場へ書く。既にあるファイルは上書きしない。中身が同じなら何もせず、
 * 違えば「(2)」「(3)」…を付ける。書いた数と、同じ中身が既にあった数を返す。
 */
export function writeKnowledgeExportFiles(
  directory: string,
  documents: readonly Pick<KnowledgeExportDocument, "baseName" | "markdown">[],
  files: ExportFiles = fs,
): { written: number; unchanged: number } {
  files.mkdirSync(directory, { recursive: true });
  let written = 0;
  let unchanged = 0;
  for (const document of documents) {
    for (let attempt = 1; ; attempt += 1) {
      if (attempt > 1000) throw new Error("同じ名前のファイルが多すぎて書き出せません。");
      const suffix = attempt === 1 ? "" : ` (${attempt})`;
      const filePath = path.join(directory, `${document.baseName}${suffix}.md`);
      try {
        files.writeFileSync(filePath, document.markdown, { encoding: "utf8", flag: "wx" });
        written += 1;
        break;
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code !== "EEXIST") throw error;
        if (files.readFileSync(filePath, "utf8") === document.markdown) {
          unchanged += 1;
          break;
        }
      }
    }
  }
  return { written, unchanged };
}

export interface KnowledgeRetirementExportRepository extends KnowledgeExportSource {
  /** 済んだ印（JSON の文字列）。まだなら null。 */
  readRetiredExportMark(name: "knowledge"): string | null;
  markRetiredExportDone(name: "knowledge", value: string): void;
}

export type KnowledgeRetirementExportResult =
  | { state: "already_done" | "nothing" | "error" }
  | { state: "done" | "retry"; documents: number; directories: string[] };

/** 置き場（userData と、設定してある時の同期ルート）の Exports/retired/knowledge。 */
export function knowledgeRetirementExportDirectories(
  userDataDirectory: string,
  syncRoot: string | null | undefined,
): string[] {
  const roots = [userDataDirectory, text(syncRoot)].filter((root) => root && path.isAbsolute(root));
  return [...new Set(roots.map((root) => path.join(root, ...RETIRED_EXPORT_SEGMENTS)))];
}

/**
 * 起動時に書き出す。すべての置き場に書けた時だけ済んだ印を付ける。印の時から節と線が
 * 変わっていなければ何もしない。どこかで失敗した時は印を付けず、次の起動でやり直す
 * （書けた置き場は、中身が同じなので増えない）。
 * 失敗は起動を止めない。ログには数と code だけを出し、題名や本文は出さない。
 */
export function runKnowledgeRetirementExportOnce(input: {
  repository: KnowledgeRetirementExportRepository;
  userDataDirectory: string;
  syncRoot?: string | null;
  log?: (level: "info" | "warn", message: string) => void;
  now?: () => string;
  files?: ExportFiles;
}): KnowledgeRetirementExportResult {
  const { repository, log = () => {}, now = () => new Date().toISOString(), files = fs } = input;
  try {
    const signature = knowledgeExportSignature(repository);
    if (retiredExportMarkMatches(repository.readRetiredExportMark("knowledge"), signature))
      return { state: "already_done" };
    const documents = buildKnowledgeExport(repository);
    if (documents.length === 0) return { state: "nothing" };
    const directories = knowledgeRetirementExportDirectories(
      input.userDataDirectory,
      input.syncRoot,
    );
    let failed = 0;
    const done: string[] = [];
    for (const directory of directories) {
      try {
        const { written, unchanged } = writeKnowledgeExportFiles(directory, documents, files);
        done.push(directory);
        log(
          "info",
          `Knowledge の節と線を書き出した: files=${documents.length} written=${written} unchanged=${unchanged}`,
        );
      } catch (error) {
        failed += 1;
        const code = (error as { code?: unknown } | null)?.code;
        log(
          "warn",
          `Knowledge の節と線を書き出せなかった置き場がある${code ? `: ${String(code)}` : ""}`,
        );
      }
    }
    if (failed > 0) {
      log("warn", "Knowledge の節と線の書き出しを次の起動でやり直す");
      return { state: "retry", documents: documents.length, directories: done };
    }
    repository.markRetiredExportDone("knowledge", JSON.stringify({ at: now(), ...signature }));
    return { state: "done", documents: documents.length, directories: done };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    log("warn", `Knowledge の節と線を書き出せなかった${code ? `: ${String(code)}` : ""}`);
    return { state: "error" };
  }
}
