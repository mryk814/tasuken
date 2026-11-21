function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 日誌（Activity Log）はいつも Tasken ルートの Activity に出す（#810。#803 の決めの 6）。
 * 前の版の個別指定（activityLogDirectory）は新しい書き出しに使わない。前に出した日誌は動かさず、
 * 設定の値も読めるまま残す。
 */
export function activityLogDirectoryFor(artifactDirectory: unknown): string {
  const root = text(artifactDirectory);
  if (!root) return "";
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}Activity`;
}
