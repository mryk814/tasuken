import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: ["src/main/quickCaptureController.ts"], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent",
  define: { __dirname: JSON.stringify("C:/tasken-test") },
  plugins: [{ name: "electron-fixture", setup(build) {
    build.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `
      export const ipcMain = { handle: (key, handler) => globalThis.captureFixture.handlers.set(key, handler), on: (key, handler) => globalThis.captureFixture.handlers.set(key, handler) };
      export class BrowserWindow {
        constructor() { this.webContents = { id: 19, send() {}, isLoading: () => false }; }
        loadURL() {} loadFile() {} on() {} center() {} show() {} focus() {} hide() {} setSize() {} isDestroyed() { return false; }
      }` }));
  } }],
});
const { createQuickCaptureController } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const proposal = { title: "比較実験を準備", themeId: "research", startDate: null, endDate: "2026-09-11", rangeSemantics: null, checklist: ["データを集める", "条件を揃える"], supplement: "前回は条件が違った", warnings: [] };
function fixture(organizeCapture = async () => proposal) {
  globalThis.captureFixture = { handlers: new Map() };
  const commands = [], saves = [], notifications = [];
  const controller = createQuickCaptureController({
    repository: { getPreference: () => "light", list: (type) => type === "theme" ? [{ id: "research", name: "研究", description: "not sent" }] : [], save: (...args) => { saves.push(args); return { id: "capture" }; } },
    executeCommand: (command) => { commands.push(command); return { changes: [{ type: "task", entity: command.payload.task }] }; },
    notifyWorkspaceChanged() {}, notifyCommandApplied: (receipt) => notifications.push(receipt), organizeCapture,
  });
  controller.registerIpc(); controller.show("today-task");
  const event = { sender: controller.getWindow().webContents };
  return { commands, saves, notifications, call: (name, ...args) => globalThis.captureFixture.handlers.get(`quick-capture:${name}`)(event, ...args), handlers: globalThis.captureFixture.handlers };
}

test("Desktop organization passes only current capture and canonical Theme candidates without saving", async () => {
  let input;
  const f = fixture(async (value) => { input = value; return proposal; });
  const request = { text: "来週金曜までに比較実験を準備", capturedAt: "2026-09-05T12:00:00.000Z", timeZone: "Asia/Tokyo", themeId: "research" };
  assert.deepEqual(await f.call("organize", request), proposal);
  assert.deepEqual(input, { ...request, themes: [{ id: "research", title: "研究" }] });
  assert.equal(f.commands.length, 0); assert.equal(f.saves.length, 0);
  await assert.rejects(f.handlers.get("quick-capture:organize")({ sender: { id: 99 } }, request));
});

test("Desktop confirmed proposal saves original text, supplement, checklist and deadline atomically", () => {
  const f = fixture();
  const original = "  前回は条件が違った。\n" + "比較実験を準備する。".repeat(80);
  f.call("save", original, "today-task", "research", undefined, proposal);
  assert.equal(f.commands.length, 1); assert.equal(f.saves.length, 0); assert.equal(f.notifications.length, 1);
  const { task, schedule } = f.commands[0].payload;
  assert.equal(task.title, proposal.title);
  assert.equal(task.description, `# 補足\n${proposal.supplement}\n\n# 元の入力\n${original}`);
  assert.deepEqual(task.checklist_items.map((item) => item.title), proposal.checklist);
  assert.equal(task.today_date, null);
  assert.equal(schedule.start_date, null); assert.equal(schedule.end_date, proposal.endDate);
  assert.equal(schedule.date_kind, "deadline"); assert.equal(schedule.owner_id, task.id);
  assert.throws(() => f.call("save", original, "inbox", undefined, undefined, proposal));
  assert.throws(() => f.call("save", original, "today-task", undefined, undefined, { ...proposal, startDate: "2026-09-12" }));
  assert.equal(f.commands.length, 1);
});

test("Desktop plain Inbox stays a raw Capture and a dateless organized Task stays unscheduled", () => {
  const f = fixture();
  f.call("save", "メモをそのまま残す", "inbox");
  assert.equal(f.commands.length, 0); assert.equal(f.saves[0][0], "capture_entry");
  f.call("save", "いつか比較実験", "today-task", undefined, undefined, { ...proposal, endDate: null });
  assert.equal(f.commands[0].payload.schedule, undefined);
  assert.equal(f.commands[0].payload.task.today_date, null);
});
