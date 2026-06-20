import assert from "node:assert/strict";
import test from "node:test";

import {
  assertImportCandidateSavable,
  buildAiImportPrompt,
  parseAiImportPayload,
} from "../src/renderer/src/features/workspace/lib/aiImport.js";

const themes = [{ id: "theme-1", name: "材料A評価" }];

test("AI Import rejects invalid url, date, and enum by defaulting candidate to ignore", () => {
  const preview = parseAiImportPayload(JSON.stringify({
    items: [{ title: "測定", theme: "材料A評価", kind: "unknown", planned_end: "June 20" }],
    links: [{ title: "ローカル", url: "file:///C:/tmp/a.txt", link_type: "folder" }],
    people: [{ name: "対象外" }],
  }), themes, { items: [], notes: [], links: [] });

  assert.equal(preview.payloadIssues[0], "peopleはAI Import対象外のため無視します");
  assert.equal(preview.candidates[0].action, "ignore");
  assert.match(preview.candidates[0].issues.join(" / "), /kindが不正|planned_end/);
  assert.equal(preview.candidates[1].action, "ignore");
  assert.match(preview.candidates[1].issues.join(" / "), /urlはhttps、http、mailto|link_typeが不正/);
  assert.throws(() => assertImportCandidateSavable({ ...preview.candidates[0], action: "create" }), /確認事項が残っている候補/);
});

test("AI Import accepts items, notes, and mailto links with create and merge actions", () => {
  const preview = parseAiImportPayload(JSON.stringify({
    items: [{ title: "測定", theme: "材料A評価", kind: "task", status: "todo", planned_end: "2026-06-20" }],
    notes: [{ title: "方針", theme: "材料A評価", note_type: "memo", body: "確認する" }],
    links: [{ title: "連絡", url: "mailto:test@example.com", link_type: "document", theme: "材料A評価" }],
  }), themes, {
    items: [{ id: "existing", title: "測定", status: "todo" }],
    notes: [],
    links: [],
  });

  assert.equal(preview.candidates[0].action, "merge");
  assert.equal(preview.candidates[1].action, "create");
  assert.equal(preview.candidates[2].action, "create");
  assert.doesNotThrow(() => preview.candidates.forEach(assertImportCandidateSavable));
});

test("AI Import accepts knowledge nodes and relation candidates through preview", () => {
  const preview = parseAiImportPayload(JSON.stringify({
    knowledge_nodes: [
      { temp_id: "claim-1", node_type: "claim", title: "条件Bが遅延要因", theme: "材料A評価", confidence: "medium" },
      { temp_id: "evidence-1", node_type: "evidence", title: "測定ログ", theme: "材料A評価", confidence: "high" },
    ],
    knowledge_edges: [
      { source_temp_id: "claim-1", target_temp_id: "evidence-1", relation_type: "supports" },
      { source_temp_id: "missing", target_temp_id: "evidence-1", relation_type: "supports" },
    ],
  }), themes, {
    items: [],
    notes: [],
    links: [],
    knowledge_nodes: [],
    knowledge_edges: [],
  });

  assert.equal(preview.candidates[0].type, "knowledge_node");
  assert.equal(preview.candidates[0].action, "create");
  assert.equal(preview.candidates[2].type, "knowledge_edge");
  assert.equal(preview.candidates[2].action, "create");
  assert.equal(preview.candidates[3].action, "ignore");
  assert.match(preview.candidates[3].issues.join(" / "), /解決できません/);
});

test("AI Import prompt includes theme names and the current export context", () => {
  const prompt = buildAiImportPrompt("材料A評価", "# Current Work Context\n- task");
  assert.match(prompt, /既存Theme:\n材料A評価/);
  assert.match(prompt, /作業文脈:\n# Current Work Context/);
  assert.match(prompt, /JSONだけを返す/);
});
