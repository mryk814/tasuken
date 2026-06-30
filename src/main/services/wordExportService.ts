import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

import { markdownToWordBlocks, noteWordExportSignature, type MarkdownWordBlock, type WordExportRequest, type WordExportResult } from "../../shared/wordExport";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function safeFileName(value: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "note";
}

function paragraph(text: string, style?: string, options: { code?: boolean; indent?: boolean } = {}): string {
  const styleXml = style ? `<w:pStyle w:val="${style}"/>` : "";
  const indentXml = options.indent ? '<w:ind w:left="360" w:hanging="180"/>' : "";
  const runStyle = options.code
    ? '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Consolas"/><w:sz w:val="20"/></w:rPr>'
    : "";
  const lines = text.split(/\r?\n/);
  const textXml = lines.map((line, index) => `${index ? "<w:br/>" : ""}<w:t xml:space="preserve">${escapeXml(line)}</w:t>`).join("");
  return `<w:p><w:pPr>${styleXml}${indentXml}</w:pPr><w:r>${runStyle}${textXml}</w:r></w:p>`;
}

function blockToXml(block: MarkdownWordBlock): string {
  if (block.type === "heading") return paragraph(block.text, `Heading${block.level}`);
  if (block.type === "bullet") return paragraph(`• ${block.text}`, undefined, { indent: true });
  if (block.type === "code") return paragraph(block.text, undefined, { code: true });
  return paragraph(block.text);
}

function documentXml(request: Required<Pick<WordExportRequest, "title" | "bodyMarkdown">> & { themeName?: string | null }, exportedAt: string): string {
  const body = [
    paragraph(request.title, "Title"),
    request.themeName ? paragraph(`Theme: ${request.themeName}`) : "",
    paragraph(`Exported: ${new Date(exportedAt).toLocaleString("ja-JP")}`),
    ...markdownToWordBlocks(request.bodyMarkdown).map(blockToXml),
  ].filter(Boolean).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>`;
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="320" w:after="160"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="260" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="220" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
</w:styles>`;
}

function createDocx(request: Required<Pick<WordExportRequest, "title" | "bodyMarkdown">> & { themeName?: string | null }, filePath: string, exportedAt: string): void {
  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`));
  zip.addFile("_rels/.rels", Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`));
  zip.addFile("word/_rels/document.xml.rels", Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`));
  zip.addFile("word/document.xml", Buffer.from(documentXml(request, exportedAt)));
  zip.addFile("word/styles.xml", Buffer.from(stylesXml()));
  zip.addFile("docProps/core.xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(request.title)}</dc:title>
  <dc:creator>Tasken</dc:creator>
  <cp:lastModifiedBy>Tasken</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${exportedAt}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${exportedAt}</dcterms:modified>
</cp:coreProperties>`));
  zip.addFile("docProps/app.xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Tasken</Application>
</Properties>`));
  zip.writeZip(filePath);
}

export function exportMarkdownNoteToWord(request: WordExportRequest, directory: string): WordExportResult {
  const title = request.title.trim() || "note";
  const bodyMarkdown = request.bodyMarkdown || "";
  const exportedAt = new Date().toISOString();
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, `${safeFileName(title)}.docx`);
  createDocx({ title, bodyMarkdown, themeName: request.themeName }, filePath, exportedAt);
  return {
    canceled: false,
    directory,
    filePath,
    exportedAt,
    bodySignature: noteWordExportSignature(bodyMarkdown),
  };
}
