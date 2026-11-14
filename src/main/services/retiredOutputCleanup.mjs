import fs from "node:fs";
import path from "node:path";

import { markdownSignature } from "../../shared/canonicalMarkdown.mjs";
import {
  THEME_FOLDER_MANIFEST,
  themeFolderManifestMatches,
} from "../../shared/storageResolver.mjs";

// #755 束2 で外した Theme の AI Pack と日別 Context が、前の版で同期先に書き出したファイルを、
// 一度だけ片付ける。本人の答えは「次の版で、アプリが自分で出したファイルだけを消す」。
//
// 消してよいと判断する印は、前の版が同じフォルダーに置いた管理ファイル（manifest）が持つ
// 各ファイルの content hash（markdownSignature）。中身がその hash と一致するファイルだけを
// 消す。一致しない物は、前の版が書いた後に本人や別の道具が直した物なので残す。見出しの
// 文言よりも厳しく、前の版は書く前に必ずこの hash を manifest に記録していた。
// 名前は前の版が決めていた物（AI Pack の 7 ファイル、日別 Context の Days/Weeks/... の形）に
// 限り、ワイルドカードでは探さない。symlink / junction は辿らない。
//
// 前の版の書き出し処理（themeAiPackPublisher.mjs / dailyContextPublisher.ts）は git の
// 236fb8d4^ と 2445e1e4^ にある。下の定数はそこから写した。

const AI_PACK_DIRECTORY = "AI Pack";
const AI_PACK_MANIFEST = ".tasken-ai-pack.json";
const AI_PACK_SCHEMA = "tasken-ai-pack/v1";
const AI_PACK_FILES = Object.freeze([
  "00 Theme Overview.md",
  "01 Current Work.md",
  "02 Decisions.md",
  "03 Meetings.md",
  "04 Procedures.md",
  "05 Knowledge.md",
  "06 Activity.md",
]);

const DAILY_CONTEXT_DIRECTORY = "Tasken Context";
const DAILY_CONTEXT_MANIFEST = ".tasken-context.json";
const DAILY_CONTEXT_SCHEMA = "tasken-daily-context/v1";
const DAILY_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAILY_DERIVED_PATH =
  /^(README\.md|Years\/\d{4}\.md|Months\/\d{4}-\d{2}\.md|Weeks\/\d{4}-W\d{2}\.md|Sources\/README\.md|Sources\/Themes\/[a-f0-9]{64}\.md|Sources\/(note|capture_entry)-[a-f0-9]{64}\.md)$/;
// 中身が空になった時だけ消す下位フォルダー。深い方から。
const DAILY_CONTEXT_SUBDIRECTORIES = Object.freeze([
  "Days",
  "Weeks",
  "Months",
  "Years",
  "Sources/Themes",
  "Sources",
]);
// 前の版の writeAtomicTextFile が残しうる退避（.<名前>.<operationId>.tmp / .bak）。
const OPERATION_ID = /^[a-f0-9-]{36}$/;
const HASH = /^sha256:\d+:[a-f0-9]{64}$/;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;

function text(value) {
  return value == null ? "" : String(value).trim();
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function plainEntry(fileSystem, targetPath) {
  try {
    const stat = fileSystem.lstatSync(targetPath);
    if (stat.isSymbolicLink()) return "link";
    if (stat.isDirectory()) return "directory";
    if (stat.isFile()) return "file";
    return "other";
  } catch {
    return "missing";
  }
}

function readJson(fileSystem, filePath) {
  if (plainEntry(fileSystem, filePath) !== "file") return null;
  try {
    if (fileSystem.statSync(filePath).size > MAX_MANIFEST_BYTES) return null;
    return record(JSON.parse(fileSystem.readFileSync(filePath, "utf8")));
  } catch {
    return null;
  }
}

/** base の下の相対パス（/ 区切り、前の版の決まった形だけ）を、symlink を辿らずに解く。 */
function resolvePlainChild(fileSystem, base, relativePath) {
  const segments = relativePath.split("/");
  let current = base;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    if (plainEntry(fileSystem, current) !== "directory") return null;
  }
  return path.join(current, segments[segments.length - 1]);
}

