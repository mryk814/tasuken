const NOTE_EXCERPT_LIMIT = 1200;

export function contextPackExcerpt(value, limit = NOTE_EXCERPT_LIMIT) {
  const text = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trimEnd()}\n\n…（長文のため省略）`;
}

function section(title, blocks) {
  const content = blocks.filter(Boolean);
  return content.length ? [`## ${title}`, "", ...content, ""] : [];
}

export function buildContextPackMarkdown({
  theme,
  purpose,
  request,
  candidates,
  generatedAt,
}) {
  const selected = (candidates || []).filter((entry) => entry.selected);
  const byType = (type) => selected.filter((entry) => entry.type === type);
  const taskLines = byType("task").map((entry) => `- [${entry.completed ? "x" : " "}] ${entry.title}${entry.summary ? ` — ${entry.summary}` : ""}`);
  const noteBlocks = byType("note").map((entry) => [
    `### ${entry.title}`,
    "",
    contextPackExcerpt(entry.body),
  ].join("\n"));
  const resourceLines = byType("resource").map((entry) => {
    const link = entry.url ? `[${entry.title}](${entry.url})` : entry.title;
    return `- ${link}${entry.summary ? ` — ${entry.summary}` : ""}`;
  });
  const artifactLines = byType("artifact").map((entry) => (
    `- ${entry.title}${entry.summary ? ` — ${entry.summary}` : ""}`
  ));
  return [
    `# Context: ${theme.name}`,
    "",
    `> 作成: ${generatedAt}`,
    "",
    ...section("Theme概要", [theme.description || "概要なし"]),
    ...section("目的", [purpose || "関連情報を整理し、次の判断や作業を支援してもらう。"]),
    ...section("現在のタスク", taskLines),
    ...section("関連メモ", noteBlocks),
    ...section("関連資料", resourceLines),
    ...section("成果物", artifactLines),
    ...section("AIへの依頼", [request || "この文脈を踏まえて、次に取るべき行動を整理してください。"]),
  ].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
