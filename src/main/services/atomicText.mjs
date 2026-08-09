import fs from "node:fs";
import path from "node:path";

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 同一ディレクトリの一時ファイルから正本へ置き換える。
 * Windowsで既存ファイルへのrenameが拒否された場合だけ、同一ディレクトリの
 * backupへ退避してから置換し、2段目が失敗したら旧ファイルを復元する。
 * @param {string} filePath
 * @param {string} content
 * @param {string} operationId
 * @param {typeof import("node:fs")} fileSystem
 */
export function writeAtomicTextFile(filePath, content, operationId, fileSystem = fs) {
  const directory = path.dirname(filePath);
  fileSystem.mkdirSync(directory, { recursive: true });
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${operationId}.tmp`);
  const backupPath = path.join(directory, `.${path.basename(filePath)}.${operationId}.bak`);
  let backupCreated = false;
  try {
    fileSystem.writeFileSync(tempPath, content, "utf8");
    const handle = fileSystem.openSync(tempPath, "r");
    try {
      try {
        fileSystem.fsyncSync(handle);
      } catch (error) {
        // Windowsの一部filesystemでは通常ファイルのfsyncがEPERM/ENOTSUPになる。
        // 同一directoryのatomic renameは継続し、その他のI/O失敗は保存失敗として返す。
        const code = error && typeof error === "object" ? error.code : "";
        if (!["EPERM", "ENOTSUP", "EINVAL"].includes(code)) throw error;
      }
    } finally {
      fileSystem.closeSync(handle);
    }

    try {
      fileSystem.renameSync(tempPath, filePath);
    } catch (directError) {
      if (!fileSystem.existsSync(filePath)) throw directError;

      // 既存targetの置換が拒否されたOS向けの回復可能な経路。
      fileSystem.renameSync(filePath, backupPath);
      backupCreated = true;
      try {
        fileSystem.renameSync(tempPath, filePath);
      } catch (replaceError) {
        try {
          if (fileSystem.existsSync(filePath)) fileSystem.unlinkSync(filePath);
          fileSystem.renameSync(backupPath, filePath);
          backupCreated = false;
        } catch (restoreError) {
          throw new Error(
            `Markdownの置換に失敗し、旧ファイルの復元にも失敗しました。${errorText(replaceError)} / ${errorText(restoreError)}`,
          );
        }
        throw replaceError;
      }
      let warning = null;
      try {
        fileSystem.unlinkSync(backupPath);
        backupCreated = false;
      } catch (cleanupError) {
        // 新しい正本はすでに設置済みなので、cleanup失敗を保存失敗へ戻さない。
        // backupを残すことで、警告後も旧本文を復旧できる。
        warning = `Markdownは更新しましたが、旧ファイルの退避を削除できませんでした。${errorText(cleanupError)}`;
      }
      return warning;
    }
    return null;
  } finally {
    try {
      if (fileSystem.existsSync(tempPath)) fileSystem.unlinkSync(tempPath);
    } catch {
      // 元の保存結果を隠さず、次回の保存で同名operationの残骸を上書きできるようにする。
    }
    // backupは復元不能時の旧ファイル、またはcleanup警告の証跡になり得るため、
    // このfinallyでは触らない。通常経路ではfallback内で明示的に削除する。
  }
}
