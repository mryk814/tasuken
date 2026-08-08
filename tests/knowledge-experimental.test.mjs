import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync("src/renderer/src/pages/routes.ts", "utf8");
const actions = readFileSync("src/renderer/src/pages/semanticActions.ts", "utf8");
const shell = readFileSync("src/renderer/src/features/workspace/components/shell.tsx", "utf8");
const notes = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
const drawer = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
const knowledge = readFileSync("src/renderer/src/features/workspace/pages/KnowledgePage.tsx", "utf8");
const graph = readFileSync("src/shared/contextGraph.mjs", "utf8");
const mcp = readFileSync("src/main/mcp/readOnlyContext.mjs", "utf8");
const workspaceData = readFileSync("src/renderer/src/features/workspace/types.ts", "utf8");

test("Knowledge route is a weak experimental tool, not the knowledge hub", () => {
  assert.match(routes, /knowledge:\s*\{\s*id: "knowledge", label: "Knowledge", description: "既存データを読み取り、Research \/ Diagnosticとして確認します。"/);
  assert.match(routes, /semanticRole: "tool", availability: "always", navigation: \{ group: "tools", order: 3 \}/);
  assert.doesNotMatch(shell, /knowledgeHealthIssueCount|knowledge:\s*knowledgeHealthIssueCount/);
  assert.doesNotMatch(actions, /knowledgeAddQuestion|knowledgeQuickAdd/);
});

test("daily Notes and task-learning flows do not create Knowledge", () => {
  assert.doesNotMatch(notes, /Knowledge化|knowledge_node|knowledgeExtraction/);
  assert.doesNotMatch(drawer, /Knowledge候補|Knowledge化する|Knowledge化/);
  assert.match(notes, /AI Draft/);
});

test("Knowledge diagnostics preserve existing storage while Context Graph stays independent", () => {
  assert.match(knowledge, /実データ棚卸し/);
  assert.match(knowledge, /Data Health/);
  assert.doesNotMatch(knowledge, /Context Graph|#332の共有projection/);
  assert.doesNotMatch(knowledge, /saveEntity|saveEntities|uuid\(|Knowledgeを追加|Knowledge化/);
  assert.match(graph, /projectContextGraph/);
  assert.match(mcp, /toolGetContextSubgraph/);
  assert.match(mcp, /toolGetKnowledgeHealth/);
  assert.match(workspaceData, /knowledge_nodes: KnowledgeNode\[\]/);
  assert.match(workspaceData, /knowledge_edges: BaseRecord\[\]/);
});