function createRun({ trash, fileSystem }) {
  const summary = { trashed: 0, kept: 0, failed: 0, removedDirectories: 0 };

  /** 中身が allowedHashes のどれかと一致する時だけ、ごみ箱へ移す。 */
  async function trashIfSigned(filePath, allowedHashes) {
    if (!filePath) return;
    const kind = plainEntry(fileSystem, filePath);
    if (kind === "missing") return;
    if (kind !== "file") {
      summary.kept += 1;
      return;
    }
    let signature;
    try {
      signature = markdownSignature(fileSystem.readFileSync(filePath, "utf8"));
    } catch {
      summary.kept += 1;
      return;
    }
    if (!allowedHashes.has(signature)) {
      summary.kept += 1;
      return;
    }
    await trashFile(filePath);
  }

  /** 印を確かめ終えた管理ファイル（manifest）を、ごみ箱へ移す。 */
  async function trashFile(filePath) {
    try {
      await trash(filePath);
      summary.trashed += 1;
    } catch {
      summary.failed += 1;
    }
  }

  /** 空のフォルダーだけを消す。本人が置いたファイルが一つでもあれば残す。 */
  function removeIfEmpty(directory) {
    if (plainEntry(fileSystem, directory) !== "directory") return;
    try {
      if (fileSystem.readdirSync(directory).length > 0) return;
      // 空のフォルダーには戻す中身が無いので、ごみ箱を通さずに消す。
      fileSystem.rmdirSync(directory);
      summary.removedDirectories += 1;
    } catch {
      // 消せなくても片付けは続ける（同期の道具がつかんでいる時など）。
    }
  }

  return { summary, trashIfSigned, trashFile, removeIfEmpty };
}

async function cleanAiPack(run, fileSystem, themeFolder, themeId) {
  if (plainEntry(fileSystem, themeFolder) !== "directory") return;
  const marker = readJson(fileSystem, path.join(themeFolder, THEME_FOLDER_MANIFEST));
  if (!themeFolderManifestMatches(marker, themeId)) return;
  const directory = path.join(themeFolder, AI_PACK_DIRECTORY);
  if (plainEntry(fileSystem, directory) !== "directory") return;
  const manifestPath = path.join(directory, AI_PACK_MANIFEST);
  const manifest = readJson(fileSystem, manifestPath);
  // 管理ファイルが無い・形が違う・別の Theme の物なら、本人のフォルダーとみなして触らない。
  if (
    !manifest ||
    manifest.schema !== AI_PACK_SCHEMA ||
    text(manifest.themeId) !== themeId ||
    !Array.isArray(manifest.files)
  )
    return;
  for (const name of AI_PACK_FILES) {
    const described = manifest.files.find((entry) => record(entry)?.name === name);
    const hash = text(described?.contentHash);
    const filePath = path.join(directory, name);
    if (!HASH.test(hash)) {
      if (plainEntry(fileSystem, filePath) !== "missing") run.summary.kept += 1;
      continue;
    }
    await run.trashIfSigned(filePath, new Set([hash]));
  }
  await run.trashFile(manifestPath);
  run.removeIfEmpty(directory);
}

function allowHash(allowed, relativePath, hash) {
  if (!HASH.test(text(hash))) return;
  const hashes = allowed.get(relativePath) ?? new Set();
  hashes.add(text(hash));
  allowed.set(relativePath, hashes);
}

function allowIndexes(allowed, indexes) {
  const entries = record(indexes);
  if (!entries) return;
  for (const [name, hash] of Object.entries(entries)) {
    if (DAILY_DERIVED_PATH.test(name)) allowHash(allowed, name, hash);
  }
}

