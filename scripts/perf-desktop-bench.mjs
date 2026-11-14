// 実データの写しでDesktopを起動し、起動・画面切り替え・保存の往復・待機中の停止を測る。
//
//   npm run build
//   npm run bench:desktop -- --db <写しのsqlite> [--work-dir D:/scratch] [--idle-seconds 25]
//     [--save-page Today] [--profile-main --keep] [--json out.json]
//
// 写しの扱い:
// - --db のファイルは読むだけ。backup APIで一時userDataへ写し、その写しで起動する。
// - 写しの設定から外へ出る経路を止める（共有フォルダ同期・成果物の保存先・活動ログの自動書き出し・
//   自動バックアップの保存先・Daily Contextの自動公開）。作業フォルダの外を指すパスが設定に
//   残っていたら起動しない。
// - 写しは通常起動と同じく常駐する（トレイ・グローバルショートカット・リマインダー）。計測の間に
//   クイック記録などを使うと写しに入り、終わりに消える。本人が使っていない時間に流す。
// - Android連携の待ち受け（127.0.0.1:48177、Tailscale Serveで公開されている）を計測中だけ
//   ダミーの待ち受けで塞ぐ。写しが本物の端末の同期を受けてしまうと、端末側は送信済みと
//   みなし、本物の正本に届かない。ポートが使用中ならTaskenが動いているとみなして止める。
//
// Mainの停止は、起動直後にMainへ50ms間隔のタイマーを入れて遅れを集める。
// TASKEN_PERF_DIAGNOSTICS は workspace:load の結果を毎回JSON化して数字を膨らませるので使わない。
import { _electron as electron } from "playwright";
import Database from "better-sqlite3";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const MOBILE_GATEWAY_PORT = 48_177;

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const sourcePath = argument("--db");
if (!sourcePath) {
  console.error("--db <sqlite> を指定してください（実プロファイルではなく写し）。");
  process.exit(2);
}
const idleSeconds = Math.max(0, Number(argument("--idle-seconds", "25")) || 0);
const jsonOut = argument("--json");
const appDirectory = path.resolve(process.cwd());
const workDirectory = fs.mkdtempSync(
  path.join(argument("--work-dir", os.tmpdir()), "tasken-perf-desktop-"),
);
const userDataDirectory = path.join(workDirectory, "user-data");
const artifactDirectory = path.join(workDirectory, "artifacts");
fs.mkdirSync(userDataDirectory, { recursive: true });
fs.mkdirSync(artifactDirectory, { recursive: true });

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? Number(sorted[Math.floor(sorted.length / 2)].toFixed(1)) : null;
}

async function prepareCopy() {
  const target = path.join(userDataDirectory, "research-desk.sqlite");
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  await source.backup(target);
  source.close();
  const copy = new Database(target);
  const setMeta = copy.prepare(
    "INSERT INTO workspace_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  setMeta.run("shared_sync_enabled", "false");
  setMeta.run("shared_sync_directory", "");
  setMeta.run("artifact_directory", artifactDirectory);
  setMeta.run("activity_log_auto_export_time", "");
  setMeta.run("activity_log_directory", "");
  // 自動バックアップは世代を入れ替える（古いものを消す）ので、本物の保存先へ向けない。
  setMeta.run("automatic_snapshot_backup_directory", path.join(workDirectory, "backups"));
  // 日別 Context（#755 束2 で外した）の設定は、もう読まないが本物の公開先のパスを持つことがある。
  // 写しからは消して、下の「外を指すパス」の確かめに引っかからないようにする。
  copy
    .prepare(
      "DELETE FROM workspace_meta WHERE key IN ('daily_context_auto_state', 'daily_context_publication')",
    )
    .run();
  // 抜けを防ぐ: 設定に作業フォルダの外を指す絶対パスが残っていたら起動しない。
  const outside = copy
    .prepare("SELECT key, value FROM workspace_meta")
    .all()
    .filter(({ value }) => absolutePathsIn(value).some((found) => !isInside(found, workDirectory)))
    .map(({ key }) => key);
  copy.close();
  if (outside.length) {
    throw new Error(`写しの設定に作業フォルダの外を指すパスが残っています: ${outside.join(", ")}`);
  }
}

function absolutePathsIn(value) {
  const text = String(value || "").replaceAll("\\\\", "\\");
  return [...text.matchAll(/(?:[A-Za-z]:[\\/]|\\\\)[^"'\s,\]}]*/g)].map((match) => match[0]);
}

function isInside(candidate, directory) {
  const normalized = path.resolve(candidate).toLowerCase();
  const root = path.resolve(directory).toLowerCase();
  return normalized === root || normalized.startsWith(`${root}${path.sep}`);
}

function guardMobileGatewayPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => socket.destroy());
    server.once("error", (error) =>
      reject(
        error?.code === "EADDRINUSE"
          ? new Error("127.0.0.1:48177 が使用中です。Taskenを終了してから測ってください。")
          : error,
      ),
    );
    server.listen(MOBILE_GATEWAY_PORT, "127.0.0.1", () => resolve(server));
  });
}

