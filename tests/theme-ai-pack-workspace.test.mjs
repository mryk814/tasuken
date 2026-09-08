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
      buildApi.onResolve({ filter: /^electron$/ }, () => ({
        path: "electron-mock",
        namespace: "electron-mock",
      }));
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
      buildApi.onResolve({ filter: /^adm-zip$/ }, () => ({
        path: "adm-zip-mock",
        namespace: "adm-zip-mock",
      }));
      buildApi.onLoad({ filter: /.*/, namespace: "adm-zip-mock" }, () => ({
        contents:
          "export default class AdmZip { constructor() { throw new Error('adm-zip is not used by Theme AI Pack tests'); } }",
        loader: "js",
      }));
      buildApi.onResolve({ filter: /^better-sqlite3$/ }, () => ({
        path: "better-sqlite3-mock",
        namespace: "better-sqlite3-mock",
      }));
      buildApi.onLoad({ filter: /.*/, namespace: "better-sqlite3-mock" }, () => ({
        contents:
          "export default class Database { constructor() { throw new Error('database path is not used by Theme AI Pack tests'); } }",
        loader: "js",
      }));
      buildApi.onResolve({ filter: /workspaceRepository\.mjs$/ }, () => ({
        path: "workspace-repository-mock",
        namespace: "workspace-repository-mock",
      }));
      buildApi.onLoad({ filter: /.*/, namespace: "workspace-repository-mock" }, () => ({
        contents:
          "export const workspaceEntityTypes = []; export const workspaceSchemaVersion = 1;",
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

function autoConfig(root, overrides = {}) {
  return {
    enabled: true,
    root,
    timezone: "Asia/Tokyo",
    themeId: null,
    fromDate: "2026-09-06",
    includeFullText: true,
    ...overrides,
  };
}

function contextManifest(root) {
  return JSON.parse(
    fs.readFileSync(path.join(root, "Tasken Context/.tasken-context.json"), "utf8"),
  );
}

async function finishAutoQueue(service) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const status = await service.retryDailyContextAuto();
    assert.equal(status.error, null);
    if (status.freshness.pendingCount === 0) return status;
  }
  assert.fail("automatic publication did not drain its bounded test queue");
}

test("自動公開は停止中に公開先へ触れず、初回の各日を1件ずつ永続キューから処理する（#547）", async () => {
  const item = fixture("tasken-auto-queue");
  let reopened;
  try {
    const now = () => "2026-09-08T01:00:00.000Z";
    const service = new WorkspaceService(item.database, item.userDataPath, now);
    item.database.setPreference("aiVisibilityDefault", ["m365"]);
    service.recordWorkLog({
      schemaVersion: 1,
      commandName: "RecordWorkLog",
      commandId: "auto-unchanged-note",
      issuedAt: now(),
      performedDate: "2026-09-06",
      themeId: "theme-pack",
      body: "mtimeを保つ公開本文",
    });
    const missingRoot = path.join(item.userDataPath, "not-created");
    assert.equal(service.getDailyContextAutoStatus().config.enabled, false);
    service.configureDailyContextAuto(autoConfig(missingRoot, { enabled: false }));
    let reads = 0;
    const original = item.database.loadWorkspace.bind(item.database);
    item.database.loadWorkspace = (...args) => {
      reads++;
      return original(...args);
    };
    await service.retryDailyContextAuto();
    assert.equal(reads, 0);
    assert.equal(fs.existsSync(missingRoot), false);
    assert.equal(fs.existsSync(path.join(item.syncRoot, "Tasken Context")), false);
    service.configureDailyContextAuto(autoConfig(item.syncRoot));
    const first = await service.retryDailyContextAuto();
    assert.equal(first.error, null);
    assert.equal(first.freshness.pendingCount, 2);
    assert.deepEqual(Object.keys(contextManifest(item.syncRoot).days), ["2026-09-06"]);
    assert.deepEqual(item.database.getDailyContextAutoState().pendingDates, [
      "2026-09-07",
      "2026-09-08",
    ]);
    reopened = new WorkspaceDatabase(path.join(item.userDataPath, "workspace.sqlite"));
    const resumed = new WorkspaceService(reopened, item.userDataPath, now);
    assert.equal(resumed.getDailyContextAutoStatus().freshness.pendingCount, 2);
    const second = await resumed.retryDailyContextAuto();
    assert.equal(second.freshness.pendingCount, 1);
    assert.deepEqual(Object.keys(contextManifest(item.syncRoot).days), [
      "2026-09-06",
      "2026-09-07",
    ]);
    const complete = await finishAutoQueue(resumed);
    assert.equal(complete.freshness.publishedThrough, "2026-09-08");
    assert.deepEqual(Object.keys(contextManifest(item.syncRoot).days), [
      "2026-09-06",
      "2026-09-07",
      "2026-09-08",
    ]);
    const dayFiles = Object.values(contextManifest(item.syncRoot).days).map((day) =>
      path.join(item.syncRoot, "Tasken Context", day.relativePath),
    );
    const sourceFiles = Object.keys(contextManifest(item.syncRoot).indexFiles).filter((relative) =>
      /^Sources\/(note|capture_entry)-/.test(relative),
    );
    assert.ok(sourceFiles.length > 0);
    dayFiles.push(
      ...sourceFiles.map((relative) => path.join(item.syncRoot, "Tasken Context", relative)),
    );
    for (const file of dayFiles)
      fs.utimesSync(file, new Date("2001-01-01T00:00:00Z"), new Date("2001-01-01T00:00:00Z"));
    const before = dayFiles.map((file) => ({
      content: fs.readFileSync(file, "utf8"),
      mtime: fs.statSync(file).mtimeMs,
    }));
    // Changing the initial range forces a fresh scan, but the already-published days and bodies are unchanged.
    resumed.configureDailyContextAuto(autoConfig(item.syncRoot, { fromDate: "2026-09-07" }));
    await finishAutoQueue(resumed);
    assert.deepEqual(
      dayFiles.map((file) => ({
        content: fs.readFileSync(file, "utf8"),
        mtime: fs.statSync(file).mtimeMs,
      })),
      before,
    );
  } finally {
    reopened?.db.close();
    item.close();
  }
});

test("端末受信の観測だけが変わってもREADMEを更新し日別ファイルは維持する（#547）", async () => {
  const item = fixture("tasken-auto-observation");
  try {
    const service = new WorkspaceService(
      item.database,
      item.userDataPath,
      () => "2026-09-08T01:00:00.000Z",
    );
    service.configureDailyContextAuto(autoConfig(item.syncRoot, { fromDate: "2026-09-08" }));
    await finishAutoQueue(service);
    const day = path.join(item.syncRoot, "Tasken Context/Days/2026-09-08.md");
    const before = { text: fs.readFileSync(day, "utf8"), mtime: fs.statSync(day).mtimeMs };
    item.database.db
      .prepare(
        "INSERT INTO sync_device_cursors(device_id, last_sequence, updated_at) VALUES(?, ?, ?)",
      )
      .run("observation-only-device", 7, "2026-09-08T01:10:00.000Z");
    await finishAutoQueue(service);
    assert.match(
      fs.readFileSync(path.join(item.syncRoot, "Tasken Context/README.md"), "utf8"),
      /observation-only-device.*2026-09-08T01:10:00.000Z.*revision 7/,
    );
    assert.deepEqual(
      { text: fs.readFileSync(day, "utf8"), mtime: fs.statSync(day).mtimeMs },
      before,
    );
  } finally {
    item.close();
  }
});

test("自動公開は初回範囲より古い公開済み本文もprivateへの変更で撤去する（#547）", async () => {
  const item = fixture("tasken-auto-private");
  try {
    item.database.setPreference("aiVisibilityDefault", ["m365"]);
    const service = new WorkspaceService(
      item.database,
      item.userDataPath,
      () => "2026-09-08T01:00:00.000Z",
    );
    service.recordWorkLog({
      schemaVersion: 1,
      commandName: "RecordWorkLog",
      commandId: "auto-private-note",
      issuedAt: "2026-09-08T01:00:00.000Z",
      performedDate: "2026-09-05",
      themeId: "theme-pack",
      body: "auto-old-private-body",
    });
    const plan = service.getDailyContextPreview({
      date: "2026-09-05",
      timezone: "Asia/Tokyo",
      themeId: null,
      includeFullText: true,
    });
    service.publishDailyContext({
      root: item.syncRoot,
      selection: plan.selection,
      generatedAt: plan.generatedAt,
      expectedContentHash: plan.contentHash,
    });
    const bodyPath = path.join(item.syncRoot, "Tasken Context", plan.publicSources[0].relativePath);
    assert.match(fs.readFileSync(bodyPath, "utf8"), /auto-old-private-body/);
    service.configureDailyContextAuto(autoConfig(item.syncRoot, { fromDate: "2026-09-08" }));
    await finishAutoQueue(service);
    const note = item.database.get("note", "auto-private-note");
    item.database.save("note", { ...note, ai_visibility: [] });
    await finishAutoQueue(service);
    assert.equal(fs.existsSync(bodyPath), false);
    for (const relative of fs.readdirSync(path.join(item.syncRoot, "Tasken Context"), {
      recursive: true,
    })) {
      const file = path.join(item.syncRoot, "Tasken Context", relative);
      if (fs.statSync(file).isFile())
        assert.doesNotMatch(fs.readFileSync(file, "utf8"), /auto-old-private-body/);
    }
    assert.equal(item.database.get("note", "auto-private-note").body_markdown, note.body_markdown);
  } finally {
    item.close();
  }
});

test("自動公開の保存先不達を再試行でき、別rootへの手動公開を拒否して設定変更で移行する（#547）", async () => {
  const item = fixture("tasken-auto-folder");
  try {
    const service = new WorkspaceService(
      item.database,
      item.userDataPath,
      () => "2026-09-08T01:00:00.000Z",
    );
    service.configureDailyContextAuto(autoConfig(item.syncRoot, { fromDate: "2026-09-08" }));
    const moved = path.join(item.userDataPath, "disconnected-root");
    fs.renameSync(item.syncRoot, moved);
    const failed = await service.retryDailyContextAuto();
    assert.match(failed.error, /保存先/);
    assert.ok(failed.retryAt);
    assert.equal(fs.existsSync(item.syncRoot), false);
    assert.equal(item.database.getDailyContextAutoState().config.enabled, true);
    fs.renameSync(moved, item.syncRoot);
    await finishAutoQueue(service);
    const oldDay = path.join(item.syncRoot, "Tasken Context/Days/2026-09-08.md");
    const oldContent = fs.readFileSync(oldDay, "utf8");
    const otherRoot = path.join(item.userDataPath, "new-publication-root");
    fs.mkdirSync(otherRoot);
    const plan = service.getDailyContextPreview({
      date: "2026-09-08",
      timezone: "Asia/Tokyo",
      themeId: null,
      includeFullText: true,
    });
    assert.throws(
      () =>
        service.publishDailyContext({
          root: otherRoot,
          selection: plan.selection,
          generatedAt: plan.generatedAt,
          expectedContentHash: plan.contentHash,
        }),
      /自動公開/,
    );
    assert.equal(fs.readFileSync(oldDay, "utf8"), oldContent);
    assert.deepEqual(fs.readdirSync(otherRoot), []);
    service.configureDailyContextAuto(autoConfig(otherRoot, { fromDate: "2026-09-08" }));
    await finishAutoQueue(service);
    assert.ok(fs.existsSync(path.join(otherRoot, "Tasken Context/Days/2026-09-08.md")));
    assert.equal(fs.existsSync(oldDay), false);
    assert.equal(item.database.getPreference("dailyContextPublication").root, otherRoot);
  } finally {
    item.close();
  }
});

test(
  "Windowsのslashと大文字小文字が異なる同一公開先は別rootへの手動公開と判定しない（#547）",
  { skip: process.platform !== "win32" },
  async () => {
    const item = fixture("tasken-auto-root-identity");
    try {
      const service = new WorkspaceService(
        item.database,
        item.userDataPath,
        () => "2026-09-08T01:00:00.000Z",
      );
      service.configureDailyContextAuto(autoConfig(item.syncRoot, { fromDate: "2026-09-08" }));
      await finishAutoQueue(service);
      const alternate = item.syncRoot.replaceAll("\\", "/").toUpperCase();
      const plan = service.getDailyContextPreview({
        date: "2026-09-08",
        timezone: "Asia/Tokyo",
        themeId: null,
        includeFullText: true,
      });
      assert.doesNotThrow(() =>
        service.publishDailyContext({
          root: alternate,
          selection: plan.selection,
          generatedAt: plan.generatedAt,
          expectedContentHash: plan.contentHash,
        }),
      );
      assert.ok(contextManifest(item.syncRoot).days["2026-09-08"]);
      assert.equal(item.database.getPreference("dailyContextPublication").retiring, undefined);
      const lastWrittenAt = service.getDailyContextAutoStatus().freshness.lastLocalWrittenAt;
      assert.ok(lastWrittenAt);
      service.configureDailyContextAuto(autoConfig(alternate, { fromDate: "2026-09-08" }));
      assert.equal(
        service.getDailyContextAutoStatus().freshness.lastLocalWrittenAt,
        lastWrittenAt,
        "same Windows folder must retain its publication freshness when only path spelling changes",
      );
    } finally {
      item.close();
    }
  },
);

test("明示した長文を日別と既存Packから読み、再公開で全公開日のprivate本文と参照を除去する（#546）", () => {
  const item = fixture("tasken-full-body");
  try {
    item.database.setPreference("aiVisibilityDefault", ["m365"]);
    const service = new WorkspaceService(
      item.database,
      item.userDataPath,
      () => "2026-09-06T01:00:00.000Z",
    );
    for (const date of ["2026-09-05", "2026-09-06"])
      service.recordWorkLog({
        schemaVersion: 1,
        commandName: "RecordWorkLog",
        commandId: `full-${date}`,
        issuedAt: "2026-09-06T01:00:00.000Z",
        performedDate: date,
        themeId: "theme-pack",
        body: `unique-private-${date}\n` + "観測した結果。🧪\n".repeat(700),
      });
    const publishDate = (date, includeFullText = true) => {
      const plan = service.getDailyContextPreview({
        date,
        timezone: "Asia/Tokyo",
        themeId: null,
        includeFullText,
      });
      const result = service.publishDailyContext({
        root: item.syncRoot,
        selection: plan.selection,
        generatedAt: plan.generatedAt,
        expectedContentHash: plan.contentHash,
        allowPartial: false,
      });
      return { plan, result };
    };
    const noBody = service.getDailyContextPreview({
      date: "2026-09-05",
      timezone: "Asia/Tokyo",
      themeId: null,
    });
    assert.equal(noBody.publicSources.length, 0);
    const packPreview = service.getThemeAiPackPreview("theme-pack");
    service.publishThemeAiPack({
      themeId: "theme-pack",
      expectedContentHash: packPreview.contentHash,
    });
    const first = publishDate("2026-09-05");
    assert.equal(first.plan.publicSources.length, 1);
    const sourcePath = path.join(
      item.syncRoot,
      "Tasken Context",
      first.plan.publicSources[0].relativePath,
    );
    assert.match(fs.readFileSync(sourcePath, "utf8"), /観測した結果。🧪/);
    assert.ok(fs.readFileSync(sourcePath, "utf8").length > 4000);
    assert.match(first.plan.content, /公開した現在版の本文/);
    const packDirectory = path.join(item.syncRoot, "Themes", "PACK", "AI Pack");
    const overview = fs.readFileSync(path.join(packDirectory, "00 Theme Overview.md"), "utf8");
    const link = overview.match(/明示公開した現在版の本文\]\(([^)]+)\)/)?.[1];
    assert.ok(link);
    const index = path.resolve(packDirectory, decodeURIComponent(link));
    assert.ok(fs.existsSync(index));
    assert.match(fs.readFileSync(index, "utf8"), /note-[a-f0-9]{64}\.md/);
    assert.equal(fs.readdirSync(packDirectory).filter((name) => name.endsWith(".md")).length, 7);
    publishDate("2026-09-06");
    fs.appendFileSync(
      path.join(packDirectory, "01 Current Work.md"),
      "\nunique-private-2026-09-05 external addition\n",
    );
    const note = item.database.get("note", "full-2026-09-05");
    item.database.save("note", { ...note, ai_visibility: [] });
    publishDate("2026-09-06");
    assert.equal(fs.existsSync(sourcePath), false);
    for (const relative of fs.readdirSync(item.syncRoot, { recursive: true })) {
      const file = path.join(item.syncRoot, relative);
      if (fs.statSync(file).isFile() && (file.endsWith(".md") || file.endsWith(".json"))) {
        // Canonical documents remain private local data; only inspect generated publication areas.
        if (
          relative.startsWith("Tasken Context") ||
          relative.includes(`${path.sep}AI Pack${path.sep}`)
        )
          assert.doesNotMatch(fs.readFileSync(file, "utf8"), /unique-private-2026-09-05/);
      }
    }
    publishDate("2026-09-06", false);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(item.syncRoot, "Tasken Context/.tasken-context.json"), "utf8"),
    );
    assert.equal(
      Object.keys(manifest.indexFiles).filter((name) =>
        /^Sources\/(note|capture_entry)-/.test(name),
      ).length,
      0,
    );
    assert.equal(item.database.get("note", "full-2026-09-05").body_markdown, note.body_markdown);
  } finally {
    item.close();
  }
});

