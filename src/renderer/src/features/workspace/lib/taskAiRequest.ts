type RequestTask = {
  id: string;
  title?: unknown;
  intended_executor?: unknown;
  work_state?: unknown;
  state?: unknown;
};

/** Handoffで確認した依頼内容（#598）。コピーする依頼とContext Previewは同じ参照を指す。 */
export type HandoffRequestInfo = {
  /** 任せる相手の表示名。 */
  delegateLabel?: string | null;
  /** 期待する成果。任意。 */
  expectedResult?: string | null;
  /** 追加指示。任意。 */
  instruction?: string | null;
  /** 確認したContext Previewの参照版。 */
  contextRef?: string | null;
};

export function buildTaskAiRequest(tasks: RequestTask[], handoff?: HandoffRequestInfo): string {
  const delegate = String(handoff?.delegateLabel || "").trim();
  const expectedResult = String(handoff?.expectedResult || "").trim();
  const instruction = String(handoff?.instruction || "").trim();
  const contextRef = String(handoff?.contextRef || "").trim();
  return [
    "次のTaskをTasken MCPで確認し、作業してください。",
    ...tasks.map((task) => `Task ID: ${task.id}\nタイトル: ${String(task.title || "")}`),
    ...(delegate ? ["", `任せる相手: ${delegate}`] : []),
    ...(expectedResult ? ["", "期待する成果:", expectedResult] : []),
    ...(instruction ? ["", "追加指示:", instruction] : []),
    ...(contextRef
      ? [
          "",
          "Taskenで確認したContextの参照版:",
          contextRef,
          "この参照版と異なるContextが返った場合は、勝手に作業を進めず知らせてください。",
        ]
      : []),
    "",
    "1. 各Taskの tasken.get_task_context に task_id を渡し、公開Context・完了条件・作業対象を確認してください。MCPに接続できない場合は作業を始めず知らせてください。",
    "2. AI Readyを確認し、取得したversionをexpected_versionに指定して tasken.start_task_work を明示的に呼んでから着手してください。開始に失敗したら再取得して状態を確認してください。",
    "3. start_task_workが返した最新のTask versionを以後のexpected_versionに使ってください。通常は完了時に tasken.report_task_done を一度だけ送り、結果・検証・残作業とAI作業終了時刻reported_atを報告してください。完了直前の tasken.append_work_receipt は不要です。長期作業で残す必要がある途中経過だけappend_work_receipt、人の対応が必要な中断だけ tasken.report_task_blocked を使ってください。同じ報告を再送するときは同じidempotency_key・日時・内容を維持してください。完了報告の後で追報告が必要になったら、新しいidempotency_keyで送ると同じTaskに積まれ、Agent Deskでまとめて確認できます。",
    "4. 検証できたチェック項目はget_task_contextで取得したIDをcompleted_checklist_item_idsに含めてください。チェック反映には最新expected_versionが必要です。報告はProposalとして人がAgent Deskで採用して正式保存されます。Taskの完了は人が別途判断します。採用後やTask完了後もContextを再取得し、append_work_receiptで追加報告できます。",
  ].join("\n");
}

function isAiReady(task: RequestTask | undefined): boolean {
  return Boolean(
    task &&
    task.state !== "done" &&
    task.state !== "cancelled" &&
    task.intended_executor === "ai_agent" &&
    (!task.work_state || task.work_state === "ready_for_agent"),
  );
}

// 呼び出し元は保存成功後の正式Taskだけを渡す。クリップボード失敗は保存失敗にしない。
export async function copyNewAiReadyRequests(
  previousTasks: RequestTask[],
  savedTasks: RequestTask[],
  copyText: (text: string) => Promise<unknown>,
): Promise<{ message: string; tone: "success" | "warning" } | null> {
  const readyTasks = savedTasks.filter(
    (task) =>
      isAiReady(task) && !isAiReady(previousTasks.find((previous) => previous.id === task.id)),
  );
  if (!readyTasks.length) return null;
  try {
    await copyText(buildTaskAiRequest(readyTasks));
    return {
      message: "AI Readyにして依頼文をコピーしました。Tasken MCPに接続したAIへ貼り付けてください。",
      tone: "success",
    };
  } catch {
    return {
      message:
        "AI Readyは保存しましたが、依頼文をコピーできませんでした。タスク詳細の「依頼文をコピー」から再試行してください。",
      tone: "warning",
    };
  }
}