async function cleanDailyContext(run, fileSystem, root, workspaceId) {
  if (plainEntry(fileSystem, root) !== "directory") return;
  const directory = path.join(root, DAILY_CONTEXT_DIRECTORY);
  if (plainEntry(fileSystem, directory) !== "directory") return;
  const manifestPath = path.join(directory, DAILY_CONTEXT_MANIFEST);
  const manifest = readJson(fileSystem, manifestPath);
  // 別の Workspace が同じ保存先に出した物は、その Workspace の版が片付ける。
  if (
    !manifest ||
    manifest.schema !== DAILY_CONTEXT_SCHEMA ||
    text(manifest.workspaceId) !== workspaceId
  )
    return;

  /** @type {Map<string, Set<string>>} */
  const allowed = new Map();
  for (const [date, entry] of Object.entries(record(manifest.days) ?? {})) {
    const relativePath = `Days/${date}.md`;
    if (DAILY_DATE.test(date) && record(entry)?.relativePath === relativePath)
      allowHash(allowed, relativePath, entry.contentHash);
  }
  allowIndexes(allowed, manifest.indexFiles);
  const pending = record(manifest.pending);
  if (pending) {
    // 中断した公開では、日のファイルは前後どちらの中身でもありうる。
    if (DAILY_DATE.test(text(pending.date))) {
      const relativePath = `Days/${text(pending.date)}.md`;
      allowHash(allowed, relativePath, pending.contentHash);
      allowHash(allowed, relativePath, pending.previousContentHash);
    }
    allowIndexes(allowed, pending.indexFiles);
    allowIndexes(allowed, pending.previousIndexFiles);
  }
  const operationIds = [
    ...new Set([text(manifest.operationId), text(pending?.operationId)]),
  ].filter((id) => OPERATION_ID.test(id));

  for (const [relativePath, hashes] of allowed) {
    const filePath = resolvePlainChild(fileSystem, directory, relativePath);
    if (!filePath) continue;
    await run.trashIfSigned(filePath, hashes);
    for (const operationId of operationIds) {
      for (const extension of ["tmp", "bak"]) {
        const sidePath = path.join(
          path.dirname(filePath),
          `.${path.basename(filePath)}.${operationId}.${extension}`,
        );
        await run.trashIfSigned(sidePath, hashes);
      }
    }
  }
  const manifestBackupHashes = new Set(
    HASH.test(text(manifest.manifestBackupHash)) ? [text(manifest.manifestBackupHash)] : [],
  );
  for (const operationId of operationIds) {
    for (const extension of ["tmp", "bak"]) {
      await run.trashIfSigned(
        path.join(directory, `.${DAILY_CONTEXT_MANIFEST}.${operationId}.${extension}`),
        manifestBackupHashes,
      );
    }
  }
  await run.trashFile(manifestPath);
  for (const subdirectory of DAILY_CONTEXT_SUBDIRECTORIES) {
    const target = resolvePlainChild(fileSystem, directory, subdirectory);
    if (target) run.removeIfEmpty(target);
  }
  run.removeIfEmpty(directory);
}

function pathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function uniqueAbsolutePaths(values) {
  const seen = new Map();
  for (const value of values) {
    const candidate = text(value);
    if (!candidate || !path.isAbsolute(candidate)) continue;
    const key = pathKey(candidate);
    if (!seen.has(key)) seen.set(key, path.resolve(candidate));
  }
  return [...seen.values()];
}

