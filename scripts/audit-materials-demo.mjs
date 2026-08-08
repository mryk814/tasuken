/**
 * ローカルの材料MI開発Workspaceを、実Electronの主要画面で確認する。
 * `npm run build && npm run rebuild:electron && npm run audit:materials-demo`
 */
import { _electron as electron } from "playwright";
import fs from "node:fs";
import path from "node:path";

const outputDirectory = process.argv[2] || "output/playwright/materials-demo";
const routes = [
  { label: "Today", expected: ["実験室安全点検チェックシートを提出", "予測区間のcoverage低下を調べる", "継続中"] },
  { label: "ToDo", expected: ["候補バッチ #2を合成・焼成", "強度・導電率のPareto frontを再計算"] },
  { label: "Inbox", expected: ["炉位置の交絡？", "Alレビュー資料の単位", "XRD装置メモ"] },
  { label: "Timeline", expected: ["2026年度 LLZO探索サイクル", "Active learning cycle 2", "研究会 中間報告"] },
  { label: "Themes", navLabel: "All Themes", expected: ["Ta置換LLZO 固体電解質探索", "再生Al-Mg-Si 熱処理最適化", "個人業務"] },
  { label: "Notes", expected: ["GP-EI v4 モデル診断", "候補バッチ #2 実験計画"] },
  { label: "Knowledge", expected: ["L2407-Bの予測ずれは原料差か炉位置差か？", "ロットを跨ぐとGPの不確かさが過小評価される"] },
  { label: "Sketch", expected: ["ベイズ最適化の実験ループ", "LLZO焼結プロセスと記録ポイント"] },
  { label: "Chat Refs", expected: ["XRD相ラベルの判定基準レビュー", "LLZO / data curation"] },
  { label: "Artifacts", expected: ["screening-results.csv", "candidate-batch.json", "al-lot-ledger.xlsx"] },
  { label: "AI Inbox", expected: [] },
];

fs.mkdirSync(outputDirectory, { recursive: true });
const app = await electron.launch({ args: [".", "--disable-gpu", "--disable-gpu-compositing"] });
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(4500);

const failures = [];
const results = [];
const entityCounts = await page.evaluate(async () => Object.fromEntries(await Promise.all([
  "theme", "task", "schedule", "note", "resource", "knowledge_node", "artifact", "sketch", "ai_proposal",
].map(async (type) => [type, (await window.api.entities.list(type)).length]))));
const hasUpdatedExperiment = await page.evaluate(async () => (await window.api.entities.list("task"))
  .some((entry) => entry.title === "候補バッチ 2026-08-08 の焼成後密度を測定"));
if (hasUpdatedExperiment) {
  routes.find((route) => route.label === "Today")?.expected.push("候補バッチ 2026-08-08 の焼成後密度を測定");
  routes.find((route) => route.label === "ToDo")?.expected.push("候補バッチ 2026-08-08 の焼成後密度を測定");
  routes.find((route) => route.label === "Inbox")?.expected.push("候補2 ペレット表面");
  routes.find((route) => route.label === "Notes")?.expected.push("候補バッチ 2026-08-08 実験ログ");
}
const expectedCounts = { theme: 3, task: 22, schedule: 28, note: 12, resource: 6, knowledge_node: 9, artifact: 5, sketch: 2, ai_proposal: 2 };
for (const [type, expected] of Object.entries(expectedCounts)) {
  if (entityCounts[type] < expected) failures.push(`${type}: ${entityCounts[type]}件（最低 ${expected}件）`);
}
async function visibleText() {
  const body = await page.locator("body").innerText();
  const inputs = await page.locator("input, textarea").evaluateAll((elements) => elements.map((element) => element.value).filter(Boolean));
  return `${body}\n${inputs.join("\n")}`;
}
for (const route of routes) {
  const button = page.locator(".sidebar button", { hasText: route.navLabel || route.label }).first();
  if (!(await button.count())) {
    failures.push(`${route.label}: Sidebar導線がありません。`);
    continue;
  }
  await button.click();
  await page.waitForTimeout(["Inbox", "Notes", "Knowledge"].includes(route.label) ? 1800 : 950);
  if (route.label === "Notes") {
    const allFilter = page.getByRole("button", { name: "すべて", exact: true }).first();
    await allFilter.click();
    await page.waitForTimeout(700);
  }
  const bodyText = await visibleText();
  const missing = route.expected.filter((text) => !bodyText.includes(text));
  if (missing.length) failures.push(`${route.label}: 表示されない具体例: ${missing.join(" / ")}`);
  results.push({ route: route.label, found: route.expected.length - missing.length, expected: route.expected.length, missing });
  await page.screenshot({ path: path.join(outputDirectory, `${route.label.toLowerCase().replaceAll(" ", "-")}.png`), fullPage: false });
  if (route.label === "Notes") {
    const reportFilter = page.getByRole("button", { name: "Report", exact: true });
    await reportFilter.click();
    await page.waitForTimeout(700);
    const reportText = await visibleText();
    if (!reportText.includes("Ta置換LLZO 週報 2026-W32")) failures.push("Notes: Reportフィルタに週報が表示されません。");
  }
}

await page.reload();
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(3500);
const reloadedText = await page.locator("body").innerText();
if (!reloadedText.includes("Ta置換LLZO 固体電解質探索")) failures.push("再読み込み後にLLZO Themeを確認できません。");

console.log(JSON.stringify({ entityCounts, hasUpdatedExperiment, results, reloadPersisted: reloadedText.includes("Ta置換LLZO 固体電解質探索"), outputDirectory }, null, 2));
await app.close();

if (failures.length) {
  for (const failure of failures) console.error(`NG ${failure}`);
  process.exit(1);
}
console.log("材料MI開発Workspaceは主要11画面と再読み込みで確認できました。");
