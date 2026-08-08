import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const viteConfig = readFileSync("electron.vite.config.ts", "utf8");
const standaloneSources = [
  readFileSync("src/renderer/today-mini.html", "utf8"),
  readFileSync("src/renderer/capture.html", "utf8"),
  readFileSync("src/renderer/memo-sticky.html", "utf8"),
];

test("standalone windows receive the shared design tokens at build time", () => {
  assert.match(viteConfig, /readFileSync\(resolve\(__dirname, "design-standard\/tokens\.css"\)/);
  assert.match(viteConfig, /name: "tasken-shared-design-tokens"/);
  assert.match(viteConfig, /data-tasken-design-tokens/);
  assert.match(viteConfig, /ctx\.path\.endsWith\("\/index\.html"\)/);
});

test("standalone windows do not define a second color palette", () => {
  for (const source of standaloneSources) {
    assert.doesNotMatch(source, /--color-(?:bg-top|bg-mid|bg-bottom|panel|glass|paper|paper-edge|theme-extra)/);
    assert.doesNotMatch(source, /:\s*#[0-9A-Fa-f]{3,8}\b/);
    assert.doesNotMatch(source, /rgba?\(\s*\d/);
  }
});
