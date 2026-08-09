import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const contracts = fs.readFileSync("src/shared/ipc/contracts.ts", "utf8");
const registerIpc = fs.readFileSync("src/main/ipc/registerIpc.ts", "utf8");
const preload = fs.readFileSync("src/preload/index.ts", "utf8");
const workspaceApi = fs.readFileSync("src/renderer/src/services/workspaceApi.ts", "utf8");
const workspaceService = fs.readFileSync("src/main/services/workspaceService.ts", "utf8");
const themePage = fs.readFileSync("src/renderer/src/features/workspace/pages/ThemePage.tsx", "utf8");

test("Theme AI Pack IPCはthemeId+expectedContentHashだけでpublishし、安全な通知を解除できる（#295）", () => {
  for (const channel of ["status", "preview", "publish", "open-folder", "changed"]) {
    assert.match(contracts, new RegExp(`theme-ai-pack:${channel}`));
  }
  assert.match(contracts, /interface ThemeAiPackPublishRequest\s*{\s*themeId: string;\s*expectedContentHash: string;/s);
  assert.match(workspaceApi, /publish\(\{ themeId, expectedContentHash \}\)/);
  assert.match(preload, /removeListener\(IPC\.themeAiPackChanged, handler\)/);

  const notificationBlock = registerIpc.slice(
    registerIpc.indexOf("ipcMain.handle(IPC.themeAiPackPublish"),
    registerIpc.indexOf("ipcMain.handle(IPC.themeAiPackOpenFolder"),
  );
  assert.match(notificationBlock, /themeId: result\.themeId/);
  assert.match(notificationBlock, /contentHash: result\.contentHash/);
  assert.doesNotMatch(notificationBlock, /directory\s*:/);
  assert.doesNotMatch(notificationBlock, /files\s*:/);
  assert.doesNotMatch(notificationBlock, /content\s*:/);
});

test("Mainはstale Previewをwrite境界より前で拒否し、UIは主要状態と二重publishを扱う（#295）", () => {
  const staleCheck = workspaceService.indexOf("plan.content_hash !== expectedContentHash");
  const ensureLocation = workspaceService.indexOf("ensureThemeAiPackLocation(location", staleCheck);
  const publishPack = workspaceService.indexOf("publishThemeAiPack({", staleCheck);
  assert.ok(staleCheck > 0 && ensureLocation > staleCheck && publishPack > ensureLocation);

  for (const state of [
    "missing",
    "dirty",
    "current",
    "current_with_warning",
    "stale_preview",
    "publishing",
    "failed_retryable",
    "recovery_required",
    "needs_root",
    "root_unavailable",
    "identity_conflict",
  ]) assert.match(themePage, new RegExp(state));
  assert.match(themePage, /disabled={!aiPack \|\| aiPackLoading \|\| aiPackPublishing}/);
  assert.match(themePage, /aiPackStatusTone\(aiPack\?\.state, aiPackPublishing \|\| aiPackLoading\)/);
  assert.match(themePage, /catch \(error\)[\s\S]*AI Packフォルダを開けませんでした。/);
});
