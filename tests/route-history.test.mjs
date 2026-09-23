import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MAX_ROUTE_HISTORY_ENTRIES,
  emptyRouteHistory,
  recordRouteVisit,
  travelRouteHistory,
} from "../src/renderer/src/pages/routeHistory.ts";

/**
 * アプリ内の「前の画面・次の画面」はブラウザ履歴ではなく、アプリで正規化した
 * route遷移だけをたどる。ハッシュ断片・ドロワー・選択状態は各画面の復元に任せる。
 */

test("新しい画面への移動は、同じ画面の繰り返しを除いて履歴へ積む", () => {
  let history = emptyRouteHistory();
  history = recordRouteVisit(history, "today", "feed");
  history = recordRouteVisit(history, "feed", "feed");
  history = recordRouteVisit(history, "feed", "");
  history = recordRouteVisit(history, "feed", "notes");
  assert.deepEqual(history, { back: ["today", "feed"], forward: [] });
});

test("新しい画面へ進むと、進む側の履歴は消える", () => {
  const history = recordRouteVisit(emptyRouteHistory(), "today", "feed");
  const backward = travelRouteHistory(history, "feed", "back");
  assert.equal(backward.target, "today");
  const branched = recordRouteVisit(backward.history, "today", "notes");
  assert.deepEqual(branched, { back: ["today"], forward: [] });
});

test("戻ると今の画面は進む側へ積み、進むと今の画面は戻る側へ積む", () => {
  const visited = recordRouteVisit(
    recordRouteVisit(emptyRouteHistory(), "today", "feed"),
    "feed",
    "notes",
  );
  const backward = travelRouteHistory(visited, "notes", "back");
  assert.equal(backward.target, "feed");
  assert.deepEqual(backward.history, { back: ["today"], forward: ["notes"] });

  const forward = travelRouteHistory(backward.history, "feed", "forward");
  assert.equal(forward.target, "notes");
  assert.deepEqual(forward.history, { back: ["today", "feed"], forward: [] });
});

test("履歴が無い方向や同じ画面への移動は、何も変えず移動もしない", () => {
  const history = recordRouteVisit(emptyRouteHistory(), "today", "feed");
  assert.deepEqual(travelRouteHistory(history, "feed", "forward"), {
    target: null,
    history,
  });
  assert.deepEqual(travelRouteHistory(emptyRouteHistory(), "today", "back"), {
    target: null,
    history: { back: [], forward: [] },
  });
  assert.deepEqual(travelRouteHistory(history, "today", "forward"), {
    target: null,
    history,
  });
});

test("履歴は上限を超えたら古い方から捨てる", () => {
  let history = emptyRouteHistory();
  for (let index = 0; index < MAX_ROUTE_HISTORY_ENTRIES + 10; index += 1) {
    history = recordRouteVisit(history, `route-${index}`, `route-${index + 1}`);
  }
  assert.equal(history.back.length, MAX_ROUTE_HISTORY_ENTRIES);
  assert.equal(history.back[0], "route-10");
  assert.deepEqual(history.forward, []);
});

test("タイトルバーは履歴の行き先つき前後ボタンを出し、切り離しでは出さない", () => {
  const shellSource = readFileSync(
    "src/renderer/src/features/workspace/components/shell.tsx",
    "utf8",
  );
  const workspaceAppSource = readFileSync(
    "src/renderer/src/features/workspace/WorkspaceApp.tsx",
    "utf8",
  );

  assert.match(shellSource, /前の画面に戻る（\$\{routeNavigation\.backLabel\}）/);
  assert.match(shellSource, /次の画面に進む（\$\{routeNavigation\.forwardLabel\}）/);
  assert.match(shellSource, /disabled=\{!routeNavigation\.canGoBack\}/);
  assert.match(shellSource, /disabled=\{!routeNavigation\.canGoForward\}/);
  assert.match(shellSource, /routeNavigation && !detached/);

  // 既存の保存・ドロワー処理を通してから移動する。遷移監視の重複記録も防ぐ。
  assert.match(workspaceAppSource, /recordRouteVisit\(/);
  assert.match(workspaceAppSource, /travelRouteHistory\(/);
  assert.match(workspaceAppSource, /suppressRouteRecordRef\.current = normalized;/);
  assert.match(workspaceAppSource, /setRouteHistory\(travel\.history\)/);
  assert.match(workspaceAppSource, /if \(!\(await saveDirtyDrawerForm\(\)\)\) return;/);
  assert.match(workspaceAppSource, /routeNavigation=\{routeNavigation\}/);
});
