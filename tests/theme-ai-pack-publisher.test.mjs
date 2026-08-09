import assert from "node:assert/strict";
import fs, { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildThemeFolderManifest, THEME_FOLDER_MANIFEST } from "../src/shared/storageResolver.mjs";
import { buildThemeAiPackPlan } from "../src/shared/themeAiPack.mjs";
import {
  THEME_AI_PACK_MANIFEST,
  THEME_AI_PACK_OPERATION_SCHEMA,
  discoverThemeAiPackLocation,
  ensureThemeAiPackLocation,
  inspectThemeAiPack,
  publishThemeAiPack,
  recoverThemeAiPackOperations,
} from "../src/main/services/themeAiPackPublisher.mjs";

const theme = {
  id: "theme-materials",
  name: "Materials",
  code: "MAT",
  ai_visibility: ["m365"],
  ai_freshness: "current",
  ai_authority: "user_confirmed",
  ai_summary: "材料研究",
  ai_summary_authority: "user_confirmed",
};

function plan(body = "測定する", generatedAt = "2026-08-09T00:00:00.000Z") {
  return buildThemeAiPackPlan({
    theme,
    generatedAt,
    candidates: [{
      type: "task",
      entity: {
        id: "task-1",
        title: "測定",
        description: body,
        project_id: theme.id,
        state: "doing",
        ai_visibility: ["m365"],
        ai_freshness: "current",
        ai_authority: "user_confirmed",
        ai_summary: body,
        ai_summary_authority: "user_confirmed",
      },
    }],
  });
}

