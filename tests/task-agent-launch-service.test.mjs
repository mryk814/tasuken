import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { build } from "esbuild";
import { normalizeLocalRepositoryPath } from "../src/shared/repositoryContext.mjs";

async function importService() {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-agent-launch-service-"));
  const outputFile = path.join(outputDirectory, "taskAgentLaunchService.mjs");
  await build({
    entryPoints: [path.resolve("src/main/services/taskAgentLaunchService.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: outputFile,
    logLevel: "silent",
  });
  test.after(() => fs.rmSync(outputDirectory, { recursive: true, force: true }));
  return import(pathToFileURL(outputFile).href);
}

const { TaskAgentLaunchService } = await importService();

function fixture(root, overrides = {}) {
  const repositoryPath = path.join(root, "repository");
  fs.mkdirSync(repositoryPath);
  const records = {
    task: [
      {
        id: "task-1",
        version: 4,
        state: "todo",
        intended_executor: "self",
        work_state: "not_delegated",
        project_id: "theme-1",
        ai_visibility: ["coding_agent"],
        ...overrides.task,
      },
    ],
    theme: [
      {
        id: "theme-1",
        repository_context_ids: ["repository-1"],
        default_ai_visibility: ["coding_agent"],
        ...overrides.theme,
      },
    ],
    project: [],
    repository_context: [
      {
        id: "repository-1",
        label: "Tasuken",
        local_path: repositoryPath,
        active: true,
        ...overrides.repositoryContext,
      },
    ],
  };
  const launches = [];
  const service = new TaskAgentLaunchService({
    repository: {
      get(type, id) {
        return structuredClone((records[type] || []).find((record) => record.id === id) || null);
      },
      list(type) {
        return structuredClone(records[type] || []);
      },
      getPreference(key) {
        return key === "aiVisibilityDefault" ? ["coding_agent"] : null;
      },
    },
    userDataPath: path.join(root, "user-data"),
    async getMcpBridgeInfo() {
      return {
        configJson: '{"mcpServers":{"tasken":{}}}',
        coreStatus: overrides.coreStatus || "available",
        ...(overrides.coreNextAction ? { coreNextAction: overrides.coreNextAction } : {}),
      };
    },
    async getTaskAgentClients() {
      return [
        { id: "claude_code", label: "Claude Code", available: true },
        {
          id: "github_copilot",
          label: "GitHub Copilot",
          available: false,
          reason: "Copilot CLIが見つかりません。",
        },
      ];
    },
    async launchTaskAgentProcess(input) {
      launches.push(input);
    },
  });
  return { service, records, repositoryPath, launches };
}

test("Task agent launch re-resolves one self Task and launches only its canonical local repository", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-agent-launch-"));
  try {
    const item = fixture(root);
    const options = await item.service.getTaskAgentLaunchOptions({ taskId: "task-1" });
    assert.deepEqual(options.clients, [
      { id: "claude_code", label: "Claude Code", available: true },
      {
        id: "github_copilot",
        label: "GitHub Copilot",
        available: false,
        reason: "Copilot CLIが見つかりません。",
      },
    ]);
    assert.deepEqual(
      options.repositories.map(({ id, label }) => ({ id, label })),
      [{ id: "repository-1", label: "Tasuken" }],
    );
    assert.match(options.repositories[0].localPath, /repository$/i);
    assert.equal(options.taskVersion, 4);

    const result = await item.service.launchTaskAgent({
      taskId: "task-1",
      clientId: "claude_code",
      repositoryContextId: "repository-1",
      expectedTaskVersion: options.taskVersion,
      expectedLocalPath: options.repositories[0].localPath,
    });

    assert.deepEqual(result, { clientLabel: "Claude Code" });
    assert.deepEqual(item.launches, [
      {
        clientId: "claude_code",
        cwd: options.repositories[0].localPath,
        taskId: "task-1",
        mcpConfigJson: '{"mcpServers":{"tasken":{}}}',
        coreDiscoveryPath: path.join(root, "user-data", "tasken-core.json"),
      },
    ]);
    assert.equal(item.records.task[0].work_state, "not_delegated");
    assert.equal(item.records.task[0].version, 4);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Task agent launch rejects stale, unavailable, private, and no-longer-ready inputs before process launch", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-agent-launch-"));
  try {
    const stale = fixture(root);
    await assert.rejects(
      stale.service.launchTaskAgent({
        taskId: "task-1",
        clientId: "claude_code",
        repositoryContextId: "repository-1",
        expectedTaskVersion: 3,
        expectedLocalPath: stale.repositoryPath,
      }),
      /別の画面で更新/,
    );
    assert.deepEqual(stale.launches, []);

    const unavailableRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-agent-launch-"));
    const unavailable = fixture(unavailableRoot);
    await assert.rejects(
      unavailable.service.launchTaskAgent({
        taskId: "task-1",
        clientId: "github_copilot",
        repositoryContextId: "repository-1",
        expectedTaskVersion: 4,
        expectedLocalPath: unavailable.repositoryPath,
      }),
      /Copilot CLIが見つかりません/,
    );
    assert.deepEqual(unavailable.launches, []);
    fs.rmSync(unavailableRoot, { recursive: true, force: true });

    const privateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-agent-launch-"));
    const privateTask = fixture(privateRoot, { task: { ai_visibility: [] } });
    await assert.rejects(
      privateTask.service.getTaskAgentLaunchOptions({ taskId: "task-1" }),
      /AI公開範囲/,
    );
    assert.deepEqual(privateTask.launches, []);
    fs.rmSync(privateRoot, { recursive: true, force: true });

    const reviewRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-agent-launch-"));
    const reviewTask = fixture(reviewRoot, { task: { work_state: "needs_human_review" } });
    await assert.rejects(
      reviewTask.service.getTaskAgentLaunchOptions({ taskId: "task-1" }),
      /Acceptまたは差戻し/,
    );
    assert.deepEqual(reviewTask.launches, []);
    fs.rmSync(reviewRoot, { recursive: true, force: true });

    const removedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-agent-launch-"));
    const removed = fixture(removedRoot);
    const removedOptions = await removed.service.getTaskAgentLaunchOptions({ taskId: "task-1" });
    fs.rmSync(removed.repositoryPath, { recursive: true, force: true });
    await assert.rejects(
      removed.service.launchTaskAgent({
        taskId: "task-1",
        clientId: "claude_code",
        repositoryContextId: "repository-1",
        expectedTaskVersion: removedOptions.taskVersion,
        expectedLocalPath: removedOptions.repositories[0].localPath,
      }),
      /フォルダーが見つかりません/,
    );
    assert.deepEqual(removed.launches, []);
    fs.rmSync(removedRoot, { recursive: true, force: true });

    const unavailableCoreRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-agent-launch-"));
    const unavailableCore = fixture(unavailableCoreRoot, {
      coreStatus: "unavailable",
      coreNextAction: "Taskenを起動し直してください。",
    });
    const coreOptions = await unavailableCore.service.getTaskAgentLaunchOptions({
      taskId: "task-1",
    });
    await assert.rejects(
      unavailableCore.service.launchTaskAgent({
        taskId: "task-1",
        clientId: "claude_code",
        repositoryContextId: "repository-1",
        expectedTaskVersion: coreOptions.taskVersion,
        expectedLocalPath: coreOptions.repositories[0].localPath,
      }),
      /Taskenを起動し直して/,
    );
    assert.deepEqual(unavailableCore.launches, []);
    fs.rmSync(unavailableCoreRoot, { recursive: true, force: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Task agent launch displays the resolved directory instead of a junction path", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-agent-launch-"));
  try {
    const item = fixture(root);
    const junctionPath = path.join(root, "repository-junction");
    try {
      fs.symlinkSync(item.repositoryPath, junctionPath, "junction");
    } catch {
      t.skip("junctionを作成できない環境ではrealpathの表示境界を確認できません。");
      return;
    }
    item.records.repository_context[0].local_path = junctionPath;
    const options = await item.service.getTaskAgentLaunchOptions({ taskId: "task-1" });
    assert.equal(
      options.repositories[0].localPath,
      normalizeLocalRepositoryPath(fs.realpathSync(item.repositoryPath)),
    );
    assert.notEqual(options.repositories[0].localPath, normalizeLocalRepositoryPath(junctionPath));
    const otherPath = path.join(root, "other-repository");
    fs.mkdirSync(otherPath);
    fs.unlinkSync(junctionPath);
    fs.symlinkSync(otherPath, junctionPath, "junction");
    await assert.rejects(
      item.service.launchTaskAgent({
        taskId: "task-1",
        clientId: "claude_code",
        repositoryContextId: "repository-1",
        expectedTaskVersion: options.taskVersion,
        expectedLocalPath: options.repositories[0].localPath,
      }),
      /場所が変更/,
    );
    assert.deepEqual(item.launches, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
