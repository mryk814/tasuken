/**
 * Task詳細のAIへ任せる（Handoff #598）の実動監査
 *
 * 一時userDataへ架空のTaskを仕込んでからアプリを起動し、
 * Context Previewが出ること、準備後に「開始待ち」になり、working扱いしないことを実測する。
 *
 *   npm run build && npm run audit:handoff
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// playwrightはprocess.envを引き継ぐ。起動するElectronがNodeモードにならないよう外す。
delete process.env.ELECTRON_RUN_AS_NODE;

const OUT_DIR = process.argv[2] || "output/playwright/task-handoff-audit";
const ZOOM_STORAGE_KEY = "tasken:shell:zoom-factor:v1";

mkdirSync(OUT_DIR, { recursive: true });
const userDataDir = mkdtempSync(path.join(os.tmpdir(), "tasken-handoff-audit-"));
const failures = [];
const { WorkspaceDatabase } = await import("../src/main/repositories/workspaceRepository.mjs");

const seed = new WorkspaceDatabase(path.join(userDataDir, "research-desk.sqlite"));
seed.loadWorkspace();
seed.save("task", {
  id: "handoff-audit-task",
  title: "粘度測定の条件を決める",
  state: "todo",
  project_id: "theme-personal-default",
  description: "25℃と40℃の比較を進める。",
  priority: "normal",
});
seed.db.close();

const app = await electron.launch({
  args: [".", "--disable-gpu", "--disable-gpu-compositing", `--user-data-dir=${userDataDir}`],
});
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key, JSON.stringify(value)),
    [ZOOM_STORAGE_KEY, 1],
  );
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3500);

  const todo = page.locator(".sidebar button", { hasText: "ToDo" }).first();
  if (!(await todo.count())) throw new Error("SidebarにToDoの入口がありません。");
  await todo.click();
  await page.waitForTimeout(1200);

  // Task行から詳細を開く。
  const row = page.locator(".table-row", { hasText: "粘度測定の条件を決める" });
  await row.first().click();
  await page.waitForTimeout(1200);

  const panel = page.locator(".task-handoff");
  if (!(await panel.count())) throw new Error("Task詳細にAIへ任せるpanelがありません。");

  const panelText = (await panel.innerText()).replace(/\s+/g, " ");
  for (const label of ["AIへ任せる", "任せる相手", "期待する成果", "追加指示", "Context Preview"]) {
    if (!panelText.includes(label)) failures.push(`panelに「${label}」がありません。`);
  }
  if (!panelText.includes("準備しても外部AIは自動で起動しません")) {
    failures.push("外部AIを起動しない旨の注意書きがありません。");
  }
  if (!(await panel.locator("select").count())) failures.push("任せる相手の選択がありません。");
  const previewText = await panel.locator(".task-handoff-preview").innerText();
  if (!previewText.trim()) failures.push("Context Previewが空です。");
  await page.screenshot({ path: `${OUT_DIR}/handoff-open.png`, fullPage: true });

  // 期待する成果と追加指示を入れて準備する。
  await panel.locator("textarea").first().fill("3条件の比較表と、採用した根拠");
  await panel.locator("textarea").nth(1).fill("既存の測定条件は変えない");
  await panel.locator("button", { hasText: "AIへの依頼を準備" }).first().click();
  await page.waitForTimeout(2500);

  const afterText = (await page.locator(".task-handoff").innerText()).replace(/\s+/g, " ");
  if (!afterText.includes("開始待ち")) {
    failures.push(`準備後に「開始待ち」になっていません: ${afterText.slice(0, 200)}`);
  }
  if (afterText.includes("作業中")) {
    failures.push("agentの開始報告が無いのに「作業中」と表示しています。");
  }
  await page.screenshot({ path: `${OUT_DIR}/handoff-prepared.png`, fullPage: true });

  // 再起動しても依頼内容と開始待ちが残る。
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3500);
  await page.locator(".table-row", { hasText: "粘度測定の条件を決める" }).first().click();
  await page.waitForTimeout(1200);
  const reloaded = (await page.locator(".task-handoff").innerText()).replace(/\s+/g, " ");
  if (!reloaded.includes("開始待ち")) failures.push("再起動後に「開始待ち」が失われています。");
  const expectedValue = await page.locator(".task-handoff textarea").first().inputValue();
  if (!expectedValue.includes("3条件の比較表と、採用した根拠")) {
    failures.push(`再起動後に期待する成果が失われています: ${expectedValue}`);
  }
  const instructionValue = await page.locator(".task-handoff textarea").nth(1).inputValue();
  if (!instructionValue.includes("既存の測定条件は変えない")) {
    failures.push("再起動後に追加指示が失われています。");
  }
  await page.screenshot({ path: `${OUT_DIR}/handoff-after-reload.png`, fullPage: true });
} finally {
  await app.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`Handoff監査で${failures.length}件の問題を検出しました。`);
  for (const failure of failures) console.error(`  NG ${failure}`);
  console.error(`スクリーンショット: ${OUT_DIR}`);
  process.exit(1);
}
console.log(`Handoff監査: OK（スクリーンショットは ${OUT_DIR}）`);
