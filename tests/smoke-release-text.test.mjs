import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// Release の時だけ流れる smoke（release:check）は npm run ci に入っていないので、画面の言葉を変えた時に
// 古い文を待ったまま残っても CI では気づけない（#736 の後、v0.1.89 の Windows release が
// 「DebriefのActivity…」を待って落ちた）。smoke が完全一致で待つ文字列が、画面の元（src）か、
// 台本自身が作る架空のデータ（待つ行以外）に実際にあることを、ここで確かめる。
const releaseSmokes = [
  "scripts/activity-electron-smoke.mjs",
  "scripts/sketch-toolbar-smoke.mjs",
  "scripts/live-proposal-electron-smoke.mjs",
];

function sourceTexts(directory) {
  const texts = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) texts.push(...sourceTexts(full));
    else if (/\.(tsx?|mjs|js|html|json)$/.test(entry.name)) texts.push(readFileSync(full, "utf8"));
  }
  return texts;
}

const exactWait =
  /getBy(?:Text|Label)\(\s*"((?:[^"\\]|\\.)+)"\s*,\s*\{[^}]*exact:\s*true|name:\s*"((?:[^"\\]|\\.)+)"\s*,\s*exact:\s*true/g;

test("strings that release-only smokes wait for still exist in the app or the smoke's own fixtures", () => {
  const app = sourceTexts("src").join("\n");
  const missing = [];
  let checked = 0;
  for (const file of releaseSmokes) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const match of line.matchAll(exactWait)) {
        const text = JSON.parse(`"${match[1] ?? match[2]}"`);
        checked += 1;
        const inFixture = lines.some((other, otherIndex) => otherIndex !== index && other.includes(text));
        if (!app.includes(text) && !inFixture) missing.push(`${file}:${index + 1} "${text}"`);
      }
    });
  }
  // 空の走査で通らないように、拾えた数の下限も確かめる。
  assert.ok(checked >= 10, `checked only ${checked} exact waits`);
  assert.deepEqual(
    missing,
    [],
    "release-only smoke waits for text that the app no longer shows. Update the smoke (prefer a stable part of the text) together with the UI wording.",
  );
});
