import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { markdownSignature } from "../../shared/canonicalMarkdown.mjs";
import {
  DAILY_CONTEXT_SCHEMA,
  DAILY_CONTEXT_DIRECTORY,
  DAILY_CONTEXT_MANIFEST,
  validateDailyContextSelection,
  type DailyContextPlan,
  type DailyContextPublishResult,
} from "../../shared/dailyContext";
import { assertSafeThemeChildPath } from "./themeAiPackPublisher.mjs";
import { writeAtomicTextFile } from "./atomicText.mjs";

const hashPattern = /^sha256:\d+:[a-f0-9]{64}$/;
interface DailyContextManifest {
  schema: string;
  workspaceId: string;
  timezone: string;
  days: Record<
    string,
    Pick<
      DailyContextPlan,
      | "relativePath"
      | "contentHash"
      | "sourceRevision"
      | "generatedAt"
      | "selection"
      | "sources"
      | "includedCount"
      | "excludedCount"
      | "excludedReasons"
      | "partial"
    >
  >;
  pending: {
    date: string;
    contentHash: string;
    sourceRevision: string;
    operationId: string;
  } | null;
}
function safePath(root: string, relativePath: string, fileSystem: typeof fs) {
  return assertSafeThemeChildPath({ themeFolder: root, relativePath, fileSystem });
}
function readManifest(
  root: string,
  workspaceId: string,
  timezone: string,
  fileSystem: typeof fs,
): { directory: string; manifest: DailyContextManifest } {
  const directory = safePath(root, DAILY_CONTEXT_DIRECTORY, fileSystem);
  if (!fileSystem.existsSync(directory))
    return {
      directory,
      manifest: { schema: DAILY_CONTEXT_SCHEMA, workspaceId, timezone, days: {}, pending: null },
    };
  const target = safePath(directory, DAILY_CONTEXT_MANIFEST, fileSystem);
  if (!fileSystem.existsSync(target))
    throw new Error("既存のTasken Contextフォルダーを確認できません。別の保存先を選んでください。");
  const stat = fileSystem.statSync(target);
  if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error("公開履歴の形式が不正です。");
  const manifest: DailyContextManifest = JSON.parse(fileSystem.readFileSync(target, "utf8"));
  if (
    manifest?.schema !== DAILY_CONTEXT_SCHEMA ||
    manifest.workspaceId !== workspaceId ||
    manifest.timezone !== timezone ||
    !manifest.days ||
    typeof manifest.days !== "object" ||
    Array.isArray(manifest.days)
  )
    throw new Error("保存先のWorkspaceまたはタイムゾーンが一致しません。");
  for (const [date, entry] of Object.entries(manifest.days)) {
    validateDailyContextSelection({ date, timezone });
    if (!hashPattern.test(entry?.contentHash) || entry.relativePath !== `Days/${date}.md`)
      throw new Error("公開履歴が不正です。");
  }
  if (manifest.pending) {
    validateDailyContextSelection({ date: manifest.pending.date, timezone });
    if (!hashPattern.test(manifest.pending.contentHash))
      throw new Error("未完了の公開履歴が不正です。");
  }
  return { directory, manifest };
}

/** Only accepts a fresh main-process plan; renderer content is never written. */
export function publishDailyContext({
  root,
  plan,
  expectedContentHash,
  allowPartial = false,
  fileSystem = fs,
}: {
  root: string;
  plan: DailyContextPlan;
  expectedContentHash: string;
  allowPartial?: boolean;
  fileSystem?: typeof fs;
}): DailyContextPublishResult {
  validateDailyContextSelection(plan?.selection);
  if (
    plan.schema !== DAILY_CONTEXT_SCHEMA ||
    plan.relativePath !== `Days/${plan.selection.date}.md` ||
    markdownSignature(plan.content) !== plan.contentHash
  )
    throw new Error("公開内容が不正です。");
  if (plan.contentHash !== expectedContentHash)
    throw new Error(
      "公開対象が変わりました。プレビューを更新してください。以前の公開物は保存先に残っています。",
    );
  if (plan.partial && !allowPartial) throw new Error("部分取得の公開には明示的な確認が必要です。");
  if (typeof root !== "string" || !path.isAbsolute(root))
    throw new Error("公開先フォルダーを選んでください。");
  const { directory, manifest } = readManifest(
    root,
    plan.workspaceId,
    plan.selection.timezone,
    fileSystem,
  );
  const date = plan.selection.date;
  if (manifest.pending && manifest.pending.date !== date)
    throw new Error("未完了の日付を再公開してから、別の日を公開してください。");
  const createdDirectory = !fileSystem.existsSync(directory);
  fileSystem.mkdirSync(directory, { recursive: true });
  const target = safePath(directory, plan.relativePath, fileSystem);
  const previous = manifest.days[date];
  if (fileSystem.existsSync(target)) {
    if (!fileSystem.statSync(target).isFile()) throw new Error("公開先がファイルではありません。");
    const currentHash = markdownSignature(fileSystem.readFileSync(target, "utf8"));
    if (currentHash !== previous?.contentHash && currentHash !== manifest.pending?.contentHash)
      throw new Error("公開物が外部で変更されています。上書きせず停止しました。");
  }
  const operationId = randomUUID();
  const manifestPath = safePath(directory, DAILY_CONTEXT_MANIFEST, fileSystem);
  const writeManifest = (value: DailyContextManifest) => {
    const warning = writeAtomicTextFile(
      manifestPath,
      `${JSON.stringify(value, null, 2)}\n`,
      operationId,
      fileSystem,
    );
    if (warning) throw new Error("公開履歴の旧ファイルが残っています。保存先を確認してください。");
  };
  const pending = {
    date,
    contentHash: plan.contentHash,
    sourceRevision: plan.sourceRevision,
    operationId,
  };
  try {
    writeManifest({ ...manifest, pending });
  } catch (error) {
    // Only remove our newly created directory when it is still empty.
    if (createdDirectory) {
      try {
        fileSystem.rmdirSync(directory);
      } catch {
        /* Keep any recovery files. */
      }
    }
    throw error;
  }
  try {
    const warning = writeAtomicTextFile(target, plan.content, operationId, fileSystem);
    if (warning)
      throw new Error(
        "旧公開物の退避ファイルが残っています。非公開にした内容が残る可能性があります。",
      );
    const entry = {
      relativePath: plan.relativePath,
      contentHash: plan.contentHash,
      sourceRevision: plan.sourceRevision,
      generatedAt: plan.generatedAt,
      selection: plan.selection,
      sources: plan.sources,
      includedCount: plan.includedCount,
      excludedCount: plan.excludedCount,
      excludedReasons: plan.excludedReasons,
      partial: plan.partial,
    };
    writeManifest({ ...manifest, days: { ...manifest.days, [date]: entry }, pending: null });
    return {
      status: "written",
      path: target,
      contentHash: plan.contentHash,
      generatedAt: plan.generatedAt,
      cloudStatus: "unknown",
    };
  } catch {
    throw new Error(
      "公開処理は未完了です。以前の公開内容や退避ファイルが残る可能性があります。同じ日を再確認して再公開してください。",
    );
  }
}
