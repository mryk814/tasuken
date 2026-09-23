/**
 * Inbox→Feedの実動監査。
 *
 * 隔離した一時userDataへ未整理のInbox記録を2件だけ入れ、行のショートカットと
 * Alt+Pの両方でFeed専用の投稿へ載せられることを確かめる。保存された投稿と
 * 元の記録の整理結果は、アプリを閉じてから同じSQLiteを開き直して検証する。
 * 自分の投稿がNotesに残らないことも確かめる。
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
const SOURCE_ID = "inbox-feed-audit-source";
const FIRST_ROW = {
  captureId: "inbox-feed-audit-row",
  title: "乾燥の気づき",
  text: "同じ条件でも乾燥時間が違うと結果が変わる。",
};
const SECOND_ROW = {
  captureId: "inbox-feed-audit-shortcut",
  title: "標本の気づき",
  text: "3回以下なら幅だけを見る。",
};

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

async function openInboxUntriagedLane(page) {
  await page.locator(".sidebar button", { hasText: "Inbox" }).first().click();
  await page.waitForFunction(
    (label) =>
      document.querySelector('.sidebar button[aria-current="page"]')?.getAttribute("aria-label") ===
      label,
    "Inbox",
  );
  await page.locator(".inbox-tabs button", { hasText: "未整理" }).first().click();
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

function inboxCard(page, row) {
  return page.locator(".inbox-card", { hasText: row.text }).first();
}

async function assertFeedPost(page, row, screenshot) {
  await page.locator(".toast", { hasText: "に投稿しました" }).first().waitFor();
  await waitForActiveRoute(page, "Feed");
  const posted = page.locator(".feed-post", { hasText: row.text }).first();
  if ((await posted.count()) !== 1) {
    failures.push(`投稿した記録「${row.title}」がFeedの投稿列にありません。`);
    return;
  }
  await page.screenshot({ path: `${OUT_DIR}/${screenshot}` });
}

async function assertInboxCleared(page, row) {
  await openInboxUntriagedLane(page);
  if ((await inboxCard(page, row).count()) !== 0) {
    failures.push(`投稿した記録「${row.title}」が未整理Inboxに残っています。`);
  }
}

/** 画面の操作を最後まで通せたか。途中で失敗したときは保存状態を判定しない。 */
try {
  const { app, page } = await launchApp();
  try {
    // 行のショートカットで、そのままの題名・説明・ThemeをFeedへ渡す。
    await openInboxUntriagedLane(page);
    if ((await inboxCard(page, FIRST_ROW).count()) !== 1) {
      failures.push("監査用の未整理記録が1件だけ表示されていません。");
    } else {
      await page.screenshot({ path: `${OUT_DIR}/row-before.png` });
      await inboxCard(page, FIRST_ROW).locator('button[title$="Feedへ載せる"]').click();
      await assertFeedPost(page, FIRST_ROW, "posted-button.png");
      await assertInboxCleared(page, FIRST_ROW);
    }

    // Alt+Pで選択中をFeedへ渡す。入力欄にフォーカスがあるときは発火しない。
    await openInboxUntriagedLane(page);
    if ((await inboxCard(page, SECOND_ROW).count()) !== 1) {
      failures.push("ショートカット用の未整理記録が1件だけ表示されていません。");
    } else {
      await inboxCard(page, SECOND_ROW)
        .locator(`input[aria-label="${SECOND_ROW.title}を選択"]`)
        .check();
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
      await page.keyboard.press("Alt+p");
      await assertFeedPost(page, SECOND_ROW, "posted-shortcut.png");

      // 投稿列で編集・削除・元に戻すが回る。Notesは経由しない。
      const secondCard = page.locator(".feed-post", { hasText: SECOND_ROW.text }).first();
      await secondCard.locator('button:has-text("編集")').click();
      const editor = secondCard.locator(".feed-own-post-editor textarea").first();
      await editor.fill(`${SECOND_ROW.title}\n${SECOND_ROW.text}（追記）`);
      await secondCard.locator('.feed-own-post-editor button:has-text("保存")').click();
      await page
        .locator(".feed-post", { hasText: `${SECOND_ROW.text}（追記）` })
        .first()
        .waitFor();
      await page.screenshot({ path: `${OUT_DIR}/edited.png` });
      await secondCard.locator('button:has-text("削除")').click();
      await page.waitForFunction(
        (text) =>
          [...document.querySelectorAll(".feed-post")].every(
            (entry) => !entry.textContent?.includes(text),
          ),
        SECOND_ROW.text,
      );
      await page.locator(".toast button", { hasText: "元に戻す" }).first().click();
      await page.locator(".feed-post", { hasText: SECOND_ROW.text }).first().waitFor();
      await page.screenshot({ path: `${OUT_DIR}/restored.png` });

      await assertInboxCleared(page, SECOND_ROW);
    }
  } finally {
    await app.close();
  }

  if (failures.length === 0) {
    const verify = new WorkspaceDatabase(databasePath);
    try {
      verify.loadWorkspace();
      for (const row of [FIRST_ROW, SECOND_ROW]) {
        const posted = verify
          .list("feed_post")
          .find(
            (entry) =>
              entry.title === row.title && String(entry.body_markdown || "").includes(row.text),
          );
        if (!posted) {
          failures.push(`保存された投稿「${row.title}」が見つかりません。`);
          continue;
        }
        if (!posted.published_at) {
          failures.push(`保存された投稿「${row.title}」に公開時刻がありません。`);
        }
        if (posted.source_record_id !== SOURCE_ID) {
          failures.push(`保存された投稿「${row.title}」に出所の記録IDが残っていません。`);
        }
        const converted = verify.get("capture_entry", row.captureId);
        if (converted.state !== "triaged") {
          failures.push(
            `元の記録「${row.title}」が整理済みになっていません（${converted.state}）。`,
          );
        }
        if (converted.triaged_to_type !== "feed_post" || converted.triaged_to_id !== posted.id) {
          failures.push(`元の記録「${row.title}」に投稿への整理先が残っていません。`);
        }
      }
      const leaked = verify
        .list("note")
        .filter((note) =>
          [FIRST_ROW.text, SECOND_ROW.text].some((body) =>
            String(note.body_markdown || "").includes(body),
          ),
        );
      if (leaked.length > 0) {
        failures.push("自分の投稿がNotesに残っています。");
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