function readDirectoryEntries(fileSystem, directory) {
  try {
    return fileSystem.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** AI Pack を探す Theme folder。同期ルートの Themes/ の下と、Theme ごとの保存先。 */
function themeFolderCandidates(fileSystem, artifactDirectory, themes) {
  const ids = new Set(themes.map((theme) => text(theme.themeId)).filter(Boolean));
  const candidates = [];
  const root = text(artifactDirectory);
  if (root && path.isAbsolute(root)) {
    const themesDirectory = path.join(path.resolve(root), "Themes");
    if (
      plainEntry(fileSystem, path.resolve(root)) === "directory" &&
      plainEntry(fileSystem, themesDirectory) === "directory"
    ) {
      for (const entry of readDirectoryEntries(fileSystem, themesDirectory)) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const folder = path.join(themesDirectory, entry.name);
        const marker = readJson(fileSystem, path.join(folder, THEME_FOLDER_MANIFEST));
        const themeId = text(marker?.themeId);
        if (ids.has(themeId)) candidates.push({ folder, themeId });
      }
    }
  }
  for (const theme of themes) {
    const storageRoot = text(theme.storageRoot);
    if (storageRoot && path.isAbsolute(storageRoot) && ids.has(text(theme.themeId)))
      candidates.push({ folder: path.resolve(storageRoot), themeId: text(theme.themeId) });
  }
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = pathKey(candidate.folder);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 前の版の AI Pack と日別 Context の出力を片付ける。ファイルはごみ箱へ移す。
 * @param {{
 *   workspaceId: string,
 *   artifactDirectory?: string,
 *   themes?: Array<{ themeId: string, storageRoot?: string }>,
 *   dailyContextRoots?: string[],
 *   trash: (filePath: string) => Promise<void>,
 *   fileSystem?: typeof import("node:fs"),
 * }} input
 */
export async function cleanupRetiredOutputs({
  workspaceId,
  artifactDirectory = "",
  themes = [],
  dailyContextRoots = [],
  trash,
  fileSystem = fs,
}) {
  if (typeof trash !== "function") throw new Error("ごみ箱へ移す処理が必要です。");
  const run = createRun({ trash, fileSystem });
  for (const { folder, themeId } of themeFolderCandidates(fileSystem, artifactDirectory, themes)) {
    try {
      await cleanAiPack(run, fileSystem, folder, themeId);
    } catch {
      run.summary.failed += 1;
    }
  }
  const id = text(workspaceId);
  if (id) {
    for (const root of uniqueAbsolutePaths(dailyContextRoots)) {
      try {
        await cleanDailyContext(run, fileSystem, root, id);
      } catch {
        run.summary.failed += 1;
      }
    }
  }
  return run.summary;
}

/**
 * 起動時に一度だけ片付ける。済んだら repository に時刻を残し、二度目は何もしない。
 * ごみ箱へ移せなかったファイルがあった時だけ、次の起動でもう一度試す（同期の道具が
 * ファイルをつかんでいた時など）。失敗は起動を止めず、ログには数だけを出す。
 * @param {{
 *   repository: {
 *     readRetiredOutputLocations(): {
 *       workspaceId: string,
 *       artifactDirectory: string,
 *       themes: Array<{ themeId: string, storageRoot: string }>,
 *       dailyContextRoots: string[],
 *       cleanedAt: string | null,
 *     },
 *     markRetiredOutputsCleaned(at: string): void,
 *   },
 *   trash: (filePath: string) => Promise<void>,
 *   log?: (level: "info" | "warn", message: string) => void,
 *   now?: () => string,
 *   fileSystem?: typeof import("node:fs"),
 * }} input
 */
export async function runRetiredOutputCleanupOnce({
  repository,
  trash,
  log = () => {},
  now = () => new Date().toISOString(),
  fileSystem = fs,
}) {
  try {
    const locations = repository.readRetiredOutputLocations();
    if (locations.cleanedAt) return { state: "already_done" };
    const summary = await cleanupRetiredOutputs({ ...locations, trash, fileSystem });
    const message = `trashed=${summary.trashed} kept=${summary.kept} failed=${summary.failed} removedDirectories=${summary.removedDirectories}`;
    if (summary.failed > 0) {
      log("warn", `前の版の出力の片付けを次の起動でやり直す: ${message}`);
      return { state: "retry", summary };
    }
    repository.markRetiredOutputsCleaned(now());
    if (summary.trashed || summary.kept || summary.removedDirectories)
      log("info", `前の版の出力を片付けた: ${message}`);
    return { state: "done", summary };
  } catch (error) {
    const code = record(error)?.code;
    log("warn", `前の版の出力を片付けられなかった${code ? `: ${String(code)}` : ""}`);
    return { state: "error" };
  }
}
