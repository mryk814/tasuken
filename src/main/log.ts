import fs from "node:fs";
import path from "node:path";

export type LogLevel = "info" | "warn" | "error";

const MAX_BYTES = 2 * 1024 * 1024;
const KEEP_GENERATIONS = 3;

let logFilePath: string | null = null;

/** userData配下のログ先を決める。起動時に一度だけ呼ぶ。 */
export function configureMainLog(userDataPath: string): void {
  const directory = path.join(userDataPath, "logs");
  fs.mkdirSync(directory, { recursive: true });
  logFilePath = path.join(directory, "main.log");
}

function rotateIfNeeded(target: string): void {
  const size = fs.statSync(target, { throwIfNoEntry: false })?.size ?? 0;
  if (size < MAX_BYTES) return;
  for (let generation = KEEP_GENERATIONS - 1; generation >= 1; generation -= 1) {
    const from = generation === 1 ? target : `${target}.${generation - 1}`;
    if (fs.existsSync(from)) fs.renameSync(from, `${target}.${generation}`);
  }
}

/**
 * 発生箇所・原因・stackをMain側だけに残す。
 * Rendererへは projectMediaCaptureIpcError 等の安全な文言を返すため、
 * ここを書かないと利用者も開発者も失敗理由に到達できない。
 */
export function logMain(level: LogLevel, scope: string, message: string, error?: unknown): void {
  const detail =
    error instanceof Error
      ? `${error.message}\n${error.stack || ""}`
      : error === undefined
        ? ""
        : String(error);
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${scope} ${message}${detail ? `\n${detail}` : ""}\n`;
  if (level === "error") console.error(line.trimEnd());
  else if (level === "warn") console.warn(line.trimEnd());
  else console.info(line.trimEnd());
  if (!logFilePath) return;
  try {
    rotateIfNeeded(logFilePath);
    fs.appendFileSync(logFilePath, line, { encoding: "utf8" });
  } catch {
    // ログ書き込みの失敗で機能を止めない。console側には既に出している。
  }
}
