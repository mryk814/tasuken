// #755 束2 で外した AI Pack と日別 Context の、前の版の出力を一度だけ片付ける処理。
// 本人の同期先のファイルを消す処理なので、消える物と残る物を一時フォルダーで確かめる。
// 済んだ印を DB に残して二度目は走らないことは、workspace-repository.test.mjs で確かめる。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { THEME_FOLDER_MANIFEST } from "../src/shared/storageResolver.mjs";
import {
  cleanupRetiredOutputs,
  runRetiredOutputCleanupOnce,
} from "../src/main/services/retiredOutputCleanup.mjs";
import {
  AI_PACK_FILES,
  OPERATION_ID,
  fixture,
  write,
  writeAiPack,
  writeDailyContext,
  writeThemeFolder,
} from "./helpers/retired-output-fixture.mjs";

test("AI Pack: 前の版が書いたままの 7 ファイルと manifest はごみ箱へ移し、空のフォルダーを消す", async () => {
  const item = fixture();
  try {
    const syncRoot = path.join(item.root, "Sync");
    const themeFolder = path.join(syncRoot, "Themes", "MAT");
    writeThemeFolder(themeFolder, "theme-a");
    const pack = writeAiPack(themeFolder, "theme-a");

    const summary = await cleanupRetiredOutputs({
      workspaceId: "ws-1",
      artifactDirectory: syncRoot,
      themes: [{ themeId: "theme-a", storageRoot: "" }],
      trash: item.trash,
    });

    assert.equal(summary.trashed, 8);
    assert.equal(summary.kept, 0);
    assert.equal(fs.existsSync(pack), false);
    // Theme folder と marker は添付と会話の AI Context が使うので残る。
    assert.equal(fs.existsSync(path.join(themeFolder, THEME_FOLDER_MANIFEST)), true);
    assert.deepEqual(
      item.trashed.sort(),
      [...AI_PACK_FILES, ".tasken-ai-pack.json"]
        .map((name) => `Sync/Themes/MAT/AI Pack/${name}`)
        .sort(),
    );
  } finally {
    item.close();
  }
});

test("AI Pack: 本人が直したファイル・似た名前・本人の別のファイルは残り、フォルダーも残る", async () => {
  const item = fixture();
  try {
    const themeFolder = path.join(item.root, "ThemeRoot");
    writeThemeFolder(themeFolder, "theme-a");
    const pack = writeAiPack(themeFolder, "theme-a");
    const edited = path.join(pack, "02 Decisions.md");
    fs.appendFileSync(edited, "\n本人の追記\n", "utf8");
    write(path.join(pack, "02 Decisions (1).md"), "同期の道具が作った写し\n");
    write(path.join(pack, "メモ.md"), "本人のメモ\n");

    const summary = await cleanupRetiredOutputs({
      workspaceId: "ws-1",
      themes: [{ themeId: "theme-a", storageRoot: themeFolder }],
      trash: item.trash,
    });

    assert.equal(summary.trashed, 7, "直していない 6 ファイルと manifest");
    assert.equal(summary.kept, 1, "直した 02 Decisions.md");
    assert.equal(fs.existsSync(edited), true);
    assert.equal(fs.existsSync(path.join(pack, "02 Decisions (1).md")), true);
    assert.equal(fs.existsSync(path.join(pack, "メモ.md")), true);
    assert.equal(fs.existsSync(path.join(pack, "00 Theme Overview.md")), false);
    assert.equal(summary.removedDirectories, 0);
  } finally {
    item.close();
  }
});

