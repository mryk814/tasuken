import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalizeRepositoryUrl,
  findTasksForRepository,
  normalizeLocalRepositoryPath,
  normalizeRepositoryContext,
  publicRepositoryContext,
  resolveRepositoryContext,
  resolveTaskRepositoryContexts,
  resolveThemeRepositoryContexts,
} from "../src/shared/repositoryContext.mjs";
import { buildRepositoryContextProposalCandidate, buildRepositoryContextProposalOperations, repositoryContextProposalInput } from "../src/shared/repositoryContextProposal.mjs";
import { McpProposalInboxService, queueMcpProposal } from "../src/main/mcp/proposalInbox.mjs";

test("Repository URL canonicalization removes credentials/query/fragment while preserving path case and port", () => {
  const https = canonicalizeRepositoryUrl("https://user:password@GitLab.EXAMPLE:8443/Team/Repo.git?token=secret#readme");
  const ssh = canonicalizeRepositoryUrl("ssh://git@GitLab.EXAMPLE:8443/Team/Repo.git");
  const scp = canonicalizeRepositoryUrl("git@GitLab.EXAMPLE:Team/Repo.git");
  assert.equal(https.canonicalUrl, "https://gitlab.example:8443/Team/Repo");
  assert.equal(https.canonicalIdentity, "gitlab.example:8443/Team/Repo");
  assert.equal(ssh.canonicalIdentity, https.canonicalIdentity);
  assert.equal(scp.canonicalUrl, "https://gitlab.example/Team/Repo");
  assert.equal(JSON.stringify(https).includes("password"), false);
  assert.equal(JSON.stringify(https).includes("token"), false);
});

test("MCP repository proposal lets the canonical URL infer an omitted provider", () => {
  const proposal = repositoryContextProposalInput({
    label: "Tasken",
    remote_url: "https://github.com/mryk814/tasuken.git",
  });
  assert.equal(Object.prototype.hasOwnProperty.call(proposal, "provider"), false);
  assert.equal(normalizeRepositoryContext(proposal).provider, "github");
});

test("explicit provider is validated and self-managed GitLab is not guessed from its hostname", () => {
  assert.equal(canonicalizeRepositoryUrl("https://gitlab.example/Team/Repo").provider, "generic_git");
  const normalized = normalizeRepositoryContext({
    provider: "gitlab",
    remote_url: "https://gitlab.example/Team/Repo",
    web_url: "http://gitlab.example/Team/Repo?utm_source=agent#readme",
    password: "drop",
    unknown_field: "drop",
  });
  assert.equal(normalized.provider, "gitlab");
  assert.equal(normalized.web_url, "http://gitlab.example/Team/Repo");
  assert.equal("password" in normalized, false);
  assert.equal("unknown_field" in normalized, false);
  assert.throws(() => normalizeRepositoryContext({ provider: "not-a-provider", remote_url: "https://example.com/a/b" }), /provider/);
});

test("aliases participate in matching and malformed candidates become non-matches", () => {
  const result = resolveRepositoryContext({
    current: { remote_url: "https://old.example/Team/Repo" },
    contexts: [
      { id: "bad", local_path: "relative/path" },
      { id: "alias", canonical_identity: "new.example/Team/Repo", remote_aliases: ["https://old.example/Team/Repo"] },
    ],
  });
  assert.equal(result.status, "matched");
  assert.equal(result.selected.id, "alias");
});

