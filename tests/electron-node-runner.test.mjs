import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
      process.execPath,
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
