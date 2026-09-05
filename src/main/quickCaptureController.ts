import { BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { localDateString, localDateTimeString } from "./dateTime";
import type { WorkspaceDatabase } from "./repositories/workspaceRepository.mjs";
import type { Entity, EntityType } from "../shared/types/workspace";
import {
  firstCaptureUrl,
  parseQuickCaptureSchedule,
  quickCaptureContentType,
  quickCaptureScheduleLabel,
  quickCaptureTitle,
  splitQuickCaptureInput,
} from "../shared/quickCapture.mjs";
import { canonicalThemeId } from "../shared/themeRef.mjs";
import type { CommandEnvelope, CommandReceipt } from "../shared/applicationCommand";
import { IPC } from "../shared/ipc/contracts";
import {
  mobileCaptureOrganizationRequestSchema,
  mobileCaptureOrganizationSchema,
} from "../shared/contracts/mobile/public";
import type { CaptureOrganizerInput, CaptureOrganizerProposal } from "./gateway/mobile/public";

export type QuickCaptureMode = "inbox" | "today-task" | "micro-memo" | "done-task";

interface QuickCaptureControllerOptions {
  repository: InstanceType<typeof WorkspaceDatabase>;
  notifyWorkspaceChanged: (
    change:
      | { type: EntityType; entity: Entity }
      | { entities: Array<{ type: EntityType; entity: Entity }> },
  ) => void;
  notifyCommandApplied: (receipt: CommandReceipt, senderId: number) => void;
  executeCommand: (envelope: CommandEnvelope) => CommandReceipt;
  organizeCapture?: (input: CaptureOrganizerInput) => Promise<CaptureOrganizerProposal>;
}

type QuickCaptureScheduleParse =
  | { ok: false; message: string }
  | { ok: true; kind: "single"; date: string; time: string }
  | {
      ok: true;
      kind: "range";
      startDate: string;
      endDate: string;
      rangeSemantics: "once_within_window" | "ongoing";
      ambiguous: boolean;
    };

function parseSchedule(expression: string, today: string): QuickCaptureScheduleParse {
  return parseQuickCaptureSchedule(expression, today) as unknown as QuickCaptureScheduleParse;
}

export interface QuickCaptureController {
  getWindow: () => BrowserWindow | null;
  show: (mode?: QuickCaptureMode) => void;
  registerIpc: () => void;
  menuItems: () => Electron.MenuItemConstructorOptions[];
}

export function createQuickCaptureController(
  options: QuickCaptureControllerOptions,
): QuickCaptureController {
  let captureWindow: BrowserWindow | null = null;

  function createWindow(): BrowserWindow {
    const win = new BrowserWindow({
      width: 420,
      // 期限の解釈結果を出す1行ぶんを含めた高さ（#308）。
      height: 284,
      show: false,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: false,
      backgroundColor: "#F4EEEC",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        // TODO: sandbox:true breaks the ESM preload bridge in the current smoke path.
        sandbox: false,
        preload: path.join(__dirname, "../preload/capture.mjs"),
      },
    });

    if (process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/capture.html`);
    } else {
      void win.loadFile(path.join(__dirname, "../renderer/capture.html"));
    }

    win.on("blur", () => {
      if (win.isVisible()) win.hide();
    });
    return win;
  }

  function sendWindowState(win: BrowserWindow, mode: QuickCaptureMode): void {
    const themeMode = options.repository.getPreference("themeMode") ?? "light";
    const themes = [
      ...(options.repository.list("theme") as Entity[]).map((theme) => ({
        id: theme.id,
        name: String(theme.name || theme.title || "Theme"),
      })),
      ...(options.repository.list("project") as Entity[]).map((project) => ({
        id: project.id,
        name: String(project.name || project.title || "Theme"),
      })),
    ];
    const uniqueThemes = [...new Map(themes.map((theme) => [theme.id, theme])).values()].sort(
      (a, b) => a.name.localeCompare(b.name, "ja-JP"),
    );
    win.webContents.send(IPC.quickCaptureTheme, themeMode);
    win.webContents.send(IPC.quickCaptureThemes, uniqueThemes);
    win.webContents.send(IPC.quickCaptureShown, mode);
  }

  function show(mode: QuickCaptureMode = "inbox"): void {
    if (!captureWindow || captureWindow.isDestroyed()) {
      captureWindow = createWindow();
    }
    captureWindow.center();
    captureWindow.show();
    captureWindow.focus();

    const win = captureWindow;
    if (win.webContents.isLoading()) {
      win.webContents.once("did-finish-load", () => {
        if (!win.isDestroyed()) sendWindowState(win, mode);
      });
    } else {
      sendWindowState(win, mode);
    }
  }

  function registerIpc(): void {
    ipcMain.handle(IPC.quickCaptureOrganize, async (event, input: unknown) => {
      if (event.sender !== captureWindow?.webContents)
        throw new Error("この画面からは整理できません。");
      if (!options.organizeCapture) throw new Error("AI整理を設定画面で設定してください。");
      const parsed = mobileCaptureOrganizationRequestSchema.parse(input);
      const themes = (options.repository.list("theme") as Entity[])
        .slice(0, 200)
        .map((theme) => ({ id: theme.id, title: String(theme.name || theme.title || "Theme") }));
      const proposal = mobileCaptureOrganizationSchema.parse(
        await options.organizeCapture({ ...parsed, themes }),
      );
      if (proposal.themeId && !themes.some((theme) => theme.id === proposal.themeId))
        throw new Error("Themeを確認して再試行してください。");
      return proposal;
    });
    ipcMain.on(IPC.quickCaptureResize, (event, expanded: boolean) => {
      if (event.sender === captureWindow?.webContents)
        captureWindow.setSize(420, expanded === true ? 680 : 284);
    });
    ipcMain.handle(
      IPC.quickCaptureSave,
      (
        event,
        text: string,
        mode: QuickCaptureMode = "inbox",
        themeId?: string,
        selectedRangeSemantics?: "once_within_window" | "ongoing",
        organization?: unknown,
      ) => {
        const trimmed = (text || "").trim();
        if (!trimmed) throw new Error("入力が空です。");
        if (organization !== undefined) {
          if (event.sender !== captureWindow?.webContents || mode !== "today-task")
            throw new Error("整理案はTask入力から追加してください。");
          const proposal = mobileCaptureOrganizationSchema.parse(organization);
          if (text.length > 12000) throw new Error("元の入力は12,000文字以内にしてください。");
          const taskId = randomUUID();
          const now = new Date().toISOString();
          const dateKind = proposal.startDate
            ? proposal.endDate && proposal.endDate > proposal.startDate
              ? "range"
              : "point"
            : "deadline";
          const receipt = options.executeCommand({
            commandId: randomUUID(),
            name: "CreateTask",
            actor: { kind: "user" },
            source: "quick_capture",
            issuedAt: now,
            payload: {
              task: {
                id: taskId,
                title: proposal.title,
                project_id: canonicalThemeId(proposal.themeId, { defaultPersonal: true }),
                state: "todo",
                priority: "normal",
                description: `${proposal.supplement ? `# 補足\n${proposal.supplement}\n\n` : ""}# 元の入力\n${text}`,
                checklist_items: proposal.checklist.map((title, index) => ({
                  id: randomUUID(),
                  title,
                  done: false,
                  sort_order: index,
                  completed_at: null,
                })),
                today_date: null,
                created_at: now,
              },
              ...(proposal.startDate || proposal.endDate
                ? {
                    schedule: {
                      id: randomUUID(),
                      owner_type: "task",
                      owner_id: taskId,
                      start_date: proposal.startDate,
                      end_date: proposal.endDate,
                      date_kind: dateKind,
                      range_semantics: proposal.rangeSemantics,
                      confidence: "fixed",
                      granularity: "day",
                    },
                  }
                : {}),
            },
          });
          options.notifyCommandApplied(receipt, event.sender.id);
          return receipt.changes.find((change) => change.type === "task")?.entity;
        }
        if (mode === "today-task" || mode === "done-task") {
          const taskId = randomUUID();
          const today = localDateString();
          const now = new Date().toISOString();
          const isDoneTask = mode === "done-task";
          // 「本体｜補足」の補足はmodeごとに意味が違う（#308）。
          const { main, extra } = splitQuickCaptureInput(trimmed);
          if (!main) throw new Error("タスク名を入力してください。");
          const due = mode === "today-task" && extra ? parseSchedule(extra, today) : null;
          if (due && !due.ok) throw new Error(due.message);
          const parsedDue = due?.ok ? due : null;
          const isRange = parsedDue?.kind === "range";
          const scheduledDate = parsedDue
            ? parsedDue.kind === "range"
              ? parsedDue.startDate
              : parsedDue.date
            : today;
          const scheduledEndDate = parsedDue?.kind === "range" ? parsedDue.endDate : scheduledDate;
          const rangeSemantics =
            parsedDue?.kind === "range"
              ? selectedRangeSemantics === "ongoing"
                ? "ongoing"
                : selectedRangeSemantics === "once_within_window"
                  ? "once_within_window"
                  : parsedDue.rangeSemantics
              : null;
          const receipt = options.executeCommand({
            commandId: randomUUID(),
            name: "CreateTask",
            payload: {
              task: {
                id: taskId,
                title: main,
                // Task追加の補足は期限として消費するので本文へは残さない。
                description: null,
                // やったことのひとことは本文と混ぜず、完了の記録として分けて保存する。
                completion_note: isDoneTask && extra ? extra : null,
                project_id: canonicalThemeId(themeId, { defaultPersonal: true }),
                state: isDoneTask ? "done" : "todo",
                priority: "normal",
                today_date: mode === "today-task" && !parsedDue ? today : null,
                completed_at: isDoneTask ? now : null,
                reminder_at:
                  parsedDue?.kind === "single" && parsedDue.time
                    ? `${parsedDue.date}T${parsedDue.time}`
                    : null,
                created_at: now,
              },
              schedule: {
                id: randomUUID(),
                owner_type: "task",
                owner_id: taskId,
                start_date: scheduledDate,
                end_date: scheduledEndDate,
                date_kind: isRange ? "range" : parsedDue ? "deadline" : "point",
                range_semantics: rangeSemantics,
                confidence: "fixed",
                granularity: "day",
              },
            },
            actor: { kind: "user" },
            source: "quick_capture",
            issuedAt: new Date().toISOString(),
          });
          options.notifyCommandApplied(receipt, event.sender.id);
          return receipt.changes.find((change) => change.type === "task")?.entity;
        }
        const contentType = quickCaptureContentType(trimmed);
        const saved = options.repository.save(
          "capture_entry",
          {
            text: trimmed,
            title: mode === "micro-memo" ? null : quickCaptureTitle(trimmed),
            kind: mode === "micro-memo" ? "micro_memo" : "inbox",
            content_type: contentType,
            url: contentType === "url" ? firstCaptureUrl(trimmed) : null,
            project_id: canonicalThemeId(themeId, { defaultPersonal: true }),
            captured_at: localDateTimeString(),
            state: "untriaged",
          },
          { source: "quick-capture" },
        );
        options.notifyWorkspaceChanged({
          entities: [{ type: "capture_entry", entity: saved as Entity }],
        });
        return saved;
      },
    );

    // 期限は保存前に解釈結果を確認できるようにする（#308）。解釈はmain側の一箇所だけで行う。
    ipcMain.handle(IPC.quickCapturePreviewDue, (_event, text: unknown) => {
      const { extra } = splitQuickCaptureInput(typeof text === "string" ? text : "");
      if (!extra) return { state: "empty" as const };
      const due = parseSchedule(extra, localDateString());
      if (!due.ok) return { state: "error" as const, message: due.message };
      return {
        state: "ok" as const,
        label: quickCaptureScheduleLabel(due),
        kind: due.kind,
        rangeSemantics: due.kind === "range" ? due.rangeSemantics : null,
        ambiguous: due.kind === "range" ? due.ambiguous : false,
      };
    });

    ipcMain.on(IPC.quickCaptureHide, () => {
      if (captureWindow && !captureWindow.isDestroyed()) captureWindow.hide();
    });
  }

  function menuItems(): Electron.MenuItemConstructorOptions[] {
    return [
      {
        label: "Inboxへクイック記録",
        accelerator: "CmdOrCtrl+Shift+N",
        click: () => show("inbox"),
      },
      { label: "タスクを追加", accelerator: "CmdOrCtrl+Shift+M", click: () => show("today-task") },
      {
        label: "やったことを記録",
        accelerator: "CmdOrCtrl+Shift+,",
        click: () => show("done-task"),
      },
      {
        label: "付箋メモを追加",
        accelerator: "CmdOrCtrl+Shift+.",
        click: () => show("micro-memo"),
      },
    ];
  }

  return {
    getWindow: () => captureWindow,
    show,
    registerIpc,
    menuItems,
  };
}
