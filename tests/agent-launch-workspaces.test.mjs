import assert from "node:assert/strict";
import test from "node:test";
import {
  agentLaunchWorkspaceGroups,
  initialAgentLaunchDirectory,
  isRegisteredAgentLaunchDirectory,
} from "../src/renderer/src/features/workspace/components/AgentLaunchModel.ts";

const themes = [
  { id: "other", name: "別テーマ", repository_context_ids: ["other-repo"] },
  {
    id: "current",
    name: "材料設計",
    repository_context_ids: ["main", "remote", "linux"],
    primary_repository_context_id: "main",
  },
  { id: "archived", name: "昔の研究", status: "archived", repository_context_ids: ["old"] },
];
const contexts = [
  { id: "remote", label: "remote only", remote_url: "https://example.com/repo" },
  { id: "linux", label: "WSL", local_path: "/home/user/repo" },
  { id: "main", label: "配合解析", local_path: "C:/研究/配合" },
  { id: "other-repo", label: "別の解析", local_path: "D:/other" },
  { id: "orphan", label: "共通ツール", local_path: "C:/tools" },
  { id: "old", label: "昔", local_path: "C:/old" },
  { id: "deleted", label: "削除", deleted_at: "now", local_path: "C:/deleted" },
  { id: "inactive", label: "無効", active: false, local_path: "C:/inactive" },
];
test("関連Themeを先頭に登録作業先をまとめ、削除・無効・アーカイブを除く", () => {
  const groups = agentLaunchWorkspaceGroups({ id: "t", project_id: "current" }, themes, contexts);
  assert.deepEqual(
    groups.map((group) => group.label),
    ["材料設計", "別テーマ", "Theme未設定"],
  );
  assert.equal(groups[0].options[0].id, "main");
  assert.equal(groups[0].related, true);
  assert.equal(
    groups
      .flatMap((group) => group.options)
      .some((option) => ["deleted", "inactive"].includes(option.id)),
    false,
  );
  assert.match(
    groups[0].options.find((option) => option.id === "remote").unavailableReason,
    /未設定/,
  );
  assert.match(
    groups[0].options.find((option) => option.id === "linux").unavailableReason,
    /Windows/,
  );
});
test("終了したThemeにだけ紐づく有効な作業先を未分類から選べる", () => {
  const groups = agentLaunchWorkspaceGroups({ id: "t", project_id: "current" }, themes, contexts);
  assert.ok(
    groups.find((group) => group.id === "unassigned").options.some((option) => option.id === "old"),
  );
});
test("別Themeの記憶済みフォルダよりTaskの関連作業先を優先する", () => {
  const groups = agentLaunchWorkspaceGroups({ id: "t", project_id: "current" }, themes, contexts);
  assert.equal(initialAgentLaunchDirectory(groups, "D:/other"), "c:\\研究\\配合");
  assert.equal(initialAgentLaunchDirectory([], "C:/manual"), "C:/manual");
  assert.equal(isRegisteredAgentLaunchDirectory(groups, "C:\\研究\\配合"), true);
  assert.equal(isRegisteredAgentLaunchDirectory(groups, "C:/manual"), false);
});
test("Task固有のoverride作業先とUNCパスを扱う", () => {
  const groups = agentLaunchWorkspaceGroups(
    { id: "t", repository_context_mode: "override", repository_context_ids: ["shared"] },
    [],
    [{ id: "shared", label: "共有", local_path: "\\\\server\\share\\repo" }],
  );
  assert.equal(groups[0].related, true);
  assert.equal(groups[0].options[0].cwd, "\\\\server\\share\\repo");
});

test("Taskがoverrideした作業先をThemeの継承候補より初期選択で優先する", () => {
  const groups = agentLaunchWorkspaceGroups(
    {
      id: "t",
      project_id: "current",
      repository_context_mode: "override",
      repository_context_ids: ["other-repo"],
    },
    themes,
    contexts,
  );
  assert.equal(initialAgentLaunchDirectory(groups, ""), "d:\\other");
});
