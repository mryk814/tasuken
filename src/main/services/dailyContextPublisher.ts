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
import {
  buildPeriodContextFiles,
  publishedDayGroups,
  type PublishedContextDay,
} from "../../shared/periodContext";

const hashPattern = /^sha256:\d+:[a-f0-9]{64}$/;
interface DailyContextManifest {
  schema: string;
  workspaceId: string;
  timezone: string;
  days: Record<string, PublishedContextDay>;
  indexFiles?: Record<string, string>;
  operationId?: string;
  manifestBackupHash?: string;
  pending: {
    date: string;
    contentHash: string;
    sourceRevision: string;
    operationId: string;
    indexFiles?: Record<string, string>;
    previousIndexFiles?: Record<string, string>;
    previousContentHash?: string;
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
    if (
      !Array.isArray(entry.sources) ||
      !entry.sources.every(
        (source) => source && typeof source.type === "string" && typeof source.id === "string",
      ) ||
      typeof entry.generatedAt !== "string" ||
      typeof entry.sourceRevision !== "string" ||
      !entry.selection ||
      !Number.isSafeInteger(entry.includedCount) ||
      entry.includedCount < 0 ||
      !Number.isSafeInteger(entry.excludedCount) ||
      entry.excludedCount < 0 ||
      entry.selection.date !== date ||
      entry.selection.timezone !== timezone ||
      typeof entry.partial !== "boolean" ||
      (entry.groups !== undefined &&
        (!Array.isArray(entry.groups) ||
          !entry.groups.every(
            (group) =>
              group &&
              (group.themeId === null || typeof group.themeId === "string") &&
              (group.themeTitle === null || typeof group.themeTitle === "string") &&
              Array.isArray(group.sources),
          )))
    )
      throw new Error("公開履歴の索引情報が不正です。");
  }
  for (const indexes of [
    manifest.indexFiles,
    manifest.pending?.indexFiles,
    manifest.pending?.previousIndexFiles,
  ]) {
    if (indexes === undefined) continue;
    if (
      !indexes ||
      typeof indexes !== "object" ||
      Array.isArray(indexes) ||
      Object.entries(indexes).some(
        ([name, hash]) =>
          !/^(README\.md|Years\/\d{4}\.md|Months\/\d{4}-\d{2}\.md|Weeks\/\d{4}-W\d{2}\.md)$/.test(
            name,
          ) || !hashPattern.test(hash),
      )
    )
      throw new Error("公開索引の管理情報が不正です。");
  }
  if (manifest.pending) {
    validateDailyContextSelection({ date: manifest.pending.date, timezone });
    if (!hashPattern.test(manifest.pending.contentHash))
      throw new Error("未完了の公開履歴が不正です。");
    if (
      manifest.pending.previousContentHash !== undefined &&
      !hashPattern.test(manifest.pending.previousContentHash)
    )
      throw new Error("未完了の公開履歴が不正です。");
  }
  const operationId = manifest.operationId ?? manifest.pending?.operationId;
  if (operationId !== undefined && !/^[a-f0-9-]{36}$/.test(operationId))
    throw new Error("公開処理の識別子が不正です。");
  if (manifest.manifestBackupHash !== undefined && !hashPattern.test(manifest.manifestBackupHash))
    throw new Error("公開履歴の退避情報が不正です。");
  return { directory, manifest };
}

