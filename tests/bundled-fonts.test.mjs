import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const rendererEntries = [
  "index.html",
  "root.html",
  "capture.html",
  "today-mini.html",
  "recording-indicator.html",
  "region-selector.html",
  "memo-sticky.html",
];

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

test("all renderer windows load the bundled font stylesheet without a font CDN", () => {
  for (const entry of rendererEntries) {
    const source = read(`src/renderer/${entry}`);
    assert.match(source, /href="\/src\/styles\/fonts\.css"/, entry);
    assert.doesNotMatch(source, /fonts\.(?:googleapis|gstatic)\.com/, entry);
  }
});

test("font tokens use only bundled families before generic fallbacks", () => {
  const tokens = read("design-standard/tokens.css");
  assert.match(tokens, /--font-base:\s*"Nunito Variable", "Noto Sans JP Variable", system-ui, sans-serif;/);
  assert.match(tokens, /--font-mono:\s*"JetBrains Mono Variable", ui-monospace, monospace;/);
});

test("renderer-owned rich text and canvas surfaces use the bundled families", () => {
  const appCss = read("src/renderer/src/styles/app.css");
  const mermaid = read("src/renderer/src/features/workspace/lib/mermaid.ts");
  const sketch = read("src/renderer/src/features/workspace/lib/sketch.ts");
  assert.doesNotMatch(appCss, /"Yu Gothic UI"|"Meiryo UI"|"Segoe UI"/);
  assert.match(mermaid, /MERMAID_SCREEN_FONT_FAMILY = "Nunito Variable, Noto Sans JP Variable, sans-serif"/);
  assert.match(sketch, /'Nunito Variable', 'Noto Sans JP Variable', sans-serif/);
});

test("font dependencies and packaged OFL licenses stay coupled", () => {
  const packageJson = JSON.parse(read("package.json"));
  const expected = [
    "@fontsource-variable/nunito",
    "@fontsource-variable/noto-sans-jp",
    "@fontsource-variable/jetbrains-mono",
  ];
  const extraResources = packageJson.build.extraResources.map((entry) => entry.from);
  for (const dependency of expected) {
    assert.ok(packageJson.dependencies[dependency], dependency);
    assert.ok(extraResources.includes(`node_modules/${dependency}/LICENSE`), dependency);
  }
  assert.match(read("resources/THIRD_PARTY_NOTICES.md"), /SIL Open Font License 1\.1/);
});
