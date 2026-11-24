import { createHash } from "node:crypto";
import fs from "node:fs";

import { resolveArtifactStorageMode } from "../../shared/artifactLinks.mjs";
import {
  canonicalMarkdownBindingFromProperties,
  withCanonicalMarkdownBinding,
} from "../../shared/canonicalMarkdown.mjs";
import {
  SYNC_STORAGE_ROOT_ID,
  rootRelativePathRef,
  type RootRelativePathRef,
} from "../../shared/rootRelativePath.mjs";

/**
 * 同期される記録の中のパスをルート相対にする（#803 段 6・#814）。
 *
 * 対象は 2 つ：Artifact の `stored_path` と、Note の正本 Markdown の結び付け
 * （`canonical_path`・`directory`・`root_identity`）。どちらも書いた端末の絶対パスで
 * 入っているので、ルートの絶対位置が違う別の PC や NAS では指す先がずれる。
 * Activity の canonical 参照と同じ { storage_root_id: "sync", relative_path } の形に
 * 一度きりで移す。物理ファイルは動かさない。
 *
 * - 各端末は、自分のルート（artifactDirectory）の絶対パスで始まる記録だけを変換する。
 *   記録のパスは書いた端末のものなので、変換もその端末だけが行い、他の端末の記録には
 *   触らない。どのルートにも当てはまらない記録は絶対パスのまま残す。
 * - 差分の版の ID は、元の版と変換後の Entity から決まる固定の ID にする。2 台が同じ
 *   変換を独立に走らせても同じ版になり、同期では duplicate として 1 件に収まる
 *   （中身が違えば通常の競合になる。黙って片方を残さない）。
 * - 書き出しの履歴（Note の properties_json.document_exports）は過去の出来事の記録
 *   なので、変換しない。Note の変換は canonical_markdown の結び付けだけを書き換え、
 *   properties_json の他の項目には触らない。
 * - 走らせる前に控えを取り（待ちの変換と同じ道）、同期がほかの端末に追いついている
 *   ときだけ走らせる。追いついていなければ次の起動でやり直す。
 * - 画面の無い NAS の replica では呼ばない（変換は Desktop の起動だけ。NAS は読む側
 *   として、絶対パスとルート相対の両方を解ける）。
 */

type RecordLike = Record<string, unknown>;

export interface PathRelativizationSource {
  /** WorkspaceDatabase.list と同じ形。削除した記録は含まない。 */
  list(type: string): RecordLike[];
  /** WorkspaceDatabase.get と同じ形。 */
  get(type: string, id: string, includeDeleted?: boolean): RecordLike | null;
  /** その記録の同期の head の版の ID。同期していない記録は空文字。 */
  syncHead(type: string, id: string): string;
  /** この端末の Tasken ルート（artifactDirectory）。未設定なら空文字。 */
  rootDirectory(): string;
}

export interface PathRelativizationRepository extends PathRelativizationSource {
  applyPathRelativization(
    type: string,
    entity: RecordLike,
    fixedRevisionId: string,
  ): RecordLike | null;
  readRetiredExportMark(name: typeof BACKUP_MARK): string | null;
  markRetiredExportDone(name: typeof BACKUP_MARK, value: string): void;
}

export interface PathRelativizationPlan {
  type: "artifact" | "note";
  id: string;
  entity: RecordLike;
  revisionId: string;
}

export type PathRelativizationResult =
  | { state: "nothing" | "error" }
  | { state: "not_caught_up" | "backup_failed"; pending: number }
  | { state: "done"; artifacts: number; notes: number; failed: number };

