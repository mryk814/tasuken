import assert from "node:assert/strict";
import fs, { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { build } from "esbuild";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";

async function importWorkspaceService() {
  const outputDirectory = mkdtempSync(path.join(os.tmpdir(), "tasken-ai-pack-service-bundle-"));
  const outputFile = path.join(outputDirectory, "workspaceService.mjs");
  const electronMock = {
    name: "electron-mock",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^electron$/ }, () => ({ path: "electron-mock", namespace: "electron-mock" }));
      buildApi.onLoad({ filter: /.*/, namespace: "electron-mock" }, () => ({
        contents: `
          export const app = { getPath: () => "" };
          export class BrowserWindow {}
          export const clipboard = {};
          export const dialog = {};
          export const nativeImage = {};
          export const shell = { openPath: async (value) => { globalThis.__taskenOpenedPaths.push(value); return ""; } };
        `,
        loader: "js",
      }));
      buildApi.onResolve({ filter: /^adm-zip$/ }, () => ({ path: "adm-zip-mock", namespace: "adm-zip-mock" }));
      buildApi.onLoad({ filter: /.*/, namespace: "adm-zip-mock" }, () => ({
        contents: "export default class AdmZip { constructor() { throw new Error('adm-zip is not used by Theme AI Pack tests'); } }",
        loader: "js",
      }));
      buildApi.onResolve({ filter: /workspaceRepository\.mjs$/ }, () => ({ path: "workspace-repository-mock", namespace: "workspace-repository-mock" }));
      buildApi.onLoad({ filter: /.*/, namespace: "workspace-repository-mock" }, () => ({
        contents: "export const workspaceEntityTypes = []; export const workspaceSchemaVersion = 1;",
        loader: "js",
      }));
    },
  };
  await build({
    entryPoints: [path.resolve("src/main/services/workspaceService.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: outputFile,
    logLevel: "silent",
    plugins: [electronMock],
  });
  return import(pathToFileURL(outputFile).href);
}

const { WorkspaceService } = await importWorkspaceService();

function fixture(prefix) {
  const userDataPath = mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const syncRoot = path.join(userDataPath, "TaskenSync");
  fs.mkdirSync(syncRoot);
  const database = new WorkspaceDatabase(path.join(userDataPath, "workspace.sqlite"));
  database.setPreference("artifactDirectory", syncRoot);
  database.save("theme", {
    id: "theme-pack",
    name: "AI Pack Theme",
    code: "PACK",
    ai_visibility: ["m365"],
    ai_freshness: "current",
    ai_authority: "user_confirmed",
    ai_summary: "公開対象Theme",
    ai_summary_authority: "user_confirmed",
  });
  database.save("task", {
    id: "task-pack",
    title: "公開対象Task",
    description: "M365へ共有する作業",
    project_id: "theme-pack",
    state: "doing",
    ai_visibility: ["m365"],
    ai_freshness: "current",
    ai_authority: "user_confirmed",
    ai_summary: "作業を進める",
    ai_summary_authority: "user_confirmed",
  });
  return {
    userDataPath,
    syncRoot,
    database,
    close() {
      database.db.close();
      fs.rmSync(userDataPath, { recursive: true, force: true });
    },
  };
}

test("PreviewとpublishはMainで同じplanを再構築し、stale previewではwriteしない（#295）", () => {
  const item = fixture("tasken-ai-pack-workspace");
  try {
    const service = new WorkspaceService(item.database, item.userDataPath, () => "2026-08-09T01:00:00.000Z");
    const preview = service.getThemeAiPackPreview("theme-pack");
    assert.equal(preview.state, "missing");
    assert.equal(preview.files.length, 7);
    assert.equal(preview.files.some((file) => file.content.includes("公開対象Task")), true);

    const stale = service.publishThemeAiPack({ themeId: "theme-pack", expectedContentHash: "stale" });
    assert.equal(stale.state, "stale_preview");
    assert.equal(stale.written, false);
    assert.equal(fs.existsSync(path.join(item.syncRoot, "Themes")), false);

    const published = service.publishThemeAiPack({ themeId: "theme-pack", expectedContentHash: preview.contentHash });
    assert.equal(published.state, "current");
    assert.equal(published.written, true);
    const packDirectory = path.join(item.syncRoot, "Themes", "PACK", "AI Pack");
    assert.equal(fs.readdirSync(packDirectory).length, 8);

    const later = new WorkspaceService(item.database, item.userDataPath, () => "2026-08-10T01:00:00.000Z");
    const status = later.getThemeAiPackStatus("theme-pack");
    assert.equal(status.plannedGeneratedAt, "2026-08-10T01:00:00.000Z");
    assert.equal(status.lastPublishedAt, "2026-08-09T01:00:00.000Z");

    later.publishingThemeAiPacks.add("theme-pack");
    assert.equal(later.publishThemeAiPack({ themeId: "theme-pack", expectedContentHash: status.contentHash }).state, "publishing");
    later.publishingThemeAiPacks.delete("theme-pack");

    const currentWork = path.join(packDirectory, "01 Current Work.md");
    fs.appendFileSync(currentWork, "\nexternal change\n");
    assert.equal(later.getThemeAiPackStatus("theme-pack").state, "dirty");

    const previousPack = fs.readFileSync(currentWork, "utf8");
    item.database.setPreference("artifactDirectory", path.join(item.userDataPath, "missing-root"));
    const unavailablePreview = later.getThemeAiPackPreview("theme-pack");
    assert.equal(unavailablePreview.state, "root_unavailable");
    assert.equal(unavailablePreview.retryPending, true);
    const unavailablePublish = later.publishThemeAiPack({ themeId: "theme-pack", expectedContentHash: unavailablePreview.contentHash });
    assert.equal(unavailablePublish.state, "root_unavailable");
    assert.equal(unavailablePublish.written, false);
    assert.equal(fs.readFileSync(currentWork, "utf8"), previousPack);
  } finally {
    item.close();
  }
});

test("folder openはMainでTheme containmentとAI Pack junctionを再検証する（#295）", async () => {
  const item = fixture("tasken-ai-pack-open-folder");
  globalThis.__taskenOpenedPaths = [];
  try {
    const service = new WorkspaceService(item.database, item.userDataPath, () => "2026-08-09T01:00:00.000Z");
    const preview = service.getThemeAiPackPreview("theme-pack");
    service.publishThemeAiPack({ themeId: "theme-pack", expectedContentHash: preview.contentHash });
    const packDirectory = path.join(item.syncRoot, "Themes", "PACK", "AI Pack");
    assert.deepEqual(await service.openThemeAiPackFolder("theme-pack"), { ok: true });
    assert.deepEqual(globalThis.__taskenOpenedPaths, [packDirectory]);

    const realPack = path.join(item.userDataPath, "real-pack");
    fs.renameSync(packDirectory, realPack);
    fs.symlinkSync(realPack, packDirectory, "junction");
    assert.equal(service.getThemeAiPackPreview("theme-pack").canOpenFolder, false);
    const rejected = await service.openThemeAiPackFolder("theme-pack");
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /symlink\/junction/);
    assert.deepEqual(globalThis.__taskenOpenedPaths, [packDirectory]);
  } finally {
    delete globalThis.__taskenOpenedPaths;
    item.close();
  }
});
