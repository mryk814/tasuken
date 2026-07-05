export type DailyLoopStepId = "morning" | "daytime" | "learning" | "evening" | "weekly";
export type DailyLoopStepState = "ready" | "active" | "done" | "attention";

export interface DailyLoopInput {
  todayTaskCount: number;
  timedTaskCount: number;
  timeboxConflictCount: number;
  reminderCount: number;
  completedTodayCount: number;
  learningTodayCount: number;
  activityLogItemCount: number;
  weeklyThemeCount: number;
}

export interface DailyLoopStep {
  id: DailyLoopStepId;
  label: string;
  metric: string;
  state: DailyLoopStepState;
}

export interface DailyLoopSummary {
  steps: DailyLoopStep[];
}

export async function openTodayMini(
  api: { showTodayMiniWindow(): Promise<boolean> },
  setToast: (message: string, tone?: "info" | "success" | "warning" | "danger") => void,
): Promise<void> {
  const opened = await api.showTodayMiniWindow();
  setToast(opened ? "Today miniを開きました。" : "Today miniを開けませんでした。", opened ? "success" : "danger");
}

function countLabel(count: number, unit: string): string {
  return `${count}${unit}`;
}

export function buildDailyLoopSummary(input: DailyLoopInput): DailyLoopSummary {
  const morningState: DailyLoopStepState = input.todayTaskCount > 0 ? "active" : "ready";
  const daytimeState: DailyLoopStepState = input.timeboxConflictCount > 0 ? "attention" : input.todayTaskCount > 0 ? "active" : "ready";
  const learningState: DailyLoopStepState = input.learningTodayCount > 0 ? "done" : input.completedTodayCount > 0 ? "active" : "ready";
  const eveningState: DailyLoopStepState = input.activityLogItemCount > 0 || input.reminderCount > 0 ? "active" : "ready";
  const weeklyState: DailyLoopStepState = input.weeklyThemeCount > 0 ? "active" : "ready";

  return {
    steps: [
      {
        id: "morning",
        label: "朝の計画",
        metric: input.todayTaskCount > 0 ? countLabel(input.todayTaskCount, "件をTodayへ") : "未計画",
        state: morningState,
      },
      {
        id: "daytime",
        label: "日中の実行",
        metric: input.todayTaskCount > 0 ? `${input.timedTaskCount}/${input.todayTaskCount} 時刻あり` : "miniで進める",
        state: daytimeState,
      },
      {
        id: "learning",
        label: "学び",
        metric: input.learningTodayCount > 0 ? `学び${input.learningTodayCount}件` : input.completedTodayCount > 0 ? `完了${input.completedTodayCount}件` : "未記録",
        state: learningState,
      },
      {
        id: "evening",
        label: "活動ログ",
        metric: input.activityLogItemCount > 0 ? `${input.activityLogItemCount}件をログ化` : "出力待ち",
        state: eveningState,
      },
      {
        id: "weekly",
        label: "週次Theme",
        metric: input.weeklyThemeCount > 0 ? `${input.weeklyThemeCount} Theme` : "振り返り待ち",
        state: weeklyState,
      },
    ],
  };
}
