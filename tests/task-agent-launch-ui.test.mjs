import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const drawer = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
const workspaceApi = readFileSync("src/renderer/src/services/workspaceApi.ts", "utf8");
const styles = readFileSync("src/renderer/src/styles/app.css", "utf8");

test("AI依頼のコピー経路を保ち、保存済みTaskだけを明示確認して外部Agentへ渡せる", () => {
  assert.match(
    workspaceApi,
    /getTaskAgentLaunchOptions\(\s*request: Parameters<Window\["api"\]\["app"\]\["getTaskAgentLaunchOptions"\]>\[0\],\s*\)/,
  );
  assert.match(
    workspaceApi,
    /launchTaskAgent\(request: Parameters<Window\["api"\]\["app"\]\["launchTaskAgent"\]>\[0\]\)/,
  );
  assert.match(workspaceApi, /desktopApi\(\)\.app\.getTaskAgentLaunchOptions\(request\)/);
  assert.match(workspaceApi, /desktopApi\(\)\.app\.launchTaskAgent\(request\)/);

  assert.match(drawer, /依頼文をコピー/);
  assert.match(drawer, /const canLaunchTaskAgent =/);
  assert.match(
    drawer,
    /!\["done", "cancelled"\]\.includes\(task\.state\) && \(isAiDelegationReady \|\| showAgentLaunch\)/,
  );
  assert.match(drawer, /\(!hasDelegatedWork && !canLaunchTaskAgent\)/);
  assert.match(drawer, /hasUnsavedChanges=\{isFormDirty\}\s*showAgentLaunch/);
  assert.match(drawer, /<div className="drawer-edit-body">/);
  assert.match(drawer, /hasDelegatedWork &&\s*\(sortedReceipts\.length > 0/);
  assert.match(
    drawer,
    /<summary>\s*<span className="drawer-disclosure-title">AIを起動して渡す<\/span>/,
  );
  assert.match(drawer, /workspaceApi\.getTaskAgentLaunchOptions\(\{ taskId: task\.id \}\)/);
  assert.match(drawer, /disabled=\{hasUnsavedChanges \|\| launchLoading \|\| launchInFlight\}/);
  assert.match(drawer, /変更を保存してからAIを起動してください。/);
  assert.match(drawer, /Themeのリポジトリ設定でローカルパスを設定してください。/);
  assert.match(drawer, /expectedTaskVersion: launchOptions\.taskVersion/);
  assert.match(drawer, /expectedLocalPath: selectedRepository\.localPath/);
  assert.match(drawer, /実行状況は開いた画面で確認してください。/);
  assert.match(drawer, /選択肢を再読込/);
  assert.match(styles, /\.task-agent-launch-confirmation/);
  assert.match(styles, /\.drawer-edit-body > \.drawer-form/);
});
