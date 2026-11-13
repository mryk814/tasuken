import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// 試験の中の process.execPath は electron.exe で、子を起こすと終了まで数秒〜20秒かかることがある。
// 理由と使い分けは tests/helpers/childProcessNode.mjs の冒頭に書いた。

const testsDirectory = path.resolve("tests");
const helperFile = path.join("tests", "helpers", "childProcessNode.mjs");

function sourceFiles() {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (["helpers", "fixtures"].includes(entry.name)) walk(full);
      } else if (
        entry.name.endsWith(".mjs") &&
        (directory !== testsDirectory || entry.name.endsWith(".test.mjs"))
      ) {
        files.push(full);
      }
    }
  };
  walk(testsDirectory);
  return files;
}

test("process.execPath in tests is either replaced by nodeExecPath or marked as needing Electron's ABI", () => {
  const files = sourceFiles();
  // 空の走査で通らないように、走査した量の下限を確かめる。
  assert.ok(files.length >= 200, `scanned only ${files.length} test files`);

  const unmarked = [];
  for (const file of files) {
    const relative = path.relative(process.cwd(), file);
    // 部品と、この試験自身（検索する文字列を書いている）は対象外。
    if (
      relative === helperFile ||
      relative === path.join("tests", "test-child-process-node.test.mjs")
    )
      continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!line.includes("process.execPath")) return;
      if (line.includes("electron-abi:") || (lines[index - 1] ?? "").includes("electron-abi:")) {
        return;
      }
      unmarked.push(`${relative.replaceAll("\\", "/")}:${index + 1}`);
    });
  }
  assert.deepEqual(
    unmarked,
    [],
    `process.execPath without an "electron-abi:" mark: ${unmarked.join(", ")}. ` +
      "Electron の ABI が要らなければ tests/helpers/childProcessNode.mjs の nodeExecPath を使う。" +
      "要るなら同じ行か直前の行に // electron-abi: <理由> を付ける。",
  );
});
