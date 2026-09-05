type RequestTask = {
  id: string;
  title?: unknown;
  intended_executor?: unknown;
  work_state?: unknown;
  state?: unknown;
};

export function buildTaskAiRequest(tasks: RequestTask[]): string {
  return [
    "次のTaskをTasken MCPで確認し、作業してください。",
    ...tasks.map((task) => `Task ID: ${task.id}\nタイトル: ${String(task.title || "")}`),
    "",
    "1. 各Taskの tasken.get_task_context に task_id を渡し、公開Context・完了条件・作業対象を確認してください。MCPに接続できない場合は作業を始めず知らせてください。",
    "2. AI Readyを確認し、取得したversionをexpected_versionに指定して tasken.start_task_work を明示的に呼んでから着手してください。開始に失敗したら再取得して状態を確認してください。",
    "3. start_task_workが返した最新のTask versionを以後のexpected_versionに使ってください。通常は完了時に tasken.report_task_done を一度だけ送り、結果・検証・残作業とAI作業終了時刻reported_atを報告してください。完了直前の tasken.append_work_receipt は不要です。長期作業で残す必要がある途中経過だけappend_work_receipt、人の対応が必要な中断だけ tasken.report_task_blocked を使ってください。同じ報告を再送するときは同じidempotency_key・日時・内容を維持してください。",
    "4. 完了・中断の報告はProposalです。正式反映は人がAI Inboxで採用した後です。採用まで完了扱いにせず、採用後に続ける場合はContextとversionを再取得してください。",
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
