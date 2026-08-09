import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PERSONAL_DEFAULT_THEME_ID,
  buildPersonalDefaultTheme,
  isPersonalDefaultTheme,
  isThemeDeletable,
  planPersonalDefaultTheme,
  resolveThemeId,
  sortThemesWithDefaultFirst,
} from "../src/shared/personalTheme.mjs";
import { normalizeEntity } from "../src/main/repositories/domain.mjs";

test("既定Themeは表示名ではなくsystem kindと安定IDで識別する（#282）", () => {
  assert.equal(isPersonalDefaultTheme({ id: "x", system_kind: "personal_default" }), true);
  assert.equal(isPersonalDefaultTheme({ id: PERSONAL_DEFAULT_THEME_ID }), true);
  // 表示名が同じだけの通常Themeを特別扱いしない。
  assert.equal(isPersonalDefaultTheme({ id: "other", name: "個人業務" }), false);
  assert.equal(isPersonalDefaultTheme(null), false);
});

test("既定Themeは削除・アーカイブできない（#282）", () => {
  assert.equal(isThemeDeletable(buildPersonalDefaultTheme()), false);
  assert.equal(isThemeDeletable({ id: "other", name: "調査" }), true);

  const repositorySource = readFileSync("src/main/repositories/workspaceRepository.mjs", "utf8");
  // 永続化境界でも止める。UIの出し分けだけに頼らない。
  assert.match(repositorySource, /if \(type === "theme" && !isThemeDeletable\(existing\)\) \{/);
  assert.match(repositorySource, /既定Theme「個人業務」は削除できません。/);
});

test("既定Themeは1件だけ用意し、何度実行しても重複しない（#282）", () => {
  // 無ければ作る。
  const empty = planPersonalDefaultTheme([]);
  assert.equal(empty.create?.id, PERSONAL_DEFAULT_THEME_ID);
  assert.equal(empty.create?.system_kind, "personal_default");

  // あれば何もしない（migrationを繰り返しても増えない）。
  const existing = planPersonalDefaultTheme([buildPersonalDefaultTheme()]);
  assert.equal(existing.create, null);
  assert.deepEqual(existing.duplicates, []);

  // 複数できてしまった場合は安定IDを正とし、残りを候補として返す（黙って統合しない）。
  const duplicated = planPersonalDefaultTheme([
    { id: "dup-1", system_kind: "personal_default" },
    buildPersonalDefaultTheme(),
  ]);
  assert.equal(duplicated.create, null);
  assert.deepEqual(duplicated.duplicates.map((theme) => theme.id), ["dup-1"]);
});

test("Theme未設定は既定Themeへ解決し、検索・フィルタの例外を作らない（#282）", () => {
  assert.equal(resolveThemeId(null), PERSONAL_DEFAULT_THEME_ID);
  assert.equal(resolveThemeId(""), PERSONAL_DEFAULT_THEME_ID);
  assert.equal(resolveThemeId("  "), PERSONAL_DEFAULT_THEME_ID);
  assert.equal(resolveThemeId("theme-1"), "theme-1");
});

test("既定Themeだけを先頭へ寄せ、他の並びは変えない（#282）", () => {
  const themes = [
    { id: "b", name: "Taskenの開発" },
    { id: PERSONAL_DEFAULT_THEME_ID, name: "個人業務", system_kind: "personal_default" },
    { id: "a", name: "材料A評価" },
  ];
  // 利用者が見慣れた順序を、既定Themeの都合で並べ替えない。
  assert.deepEqual(sortThemesWithDefaultFirst(themes).map((theme) => theme.id), [PERSONAL_DEFAULT_THEME_ID, "b", "a"]);
});

test("theme.system_kindは既知の値だけを受け付ける（#282）", () => {
  assert.equal(normalizeEntity("theme", { id: "t", name: "調査" }).system_kind, undefined);
  assert.equal(normalizeEntity("theme", buildPersonalDefaultTheme()).system_kind, "personal_default");
  assert.throws(() => normalizeEntity("theme", { id: "t", name: "調査", system_kind: "special" }), /system_kind/);
});

test("既定Themeは常設としてSidebarへ出し、グループ絞り込みでも消さない（#282）", () => {
  const appSource = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
  const shellSource = readFileSync("src/renderer/src/features/workspace/components/shell.tsx", "utf8");
  const cssSource = readFileSync("src/renderer/src/styles/app.css", "utf8");

  assert.match(appSource, /sortThemesWithDefaultFirst\(fullData\.themes\)/);
  assert.match(appSource, /activeGroups\.includes\(theme\.group \|\| ""\) \|\| isPersonalDefaultTheme\(theme\)/);
  // 装飾を強くせず、区切りだけで常設であることを示す。
  assert.match(shellSource, /isDefault \? " is-default-theme" : ""/);
  assert.match(cssSource, /\.theme-nav > button\.is-default-theme \{/);
});

test("起動のたびに既定Themeを確認する（#282）", () => {
  const repositorySource = readFileSync("src/main/repositories/workspaceRepository.mjs", "utf8");
  assert.match(repositorySource, /ensurePersonalDefaultTheme\(\) \{/);
  assert.match(repositorySource, /loadWorkspace\(includeDeleted = false\) \{\s*\n\s*this\.ensurePersonalDefaultTheme\(\);/);
});