function fixture(prefix) {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  const recoveryDirectory = path.join(root, "recovery");
  return { root, recoveryDirectory, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function prepareLocation(root, code = theme.code) {
  const location = discoverThemeAiPackLocation({
    syncRoot: root,
    themeId: theme.id,
    themeCode: code,
    displayName: theme.name,
  });
  assert.equal(location.status, "ok");
  return ensureThemeAiPackLocation(location, { operationId: "location" });
}

function fsWith(overrides) {
  return {
    ...fs,
    mkdirSync: fs.mkdirSync.bind(fs),
    writeFileSync: fs.writeFileSync.bind(fs),
    readFileSync: fs.readFileSync.bind(fs),
    openSync: fs.openSync.bind(fs),
    fsyncSync: fs.fsyncSync.bind(fs),
    closeSync: fs.closeSync.bind(fs),
    existsSync: fs.existsSync.bind(fs),
    unlinkSync: fs.unlinkSync.bind(fs),
    renameSync: fs.renameSync.bind(fs),
    readdirSync: fs.readdirSync.bind(fs),
    statSync: fs.statSync.bind(fs),
    lstatSync: fs.lstatSync.bind(fs),
    rmSync: fs.rmSync.bind(fs),
    ...overrides,
  };
}

function writeOperationPack(directory, packPlan, operationId, phase) {
  fs.mkdirSync(directory, { recursive: true });
  for (const file of packPlan.files) writeFileSync(path.join(directory, file.name), file.content);
  writeFileSync(path.join(directory, THEME_AI_PACK_MANIFEST), `${JSON.stringify({
    ...packPlan.manifest,
    operation: { schema: THEME_AI_PACK_OPERATION_SCHEMA, themeId: theme.id, operationId, phase },
  }, null, 2)}\n`);
}

function writeRecoveryReceipt(recoveryDirectory, location, operationId, phase) {
  fs.mkdirSync(recoveryDirectory, { recursive: true });
  writeFileSync(path.join(recoveryDirectory, `${operationId}.json`), `${JSON.stringify({
    schema: THEME_AI_PACK_OPERATION_SCHEMA,
    themeId: theme.id,
    operationId,
    phase,
    targetDirectory: location.packDirectory,
    stageDirectory: path.join(location.themeFolder, `.AI Pack.${operationId}.staging`),
    backupDirectory: path.join(location.themeFolder, `.AI Pack.${operationId}.backup`),
  }, null, 2)}\n`);
}

test("Theme ID markerからrename前folderを再発見し、重複markerを拒否する（#295）", () => {
  const item = fixture("tasken-ai-pack-discovery-");
  try {
    const oldFolder = path.join(item.root, "Themes", "OLD");
    fs.mkdirSync(oldFolder, { recursive: true });
    writeFileSync(path.join(oldFolder, THEME_FOLDER_MANIFEST), `${JSON.stringify(buildThemeFolderManifest({ themeId: theme.id, displayName: "Old" }))}\n`);
    const found = discoverThemeAiPackLocation({ syncRoot: item.root, themeId: theme.id, themeCode: "NEW", displayName: "New" });
    assert.equal(found.status, "ok");
    assert.equal(found.themeFolder, oldFolder);
    assert.equal(found.source, "theme_manifest");

    const duplicate = path.join(item.root, "Themes", "DUP");
    fs.mkdirSync(duplicate);
    writeFileSync(path.join(duplicate, THEME_FOLDER_MANIFEST), `${JSON.stringify(buildThemeFolderManifest({ themeId: theme.id, displayName: "Duplicate" }))}\n`);
    assert.deepEqual(
      discoverThemeAiPackLocation({ syncRoot: item.root, themeId: theme.id, themeCode: "NEW" }),
      { status: "identity_conflict", dirty: true, retryPending: false, reason: "duplicate_theme_manifest" },
    );
  } finally {
    item.close();
  }
});

test("root unavailableと別Themeのpreferred folderは既存データを変更せず停止する（#295）", () => {
  const item = fixture("tasken-ai-pack-root-");
  try {
    assert.deepEqual(
      discoverThemeAiPackLocation({ syncRoot: path.join(item.root, "missing"), themeId: theme.id }),
      { status: "root_unavailable", dirty: true, retryPending: true },
    );
    const preferred = path.join(item.root, "Themes", "MAT");
    fs.mkdirSync(preferred, { recursive: true });
    writeFileSync(path.join(preferred, THEME_FOLDER_MANIFEST), `${JSON.stringify(buildThemeFolderManifest({ themeId: "theme-other", displayName: "Other" }))}\n`);
    const result = discoverThemeAiPackLocation({ syncRoot: item.root, themeId: theme.id, themeCode: "MAT" });
    assert.equal(result.status, "identity_conflict");
    assert.equal(JSON.parse(readFileSync(path.join(preferred, THEME_FOLDER_MANIFEST), "utf8")).themeId, "theme-other");
  } finally {
    item.close();
  }
});

test("operation ID traversalとAI Pack/stage/backup junctionをwrite前に拒否する（#295）", () => {
  const item = fixture("tasken-ai-pack-boundary-");
  try {
    const location = prepareLocation(item.root);
    let writes = 0;
    const counting = fsWith({
      writeFileSync(targetPath, ...args) {
        writes += 1;
        return fs.writeFileSync(targetPath, ...args);
      },
    });
    assert.throws(
      () => publishThemeAiPack({ plan: plan(), packDirectory: location.packDirectory, recoveryDirectory: item.recoveryDirectory, operationId: "../escape", fileSystem: counting }),
      /operation ID/,
    );
    assert.equal(writes, 0);

    const outside = path.join(item.root, "outside");
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, location.packDirectory, "junction");
    assert.throws(
      () => publishThemeAiPack({ plan: plan(), packDirectory: location.packDirectory, recoveryDirectory: item.recoveryDirectory, operationId: "target-link", fileSystem: counting }),
      /symlink\/junction/,
    );
    assert.equal(writes, 0);
    fs.unlinkSync(location.packDirectory);

    for (const suffix of ["staging", "backup"]) {
      const operationId = `${suffix}-link`;
      const operationDirectory = path.join(location.themeFolder, `.AI Pack.${operationId}.${suffix}`);
      fs.symlinkSync(outside, operationDirectory, "junction");
      assert.throws(
        () => publishThemeAiPack({ plan: plan(), packDirectory: location.packDirectory, recoveryDirectory: item.recoveryDirectory, operationId, fileSystem: counting }),
        /symlink\/junction/,
      );
      assert.equal(writes, 0);
      fs.unlinkSync(operationDirectory);
    }
  } finally {
    item.close();
  }
});

test("fixed 7 Markdown + manifestをstaging swapし、unchangedはmtimeもgeneratedAtも変えない（#295）", () => {
  const item = fixture("tasken-ai-pack-publish-");
  try {
    const location = prepareLocation(item.root);
    const first = publishThemeAiPack({ plan: plan(), packDirectory: location.packDirectory, recoveryDirectory: item.recoveryDirectory, operationId: "first" });
    assert.equal(first.state, "current");
    assert.equal(first.written, true);
    const names = fs.readdirSync(location.packDirectory).sort();
    assert.deepEqual(names, [
      ".tasken-ai-pack.json",
      "00 Theme Overview.md",
      "01 Current Work.md",
      "02 Decisions.md",
      "03 Meetings.md",
      "04 Procedures.md",
      "05 Knowledge.md",
      "06 Activity.md",
    ]);
    const before = new Map(names.map((name) => [name, fs.statSync(path.join(location.packDirectory, name)).mtimeMs]));
    const generatedAt = JSON.parse(readFileSync(path.join(location.packDirectory, THEME_AI_PACK_MANIFEST), "utf8")).generatedAt;
    const second = publishThemeAiPack({ plan: plan("測定する", "2026-08-10T00:00:00.000Z"), packDirectory: location.packDirectory, recoveryDirectory: item.recoveryDirectory, operationId: "second" });
    assert.equal(second.state, "skipped");
    assert.equal(second.written, false);
    assert.equal(JSON.parse(readFileSync(path.join(location.packDirectory, THEME_AI_PACK_MANIFEST), "utf8")).generatedAt, generatedAt);
    assert.deepEqual(new Map(names.map((name) => [name, fs.statSync(path.join(location.packDirectory, name)).mtimeMs])), before);
  } finally {
    item.close();
  }
});

test("manifestが同じでも実Markdown driftを検出して再生成する（#295）", () => {
  const item = fixture("tasken-ai-pack-drift-");
  try {
    const location = prepareLocation(item.root);
    publishThemeAiPack({ plan: plan(), packDirectory: location.packDirectory, recoveryDirectory: item.recoveryDirectory, operationId: "first" });
    writeFileSync(path.join(location.packDirectory, "01 Current Work.md"), "外部変更\n");
    assert.equal(inspectThemeAiPack({ plan: plan(), packDirectory: location.packDirectory }).state, "dirty");
    const repaired = publishThemeAiPack({ plan: plan(), packDirectory: location.packDirectory, recoveryDirectory: item.recoveryDirectory, operationId: "repair" });
    assert.equal(repaired.state, "current");
    assert.match(readFileSync(path.join(location.packDirectory, "01 Current Work.md"), "utf8"), /測定する/);
  } finally {
    item.close();
  }
});

test("staging write failureは旧Packを保ちretryableにする（#295）", () => {
  const item = fixture("tasken-ai-pack-stage-failure-");
  try {
    const location = prepareLocation(item.root);
    publishThemeAiPack({ plan: plan("old"), packDirectory: location.packDirectory, recoveryDirectory: item.recoveryDirectory, operationId: "old" });
    const old = readFileSync(path.join(location.packDirectory, "01 Current Work.md"), "utf8");
    const failing = fsWith({
      writeFileSync(targetPath, ...args) {
        if (String(targetPath).includes("02 Decisions.md")) throw new Error("simulated stage write failure");
        return fs.writeFileSync(targetPath, ...args);
      },
    });
    const result = publishThemeAiPack({ plan: plan("new"), packDirectory: location.packDirectory, recoveryDirectory: item.recoveryDirectory, operationId: "stage-fail", fileSystem: failing });
    assert.equal(result.state, "failed_retryable");
    assert.equal(readFileSync(path.join(location.packDirectory, "01 Current Work.md"), "utf8"), old);
  } finally {
    item.close();
  }
});

test("Windows stage→target rename failureはbackupを復元する（#295）", () => {
  const item = fixture("tasken-ai-pack-rename-failure-");
  try {
    const location = prepareLocation(item.root);
    publishThemeAiPack({ plan: plan("old"), packDirectory: location.packDirectory, recoveryDirectory: item.recoveryDirectory, operationId: "old" });
    const old = readFileSync(path.join(location.packDirectory, "01 Current Work.md"), "utf8");
    const failing = fsWith({
      renameSync(from, to) {
        if (String(from).endsWith(".staging") && path.basename(String(to)) === "AI Pack") throw new Error("simulated Windows rename lock");
        return fs.renameSync(from, to);
      },
    });
    const result = publishThemeAiPack({ plan: plan("new"), packDirectory: location.packDirectory, recoveryDirectory: item.recoveryDirectory, operationId: "rename-fail", fileSystem: failing });
    assert.equal(result.state, "failed_retryable");
    assert.equal(readFileSync(path.join(location.packDirectory, "01 Current Work.md"), "utf8"), old);
  } finally {
    item.close();
  }
});

test("rollbackも失敗したoperationはreceiptを残し、marker不一致なら起動時に触らない（#295）", () => {
  const item = fixture("tasken-ai-pack-recovery-");
  try {
    const location = prepareLocation(item.root);
    publishThemeAiPack({ plan: plan("old"), packDirectory: location.packDirectory, recoveryDirectory: item.recoveryDirectory, operationId: "old" });
    const failing = fsWith({
      renameSync(from, to) {
        if (String(from).endsWith(".staging") && path.basename(String(to)) === "AI Pack") throw new Error("publish rename failed");
        if (String(from).endsWith(".backup") && path.basename(String(to)) === "AI Pack") throw new Error("restore rename failed");
        return fs.renameSync(from, to);
      },
    });
    const result = publishThemeAiPack({ plan: plan("new"), packDirectory: location.packDirectory, recoveryDirectory: item.recoveryDirectory, operationId: "needs-recovery", fileSystem: failing });
    assert.equal(result.state, "recovery_required");
    const receiptFiles = fs.readdirSync(item.recoveryDirectory);
    assert.deepEqual(receiptFiles, ["needs-recovery.json"]);
    const backup = path.join(location.themeFolder, ".AI Pack.needs-recovery.backup");
    const manifestPath = path.join(backup, THEME_AI_PACK_MANIFEST);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.operation.operationId = "tampered";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const recovered = recoverThemeAiPackOperations({ recoveryDirectory: item.recoveryDirectory });
    assert.equal(recovered[0].state, "recovery_required");
    assert.equal(fs.existsSync(backup), true);
    assert.equal(fs.existsSync(path.join(item.recoveryDirectory, "needs-recovery.json")), true);
  } finally {
    item.close();
  }
});

test("正しいoperation markerでもbackup Markdown改ざん時は復旧しない（#295）", () => {
  const item = fixture("tasken-ai-pack-recovery-tamper-");
  try {
    const location = prepareLocation(item.root);
    publishThemeAiPack({ plan: plan("old"), packDirectory: location.packDirectory, recoveryDirectory: item.recoveryDirectory, operationId: "old" });
    const failing = fsWith({
      renameSync(from, to) {
        if (String(from).endsWith(".staging") && path.basename(String(to)) === "AI Pack") throw new Error("publish rename failed");
        if (String(from).endsWith(".backup") && path.basename(String(to)) === "AI Pack") throw new Error("restore rename failed");
        return fs.renameSync(from, to);
      },
    });
    const result = publishThemeAiPack({ plan: plan("new"), packDirectory: location.packDirectory, recoveryDirectory: item.recoveryDirectory, operationId: "tampered-content", fileSystem: failing });
    assert.equal(result.state, "recovery_required");
    const backup = path.join(location.themeFolder, ".AI Pack.tampered-content.backup");
    writeFileSync(path.join(backup, "01 Current Work.md"), "改ざん済み\n");
    const recovered = recoverThemeAiPackOperations({ recoveryDirectory: item.recoveryDirectory });
    assert.equal(recovered[0].state, "recovery_required");
    assert.equal(fs.existsSync(backup), true);
    assert.equal(fs.existsSync(location.packDirectory), false);
  } finally {
    item.close();
  }
});

test("inspectはMarkdown symlink/junctionをfollowせずdirtyにする（#295）", () => {
  const item = fixture("tasken-ai-pack-markdown-link-");
  try {
    const location = prepareLocation(item.root);
    const packPlan = plan();
    publishThemeAiPack({ plan: packPlan, packDirectory: location.packDirectory, recoveryDirectory: item.recoveryDirectory, operationId: "first" });
    const linkedPath = path.join(location.packDirectory, "01 Current Work.md");
    let linkedReads = 0;
    const linked = fsWith({
      lstatSync(targetPath, ...args) {
        if (path.resolve(String(targetPath)) === path.resolve(linkedPath)) return { isSymbolicLink: () => true };
        return fs.lstatSync(targetPath, ...args);
      },
      readFileSync(targetPath, ...args) {
        if (path.resolve(String(targetPath)) === path.resolve(linkedPath)) linkedReads += 1;
        return fs.readFileSync(targetPath, ...args);
      },
    });
    assert.equal(inspectThemeAiPack({ plan: packPlan, packDirectory: location.packDirectory, fileSystem: linked }).state, "dirty");
    assert.equal(linkedReads, 0);
  } finally {
    item.close();
  }
});

test("backup marker後のcrashは旧Packをcurrentへ戻しstagingを回収する（#295）", () => {
  const item = fixture("tasken-ai-pack-crash-backup-pending-");
  try {
    const location = prepareLocation(item.root);
    const oldPlan = plan("old");
    const newPlan = plan("new");
    const operationId = "crash-backup-pending";
    publishThemeAiPack({ plan: oldPlan, packDirectory: location.packDirectory, recoveryDirectory: item.recoveryDirectory, operationId: "old" });
    writeOperationPack(location.packDirectory, oldPlan, operationId, "backup");
    const stage = path.join(location.themeFolder, `.AI Pack.${operationId}.staging`);
    writeOperationPack(stage, newPlan, operationId, "staged");
    writeRecoveryReceipt(item.recoveryDirectory, location, operationId, "backup_pending");

    assert.deepEqual(recoverThemeAiPackOperations({ recoveryDirectory: item.recoveryDirectory }), [{ operationId, state: "restored" }]);
    assert.equal(inspectThemeAiPack({ plan: oldPlan, packDirectory: location.packDirectory }).state, "current");
    assert.equal(fs.existsSync(stage), false);
    assert.equal(fs.existsSync(path.join(item.recoveryDirectory, `${operationId}.json`)), false);
  } finally {
    item.close();
  }
});

test("stage→target後のcrashは新Packのpublishを完了してbackupを回収する（#295）", () => {
  const item = fixture("tasken-ai-pack-crash-swapped-");
  try {
    const location = prepareLocation(item.root);
    const oldPlan = plan("old");
    const newPlan = plan("new");
    const operationId = "crash-swapped";
    publishThemeAiPack({ plan: oldPlan, packDirectory: location.packDirectory, recoveryDirectory: item.recoveryDirectory, operationId: "old" });
    const backup = path.join(location.themeFolder, `.AI Pack.${operationId}.backup`);
    fs.renameSync(location.packDirectory, backup);
    writeOperationPack(backup, oldPlan, operationId, "backup");
    writeOperationPack(location.packDirectory, newPlan, operationId, "staged");
    writeRecoveryReceipt(item.recoveryDirectory, location, operationId, "swapping");

    assert.deepEqual(recoverThemeAiPackOperations({ recoveryDirectory: item.recoveryDirectory }), [{ operationId, state: "published" }]);
    assert.equal(inspectThemeAiPack({ plan: newPlan, packDirectory: location.packDirectory }).state, "current");
    assert.equal(fs.existsSync(backup), false);
    assert.equal(fs.existsSync(path.join(item.recoveryDirectory, `${operationId}.json`)), false);
  } finally {
    item.close();
  }
});

test("publish成功後のbackup cleanup failureはcurrent_with_warningで新Packを維持する（#295）", () => {
  const item = fixture("tasken-ai-pack-cleanup-warning-");
  try {
    const location = prepareLocation(item.root);
    publishThemeAiPack({ plan: plan("old"), packDirectory: location.packDirectory, recoveryDirectory: item.recoveryDirectory, operationId: "old" });
    const failing = fsWith({
      rmSync(targetPath, ...args) {
        if (String(targetPath).endsWith(".backup")) throw new Error("simulated cleanup failure");
        return fs.rmSync(targetPath, ...args);
      },
    });
    const nextPlan = plan("new");
    const result = publishThemeAiPack({ plan: nextPlan, packDirectory: location.packDirectory, recoveryDirectory: item.recoveryDirectory, operationId: "cleanup-warning", fileSystem: failing });
    assert.equal(result.state, "current_with_warning");
    assert.equal(result.written, true);
    assert.equal(inspectThemeAiPack({ plan: nextPlan, packDirectory: location.packDirectory }).state, "current");
  } finally {
    item.close();
  }
});
