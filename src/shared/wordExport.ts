export interface WordExportRequest {
  title: string;
  bodyMarkdown: string;
  themeName?: string | null;
  directory?: string | null;
  chooseDirectory?: boolean;
}

export interface WordExportResult {
  canceled: boolean;
  directory?: string;
  filePath?: string;
  exportedAt?: string;
  bodySignature?: string;
}

export type MarkdownWordBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullet"; text: string }
  | { type: "code"; text: string };

export function noteWordExportSignature(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function splitMarkdownFrontmatter(value: string): { frontmatter: string; body: string } {
  const normalized = value.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\r?\n?/);
  if (!match) return { frontmatter: "", body: value };
  return {
    frontmatter: match[1],
    body: normalized.slice(match[0].length),
  };
}

export function markdownToWordBlocks(value: string): MarkdownWordBlock[] {
  const { frontmatter, body } = splitMarkdownFrontmatter(value);
  const blocks: MarkdownWordBlock[] = [];
  if (frontmatter.trim()) {
    blocks.push({ type: "heading", level: 3, text: "Frontmatter" });
    blocks.push({ type: "code", text: frontmatter.trim() });
  }

  const lines = body.split(/\r?\n/);
  let paragraph: string[] = [];
  let code: string[] = [];
  let inCode = false;

  const flushParagraph = () => {
    const text = paragraph.join(" ").trim();
    if (text) blocks.push({ type: "paragraph", text });
    paragraph = [];
  };

  const flushCode = () => {
    blocks.push({ type: "code", text: code.join("\n") });
    code = [];
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushParagraph();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2].trim() });
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      blocks.push({ type: "bullet", text: bullet[1].trim() });
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    paragraph.push(line.trim());
  }
  if (inCode) flushCode();
  flushParagraph();
  return blocks;
}