test("absolute local paths and absolute workspace folders resolve without persisting private paths", () => {
  assert.equal(normalizeLocalRepositoryPath("C:\\Work\\Repo"), "c:\\work\\repo");
  assert.equal(normalizeLocalRepositoryPath("/Work/Repo"), "/Work/Repo");
  assert.throws(() => normalizeLocalRepositoryPath("relative/repo"), /absolute/);
  const context = normalizeRepositoryContext({ id: "local", label: "Local", local_path: "C:\\Work\\Repo", repository_root_hint: "apps" });
  const result = resolveRepositoryContext({ current: { git_root: "C:\\Work\\Repo", workspace_folder: "C:\\Work\\Repo\\apps\\web" }, contexts: [context] });
  assert.equal(result.status, "matched");
  const publicValue = publicRepositoryContext(context);
  assert.equal("local_path" in publicValue, false);
  assert.equal("repository_root_hint" in publicValue, false);
  assert.equal("metadata" in publicValue, true);
  const unlabeled = publicRepositoryContext(normalizeRepositoryContext({ local_path: "C:\\Private\\Repo" }));
  assert.equal(unlabeled.label, "Local repository");
  assert.equal(JSON.stringify(unlabeled).includes("Private"), false);
  const legacySecret = publicRepositoryContext({
    id: "legacy-secret",
    label: "Legacy",
    provider: "generic_git",
    canonical_url: "https://user:password@example.com/Team/Repo.git?token=secret#readme",
    web_url: "http://example.com/Team/Repo?utm_source=agent#readme",
    remote_aliases: ["ssh://user:password@example.com/Team/Repo.git"],
  });
  assert.equal(legacySecret.canonical_url, "https://example.com/Team/Repo");
  assert.deepEqual(legacySecret.remote_aliases, ["https://example.com/Team/Repo"]);
  assert.equal(legacySecret.web_url, "http://example.com/Team/Repo");
  assert.equal(JSON.stringify(legacySecret).includes("password"), false);
  assert.equal(JSON.stringify(legacySecret).includes("token"), false);
});

test("inactive/deleted contexts are missing with reasons, never resolver candidates", () => {
  const theme = { id: "theme", repository_context_ids: ["inactive", "deleted"] };
  const contexts = [
    { id: "inactive", label: "Inactive", active: false },
    { id: "deleted", label: "Deleted", deleted_at: "2026-08-08T00:00:00.000Z" },
  ];
  const resolved = resolveThemeRepositoryContexts(theme, contexts);
  assert.deepEqual(resolved.contexts, []);
  assert.deepEqual(resolved.missingContextReasons, { inactive: "inactive", deleted: "deleted" });
  const task = resolveTaskRepositoryContexts({ task: { repository_context_mode: "override", repository_context_ids: ["inactive"] }, contexts });
  assert.deepEqual(task.contexts, []);
  assert.equal(task.missingContextReasons.inactive, "inactive");
});

test("task subdirectory requires a workspace folder and accepts only the same path or descendants", () => {
  const context = { id: "repo", canonical_identity: "example.com/Team/Repo", repository_slug: "Team/Repo" };
  const theme = { id: "theme", repository_context_ids: ["repo"] };
  const task = { id: "task", project_id: "theme", repository_context_mode: "inherit", repository_subdirectory: "apps/web" };
  assert.equal(findTasksForRepository({ current: { remote_url: "https://example.com/Team/Repo" }, contexts: [context], themes: [theme], tasks: [task] }).tasks.length, 0);
  assert.equal(findTasksForRepository({ current: { remote_url: "https://example.com/Team/Repo", workspace_folder: "apps/web-old" }, contexts: [context], themes: [theme], tasks: [task] }).tasks.length, 0);
  assert.equal(findTasksForRepository({ current: { remote_url: "https://example.com/Team/Repo", workspace_folder: "apps/web/frontend" }, contexts: [context], themes: [theme], tasks: [task] }).tasks.length, 1);
});

test("context subdirectory also requires the current workspace to be the same path or a descendant", () => {
  const context = { id: "repo", canonical_identity: "example.com/Team/Repo", subdirectory: "apps/web" };
  assert.equal(resolveRepositoryContext({ current: { remote_url: "https://example.com/Team/Repo" }, contexts: [context] }).status, "unknown");
  assert.equal(resolveRepositoryContext({ current: { remote_url: "https://example.com/Team/Repo", workspace_folder: "apps/api" }, contexts: [context] }).status, "unknown");
  assert.equal(resolveRepositoryContext({ current: { remote_url: "https://example.com/Team/Repo", workspace_folder: "apps/web/frontend" }, contexts: [context] }).status, "matched");
});

