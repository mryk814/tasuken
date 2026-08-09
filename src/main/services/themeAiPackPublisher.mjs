import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { markdownSignature } from "../../shared/canonicalMarkdown.mjs";
import {
  THEME_FOLDER_MANIFEST,
  THEME_FOLDER_MANIFEST_SCHEMA,
  buildThemeFolderManifest,
  safeFolderSegment,
  themeFolderManifestMatches,
} from "../../shared/storageResolver.mjs";
import { THEME_AI_PACK_FILES, THEME_AI_PACK_SCHEMA } from "../../shared/themeAiPack.mjs";
import { writeAtomicTextFile } from "./atomicText.mjs";

export const THEME_AI_PACK_DIRECTORY = "AI Pack";
export const THEME_AI_PACK_MANIFEST = ".tasken-ai-pack.json";
export const THEME_AI_PACK_OPERATION_SCHEMA = "tasken-ai-pack-operation/v1";

const EXPECTED_FILE_NAMES = Object.freeze(THEME_AI_PACK_FILES.map((entry) => entry.name));
const WINDOWS_DIRECTORY_FSYNC_CODES = new Set(["EPERM", "ENOTSUP", "EINVAL", "EISDIR"]);

function text(value) {
  return value == null ? "" : String(value).trim();
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function assertSafeOperationId(value) {
  const operationId = text(value);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(operationId)) {
    throw new Error("Theme AI Pack operation IDが不正です。");
  }
  return operationId;
}