test("複数日の更新中断はDBに残り、同じ公開先で再公開が完了するまで解除しない（#546）", () => {
  const item = fixture("tasken-full-body-recovery");
  let reopened;
  try {
    item.database.setPreference("aiVisibilityDefault", ["m365"]);
    const service = new WorkspaceService(item.database, item.userDataPath);
    const publish = (target, date, root = item.syncRoot) => {
      const plan = target.getDailyContextPreview({
        date,
        timezone: "Asia/Tokyo",
        themeId: null,
        includeFullText: true,
      });
      return target.publishDailyContext({
        root,
        selection: plan.selection,
        generatedAt: plan.generatedAt,
        expectedContentHash: plan.contentHash,
      });
    };
    publish(service, "2026-09-05");
    const originalPreview = service.getDailyContextPreview.bind(service);
    service.getDailyContextPreview = (selection, generatedAt) => {
      if (selection.date === "2026-09-05") throw new Error("interrupted between days");
      return originalPreview(selection, generatedAt);
    };
    assert.throws(() => publish(service, "2026-09-06"), /interrupted between days/);
    reopened = new WorkspaceDatabase(path.join(item.userDataPath, "workspace.sqlite"));
    assert.equal(reopened.getPreference("dailyContextPublication").refreshPending, true);
    const recovered = new WorkspaceService(reopened, item.userDataPath);
    assert.equal(
      recovered.getDailyContextPreview({
        date: "2026-09-06",
        timezone: "Asia/Tokyo",
        themeId: null,
      }).recoveryRoot,
      item.syncRoot,
    );
    assert.throws(
      () => publish(recovered, "2026-09-06", path.join(item.userDataPath, "other")),
      /未完了の更新/,
    );
    publish(recovered, "2026-09-06");
    assert.equal(reopened.getPreference("dailyContextPublication").refreshPending, false);
    assert.equal(
      recovered.getDailyContextPreview({
        date: "2026-09-06",
        timezone: "Asia/Tokyo",
        themeId: null,
      }).recoveryRoot,
      undefined,
    );
  } finally {
    reopened?.db.close();
    item.close();
  }
});

