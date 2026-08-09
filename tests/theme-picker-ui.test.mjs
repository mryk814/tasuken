import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PERSONAL_DEFAULT_THEME_ID,
  themePickerOptions,
} from "../src/shared/themeRef.mjs";

const common = readFileSync("src/renderer/src/features/workspace/components/common.tsx", "utf8");
const inlineAdd = readFileSync("src/renderer/src/features/workspace/components/InlineAddPanel.tsx", "utf8");

test("canonical picker exposes personal and explicit none together", () => {
  const options = themePickerOptions(
    [{ id: PERSONAL_DEFAULT_THEME_ID, name: "個人業務" }, { id: "theme-a", name: "A" }],
    { allowPersonal: true, allowNone: true },
  );
  assert.deepEqual(options.slice(0, 2), [
    { value: PERSONAL_DEFAULT_THEME_ID, label: "個人業務", kind: "personal" },
    { value: "", label: "Themeなし", kind: "none" },
  ]);
  assert.equal(options.some((option) => option.value === "all"), false, "all is a filter projection, not Themeなし");
});

test("ThemeSelect preserves explicit empty value and only defaults when omitted", () => {
  assert.match(common, /useEffect, useId, useRef, useState/);
  assert.match(common, /themePickerOptions/);
  assert.match(common, /allowNone\?: boolean/);
  assert.match(common, /value !== undefined && value !== null \? value : defaultValue/);
  assert.match(common, /<input ref=\{hiddenInputRef\} type="hidden" name=\{fieldName\} value=\{selected\}/);
  assert.match(common, /function choose\(next: string\)[\s\S]*?hiddenInputRef\.current\.value = next/);
  assert.match(common, /export function ThemePickerSelect/);
});

test("major creation and filter surfaces use the shared picker contract", () => {
  assert.match(inlineAdd, /ThemePickerSelect/);
  assert.doesNotMatch(inlineAdd, /<option value="">個人業務/);
  for (const path of [
    "src/renderer/src/features/workspace/pages/TodayPage.tsx",
    "src/renderer/src/features/workspace/pages/TodoPage.tsx",
    "src/renderer/src/features/workspace/pages/WaitingPage.tsx",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /PERSONAL_DEFAULT_THEME_ID/);
    assert.match(source, /InlineAddPanel/);
  }
  for (const path of [
    "src/renderer/src/features/workspace/pages/TodoPage.tsx",
    "src/renderer/src/features/workspace/pages/TimelinePage.tsx",
    "src/renderer/src/features/workspace/pages/KnowledgePage.tsx",
    "src/renderer/src/features/workspace/pages/NotesPage.tsx",
    "src/renderer/src/features/workspace/pages/SketchLibraryPage.tsx",
    "src/renderer/src/features/workspace/pages/ArtifactsPage.tsx",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /ThemePickerSelect/);
    assert.match(source, /allowAll/);
    assert.match(source, /allowNone/);
  }
});
