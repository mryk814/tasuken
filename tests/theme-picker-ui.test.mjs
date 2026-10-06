import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";

import { PERSONAL_DEFAULT_THEME_ID, themePickerOptions } from "../src/shared/themeRef.mjs";

const common = readFileSync("src/renderer/src/features/workspace/components/common.tsx", "utf8");
const inlineAdd = readFileSync(
  "src/renderer/src/features/workspace/components/InlineAddPanel.tsx",
  "utf8",
);

test("standalone picker preserves DOM and focus for unchanged options but renders changed labels and colors", async () => {
  const bundled = await build({
    entryPoints: ["src/shared/themePickerDom.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  const { createThemePicker } = await import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
  );
  // Only the DOM boundary used by the actual picker; replaceChildren removes focused nodes.
  const doc = { activeElement: null, createElement: () => new Element() };
  class Element {
    children = [];
    className = "";
    dataset = {};
    attributes = {};
    listeners = {};
    style = {
      setProperty: (key, value) => {
        this.style[key] = value;
      },
    };
    setAttribute(key, value) {
      this.attributes[key] = value;
    }
    getAttribute(key) {
      return this.attributes[key];
    }
    addEventListener(key, listener) {
      this.listeners[key] = listener;
    }
    append(...nodes) {
      this.children.push(...nodes);
    }
    contains(node) {
      return this === node || this.children.some((child) => child.contains(node));
    }
    replaceChildren(...nodes) {
      if (this.children.some((child) => child.contains(doc.activeElement)))
        doc.activeElement = null;
      this.children = nodes;
    }
    querySelectorAll(selector) {
      const classes = selector.split(".").filter(Boolean);
      return this.children.flatMap((child) => [
        ...(classes.every((name) => child.className.split(" ").includes(name)) ? [child] : []),
        ...child.querySelectorAll(selector),
      ]);
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
    focus() {
      doc.activeElement = this;
    }
    click() {
      this.listeners.click?.();
    }
  }
  const previousDocument = globalThis.document;
  globalThis.document = doc;
  try {
    const picker = createThemePicker({ label: "Theme", variant: "compact-popover" });
    const options = [{ value: "a", label: "Theme A", kind: "theme", colorToken: "chart-1" }];
    picker.setOptions(options, "a");
    picker.element.querySelector(".theme-picker-trigger").click();
    const trigger = picker.element.querySelector(".theme-picker-trigger");
    const menu = picker.element.querySelector(".theme-picker-menu");
    const option = picker.element.querySelector(".theme-picker-option");
    assert.equal(doc.activeElement, option);
    picker.setOptions(
      options.map((item) => ({ ...item })),
      "a",
    );
    assert.equal(picker.element.querySelector(".theme-picker-trigger"), trigger);
    assert.equal(picker.element.querySelector(".theme-picker-menu"), menu);
    assert.equal(menu.hidden, false);
    assert.equal(doc.activeElement, option);
    const renamedOption = { ...options[0], label: "Renamed" };
    picker.setOptions([renamedOption], "a");
    const renamed = picker.element.querySelector(".theme-picker-trigger");
    assert.notEqual(renamed, trigger);
    assert.equal(renamed.title, "Renamed");
    picker.setOptions([{ ...renamedOption, colorToken: "chart-2" }], "a");
    const recolored = picker.element.querySelector(".theme-picker-trigger");
    assert.notEqual(recolored, renamed);
    assert.equal(recolored.children[0].style["--theme-picker-color"], "var(--color-chart-2)");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("canonical picker exposes personal and explicit none together", () => {
  const options = themePickerOptions(
    [
      { id: PERSONAL_DEFAULT_THEME_ID, name: "個人業務" },
      { id: "theme-a", name: "A" },
    ],
    { allowPersonal: true, allowNone: true },
  );
  assert.deepEqual(options.slice(0, 2), [
    {
      value: PERSONAL_DEFAULT_THEME_ID,
      label: "個人業務",
      kind: "personal",
      colorToken: "chart-6",
    },
    { value: "", label: "Themeなし", kind: "none" },
  ]);
  assert.equal(
    options.some((option) => option.value === "all"),
    false,
    "all is a filter projection, not Themeなし",
  );
});

test("ThemeSelect preserves explicit empty value and only defaults when omitted", () => {
  assert.match(common, /useEffect,\s*useId,\s*useRef,\s*useState/);
  assert.match(common, /themePickerOptions/);
  assert.match(common, /allowNone\?: boolean/);
  assert.match(common, /value !== undefined && value !== null \? value : defaultValue/);
  assert.match(
    common,
    /<input ref=\{hiddenInputRef\} type="hidden" name=\{fieldName\} value=\{selected\}/,
  );
  assert.match(
    common,
    /function choose\(next: string\)[\s\S]*?hiddenInputRef\.current\.value = next/,
  );
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
