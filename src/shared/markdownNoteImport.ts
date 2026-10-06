/**
 * Notesの一覧へドラッグ&ドロップしたMarkdownファイルを、Noteの題名と本文へ分ける。
 *
 * 題名は frontmatter の `title` → 先頭の `# 見出し` → ファイル名 の順で決める。
 * 本文からは frontmatter と、題名に使った先頭の見出しを外す（Noteは題名を別に持つため）。
 * 相対パスの画像やリンクは書き換えない（取り込み先から辿れない参照はそのまま残る）。
 */
export const MARKDOWN_NOTE_IMPORT_LIMITS = { files: 20, bytes: 2 * 1024 * 1024 } as const;

const MARKDOWN_EXTENSIONS = /\.(md|markdown|mdown|mkd)$/i;

export function isMarkdownFileName(name: string): boolean {
  return MARKDOWN_EXTENSIONS.test(name);
}

export function markdownNoteFromFile(
  fileName: string,
  text: string,
): { title: string; body: string } {
  let body = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  let title = "";
  const frontmatter = /^---\n([\s\S]*?)\n---\n?/.exec(body);
  if (frontmatter) {
    const titleLine = /^title:\s*(.+)$/m.exec(frontmatter[1]);
    if (titleLine) title = titleLine[1].trim().replace(/^(["'])(.*)\1$/, "$2");
    body = body.slice(frontmatter[0].length);
  }
  const heading = /^(?:[ \t]*\n)* {0,3}#[ \t]+(.+?)[ \t]*#*[ \t]*(?:\n|$)/.exec(body);
  if (heading && (!title || heading[1].trim() === title)) {
    title = title || heading[1].trim();
    body = body.slice(heading[0].length);
  }
  if (!title) title = fileName.replace(MARKDOWN_EXTENSIONS, "").trim() || "無題";
  return { title: title.slice(0, 500), body: body.replace(/^\n+/, "").replace(/\s+$/, "") };
}
