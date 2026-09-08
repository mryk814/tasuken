import { build } from "esbuild";
import { randomUUID } from "node:crypto";

const bundle = await build({
  entryPoints: ["src/main/quickCaptureController.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
  define: { __dirname: JSON.stringify("C:/tasken-test") },
  plugins: [
    {
      name: "electron-fixture",
      setup(build) {
        build.onResolve({ filter: /^electron$/ }, () => ({
          path: "electron",
          namespace: "fixture",
        }));
        build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `
      export const clipboard = { writeText: (text) => { globalThis.captureFixture.clipboardText = text; } };
      export const ipcMain = { handle: (key, handler) => globalThis.captureFixture.handlers.set(key, handler), on: (key, handler) => globalThis.captureFixture.handlers.set(key, handler) };
      export class BrowserWindow {
        constructor() { this.listeners = new Map(); this.webContents = { id: 19, send(...args) { globalThis.captureFixture.messages.push(args); }, isLoading: () => false }; }
        loadURL() {} loadFile() {} on(name, handler) { this.listeners.set(name, handler); } center() {} show() {} focus() {} hide() { this.listeners.get('hide')?.(); } setSize() {} isDestroyed() { return false; }
      }`,
        }));
      },
    },
  ],
});
const { createQuickCaptureController } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
export const proposal = {
  title: "比較実験を準備",
  themeId: "research",
  startDate: null,
  plannedStartTime: null,
  plannedDurationMinutes: null,
  endDate: "2026-09-11",
  rangeSemantics: null,
  checklist: ["データを集める", "条件を揃える"],
  supplement: "前回は条件が違った",
  warnings: [],
};
export const batch = { tasks: [proposal], warnings: [] };
export const submission = (tasks = [proposal], warnings = []) => ({
  submissionId: randomUUID(),
  issuedAt: "2026-09-06T14:58:00.000Z",
  tasks,
  warnings,
});
export function createQuickCaptureOrganizationFixture(
  organizeCapture = async () => batch,
  executeCommand,
  overrides = {},
) {
  globalThis.captureFixture = { handlers: new Map(), messages: [] };
  const commands = [],
    batches = [],
    saves = [],
    notifications = [];
  const controller = createQuickCaptureController({
    repository: overrides.repository || {
      getPreference: () => "light",
      get: (type, id) => (type === "theme" && id === "research" ? { id, name: "研究" } : null),
      list: (type) =>
        type === "theme" ? [{ id: "research", name: "研究", description: "not sent" }] : [],
      save: (...args) => {
        saves.push(args);
        return { id: "capture" };
      },
    },
    executeCommand: (command) => {
      commands.push(command);
      if (executeCommand) return executeCommand(command);
      return { changes: [{ type: "task", entity: command.payload.task }] };
    },
    executeCommands: (envelopes) => {
      batches.push(envelopes);
      commands.push(...envelopes);
      if (overrides.executeCommands) return overrides.executeCommands(envelopes);
      return envelopes.map((command) => ({
        changes: [{ type: "task", entity: command.payload.task }],
      }));
    },
    notifyWorkspaceChanged() {},
    notifyCommandApplied: (receipt) => {
      notifications.push(receipt);
      overrides.notifyCommandApplied?.(receipt);
    },
    organizeCapture,
  });
  controller.registerIpc();
  controller.show("today-task");
  const event = { sender: controller.getWindow().webContents };
  return {
    commands,
    batches,
    saves,
    notifications,
    call: (name, ...args) =>
      globalThis.captureFixture.handlers.get(`quick-capture:${name}`)(event, ...args),
    handlers: globalThis.captureFixture.handlers,
    messages: globalThis.captureFixture.messages,
  };
}
