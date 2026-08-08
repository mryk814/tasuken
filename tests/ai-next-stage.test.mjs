import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { applyMarkdownDiffHunks, diffMarkdownLines } from "../src/renderer/src/features/workspace/lib/markdownEditing.ts";
import { validateArtifactProposal, validateSafeSvg } from "../src/shared/proposalMedia.mjs";
import { validateMcpProposalEnvelope } from "../src/main/mcp/proposalInbox.mjs";
import { validateEntity } from "../src/main/repositories/domain.mjs";

test("Note AI is Main-only for credentials and creates a pending safe proposal", () => {
  const service = readFileSync("src/main/services/aiProviderService.ts", "utf8");
  const dialog = readFileSync("src/renderer/src/features/workspace/components/NoteAiDialog.tsx", "utf8");
  const settings = readFileSync("src/renderer/src/features/workspace/pages/SettingsPage.tsx", "utf8");
  assert.match(service, /safeStorage/);
  assert.match(service, /encryptString/);
  assert.doesNotMatch(dialog, /apiKey|Authorization/);
  assert.match(dialog, /payload_type: "notes"/);
  assert.match(dialog, /status: "pending"/);
  assert.match(settings, /type="password"/);
});

test("Markdown proposal can accept only selected change hunks", () => {
  const before = "a\nold\nsame\nold2\nz";
  const after = "a\nnew\nsame\nnew2\nz";
  assert.equal(applyMarkdownDiffHunks(before, after, [0]), "a\nnew\nsame\nold2\nz");
  assert.equal(applyMarkdownDiffHunks(before, after, [1]), "a\nold\nsame\nnew2\nz");
  assert.ok(diffMarkdownLines(before, after).some((line) => line.kind === "added"));
});

test("SVG proposals allow drawing primitives and reject executable or external content", () => {
  const safe = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect x="1" y="1" width="98" height="48" fill="none" stroke="#000"/></svg>';
  assert.equal(validateSafeSvg(safe), safe);
  assert.throws(() => validateSafeSvg('<svg><script>alert(1)</script></svg>'), /実行可能/);
  assert.throws(() => validateSafeSvg('<svg><path d="M0 0" onclick="alert(1)"/></svg>'), /イベント/);
  assert.throws(() => validateSafeSvg('<svg><image href="https://example.com/a.png"/></svg>'), /外部参照/);
});

test("Artifact proposals accept inline managed content and reject paths", () => {
  assert.deepEqual(validateArtifactProposal({
    title: "Diagram",
    file_name: "diagram.svg",
    media_type: "image/svg+xml",
    content: "<svg><circle cx=\"5\" cy=\"5\" r=\"4\"/></svg>",
  }).fileName, "diagram.svg");
  assert.throws(() => validateArtifactProposal({
    title: "Bad",
    file_name: "../bad.svg",
    media_type: "image/svg+xml",
    content: "<svg></svg>",
  }), /パスを含まない/);
});

test("MCP accepts Sketch and Artifact only as Proposal payloads", () => {
  const base = {
    schema_version: 1,
    id: "12345678-1234-1234-1234-123456789abc",
    created_at: new Date().toISOString(),
    source_app: "test",
  };
  const sketch = validateMcpProposalEnvelope({
    ...base,
    payload_type: "sketches",
    payload: { sketches: [{ action: "create", title: "Map", svg: "<svg><path d=\"M0 0 L10 10\"/></svg>" }] },
  });
  assert.equal(sketch.payload_type, "sketches");
  const artifact = validateMcpProposalEnvelope({
    ...base,
    payload_type: "artifacts",
    payload: { artifacts: [{ action: "create", title: "Memo", file_name: "memo.md", media_type: "text/markdown", content: "# Memo" }] },
  });
  assert.equal(artifact.payload_type, "artifacts");
});

test("proposal history accepts embedded AI, media payloads, and quarantine without applying them", () => {
  assert.doesNotThrow(() => validateEntity("ai_proposal", {
    id: "12345678-1234-1234-1234-123456789abc",
    source: "embedded_llm",
    payload_type: "artifacts",
    payload: { artifacts: [{ action: "create", title: "Memo", file_name: "memo.md", media_type: "text/markdown", content: "# Memo" }] },
    status: "quarantined",
    quarantine_reason: "確認待ち",
  }));
});
