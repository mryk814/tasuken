import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundled = await build({
  stdin: {
    contents: `export { taskReadModelSchema, parseStoredTaskSnapshot } from "./src/shared/contracts/task/model.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { taskReadModelSchema, parseStoredTaskSnapshot } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const snapshot = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "委任したTask",
  state: "todo",
  priority: "normal",
  version: 2,
  source: "manual",
  created_at: "2026-11-01T00:00:00.000Z",
  updated_at: "2026-11-01T00:00:00.000Z",
  deleted_at: null,
  schedule: null,
};

test("更新前の版が保存した receipt の snapshot（ai_visibility つき）でも、委任の再送は読み直せる", () => {
  const old = { ...snapshot, ai_visibility: null };
  // 廃止した欄を strict な schema がそのまま読むと失敗する（再送が500になる）。
  assert.equal(taskReadModelSchema.safeParse(old).success, false);
  const parsed = parseStoredTaskSnapshot(old);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  assert.equal("ai_visibility" in parsed.data, false);
  assert.equal(parseStoredTaskSnapshot(snapshot).success, true);
  assert.equal(parseStoredTaskSnapshot(undefined).success, false);
});