const results = { source: path.basename(sourcePath), measuredAt: new Date().toISOString() };
let guard = null;
let app = null;

async function installMainLagSampler() {
  await app.evaluate(() => {
    const state = { lags: [] };
    let expected = Date.now() + 50;
    setInterval(() => {
      const now = Date.now();
      const lag = now - expected;
      if (lag >= 50) state.lags.push(lag);
      expected = now + 50;
    }, 50).unref?.();
    globalThis.__perfMainLags = state;
  });
}

async function takeMainLags() {
  const lags = await app.evaluate(() => {
    const values = globalThis.__perfMainLags.lags;
    globalThis.__perfMainLags.lags = [];
    return values;
  });
  return {
    count: lags.length,
    maxMs: lags.length ? Math.max(...lags) : 0,
    totalMs: lags.reduce((sum, value) => sum + value, 0),
  };
}

try {
  await prepareCopy();
  guard = await guardMobileGatewayPort();

  const launchedAt = Date.now();
  app = await electron.launch({
    args: [
      appDirectory,
      `--user-data-dir=${userDataDirectory}`,
      "--disable-gpu",
      "--disable-gpu-compositing",
    ],
    cwd: appDirectory,
  });
  await installMainLagSampler();
  const page = await app.firstWindow();
  results.firstWindowMs = Date.now() - launchedAt;
  await page
    .locator(".sidebar .primary-nav button")
    .first()
    .waitFor({ state: "visible", timeout: 120_000 });
  results.sidebarVisibleMs = Date.now() - launchedAt;
  // 起動直後に裏で走る処理（自動Snapshotなど）が落ち着くまでの停止も起動の一部に数える。
  await page.waitForTimeout(3000);
  results.mainLagsStartup = await takeMainLags();

  await page.evaluate(() => {
    window.__perfLongTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__perfLongTasks.push(entry.duration);
    }).observe({ type: "longtask", buffered: true });
  });
  results.rendererHeapAfterLoadMb = await page.evaluate(() =>
    Math.round((performance.memory?.usedJSHeapSize || 0) / 1e6),
  );

  // 画面切り替え: クリックからaria-currentが移り、次の描画フレームが来るまで。
  const labels = await page
    .locator(".sidebar .primary-nav button")
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") || ""));
  const switchTimes = {};
  for (const pass of ["cold", "warm"]) {
    for (const label of labels) {
      const ms = await page.evaluate(async (target) => {
        const button = [...document.querySelectorAll(".sidebar .primary-nav button")].find(
          (candidate) => candidate.getAttribute("aria-label") === target,
        );
        if (!button) return null;
        const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
        const started = performance.now();
        button.click();
        const deadline = started + 30_000;
        while (button.getAttribute("aria-current") !== "page" && performance.now() < deadline) {
          await frame();
        }
        await frame();
        await frame();
        return performance.now() - started;
      }, label);
      if (ms !== null) (switchTimes[label] ||= {})[pass] = Math.round(ms);
      // 画面を開いたことで始まるMainの仕事（Data Healthなど）も、その画面の分として数える。
      await page.waitForTimeout(300);
      const lags = await takeMainLags();
      if (ms !== null && lags.totalMs) switchTimes[label][`${pass}MainBlockedMs`] = lags.totalMs;
    }
  }
  results.pageSwitchMs = switchTimes;

  // 保存と待機は普段の画面で測る。開いている画面によって保存後の再計算が変わる
  // （KnowledgeはData Healthを取り直す）ため、--save-page で選べるようにする。
  const savePage = argument("--save-page", "今日");
  await page.locator(`.sidebar .primary-nav button[aria-label="${savePage}"]`).click();
  await page.waitForTimeout(1000);
  await takeMainLags();
  results.savePage = savePage;

  // 全体の再読込（起動時、削除・復元・作業記録のあとに走る）
  const reloadSamples = await page.evaluate(async () => {
    const samples = [];
    for (let index = 0; index < 3; index += 1) {
      const started = performance.now();
      await window.api.workspace.load();
      samples.push(performance.now() - started);
    }
    return samples;
  });
  results.workspaceReloadMs = {
    median: median(reloadSamples),
    samples: reloadSamples.map(Math.round),
  };
  results.mainLagsReload = await takeMainLags();

  // --profile-main: 保存の往復の間だけMainのCPU profileを取り、work dirへ残す（--keepと併用）。
  const profileMain = process.argv.includes("--profile-main");
  if (profileMain) {
    await app.evaluate(async () => {
      const inspector = process.getBuiltinModule("node:inspector");
      const session = new inspector.Session();
      session.connect();
      globalThis.__perfProfiler = session;
      await new Promise((resolve) => session.post("Profiler.enable", () => resolve()));
      await new Promise((resolve) => session.post("Profiler.start", () => resolve()));
    });
  }

  // 保存の往復: Rendererの保存と同じsaveMany（Note本体＋活動記録）をIPC越しに5回。
  // 保存後に画面側で始まる再計算も含めるため、次の保存の前に少し待つ。
  const saveSamples = await page.evaluate(async () => {
    const notes = await window.api.entities.list("note");
    const note = [...notes].sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
    if (!note) return null;
    const samples = [];
    for (let index = 0; index < 5; index += 1) {
      const sessionId = `perf-${crypto.randomUUID()}`;
      const started = performance.now();
      await window.api.entities.saveMany([
        { action: "save", type: "note", entity: { ...note, version: undefined } },
        {
          action: "save",
          type: "change_event",
          entity: {
            id: crypto.randomUUID(),
            entity_type: "note",
            entity_id: note.id,
            change_type: "updated",
            occurred_at: new Date().toISOString(),
            source: "manual",
            actor: { kind: "user" },
            origin: { kind: "renderer_save", session_id: sessionId },
            metadata: { session_id: sessionId, source: "manual" },
            after_json: note,
          },
        },
      ]);
      samples.push(performance.now() - started);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return samples;
  });
  results.mainLagsSave = await takeMainLags();

  // Taskの書き込み: 画面と同じTask commandで、題名の変更→完了→再開を3回。
  // 本人の言葉「タスクを保存したり完了したりの書き込みっぽいの重い」に合わせて測る。
  const taskSamples = await page.evaluate(async () => {
    const tasks = await window.api.entities.list("task");
    const target = [...tasks]
      .filter((task) => !task.deleted_at && task.state !== "done")
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
    if (!target) return null;
    const base = () => ({
      schemaVersion: 2,
      command_id: crypto.randomUUID(),
      actor: { kind: "user" },
      source: "desktop",
      entrypoint: "main_ui",
      issued_at: new Date().toISOString(),
    });
    const samples = { update: [], complete: [], reopen: [] };
    let version = Number(target.version);
    const run = async (kind, command) => {
      const started = performance.now();
      const response = await window.api.task[kind](command);
      samples[kind].push(performance.now() - started);
      if (!response.ok) throw new Error(`${kind}: ${JSON.stringify(response.error)}`);
      version = response.value.task.version;
      await new Promise((resolve) => setTimeout(resolve, 300));
    };
    for (let index = 0; index < 3; index += 1) {
      const title = `${target.title}（計測${index}）`;
      await run("update", {
        ...base(),
        name: "UpdateTask",
        payload: { task_id: target.id, expected_version: version, changes: { title } },
      });
      await run("complete", {
        ...base(),
        name: "CompleteTask",
        payload: { task_id: target.id, expected_version: version },
      });
      await run("reopen", {
        ...base(),
        name: "ReopenTask",
        payload: { task_id: target.id, expected_version: version },
      });
    }
    return samples;
  });
  if (taskSamples) {
    results.taskCommandMs = Object.fromEntries(
      Object.entries(taskSamples).map(([kind, samples]) => [
        kind,
        { median: median(samples), samples: samples.map(Math.round) },
      ]),
    );
  }
  results.mainLagsTask = await takeMainLags();

  if (profileMain) {
    const profile = await app.evaluate(async () => {
      const session = globalThis.__perfProfiler;
      return await new Promise((resolve) =>
        session.post("Profiler.stop", (_error, value) => resolve(JSON.stringify(value.profile))),
      );
    });
    fs.writeFileSync(path.join(workDirectory, "main-save.cpuprofile"), profile);
    results.mainProfile = path.join(workDirectory, "main-save.cpuprofile");
  }
  if (Array.isArray(saveSamples)) {
    results.saveRoundTripMs = { median: median(saveSamples), samples: saveSamples.map(Math.round) };
  }

  if (idleSeconds > 0) {
    await page.evaluate(() => {
      window.__perfLongTasks = [];
    });
    await takeMainLags();
    await page.waitForTimeout(idleSeconds * 1000);
    const idleLongTasks = await page.evaluate(() => window.__perfLongTasks);
    results.idle = {
      seconds: idleSeconds,
      rendererLongTasks: idleLongTasks.length,
      rendererLongTaskTotalMs: Math.round(idleLongTasks.reduce((sum, value) => sum + value, 0)),
      main: await takeMainLags(),
    };
  }
  results.rendererHeapEndMb = await page.evaluate(() =>
    Math.round((performance.memory?.usedJSHeapSize || 0) / 1e6),
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (app) await app.close().catch(() => {});
  if (guard) await new Promise((resolve) => guard.close(resolve));
  if (!process.argv.includes("--keep")) fs.rmSync(workDirectory, { recursive: true, force: true });
}

console.log(JSON.stringify(results, null, 2));
if (jsonOut) fs.writeFileSync(jsonOut, `${JSON.stringify(results, null, 2)}\n`);
