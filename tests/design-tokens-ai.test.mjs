// AI の藍は、共通の色と用語表の写し（src/renderer/src/styles/ishou/tokens.css）と同じ値を
// design-standard に持つ。写しは手で直さない決まりなので、片方だけが動いたらここで落とす。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
// 作業ツリーが CRLF でも同じ結果にする（写しの hash は LF の内容で取ってある）。
const read = (relativePath) =>
  readFileSync(path.join(root, relativePath), "utf8").replaceAll("\r\n", "\n");

const AI_TOKENS = ["--color-ai", "--color-ai-strong", "--color-ai-bg", "--color-ai-bd"];
const JSON_KEYS = ["ai", "aiStrong", "aiBg", "aiBd"];

/** 明るい表示の :root、手で切り替える暗い表示、OS に従う暗い表示の三つに分ける。 */
function themeBlocks(css) {
  const mediaStart = css.indexOf("@media (prefers-color-scheme: dark)");
  const manualStart = css.indexOf(':root[data-theme="dark"]');
  assert.ok(mediaStart >= 0 && manualStart >= 0, "暗い表示の定義が二つある");
  const blockFrom = (start) => css.slice(start, css.indexOf("}", start));
  return {
    light: blockFrom(css.indexOf(":root {")),
    darkManual: blockFrom(manualStart),
    darkMedia: blockFrom(css.indexOf(":root:not(", mediaStart)),
  };
}

function aiValues(block, where) {
  return AI_TOKENS.map((token) => {
    const match = block.match(new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})\\b`));
    assert.ok(match, `${where} に ${token} の実値がある`);
    return match[1].toUpperCase();
  });
}

test("design-standard の AI の藍は、共通の色の写しと同じ値", () => {
  const copy = themeBlocks(read("src/renderer/src/styles/ishou/tokens.css"));
  const standard = themeBlocks(read("design-standard/tokens.css"));
  const json = JSON.parse(read("design-standard/tokens.json")).color;
  for (const theme of ["light", "darkManual", "darkMedia"]) {
    const expected = aiValues(copy[theme], `写しの ${theme}`);
    assert.deepEqual(aiValues(standard[theme], `tokens.css の ${theme}`), expected, theme);
    const jsonTheme = json[theme === "light" ? "light" : "dark"];
    assert.deepEqual(
      JSON_KEYS.map((key) => String(jsonTheme[key]).toUpperCase()),
      expected,
      `tokens.json の ${theme}`,
    );
  }
});

test("共通の色の写しは、写した時のまま（手で直していない）", () => {
  const manifest = read("src/renderer/src/styles/ishou/MANIFEST");
  const recorded = manifest.match(/^file\ttokens\.css\t([0-9a-f]{64})$/m);
  assert.ok(recorded, "MANIFEST に tokens.css の hash がある");
  const actual = createHash("sha256")
    .update(read("src/renderer/src/styles/ishou/tokens.css"))
    .digest("hex");
  assert.equal(actual, recorded[1]);
});
