function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Activity Logは個別設定がなければ、Root配下のActivityへ集約する。 */
export function defaultActivityLogDirectory(artifactDirectory: unknown): string {
  const root = text(artifactDirectory);
  if (!root) return "";
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}Activity`;
}

export function resolveActivityLogDirectory(
  configuredDirectory: unknown,
  artifactDirectory: unknown,
): string {
  return text(configuredDirectory) || defaultActivityLogDirectory(artifactDirectory);
}
