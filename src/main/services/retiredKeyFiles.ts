import fs from "node:fs";
import path from "node:path";

/**
 * 切った機能が userData に残した、接続の鍵のファイル（#755 の決まり 5「鍵を残さない」）。
 * 名前で一つずつ指し、ほかのファイルには触らない。
 *
 * 入力の AI 整理と ChatGPT の接続（束9b）。月の送信回数の記録 capture-organizer-usage.json は鍵ではないので残す。
 * - capture-organizer-settings.json: provider・model と、OS の暗号化で包んだ API キー。
 * - chatgpt-account.json: ChatGPT の契約枠で使う、OS の暗号化で包んだ token。
 *
 * 外部カレンダー（Google・Microsoft）の接続（束5）。
 * - calendar-provider.json: provider・アカウント名と、OS の暗号化で包んだ OAuth の token。
 * - calendar-cache.json: 最後に取得した日の予定（題名・場所・会議の URL）を OS の暗号化で包んだもの。
 */
export const RETIRED_KEY_FILES = Object.freeze([
  "capture-organizer-settings.json",
  "chatgpt-account.json",
  "calendar-provider.json",
  "calendar-cache.json",
] as const);

export type RetiredKeyFile = (typeof RETIRED_KEY_FILES)[number];

export interface KeyFileRetirementResult {
  removed: RetiredKeyFile[];
  /** 消せなかったファイルと、例外の code だけ。中身やメッセージは持たない。 */
  failed: { file: RetiredKeyFile; code: string }[];
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
export function retireKeyFiles(
  userDataPath: string,
  files: RetirementFiles = fs,
): KeyFileRetirementResult {
  const result: KeyFileRetirementResult = { removed: [], failed: [] };
  for (const file of RETIRED_KEY_FILES) {
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
