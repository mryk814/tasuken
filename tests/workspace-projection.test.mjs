import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const { projectWorkspaceData } = await importBundled(
  "src/renderer/src/features/workspace/lib/workspaceProjection.ts",
);

test("workspace projection keeps active repository contexts after reload", () => {
  const data = projectWorkspaceData({
    repository_contexts: [
      { id: "repo-active", label: "active", deleted_at: null },
      { id: "repo-deleted", label: "deleted", deleted_at: "2026-08-09T00:00:00.000Z" },
    ],
  });

  assert.deepEqual(data.repository_contexts.map((context) => context.id), ["repo-active"]);
});

test("workspace projection keeps Agent Session provenance after reload", () => {
  const data = projectWorkspaceData({
    working_copies: [
      { id: "copy-active", repository_context_id: "repo-active", active: true },
      { id: "copy-deleted", repository_context_id: "repo-active", deleted_at: "2026-08-24T00:00:00.000Z" },
    ],
    agent_sessions: [
      { id: "session-active", status: "active", started_at: "2026-08-25T10:00:00+09:00" },
      { id: "session-deleted", status: "completed", deleted_at: "2026-08-24T00:00:00.000Z" },
    ],
  });

  assert.deepEqual(data.working_copies.map((copy) => copy.id), ["copy-active"]);
  assert.deepEqual(data.agent_sessions.map((session) => session.id), ["session-active"]);
});
