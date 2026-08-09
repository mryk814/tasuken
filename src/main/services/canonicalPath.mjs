import fs from "node:fs";
import path from "node:path";

function hasPathTraversal(value) {
  return String(value).split(/[\\/]+/).some((segment) => segment === "..");
}

function isAbsoluteCanonicalPath(value) {
  const candidate = String(value);
  return path.isAbsolute(candidate)
    || /^[A-Za-z]:[\\/]/.test(candidate)
    || /^\\\\/.test(candidate)
    || candidate.startsWith("/");
}

function isWithinDirectory(directory, filePath) {
  const relative = path.relative(path.resolve(directory), path.resolve(filePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertNoSymlinkComponents(filePath) {
  const resolved = path.resolve(filePath);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  const relative = path.relative(parsed.root, resolved);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error("Markdownの保存先にsymlink/junctionを含めることはできません。");
      }
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
  }
}

function pathIdentity(value) {
  return path.normalize(value).replace(/[\\/]+$/, "").toLocaleLowerCase();
}

/** 明示的にlinkedされた既存・選択済みパスを検証する。Root外でもこの経路だけは許可する。 */
export function assertExplicitCanonicalPath(filePath) {
  if (!isAbsoluteCanonicalPath(filePath)) {
    throw new Error("linked canonical Markdownの保存先はabsolute pathで指定してください。");
  }
  if (hasPathTraversal(filePath)) {
    throw new Error("canonical Markdownの保存先にpath traversalを含めることはできません。");
  }
  assertNoSymlinkComponents(filePath);
}

/** 設定済みNotes root配下の生成パスを、lexical/実体の両方で検証する。 */
export function assertGeneratedCanonicalPath(directory, filePath) {
  if (hasPathTraversal(directory) || hasPathTraversal(filePath) || !isWithinDirectory(directory, filePath)) {
    throw new Error("Markdownの保存先が設定済みのNotesフォルダの外にあります。");
  }
  assertNoSymlinkComponents(filePath);
}

/** mkdir後に設定rootと実体解決先が一致することを確認する。 */
export function assertConfiguredCanonicalPath(directory, filePath) {
  if (hasPathTraversal(directory) || hasPathTraversal(filePath)) {
    throw new Error("Markdownの保存先にpath traversalを含めることはできません。");
  }
  if (!isWithinDirectory(directory, filePath)) {
    throw new Error("Markdownの保存先が設定済みのNotesフォルダの外にあります。");
  }
  assertNoSymlinkComponents(directory);
  assertNoSymlinkComponents(filePath);
  const resolvedDirectory = path.resolve(directory);
  const realDirectory = fs.realpathSync(directory);
  if (pathIdentity(realDirectory) !== pathIdentity(resolvedDirectory)) {
    throw new Error("設定済みNotesフォルダがsymlink/junctionです。別の保存先を設定してください。");
  }
  const realParent = fs.realpathSync(path.dirname(filePath));
  const realTarget = fs.existsSync(filePath)
    ? fs.realpathSync(filePath)
    : path.join(realParent, path.basename(filePath));
  if (!isWithinDirectory(realDirectory, realTarget)) {
    throw new Error("Markdownの保存先が実際の設定Rootの外へ解決されます。");
  }
}
