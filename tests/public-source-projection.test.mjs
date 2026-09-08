import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { markdownSignature } from "../src/shared/canonicalMarkdown.mjs";

const bundle = await build({
  entryPoints: ["src/shared/publicSourceProjection.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { buildPublicSourceProjection } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const generatedAt = "2026-09-06T00:00:00.000Z";
const note = {
  id: "note-1",
  title: "研究メモ",
  body_markdown: "測定条件を確認した。",
  project_id: "theme-1",
  version: 3,
  ai_visibility: ["m365"],
};
const project = (entity = note, options = {}) =>
  buildPublicSourceProjection({
    type: "note",
    entity,
    generatedAt,
    explicitlyAllowed: true,
    ...options,
  });

test("full source requires explicit consent and effective M365 permission", () => {
  assert.equal(project(note, { explicitlyAllowed: false }), null);
  assert.equal(project({ ...note, ai_visibility: [] }), null);
  const inherited = { ...note, ai_visibility: null };
  assert.equal(
    project(inherited, { theme: { default_ai_visibility: [] }, workspaceDefault: ["m365"] }),
    null,
  );
  assert.ok(
    project(inherited, { theme: { default_ai_visibility: ["m365"] }, workspaceDefault: [] }),
  );
  assert.equal(project(inherited, { workspaceDefault: [] }), null);
});

test("deleted, unsupported, and superseded records never expose a body", () => {
  assert.equal(project({ ...note, deleted_at: generatedAt }), null);
  for (const type of ["resource", "conversation", "work_log", "theme"])
    assert.equal(project(note, { type }), null);
  assert.equal(project({ ...note, ai_freshness: "superseded" }), null);
  assert.equal(project({ ...note, ai_superseded_by: { type: "note", id: "new" } }), null);
  assert.equal(
    project({ ...note, ai_freshness: "current", ai_superseded_by: { type: "note", id: "new" } }),
    null,
  );
});

test("notes and captures keep long Unicode bodies, identify their current revision, and do not fetch attachments", () => {
  const body = "実験結果🧪の記録。\n".repeat(1800);
  for (const type of ["note", "capture_entry"]) {
    const result = project(
      { ...note, body_markdown: body, text: body, attachment_path: "C:/private/image.png" },
      { type },
    );
    assert.ok(result.content.includes(body));
    assert.equal(result.source.type, type);
    assert.equal(result.source.revision, 3);
    assert.equal(result.themeId, "theme-1");
    assert.match(result.content, /現在版.*過去の版を再現するものではありません/);
    assert.match(result.content, /省略・置換: なし/);
    assert.match(result.content, /read-only/);
    assert.ok(!result.content.includes("C:/private"));
    assert.equal(result.contentHash, markdownSignature(result.content));
    assert.equal(result.redacted, false);
  }
});

test("credential, unsafe URL and local path replacements are disclosed, and Markdown remains inert", () => {
  const body = [
    "password=secret-value",
    "C:\\private\\research.txt",
    "/home/me/secret.txt",
    "https://user:pass@example.com/private?token=abc",
    "[run](javascript:alert(1))",
    "<img src=x onerror=alert(1)>",
    "![remote](https://example.com/image.png)",
    "```\n# forged header\n````",
  ].join("\n");
  const result = project({ ...note, body_markdown: body });
  assert.equal(result.redacted, true);
  assert.match(result.content, /省略・置換: あり/);
  for (const secret of [
    "secret-value",
    "research.txt",
    "/home/me",
    "user:pass",
    "token=abc",
    "javascript:",
  ])
    assert.ok(!result.content.includes(secret), secret);
  assert.match(result.content, /`````text\n/);
  assert.ok(result.content.endsWith("\n`````\n"));
  assert.ok(result.content.includes("<img src=x onerror=alert(1)>"));
});

test("hashed paths cannot traverse and remain stable across rename and revision changes", () => {
  const malicious = {
    ...note,
    id: "../../outside](javascript:bad)",
    title: "# forged\n[title](file:///secret)",
  };
  const original = project(malicious);
  const changed = project({ ...malicious, title: "renamed", version: 4, body_markdown: "new" });
  assert.match(original.relativePath, /^Sources\/note-[a-f0-9]{64}\.md$/);
  assert.equal(original.relativePath, changed.relativePath);
  assert.notEqual(original.contentHash, changed.contentHash);
  assert.ok(!original.content.includes("javascript:"));
  assert.ok(!original.content.includes("file:///secret"));
  const plain = project({ ...note, id: "id')(x" });
  assert.match(plain.content, /tasken:\/\/note\/id%27%29%28x/);
  assert.deepEqual(project(), project());
});
