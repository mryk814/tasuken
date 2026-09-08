import { BrowserWindow, clipboard, ipcMain } from "electron";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

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
  mobileCaptureOrganizationTimedBatchSchema,
} from "../shared/contracts/mobile/public.ts";
import { isoTimestampSchema } from "../shared/kernel/public.ts";
import {
  buildExternalCapturePrompt,
  parseExternalCaptureOrganization,
} from "./quickCaptureExternal";
import type { CaptureOrganizerBatch, CaptureOrganizerInput } from "./gateway/mobile/public";
import { SavedCaptureOrganizer } from "./services/savedCaptureOrganizer";
import type { SavedCaptureOrganizationSource } from "../shared/savedCaptureOrganization";

export type QuickCaptureMode = "inbox" | "today-task" | "micro-memo" | "done-task";

interface QuickCaptureControllerOptions {
  repository: InstanceType<typeof WorkspaceDatabase>;
  notifyWorkspaceChanged: (
    change:
      | { type: EntityType; entity: Entity }
      | { entities: Array<{ type: EntityType; entity: Entity }> },
  ) => void;
  notifyCommandApplied: (receipt: CommandReceipt | CommandReceipt[], senderId: number) => void;
  executeCommand: (envelope: CommandEnvelope) => CommandReceipt;
  executeCommands: (envelopes: CommandEnvelope[]) => CommandReceipt[];
  organizeCapture?: (input: CaptureOrganizerInput) => Promise<CaptureOrganizerBatch>;
  isMainSender?: (senderId: number) => boolean;
}

const organizedSubmissionSchema = mobileCaptureOrganizationTimedBatchSchema.extend({
  submissionId: z.uuid(),
  issuedAt: isoTimestampSchema,
});

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
  getSavedWindow: () => BrowserWindow | null;
  show: (mode?: QuickCaptureMode) => void;
  registerIpc: () => void;
  menuItems: () => Electron.MenuItemConstructorOptions[];
}

