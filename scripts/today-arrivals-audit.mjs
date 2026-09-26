/**
 * Today「AIから届いたこと」とToDoのAI委任状態の実動監査（計画フェーズ5）
 *
 * 一時userDataへ「AIへ渡せる／開始待ち／作業中／確認待ち／自分に戻った」の5つのTaskと、
 * 回答待ちの質問、最後にFeedを見たあとに届いた学びを仕込んでからアプリを起動し、
 * 次を実測する。
 *
 * 1. ToDoの5つの状態が正しい行にだけ出る（当てはまらない行には出ない）
 * 2. Todayに「AIから届いたこと」のセクションが出ない（AIの対応はFeedに集約）
 * 3. 状態chipがTask詳細を開く
 * 4. ToDoの確認待ちの「Feedで確認」がFeedへ移動する
 * 5. Feedの「対応待ち」タブに要対応の一覧と「提案の確認」が出る
 * 6. 届いた情報が無いときもTodayにAIの見出しが出ない
 *
 *   npm run build && npm run audit:today-arrivals
 *
 * Electron ABIのbetter-sqlite3でfixtureを仕込むため、`scripts/run-electron-node.mjs` 経由で実行する。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { _electron as electron } from "playwright";

// playwrightはprocess.envを引き継ぐ。起動するElectronがNodeモードにならないよう外す。
delete process.env.ELECTRON_RUN_AS_NODE;

const OUT_DIR = process.argv[2] || "output/playwright/today-arrivals";
const ZOOM_STORAGE_KEY = "tasken:shell:zoom-factor:v1";
/** 最後にFeedを見た時刻。Todayの「届いた記事」はこの時刻より後の投稿だけを出す。 */
const FEED_LAST_SEEN_KEY = "tasken:feed:last-seen:v1";
/** fixtureの学習投稿より前の時刻。これを下回る投稿だけが「届いた」ことになる。 */
const OLD_LAST_SEEN = "2020-01-01T00:00:00.000Z";

mkdirSync(OUT_DIR, { recursive: true });
const userDataDir = mkdtempSync(path.join(os.tmpdir(), "tasken-today-arrivals-"));
const databasePath = path.join(userDataDir, "research-desk.sqlite");
const failures = [];
const electronExecutable = path.resolve(
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32" ? "electron.exe" : "electron",
);

/**
 * 監査用のworkspaceを用意する。
 *
 * アプリと同じschema・同じ保存経路を使うため、seederもElectronのABIで動かす。
 * `ELECTRON_RUN_AS_NODE` を渡した別processにし、監査側のDB接続は持たない。
 */
