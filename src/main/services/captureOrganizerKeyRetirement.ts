import fs from "node:fs";
import path from "node:path";

/**
 * 入力の AI 整理と ChatGPT の接続（#755 束9b で外した）が userData に残した鍵のファイル。
 * 名前で一つずつ指し、ほかのファイル（月の送信回数の記録 capture-organizer-usage.json も含む）には触らない。
 * - capture-organizer-settings.json: provider・model と、OS の暗号化で包んだ API キー。
 * - chatgpt-account.json: ChatGPT の契約枠で使う、OS の暗号化で包んだ token。
 */
export const RETIRED_CAPTURE_ORGANIZER_KEY_FILES = Object.freeze([
  "capture-organizer-settings.json",
  "chatgpt-account.json",
] as const);

export type RetiredCaptureOrganizerKeyFile = (typeof RETIRED_CAPTURE_ORGANIZER_KEY_FILES)[number];

export interface CaptureOrganizerKeyRetirementResult {
  removed: RetiredCaptureOrganizerKeyFile[];
  /** 消せなかったファイルと、例外の code だけ。中身やメッセージは持たない。 */
  failed: { file: RetiredCaptureOrganizerKeyFile; code: string }[];
}

type RetirementFiles = Pick<typeof fs, "lstatSync" | "unlinkSync">;

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,40}$/u.test(code) ? code : "UNKNOWN";
}

/**
 * 起動のたびに呼ぶ。無ければ何もしないので、二度目からは何も起きない。
 * 消せなくても起動は止めない（次の起動でまた消しにいく）。ファイルの中身は読まない。
 */
export function retireCaptureOrganizerKeys(
  userDataPath: string,
  files: RetirementFiles = fs,
): CaptureOrganizerKeyRetirementResult {
  const result: CaptureOrganizerKeyRetirementResult = { removed: [], failed: [] };
  for (const file of RETIRED_CAPTURE_ORGANIZER_KEY_FILES) {
    const filePath = path.join(userDataPath, file);
    try {
      // 同じ名前のフォルダーやリンクの先は消さない。鍵として書いた普通のファイルだけを消す。
      if (!files.lstatSync(filePath).isFile()) {
        result.failed.push({ file, code: "NOT_A_FILE" });
        continue;
      }
      files.unlinkSync(filePath);
      result.removed.push(file);
    } catch (error) {
      const code = errorCode(error);
      if (code !== "ENOENT") result.failed.push({ file, code });
    }
  }
  return result;
}
