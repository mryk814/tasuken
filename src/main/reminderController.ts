import { Notification } from "electron";

import type { WorkspaceDatabase } from "./repositories/workspaceRepository.mjs";
import { localDateString } from "./dateTime";
import type { Entity } from "../shared/types/workspace";
import {
  dueNoticeLine,
  dueTaskNotices,
  endNoticeTitle,
  unfiredNotices,
  type TaskNotice,
  type TaskNoticeEnd,
} from "../shared/taskNotifications.ts";
import { scheduleEnd } from "../shared/scheduleSemantics.mjs";

const REMINDER_CHECK_INTERVAL_MS = 60000;

interface ReminderControllerOptions {
  repository: InstanceType<typeof WorkspaceDatabase>;
  getAppIconPath: () => string;
  openTask: (taskId: string) => void;
  showMainWindow: () => void;
}

export interface ReminderController {
  start: () => void;
  stop: () => void;
}

export function createReminderController(options: ReminderControllerOptions): ReminderController {
  let checkTimer: ReturnType<typeof setInterval> | null = null;
  const notifiedIds = new Set<string>();

  function showNotification(alert: {
    id: string;
    title: string;
    body: string;
    onClick?: () => void;
  }): void {
    if (!Notification.isSupported() || notifiedIds.has(alert.id)) return;
    notifiedIds.add(alert.id);
    const notification = new Notification({
      title: alert.title,
      body: alert.body,
      icon: options.getAppIconPath(),
    });
    if (alert.onClick) notification.on("click", alert.onClick);
    notification.show();
  }

  /**
   * 期限の日の知らせは、件数が多い朝に通知を並べないよう 1 つにまとめる（1 件ならその Task を開く）。
   * 「今日が期限」と、時刻の早い期限を前の日に知らせる「明日が期限」（#785）は別にまとめる。
   */
  function showDueNotices(notices: TaskNotice[]): void {
    for (const day of ["today", "tomorrow"] as const) {
      const group = notices.filter((notice) => (notice.dueDay || "today") === day);
      if (group.length === 0) continue;
      const label = day === "today" ? "今日が期限" : "明日が期限";
      const taskIds = [...new Set(group.map((notice) => notice.taskId))];
      const lines = [...new Set(group.map(dueNoticeLine))];
      showNotification({
        id: group.map((notice) => notice.key).join("|"),
        title: taskIds.length === 1 ? label : `${label} ${taskIds.length} 件`,
        body:
          lines.slice(0, 3).join("\n") + (lines.length > 3 ? `\nほか ${lines.length - 3} 件` : ""),
        onClick: taskIds.length === 1 ? () => options.openTask(taskIds[0]) : options.showMainWindow,
      });
    }
  }

  /**
   * 時刻を付けた Task と、期限の日の Task を知らせる（決まりは shared/taskNotifications.ts）。
   * 出した知らせは端末に控える。アプリを起こし直しても、同じ知らせを 2 度は出さない。
   */
  function checkTasks(): void {
    const now = new Date();
    const dueDates = new Map<string, TaskNoticeEnd>();
    for (const schedule of options.repository.list("schedule") as Entity[]) {
      const end = schedule.owner_type === "task" ? scheduleEnd(schedule) : null;
      if (end) dueDates.set(String(schedule.owner_id), end);
    }
    const notices = dueTaskNotices({
      tasks: options.repository.list("task") as Entity[],
      dueDates,
      dueTimes: options.repository.getPreference("dueNotificationTimes") as string[],
      now,
    });
    const { fresh, fired, started } = unfiredNotices(
      options.repository.getPreference("taskNotificationsFired") as Record<string, unknown>,
      notices,
      now,
    );
    if (started) {
      // 控えを使い始める最初の回は、今より前の知らせを鳴らさずに控えだけ作る。
      options.repository.setPreference("taskNotificationsFired", fired);
      return;
    }
    if (fresh.length === 0) return;
    // 通知を出せない環境では控えない（出せるようになった時に知らせる）。
    if (!Notification.isSupported()) return;
    for (const notice of fresh.filter((entry) => entry.kind === "time")) {
      showNotification({
        id: notice.key,
        title: "Tasken リマインダー",
        body: notice.title,
        onClick: () => options.openTask(notice.taskId),
      });
    }
    // 期限の時刻の N 分前（#785）は、時刻と同じく 1 件ずつ出す（押すとその Task を開く）。
    for (const notice of fresh.filter((entry) => entry.kind === "end")) {
      showNotification({
        id: notice.key,
        title: endNoticeTitle(notice, now),
        body: dueNoticeLine(notice),
        onClick: () => options.openTask(notice.taskId),
      });
    }
    showDueNotices(fresh.filter((entry) => entry.kind === "due"));
    const today = localDateString(now);
    for (const notice of fresh) fired[notice.key] = today;
    options.repository.setPreference("taskNotificationsFired", fired);
  }

  // 待ちの確認の通知は外した。待ちの確認の時刻は、待ちを Task に写す時に Task の
  // リマインダーへ移し、上の Task の知らせが鳴らす（#755 束7）。
  function check(): void {
    checkTasks();
  }

  return {
    start() {
      if (checkTimer) return;
      check();
      checkTimer = setInterval(check, REMINDER_CHECK_INTERVAL_MS);
    },
    stop() {
      if (!checkTimer) return;
      clearInterval(checkTimer);
      checkTimer = null;
    },
  };
}
