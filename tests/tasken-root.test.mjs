import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

import { normalizeCommandQuery, rankCommandEntries } from "../src/shared/commandPalette.mjs";

async function importBundled(relativePath) {
  const result = await build({ entryPoints: [path.resolve(relativePath)], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const rootContract = await importBundled("src/shared/taskenRoot.ts");

test("Tasken Root検索は既存NFKC契約とusage boostを共用する", () => {
  const entries = [
    { id: "task:old", label: "実験計画", category: "Tasks", keywords: ["材料"] },
    { id: "task:recent", label: "実験記録", category: "Tasks", keywords: ["材料"] },
  ];
  assert.equal(normalizeCommandQuery("　材 料　"), "材 料");
  const ranked = rankCommandEntries(entries, "実験", { "task:recent": { count: 12, lastUsedAt: new Date().toISOString() } });
  assert.equal(ranked[0].id, "task:recent");
  assert.deepEqual(rankCommandEntries(entries, "存在しない"), []);
  const duplicates = rankCommandEntries([
    { id: "task:same", usageKey: "task:same", label: "同じ名前", category: "Tasks", keywords: [] },
    { id: "note:same", usageKey: "note:same", label: "同じ名前", category: "Notes / Documents", keywords: [] },
  ], "同じ名前");
  assert.deepEqual(duplicates.map((entry) => entry.usageKey), ["task:same", "note:same"]);
});

test("Action RegistryはEntityごとに一つの非破壊primaryとavailabilityを返す", () => {
  for (const kind of ["command", "task", "note", "theme", "resource", "artifact"]) {
    const primary = rootContract.rootPrimaryAction({ kind, id: "1" });
    assert.ok(primary, `${kind} primary`);
    assert.notEqual(primary.safety, "destructive");
  }
  const active = rootContract.rootActionsForTarget({ kind: "task", id: "1", entity: { id: "1", state: "todo" } });
  const done = rootContract.rootActionsForTarget({ kind: "task", id: "1", entity: { id: "1", state: "done" } });
  assert.equal(active.find((action) => action.id === "complete").available, true);
  assert.equal(active.find((action) => action.id === "reopen").available, false);
  assert.equal(done.find((action) => action.id === "complete").available, false);
  assert.equal(done.find((action) => action.id === "reopen").available, true);
});

test("Global Rootはsingleton Window・toggle hide・hotkey cleanup契約を持つ", () => {
  const controller = readFileSync("src/main/taskenRootController.ts", "utf8");
  const main = readFileSync("src/main/index.ts", "utf8");
  assert.match(controller, /let window: BrowserWindow \| null/);
  assert.match(controller, /window\.isVisible\(\).*hide\(\)/s);
  assert.match(controller, /globalShortcut\.register/);
  assert.match(controller, /globalShortcut\.unregister/);
  assert.match(controller, /getDisplayNearestPoint/);
  assert.match(controller, /try[\s\S]*globalShortcut\.register[\s\S]*catch/);
  assert.match(main, /taskenRootController\?\.destroy\(\)/);
  assert.ok(main.indexOf("DIRECT_SHORTCUT_DEFINITIONS") < main.lastIndexOf("taskenRootController.registerShortcut()"));
});

test("Root mutationはApplication Commandを使い、専用Entity保存経路を持たない", () => {
  const app = readFileSync("src/renderer/src/tasken-root/TaskenRootApp.tsx", "utf8");
  assert.match(app, /workspaceApi\.executeCommand\(envelope\)/);
  assert.match(app, /source: "tasken_root"/);
  assert.match(app, /expectedVersions/);
  assert.doesNotMatch(app, /entities\.save|workspaceApi\.save\(/);
});

test("Action Panelはkeyboardとmouseで到達できdisabled reasonを表示する", () => {
  const app = readFileSync("src/renderer/src/tasken-root/TaskenRootApp.tsx", "utf8");
  assert.match(app, /event\.key\.toLowerCase\(\) === "k"/);
  assert.match(app, /onMouseEnter/);
  assert.match(app, /disabled=\{!availability\.available/);
  assert.match(app, /availability\.reason/);
  assert.match(app, /filter\(\(entity\) => !entity\.deleted_at\)/);
});