function seedWorkspace(args = []) {
  const result = spawnSync(
    electronExecutable,
    ["scripts/seed-today-arrivals-audit-workspace.mjs", userDataDir, ...args],
    {
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`seederが失敗しました（exit ${result.status}）。`);
}

/** 起動前に置いた表示上の印を、アプリ側のlocalStorageへ入れる。 */
async function seedMarkers(page, lastSeen) {
  await page.evaluate(
    ([zoomKey, zoomValue, lastSeenKey, lastSeenValue]) => {
      window.localStorage.setItem(zoomKey, JSON.stringify(zoomValue));
      window.localStorage.setItem(lastSeenKey, lastSeenValue);
    },
    [ZOOM_STORAGE_KEY, 1, FEED_LAST_SEEN_KEY, lastSeen],
  );
}

const openApp = () =>
  electron.launch({
    args: [".", "--disable-gpu", "--disable-gpu-compositing", `--user-data-dir=${userDataDir}`],
  });

const nav = (page, label) => page.locator(".sidebar button", { hasText: label }).first();

const squeeze = (value) => value.replace(/\s+/g, " ");

/**
 * 第1段階。5つの委任状態と3件の到着を確かめる。
 *
 * 起動前にseederでfixtureを置くが、「最後にFeedを見た時刻」はアプリのlocalStorageに
 * あるため、一度だけreloadしてから読み直す。
 */
async function runMainPhase() {
  seedWorkspace();
  const app = await openApp();
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await seedMarkers(page, OLD_LAST_SEEN);
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3500);

    // --- TodayにAIの到着セクションを出さない ---
    // 最後に見た時刻の印が無い状態でも、ある状態でも、TodayはAIの対応を出さない。
    await seedMarkers(page, "");
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3500);
    if (await page.locator(".today-arrivals-panel").count()) {
      failures.push("Todayに「AIから届いたこと」のセクションが出ています。");
    }
    const todayBody = squeeze(await page.locator(".page.today-page").innerText());
    if (todayBody.includes("AIから届いたこと")) {
      failures.push("Todayに「AIから届いたこと」の見出しが残っています。");
    }
    await page.screenshot({ path: `${OUT_DIR}/today-arrivals-before-feed.png`, fullPage: true });

    // --- ToDoのAI委任状態 ---
    await nav(page, "ToDo").click();
    await page.waitForTimeout(1200);
    if (!(await page.locator(".todo-table").count())) {
      throw new Error("ToDoの一覧が表示されていません。");
    }
    const chipRows = (label) => page.locator(".todo-table .table-row", { hasText: label });
    const chipExpectations = [
      ["AIへ渡せる", "比較表の下書きを作る"],
      ["開始待ち", "粘度データを整理する"],
      ["作業中", "劣化試験の計画を立てる"],
      ["確認待ち", "再集計の結果をまとめる"],
      ["自分に戻った", "評価条件の見直し"],
    ];
    for (const [label, title] of chipExpectations) {
      const rows = chipRows(label);
      const count = await rows.count();
      if (count !== 1) {
        failures.push(`「${label}」が${count}行に出ています（1行であるべき）。`);
        continue;
      }
      const text = squeeze(await rows.first().innerText());
      if (!text.includes(title)) {
        failures.push(`「${label}」が想定と違う行に出ています: ${text}`);
      }
    }
    const plainRow = page
      .locator(".todo-table .table-row", { hasText: "実験ノートを棚卸しする" })
      .first();
    if ((await plainRow.count()) && (await plainRow.locator(".todo-ai-state-chip").count())) {
      failures.push("委任状態の証拠が無い行にchipが出ています。");
    }
    await page.screenshot({ path: `${OUT_DIR}/todo-ai-state.png`, fullPage: true });

    // --- 状態chipがTask詳細を開く ---
    await chipRows("AIへ渡せる").first().locator(".todo-ai-state-chip").click();
    await page.waitForTimeout(900);
    // Task詳細かは、開いたformのタイトル入力の値で判定する（別の面と取り違えない）。
    const titleInput = page
      .locator('.drawer form.drawer-form[data-entity-type="task"] input[name="title"]')
      .first();
    if (!(await titleInput.count())) {
      failures.push("状態chipからTask詳細が開きません。");
    } else {
      const openedTitle = await titleInput.inputValue();
      if (openedTitle !== "比較表の下書きを作る") {
        failures.push(`状態chipが開いたTask詳細が違います: ${openedTitle}`);
      }
      await page.screenshot({ path: `${OUT_DIR}/todo-ai-chip-detail.png`, fullPage: true });
      await page.locator(".drawer-header button", { hasText: "閉じる" }).first().click();
      // 閉じ終わるまで待つ。開いたまま次へ進むと、行き先の判定を測り違える。
      await page.waitForFunction(() => document.querySelectorAll(".drawer").length === 0, null, {
        timeout: 5000,
      });
    }

    // --- ToDoの確認待ちは「Feedで確認」でFeedへ行く ---
    const reviewChipRow = chipRows("確認待ち").first();
    const feedButton = reviewChipRow.locator(".text-button", { hasText: "Feedで確認" });
    if (!(await feedButton.count())) {
      failures.push("確認待ちの行に「Feedで確認」がありません。");
    } else {
      await feedButton.click();
      await page.waitForTimeout(1500);
      if (!(await page.locator(".page.feed-page").count())) {
        failures.push("「Feedで確認」がFeedへ移動していません。");
      }
      await page.screenshot({ path: `${OUT_DIR}/today-arrival-handling.png`, fullPage: true });
    }

    // --- Feedの「対応待ち」タブに要対応の一覧が出る（判断の採否も同じ面で行う） ---
    await nav(page, "Feed").click();
    await page.waitForTimeout(2500);
    if (!(await page.locator(".page.feed-page").count())) {
      throw new Error("Feedが表示されていません。");
    }
    await page.locator("#feed-tab-needs").click();
    await page.waitForTimeout(1200);
    if (!(await page.locator("#feed-panel-needs").count())) {
      failures.push("Feedの「対応待ち」タブが開きません。");
    }
    const needsText = squeeze(await page.locator("#feed-panel-needs").innerText());
    if (!needsText.includes("回答待ち")) {
      failures.push(`対応待ちに回答待ちが出ていません: ${needsText.slice(0, 160)}`);
    }
    // 判断・変更案・確認待ちは同じ1本の一覧に出る。別の面へ分けない。
    if (!(await page.locator("#feed-panel-needs .feed-needs-panel").count())) {
      failures.push("対応待ちの一覧（判断と確認待ち）が出ていません。");
    }
    if (
      (await page.locator("#feed-panel-needs .proposal-inbox-panel .proposal-list").count()) > 0
    ) {
      failures.push("判断の一覧が「提案の履歴」にも出ています（同じ報告の二重表示）。");
    }
    await page.screenshot({ path: `${OUT_DIR}/today-arrivals.png`, fullPage: true });

    // --- 狭幅でも横あふれしない ---
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 680));
    await page.waitForTimeout(700);
    const overflowing = await page.evaluate(() => {
      const found = [];
      for (const element of document.querySelectorAll(".main-area, .main-area *")) {
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") continue;
        if (element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0) {
          found.push(
            `${element.tagName.toLowerCase()}.${(element.className?.toString?.() || "").slice(0, 50)}`,
          );
        }
      }
      return found;
    });
    if (overflowing.length) failures.push(`狭幅で横あふれ: ${overflowing.join(", ")}`);
    await nav(page, "ToDo").click();
    await page.waitForTimeout(900);
    const todoOverflowing = await page.evaluate(() => {
      const found = [];
      for (const element of document.querySelectorAll(".todo-table, .todo-table *")) {
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") continue;
        if (element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0) {
          found.push(
            `${element.tagName.toLowerCase()}.${(element.className?.toString?.() || "").slice(0, 50)}`,
          );
        }
      }
      return found;
    });
    if (todoOverflowing.length)
      failures.push(`狭幅のToDoで横あふれ: ${todoOverflowing.join(", ")}`);
    await page.screenshot({ path: `${OUT_DIR}/today-arrivals-980.png`, fullPage: true });
  } finally {
    await app.close();
  }
}

