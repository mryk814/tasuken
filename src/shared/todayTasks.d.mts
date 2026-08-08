export interface TodayTaskPolicy {
  readonly includeExecutionWindow: boolean;
  readonly includeOngoing: boolean;
  readonly includeOverdue: boolean;
  readonly includeCompleted: boolean;
}
export const TODAY_TASK_POLICY: TodayTaskPolicy;
export function selectTodayTasks(tasks: readonly object[], schedules: readonly object[], date: string, options?: TodayTaskPolicy): Array<{ task: object; schedule?: object; bucket: string }>;