test("AI Pack: manifest が無い・別の Theme の物・知らない Theme の folder には触らない", async () => {
  const item = fixture();
  try {
    const syncRoot = path.join(item.root, "Sync");
    // manifest が無い：本人が同じ名前のフォルダーを作ったのかもしれない。
    const noManifest = path.join(syncRoot, "Themes", "A");
    writeThemeFolder(noManifest, "theme-a");
    const packA = writeAiPack(noManifest, "theme-a");
    fs.rmSync(path.join(packA, ".tasken-ai-pack.json"));
    // manifest の Theme と folder の marker が違う。
    const mismatch = path.join(syncRoot, "Themes", "B");
    writeThemeFolder(mismatch, "theme-b");
    writeAiPack(mismatch, "theme-other");
    // この Workspace に無い Theme の folder。
    const unknown = path.join(syncRoot, "Themes", "C");
    writeThemeFolder(unknown, "theme-unknown");
    writeAiPack(unknown, "theme-unknown");

    const summary = await cleanupRetiredOutputs({
      workspaceId: "ws-1",
      artifactDirectory: syncRoot,
      themes: [
        { themeId: "theme-a", storageRoot: "" },
        { themeId: "theme-b", storageRoot: "" },
      ],
      trash: item.trash,
    });

    assert.deepEqual(item.trashed, []);
    assert.equal(summary.trashed, 0);
    for (const folder of [noManifest, mismatch, unknown])
      assert.equal(fs.readdirSync(path.join(folder, "AI Pack")).length >= 7, true);
  } finally {
    item.close();
  }
});

test("日別 Context: 前の版が書いたままの物と退避は消え、本人のファイルが残るフォルダーは残る", async () => {
  const item = fixture();
  try {
    const root = path.join(item.root, "Publish");
    const directory = writeDailyContext(root, "ws-1");
    write(path.join(directory, "Days", "2026-10-02.md"), "本人が足した日\n");
    write(path.join(directory, "Weeks", "2026-W40.md"), "# 2026-W40\n本人が直した\n");

    const summary = await cleanupRetiredOutputs({
      workspaceId: "ws-1",
      // 手動の公開と自動公開が同じ保存先を指していても、一度だけ見る。
      dailyContextRoots: [root, `${root}${path.sep}`],
      trash: item.trash,
    });

    // Days 1、索引と本文 6（直した Weeks を除く）、退避 1、manifest 1。
    assert.equal(summary.trashed, 9);
    assert.equal(summary.kept, 1);
    assert.equal(fs.existsSync(path.join(directory, "Days", "2026-10-01.md")), false);
    assert.equal(fs.existsSync(path.join(directory, `.README.md.${OPERATION_ID}.bak`)), false);
    assert.equal(fs.existsSync(path.join(directory, ".tasken-context.json")), false);
    // 本人のファイルが残る Days と Weeks、その親は残る。空になった Months などは消える。
    assert.equal(fs.existsSync(path.join(directory, "Days", "2026-10-02.md")), true);
    assert.equal(fs.existsSync(path.join(directory, "Weeks", "2026-W40.md")), true);
    assert.equal(fs.existsSync(path.join(directory, "Months")), false);
    assert.equal(fs.existsSync(path.join(directory, "Sources")), false);
    assert.equal(fs.existsSync(directory), true);
  } finally {
    item.close();
  }
});

test("日別 Context: 本人のファイルが無ければ Tasken Context ごと消え、別の Workspace の物は残る", async () => {
  const item = fixture();
  try {
    const mine = path.join(item.root, "Mine");
    const other = path.join(item.root, "Other");
    const mineDirectory = writeDailyContext(mine, "ws-1");
    const otherDirectory = writeDailyContext(other, "ws-2");

    await cleanupRetiredOutputs({
      workspaceId: "ws-1",
      dailyContextRoots: [mine, other],
      trash: item.trash,
    });

    assert.equal(fs.existsSync(mineDirectory), false);
    assert.equal(fs.existsSync(mine), true, "保存先そのものは本人のフォルダーなので残る");
    assert.equal(fs.existsSync(path.join(otherDirectory, ".tasken-context.json")), true);
    assert.equal(fs.existsSync(path.join(otherDirectory, "Days", "2026-10-01.md")), true);
  } finally {
    item.close();
  }
});

test("片付けが例外で止まっても起動を止めない", async () => {
  const result = await runRetiredOutputCleanupOnce({
    repository: {
      readRetiredOutputLocations: () => {
        throw Object.assign(new Error("SQLITE_BUSY: C:\\secret\\path"), { code: "SQLITE_BUSY" });
      },
      markRetiredOutputsCleaned: () => assert.fail("済んだ印を残さない"),
    },
    trash: async () => {},
    log: (_level, message) => assert.equal(message.includes("secret"), false),
  });
  assert.equal(result.state, "error");
});