test("保存先変更は旧管理本文を撤去し、外部編集による撤去失敗を再起動後も追跡する（#546）", () => {
  const item = fixture("tasken-full-body-root-change");
  let reopened;
  try {
    item.database.setPreference("aiVisibilityDefault", ["m365"]);
    const service = new WorkspaceService(item.database, item.userDataPath);
    service.recordWorkLog({
      schemaVersion: 1,
      commandName: "RecordWorkLog",
      commandId: "root-change-note",
      issuedAt: "2026-09-06T01:00:00.000Z",
      performedDate: "2026-09-06",
      themeId: "theme-pack",
      body: "root-change-private-body\n".repeat(250),
    });
    const publish = (target, root) => {
      const plan = target.getDailyContextPreview({
        date: "2026-09-06",
        timezone: "Asia/Tokyo",
        themeId: null,
        includeFullText: true,
      });
      target.publishDailyContext({
        root,
        selection: plan.selection,
        generatedAt: plan.generatedAt,
        expectedContentHash: plan.contentHash,
      });
      return plan;
    };
    const oldPlan = publish(service, item.syncRoot);
    const bodyPath = path.join(
      item.syncRoot,
      "Tasken Context",
      oldPlan.publicSources[0].relativePath,
    );
    const oldBody = fs.readFileSync(bodyPath, "utf8");
    const newRoot = path.join(item.userDataPath, "new-root");
    fs.mkdirSync(newRoot);
    fs.appendFileSync(bodyPath, "\nexternal edit");
    assert.throws(() => publish(service, newRoot), /外部で変更/);
    assert.match(fs.readFileSync(bodyPath, "utf8"), /external edit/);
    reopened = new WorkspaceDatabase(path.join(item.userDataPath, "workspace.sqlite"));
    assert.deepEqual(reopened.getPreference("dailyContextPublication").retiring, {
      root: item.syncRoot,
      timezone: "Asia/Tokyo",
    });
    assert.equal(reopened.getPreference("dailyContextPublication").refreshPending, true);
    fs.writeFileSync(bodyPath, oldBody);
    const recovered = new WorkspaceService(reopened, item.userDataPath);
    publish(recovered, newRoot);
    assert.equal(fs.existsSync(bodyPath), false);
    assert.equal(reopened.getPreference("dailyContextPublication").retiring, undefined);
    const note = reopened.get("note", "root-change-note");
    reopened.save("note", { ...note, ai_visibility: [] });
    publish(recovered, newRoot);
    for (const root of [item.syncRoot, newRoot]) {
      for (const relative of fs.readdirSync(path.join(root, "Tasken Context"), {
        recursive: true,
      })) {
        const file = path.join(root, "Tasken Context", relative);
        if (fs.statSync(file).isFile())
          assert.doesNotMatch(fs.readFileSync(file, "utf8"), /root-change-private-body/);
      }
    }
    assert.equal(reopened.get("note", "root-change-note").body_markdown, note.body_markdown);
  } finally {
    reopened?.db.close();
    item.close();
  }
});

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

