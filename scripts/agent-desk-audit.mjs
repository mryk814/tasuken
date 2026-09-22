/**
 * Agent Desk の一往復の実動監査（#599）
 *
 * 一時userDataへ「回答待ち」「成果確認」「作業中」「開始待ち」「最近の結果」を仕込んでから
 * アプリを起動し、4つの見出しと確認詳細が設計どおりに出ることを実測する。
 *
 *   npm run build && npm run audit:agent-desk
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// playwrightはprocess.envを引き継ぐ。起動するElectronがNodeモードにならないよう外す。
delete process.env.ELECTRON_RUN_AS_NODE;

const OUT_DIR = process.argv[2] || "output/playwright/agent-desk-audit";
const ZOOM_STORAGE_KEY = "tasken:shell:zoom-factor:v1";
const ATTEMPT = "11111111-1111-4111-8111-111111111111";
const REQUEST = "33333333-3333-4333-8333-333333333333";

mkdirSync(OUT_DIR, { recursive: true });
const userDataDir = mkdtempSync(path.join(os.tmpdir(), "tasken-agent-desk-audit-"));
const failures = [];
const { WorkspaceDatabase } = await import("../src/main/repositories/workspaceRepository.mjs");

const seed = new WorkspaceDatabase(path.join(userDataDir, "research-desk.sqlite"));
seed.loadWorkspace();
const theme = "theme-personal-default";
seed.save("task", {
  id: "desk-review",
  title: "比較表の作成",
  state: "doing",
  project_id: theme,
  priority: "normal",
  intended_executor: "ai_agent",
  executor_identity: "Codex",
  work_state: "needs_human_review",
  work_attempt_id: ATTEMPT,
});
seed.save("task", {
  id: "desk-question",
  title: "粘度測定の条件を決める",
  state: "doing",
  project_id: theme,
  priority: "normal",
  intended_executor: "ai_agent",
  executor_identity: "Codex",
  work_state: "blocked",
  work_attempt_id: ATTEMPT,
});
seed.save("task", {
  id: "desk-working",
  title: "劣化試験の計画",
  state: "doing",
  project_id: theme,
  priority: "normal",
  intended_executor: "ai_agent",
  executor_identity: "外部AI",
  work_state: "in_progress",
  work_attempt_id: ATTEMPT,
  work_started_at: "2026-09-20T08:00:00.000Z",
});
seed.save("task", {
  id: "desk-waiting",
  title: "粘度データの整理",
  state: "todo",
  project_id: theme,
  priority: "normal",
  intended_executor: "ai_agent",
  executor_identity: "外部AI",
  work_state: "ready_for_agent",
  handoff_requested_at: "2026-09-20T08:30:00.000Z",
});
seed.save("ai_proposal", {
  id: "desk-review-proposal",
  source: "mcp",
  source_app: "codex",
  payload_type: "task_work",
  status: "pending",
  received_at: "2026-09-20T09:20:00.000Z",
  created_at: "2026-09-20T09:20:00.000Z",
  payload: {
    task_work: [
      {
        task_id: "desk-review",
        expected_version: 2,
        action: "report_done",
        work_attempt_id: ATTEMPT,
        executor_kind: "ai_agent",
        executor_label: "Codex",
        summary: "3条件の比較表を作成しました。",
        verification: ["数値の転記誤りがないこと"],
        remaining_work: ["測定条件が妥当かは人が判断"],
        reported_at: "2026-09-20T09:20:00.000Z",
      },
    ],
  },
});
seed.save("ai_proposal", {
  id: "desk-question-proposal",
  source: "mcp",
  source_app: "codex",
  payload_type: "task_work",
  status: "pending",
  received_at: "2026-09-20T09:10:00.000Z",
  created_at: "2026-09-20T09:10:00.000Z",
  payload: {
    task_work: [
      {
        task_id: "desk-question",
        expected_version: 2,
        action: "report_blocked",
        work_attempt_id: ATTEMPT,
        executor_kind: "ai_agent",
        executor_label: "Codex",
        summary: "測定温度が決まっていません。",
        blocker: "測定温度が決まっていません。",
        needed_input: ["25℃で測定する", "40℃で測定する"],
        request_id: REQUEST,
        reported_at: "2026-09-20T09:10:00.000Z",
      },
    ],
  },
});
// 「採用してTaskを完了」用の成果報告（採用前なのでWork Receiptはまだ無い）。
seed.save("task", {
  id: "desk-complete",
  title: "劣化データの再集計",
  state: "doing",
  project_id: theme,
  priority: "normal",
  intended_executor: "ai_agent",
  executor_identity: "Codex",
  work_state: "needs_human_review",
  work_attempt_id: ATTEMPT,
});
seed.save("ai_proposal", {
  id: "desk-complete-proposal",
  source: "mcp",
  source_app: "codex",
  payload_type: "task_work",
  status: "pending",
  received_at: "2026-09-20T09:30:00.000Z",
  created_at: "2026-09-20T09:30:00.000Z",
  payload: {
    task_work: [
      {
        task_id: "desk-complete",
        expected_version: 2,
        action: "report_done",
        work_attempt_id: ATTEMPT,
        executor_kind: "ai_agent",
        executor_label: "Codex",
        summary: "再集計を終えました。",
        verification: ["再計算の一致"],
        reported_at: "2026-09-20T09:30:00.000Z",
      },
    ],
  },
});
// 「修正を依頼」用の成果報告。採用前の報告でも差戻せることを確かめる。
seed.save("task", {
  id: "desk-return",
  title: "粘度の再測定",
  state: "doing",
  project_id: theme,
  priority: "normal",
  intended_executor: "ai_agent",
  executor_identity: "Codex",
  work_state: "needs_human_review",
  work_attempt_id: ATTEMPT,
});
seed.save("ai_proposal", {
  id: "desk-return-proposal",
  source: "mcp",
  source_app: "codex",
  payload_type: "task_work",
  status: "pending",
  received_at: "2026-09-20T09:40:00.000Z",
  created_at: "2026-09-20T09:40:00.000Z",
  payload: {
    task_work: [
      {
        task_id: "desk-return",
        expected_version: 2,
        action: "report_done",
        work_attempt_id: ATTEMPT,
        executor_kind: "ai_agent",
        executor_label: "Codex",
        summary: "再測定を終えました。",
        verification: ["3回の平均"],
        reported_at: "2026-09-20T09:40:00.000Z",
      },
    ],
  },
});
// Taskに紐づかない変更案（Note提案）。対応待ちへ出るが、Taskは持たない。
seed.save("ai_proposal", {
  id: "desk-note-proposal",
  source: "mcp",
  source_app: "codex",
  payload_type: "notes",
  status: "pending",
  received_at: "2026-09-20T09:50:00.000Z",
  created_at: "2026-09-20T09:50:00.000Z",
  version: 1,
  title: "測定手順のNoteを作る案",
  summary: "測定手順のNoteを作る案",
  payload: {
    notes: [
      {
        action: "create",
        title: "測定手順の標準化",
        body: "温度を決めてから3回測る。\n\n条件は測定前に記録する。",
        theme: "",
        note_type: "memo",
        reason: "再現性のため",
      },
    ],
  },
  request: {
    idempotency_key: "desk-note-proposal",
    source: "mcp",
    tool: "tasken.propose_note",
  },
});
// 割当が変わると work_state は idle へ正規化される（正常な仕様）。
// 実運用ではStartTaskWorkが作業中を作るため、fixtureでは2回目の保存で状態を置く。
for (const [id, workState] of [
  ["desk-review", "needs_human_review"],
  ["desk-question", "blocked"],
  ["desk-working", "in_progress"],
  ["desk-complete", "needs_human_review"],
  ["desk-return", "needs_human_review"],
]) {
  seed.save("task", { ...seed.get("task", id), work_state: workState });
}
seed.db.close();
const databasePath = path.join(userDataDir, "research-desk.sqlite");

const app = await electron.launch({
  args: [".", "--disable-gpu", "--disable-gpu-compositing", `--user-data-dir=${userDataDir}`],
});
/** 画面の操作を最後まで通せたか。途中で失敗したときは保存状態を判定しない。 */
let reachedEnd = false;
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

  const nav = page.locator(".sidebar button", { hasText: "Agent Desk" }).first();
  if (!(await nav.count())) throw new Error("SidebarにAgent Deskの入口がありません。");
  await nav.click();
  await page.waitForTimeout(1200);

  const desk = page.locator(".agent-desk");
  if (!(await desk.count())) throw new Error("Agent Deskが表示されていません。");
  const headings = await page.locator(".agent-desk-section h2").allInnerTexts();
  for (const heading of ["対応待ち", "作業中", "開始待ち", "最近の結果"]) {
    if (!headings.includes(heading)) failures.push(`見出し「${heading}」がありません。`);
  }
  const listText = (await page.locator(".agent-desk-list").innerText()).replace(/\s+/g, " ");

  // 対応待ち: 質問と成果確認が判断単位で並ぶ。
  if (!listText.includes("測定温度が決まっていません。"))
    failures.push("質問が対応待ちに出ていません。");
  if (!listText.includes("3条件の比較表を作成しました。"))
    failures.push("成果報告が対応待ちに出ていません。");
  // 作業中: 経過だけで状態を変えず、最終報告を添える。
  if (!listText.includes("劣化試験の計画")) failures.push("作業中のTaskが出ていません。");
  // 開始待ち: 取得済みと偽らない。
  if (!listText.includes("粘度データの整理")) failures.push("開始待ちのTaskが出ていません。");
  if (!listText.includes("開始は未確認")) failures.push("開始待ちに「開始は未確認」がありません。");
  await page.screenshot({ path: `${OUT_DIR}/agent-desk-list.png`, fullPage: true });

  // 質問を選ぶと選択肢と返答欄が出る。
  await page.locator(".agent-desk-open", { hasText: "測定温度" }).first().click();
  await page.waitForTimeout(500);
  const questionDetail = (await page.locator(".agent-desk-detail").innerText()).replace(
    /\s+/g,
    " ",
  );
  for (const label of [
    "25℃で測定する",
    "40℃で測定する",
    "回答（選択肢がある場合も自由記述できます）",
    "回答を送る",
  ]) {
    if (!questionDetail.includes(label)) failures.push(`質問詳細に「${label}」がありません。`);
  }
  await page.screenshot({ path: `${OUT_DIR}/agent-desk-question.png`, fullPage: true });

  // 成果確認を選ぶと読み順と操作名が設計どおりになる。
  await page.locator(".agent-desk-open", { hasText: "比較表" }).first().click();
  await page.waitForTimeout(500);
  const reviewDetail = (await page.locator(".agent-desk-detail").innerText()).replace(/\s+/g, " ");
  for (const label of [
    "成果",
    "確認できたこと",
    "未確認事項",
    "Taskenへ反映する内容",
    "報告を採用",
    "修正を依頼",
    "Taskも完了する",
  ]) {
    if (!reviewDetail.includes(label)) failures.push(`成果確認に「${label}」がありません。`);
  }
  const completeChecked = await page
    .locator(".agent-desk-option input[type=checkbox]")
    .first()
    .isChecked();
  if (completeChecked) failures.push("「Taskも完了する」が最初から選ばれています。");
  const primaryLabel = (
    await page.locator(".agent-desk-detail .semantic-button-primary").first().innerText()
  ).trim();
  if (primaryLabel !== "報告を採用") {
    failures.push(`成果確認の主操作が「報告を採用」ではありません: ${primaryLabel}`);
  }
  await page.screenshot({ path: `${OUT_DIR}/agent-desk-review.png`, fullPage: true });

  // 回答を送ると要対応から外れ、Taskは完了しない。
  await page.locator(".agent-desk-open", { hasText: "測定温度" }).first().click();
  await page.waitForTimeout(400);
  await page.locator(".agent-desk-detail textarea").first().fill("25℃で進めてください。");
  await page.locator(".agent-desk-detail .semantic-button-primary").first().click();
  await page.waitForTimeout(2000);
  const afterReply = (await page.locator(".agent-desk-list").innerText()).replace(/\s+/g, " ");
  if (afterReply.includes("測定温度が決まっていません。")) {
    failures.push("回答後も質問が対応待ちに残っています。");
  }
  await page.screenshot({ path: `${OUT_DIR}/agent-desk-after-reply.png`, fullPage: true });

  // 成果確認: 「報告を採用」でReceiptが残り、Taskは継続する。
  await page.locator(".agent-desk-open", { hasText: "3条件の比較表" }).first().click();
  await page.waitForTimeout(400);
  await page.locator(".agent-desk-detail .semantic-button-primary").first().click();
  await page.waitForTimeout(1200);
  const acceptedToast = (await page.locator(".toast").first().innerText()).replace(/\s+/g, " ");
  if (!acceptedToast.includes("報告を採用しました。Taskは継続します。")) {
    failures.push(`採用の案内が違います: ${acceptedToast}`);
  }
  await page.waitForTimeout(1200);
  const afterAccept = (await page.locator(".agent-desk-list").innerText()).replace(/\s+/g, " ");
  if (afterAccept.includes("3条件の比較表を作成しました。")) {
    failures.push("採用後も成果確認が対応待ちに残っています。");
  }
  // 最近の結果は、採用しただけの報告を「Taskは継続」として読ませる。
  await page
    .locator(".agent-desk-section", { hasText: "最近の結果" })
    .locator("button", { hasText: "件" })
    .first()
    .click();
  await page.waitForTimeout(500);
  const recent = (await page.locator(".agent-desk-list").innerText()).replace(/\s+/g, " ");
  if (!recent.includes("受入れ済み／Taskは継続")) {
    failures.push("採用しただけの報告が最近の結果に出ていません。");
  }
  await page.screenshot({ path: `${OUT_DIR}/agent-desk-after-accept.png`, fullPage: true });

  // 「Taskも完了する」を選ぶと主操作が変わり、Taskが完了する。
  await page.locator(".agent-desk-open", { hasText: "再集計" }).first().click();
  await page.waitForTimeout(400);
  await page.locator(".agent-desk-option input[type=checkbox]").first().check();
  await page.waitForTimeout(300);
  const completeLabel = (
    await page.locator(".agent-desk-detail .semantic-button-primary").first().innerText()
  ).trim();
  if (completeLabel !== "採用してTaskを完了") {
    failures.push(`完了を選んだときの主操作が違います: ${completeLabel}`);
  }
  await page.locator(".agent-desk-detail .semantic-button-primary").first().click();
  await page.waitForTimeout(2500);
  const recentCompleted = (await page.locator(".agent-desk-list").innerText()).replace(/\s+/g, " ");
  if (!recentCompleted.includes("受入れ済み／Task完了")) {
    failures.push("採用して完了したTaskが最近の結果で完了になっていません。");
  }
  await page.screenshot({ path: `${OUT_DIR}/agent-desk-after-complete.png`, fullPage: true });

  // 修正を依頼: 採用前の報告でも差戻せて、Taskは開始待ちへ戻る。
  await page.locator(".agent-desk-open", { hasText: "再測定" }).first().click();
  await page.waitForTimeout(400);
  await page.locator("#agent-desk-return-note").fill("検証の条件を明記してください。");
  await page.locator(".agent-desk-return button", { hasText: "修正を依頼" }).first().click();
  await page.waitForTimeout(1200);
  const returnToast = (await page.locator(".toast").first().innerText()).replace(/\s+/g, " ");
  if (!returnToast.includes("修正を依頼しました。Taskは継続します。")) {
    failures.push(`差戻しの案内が違います: ${returnToast}`);
  }
  await page.waitForTimeout(1300);
  const afterReturn = (await page.locator(".agent-desk-list").innerText()).replace(/\s+/g, " ");
  if (afterReturn.includes("再測定を終えました。")) {
    failures.push("差戻し後も成果確認が対応待ちに残っています。");
  }
  if (!afterReturn.includes("粘度の再測定")) {
    failures.push("差戻し後のTaskが開始待ちに出ていません。");
  }
  await page.screenshot({ path: `${OUT_DIR}/agent-desk-after-return.png`, fullPage: true });

  // Taskに紐づかない変更案も、対応待ちから中身を確認して却下できる（#600/#602）。
  const proposalList = (await page.locator(".agent-desk-list").innerText()).replace(/\s+/g, " ");
  if (!proposalList.includes("Noteの変更案")) {
    failures.push("Taskなしの変更案が対応待ちに出ていません。");
  }
  await page.locator(".agent-desk-open", { hasText: "Noteの変更案" }).first().click();
  await page.waitForTimeout(600);
  const noteDetail = (await page.locator(".agent-desk-detail").innerText()).replace(/\s+/g, " ");
  if (!noteDetail.includes("この変更案を却下")) {
    failures.push(`変更案の却下操作がありません: ${noteDetail.slice(0, 160)}`);
  }
  // 中身は同じ面の「AIの提案」で確認できる。Taskなしでもpreviewが出る。
  const proposalPanel = page.locator(".proposal-inbox-panel");
  if (!(await proposalPanel.count())) {
    failures.push("同じ面に「AIの提案」の確認がありません。");
  } else {
    await proposalPanel.locator(".proposal-row-select").first().click();
    await page.waitForTimeout(800);
    const previewText = (await proposalPanel.innerText()).replace(/\s+/g, " ");
    if (!previewText.includes("測定手順の標準化")) {
      failures.push("変更案のpreviewが中身を表示していません。");
    }
    await page.screenshot({ path: `${OUT_DIR}/agent-desk-note-proposal.png`, fullPage: true });
  }

  // 対応待ちから却下すると、提案待ちからも消える。
  await page.locator(".agent-desk-open", { hasText: "Noteの変更案" }).first().click();
  await page.waitForTimeout(500);
  await page.locator(".agent-desk-detail .semantic-button-primary").first().click();
  await page.waitForTimeout(2200);
  const afterReject = (await page.locator(".agent-desk-list").innerText()).replace(/\s+/g, " ");
  if (afterReject.includes("Noteの変更案")) {
    failures.push("却下後も変更案が対応待ちに残っています。");
  }
  await page.screenshot({ path: `${OUT_DIR}/agent-desk-after-reject.png`, fullPage: true });

  // 狭幅でも横スクロールしない。
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 680));
  await page.waitForTimeout(700);
  const overflowing = await page.evaluate(() => {
    const found = [];
    for (const element of document.querySelectorAll(".main-area, .main-area *")) {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0) {
        found.push(
          `${element.tagName.toLowerCase()}.${(element.className?.toString?.() || "").slice(0, 40)}`,
        );
      }
    }
    return found;
  });
  if (overflowing.length) failures.push(`狭幅で横あふれ: ${overflowing.join(", ")}`);
  await page.screenshot({ path: `${OUT_DIR}/agent-desk-min-980.png`, fullPage: true });
  reachedEnd = true;
} finally {
  await app.close();
  // 画面の操作が正式データへ残ったかを、同じworkspaceを開き直して確かめる。
  if (reachedEnd) {
    const verify = new WorkspaceDatabase(databasePath);
    try {
      verify.loadWorkspace();
      const taskOf = (id) => verify.get("task", id);
      const receiptsOf = (taskId) =>
        verify.list("work_receipt").filter((receipt) => receipt.task_id === taskId);

      // 採用しただけのTaskは完了しない。
      if (
        taskOf("desk-review").state !== "doing" ||
        taskOf("desk-review").work_state !== "accepted"
      ) {
        failures.push("採用しただけのTaskが完了しています。");
      }
      if (receiptsOf("desk-review").length !== 1) {
        failures.push(
          `採用した報告のReceiptが1件ではありません（${receiptsOf("desk-review").length}件）。`,
        );
      }
      // 採用して完了したTaskは完了する。
      if (
        taskOf("desk-complete").state !== "done" ||
        taskOf("desk-complete").work_state !== "accepted"
      ) {
        failures.push("採用して完了したTaskが完了していません。");
      }
      // 差戻しは理由を残して開始待ちへ戻し、Receiptを作らない。
      const returned = taskOf("desk-return");
      if (returned.work_state !== "ready_for_agent") {
        failures.push(`差戻し後のwork_stateが違います（${returned.work_state}）。`);
      }
      if (returned.work_review_note !== "検証の条件を明記してください。") {
        failures.push(`差戻し理由が残っていません（${returned.work_review_note}）。`);
      }
      if (returned.work_reported_at || returned.state === "done") {
        failures.push("差戻し後もTaskが報告済み・完了のままです。");
      }
      if (receiptsOf("desk-return").length !== 0) {
        failures.push("差戻しでReceiptが作られています。");
      }
      const returnedProposal = verify.get("ai_proposal", "desk-return-proposal");
      if (
        returnedProposal.status !== "rejected" ||
        !String(returnedProposal.quarantine_reason || "").startsWith("差戻し:")
      ) {
        failures.push("差戻したProposalが要対応として残っています。");
      }
      // 回答はReceiptとして残り、Taskは停止中のまま（再開待ち）。
      if (taskOf("desk-question").work_state !== "blocked") {
        failures.push("回答でTaskの作業状態が変わっています。");
      }
      if (!receiptsOf("desk-question").some((receipt) => receipt.receipt_kind === "human_reply")) {
        failures.push("回答がReceiptとして残っていません。");
      }
      // Taskなしの変更案は却下として決着し、Taskは作らない。
      const decidedNote = verify.get("ai_proposal", "desk-note-proposal");
      if (decidedNote.status !== "rejected") {
        failures.push(`Taskなしの変更案が却下されていません（${decidedNote.status}）。`);
      }
      if (verify.list("note").some((note) => note.title === "測定手順の標準化")) {
        failures.push("却下した変更案からNoteが作られています。");
      }
    } finally {
      verify.db.close();
    }
  }
  rmSync(userDataDir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`Agent Desk監査で${failures.length}件の問題を検出しました。`);
  for (const failure of failures) console.error(`  NG ${failure}`);
  console.error(`スクリーンショット: ${OUT_DIR}`);
  process.exit(1);
}
console.log(`Agent Desk監査: OK（スクリーンショットは ${OUT_DIR}）`);
