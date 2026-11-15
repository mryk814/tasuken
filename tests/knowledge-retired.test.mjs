import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { projectContextGraph } from "../src/shared/contextGraph.mjs";
import { entityTypes } from "../src/shared/entityRegistry.mjs";

// 棚卸し（Knowledge）は #755 束8 で、画面・節と線の入力・診断を外した。
// 種類の登録（knowledge_node・knowledge_edge）は読むだけで残す。
// 保存の検証と、削除・復元の連動は workspace-repository の試験と model-smoke が見る。

const read = (file) => readFileSync(file, "utf8");
const routes = read("src/renderer/src/pages/routes.ts");
const drawer = read("src/renderer/src/features/workspace/components/drawer.tsx");
const workspaceApp = read("src/renderer/src/features/workspace/WorkspaceApp.tsx");
const themePage = read("src/renderer/src/features/workspace/pages/ThemePage.tsx");
const types = read("src/renderer/src/features/workspace/types.ts");
const contracts = read("src/shared/ipc/contracts.ts");
const mcp = read("src/main/mcp/server.mjs");

test("棚卸しの画面と、その行き先が無い", () => {
  assert.equal(existsSync("src/renderer/src/features/workspace/pages/KnowledgePage.tsx"), false);
  assert.doesNotMatch(routes, /label: "棚卸し"|id: "knowledge"/);
  const routeIds = routes.match(/export type CanonicalRouteId =[\s\S]*?;/)?.[0] || "";
  assert.ok(routeIds);
  assert.doesNotMatch(routeIds, /knowledge/);
  // 「知識整理」の群（ノート・手書き・会話録・添付）は残る。
  assert.match(routes, /export const knowledgeHubTabs = routeIdsForGroup\("knowledge"\)/);
  // 前の版が覚えていた行き先は今日へ送る。
  assert.match(routes, /if \(route === "knowledge"\) return "today";/);
});

test("節と線を入力・表示するドロワーと、保存の分岐が無い", () => {
  assert.doesNotMatch(drawer, /Knowledge(Node|Edge)(Fields|DetailDrawer)|KnowledgeSourceFields/);
  assert.doesNotMatch(workspaceApp, /type === "knowledge_(node|edge)"/);
  assert.doesNotMatch(themePage, /knowledge_node|棚卸し/);
  const drawerTypes = types.match(/export type DrawerEntityType =[\s\S]*?;/)?.[0] || "";
  assert.ok(drawerTypes);
  assert.doesNotMatch(drawerTypes, /knowledge/);
});

test("診断（Data Health）の口が無い", () => {
  assert.equal(existsSync("src/shared/dataHealth.mjs"), false);
  assert.doesNotMatch(contracts, /dataHealth|data-health/);
});

test("MCP の道具に Knowledge を扱う物が無く、Core は Knowledge の節の案を受け付けない", () => {
  assert.doesNotMatch(mcp, /knowledge_(node|edge|create)|propose_knowledge|search_knowledge/);
  const proposal = read("src/shared/contracts/task/contentProposal.ts");
  assert.doesNotMatch(proposal, /knowledge_create/);
  // 前の版が受け取った案を読めるよう、案の種類の名前は残す。
  assert.match(proposal, /"knowledge_nodes"/);
});

test("種類の登録は残り、節と線は記録どうしの関係として読める", () => {
  for (const type of ["knowledge_node", "knowledge_edge"])
    assert.ok(entityTypes.includes(type), type);
  const graph = projectContextGraph({
    notes: [{ id: "note-1", title: "所見" }],
    tasks: [{ id: "task-1", title: "比べる" }],
    knowledge_nodes: [
      { id: "kn-1", node_type: "claim", title: "主張" },
      { id: "kn-2", node_type: "evidence", title: "根拠", source_note_id: "note-1" },
    ],
    knowledge_edges: [
      { id: "ke-1", source_node_id: "kn-2", target_node_id: "kn-1", relation_type: "supports" },
    ],
    references: [
      {
        id: "ref-1",
        source_type: "note",
        source_id: "note-1",
        target_type: "task",
        target_id: "task-1",
        relation_type: "links_to",
      },
    ],
  });
  const edgeIds = graph.edges.map((edge) => String(edge.id));
  // ノートから Task への関係（reference）は今までどおり。
  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.source.type === "note" &&
        edge.source.id === "note-1" &&
        edge.target.type === "task" &&
        edge.target.id === "task-1",
    ),
    edgeIds.join(", "),
  );
  // 節どうしの線も、読み取りの図には残る。
  assert.ok(
    graph.edges.some(
      (edge) => edge.source.type === "knowledge_node" && edge.target.type === "knowledge_node",
    ),
    edgeIds.join(", "),
  );
});
