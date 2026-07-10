import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  attachmentFileNameFromUrl,
  listTaskenAttachmentUrls,
  prepareMarkdownHtmlForPdf,
} from "../src/main/services/markdownPdfImages.mjs";

const PNG_1X1_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W2X8AAAAASUVORK5CYII=";

test("attachmentFileNameFromUrl accepts managed markdown image ids", () => {
  assert.equal(
    attachmentFileNameFromUrl("tasken-attachment://local/00000000-0000-0000-0000-000000000001.png/chart"),
    "00000000-0000-0000-0000-000000000001.png",
  );
  // 拡張子なし・非hex・外部URLは拒否
  assert.equal(attachmentFileNameFromUrl("tasken-attachment://local/not_valid.png/photo"), "");
  assert.equal(attachmentFileNameFromUrl("tasken-attachment://local/00000000-0000-0000-0000-000000000001.txt/x"), "");
  assert.equal(attachmentFileNameFromUrl("https://example.test/a.png"), "");
});

test("prepareMarkdownHtmlForPdf inlines local attachments as data uris", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tasken-pdf-img-"));
  const fileName = "11111111-1111-1111-1111-111111111111.png";
  writeFileSync(path.join(dir, fileName), Buffer.from(PNG_1X1_BASE64, "base64"));

  const html = `<main class="markdown-document">
<figure class="md-image"><img src="tasken-attachment://local/${fileName}/chart" alt="Chart" loading="lazy" /><figcaption>Chart</figcaption></figure>
<img src="https://example.test/remote.png" alt="Remote" loading="lazy" />
</main>`;

  const prepared = prepareMarkdownHtmlForPdf(html, dir);
  assert.equal(prepared.inlinedCount, 1);
  assert.equal(prepared.missingCount, 0);
  assert.equal(prepared.warnings.length, 0);
  assert.match(prepared.html, /src="data:image\/png;base64,/);
  assert.doesNotMatch(prepared.html, /tasken-attachment:/);
  assert.doesNotMatch(prepared.html, /loading="lazy"/);
  assert.match(prepared.html, /https:\/\/example\.test\/remote\.png/);
  assert.match(prepared.html, /<figcaption>Chart<\/figcaption>/);
});

test("prepareMarkdownHtmlForPdf copies attachments to relative asset paths", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tasken-pdf-asset-src-"));
  const assetDir = path.join(mkdtempSync(path.join(tmpdir(), "tasken-pdf-asset-out-")), "images");
  const fileName = "33333333-3333-3333-3333-333333333333.jpg";
  writeFileSync(path.join(dir, fileName), Buffer.from(PNG_1X1_BASE64, "base64"));

  const html = `<figure class="md-image"><img src="tasken-attachment://local/${fileName}/photo" alt="Photo" loading="lazy" /><figcaption>Photo</figcaption></figure>`;
  const prepared = prepareMarkdownHtmlForPdf(html, dir, { assetDirectory: assetDir });

  assert.equal(prepared.inlinedCount, 1);
  assert.match(prepared.html, new RegExp(`src="\\./images/${fileName}"`));
  assert.doesNotMatch(prepared.html, /tasken-attachment:/);
  assert.doesNotMatch(prepared.html, /loading="lazy"/);
  assert.equal(existsSync(path.join(assetDir, fileName)), true);
});

test("prepareMarkdownHtmlForPdf warns when attachment file is missing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tasken-pdf-miss-"));
  const missing = "22222222-2222-2222-2222-222222222222.png";
  const html = `<figure class="md-image"><img src="tasken-attachment://local/${missing}/gone" alt="Gone" loading="lazy" /><figcaption>Gone</figcaption></figure>`;

  const prepared = prepareMarkdownHtmlForPdf(html, dir);
  assert.equal(prepared.inlinedCount, 0);
  assert.equal(prepared.missingCount, 1);
  assert.match(prepared.warnings[0], /画像を読み込めませんでした/);
  assert.match(prepared.html, /md-image-missing/);
  assert.doesNotMatch(prepared.html, /tasken-attachment:/);
});

test("listTaskenAttachmentUrls finds all managed image references", () => {
  const html = `
<img src="tasken-attachment://local/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png/a" />
<img src="tasken-attachment://local/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jpg/b" />
`;
  const urls = listTaskenAttachmentUrls(html);
  assert.equal(urls.length, 2);
});
