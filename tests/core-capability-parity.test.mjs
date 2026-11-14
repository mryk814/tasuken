import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

import { TaskenCoreClient } from "../src/main/mcp/taskenCoreClient.mjs";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import { SharedFolderSyncService } from "../src/main/services/sharedFolderSync.mjs";
import {
  TASKEN_CORE_SOURCE_STATUS_CAPABILITY,
  TASKEN_CORE_WRITE_CAPABILITIES,
  coreWriteProfile,
} from "../src/shared/contracts/core/public.mjs";

/**
 * 私用のWorkspaceはNAS寄せ、仕事のWorkspaceはPC（Desktop）だけ、という切り分けを保つための約束（#688）。
 * NASは「常に起きている」ことを足すだけで、NASにしか無い機能を作らない。
 * 仕事のWorkspaceにNASは無いので、NASだけの機能ができると仕事側が取り残される。
 * そこで、いちばん広く許したNAS replicaのcapabilityが、Desktopのcapabilityに全部含まれることを確かめる。
 */

/** replicaであること自体の読み取り（同期の鮮度）。Desktopには意味が無いので、例外はこれだけ。 */
const REPLICA_ONLY = [TASKEN_CORE_SOURCE_STATUS_CAPABILITY];

const bundleDirectory = fs.mkdtempSync(path.join(process.cwd(), ".tasken-parity-test-"));
after(() => fs.rmSync(bundleDirectory, { recursive: true, force: true }));

async function bundleEntry(relativePath, fileName) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    // Electronの画面のAPIは使わない（capabilityを読むだけ）。使えば例外になる代わりを入れる。
    alias: { electron: path.resolve("src/main/headless/electronUnavailable.ts") },
    external: ["better-sqlite3", "pptxgenjs"],
    write: false,
    logLevel: "silent",
  });
  const bundlePath = path.join(bundleDirectory, fileName);
  fs.writeFileSync(bundlePath, result.outputFiles[0].text);
  return import(pathToFileURL(bundlePath).href);
}

const { TaskenDesktopComposition } = await bundleEntry(
  "src/main/composition/taskenDesktopComposition.ts",
  "desktopComposition.mjs",
);
const { WorkspaceService } = await bundleEntry(
  "src/main/services/workspaceService.ts",
  "workspaceService.mjs",
);
const { startTaskenHeadlessCore } = await bundleEntry(
  "src/main/headless/taskenHeadlessCore.ts",
  "taskenHeadlessCore.mjs",
);

/** index.tsと同じ組み立て（Desktopの合成とAIの書き込み）で、公開するcapability。 */
async function desktopCapabilities(root) {
  const userData = path.join(root, "desktop");
  const db = new WorkspaceDatabase(path.join(userData, "research-desk.sqlite"));
  db.loadWorkspace();
  const composition = new TaskenDesktopComposition({ userDataPath: userData, persistence: db });
  composition.enableAiWrites({
    workspace: new WorkspaceService(db, userData, undefined, undefined, () => {
      throw new Error("no images");
    }),
  });
  await composition.coreRuntime.start();
  try {
    return (await new TaskenCoreClient({ userDataPath: userData }).inspect()).capabilities;
  } finally {
    await composition.coreRuntime.stop();
    db.db.close();
  }
}

/** いちばん広く許したNAS replica（新規作成・開始・直接変更・同期）が公開するcapability。 */
async function widestReplicaCapabilities(root) {
  const shared = path.join(root, "shared");
  const hostUserData = path.join(root, "host");
  fs.mkdirSync(shared, { recursive: true });
  const host = new WorkspaceDatabase(path.join(hostUserData, "research-desk.sqlite"));
  const hostSync = new SharedFolderSyncService(
    host,
    () => {},
    path.join(hostUserData, "attachments", "markdown-images"),
    path.join(hostUserData, "attachments", "capture-images"),
  );
  try {
    host.loadWorkspace();
    await hostSync.configure(shared);
    const replica = await startTaskenHeadlessCore({
      userDataPath: path.join(root, "replica"),
      syncDirectory: shared,
      writeMode: "create-only",
      allowAiTaskStart: true,
      allowAiTaskChange: true,
      env: {},
    });
    try {
      return (await new TaskenCoreClient({ userDataPath: path.join(root, "replica") }).inspect())
        .capabilities;
    } finally {
      await replica.stop();
    }
  } finally {
    await hostSync.stop();
    host.db.close();
  }
}

test("NAS replicaが公開するものは、同期の鮮度を除いて全部Desktopも公開する（#688の切り分けの約束）", async (t) => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tasken-parity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const desktop = await desktopCapabilities(root);
  const replica = await widestReplicaCapabilities(root);

  // Desktopは書き込みを全部持つ（AIの書き込みの組み立てが合成から漏れていない）。
  assert.equal(coreWriteProfile(desktop).profile, "full");
  for (const capability of TASKEN_CORE_WRITE_CAPABILITIES)
    assert.ok(desktop.includes(capability), `Desktopに無い書き込み: ${capability}`);

  // NASだけの機能が無い。
  const replicaOnly = replica.filter(
    (capability) => !desktop.includes(capability) && !REPLICA_ONLY.includes(capability),
  );
  assert.deepEqual(
    replicaOnly,
    [],
    "NASにしか無いcapability。Desktopにも足すか、#688の約束を見直す",
  );
  // 例外は今もreplicaにある（無くなったら例外の一覧から外す）。
  for (const capability of REPLICA_ONLY) assert.ok(replica.includes(capability), capability);
  // 取り消せない直接の書き込みはNASに出さない。
  assert.equal(replica.includes("ai_direct_write"), false);
});