function isDirectory(fileSystem, targetPath) {
  try {
    return fileSystem.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function isSymbolicLink(fileSystem, targetPath) {
  try {
    return Boolean(fileSystem.lstatSync?.(targetPath).isSymbolicLink());
  } catch {
    return true;
  }
}

function isWithin(parentPath, candidatePath) {
  const parent = path.resolve(parentPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function readJson(fileSystem, filePath, maxBytes = 256 * 1024) {
  if (isSymbolicLink(fileSystem, filePath)) throw new Error("manifestにsymlink/junctionは利用できません。");
  const stat = fileSystem.statSync(filePath);
  if (!stat.isFile() || stat.size > maxBytes) throw new Error("manifestの形式またはサイズが不正です。");
  return JSON.parse(fileSystem.readFileSync(filePath, "utf8"));
}

function writeJson(fileSystem, filePath, value, operationId) {
  return writeAtomicTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`, operationId, fileSystem);
}

function fsyncDirectory(fileSystem, directory) {
  let handle;
  try {
    handle = fileSystem.openSync(directory, "r");
    fileSystem.fsyncSync(handle);
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : "";
    if (!WINDOWS_DIRECTORY_FSYNC_CODES.has(code)) throw error;
  } finally {
    if (handle !== undefined) fileSystem.closeSync(handle);
  }
}

function assertPlan(plan) {
  if (!plan || plan.schema !== THEME_AI_PACK_SCHEMA || !text(plan.theme_id)) {
    throw new Error("Theme AI Pack planの形式が不正です。");
  }
  if (!Array.isArray(plan.files) || plan.files.length !== EXPECTED_FILE_NAMES.length) {
    throw new Error("Theme AI Packは固定7ファイルである必要があります。");
  }
  const names = plan.files.map((file) => text(file?.name));
  if (new Set(names).size !== names.length || names.some((name, index) => name !== EXPECTED_FILE_NAMES[index])) {
    throw new Error("Theme AI Packのファイル名または順序が不正です。");
  }
  for (const file of plan.files) {
    if (typeof file.content !== "string" || markdownSignature(file.content) !== file.content_hash) {
      throw new Error(`Theme AI Packのcontent hashが一致しません: ${file.name}`);
    }
    if (path.basename(file.name) !== file.name || path.isAbsolute(file.name)) {
      throw new Error("Theme AI Packのファイル名にpathを指定できません。");
    }
  }
  if (plan.manifest?.themeId !== plan.theme_id || plan.manifest?.contentHash !== plan.content_hash) {
    throw new Error("Theme AI Pack manifestとplanが一致しません。");
  }
  return plan;
}

function operationManifest(plan, operationId, phase) {
  return {
    ...plan.manifest,
    operation: {
      schema: THEME_AI_PACK_OPERATION_SCHEMA,
      themeId: plan.theme_id,
      operationId,
      phase,
    },
  };
}

function operationMatches(manifest, themeId, operationId, phase) {
  return Boolean(
    manifest
    && manifest.schema === THEME_AI_PACK_SCHEMA
    && text(manifest.themeId) === text(themeId)
    && manifest.operation?.schema === THEME_AI_PACK_OPERATION_SCHEMA
    && text(manifest.operation?.themeId) === text(themeId)
    && text(manifest.operation?.operationId) === text(operationId)
    && text(manifest.operation?.phase) === phase,
  );
}

function readPackManifest(fileSystem, directory) {
  return readJson(fileSystem, path.join(directory, THEME_AI_PACK_MANIFEST));
}

function validatePublishedPack(fileSystem, directory, plan) {
  if (!isDirectory(fileSystem, directory) || isSymbolicLink(fileSystem, directory)) return false;
  let names;
  let manifest;
  try {
    names = fileSystem.readdirSync(directory).sort();
    manifest = readPackManifest(fileSystem, directory);
  } catch {
    return false;
  }
  const expectedNames = [...EXPECTED_FILE_NAMES, THEME_AI_PACK_MANIFEST].sort();
  if (names.length !== expectedNames.length || names.some((name, index) => name !== expectedNames[index])) return false;
  if (manifest.schema !== THEME_AI_PACK_SCHEMA || manifest.themeId !== plan.theme_id || manifest.contentHash !== plan.content_hash) return false;
  if (!Array.isArray(manifest.files) || manifest.files.length !== EXPECTED_FILE_NAMES.length) return false;
  for (const file of plan.files) {
    const described = manifest.files.find((entry) => entry?.name === file.name);
    if (!described || described.contentHash !== file.content_hash) return false;
    const filePath = path.join(directory, file.name);
    if (!isWithin(directory, filePath) || isSymbolicLink(fileSystem, filePath)) return false;
    try {
      if (markdownSignature(fileSystem.readFileSync(filePath, "utf8")) !== file.content_hash) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function validatePackAgainstOwnManifest(fileSystem, directory, themeId, operationId, phase) {
  if (!isDirectory(fileSystem, directory) || isSymbolicLink(fileSystem, directory)) return false;
  let names;
  let manifest;
  try {
    names = fileSystem.readdirSync(directory).sort();
    manifest = readPackManifest(fileSystem, directory);
  } catch {
    return false;
  }
  const expectedNames = [...EXPECTED_FILE_NAMES, THEME_AI_PACK_MANIFEST].sort();
  if (names.length !== expectedNames.length || names.some((name, index) => name !== expectedNames[index])) return false;
  if (!operationMatches(manifest, themeId, operationId, phase)) return false;
  if (!Array.isArray(manifest.files) || manifest.files.length !== EXPECTED_FILE_NAMES.length) return false;
  if (manifest.files.some((entry, index) => entry?.name !== EXPECTED_FILE_NAMES[index] || typeof entry?.contentHash !== "string")) return false;
  for (const described of manifest.files) {
    const filePath = path.join(directory, described.name);
    if (!isWithin(directory, filePath) || isSymbolicLink(fileSystem, filePath)) return false;
    try {
      if (markdownSignature(fileSystem.readFileSync(filePath, "utf8")) !== described.contentHash) return false;
    } catch {
      return false;
    }
  }
  const contentHash = markdownSignature(JSON.stringify(manifest.files.map((file) => ({
    name: file.name,
    content_hash: file.contentHash,
    includedEntityIds: Array.isArray(file.includedEntityIds) ? file.includedEntityIds : [],
  }))));
  return contentHash === manifest.contentHash;
}

function snapshotExistingPackManifest(fileSystem, directory, manifest, themeId, operationId) {
  const names = fileSystem.readdirSync(directory).sort();
  const expectedNames = [...EXPECTED_FILE_NAMES, THEME_AI_PACK_MANIFEST].sort();
  if (names.length !== expectedNames.length || names.some((name, index) => name !== expectedNames[index])) {
    throw new Error("既存AI Packのfile構成を検証できませんでした。");
  }
  if (manifest.schema !== THEME_AI_PACK_SCHEMA || text(manifest.themeId) !== themeId || !Array.isArray(manifest.files)) {
    throw new Error("既存AI PackのTheme identityを検証できませんでした。");
  }
  const files = EXPECTED_FILE_NAMES.map((name) => {
    const filePath = path.join(directory, name);
    if (!isWithin(directory, filePath) || isSymbolicLink(fileSystem, filePath)) {
      throw new Error("既存AI Packにsymlink/junctionは利用できません。");
    }
    const described = manifest.files.find((entry) => entry?.name === name);
    return {
      name,
      contentHash: markdownSignature(fileSystem.readFileSync(filePath, "utf8")),
      includedEntityIds: Array.isArray(described?.includedEntityIds) ? described.includedEntityIds : [],
    };
  });
  return {
    ...manifest,
    contentHash: markdownSignature(JSON.stringify(files.map((file) => ({
      name: file.name,
      content_hash: file.contentHash,
      includedEntityIds: file.includedEntityIds,
    })))),
    files,
    operation: {
      schema: THEME_AI_PACK_OPERATION_SCHEMA,
      themeId,
      operationId,
      phase: "backup",
    },
  };
}

function removeValidatedOperationDirectory(fileSystem, directory, themeId, operationId, phase) {
  if (!validatePackAgainstOwnManifest(fileSystem, directory, themeId, operationId, phase)) {
    throw new Error("回収対象directoryのoperation manifestが一致しません。");
  }
  fileSystem.rmSync(directory, { recursive: true, force: false });
}

function receiptName(operationId) {
  return `${assertSafeOperationId(operationId)}.json`;
}

function writeReceipt(fileSystem, recoveryDirectory, receipt) {
  fileSystem.mkdirSync(recoveryDirectory, { recursive: true });
  const receiptPath = path.join(recoveryDirectory, receiptName(receipt.operationId));
  writeJson(fileSystem, receiptPath, receipt, `${receipt.operationId}-receipt`);
  return receiptPath;
}

function removeReceipt(fileSystem, receiptPath) {
  if (fileSystem.existsSync(receiptPath)) fileSystem.unlinkSync(receiptPath);
}

function baseReceipt({ themeId, operationId, targetDirectory, stageDirectory, backupDirectory, phase }) {
  return {
    schema: THEME_AI_PACK_OPERATION_SCHEMA,
    themeId,
    operationId,
    targetDirectory,
    stageDirectory,
    backupDirectory,
    phase,
  };
}

/** Theme名ではなくmarkerのTheme IDで既存folderを再発見する。 */
export function discoverThemeAiPackLocation({
  syncRoot,
  themeStorageRoot,
  themeId,
  themeCode,
  displayName,
  fileSystem = fs,
} = {}) {
  const id = text(themeId);
  if (!id) throw new Error("Theme AI PackにはTheme IDが必要です。");
  const override = text(themeStorageRoot);
  const commonRoot = text(syncRoot);
  const root = override || commonRoot;
  if (!root) return { status: "needs_root", dirty: true, retryPending: true };
  if (!isDirectory(fileSystem, root) || isSymbolicLink(fileSystem, root)) {
    return { status: "root_unavailable", dirty: true, retryPending: true };
  }

  const preferredSegment = safeFolderSegment(themeCode || id);
  let themeFolder;
  let source;
  let createManifest = false;
  if (override) {
    themeFolder = path.resolve(root);
    const markerPath = path.join(themeFolder, THEME_FOLDER_MANIFEST);
    if (fileSystem.existsSync(markerPath)) {
      try {
        if (!themeFolderManifestMatches(readJson(fileSystem, markerPath, 32 * 1024), id)) {
          return { status: "identity_conflict", dirty: true, retryPending: false, reason: "theme_manifest_mismatch" };
        }
      } catch {
        return { status: "identity_conflict", dirty: true, retryPending: false, reason: "theme_manifest_invalid" };
      }
    } else {
      createManifest = true;
    }
    source = "theme_override";
  } else {
    const themesDirectory = path.join(path.resolve(root), "Themes");
    const matches = [];
    if (isDirectory(fileSystem, themesDirectory) && !isSymbolicLink(fileSystem, themesDirectory)) {
      for (const entry of fileSystem.readdirSync(themesDirectory, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink?.()) continue;
        const candidate = path.join(themesDirectory, entry.name);
        if (!isWithin(themesDirectory, candidate) || isSymbolicLink(fileSystem, candidate)) continue;
        const markerPath = path.join(candidate, THEME_FOLDER_MANIFEST);
        if (!fileSystem.existsSync(markerPath)) continue;
        try {
          const marker = readJson(fileSystem, markerPath, 32 * 1024);
          if (themeFolderManifestMatches(marker, id)) matches.push(candidate);
          else if (entry.name === preferredSegment && marker?.schema !== THEME_FOLDER_MANIFEST_SCHEMA) {
            return { status: "identity_conflict", dirty: true, retryPending: false, reason: "theme_manifest_invalid" };
          }
        } catch {
          if (entry.name === preferredSegment) {
            return { status: "identity_conflict", dirty: true, retryPending: false, reason: "theme_manifest_invalid" };
          }
        }
      }
    }
    if (matches.length > 1) return { status: "identity_conflict", dirty: true, retryPending: false, reason: "duplicate_theme_manifest" };
    if (matches.length === 1) {
      themeFolder = matches[0];
      source = "theme_manifest";
    } else {
      themeFolder = path.join(themesDirectory, preferredSegment);
      if (!isWithin(themesDirectory, themeFolder)) throw new Error("Theme folderが同期rootの外にあります。");
      const markerPath = path.join(themeFolder, THEME_FOLDER_MANIFEST);
      if (fileSystem.existsSync(themeFolder)) {
        if (isSymbolicLink(fileSystem, themeFolder)) {
          return { status: "identity_conflict", dirty: true, retryPending: false, reason: "theme_folder_symlink" };
        }
        if (!fileSystem.existsSync(markerPath)) {
          return { status: "identity_conflict", dirty: true, retryPending: false, reason: "unclaimed_preferred_folder" };
        }
        try {
          if (!themeFolderManifestMatches(readJson(fileSystem, markerPath, 32 * 1024), id)) {
            return { status: "identity_conflict", dirty: true, retryPending: false, reason: "theme_manifest_mismatch" };
          }
        } catch {
          return { status: "identity_conflict", dirty: true, retryPending: false, reason: "theme_manifest_invalid" };
        }
      } else {
        createManifest = true;
      }
      source = "preferred";
    }
  }

  return {
    status: "ok",
    dirty: true,
    retryPending: false,
    source,
    themeFolder,
    packDirectory: path.join(themeFolder, THEME_AI_PACK_DIRECTORY),
    createManifest,
    themeManifest: buildThemeFolderManifest({ themeId: id, displayName: text(displayName) }),
  };
}

export function ensureThemeAiPackLocation(location, { fileSystem = fs, operationId = randomUUID() } = {}) {
  if (location?.status !== "ok") return location;
  fileSystem.mkdirSync(location.themeFolder, { recursive: true });
  const markerPath = path.join(location.themeFolder, THEME_FOLDER_MANIFEST);
  if (location.createManifest) {
    writeJson(fileSystem, markerPath, location.themeManifest, `${operationId}-theme`);
    fsyncDirectory(fileSystem, location.themeFolder);
  }
  const marker = readJson(fileSystem, markerPath, 32 * 1024);
  if (!themeFolderManifestMatches(marker, location.themeManifest.themeId)) {
    throw new Error("Theme folder manifestを検証できませんでした。");
  }
  return { ...location, createManifest: false };
}

export function inspectThemeAiPack({ plan, packDirectory, fileSystem = fs } = {}) {
  const normalized = assertPlan(plan);
  if (!fileSystem.existsSync(packDirectory)) return { state: "missing", dirty: true };
  return validatePublishedPack(fileSystem, packDirectory, normalized)
    ? { state: "current", dirty: false, manifest: readPackManifest(fileSystem, packDirectory) }
    : { state: "dirty", dirty: true };
}

export function publishThemeAiPack({
  plan,
  packDirectory,
  recoveryDirectory,
  operationId = randomUUID(),
  fileSystem = fs,
} = {}) {
  const normalized = assertPlan(plan);
  operationId = assertSafeOperationId(operationId);
  const targetDirectory = path.resolve(packDirectory);
  const parentDirectory = path.dirname(targetDirectory);
  if (path.basename(targetDirectory) !== THEME_AI_PACK_DIRECTORY) throw new Error("AI Pack directory名が不正です。");
  if (!isDirectory(fileSystem, parentDirectory) || isSymbolicLink(fileSystem, parentDirectory)) {
    return { state: "root_unavailable", dirty: true, retryPending: true, written: false };
  }
  const current = inspectThemeAiPack({ plan: normalized, packDirectory: targetDirectory, fileSystem });
  if (current.state === "current") return { ...current, state: "skipped", retryPending: false, written: false };

  const stageDirectory = path.join(parentDirectory, `.${THEME_AI_PACK_DIRECTORY}.${operationId}.staging`);
  const backupDirectory = path.join(parentDirectory, `.${THEME_AI_PACK_DIRECTORY}.${operationId}.backup`);
  const recoveryRoot = path.resolve(recoveryDirectory || path.join(parentDirectory, ".tasken-ai-pack-recovery"));
  if (!isWithin(parentDirectory, stageDirectory) || !isWithin(parentDirectory, backupDirectory)) {
    throw new Error("Theme AI Pack operation directoryが保存先の外にあります。");
  }
  for (const candidate of [targetDirectory, stageDirectory, backupDirectory]) {
    if (fileSystem.existsSync(candidate) && isSymbolicLink(fileSystem, candidate)) {
      throw new Error("Theme AI Packの保存先にsymlink/junctionは利用できません。");
    }
  }
  if (fileSystem.existsSync(stageDirectory) || fileSystem.existsSync(backupDirectory)) {
    throw new Error("同じTheme AI Pack operationの残骸があります。復旧してから再試行してください。");
  }
  let receipt = baseReceipt({
    themeId: normalized.theme_id,
    operationId,
    targetDirectory,
    stageDirectory,
    backupDirectory,
    phase: "staging",
  });
  let receiptPath = "";
  let backupCreated = false;
  let published = false;
  let stageCreated = false;
  let previousManifest = null;
  let failedDirectory = "";
  try {
    receiptPath = writeReceipt(fileSystem, recoveryRoot, receipt);
    fileSystem.mkdirSync(stageDirectory, { recursive: false });
    stageCreated = true;
    for (const file of normalized.files) {
      writeAtomicTextFile(path.join(stageDirectory, file.name), file.content, `${operationId}-${EXPECTED_FILE_NAMES.indexOf(file.name)}`, fileSystem);
    }
    writeJson(fileSystem, path.join(stageDirectory, THEME_AI_PACK_MANIFEST), operationManifest(normalized, operationId, "staged"), `${operationId}-manifest`);
    fsyncDirectory(fileSystem, stageDirectory);
    if (!validatePublishedPack(fileSystem, stageDirectory, normalized)) throw new Error("stagingしたAI Packのhashを検証できませんでした。");
    receipt = { ...receipt, phase: "staged" };
    writeReceipt(fileSystem, recoveryRoot, receipt);

    if (fileSystem.existsSync(targetDirectory)) {
      if (isSymbolicLink(fileSystem, targetDirectory)) throw new Error("既存AI Packにsymlink/junctionは利用できません。");
      const previous = readPackManifest(fileSystem, targetDirectory);
      previousManifest = previous;
      if (previous.schema !== THEME_AI_PACK_SCHEMA || text(previous.themeId) !== normalized.theme_id || isSymbolicLink(fileSystem, targetDirectory)) {
        throw new Error("既存AI PackのTheme identityを検証できませんでした。");
      }
      writeJson(
        fileSystem,
        path.join(targetDirectory, THEME_AI_PACK_MANIFEST),
        snapshotExistingPackManifest(fileSystem, targetDirectory, previous, normalized.theme_id, operationId),
        `${operationId}-backup-marker`,
      );
      fsyncDirectory(fileSystem, targetDirectory);
      receipt = { ...receipt, phase: "backup_pending" };
      writeReceipt(fileSystem, recoveryRoot, receipt);
      fileSystem.renameSync(targetDirectory, backupDirectory);
      backupCreated = true;
      fsyncDirectory(fileSystem, parentDirectory);
    }

    receipt = { ...receipt, phase: "swapping" };
    writeReceipt(fileSystem, recoveryRoot, receipt);
    fileSystem.renameSync(stageDirectory, targetDirectory);
    published = true;
    stageCreated = false;
    fsyncDirectory(fileSystem, parentDirectory);
    writeJson(fileSystem, path.join(targetDirectory, THEME_AI_PACK_MANIFEST), operationManifest(normalized, operationId, "published"), `${operationId}-published`);
    fsyncDirectory(fileSystem, targetDirectory);
    if (!validatePublishedPack(fileSystem, targetDirectory, normalized)) {
      throw new Error("公開したAI Packのhashを検証できませんでした。");
    }
    receipt = { ...receipt, phase: "published" };
    writeReceipt(fileSystem, recoveryRoot, receipt);

    if (backupCreated) {
      try {
        removeValidatedOperationDirectory(fileSystem, backupDirectory, normalized.theme_id, operationId, "backup");
        backupCreated = false;
        fsyncDirectory(fileSystem, parentDirectory);
      } catch (cleanupError) {
        removeReceipt(fileSystem, receiptPath);
        return {
          state: "current_with_warning",
          dirty: false,
          retryPending: false,
          written: true,
          operationId,
          manifest: readPackManifest(fileSystem, targetDirectory),
          warning: `旧AI Packのbackupを削除できませんでした。${errorText(cleanupError)}`,
        };
      }
    }
    removeReceipt(fileSystem, receiptPath);
    return {
      state: "current",
      dirty: false,
      retryPending: false,
      written: true,
      operationId,
      manifest: readPackManifest(fileSystem, targetDirectory),
    };
  } catch (error) {
    let recoveryRequired = false;
    let rollbackError = "";
    try {
      if (published && fileSystem.existsSync(targetDirectory)) {
        failedDirectory = path.join(parentDirectory, `.${THEME_AI_PACK_DIRECTORY}.${operationId}.failed`);
        fileSystem.renameSync(targetDirectory, failedDirectory);
      }
      if (backupCreated && fileSystem.existsSync(backupDirectory) && !fileSystem.existsSync(targetDirectory)) {
        const backupManifest = readPackManifest(fileSystem, backupDirectory);
        if (!operationMatches(backupManifest, normalized.theme_id, operationId, "backup")) {
          throw new Error("rollback対象backupのidentityが一致しません。");
        }
        fileSystem.renameSync(backupDirectory, targetDirectory);
        backupCreated = false;
        writeJson(fileSystem, path.join(targetDirectory, THEME_AI_PACK_MANIFEST), {
          ...backupManifest,
          operation: previousManifest?.operation || { ...backupManifest.operation, phase: "published" },
        }, `${operationId}-restored`);
        fsyncDirectory(fileSystem, parentDirectory);
      } else if (!backupCreated && previousManifest && fileSystem.existsSync(targetDirectory)) {
        // old→backup rename自体が失敗した場合、先に付けたbackup markerだけを元へ戻す。
        writeJson(fileSystem, path.join(targetDirectory, THEME_AI_PACK_MANIFEST), previousManifest, `${operationId}-unmark-backup`);
      }
    } catch (restoreError) {
      recoveryRequired = true;
      rollbackError = errorText(restoreError);
    }

    if (!recoveryRequired) {
      try {
        if (fileSystem.existsSync(stageDirectory)) {
          if (stageCreated && !fileSystem.existsSync(path.join(stageDirectory, THEME_AI_PACK_MANIFEST))) {
            fileSystem.rmSync(stageDirectory, { recursive: true, force: false });
          } else {
            removeValidatedOperationDirectory(fileSystem, stageDirectory, normalized.theme_id, operationId, "staged");
          }
        }
        if (failedDirectory && fileSystem.existsSync(failedDirectory)) {
          const failedManifest = readPackManifest(fileSystem, failedDirectory);
          const phase = failedManifest?.operation?.phase;
          if (!["staged", "published"].includes(phase)
            || !validatePackAgainstOwnManifest(fileSystem, failedDirectory, normalized.theme_id, operationId, phase)) {
            throw new Error("失敗した新Packのidentityを検証できません。");
          }
          fileSystem.rmSync(failedDirectory, { recursive: true, force: false });
        }
      } catch {
        // 検証できないdirectoryは自動削除せず、receiptを残して起動時recoveryへ渡す。
        recoveryRequired = true;
      }
    }
    if (recoveryRequired) {
      writeReceipt(fileSystem, recoveryRoot, { ...receipt, phase: "recovery_required", error: errorText(error), rollbackError });
      return { state: "recovery_required", dirty: true, retryPending: false, written: false, operationId, error: errorText(error), rollbackError };
    }
    removeReceipt(fileSystem, receiptPath);
    return { state: "failed_retryable", dirty: true, retryPending: true, written: false, operationId, error: errorText(error) };
  }
}

function receiptPathsAreSafe(receipt) {
  const target = path.resolve(text(receipt.targetDirectory));
  const parent = path.dirname(target);
  let operationId;
  try {
    operationId = assertSafeOperationId(receipt.operationId);
  } catch {
    return false;
  }
  return Boolean(
    operationId
    && path.basename(target) === THEME_AI_PACK_DIRECTORY
    && path.resolve(receipt.stageDirectory) === path.join(parent, `.${THEME_AI_PACK_DIRECTORY}.${operationId}.staging`)
    && path.resolve(receipt.backupDirectory) === path.join(parent, `.${THEME_AI_PACK_DIRECTORY}.${operationId}.backup`),
  );
}

/** receiptと各directory内部manifestの両方が一致したoperationだけを回収する。 */
export function recoverThemeAiPackOperations({ recoveryDirectory, fileSystem = fs } = {}) {
  if (!isDirectory(fileSystem, recoveryDirectory) || isSymbolicLink(fileSystem, recoveryDirectory)) return [];
  const results = [];
  for (const name of fileSystem.readdirSync(recoveryDirectory).filter((entry) => entry.endsWith(".json")).sort()) {
    const receiptPath = path.join(recoveryDirectory, name);
    let receipt;
    try {
      receipt = readJson(fileSystem, receiptPath, 64 * 1024);
      if (receipt.schema !== THEME_AI_PACK_OPERATION_SCHEMA || !receiptPathsAreSafe(receipt)) throw new Error("recovery receiptが不正です。");
      const themeId = text(receipt.themeId);
      const operationId = text(receipt.operationId);
      const target = path.resolve(receipt.targetDirectory);
      const stage = path.resolve(receipt.stageDirectory);
      const backup = path.resolve(receipt.backupDirectory);
      if ([target, stage, backup].some((candidate) => fileSystem.existsSync(candidate) && isSymbolicLink(fileSystem, candidate))) {
        throw new Error("recovery対象にsymlink/junctionは利用できません。");
      }
      const targetManifest = fileSystem.existsSync(target) ? readPackManifest(fileSystem, target) : null;
      const stageManifest = fileSystem.existsSync(stage) ? readPackManifest(fileSystem, stage) : null;
      const backupManifest = fileSystem.existsSync(backup) ? readPackManifest(fileSystem, backup) : null;

      if (targetManifest && validatePackAgainstOwnManifest(fileSystem, target, themeId, operationId, "published")) {
        if (stageManifest) removeValidatedOperationDirectory(fileSystem, stage, themeId, operationId, "staged");
        if (backupManifest) removeValidatedOperationDirectory(fileSystem, backup, themeId, operationId, "backup");
        fsyncDirectory(fileSystem, path.dirname(target));
        removeReceipt(fileSystem, receiptPath);
        results.push({ operationId, state: "current" });
        continue;
      }
      if (targetManifest && !backupManifest && validatePackAgainstOwnManifest(fileSystem, target, themeId, operationId, "backup")) {
        writeJson(fileSystem, path.join(target, THEME_AI_PACK_MANIFEST), {
          ...targetManifest,
          operation: { ...targetManifest.operation, phase: "published" },
        }, `${operationId}-recover-backup-pending`);
        if (stageManifest) removeValidatedOperationDirectory(fileSystem, stage, themeId, operationId, "staged");
        fsyncDirectory(fileSystem, target);
        fsyncDirectory(fileSystem, path.dirname(target));
        removeReceipt(fileSystem, receiptPath);
        results.push({ operationId, state: "restored" });
        continue;
      }
      if (targetManifest && validatePackAgainstOwnManifest(fileSystem, target, themeId, operationId, "staged")) {
        writeJson(fileSystem, path.join(target, THEME_AI_PACK_MANIFEST), {
          ...targetManifest,
          operation: { ...targetManifest.operation, phase: "published" },
        }, `${operationId}-recover-swapped-stage`);
        if (backupManifest) removeValidatedOperationDirectory(fileSystem, backup, themeId, operationId, "backup");
        if (stageManifest) removeValidatedOperationDirectory(fileSystem, stage, themeId, operationId, "staged");
        fsyncDirectory(fileSystem, target);
        fsyncDirectory(fileSystem, path.dirname(target));
        removeReceipt(fileSystem, receiptPath);
        results.push({ operationId, state: "published" });
        continue;
      }
      if (!targetManifest && backupManifest && validatePackAgainstOwnManifest(fileSystem, backup, themeId, operationId, "backup")) {
        fileSystem.renameSync(backup, target);
        writeJson(fileSystem, path.join(target, THEME_AI_PACK_MANIFEST), {
          ...backupManifest,
          operation: { ...backupManifest.operation, phase: "published" },
        }, `${operationId}-recover-backup`);
        if (stageManifest) removeValidatedOperationDirectory(fileSystem, stage, themeId, operationId, "staged");
        fsyncDirectory(fileSystem, target);
        fsyncDirectory(fileSystem, path.dirname(target));
        removeReceipt(fileSystem, receiptPath);
        results.push({ operationId, state: "restored" });
        continue;
      }
      if (!targetManifest && !backupManifest && stageManifest && validatePackAgainstOwnManifest(fileSystem, stage, themeId, operationId, "staged")) {
        fileSystem.renameSync(stage, target);
        writeJson(fileSystem, path.join(target, THEME_AI_PACK_MANIFEST), {
          ...stageManifest,
          operation: { ...stageManifest.operation, phase: "published" },
        }, `${operationId}-recover-stage`);
        fsyncDirectory(fileSystem, target);
        fsyncDirectory(fileSystem, path.dirname(target));
        removeReceipt(fileSystem, receiptPath);
        results.push({ operationId, state: "published" });
        continue;
      }
      throw new Error("recovery対象のphaseを安全に判定できません。");
    } catch (error) {
      results.push({ operationId: text(receipt?.operationId) || name.replace(/\.json$/, ""), state: "recovery_required", error: errorText(error) });
    }
  }
  return results;
}
