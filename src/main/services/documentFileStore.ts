import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Document（#789）のHTML本体の保存。Entityにはメタデータだけを持ち、大きな
// 自己完結HTMLはArtifactのmaterializeと同じ規律（決定的な名前・staging経由の
// 原子的な確定・競合の検出）で、受け側ノードの attachments/documents に置く。
// 保存先は器（Entityの種別）とは独立で、Desktopでも常時稼働nodeでも同じ。

export interface WrittenDocumentFile {
  filename: string;
  size: number;
  created: boolean;
}

export class DocumentFileStore {
  readonly documentDirectory: string;

  constructor(userDataPath: string) {
    if (typeof userDataPath !== "string" || !userDataPath.trim())
      throw new Error("Documentの保存先が設定されていません。");
    this.documentDirectory = path.join(path.resolve(userDataPath), "attachments", "documents");
  }

  private resolveStoredPath(filename: string): string | null {
    if (
      typeof filename !== "string" ||
      !filename ||
      filename !== path.basename(filename) ||
      /[\\/\x00-\x1f\x7f]/.test(filename)
    )
      return null;
    const resolved = path.resolve(this.documentDirectory, filename);
    return resolved.startsWith(`${this.documentDirectory}${path.sep}`) ? resolved : null;
  }

  /**
   * materializationKeyから決定的な名前を作って書く。再送が同じ内容なら同じ
   * ファイルに収束し、違う内容が同じ名前を指したら競合として止める。
   */
  write(input: {
    fileName: string;
    content: string;
    materializationKey: string;
  }): WrittenDocumentFile {
    const materializationKey =
      typeof input.materializationKey === "string" ? input.materializationKey.trim() : "";
    if (!materializationKey || !/^[A-Za-z0-9._-]{1,200}$/.test(materializationKey)) {
      throw new Error("Documentの作成キーが不正です。");
    }
    const parsedName = path.parse(input.fileName);
    const stableSuffix = `-${createHash("sha256").update(materializationKey).digest("hex").slice(0, 12)}`;
    const filename = `${parsedName.name.slice(
      0,
      Math.max(1, 180 - parsedName.ext.length - stableSuffix.length),
    )}${stableSuffix}${parsedName.ext}`;
    fs.mkdirSync(this.documentDirectory, { recursive: true });
    const storedPath = path.join(this.documentDirectory, filename);
    const tempPath = `${storedPath}.tasken-tmp`;
    let created = false;
    if (fs.existsSync(storedPath)) {
      if (fs.readFileSync(storedPath, "utf8") !== input.content) {
        throw new Error(
          "Documentの保存先が競合しています。idempotency_keyを変えて送り直してください。",
        );
      }
    } else {
      let descriptor: number | null = null;
      try {
        // The final path is never opened for writing, so a partial write cannot
        // become a durable Document or poison a later retry.
        fs.rmSync(tempPath, { force: true });
        descriptor = fs.openSync(
          tempPath,
          fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
          0o600,
        );
        const content = Buffer.from(input.content, "utf8");
        let offset = 0;
        while (offset < content.length) {
          const written = fs.writeSync(descriptor, content, offset, content.length - offset);
          if (written <= 0) throw new Error("Document staging write made no progress");
          offset += written;
        }
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = null;
        if (fs.existsSync(storedPath)) {
          if (fs.readFileSync(storedPath, "utf8") !== input.content) {
            throw new Error(
              "Documentの保存先が競合しています。idempotency_keyを変えて送り直してください。",
            );
          }
          fs.rmSync(tempPath, { force: true });
        } else {
          fs.renameSync(tempPath, storedPath);
          created = true;
        }
      } catch (error) {
        if (descriptor !== null) {
          try {
            fs.closeSync(descriptor);
          } catch {
            /* cleanup continues below */
          }
        }
        fs.rmSync(tempPath, { force: true });
        if (
          error instanceof Error &&
          error.message.startsWith("Documentの保存先が競合しています。")
        )
          throw error;
        throw new Error(
          "Documentを保存できませんでした。保存先の空き容量とアクセス権を確認して、送り直してください。",
        );
      }
    }
    const stat = fs.statSync(storedPath);
    return { filename, size: stat.size, created };
  }

  read(filename: string): string | null {
    const storedPath = this.resolveStoredPath(filename);
    if (!storedPath || !fs.existsSync(storedPath)) return null;
    return fs.readFileSync(storedPath, "utf8");
  }

  /** 保存の取り消し（作成の巻き戻し・削除後の片付け）。無くても失敗にしない。 */
  remove(filename: string): void {
    const storedPath = this.resolveStoredPath(filename);
    if (!storedPath) return;
    try {
      fs.rmSync(storedPath, { force: true });
    } catch {
      // Best effort; callers retain the original outcome.
    }
  }
}
