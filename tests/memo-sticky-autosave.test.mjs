import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const { createMemoStickyAutosaveCoordinator, replaceTextareaValuePreservingSelection } = await importBundled(
  "src/renderer/src/features/memo-sticky/lib/memoStickyAutosaveCoordinator.ts",
);
const { saveMemoStickyWithinTransaction } = await importBundled("src/main/memoStickySave.ts");
const { normalizeEntity } = await importBundled("src/main/repositories/domain.mjs");

function content(text, version = 1) {
  return { id: "memo-1", title: "Memo", text, url: "", capturedAt: "", version };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function saved(request, text = request.text, version = request.expectedVersion + 1) {
  return {
    status: "saved",
    editRevision: request.editRevision,
    saveRequestId: request.saveRequestId,
    content: content(text, version),
  };
}

test("submit後の追加入力とEnterを古いackで消さず、latestだけを続けて保存する", async () => {
  const first = deferred();
  const calls = [];
  const coordinator = createMemoStickyAutosaveCoordinator({
    createRequestId: () => `request-${calls.length + 1}`,
    save: async (request) => {
      calls.push(request);
      if (calls.length === 1) return first.promise;
      return saved(request);
    },
  });
  coordinator.initialize(content("a"));
  coordinator.edit("ab");
  const run = coordinator.requestSave();
  await Promise.resolve();
  coordinator.edit("ab\n");
  first.resolve(saved(calls[0]));

  assert.equal(await run, true);
  assert.equal(coordinator.getCurrentText(), "ab\n");
  assert.deepEqual(calls.map(({ text, expectedVersion }) => ({ text, expectedVersion })), [
    { text: "ab", expectedVersion: 1 },
    { text: "ab\n", expectedVersion: 2 },
  ]);
  assert.equal(coordinator.getState().lastAcknowledgedRevision, 2);
  assert.equal(coordinator.getState().dirty, false);
});

test("in-flight中の連続入力とpasteは中間bodyを捨てて最新snapshotだけをdispatchする", async () => {
  const first = deferred();
  const calls = [];
  const coordinator = createMemoStickyAutosaveCoordinator({
    save: async (request) => {
      calls.push(request);
      if (calls.length === 1) return first.promise;
      return saved(request);
    },
  });
  coordinator.initialize(content(""));
  coordinator.edit("a");
  const run = coordinator.requestSave();
  await Promise.resolve();
  coordinator.edit("ab");
  coordinator.edit("ab pasted");
  coordinator.edit("ab pasted!");
  first.resolve(saved(calls[0]));
  await run;

  assert.deepEqual(calls.map(({ text }) => text), ["a", "ab pasted!"]);
});

test("先行save失敗後も新しいpendingをdrainし、直前ack versionをdispatch時に使う", async () => {
  const first = deferred();
  const calls = [];
  const coordinator = createMemoStickyAutosaveCoordinator({
    save: async (request) => {
      calls.push(request);
      if (calls.length === 1) return first.promise;
      return saved(request, request.text, 2);
    },
  });
  coordinator.initialize(content("base", 1));
  coordinator.edit("first");
  const run = coordinator.requestSave();
  await Promise.resolve();
  coordinator.edit("latest");
  first.reject(new Error("temporary"));

  assert.equal(await run, true);
  assert.deepEqual(calls.map(({ text, expectedVersion }) => ({ text, expectedVersion })), [
    { text: "first", expectedVersion: 1 },
    { text: "latest", expectedVersion: 1 },
  ]);
  assert.equal(coordinator.getState().dirty, false);
});

test("Mainの自己変更通知がIPC responseより先でもrequest IDでconflictにしない", async () => {
  const response = deferred();
  let request;
  const coordinator = createMemoStickyAutosaveCoordinator({
    createRequestId: () => "own-request",
    save: async (next) => { request = next; return response.promise; },
  });
  coordinator.initialize(content("old", 4));
  coordinator.edit("mine");
  const run = coordinator.requestSave();
  await Promise.resolve();

  assert.equal(coordinator.receiveWorkspaceChange(content("mine", 5), {
    kind: "memo_sticky_save",
    saveRequestId: "own-request",
    editRevision: 1,
  }), "own-save");
  assert.equal(coordinator.getState().conflict, null);
  response.resolve(saved(request, "mine", 5));
  assert.equal(await run, true);
});

test("古いworkspace versionを無視し、localなしの新versionだけ適用する", () => {
  const coordinator = createMemoStickyAutosaveCoordinator({ save: async (request) => saved(request) });
  coordinator.initialize(content("v3", 3));
  assert.equal(coordinator.receiveWorkspaceChange(content("v2", 2)), "stale");
  assert.equal(coordinator.getCurrentText(), "v3");
  assert.equal(coordinator.receiveWorkspaceChange(content("v4", 4)), "applied");
  assert.equal(coordinator.getCurrentText(), "v4");
});

test("新しいexternal versionとlocal pendingが競合したら本文を保持してflushを拒否する", async () => {
  const coordinator = createMemoStickyAutosaveCoordinator({ save: async (request) => saved(request) });
  coordinator.initialize(content("remote-1", 1));
  coordinator.edit("local draft");
  assert.equal(coordinator.receiveWorkspaceChange(content("remote-2", 2)), "conflict");
  assert.equal(coordinator.getCurrentText(), "local draft");
  assert.equal(coordinator.getState().dirty, true);
  assert.equal(await coordinator.flush(), false);
});

test("競合後に利用者がlocal入力での保存を明示すると新versionへ再保存できる", async () => {
  const calls = [];
  const coordinator = createMemoStickyAutosaveCoordinator({
    createRequestId: () => crypto.randomUUID(),
    save: async (request) => {
      calls.push(request);
      return saved(request);
    },
  });
  coordinator.initialize(content("remote-1", 1));
  coordinator.edit("keep local");
  coordinator.receiveWorkspaceChange(content("remote-2", 2));
  assert.equal(await coordinator.overwriteConflict(), true);
  assert.equal(calls[0].expectedVersion, 2);
  assert.equal(calls[0].text, "keep local");
  assert.equal(coordinator.getState().conflict, null);
  assert.equal(coordinator.getState().dirty, false);

  const reopened = createMemoStickyAutosaveCoordinator({ save: async (request) => saved(request) });
  reopened.initialize(coordinator.getContent());
  assert.equal(reopened.getCurrentText(), "keep local");
});

test("close flushはin-flight後のlatest acknowledgementまで待つ", async () => {
  const first = deferred();
  const second = deferred();
  const calls = [];
  const coordinator = createMemoStickyAutosaveCoordinator({
    save: async (request) => {
      calls.push(request);
      return calls.length === 1 ? first.promise : second.promise;
    },
  });
  coordinator.initialize(content("", 1));
  coordinator.edit("first");
  void coordinator.requestSave();
  await Promise.resolve();
  coordinator.edit("latest");
  const flush = coordinator.flush();
  let settled = false;
  void flush.then(() => { settled = true; });
  first.resolve(saved(calls[0], "first", 2));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  second.resolve(saved(calls[1], "latest", 3));
  assert.equal(await flush, true);
});

test("remote適用時のcaretを新しい本文長へclampして保持する", () => {
  const textarea = {
    value: "123456789",
    selectionStart: 7,
    selectionEnd: 9,
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
  };
  replaceTextareaValuePreservingSelection(textarea, "1234");
  assert.equal(textarea.value, "1234");
  assert.deepEqual([textarea.selectionStart, textarea.selectionEnd], [4, 4]);
});

test("Mainはownerの現versionをtransaction内で照合して保存する", () => {
  const current = { ...content("old", 7), kind: "micro_memo", state: "inbox" };
  const saves = [];
  const transaction = {
    get(type, id) {
      assert.deepEqual([type, id], ["capture_entry", "memo-1"]);
      return current;
    },
    save(type, entity, options) {
      saves.push({ type, entity, options });
      return { ...entity, version: 8 };
    },
  };
  const outcome = saveMemoStickyWithinTransaction(transaction, "memo-1", {
    text: "next",
    editRevision: 3,
    expectedVersion: 7,
    saveRequestId: "9c41a09a-1252-4d1a-bf99-46b87f15d215",
  });
  assert.equal(outcome.status, "saved");
  assert.equal(outcome.entity.text, "next");
  assert.deepEqual(saves.map(({ type, options }) => ({ type, options })), [
    { type: "capture_entry", options: { source: "memo-sticky" } },
  ]);
});

test("Mainはstale expectedVersionをconflictとして返しDBを書かない", () => {
  const current = { ...content("remote", 9), kind: "micro_memo", state: "inbox" };
  let saves = 0;
  const outcome = saveMemoStickyWithinTransaction({
    get: () => current,
    save: () => { saves += 1; throw new Error("must not save"); },
  }, "memo-1", {
    text: "local",
    editRevision: 4,
    expectedVersion: 8,
    saveRequestId: "3ad31067-ef86-4e13-b1ec-26b3b64fd430",
  });
  assert.equal(outcome.status, "conflict");
  assert.equal(outcome.entity.text, "remote");
  assert.equal(saves, 0);
});

test("Mainはunknown keyと非UUID request IDを保存境界で拒否する", () => {
  const transaction = {
    get: () => ({ ...content("old", 1), kind: "micro_memo", state: "inbox" }),
    save: () => { throw new Error("must not save"); },
  };
  assert.throws(() => saveMemoStickyWithinTransaction(transaction, "memo-1", {
    text: "next", editRevision: 1, expectedVersion: 1, saveRequestId: "not-uuid",
  }), /保存要求が不正/);
  assert.throws(() => saveMemoStickyWithinTransaction(transaction, "memo-1", {
    text: "next",
    editRevision: 1,
    expectedVersion: 1,
    saveRequestId: "98b38ba1-4ff3-4c88-9021-5a95212176d0",
    extra: true,
  }), /保存要求が不正/);
});

test("capture_entry正本はEnterを含む本文whitespaceを保存時に保持する", () => {
  const normalized = normalizeEntity("capture_entry", {
    id: "memo-1",
    text: "  first\n",
    captured_at: "2026-08-09T00:00:00.000Z",
    state: "untriaged",
    kind: "micro_memo",
  });
  assert.equal(normalized.text, "  first\n");
});
