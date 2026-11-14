// 別の PC で数だけを写して持ち帰るための表（#755 束 0a）。
// 受け取るのは種類の名前・数・日付だけで、題名・本文・ID・パスはここまで来ない。

/**
 * @typedef {{ type: string, count: number, deleted: number, lastCreatedAt: string | null }} RecordCountRow
 */

/**
 * @param {RecordCountRow[]} rows
 * @param {{ version: string, generatedAt: string }} meta
 * @returns {string}
 */
export function formatRecordCountsMarkdown(rows, meta) {
  return [
    `## Tasken 記録の数（v${meta.version}・${meta.generatedAt}）`,
    "",
    "| 種類 | 件数 | 削除済み | 最後に作られた日 |",
    "|---|---:|---:|---|",
    ...rows.map(
      (row) =>
        `| ${row.type} | ${row.count} | ${row.deleted} | ${String(row.lastCreatedAt || "").slice(0, 10) || "-"} |`,
    ),
    "",
  ].join("\n");
}