export function createQuickCaptureController(
  options: QuickCaptureControllerOptions,
): QuickCaptureController {
  let captureWindow: BrowserWindow | null = null;
  let savedCaptureWindow: BrowserWindow | null = null;
  const savedOrganizer = new SavedCaptureOrganizer({
    repository: options.repository,
    organize: (input) => {
      if (!options.organizeCapture) throw new Error("AI整理を設定画面で設定してください。");
      return options.organizeCapture(input);
    },
    executeCommands: options.executeCommands,
  });
  let visibleMode: QuickCaptureMode = "inbox";

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
      // Windows voice typing and clipboard round trips move focus outside this window.
      if (win.isVisible() && (win !== captureWindow || visibleMode !== "today-task")) win.hide();
    });
    win.on("hide", () => win.webContents.send(IPC.quickCaptureHidden));
    return win;
  }

  function sendWindowState(
    win: BrowserWindow,
    mode: QuickCaptureMode | "saved-capture",
    source?: SavedCaptureOrganizationSource,
  ): void {
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
    win.webContents.send(IPC.quickCaptureShown, mode, source);
  }

  function show(mode: QuickCaptureMode = "inbox"): void {
    visibleMode = mode;
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

  function saveOrganized(text: unknown, value: unknown, senderId: number) {
    const rawId =
      value && typeof value === "object" ? Reflect.get(value, "submissionId") : undefined;
    const identity = z.uuid().safeParse(rawId);
    const existingCommandIds = identity.success
      ? new Set(
          (options.repository.list("change_event", true) as Entity[])
            .map((event) => String(event.command_id || ""))
            .filter((id) => id.startsWith(`${identity.data}-command-`)),
        )
      : new Set<string>();
    const hasExistingTask =
      identity.success &&
      Array.from({ length: 8 }, (_, index) => index).some((index) =>
        options.repository.get("task", `${identity.data}-task-${index}`, true),
      );
    const hasHistory = existingCommandIds.size > 0 || hasExistingTask;
    const submission = organizedSubmissionSchema.safeParse(value);
    const validationError =
      !submission.success || typeof text !== "string" || !text.trim() || text.length > 12000
        ? "元の入力と整理案を確認してください。候補は1〜8件、元の入力は12,000文字以内です。"
        : !hasHistory &&
            submission.data.tasks.some(
              (proposal) => proposal.themeId && !options.repository.get("theme", proposal.themeId),
            )
          ? "選択したThemeが見つかりません。選び直してください。"
          : null;
    if (validationError) {
      // Only pre-execution rejection with no saved evidence permits a new edited submission.
      if (hasHistory) throw new Error("保存済みの入力を変更せずに再試行してください。");
      return { status: "not_saved" as const, message: validationError };
    }
    if (!submission.success || typeof text !== "string") throw new Error("入力が不正です。");
    const { submissionId, issuedAt, tasks, warnings } = submission.data;
    const commands: CommandEnvelope[] = tasks.map((proposal, index) => {
      const taskId = `${submissionId}-task-${index}`;
      const dateKind = proposal.startDate
        ? proposal.endDate && proposal.endDate > proposal.startDate
          ? "range"
          : "point"
        : "deadline";
      const allWarnings = [...new Set([...warnings, ...proposal.warnings])];
      return {
        commandId: `${submissionId}-command-${index}`,
        name: "CreateTask",
        actor: { kind: "user" },
        source: "quick_capture",
        sessionId: submissionId,
        issuedAt,
        payload: {
          task: {
            id: taskId,
            title: proposal.title,
            project_id: canonicalThemeId(proposal.themeId, { defaultPersonal: true }),
            state: "todo",
            priority: "normal",
            description: `${proposal.supplement ? `# 補足\n${proposal.supplement}\n\n` : ""}${allWarnings.length ? `# 確認事項\n${allWarnings.join("\n")}\n\n` : ""}# 元の入力\n${text}`,
            checklist_items: proposal.checklist.map((title, itemIndex) => ({
              id: `${taskId}-check-${itemIndex}`,
              title,
              done: false,
              sort_order: itemIndex,
              completed_at: null,
            })),
            today_date: null,
            planned_start_time: proposal.plannedStartTime,
            planned_duration_minutes: proposal.plannedDurationMinutes,
            created_at: issuedAt,
          },
          ...(proposal.startDate || proposal.endDate
            ? {
                schedule: {
                  id: `${submissionId}-schedule-${index}`,
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
      };
    });
    if (
      hasHistory &&
      (existingCommandIds.size !== commands.length ||
        commands.some((command) => !existingCommandIds.has(command.commandId)))
    ) {
      throw new Error("保存済みの候補集合を変更せずに再試行してください。");
    }
    // executeBatch owns the one transaction, including every Task, Schedule, Event and receipt.
    // A thrown execution or notification may follow an earlier commit: never label it not_saved.
    const receipts = options.executeCommands(commands);
    options.notifyCommandApplied(receipts, senderId);
    return { status: "saved" as const, count: receipts.length };
  }

  function registerIpc(): void {
    ipcMain.handle(IPC.captureOrganizerOpenSaved, (event, captureId: string, version: number) => {
      if (!options.isMainSender?.(event.sender.id))
        throw new Error("メイン画面からCaptureを開いてください。");
      const source = savedOrganizer.source(captureId, version);
      if (!savedCaptureWindow || savedCaptureWindow.isDestroyed())
        savedCaptureWindow = createWindow();
      const win = savedCaptureWindow;
      win.setSize(420, 680);
      win.center();
      win.show();
      win.focus();
      const send = () => {
        if (!win.isDestroyed()) sendWindowState(win, "saved-capture", source);
      };
      if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send);
      else send();
    });
    ipcMain.handle(IPC.quickCaptureOpenTask, () => show("today-task"));
    ipcMain.handle(IPC.quickCaptureExternalPrompt, (event, input: unknown) => {
      if (event.sender !== captureWindow?.webContents)
        throw new Error("この画面からは依頼文をコピーできません。");
      const parsed = mobileCaptureOrganizationRequestSchema
        .extend({ text: z.string().max(12000) })
        .parse(input);
      const theme = parsed.themeId ? options.repository.get("theme", parsed.themeId) : null;
      if (parsed.themeId && !theme) throw new Error("Themeを選び直してください。");
      clipboard.writeText(
        buildExternalCapturePrompt({
          text: parsed.text,
          theme: theme
            ? { id: theme.id, name: String(theme.name || theme.title || "Theme") }
            : null,
          capturedAt: parsed.capturedAt,
          timeZone: parsed.timeZone,
        }),
      );
    });
    ipcMain.handle(IPC.quickCaptureExternalImport, (event, text: unknown) => {
      if (event.sender !== captureWindow?.webContents)
        throw new Error("この画面からは整理結果を取り込めません。");
      try {
        const result = parseExternalCaptureOrganization(
          text,
          (options.repository.list("theme") as Entity[]).map((theme) => theme.id),
        );
        return { ok: true as const, ...result };
      } catch (error) {
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : "整理結果を確認してください。",
        };
      }
    });
    ipcMain.handle(IPC.quickCaptureOrganize, async (event, input: unknown) => {
      if (event.sender === savedCaptureWindow?.webContents) return savedOrganizer.organize(input);
      if (event.sender !== captureWindow?.webContents)
        throw new Error("この画面からは整理できません。");
      if (!options.organizeCapture) throw new Error("AI整理を設定画面で設定してください。");
      const parsed = mobileCaptureOrganizationRequestSchema.parse(input);
      const themes = (options.repository.list("theme") as Entity[])
        .slice(0, 200)
        .map((theme) => ({ id: theme.id, title: String(theme.name || theme.title || "Theme") }));
      const organized = mobileCaptureOrganizationTimedBatchSchema.parse(
        await options.organizeCapture({ ...parsed, themes, maxTasks: 8, includePlannedTime: true }),
      );
      if (
        organized.tasks.some(
          (proposal) => proposal.themeId && !themes.some((theme) => theme.id === proposal.themeId),
        )
      )
        throw new Error("Themeを確認して再試行してください。");
      return organized;
    });
    ipcMain.on(IPC.quickCaptureResize, (event, expanded: boolean) => {
      if (event.sender === savedCaptureWindow?.webContents) {
        savedCaptureWindow.setSize(420, 680);
        return;
      }
      if (event.sender === captureWindow?.webContents)
        captureWindow.setSize(
          420,
          expanded === true ? 680 : visibleMode === "today-task" ? 440 : 284,
        );
    });
    ipcMain.handle(
      IPC.quickCaptureSave,
      (
        event,
        text: string,
        mode: QuickCaptureMode | "saved-capture" = "inbox",
        themeId?: string,
        selectedRangeSemantics?: "once_within_window" | "ongoing",
        organization?: unknown,
      ) => {
        if (event.sender === savedCaptureWindow?.webContents) {
          if (mode !== "saved-capture" || organization === undefined)
            throw new Error("選択した候補を確認してください。");
          const result = savedOrganizer.save(organization);
          if (!Array.isArray(result)) return result;
          options.notifyCommandApplied(result, event.sender.id);
          return { status: "saved" as const, count: result.length };
        }
        if (organization !== undefined) {
          if (event.sender !== captureWindow?.webContents || mode !== "today-task")
            throw new Error("整理案はTask入力から追加してください。");
          return saveOrganized(text, organization, event.sender.id);
        }
        const trimmed = (text || "").trim();
        if (!trimmed) throw new Error("入力が空です。");
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
            properties_json: { capture_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
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

    ipcMain.on(IPC.quickCaptureHide, (event) => {
      const win = [captureWindow, savedCaptureWindow].find(
        (candidate) => candidate?.webContents === event.sender,
      );
      if (win && !win.isDestroyed()) win.hide();
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
    getSavedWindow: () => savedCaptureWindow,
    show,
    registerIpc,
    menuItems,
  };
}
