import { Notification } from "electron";

import type { WorkspaceDatabase } from "./repositories/workspaceRepository.mjs";
import { localDateString, reminderIsDueToday } from "./dateTime";
import type { Entity } from "../shared/types/workspace";
import {
  dueTaskNotices,
  pruneFiredNotices,
  scheduleDueDate,
  type TaskNotice,
} from "../shared/taskNotifications.ts";

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

  /** 期限の日の知らせは、件数が多い朝に通知を並べないよう 1 つにまとめる（1 件ならその Task を開く）。 */
  function showDueNotices(notices: TaskNotice[]): void {
    if (notices.length === 0) return;
    const taskIds = [...new Set(notices.map((notice) => notice.taskId))];
    const titles = [...new Set(notices.map((notice) => notice.title))];
    showNotification({
      id: notices.map((notice) => notice.key).join("|"),
      title: taskIds.length === 1 ? "今日が期限" : `今日が期限 ${taskIds.length} 件`,
      body:
        titles.slice(0, 3).join("\n") + (titles.length > 3 ? `\nほか ${titles.length - 3} 件` : ""),
      onClick: taskIds.length === 1 ? () => options.openTask(taskIds[0]) : options.showMainWindow,
    });
  }

  /**
   * 時刻を付けた Task と、期限の日の Task を知らせる（決まりは shared/taskNotifications.ts）。
   * 出した知らせは端末に控える。アプリを起こし直しても、同じ知らせを 2 度は出さない。
   */
  function checkTasks(): void {
    const now = new Date();
    const dueDates = new Map<string, string>();
    for (const schedule of options.repository.list("schedule") as Entity[]) {
      const dueDate = schedule.owner_type === "task" ? scheduleDueDate(schedule) : "";
      if (dueDate) dueDates.set(String(schedule.owner_id), dueDate);
    }
    const notices = dueTaskNotices({
      tasks: options.repository.list("task") as Entity[],
      dueDates,
      dueTimes: options.repository.getPreference("dueNotificationTimes") as string[],
      now,
    });
    if (notices.length === 0) return;
    const fired = pruneFiredNotices(
      options.repository.getPreference("taskNotificationsFired") as Record<string, unknown>,
      now,
    );
    const fresh = notices.filter((notice) => !fired[notice.key]);
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
    showDueNotices(fresh.filter((entry) => entry.kind === "due"));
    const today = localDateString(now);
    for (const notice of fresh) fired[notice.key] = today;
    options.repository.setPreference("taskNotificationsFired", fired);
  }

  function check(): void {
    checkTasks();
    for (const waiting of options.repository.list("waiting") as Entity[]) {
      const at = reminderIsDueToday(waiting.check_reminder_at);
      if (!at || waiting.state === "received" || waiting.state === "cancelled") continue;
      showNotification({
        id: `waiting:${String(waiting.id)}:${at}`,
        title: "Tasken 確認リマインダー",
        body: String(waiting.title || "無題の待ち"),
        onClick: options.showMainWindow,
      });
    }
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
