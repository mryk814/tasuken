import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

import {
  TASKEN_MOBILE_API_VERSION,
  TASKEN_MOBILE_ENDPOINTS,
  TASKEN_MOBILE_SCHEMA_VERSION,
} from "../src/shared/contracts/mobile/public.mjs";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import { SharedFolderSyncService } from "../src/main/services/sharedFolderSync.mjs";

// NASのheadless nodeが、DesktopのかわりにAndroidのMobile Gatewayを受ける（#688 段階3）。
// Desktop役（host）と共有フォルダを挟んで、ペアリング・同期・書き込みの守りを本物のDBで確かめる。

const bundleDirectory = fs.mkdtempSync(path.join(process.cwd(), ".tasken-headless-mobile-test-"));
after(() => fs.rmSync(bundleDirectory, { recursive: true, force: true }));

await build({
  stdin: {
    contents: `
      export { startTaskenHeadlessCore, TaskenHeadlessCoreError } from "./src/main/headless/taskenHeadlessCore.ts";
      export { runMobilePairCli } from "./src/main/headless/mobilePairCli.ts";
      export { parseTaskenHeadlessCoreArgs } from "./src/main/headless/main.ts";
      export { createImageHeaderDecoder } from "./src/main/services/imageHeaderDecoder.ts";
      export { guardMobileWrites } from "./src/main/gateway/mobile/mobileWriteGuard.ts";
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["better-sqlite3", "adm-zip", "pptxgenjs"],
  alias: { electron: path.resolve("src/main/headless/electronUnavailable.ts") },
  outfile: path.join(bundleDirectory, "headless.mjs"),
  logLevel: "silent",
});
const {
  startTaskenHeadlessCore,
  TaskenHeadlessCoreError,
  runMobilePairCli,
  parseTaskenHeadlessCoreArgs,
  createImageHeaderDecoder,
  guardMobileWrites,
} = await import(pathToFileURL(path.join(bundleDirectory, "headless.mjs")).href);

const API = { apiVersion: TASKEN_MOBILE_API_VERSION, schemaVersion: TASKEN_MOBILE_SCHEMA_VERSION };
const DEVICE_ID = "device-android-test";
// 1x1 の PNG。
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function temporary() {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tasken-headless-mobile-"));
}

/** Desktop役のDBを作り、共有フォルダへ公開する。 */
async function desktop(dir) {
  const hostDirectory = path.join(dir, "desktop");
  fs.mkdirSync(hostDirectory);
  const host = new WorkspaceDatabase(path.join(hostDirectory, "research-desk.sqlite"));
  host.bootstrap({
    themes: [{ id: "theme-personal-default", name: "個人業務", code: "PD" }],
    tasks: [
      {
        id: "task-a",
        title: "Desktopのタスクa",
        state: "todo",
        priority: "normal",
        project_id: "theme-personal-default",
      },
      {
        id: "task-b",
        title: "Desktopのタスクb",
        state: "todo",
        priority: "normal",
        project_id: "theme-personal-default",
      },
    ],
  });
  host.loadWorkspace();
  const sync = new SharedFolderSyncService(
    host,
    () => {},
    path.join(hostDirectory, "attachments", "markdown-images"),
    path.join(hostDirectory, "attachments", "capture-images"),
  );
  const shared = path.join(dir, "shared");
  await sync.configure(shared);
  await sync.syncNow();
  return { host, sync, shared, hostDirectory };
}

/** NAS役のCoreをGateway付きで起動する。 */
async function nas(dir, shared, options = {}) {
  const userDataPath = path.join(dir, "nas");
  const core = await startTaskenHeadlessCore({
    userDataPath,
    syncDirectory: shared,
    mobileGateway: true,
    mobileGatewayPort: 0,
    ...options,
  });
  return { core, userDataPath, base: `http://127.0.0.1:${core.mobileGatewayPort}` };
}

async function cli(userDataPath, ...args) {
  let stdout = "";
  let stderr = "";
  const code = await runMobilePairCli([`--user-data-dir=${userDataPath}`, ...args], {
    stdout: { write: (text) => (stdout += text) },
    stderr: { write: (text) => (stderr += text) },
  });
  return { code, stdout, stderr };
}

async function pair(base, userDataPath, deviceId = DEVICE_ID) {
  const issued = await cli(userDataPath, "pair");
  assert.equal(issued.code, 0, issued.stderr);
  const code = /ペアリングコード: (\d{8})/.exec(issued.stdout)?.[1];
  assert.ok(code, issued.stdout);
  const response = await fetch(`${base}${TASKEN_MOBILE_ENDPOINTS.pair}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...API,
      requestId: "request-pair",
      pairingCode: code,
      clientDeviceId: deviceId,
      deviceLabel: "テスト用のAndroid",
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.data.accessToken;
}

function call(base, token) {
  const headers = { authorization: `Bearer ${token}` };
  return {
    async get(endpoint, query = {}) {
      const url = new URL(base + endpoint);
      for (const [key, value] of Object.entries(
        query === null ? {} : { ...API, requestId: "request-get", ...query },
      ))
        url.searchParams.set(key, String(value));
      const response = await fetch(url, { headers });
      return { status: response.status, body: await response.json() };
    },
    async post(endpoint, body) {
      const response = await fetch(base + endpoint, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}

let sequence = 0;
/** CreateCapture は capture.capturedAt と issuedAt が同じ時刻でなければ 400（schema）。そろえたいときは issuedAt を渡す。 */
function command(name, fields, issuedAt = new Date().toISOString()) {
  sequence += 1;
  return {
    ...API,
    requestId: `request-${sequence}`,
    commandId: `command-headless-mobile-${sequence}`,
    idempotencyKey: `command-headless-mobile-${sequence}`,
    clientDeviceId: DEVICE_ID,
    issuedAt,
    command: { name, ...fields },
  };
}

const createTask = (id, title = "スマホで作ったタスク") =>
  command("CreateTask", {
    task: {
      id,
      title,
      projectId: "theme-personal-default",
      state: "todo",
      priority: "normal",
      requester: "self",
      intendedExecutor: "self",
      todayDate: null,
    },
  });

async function versionOf(api, taskId) {
  const bootstrap = await api.get(TASKEN_MOBILE_ENDPOINTS.bootstrap, { limit: 50 });
  assert.equal(bootstrap.status, 200);
  const found = bootstrap.body.data.tasks.find((task) => task.id === taskId);
  assert.ok(found, `${taskId} がbootstrapに無い`);
  return found.version;
}

async function finish(dir, handles) {
  for (const handle of handles.reverse()) await handle?.();
  fs.rmSync(dir, { recursive: true, force: true });
}

test("Gatewayは既定で無効。有効でも同期へ参加するまでは起動しない", async (t) => {
  const dir = temporary();
  const { host, sync, shared } = await desktop(dir);
  t.after(() => finish(dir, [() => sync.stop(), () => host.db.close()]));
  const off = await startTaskenHeadlessCore({
    userDataPath: path.join(dir, "off"),
    syncDirectory: shared,
  });
  try {
    assert.equal(off.mobileGatewayPort, null);
  } finally {
    await off.stop();
  }
  // 同期の設定が無い空のnodeには、端末を受け付けさせない。
  await assert.rejects(
    startTaskenHeadlessCore({
      userDataPath: path.join(dir, "unjoined"),
      mobileGateway: true,
      mobileGatewayPort: 0,
    }),
    (error) =>
      error instanceof TaskenHeadlessCoreError && error.code === "MOBILE_GATEWAY_REQUIRES_SYNC",
  );
  // Desktopが初期化していない共有フォルダでも、参加できず起動しない（待ち受けない）。
  await assert.rejects(
    startTaskenHeadlessCore({
      userDataPath: path.join(dir, "notready"),
      syncDirectory: path.join(dir, "empty-shared"),
      mobileGateway: true,
      mobileGatewayPort: 0,
    }),
    (error) => error instanceof TaskenHeadlessCoreError && error.code === "SYNC_FOLDER_NOT_READY",
  );
});

test("起動引数と環境変数で有効にできる。READYに出すportの元は既定48177", () => {
  const args = parseTaskenHeadlessCoreArgs(["--mobile-gateway", "--mobile-gateway-port=48999"], {});
  assert.equal(args.mobileGateway, true);
  assert.equal(args.mobileGatewayPort, 48_999);
  const fromEnv = parseTaskenHeadlessCoreArgs([], {
    TASKEN_CORE_MOBILE_GATEWAY: "1",
    TASKEN_CORE_MOBILE_GATEWAY_PORT: "48888",
  });
  assert.equal(fromEnv.mobileGateway, true);
  assert.equal(fromEnv.mobileGatewayPort, 48_888);
  assert.equal(parseTaskenHeadlessCoreArgs([], {}).mobileGateway, undefined);
  assert.throws(() => parseTaskenHeadlessCoreArgs(["--mobile-gateway-port=70000"], {}));
});

test("管理口とCLIでペアリングし、Desktopのデータを読み、作ったTaskがDesktopへ届き、取り消せる", async (t) => {
  const dir = temporary();
  const { host, sync, shared } = await desktop(dir);
  const { core, userDataPath, base } = await nas(dir, shared);
  t.after(() => finish(dir, [() => sync.stop(), () => host.db.close(), () => core.stop()]));
  assert.ok(core.mobileGatewayPort > 0);

  // コードは稼働中のCoreの中にだけある。無関係の呼び出し（token無し・読み取り専用token）は通らない。
  const discovery = JSON.parse(
    fs.readFileSync(path.join(userDataPath, "tasken-core.json"), "utf8"),
  );
  const anonymous = await fetch(`${discovery.origin}/v1/admin/mobile/pairing`, { method: "POST" });
  assert.equal(anonymous.status, 401);

  const token = await pair(base, userDataPath);
  const api = call(base, token);
  const health = await api.get(TASKEN_MOBILE_ENDPOINTS.health, null);
  assert.equal(health.status, 200);
  assert.ok(health.body.data.capabilities.includes("mobile.task.write"));
  assert.equal(
    health.body.data.capabilities.some((capability) => /deleg/i.test(capability)),
    false,
    "委任は広告しない",
  );

  const listed = await cli(userDataPath, "list");
  assert.match(listed.stdout, /device-android-test\tテスト用のAndroid/);
  assert.doesNotMatch(listed.stdout, new RegExp(token));

  // Desktopのデータを読める。
  const bootstrap = await api.get(TASKEN_MOBILE_ENDPOINTS.bootstrap, { limit: 50 });
  assert.equal(bootstrap.status, 200);
  assert.equal(bootstrap.body.meta.serverId, host.workspaceId);
  assert.ok(bootstrap.body.data.tasks.some((task) => task.id === "task-a"));

  // スマホで作ったTaskが、NAS → 共有フォルダ → Desktopへ届く。
  const created = await api.post(TASKEN_MOBILE_ENDPOINTS.commands, createTask("task-from-phone"));
  assert.equal(created.status, 200, JSON.stringify(created.body));
  await core.syncNow();
  await sync.syncNow();
  assert.equal(host.get("task", "task-from-phone").title, "スマホで作ったタスク");

  // 取り消すと、そのtokenは通らない。
  const revoked = await cli(userDataPath, "revoke", DEVICE_ID);
  assert.equal(revoked.code, 0, revoked.stderr);
  const after = await api.get(TASKEN_MOBILE_ENDPOINTS.bootstrap, { limit: 10 });
  assert.equal(after.status, 401);
});

test("既存Taskの編集は、そのEntityが同期の競合中は503（retryable）で断る。別のEntityと作成は通る", async (t) => {
  const dir = temporary();
  const { host, sync, shared } = await desktop(dir);
  const { core, userDataPath, base } = await nas(dir, shared);
  t.after(() => finish(dir, [() => sync.stop(), () => host.db.close(), () => core.stop()]));
  const api = call(base, await pair(base, userDataPath));

  // NASで task-a を完了し、同期の前にDesktopでも task-a を直す（同じ元から分かれる）。
  const versionA = await versionOf(api, "task-a");
  const completed = await api.post(
    TASKEN_MOBILE_ENDPOINTS.commands,
    command("CompleteTask", { taskId: "task-a", expectedVersion: versionA }),
  );
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  host.save("task", { ...host.get("task", "task-a"), title: "Desktopで直したタスクa" });
  await sync.syncNow();
  await core.syncNow();

  const refused = await api.post(
    TASKEN_MOBILE_ENDPOINTS.commands,
    command("ReopenTask", { taskId: "task-a", expectedVersion: await versionOf(api, "task-a") }),
  );
  assert.equal(refused.status, 503, JSON.stringify(refused.body));
  assert.equal(refused.body.error.code, "upstream_unavailable");
  assert.equal(refused.body.error.retryable, true);
  assert.notEqual(refused.status, 409, "409はAndroidで却下になる");

  // 競合していない別のTaskの編集と、新しいTaskの作成は通る。
  const other = await api.post(
    TASKEN_MOBILE_ENDPOINTS.commands,
    command("CompleteTask", { taskId: "task-b", expectedVersion: await versionOf(api, "task-b") }),
  );
  assert.equal(other.status, 200, JSON.stringify(other.body));
  const created = await api.post(
    TASKEN_MOBILE_ENDPOINTS.commands,
    createTask("task-during-conflict"),
  );
  assert.equal(created.status, 200, JSON.stringify(created.body));
});

test("取り込みが追いついていない間は既存Taskの編集を503で断り、戻れば通す。作成は通る", async (t) => {
  const dir = temporary();
  const { host, sync, shared } = await desktop(dir);
  const { core, userDataPath, base } = await nas(dir, shared);
  t.after(() => finish(dir, [() => sync.stop(), () => host.db.close(), () => core.stop()]));
  const api = call(base, await pair(base, userDataPath));
  const manifest = path.join(shared, "tasken-sync.json");
  const manifestText = fs.readFileSync(manifest, "utf8");

  // 共有フォルダを読めない（同期が失敗する）間。
  fs.rmSync(manifest);
  await core.syncNow().then(
    () => assert.fail("同期は失敗するはず"),
    () => {},
  );
  const version = await versionOf(api, "task-a");
  const refused = await api.post(
    TASKEN_MOBILE_ENDPOINTS.commands,
    command("CompleteTask", { taskId: "task-a", expectedVersion: version }),
  );
  assert.equal(refused.status, 503);
  assert.equal(refused.body.error.retryable, true);
  const created = await api.post(TASKEN_MOBILE_ENDPOINTS.commands, createTask("task-while-behind"));
  assert.equal(created.status, 200, "作成は共有フォルダが読めなくても通る");

  // 戻って取り込みが追いつけば、同じ操作が通る。
  fs.writeFileSync(manifest, manifestText);
  await core.syncNow();
  const accepted = await api.post(
    TASKEN_MOBILE_ENDPOINTS.commands,
    command("CompleteTask", { taskId: "task-a", expectedVersion: version }),
  );
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
});

test("写真つきのCaptureはNASに保存され、差分と写真が共有フォルダを通ってDesktopに届く", async (t) => {
  const dir = temporary();
  const { host, sync, shared, hostDirectory } = await desktop(dir);
  const { core, userDataPath, base } = await nas(dir, shared);
  t.after(() => finish(dir, [() => sync.stop(), () => host.db.close(), () => core.stop()]));
  const api = call(base, await pair(base, userDataPath));
  const capturedAt = new Date().toISOString();
  const saved = await api.post(
    TASKEN_MOBILE_ENDPOINTS.commands,
    command(
      "CreateCapture",
      {
        capture: {
          id: "capture-with-photo",
          text: "写真つきのメモ",
          projectId: null,
          capturedAt,
          images: [
            {
              reference_id: "photo-1",
              file_name: "photo.png",
              media_type: "image/png",
              data_base64: PNG_BASE64,
            },
          ],
        },
      },
      capturedAt,
    ),
  );
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const stored = fs.readdirSync(path.join(userDataPath, "attachments", "capture-images"));
  assert.equal(stored.length, 1, `写真はDesktopと同じ場所に保存される: ${stored}`);

  await core.syncNow();
  await sync.syncNow();
  const received = host.get("capture_entry", "capture-with-photo");
  assert.equal(received.images.length, 1);
  assert.equal(received.images[0].file_name, stored[0]);
  assert.ok(
    fs.existsSync(path.join(hostDirectory, "attachments", "capture-images", stored[0])),
    "写真の実体もDesktopへ届く",
  );

  // 画像として読めないものは、保存せずに断る。
  const broken = await api.post(
    TASKEN_MOBILE_ENDPOINTS.commands,
    command(
      "CreateCapture",
      {
        capture: {
          id: "capture-with-broken-photo",
          text: "壊れた写真",
          projectId: null,
          capturedAt,
          images: [
            {
              reference_id: "photo-1",
              file_name: "photo.png",
              media_type: "image/png",
              data_base64: Buffer.from("not an image").toString("base64"),
            },
          ],
        },
      },
      capturedAt,
    ),
  );
  // 時刻は1件目と同じ（そろえてある）ので、400の理由は寸法の検査だけ。
  assert.equal(broken.status, 400);
  assert.equal(broken.body.error.code, "validation_failed");
  const images = fs.readdirSync(path.join(userDataPath, "attachments", "capture-images"));
  assert.deepEqual(
    images.filter((name) => !name.endsWith(".sync-origin.json")),
    stored,
  );
});

test("委任はこのnodeではできない: capability_unavailable（入力の誤りではない）", async (t) => {
  const dir = temporary();
  const { host, sync, shared } = await desktop(dir);
  const { core, userDataPath, base } = await nas(dir, shared);
  t.after(() => finish(dir, [() => sync.stop(), () => host.db.close(), () => core.stop()]));
  const api = call(base, await pair(base, userDataPath));
  const response = await api.post(TASKEN_MOBILE_ENDPOINTS.taskDelegations, {
    ...API,
    requestId: "request-delegate",
    commandId: "command-delegate",
    taskId: "task-a",
    expectedTaskVersion: await versionOf(api, "task-a"),
    agent: "hermes",
    contextFingerprint: `sha256:${"a".repeat(64)}`,
    issuedAt: new Date().toISOString(),
    actorId: DEVICE_ID,
  });
  assert.equal(response.body.error.code, "capability_unavailable");
  assert.notEqual(response.body.error.code, "validation_failed");
});

test("AI整理はTASKEN_CAPTURE_LLM_*が無ければcapability_unavailable", async (t) => {
  const dir = temporary();
  const { host, sync, shared } = await desktop(dir);
  const { core, userDataPath, base } = await nas(dir, shared, {
    env: { ...process.env, TASKEN_CAPTURE_LLM_PROVIDER: "" },
  });
  t.after(() => finish(dir, [() => sync.stop(), () => host.db.close(), () => core.stop()]));
  const api = call(base, await pair(base, userDataPath));
  const response = await api.post(TASKEN_MOBILE_ENDPOINTS.captureOrganization, {
    text: "明日までに資料を直す",
    capturedAt: new Date().toISOString(),
    timeZone: "Asia/Tokyo",
    themeId: null,
    maxTasks: 1,
  });
  assert.notEqual(response.status, 200);
  assert.equal(response.body.error.code, "capability_unavailable");
});

test("DBが公開済みの状態より古いと、同期を止め、端末の書き込みは作成も断る", async (t) => {
  const dir = temporary();
  const { host, sync, shared } = await desktop(dir);
  const { core, userDataPath, base } = await nas(dir, shared);
  const api = call(base, await pair(base, userDataPath));
  t.after(() => finish(dir, [() => sync.stop(), () => host.db.close(), () => core.stop()]));
  const ok = await api.post(TASKEN_MOBILE_ENDPOINTS.commands, createTask("task-before-rollback"));
  assert.equal(ok.status, 200);
  await core.syncNow();

  // NASの公開済みの連番より先の差分が共有フォルダにある状況（古い写しへ戻した）を作る。
  const deviceId = fs
    .readdirSync(path.join(shared, "devices"))
    .find((name) => name !== host.deviceId);
  assert.ok(deviceId);
  const directory = path.join(shared, "devices", deviceId);
  const last = fs
    .readdirSync(directory)
    .filter((name) => /^\d{12}-/.test(name))
    .sort()
    .at(-1);
  const future = `${String(Number(last.slice(0, 12)) + 5).padStart(12, "0")}-${"f".repeat(8)}-0000-4000-8000-${"0".repeat(12)}.json`;
  fs.copyFileSync(path.join(directory, last), path.join(directory, future));
  const before = fs.readdirSync(directory).sort();
  await core.syncNow().then(
    () => assert.fail("同期は止まるはず"),
    (error) => assert.equal(error.code, "SYNC_SEQUENCE_ROLLBACK"),
  );
  assert.deepEqual(fs.readdirSync(directory).sort(), before, "連番を使い回した差分は書かない");

  const refused = await api.post(
    TASKEN_MOBILE_ENDPOINTS.commands,
    createTask("task-after-rollback"),
  );
  assert.equal(refused.status, 503);
  assert.equal(refused.body.error.retryable, true);
  // 読み取りは続けられる。
  assert.equal((await api.get(TASKEN_MOBILE_ENDPOINTS.bootstrap, { limit: 10 })).status, 200);
});

test("画像の寸法検査: PNGとJPEGのヘッダーを読み、形式の不一致や途中で切れたものは断る", () => {
  const decode = createImageHeaderDecoder();
  const png = Buffer.from(PNG_BASE64, "base64");
  assert.deepEqual(decode(png, "image/png"), { width: 1, height: 1 });
  assert.equal(decode(png, "image/jpeg"), null, "宣言と中身が違う");
  assert.equal(decode(png.subarray(0, png.length - 4), "image/png"), null, "IENDまで届いていない");
  // SOI, SOF0（高さ2・幅3）, EOI
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03]),
    Buffer.alloc(9, 0x11),
    Buffer.from([0xff, 0xd9]),
  ]);
  assert.deepEqual(decode(jpeg, "image/jpeg"), { width: 3, height: 2 });
  assert.equal(decode(jpeg.subarray(0, jpeg.length - 2), "image/jpeg"), null);
  assert.equal(decode(Buffer.from("GIF89a"), "image/png"), null);
});

test("写真の保存先の入出力が失敗したら、400（却下）ではなく503（retryable）で返し、ファイルも記録も残さない", async (t) => {
  const dir = temporary();
  const { host, sync, shared } = await desktop(dir);
  const { core, userDataPath, base } = await nas(dir, shared);
  t.after(() => finish(dir, [() => sync.stop(), () => host.db.close(), () => core.stop()]));
  const api = call(base, await pair(base, userDataPath));
  const at = new Date().toISOString();
  const request = () =>
    command(
      "CreateCapture",
      {
        capture: {
          id: "capture-io-failure",
          text: "保存先が壊れている間の写真",
          projectId: null,
          capturedAt: at,
          images: [
            {
              reference_id: "photo-1",
              file_name: "photo.png",
              media_type: "image/png",
              data_base64: PNG_BASE64,
            },
          ],
        },
      },
      at,
    );
  // 保存先のフォルダの場所に、ふつうのファイルを置いて、mkdir が失敗するようにする（実際のI/Oの失敗）。
  const photos = path.join(userDataPath, "attachments", "capture-images");
  fs.rmSync(photos, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(photos), { recursive: true });
  fs.writeFileSync(photos, "blocked");
  const failed = await api.post(TASKEN_MOBILE_ENDPOINTS.commands, request());
  assert.equal(failed.status, 503, JSON.stringify(failed.body));
  assert.equal(failed.body.error.retryable, true);
  assert.equal(fs.readFileSync(photos, "utf8"), "blocked");

  // 直れば、同じ要求（再送）がそのまま通り、記録は一つだけ。
  fs.rmSync(photos);
  const retried = await api.post(TASKEN_MOBILE_ENDPOINTS.commands, request());
  assert.equal(retried.status, 200, JSON.stringify(retried.body));
  await core.syncNow();
  await sync.syncNow();
  assert.equal(host.get("capture_entry", "capture-io-failure").images.length, 1);
});

test("続けること・手入れの記録は、本体（habit・maintenance）を上書きするので既存Entityの書き換えとして守る", () => {
  const intents = [];
  const ok = () => ({ ok: true });
  const core = guardMobileWrites(
    {
      executeRoutineAction: ok,
      executeFeedAction: ok,
      executeTaskCommand: ok,
      executeCaptureCommand: ok,
      decideTaskWorkProposal: ok,
      delegateTaskToAgent: ok,
    },
    (intent) => intents.push(intent),
  );
  core.executeRoutineAction({
    action: {
      name: "RecordHabitEntry",
      habitId: "habit-1",
      performedOn: "2026-11-12",
      sequence: 1,
    },
  });
  core.executeRoutineAction({
    action: { name: "RecordMaintenance", maintenanceId: "maint-1", performedOn: "2026-11-12" },
  });
  core.executeFeedAction({ action: { name: "PostFeedReply" } });
  assert.deepEqual(intents, [
    { kind: "modify", targets: [{ type: "habit", id: "habit-1" }] },
    { kind: "modify", targets: [{ type: "maintenance", id: "maint-1" }] },
    { kind: "create", targets: [] },
  ]);
});

test("古い写しへ戻して止まったnodeは、DBを脇へ退けて空のnodeとして参加し直すと、公開済みの記録がすべて戻って続きから動く", async (t) => {
  const dir = temporary();
  const { host, sync, shared } = await desktop(dir);
  const userDataPath = path.join(dir, "nas");
  const databasePath = path.join(userDataPath, "research-desk.sqlite");
  const handles = [() => sync.stop(), () => host.db.close()];
  t.after(() => finish(dir, handles));
  let first = await nas(dir, shared);
  handles.push(() => first.core.stop());
  let api = call(first.base, await pair(first.base, first.userDataPath));

  // 参加直後の状態を古い写しとして取り、その後にスマホで書く（共有フォルダへ公開される）。
  const snapshotPath = path.join(dir, "old-snapshot.sqlite");
  const reader = new WorkspaceDatabase(databasePath);
  await reader.backupTo(snapshotPath);
  const oldDeviceId = reader.deviceId;
  reader.db.close();
  const created = await api.post(
    TASKEN_MOBILE_ENDPOINTS.commands,
    createTask("task-published-before-restore"),
  );
  assert.equal(created.status, 200);
  await first.core.syncNow();
  await first.core.stop();
  handles.pop();

  // 古い写しをDBの場所へ戻す。起動はするが、公開と取り込みは止まる。
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(databasePath + suffix, { force: true });
  fs.copyFileSync(snapshotPath, databasePath);
  first = await nas(dir, shared);
  handles.push(() => first.core.stop());
  await first.core.syncNow().then(
    () => assert.fail("止まるはず"),
    (error) => assert.equal(error.code, "SYNC_SEQUENCE_ROLLBACK"),
  );
  await first.core.stop();
  handles.pop();

  // 抜け出し方: DBを脇へ退け（消さない）、空のnodeとして参加し直す。
  const aside = path.join(dir, "nas-db-aside");
  fs.mkdirSync(aside);
  for (const suffix of ["", "-wal", "-shm"]) {
    if (fs.existsSync(databasePath + suffix))
      fs.renameSync(databasePath + suffix, path.join(aside, `research-desk.sqlite${suffix}`));
  }
  assert.ok(fs.existsSync(path.join(aside, "research-desk.sqlite")), "退けたDBは残る");
  const rejoined = await nas(dir, shared);
  handles.push(() => rejoined.core.stop());
  api = call(rejoined.base, await pair(rejoined.base, rejoined.userDataPath));

  // 新しいdevice idで参加し、旧IDの公開済みの記録がすべて戻っている。
  assert.notEqual(
    fs
      .readdirSync(path.join(shared, "devices"))
      .filter((id) => id !== host.deviceId && id !== oldDeviceId).length,
    0,
    "新しいdevice idのディレクトリができる",
  );
  const bootstrap = await api.get(TASKEN_MOBILE_ENDPOINTS.bootstrap, { limit: 50 });
  assert.ok(bootstrap.body.data.tasks.some((task) => task.id === "task-published-before-restore"));
  assert.ok(bootstrap.body.data.tasks.some((task) => task.id === "task-a"));

  // 続きから動く: 新しい書き込みがDesktopへ届く。
  const again = await api.post(TASKEN_MOBILE_ENDPOINTS.commands, createTask("task-after-recovery"));
  assert.equal(again.status, 200, JSON.stringify(again.body));
  await rejoined.core.syncNow();
  await sync.syncNow();
  assert.equal(host.get("task", "task-after-recovery").title, "スマホで作ったタスク");
  assert.ok(host.get("task", "task-published-before-restore"));
});