test("equal candidates remain ambiguous instead of arbitrary selection", () => {
  const result = resolveRepositoryContext({ current: { remote_url: "https://example.com/Team/Repo" }, contexts: [
    { id: "a", canonical_identity: "example.com/Team/Repo" },
    { id: "b", canonical_identity: "example.com/Team/Repo" },
  ] });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.selected, null);
  assert.equal(result.candidates.length, 2);
});

test("stable RepositoryContext id is a resolver input when supplied", () => {
  const result = resolveRepositoryContext({
    current: { repository_id: "context-stable" },
    contexts: [{ id: "context-stable", label: "Stable", canonical_identity: "example.com/Team/Repo" }],
  });
  assert.equal(result.status, "matched");
  assert.equal(result.selected.id, "context-stable");
});

test("MCP repository proposal crosses inbox and Panel helpers as credential-free Preview to accepted save operation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-repository-proposal-"));
  try {
    const inboxPath = path.join(root, "mcp-inbox");
    const queued = queueMcpProposal({
      inboxPath,
      sourceApp: "test-client",
      payloadType: "repository_contexts",
      payload: {
        repository_contexts: [{
          action: "create",
          label: "Tasuken",
          remote_url: "https://user:password@GitHub.com/OpenAI/Tasuken.git?token=secret#readme",
          local_path: "C:\\private\\tasuken",
          repository_root_hint: "apps",
          secret: "must not persist",
          reason: "確認用",
        }],
      },
      request: { tool: "tasken.propose_repository_context" },
    });
    assert.equal(queued.payload_type, "repository_contexts");

    const saved = [];
    const service = new McpProposalInboxService({
      get: () => null,
      save: (type, entity) => {
        saved.push({ type, entity });
        return { ...entity, version: 1 };
      },
    }, root);
    assert.equal(service.drain().length, 1);
    const proposalEntry = saved[0].entity.payload.repository_contexts[0];
    assert.equal("local_path" in proposalEntry, false);
    assert.equal("repository_root_hint" in proposalEntry, false);
    assert.equal("secret" in proposalEntry, false);
    assert.equal(proposalEntry.canonical_url, "https://github.com/OpenAI/Tasuken");
    assert.equal(JSON.stringify(proposalEntry).includes("password"), false);
    assert.equal(JSON.stringify(proposalEntry).includes("token"), false);

    const previewCandidate = buildRepositoryContextProposalCandidate(proposalEntry, []);
    assert.equal(previewCandidate.action, "create");
    assert.equal(previewCandidate.entry.canonical_identity, "github.com/OpenAI/Tasuken");
    assert.equal("local_path" in previewCandidate.entry, false);
    const operations = buildRepositoryContextProposalOperations([previewCandidate], [], () => "context-created");
    assert.equal(operations.length, 1);
    assert.equal(operations[0].type, "repository_context");
    assert.equal(operations[0].entity.id, "context-created");
    assert.equal(operations[0].entity.canonical_url, "https://github.com/OpenAI/Tasuken");
    assert.equal("password" in operations[0].entity, false);
    assert.equal("local_path" in operations[0].entity, false);

    const panel = fs.readFileSync("src/renderer/src/features/workspace/components/AiProposalPanel.tsx", "utf8");
    assert.match(panel, /payloadType === "repository_contexts"/);
    assert.match(panel, /buildRepositoryContextProposalOperations/);
    assert.match(panel, /name: "ApplyAiProposal"/);
    const contentAccept = panel.slice(panel.indexOf("      const accepted ="), panel.indexOf("  return (", panel.indexOf("      const accepted =")));
    assert.doesNotMatch(contentAccept, /saveEntities\(/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("RepositoryContext merge proposal rechecks target version at accept boundary", () => {
  const target = {
    id: "context-existing",
    version: 4,
    label: "Existing",
    canonical_url: "https://github.com/OpenAI/Tasuken",
    canonical_identity: "github.com/OpenAI/Tasuken",
    provider: "github",
    active: true,
  };
  const current = buildRepositoryContextProposalCandidate({
    action: "merge",
    target_id: target.id,
    base_version: 4,
    label: "Renamed",
    remote_url: "https://github.com/OpenAI/Tasuken.git",
  }, [target]);
  assert.equal(current.issues.length, 0);
  assert.equal(buildRepositoryContextProposalOperations([current], [target]).at(0).entity.id, target.id);

  const stale = buildRepositoryContextProposalCandidate({
    action: "merge",
    target_id: target.id,
    base_version: 3,
    label: "Stale",
    remote_url: "https://github.com/OpenAI/Tasuken.git",
  }, [target]);
  assert.ok(stale.issues.some((issue) => issue.includes("更新されています")));
  assert.throws(
    () => buildRepositoryContextProposalOperations([{ ...stale, action: "merge" }], [target]),
    /確認事項が残っている|Preview後に更新/,
  );
});

test("RepositoryContext delete nullifies live refs and restores only its own marker after intervening edits", async (t) => {
  let WorkspaceDatabase;
  try {
    ({ WorkspaceDatabase } = await import("../src/main/repositories/workspaceRepository.mjs"));
  } catch (error) {
    t.skip(`better-sqlite3依存がないためDB境界を実行できません: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-repository-delete-"));
  const db = new WorkspaceDatabase(path.join(root, "workspace.db"));
  try {
    db.save("repository_context", { id: "context-a", label: "A", remote_url: "https://github.com/OpenAI/A.git" });
    db.save("repository_context", { id: "context-b", label: "B", remote_url: "https://github.com/OpenAI/B.git" });
    db.save("theme", {
      id: "theme-1",
      name: "Theme body",
      description: "Theme body survives context delete/restore",
      repository_context_ids: ["context-a", "context-b"],
      primary_repository_context_id: "context-a",
    });
    db.save("task", {
      id: "task-1",
      project_id: "theme-1",
      title: "Task body",
      description: "Task body survives context delete/restore",
      state: "todo",
      priority: "normal",
      repository_context_mode: "override",
      repository_context_ids: ["context-a"],
      primary_repository_context_id: "context-a",
    });

    db.remove("repository_context", "context-a");
    const deleted = db.get("repository_context", "context-a", true);
    assert.ok(deleted.deleted_at);
    const detachedTheme = db.get("theme", "theme-1");
    const detachedTask = db.get("task", "task-1");
    assert.deepEqual(detachedTheme.repository_context_ids, ["context-b"]);
    assert.equal(detachedTheme.primary_repository_context_id, null);
    assert.deepEqual(detachedTask.repository_context_ids, []);
    assert.equal(detachedTask.primary_repository_context_id, null);
    assert.deepEqual(detachedTheme.repository_context_detachments.map((marker) => Object.keys(marker).sort()), [["contextId", "kind", "previousIndex", "wasPrimary"]]);
    assert.equal("previousContextIds" in detachedTheme.repository_context_detachments[0], false);
    assert.equal(resolveThemeRepositoryContexts(detachedTheme, [deleted, db.get("repository_context", "context-b")]).missingContextReasons["context-a"], "deleted");

    // User changes unrelated refs while A is deleted: choose B as Theme primary,
    // and remove the explicit Task context entirely.
    db.save("theme", { ...detachedTheme, description: "Theme edited while A deleted", repository_context_ids: ["context-b"], primary_repository_context_id: "context-b" });
    db.save("task", { ...detachedTask, description: "Task edited while A deleted", repository_context_ids: [], primary_repository_context_id: null });
    db.restore("repository_context", "context-a");

    const restoredTheme = db.get("theme", "theme-1");
    const restoredTask = db.get("task", "task-1");
    assert.deepEqual(restoredTheme.repository_context_ids, ["context-a", "context-b"]);
    assert.equal(restoredTheme.primary_repository_context_id, "context-b");
    assert.equal(restoredTheme.description, "Theme edited while A deleted");
    assert.deepEqual(restoredTask.repository_context_ids, ["context-a"]);
    assert.equal(restoredTask.primary_repository_context_id, "context-a");
    assert.equal(restoredTask.description, "Task edited while A deleted");
    assert.equal(restoredTheme.repository_context_detachments, undefined);
    assert.equal(restoredTask.repository_context_detachments, undefined);
  } finally {
    db.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