test("本文の改名とTheme移動で現在の索引を更新し、既存Pack保存先不達を未完了にする（#546）", () => {
  const item = fixture("tasken-full-body-move");
  try {
    item.database.setPreference("aiVisibilityDefault", ["m365"]);
    item.database.save("theme", {
      id: "theme-second",
      name: "Second",
      code: "SECOND",
      ai_visibility: ["m365"],
    });
    const service = new WorkspaceService(item.database, item.userDataPath);
    service.recordWorkLog({
      schemaVersion: 1,
      commandName: "RecordWorkLog",
      commandId: "move-note",
      issuedAt: "2026-09-06T01:00:00.000Z",
      performedDate: "2026-09-06",
      themeId: "theme-pack",
      body: "move-source-body",
    });
    const publish = () => {
      const plan = service.getDailyContextPreview({
        date: "2026-09-06",
        timezone: "Asia/Tokyo",
        themeId: null,
        includeFullText: true,
      });
      service.publishDailyContext({
        root: item.syncRoot,
        selection: plan.selection,
        generatedAt: plan.generatedAt,
        expectedContentHash: plan.contentHash,
      });
      return plan;
    };
    const before = publish();
    const source = before.publicSources[0];
    const manifestPath = path.join(item.syncRoot, "Tasken Context/.tasken-context.json");
    const firstManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const oldIndex = Object.keys(firstManifest.indexFiles).find((name) =>
      name.startsWith("Sources/Themes/"),
    );
    const note = item.database.get("note", "move-note");
    item.database.save("note", { ...note, title: "renamed-source", project_id: "theme-second" });
    const after = publish();
    assert.equal(after.publicSources[0].relativePath, source.relativePath);
    assert.equal(after.publicSources[0].themeId, "theme-second");
    assert.match(
      fs.readFileSync(path.join(item.syncRoot, "Tasken Context", source.relativePath), "utf8"),
      /renamed-source/,
    );
    assert.doesNotMatch(
      fs.readFileSync(path.join(item.syncRoot, "Tasken Context", oldIndex), "utf8"),
      /note-[a-f0-9]{64}\.md/,
    );
    const secondManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const newIndex = Object.keys(secondManifest.indexFiles).find(
      (name) => name.startsWith("Sources/Themes/") && name !== oldIndex,
    );
    assert.match(
      fs.readFileSync(path.join(item.syncRoot, "Tasken Context", newIndex), "utf8"),
      /renamed-source/,
    );
    item.database.setPreference("artifactDirectory", path.join(item.userDataPath, "offline"));
    assert.throws(publish, /既存Theme AI Packの保存先/);
    assert.equal(item.database.getPreference("dailyContextPublication").refreshPending, true);
    item.database.setPreference("artifactDirectory", item.syncRoot);
    publish();
    assert.equal(item.database.getPreference("dailyContextPublication").refreshPending, false);
    const packPreview = service.getThemeAiPackPreview("theme-second");
    service.publishThemeAiPack({
      themeId: "theme-second",
      expectedContentHash: packPreview.contentHash,
    });
    item.database.remove("theme", "theme-second");
    publish();
    const packDirectory = path.join(item.syncRoot, "Themes/SECOND/AI Pack");
    for (const file of fs.readdirSync(packDirectory).filter((name) => name.endsWith(".md")))
      assert.doesNotMatch(
        fs.readFileSync(path.join(packDirectory, file), "utf8"),
        /renamed-source|move-source-body/,
      );
    assert.equal(item.database.get("note", "move-note").project_id, null);
    item.database.remove("note", "move-note");
    publish();
    assert.equal(
      fs.existsSync(path.join(item.syncRoot, "Tasken Context", source.relativePath)),
      false,
    );
  } finally {
    item.close();
  }
});

