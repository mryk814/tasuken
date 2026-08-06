import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  STORAGE_SOURCE_LABELS,
  THEME_FOLDER_MANIFEST,
  buildThemeFolderManifest,
  resolveStorageLocation,
  safeFolderSegment,
  themeFolderManifestMatches,
} from "../src/shared/storageResolver.mjs";

test("保存先は決まった優先順位で解決し、根拠も返す（#306）", () => {
  // 1. 既存canonical pathが最優先。すでに正本の場所が決まったファイルは動かさない。
  assert.deepEqual(
    resolveStorageLocation({
      canonicalPath: "D:/onedrive/Tasken/Themes/A/Notes/note.md",
      explicitExportRoot: "D:/tmp",
      themeStorageRoot: "D:/theme",
      syncRoot: "D:/sync",
    }),
    { status: "ok", root: "D:/onedrive/Tasken/Themes/A/Notes/note.md", segments: [], source: "canonical" },
  );

  // 2. 明示的なExport先。PDF等は提出先が用途ごとに違うので都度選ばせる。
  assert.deepEqual(
    resolveStorageLocation({ explicitExportRoot: "D:/tmp", themeStorageRoot: "D:/theme", syncRoot: "D:/sync" }),
    { status: "ok", root: "D:/tmp", segments: [], source: "explicit_export" },
  );

  // 3. Theme専用ルート。配下の標準サブフォルダはTaskenが作る。
  assert.deepEqual(
    resolveStorageLocation({ purpose: "notes", themeId: "t1", themeStorageRoot: "D:/theme", syncRoot: "D:/sync" }),
    { status: "ok", root: "D:/theme", segments: ["Notes"], source: "theme_override" },
  );

  // 4. アプリ共通sync root。
  assert.deepEqual(
    resolveStorageLocation({ purpose: "artifacts", themeId: "t1", themeCode: "MAT-A", syncRoot: "D:/sync" }),
    { status: "ok", root: "D:/sync", segments: ["Themes", "MAT-A", "Artifacts"], source: "app_default" },
  );

  // 5. 未設定は保存を保留する。内部データは失わせない。
  assert.deepEqual(resolveStorageLocation({ syncRoot: "" }), { status: "needs_root" });
});

test("Themeなしと既定Themeは案件フォルダを増やさずInboxへまとめる（#282 / #306）", () => {
  assert.deepEqual(
    resolveStorageLocation({ purpose: "artifacts", themeId: null, syncRoot: "D:/sync" }),
    { status: "ok", root: "D:/sync", segments: ["Inbox"], source: "app_default" },
  );
  assert.deepEqual(
    resolveStorageLocation({ purpose: "notes", themeId: null, syncRoot: "D:/sync" }),
    { status: "ok", root: "D:/sync", segments: ["Inbox", "Notes"], source: "app_default" },
  );
  // 既定Theme「個人業務」もThemesフォルダを作らない。
  assert.deepEqual(
    resolveStorageLocation({ purpose: "notes", themeId: "theme-personal-default", isPersonalDefaultTheme: true, syncRoot: "D:/sync" }),
    { status: "ok", root: "D:/sync", segments: ["Inbox", "Notes"], source: "app_default" },
  );
});

test("用途別の保存先設定を増やさず標準サブフォルダで振り分ける（#306）", () => {
  const base = { themeId: "t1", themeCode: "A", syncRoot: "D:/sync" };
  const segmentsFor = (purpose) => resolveStorageLocation({ ...base, purpose }).segments.at(-1);
  assert.equal(segmentsFor("notes"), "Notes");
  assert.equal(segmentsFor("artifacts"), "Artifacts");
  assert.equal(segmentsFor("exports"), "Exports");
  assert.equal(segmentsFor("ai_pack"), "AI Pack");
  assert.equal(segmentsFor("activity"), "Activity");
  // 未知の用途でも保存先を失わない。
  assert.equal(segmentsFor("unknown"), "Artifacts");
});

test("Theme名を変えてもフォルダとの対応を見失わない（#306）", () => {
  const manifest = buildThemeFolderManifest({ themeId: "theme_xxx", displayName: "Client A" });
  assert.deepEqual(manifest, { schema: "tasken-theme-folder/v1", themeId: "theme_xxx", displayName: "Client A" });
  // 対応の判定は表示名ではなくID。
  assert.equal(themeFolderManifestMatches(manifest, "theme_xxx"), true);
  assert.equal(themeFolderManifestMatches(manifest, "other"), false);
  assert.equal(themeFolderManifestMatches({ schema: "other/v1", themeId: "theme_xxx" }, "theme_xxx"), false);
  assert.equal(themeFolderManifestMatches(null, "theme_xxx"), false);

  const serviceSource = readFileSync("src/main/services/workspaceService.ts", "utf8");
  assert.match(serviceSource, /private writeThemeFolderManifest\(/);
  // 既にあれば書き換えない（idempotent）。書けなくても保存自体は止めない。
  assert.match(serviceSource, /if \(fs\.existsSync\(manifestPath\)\) return;/);
  assert.match(serviceSource, /markerは対応を辿るための補助情報。書けなくても保存自体は成立させる。/);
  assert.equal(THEME_FOLDER_MANIFEST, ".tasken-theme.json");
});

test("フォルダ名に使えない文字を落とし、空にならない（#306）", () => {
  assert.equal(safeFolderSegment("Client/A:B*?"), "Client_A_B__");
  assert.equal(safeFolderSegment("   "), "theme");
  assert.equal(safeFolderSegment("", "inbox"), "inbox");
});

test("解決の根拠を画面へ出すラベルがある（#306）", () => {
  for (const source of ["canonical", "explicit_export", "theme_override", "app_default"]) {
    assert.equal(typeof STORAGE_SOURCE_LABELS[source], "string");
  }
});

test("保存先解決の実装を一箇所に集約する（#306）", () => {
  const artifactStorage = readFileSync("src/main/services/artifactStorage.mjs", "utf8");
  // 既存の呼び出し口は薄い層に留め、pathの組み立てを重複させない。
  assert.match(artifactStorage, /import \{ resolveStorageLocation \} from "\.\.\/\.\.\/shared\/storageResolver\.mjs";/);
  assert.match(artifactStorage, /解決の正本は shared\/storageResolver\.mjs/);

  const settingsSource = readFileSync("src/renderer/src/features/workspace/pages/SettingsPage.tsx", "utf8");
  // 用途別の保存先入力を並べず、同期ルート一つに集約していることを文言でも示す。
  assert.match(settingsSource, /<h2>同期ストレージ<\/h2>/);
  assert.match(settingsSource, /<dt>同期ルート<\/dt>/);
  assert.match(settingsSource, /用途ごとの保存先設定は増やしません。/);
});