const BACKUP_MARK = "path_relativization_backup";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value: unknown): value is RecordLike {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => (value as RecordLike)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as RecordLike)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function uuidFromHash(hash: string): string {
  const value = `${hash.slice(0, 12)}5${hash.slice(13, 16)}8${hash.slice(17, 32)}`;
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

/**
 * 変換した版の固定の ID。元の版と変換後の Entity（端末ごとに変わる device_id を除く）
 * から決まるので、同じ変換はどの端末でも同じ値になる。形も入力も変えないこと
 * （変えると、端末どうしで版がそろわなくなる）。
 */
export function pathRelativizationRevisionId(
  type: string,
  originalRevisionId: string,
  entity: RecordLike,
): string {
  const { device_id: _deviceId, ...content } = entity;
  const hash = createHash("sha256")
    .update(
      [
        "tasken-path-relativization-revision",
        type,
        String(entity.id),
        originalRevisionId,
        canonicalJson(content),
      ].join("\0"),
    )
    .digest("hex");
  return uuidFromHash(hash);
}

/** Artifact 1 件の変換後の Entity。変換の対象でなければ null。 */
export function relativizedArtifact(artifact: RecordLike, root: string): RecordLike | null {
  if (resolveArtifactStorageMode(artifact.storage_mode) !== "managed") return null;
  if (typeof artifact.stored_path !== "string") return null;
  const ref = rootRelativePathRef(artifact.stored_path, root, SYNC_STORAGE_ROOT_ID);
  if (!ref) return null;
  return { ...artifact, stored_path: ref };
}

/** Note 1 件の変換後の Entity。変換の対象でなければ null。 */
export function relativizedNote(note: RecordLike, root: string): RecordLike | null {
  const properties = isPlainObject(note.properties_json) ? note.properties_json : {};
  const binding = canonicalMarkdownBindingFromProperties(properties, {
    noteId: text(note.id),
  });
  if (!binding?.canonical_path) return null;
  const ref: RootRelativePathRef | null = rootRelativePathRef(
    binding.canonical_path,
    root,
    SYNC_STORAGE_ROOT_ID,
  );
  if (!ref) return null;
  const nextBinding = {
    ...binding,
    canonical_path: "",
    storage_root_id: ref.storage_root_id,
    relative_path: ref.relative_path,
    directory: "",
    root_identity: "",
  };
  return {
    ...note,
    properties_json: withCanonicalMarkdownBinding(properties, nextBinding),
  };
}

/**
 * まだ変換していない記録の一覧。ルートが未設定なら何もしない（変換はルートが決まって
 * いる端末の仕事）。並びは種類と ID で固定する（控えの署名とログの数を安定させるため）。
 */
export function planPathRelativization(source: PathRelativizationSource): PathRelativizationPlan[] {
  const root = source.rootDirectory();
  if (!text(root)) return [];
  const plans: PathRelativizationPlan[] = [];
  const collect = (
    type: "artifact" | "note",
    convert: (record: RecordLike) => RecordLike | null,
  ) => {
    for (const record of source.list(type)) {
      const id = text(record.id);
      if (!id) continue;
      const entity = convert(record);
      if (!entity) continue;
      plans.push({
        type,
        id,
        entity,
        revisionId: pathRelativizationRevisionId(type, source.syncHead(type, id), entity),
      });
    }
  };
  collect("artifact", (record) => relativizedArtifact(record, root));
  collect("note", (record) => relativizedNote(record, root));
  plans.sort(
    (left, right) => left.type.localeCompare(right.type) || left.id.localeCompare(right.id),
  );
  return plans;
}

/** 変換する物の組。同じ組なら、前に取った控えを使い回す。 */
function planSignature(plans: PathRelativizationPlan[]): string {
  const ids = plans.map((plan) => `${plan.type}:${plan.id}:${plan.revisionId}`).sort();
  return createHash("sha256").update(ids.join("\0")).digest("hex");
}

function readBackupMark(raw: string | null): { signature: string; path: string } | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { signature?: unknown; path?: unknown };
    return typeof value.signature === "string" && typeof value.path === "string"
      ? { signature: value.signature, path: value.path }
      : null;
  } catch {
    return null;
  }
}

/**
 * 起動の後に呼ぶ。変換する物があれば、同期が追いついているかを確かめ、控えを取り、
 * 記録ごとに 1 つの transaction で変換する。1 件が書けなくても残りは変換する
 * （書けなかった物は次の起動でやり直す）。失敗は起動を止めない。ログには数だけを出し、
 * パスや題名は出さない。
 */
export async function runPathRelativizationOnce(input: {
  repository: PathRelativizationRepository;
  /** 変換する前の DB の控え。作れたらファイルの場所、作れなければ null。 */
  backup: () => Promise<string | null>;
  /** 同期がほかの端末に追いついているか。省くと追いついているとみなす（同期の無い試験）。 */
  isCaughtUp?: () => Promise<boolean>;
  backupExists?: (filePath: string) => boolean;
  log?: (level: "info" | "warn", message: string) => void;
}): Promise<PathRelativizationResult> {
  const {
    repository,
    log = () => {},
    backupExists = (filePath) => fs.existsSync(filePath),
  } = input;
  try {
    let plans = planPathRelativization(repository);
    if (plans.length === 0) return { state: "nothing" };
    if (input.isCaughtUp) {
      let caughtUp = false;
      try {
        caughtUp = await input.isCaughtUp();
      } catch {
        caughtUp = false;
      }
      if (!caughtUp) {
        log("info", `同期が追いつくまでパスをルート相対にしない: records=${plans.length}`);
        return { state: "not_caught_up", pending: plans.length };
      }
      // 追いつく間に、ほかの端末の変換が届いていれば、それはもう変換しない。
      plans = planPathRelativization(repository);
      if (plans.length === 0) return { state: "nothing" };
    }
    const signature = planSignature(plans);
    const mark = readBackupMark(repository.readRetiredExportMark(BACKUP_MARK));
    if (!(mark && mark.signature === signature && backupExists(mark.path))) {
      let backupPath: string | null = null;
      try {
        backupPath = await input.backup();
      } catch {
        backupPath = null;
      }
      if (!backupPath) {
        log(
          "warn",
          `パスをルート相対にする前の控えが取れなかったので変換しない: records=${plans.length}`,
        );
        return { state: "backup_failed", pending: plans.length };
      }
      repository.markRetiredExportDone(
        BACKUP_MARK,
        JSON.stringify({ signature, path: backupPath }),
      );
    }
    // 控えを取っている間に同期で届いた変換を数え直す（既に変換されていれば書かない）。
    let artifacts = 0;
    let notes = 0;
    let failed = 0;
    for (const plan of planPathRelativization(repository)) {
      try {
        const saved = repository.applyPathRelativization(plan.type, plan.entity, plan.revisionId);
        if (!saved) continue;
        if (plan.type === "artifact") artifacts += 1;
        else notes += 1;
      } catch (error) {
        failed += 1;
        const code = (error as { code?: unknown } | null)?.code;
        log("warn", `パスを 1 件ルート相対にできなかった${code ? `: ${String(code)}` : ""}`);
      }
    }
    log("info", `パスをルート相対にした: artifacts=${artifacts} notes=${notes} failed=${failed}`);
    return { state: "done", artifacts, notes, failed };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    log("warn", `パスをルート相対にできなかった${code ? `: ${String(code)}` : ""}`);
    return { state: "error" };
  }
}