test("PreviewとpublishはMainで同じplanを再構築し、stale previewではwriteしない（#295）", () => {
  const item = fixture("tasken-ai-pack-workspace");
  try {
    const service = new WorkspaceService(
      item.database,
      item.userDataPath,
      () => "2026-08-09T01:00:00.000Z",
    );
    const preview = service.getThemeAiPackPreview("theme-pack");
    assert.equal(preview.state, "missing");
    assert.equal(preview.files.length, 7);
    assert.equal(
      preview.files.some((file) => file.content.includes("公開対象Task")),
      true,
    );

    const stale = service.publishThemeAiPack({
      themeId: "theme-pack",
      expectedContentHash: "stale",
    });
    assert.equal(stale.state, "stale_preview");
    assert.equal(stale.written, false);
    assert.equal(fs.existsSync(path.join(item.syncRoot, "Themes")), false);

    const published = service.publishThemeAiPack({
      themeId: "theme-pack",
      expectedContentHash: preview.contentHash,
    });
    assert.equal(published.state, "current");
    assert.equal(published.written, true);
    const packDirectory = path.join(item.syncRoot, "Themes", "PACK", "AI Pack");
    assert.equal(fs.readdirSync(packDirectory).length, 8);

    const later = new WorkspaceService(
      item.database,
      item.userDataPath,
      () => "2026-08-10T01:00:00.000Z",
    );
    const status = later.getThemeAiPackStatus("theme-pack");
    assert.equal(status.plannedGeneratedAt, "2026-08-10T01:00:00.000Z");
    assert.equal(status.lastPublishedAt, "2026-08-09T01:00:00.000Z");

    later.publishingThemeAiPacks.add("theme-pack");
    assert.equal(
      later.publishThemeAiPack({ themeId: "theme-pack", expectedContentHash: status.contentHash })
        .state,
      "publishing",
    );
    later.publishingThemeAiPacks.delete("theme-pack");

    const currentWork = path.join(packDirectory, "01 Current Work.md");
    fs.appendFileSync(currentWork, "\nexternal change\n");
    assert.equal(later.getThemeAiPackStatus("theme-pack").state, "dirty");

    const previousPack = fs.readFileSync(currentWork, "utf8");
    item.database.setPreference("artifactDirectory", path.join(item.userDataPath, "missing-root"));
    const unavailablePreview = later.getThemeAiPackPreview("theme-pack");
    assert.equal(unavailablePreview.state, "root_unavailable");
    assert.equal(unavailablePreview.retryPending, true);
    const unavailablePublish = later.publishThemeAiPack({
      themeId: "theme-pack",
      expectedContentHash: unavailablePreview.contentHash,
    });
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
    const service = new WorkspaceService(
      item.database,
      item.userDataPath,
      () => "2026-08-09T01:00:00.000Z",
    );
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
