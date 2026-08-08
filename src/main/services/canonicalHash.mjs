import { createHash } from "node:crypto";

/** Mainの実ファイルbyte列に対する署名。shared側のUTF-8署名と同じ形式を返す。 */
export function bufferSignature(content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return `sha256:${buffer.byteLength}:${createHash("sha256").update(buffer).digest("hex")}`;
}
