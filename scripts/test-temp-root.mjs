// 試験の一回の実行に専用の一時フォルダーを与え、終わったら消す。
//
// 試験は 100 ほどのファイルが os.tmpdir() の下に mkdtempSync で作ったまま消さず、
// %LOCALAPPDATA%\Temp に tasken-satellite-・tasken-md・tasken-pdf-* などが溜まっていた
// （2026-11-14、3 つのリポジトリで計 22 万。Playwright の playwright-artifacts-* も）。
// 試験ごとに後片付けを足す代わりに、試験の子プロセスの TEMP/TMP/TMPDIR をこの根へ向ける。
// 子と孫（Electron、MCP の子、Playwright）は環境を受け継ぎ、Windows の os.tmpdir() は呼ぶ
// たびに TEMP を読むので、os.tmpdir() の下に作るものはすべてこの根に入る。子が終わって
// ファイルを放してから根ごと消す（開いたままの SQLite は Windows では消せない）。消す前に
// 殺された実行の根は残るので、始めるたびに 1 日より古い根を掃く。
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const TEMP_ROOT_PREFIX = "tasken-testrun-";
const STALE_MS = 24 * 60 * 60 * 1000;

/** base の下の TEMP_ROOT_PREFIX のフォルダーのうち、更新が maxAgeMs より前のものを消す。 */
export function sweepStaleTempRoots(base = os.tmpdir(), maxAgeMs = STALE_MS, now = Date.now()) {
  const removed = [];
  let names;
  try {
    names = readdirSync(base);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (!name.startsWith(TEMP_ROOT_PREFIX)) continue;
    const dir = path.join(base, name);
    try {
      if (now - statSync(dir).mtimeMs < maxAgeMs) continue;
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
      removed.push(dir);
    } catch {
      // 動いている実行がまだ使っているか、もう無い。残しておく。
    }
  }
  return removed;
}

/**
 * 古い根を掃いてから新しい根を作る。env は TEMP/TMP/TMPDIR をその根へ向けた環境、
 * remove() は根を消す（消せなければ警告だけ出し、次の実行の掃除に任せる）。
 */
export function createTempRoot({ base = os.tmpdir(), env = process.env } = {}) {
  sweepStaleTempRoots(base);
  const root = mkdtempSync(path.join(base, TEMP_ROOT_PREFIX));
  return {
    root,
    env: { ...env, TEMP: root, TMP: root, TMPDIR: root },
    remove() {
      try {
        // 子が起こした孫（MCP、Electron の helper）がファイルを放すまで少し待つ。
        rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
      } catch (error) {
        console.error(`一時フォルダーを消せなかった: ${root}: ${error.message}`);
      }
    },
  };
}
