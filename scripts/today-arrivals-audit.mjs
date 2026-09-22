/**
 * Today「AIから届いたこと」とToDoのAI委任状態の実動監査（計画フェーズ5）
 *
 * 一時userDataへ「AIへ渡せる／開始待ち／作業中／確認待ち／自分に戻った」の5つのTaskと、
 * 回答待ちの質問、最後にFeedを見たあとに届いた学びを仕込んでからアプリを起動し、
 * 次を実測する。
 *
 * 1. ToDoの5つの状態が正しい行にだけ出る（当てはまらない行には出ない）
 * 2. Todayの「AIから届いたこと」が最大3件で、届いた順に並ぶ
 * 3. 読む操作がFeedのスレッドへ行く
 * 4. 最後にFeedを見たあとの学びが、Feedを見た後は出ない
 * 5. 届いた情報が無いときはセクションごと消える
 * 6. 状態chipがTask詳細を開く
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

    // --- まだFeedを見ていないときは、届いた学びを出さない ---
    // 最後に見た時刻の印が無い状態では、届いた記事の判定そのものを行わない。
    await seedMarkers(page, "");
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3500);
    const beforeFeed = (await page.locator(".today-arrivals-row").allInnerTexts()).map(squeeze);
    if (beforeFeed.some((text) => text.includes("同じ条件で測り直すと"))) {
      failures.push("Feedをまだ見ていないのに、届いた学びが出ています。");
    }
    if (beforeFeed.length !== 2) {
      failures.push(`Feed閲覧前のTodayの到着が2件ではありません（${beforeFeed.length}件）。`);
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
      // 閉じ終わるまで待つ。開いたまま次へ進むと、読む操作の行き先を測り違える。
      await page.waitForFunction(() => document.querySelectorAll(".drawer").length === 0, null, {
        timeout: 5000,
      });
    }

    // --- Feedを見る（最後に見た時刻の印が更新される） ---
    await nav(page, "Feed").click();
    await page.waitForTimeout(2500);
    if (!(await page.locator(".page.feed-page").count())) {
      throw new Error("Feedが表示されていません。");
    }

    // --- Todayの「AIから届いたこと」: 最大3件を、届いた順に出す ---
    await nav(page, "Today").click();
    await page.waitForTimeout(1500);
    const arrivals = page.locator(".today-arrivals-row");
    const rowCount = await arrivals.count();
    if (rowCount !== 3) {
      failures.push(`Todayの到着が3件ではありません（${rowCount}件）。`);
    }
    const arrivalTexts = (await arrivals.allInnerTexts()).map(squeeze);
    const expectedArrivals = [
      ["測定温度が決まっていません。", "回答待ち", "Codex"],
      ["再集計の結果をまとめました。", "成果確認", "Codex"],
      ["同じ条件で測り直すと", "学び", "Claude Code"],
    ];
    if (arrivalTexts.length === 3) {
      const plain = arrivalTexts.map((text) =>
        text.replace(/[0-9]+月[0-9]+日 [0-9]{2}:[0-9]{2}/u, ""),
      );
      for (const [index, [title, state, actor]] of expectedArrivals.entries()) {
        const text = plain[index];
        for (const expected of [title, state, actor]) {
          if (!text.includes(expected)) {
            failures.push(`Todayの到着${index + 1}件目に「${expected}」がありません: ${text}`);
          }
        }
      }
    }
    await page.screenshot({ path: `${OUT_DIR}/today-arrivals.png`, fullPage: true });

    // --- 読む操作はFeedへ行く（回答待ちの一件） ---
    await arrivals.first().locator(".today-arrivals-open").click();
    await page.waitForTimeout(2500);
    const afterReading = await page.evaluate(() => ({
      feed: document.querySelectorAll(".page.feed-page").length,
      today: document.querySelectorAll(".page.today-page").length,
      drawers: document.querySelectorAll(".drawer").length,
    }));
    if (!afterReading.feed) {
      failures.push("到着の「読む」がFeedへ移動していません。");
    }
    if (afterReading.drawers) {
      failures.push("到着の「読む」がTask詳細を開いています。");
    }
    await page.screenshot({ path: `${OUT_DIR}/today-arrival-reading.png`, fullPage: true });

    // --- 学びの一件はFeedのスレッドで開く ---
    await nav(page, "Today").click();
    await page.waitForTimeout(1200);
    const articleRow = page.locator(".today-arrivals-row", { hasText: "同じ条件で測り直すと" });
    if (await articleRow.count()) {
      await articleRow.locator(".today-arrivals-open").first().click();
      await page.waitForTimeout(2500);
      const thread = squeeze(await page.locator(".feed-thread-panel").innerText());
      if (!thread.includes("同じ条件で測り直すと")) {
        failures.push(`学びの「読む」がFeedのスレッドを開いていません: ${thread.slice(0, 160)}`);
      }
      await page.screenshot({ path: `${OUT_DIR}/today-arrival-thread.png`, fullPage: true });
    } else {
      failures.push("Todayに学びの到着がありません。");
    }

    // --- 成果確認はTask詳細を開く（採用するかどうかをその場で決める） ---
    await nav(page, "Today").click();
    await page.waitForTimeout(1200);
    const reviewRow = page.locator(".today-arrivals-row", { hasText: "成果確認" });
    if (await reviewRow.count()) {
      await reviewRow.locator(".today-arrivals-open").first().click();
      await page.waitForTimeout(1200);
      const reviewTitle = page
        .locator('.drawer form.drawer-form[data-entity-type="task"] input[name="title"]')
        .first();
      if (!(await reviewTitle.count())) {
        failures.push("成果確認の「読む」がTask詳細を開いていません。");
      } else if ((await reviewTitle.inputValue()) !== "再集計の結果をまとめる") {
        failures.push(`成果確認が開いたTaskが違います: ${await reviewTitle.inputValue()}`);
      }
      await page.screenshot({ path: `${OUT_DIR}/today-arrival-review.png`, fullPage: true });
      await page.locator(".drawer-header button", { hasText: "閉じる" }).first().click();
      await page.waitForFunction(() => document.querySelectorAll(".drawer").length === 0, null, {
        timeout: 5000,
      });
    } else {
      failures.push("Todayに成果確認の到着がありません。");
    }

    // --- 処理する操作はAgent Deskへ行く ---
    const beforeHandle = await page.locator(".today-arrivals-row").count();
    if (beforeHandle) {
      await page
        .locator(".today-arrivals-row .text-button", { hasText: "Agent Desk" })
        .first()
        .click();
      await page.waitForTimeout(1500);
      if (!(await page.locator(".agent-desk").count())) {
        failures.push("到着の「Agent Desk」がAgent Deskへ移動していません。");
      }
      await page.screenshot({ path: `${OUT_DIR}/today-arrival-handling.png`, fullPage: true });
    }

    // --- 判断待ちは、Feedを見ただけでは減らない ---
    await nav(page, "Today").click();
    await page.waitForTimeout(1200);
    const afterFeed = (await page.locator(".today-arrivals-row").allInnerTexts()).map(squeeze);
    if (!afterFeed[0]?.includes("測定温度が決まっていません。")) {
      failures.push("Feedを見ただけで回答待ちがTodayから消えています。");
    }
    if (!afterFeed.some((text) => text.includes("再集計の結果をまとめました。"))) {
      failures.push("Feedを見ただけで成果確認がTodayから消えています。");
    }
    await page.screenshot({ path: `${OUT_DIR}/today-after-feed.png`, fullPage: true });

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
  console.error(`Today到着監査で${failures.length}件の問題を検出しました。`);
  for (const failure of failures) console.error(`  NG ${failure}`);
  console.error(`スクリーンショット: ${OUT_DIR}`);
  process.exit(1);
}
console.log(`Today到着監査: OK（スクリーンショットは ${OUT_DIR}）`);
