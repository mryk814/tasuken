function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 日誌（Activity Log）の出力先（#810。#803 の決めの 6）。ルートがあれば、いつもルートの Activity。
 * 前の版の個別指定（activityLogDirectory）は、ルートを設定していない端末でだけ使う。ルートが無い
 * だけで毎日の自動出力を止めないため。前に出した日誌は動かさず、設定の値も読めるまま残す。
 */
export function activityLogDirectoryFor(
  artifactDirectory: unknown,
  legacyDirectory: unknown = "",
): string {
  const root = text(artifactDirectory);
  if (!root) return text(legacyDirectory);
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}Activity`;
}
