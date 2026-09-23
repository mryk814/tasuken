/**
 * Inbox→Feedの実動監査。
 *
 * 隔離した一時userDataへ未整理の付箋メモを1件だけ入れ、実際のクリック操作で
 * Feedへ載せられることを確かめる。保存されたNoteと元の付箋の整理結果は、
 * アプリを閉じてから同じSQLiteを開き直して検証する。
 *
 *   npm run build && npm run audit:inbox-feed
 *
 * 出力先は output/playwright/inbox-feed。失敗時は終了コード1。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";

// run-electron-nodeのNodeモードを引き継いだままではPlaywrightがElectronを起動できない。
delete process.env.ELECTRON_RUN_AS_NODE;

const OUT_DIR = "output/playwright/inbox-feed";
const ZOOM_STORAGE_KEY = "tasken:shell:zoom-factor:v1";
const CAPTURE_ID = "inbox-feed-audit-memo";
const SOURCE_ID = "inbox-feed-audit-source";
const MEMO_TITLE = "乾燥の気づき";
const MEMO_TEXT = "同じ条件でも乾燥時間が違うと結果が変わる。";

mkdirSync(OUT_DIR, { recursive: true });
const userDataDir = mkdtempSync(path.join(os.tmpdir(), "tasken-inbox-feed-audit-"));
const seeded = spawnSync(
  process.execPath,
  ["scripts/run-electron-node.mjs", "scripts/seed-inbox-feed-audit-workspace.mjs", userDataDir],
  { encoding: "utf8" },
);
if (seeded.status !== 0) {
  throw new Error(
    `Inbox→Feed監査のworkspaceを用意できませんでした: ${seeded.stderr || seeded.stdout}`,
  );
}
const databasePath = path.join(userDataDir, "research-desk.sqlite");
const failures = [];

async function launchApp() {
  const app = await electron.launch({
    args: [".", "--disable-gpu", "--disable-gpu-compositing", `--user-data-dir=${userDataDir}`],
    env: { ...process.env, TASKEN_USER_DATA_DIR: userDataDir },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key, JSON.stringify(value)),
    [ZOOM_STORAGE_KEY, 1],
  );
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3000);
  return { app, page };
}

async function openInboxMicroLane(page) {
  await page.locator(".sidebar button", { hasText: "Inbox" }).first().click();
  await page.waitForFunction(
    (label) =>
      document.querySelector('.sidebar button[aria-current="page"]')?.getAttribute("aria-label") ===
      label,
    "Inbox",
  );
  await page.locator(".inbox-tabs button", { hasText: "付箋メモ" }).first().click();
  await page.waitForTimeout(500);
}

async function waitForActiveRoute(page, label) {
  await page.waitForFunction(
    (expected) =>
      document.querySelector('.sidebar button[aria-current="page"]')?.getAttribute("aria-label") ===
      expected,
    label,
  );
  await page.waitForTimeout(300);
}

/** 画面の操作を最後まで通せたか。途中で失敗したときは保存状態を判定しない。 */
try {
  const { app, page } = await launchApp();
  try {
    await openInboxMicroLane(page);
    const memo = page.locator(".micro-memo-card", { hasText: MEMO_TEXT }).first();
    if ((await memo.count()) !== 1) {
      failures.push("監査用の付箋メモが1件だけ表示されていません。");
    } else {
      await page.screenshot({ path: `${OUT_DIR}/micro-before.png` });
      await memo.locator('button[aria-label="付箋メモをFeedへ載せる"]').click();
      await page.locator(".toast", { hasText: "Feedへ投稿しました" }).first().waitFor();
      await waitForActiveRoute(page, "Feed");
      const posted = page.locator(".feed-post", { hasText: MEMO_TEXT }).first();
      if ((await posted.count()) !== 1) {
        failures.push("投稿した付箋メモがFeedの投稿列にありません。");
      }
      await page.screenshot({ path: `${OUT_DIR}/posted.png` });

      await openInboxMicroLane(page);
      if ((await page.locator(".micro-memo-card", { hasText: MEMO_TEXT }).count()) !== 0) {
        failures.push("投稿した付箋メモがInboxの付箋一覧に残っています。");
      }
    }
  } finally {
    await app.close();
  }

  if (failures.length === 0) {
    const verify = new WorkspaceDatabase(databasePath);
    try {
      verify.loadWorkspace();
      const postedNote = verify
        .list("note")
        .find(
          (note) =>
            note.title === MEMO_TITLE && String(note.body_markdown || "").includes(MEMO_TEXT),
        );
      if (!postedNote) {
        failures.push("保存されたNoteが見つかりません。");
      } else {
        if (!postedNote.feed_published_at) failures.push("保存されたNoteにFeedの印がありません。");
        if (postedNote.note_type !== "memo") failures.push("付箋の保存先がMemoになっていません。");
        if (postedNote.source_record_id !== SOURCE_ID) {
          failures.push("保存されたNoteに出所の記録IDが残っていません。");
        }
        const converted = verify.get("capture_entry", CAPTURE_ID);
        if (converted.state !== "archived") {
          failures.push(`元の付箋が片付いていません（${converted.state}）。`);
        }
        if (converted.triaged_to_type !== "note" || converted.triaged_to_id !== postedNote.id) {
          failures.push("元の付箋にNoteへの整理先が残っていません。");
        }
      }
    } finally {
      verify.db.close();
    }
  }
} finally {
  rmSync(userDataDir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`Inbox→Feed監査で${failures.length}件の問題を検出しました。`);
  for (const failure of failures) console.error(`  NG ${failure}`);
  console.error(`スクリーンショット: ${OUT_DIR}`);
  process.exit(1);
}

console.log(`Inbox→Feed監査: OK（スクリーンショットは ${OUT_DIR}）`);
