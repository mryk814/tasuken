// Theme folder の発見と準備。もとは theme-ai-pack-publisher.test.mjs の先頭 2 件で、
// AI Pack を外した（#755 束2）後も添付と会話の AI Context が同じ発見を使うので残す。
import assert from "node:assert/strict";
import fs, { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildThemeFolderManifest, THEME_FOLDER_MANIFEST } from "../src/shared/storageResolver.mjs";
import {
  discoverThemeFolderLocation,
  ensureThemeFolderLocation,
} from "../src/main/services/themeFolderLocation.mjs";

const theme = { id: "theme-materials", name: "Materials", code: "MAT" };

function fixture(prefix) {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  return { root, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("Theme ID markerからrename前folderを再発見し、重複markerを拒否する（#295）", () => {
  const item = fixture("tasken-theme-folder-discovery-");
  try {
    const oldFolder = path.join(item.root, "Themes", "OLD");
    fs.mkdirSync(oldFolder, { recursive: true });
    writeFileSync(
      path.join(oldFolder, THEME_FOLDER_MANIFEST),
      `${JSON.stringify(buildThemeFolderManifest({ themeId: theme.id, displayName: "Old" }))}\n`,
    );
    const found = discoverThemeFolderLocation({
      syncRoot: item.root,
      themeId: theme.id,
      themeCode: "NEW",
      displayName: "New",
    });
    assert.equal(found.status, "ok");
    assert.equal(found.themeFolder, oldFolder);
    assert.equal(found.source, "theme_manifest");

    const duplicate = path.join(item.root, "Themes", "DUP");
    fs.mkdirSync(duplicate);
    writeFileSync(
      path.join(duplicate, THEME_FOLDER_MANIFEST),
      `${JSON.stringify(buildThemeFolderManifest({ themeId: theme.id, displayName: "Duplicate" }))}\n`,
    );
    assert.deepEqual(
      discoverThemeFolderLocation({ syncRoot: item.root, themeId: theme.id, themeCode: "NEW" }),
      { status: "identity_conflict", reason: "duplicate_theme_manifest" },
    );
  } finally {
    item.close();
  }
});

test("root unavailableと別Themeのpreferred folderは既存データを変更せず停止する（#295）", () => {
  const item = fixture("tasken-theme-folder-root-");
  try {
    assert.deepEqual(
      discoverThemeFolderLocation({ syncRoot: path.join(item.root, "missing"), themeId: theme.id }),
      { status: "root_unavailable" },
    );
    const preferred = path.join(item.root, "Themes", "MAT");
    fs.mkdirSync(preferred, { recursive: true });
    writeFileSync(
      path.join(preferred, THEME_FOLDER_MANIFEST),
      `${JSON.stringify(buildThemeFolderManifest({ themeId: "theme-other", displayName: "Other" }))}\n`,
    );
    const result = discoverThemeFolderLocation({
      syncRoot: item.root,
      themeId: theme.id,
      themeCode: "MAT",
    });
    assert.equal(result.status, "identity_conflict");
    assert.equal(
      JSON.parse(readFileSync(path.join(preferred, THEME_FOLDER_MANIFEST), "utf8")).themeId,
      "theme-other",
    );
  } finally {
    item.close();
  }
});

test("preferred folderを作るときだけmarkerを書き、既存のmarkerは書き換えない", () => {
  const item = fixture("tasken-theme-folder-ensure-");
  try {
    const location = discoverThemeFolderLocation({
      syncRoot: item.root,
      themeId: theme.id,
      themeCode: theme.code,
      displayName: theme.name,
    });
    assert.equal(location.status, "ok");
    assert.equal(location.createManifest, true);
    const ensured = ensureThemeFolderLocation(location, { operationId: "location" });
    assert.equal(ensured.createManifest, false);
    const markerPath = path.join(item.root, "Themes", "MAT", THEME_FOLDER_MANIFEST);
    assert.equal(JSON.parse(readFileSync(markerPath, "utf8")).themeId, theme.id);
    const again = discoverThemeFolderLocation({ syncRoot: item.root, themeId: theme.id });
    assert.equal(again.status, "ok");
    assert.equal(again.createManifest, false);
    assert.equal(again.themeFolder, path.join(item.root, "Themes", "MAT"));
  } finally {
    item.close();
  }
});
