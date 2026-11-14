import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  THEME_FOLDER_MANIFEST,
  THEME_FOLDER_MANIFEST_SCHEMA,
  buildThemeFolderManifest,
  safeFolderSegment,
  themeFolderManifestMatches,
} from "../../shared/storageResolver.mjs";
import { writeAtomicTextFile } from "./atomicText.mjs";

// Theme folder（同期ルート/Themes/<code> または Theme ごとの保存先）を、Theme名ではなく
// marker（.tasken-theme.json）のTheme IDで見つけ、作る。添付・会話のAI Contextが使う。
// もとはTheme AI Packの公開処理の一部だった（AI Packは #755 束2 で外した）。

const WINDOWS_DIRECTORY_FSYNC_CODES = new Set(["EPERM", "ENOTSUP", "EINVAL", "EISDIR"]);

function text(value) {
  return value == null ? "" : String(value).trim();
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

/**
 * Theme markerで確定したfolder配下の追加projection（会話のAI Contextなど）に、
 * containment / symlink拒否を適用する。relativePath自体は呼出側の契約で固定する。
 */
export function assertSafeThemeChildPath({ themeFolder, relativePath, fileSystem = fs } = {}) {
  const root = path.resolve(text(themeFolder));
  const relative = text(relativePath).replace(/\\/g, "/");
  if (
    !root ||
    !relative ||
    path.isAbsolute(relative) ||
    relative.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Theme配下の保存先が不正です。");
  }
  const target = path.resolve(root, ...relative.split("/"));
  if (!isWithin(root, target)) throw new Error("Theme配下の保存先がroot外です。");
  if (!isDirectory(fileSystem, root) || isSymbolicLink(fileSystem, root)) {
    throw new Error("Theme folderにsymlink/junctionは利用できません。");
  }
  let current = root;
  for (const segment of relative.split("/")) {
    current = path.join(current, segment);
    if (!fileSystem.existsSync(current)) continue;
    if (isSymbolicLink(fileSystem, current)) {
      throw new Error("Theme配下の保存先にsymlink/junctionは利用できません。");
    }
  }
  return target;
}

function readJson(fileSystem, filePath, maxBytes = 256 * 1024) {
  if (isSymbolicLink(fileSystem, filePath))
    throw new Error("manifestにsymlink/junctionは利用できません。");
  const stat = fileSystem.statSync(filePath);
  if (!stat.isFile() || stat.size > maxBytes)
    throw new Error("manifestの形式またはサイズが不正です。");
  return JSON.parse(fileSystem.readFileSync(filePath, "utf8"));
}

function writeJson(fileSystem, filePath, value, operationId) {
  return writeAtomicTextFile(
    filePath,
    `${JSON.stringify(value, null, 2)}\n`,
    operationId,
    fileSystem,
  );
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

/** Theme名ではなくmarkerのTheme IDで既存folderを再発見する。 */
export function discoverThemeFolderLocation({
  syncRoot,
  themeStorageRoot,
  themeId,
  themeCode,
  displayName,
  fileSystem = fs,
} = {}) {
  const id = text(themeId);
  if (!id) throw new Error("Theme folderにはTheme IDが必要です。");
  const override = text(themeStorageRoot);
  const commonRoot = text(syncRoot);
  const root = override || commonRoot;
  if (!root) return { status: "needs_root" };
  if (!isDirectory(fileSystem, root) || isSymbolicLink(fileSystem, root)) {
    return { status: "root_unavailable" };
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
          return {
            status: "identity_conflict",
            reason: "theme_manifest_mismatch",
          };
        }
      } catch {
        return {
          status: "identity_conflict",
          reason: "theme_manifest_invalid",
        };
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
        if (!isWithin(themesDirectory, candidate) || isSymbolicLink(fileSystem, candidate))
          continue;
        const markerPath = path.join(candidate, THEME_FOLDER_MANIFEST);
        if (!fileSystem.existsSync(markerPath)) continue;
        try {
          const marker = readJson(fileSystem, markerPath, 32 * 1024);
          if (themeFolderManifestMatches(marker, id)) matches.push(candidate);
          else if (
            entry.name === preferredSegment &&
            marker?.schema !== THEME_FOLDER_MANIFEST_SCHEMA
          ) {
            return {
              status: "identity_conflict",
              reason: "theme_manifest_invalid",
            };
          }
        } catch {
          if (entry.name === preferredSegment) {
            return {
              status: "identity_conflict",
              reason: "theme_manifest_invalid",
            };
          }
        }
      }
    }
    if (matches.length > 1)
      return {
        status: "identity_conflict",
        reason: "duplicate_theme_manifest",
      };
    if (matches.length === 1) {
      themeFolder = matches[0];
      source = "theme_manifest";
    } else {
      themeFolder = path.join(themesDirectory, preferredSegment);
      if (!isWithin(themesDirectory, themeFolder))
        throw new Error("Theme folderが同期rootの外にあります。");
      const markerPath = path.join(themeFolder, THEME_FOLDER_MANIFEST);
      if (fileSystem.existsSync(themeFolder)) {
        if (isSymbolicLink(fileSystem, themeFolder)) {
          return {
            status: "identity_conflict",
            reason: "theme_folder_symlink",
          };
        }
        if (!fileSystem.existsSync(markerPath)) {
          return {
            status: "identity_conflict",
            reason: "unclaimed_preferred_folder",
          };
        }
        try {
          if (!themeFolderManifestMatches(readJson(fileSystem, markerPath, 32 * 1024), id)) {
            return {
              status: "identity_conflict",
              reason: "theme_manifest_mismatch",
            };
          }
        } catch {
          return {
            status: "identity_conflict",
            reason: "theme_manifest_invalid",
          };
        }
      } else {
        createManifest = true;
      }
      source = "preferred";
    }
  }

  return {
    status: "ok",
    source,
    themeFolder,
    createManifest,
    themeManifest: buildThemeFolderManifest({ themeId: id, displayName: text(displayName) }),
  };
}

export function ensureThemeFolderLocation(
  location,
  { fileSystem = fs, operationId = randomUUID() } = {},
) {
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