function cleanupPreviousOperation(
  directory: string,
  manifest: DailyContextManifest,
  fileSystem: typeof fs,
) {
  const operationId = manifest.operationId ?? manifest.pending?.operationId;
  if (!operationId) return;
  const expected = new Map<string, Set<string>>();
  const allow = (name: string, hash: string | undefined) => {
    const hashes = expected.get(name) ?? new Set<string>();
    if (hash) hashes.add(hash);
    expected.set(name, hashes);
  };
  for (const day of Object.values(manifest.days)) allow(day.relativePath, day.contentHash);
  if (manifest.pending) {
    allow(`Days/${manifest.pending.date}.md`, manifest.pending.contentHash);
    allow(`Days/${manifest.pending.date}.md`, manifest.pending.previousContentHash);
  }
  for (const indexes of [
    manifest.indexFiles,
    manifest.pending?.indexFiles,
    manifest.pending?.previousIndexFiles,
  ])
    for (const [name, hash] of Object.entries(indexes ?? {})) allow(name, hash);
  allow(DAILY_CONTEXT_MANIFEST, manifest.manifestBackupHash);
  for (const [name, hashes] of expected) {
    const managedPath = safePath(directory, name, fileSystem);
    for (const extension of ["tmp", "bak"]) {
      const target = path.join(
        path.dirname(managedPath),
        `.${path.basename(managedPath)}.${operationId}.${extension}`,
      );
      if (!fileSystem.existsSync(target)) continue;
      if (
        fileSystem.lstatSync(target).isSymbolicLink() ||
        !fileSystem.statSync(target).isFile() ||
        !hashes.has(markdownSignature(fileSystem.readFileSync(target, "utf8")))
      )
        throw new Error(
          "前回の退避ファイルを確認できません。保存先を確認してから再公開してください。",
        );
      try {
        fileSystem.unlinkSync(target);
      } catch {
        throw new Error("前回の退避ファイルを削除できません。同じ日を再公開してください。");
      }
    }
  }
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
  cleanupPreviousOperation(directory, manifest, fileSystem);
  const createdDirectory = !fileSystem.existsSync(directory);
  fileSystem.mkdirSync(directory, { recursive: true });
  const target = safePath(directory, plan.relativePath, fileSystem);
  const previous = manifest.days[date];
  let previousContentHash: string | undefined;
  if (fileSystem.existsSync(target)) {
    if (!fileSystem.statSync(target).isFile()) throw new Error("公開先がファイルではありません。");
    const currentHash = markdownSignature(fileSystem.readFileSync(target, "utf8"));
    if (
      currentHash !== previous?.contentHash &&
      currentHash !== manifest.pending?.contentHash &&
      currentHash !== manifest.pending?.previousContentHash
    )
      throw new Error("公開物が外部で変更されています。上書きせず停止しました。");
    previousContentHash = currentHash;
  }
  const operationId = randomUUID();
  const manifestPath = safePath(directory, DAILY_CONTEXT_MANIFEST, fileSystem);
  const manifestText = (value: DailyContextManifest) => `${JSON.stringify(value, null, 2)}\n`;
  const writeManifest = (value: DailyContextManifest) => {
    const warning = writeAtomicTextFile(manifestPath, manifestText(value), operationId, fileSystem);
    if (warning) throw new Error("公開履歴の旧ファイルが残っています。保存先を確認してください。");
  };
  const pending = {
    date,
    contentHash: plan.contentHash,
    sourceRevision: plan.sourceRevision,
    operationId,
    indexFiles: {} as Record<string, string>,
    previousIndexFiles: {} as Record<string, string>,
    previousContentHash,
  };
  const entry: PublishedContextDay = {
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
    groups: publishedDayGroups(plan),
  };
  const nextDays = { ...manifest.days, [date]: entry };
  // A removed managed day is a withdrawal; do not leave dangling links in indexes.
  for (const [publishedDate, published] of Object.entries(nextDays)) {
    if (publishedDate === date) continue;
    const publishedPath = safePath(directory, published.relativePath, fileSystem);
    if (!fileSystem.existsSync(publishedPath)) delete nextDays[publishedDate];
    else if (
      !fileSystem.statSync(publishedPath).isFile() ||
      markdownSignature(fileSystem.readFileSync(publishedPath, "utf8")) !== published.contentHash
    )
      throw new Error("日別公開物が外部で変更されています。索引の更新を停止しました。");
  }
  const indexContents = buildPeriodContextFiles({ days: nextDays, timezone: manifest.timezone });
  const indexFiles = Object.fromEntries(
    Object.entries(indexContents).map(([name, content]) => [name, markdownSignature(content)]),
  );
  pending.indexFiles = indexFiles;
  const managedNames = [
    ...new Set([
      ...Object.keys(manifest.indexFiles ?? {}),
      ...Object.keys(manifest.pending?.indexFiles ?? {}),
      ...Object.keys(manifest.pending?.previousIndexFiles ?? {}),
      ...Object.keys(indexFiles),
    ]),
  ].sort();
  for (const name of managedNames) {
    const indexPath = safePath(directory, name, fileSystem);
    if (!fileSystem.existsSync(indexPath)) continue;
    if (!fileSystem.statSync(indexPath).isFile())
      throw new Error("索引の公開先がファイルではありません。");
    const hash = markdownSignature(fileSystem.readFileSync(indexPath, "utf8"));
    if (
      hash !== manifest.indexFiles?.[name] &&
      hash !== manifest.pending?.indexFiles?.[name] &&
      hash !== manifest.pending?.previousIndexFiles?.[name]
    )
      throw new Error("索引が外部で変更されています。上書きせず停止しました。");
    pending.previousIndexFiles[name] = hash;
  }
  const pendingManifest = {
    ...manifest,
    pending,
    operationId,
    manifestBackupHash: fileSystem.existsSync(manifestPath)
      ? markdownSignature(fileSystem.readFileSync(manifestPath, "utf8"))
      : undefined,
  };
  try {
    writeManifest(pendingManifest);
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
    for (const name of managedNames) {
      const indexPath = safePath(directory, name, fileSystem);
      if (indexContents[name] === undefined) {
        if (fileSystem.existsSync(indexPath)) fileSystem.unlinkSync(indexPath);
      } else {
        const warning = writeAtomicTextFile(
          indexPath,
          indexContents[name],
          operationId,
          fileSystem,
        );
        if (warning) throw new Error("索引の旧ファイルが残っています。保存先を確認してください。");
      }
    }
    writeManifest({
      ...manifest,
      days: nextDays,
      indexFiles,
      pending: null,
      operationId,
      manifestBackupHash: markdownSignature(manifestText(pendingManifest)),
    });
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