/**
 * 第2段階。届いた情報もAI委任も無いときは、セクションごと消える。
 *
 * 第1段階と同じuserDataを使い回すため、先にdatabaseを消してからseederを走らせる。
 * 正本データは前の段階のものを持ち越さない。
 */
async function runEmptyPhase() {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${databasePath}${suffix}`, { force: true });
  }
  seedWorkspace(["--empty"]);
  const app = await openApp();
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3500);
    if (!(await page.locator(".page.today-page").count())) {
      throw new Error("Todayが表示されていません。");
    }
    if (await page.locator(".today-arrivals-panel").count()) {
      failures.push("届いた情報が無いのに、Todayのセクションが出ています。");
    }
    const body = squeeze(await page.locator(".today-page").innerText());
    if (body.includes("AIから届いたこと")) {
      failures.push("届いた情報が無いのに、Todayの見出しが残っています。");
    }
    await page.screenshot({ path: `${OUT_DIR}/today-arrivals-empty.png`, fullPage: true });
  } finally {
    await app.close();
  }
}

try {
  await runMainPhase();
  await runEmptyPhase();
} finally {
  rmSync(userDataDir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`Today AI非表示・ToDo委任監査で${failures.length}件の問題を検出しました。`);
  for (const failure of failures) console.error(`  NG ${failure}`);
  console.error(`スクリーンショット: ${OUT_DIR}`);
  process.exit(1);
}
console.log(`Today AI非表示・ToDo委任監査: OK（スクリーンショットは ${OUT_DIR}）`);
