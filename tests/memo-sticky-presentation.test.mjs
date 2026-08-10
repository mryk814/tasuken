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

const presentation = await importBundled("src/shared/memoPresentation.ts");

const MEMO_ID = "171a94c2-86fa-4cd8-a681-c2dc12882c88";

function memo(properties = {}) {
  return {
    id: MEMO_ID,
    kind: "micro_memo",
    state: "untriaged",
    properties_json: properties,
  };
}

test("付箋targetはdesired stateで保存し、色を壊さない（#377）", () => {
  const colored = presentation.markMemoStickyColor(memo(), "blue");
  const targeted = presentation.markStickyMemoTarget(colored, true);
  assert.equal(presentation.isStickyMemoTarget(targeted), true);
  assert.equal(presentation.memoStickyColorOf(targeted), "blue");

  const untargeted = presentation.markStickyMemoTarget(targeted, false);
  assert.equal(presentation.isStickyMemoTarget(untargeted), false);
  assert.equal(untargeted.properties_json.presentation, "normal");
  assert.equal(presentation.memoStickyColorOf(untargeted), "blue");
});

test("付箋色はsemantic allowlistだけを受け入れ、既存値はyellowへ正規化する（#377）", () => {
  assert.deepEqual(presentation.MEMO_STICKY_COLORS, ["yellow", "blue", "green", "pink", "purple", "neutral"]);
  assert.equal(presentation.memoStickyColorOf(memo({ presentation_color: "purple" })), "purple");
  assert.equal(presentation.memoStickyColorOf(memo({ presentation_color: "url(javascript:bad)" })), "yellow");
  assert.equal(presentation.memoStickyColorOf(memo()), "yellow");
});

test("一括表示はtargetが0件ならempty、全件visible時だけhideにする（#377）", () => {
  assert.equal(presentation.memoStickyVisibilityAction([], []), "empty");
  assert.equal(presentation.memoStickyVisibilityAction(["a", "b"], ["a"]), "show");
  assert.equal(presentation.memoStickyVisibilityAction(["a", "b"], ["a", "b", "not-target"]), "hide");
});

test("付箋target/color/theme IPCはexact requestだけを受け入れる（#377）", () => {
  assert.deepEqual(presentation.parseMemoStickyTargetRequest({ memoId: MEMO_ID, target: true }), { memoId: MEMO_ID, target: true });
  assert.equal(presentation.parseMemoStickyTargetRequest({ memoId: MEMO_ID, target: true, extra: true }), null);
  assert.equal(presentation.parseMemoStickyTargetRequest({ memoId: "memo-1", target: true }), null);
  assert.deepEqual(presentation.parseMemoStickyColorRequest({ color: "green" }), { color: "green" });
  assert.equal(presentation.parseMemoStickyColorRequest({ color: "red" }), null);
  assert.deepEqual(presentation.parseMemoStickyThemeRequest({ theme: "dark" }), { theme: "dark" });
  assert.equal(presentation.parseMemoStickyThemeRequest({ theme: "system" }), null);
});
