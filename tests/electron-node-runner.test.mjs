import { nodeExecPath } from "./helpers/childProcessNode.mjs";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("Electron Node runner invokes Electron's installer when npm ci has no binary", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "tasken-electron-runner-"));
  const packageDirectory = path.join(root, "node_modules", "electron");
  const installMarker = path.join(root, "installer-ran.txt");
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(
    path.join(packageDirectory, "install.js"),
    'require("node:fs").writeFileSync(process.env.TASKEN_ELECTRON_INSTALL_MARKER, "called"); process.exit(23);',
  );

  try {
    const result = spawnSync(
      nodeExecPath,
      [path.resolve("scripts/run-electron-node.mjs"), "-e", "void 0"],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, TASKEN_ELECTRON_INSTALL_MARKER: installMarker },
        windowsHide: true,
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 23, result.stderr);
    assert.equal(readFileSync(installMarker, "utf8"), "called");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("packaging downloads Electron explicitly before building app artifacts", () => {
  const packageManifest = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(packageManifest.scripts.package, /^install-electron &&/);
});

test("試験の実行は一時フォルダーを実行ごとの根へ向け、試験が落ちても終われば根を消す", () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "tasken-electron-runner-temp-"));
  const fixture = mkdtempSync(path.join(os.tmpdir(), "tasken-electron-runner-fixture-"));
  const marker = path.join(fixture, "tmpdir.txt");
  const testFile = path.join(fixture, "leaves-temp.test.mjs");
  writeFileSync(
    testFile,
    `import { mkdtempSync, writeFileSync } from "node:fs";
     import os from "node:os";
     import path from "node:path";
     import test from "node:test";
     test("leaves a folder in temp and fails", () => {
       writeFileSync(${JSON.stringify(marker)}, os.tmpdir());
       const left = mkdtempSync(path.join(os.tmpdir(), "left-"));
       writeFileSync(path.join(left, "f"), "x");
       throw new Error("fails on purpose");
     });`,
  );
  try {
    const result = spawnSync(
      nodeExecPath,
      [path.resolve("scripts/run-electron-node.mjs"), "--test", testFile],
      {
        encoding: "utf8",
        // NODE_TEST_CONTEXT を残すと、内側の --test が外側の試験へ結果を渡して 0 で終わる。
        env: { ...process.env, NODE_TEST_CONTEXT: undefined, TEMP: base, TMP: base, TMPDIR: base },
        windowsHide: true,
      },
    );
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0, "落ちた試験は実行も落とす");
    const root = readFileSync(marker, "utf8");
    assert.equal(path.dirname(root), base);
    assert.match(path.basename(root), /^tasken-testrun-/);
    assert.deepEqual(readdirSync(base), [], "実行の根が残っていない");
  } finally {
    rmSync(base, { recursive: true, force: true });
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("古い実行の根だけを掃き、新しい根とほかのフォルダーは残す", async () => {
  const { sweepStaleTempRoots, TEMP_ROOT_PREFIX } = await import("../scripts/test-temp-root.mjs");
  const base = mkdtempSync(path.join(os.tmpdir(), "tasken-electron-runner-sweep-"));
  try {
    const old = path.join(base, `${TEMP_ROOT_PREFIX}old`);
    const fresh = path.join(base, `${TEMP_ROOT_PREFIX}fresh`);
    const other = path.join(base, "someone-else");
    for (const dir of [old, fresh, other]) mkdirSync(dir);
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    utimesSync(old, twoDaysAgo, twoDaysAgo);
    utimesSync(other, twoDaysAgo, twoDaysAgo);
    assert.deepEqual(sweepStaleTempRoots(base), [old]);
    assert.deepEqual(readdirSync(base).sort(), ["someone-else", `${TEMP_ROOT_PREFIX}fresh`].sort());
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
