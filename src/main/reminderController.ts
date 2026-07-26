import { Notification } from "electron";

import type { WorkspaceDatabase } from "./repositories/workspaceRepository.mjs";
import { reminderIsDueToday } from "./dateTime";
import type { Entity } from "../shared/types/workspace";

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

  function showNotification(alert: { id: string; title: string; body: string; onClick?: () => void }): void {
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

  function check(): void {
    for (const task of options.repository.list("task") as Entity[]) {
      const at = reminderIsDueToday(task.reminder_at);
      if (!at || task.state === "done" || task.state === "cancelled") continue;
      const taskId = String(task.id);
      showNotification({
        id: `task:${taskId}:${at}`,
        title: "Tasken リマインダー",
        body: String(task.title || "無題のタスク"),
        onClick: () => options.openTask(taskId),
      });
    }
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
