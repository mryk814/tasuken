import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  dailyScratchpadDate,
  dailyScratchpadDraftKey,
  dailyScratchpadTitle,
  filterDailyScratchpads,
  isDailyScratchpad,
} from "../src/shared/dailyScratchpad.mjs";

function pad(id, date, body = "", updatedAt = date) {
  return {
    id,
    title: dailyScratchpadTitle(date),
    body_markdown: body,
    updated_at: updatedAt,
    properties_json: {
      document_role: "daily_scratchpad",
      scratchpad_date: date,
    },
  };
}

test("通常Noteから日付つきDaily Scratchpadだけを識別する", () => {
  const record = pad("pad-1", "2026-08-02");
  assert.equal(isDailyScratchpad(record), true);
  assert.equal(dailyScratchpadDate(record), "2026-08-02");
  assert.equal(isDailyScratchpad({ ...record, properties_json: { document_role: "note" } }), false);
  assert.equal(dailyScratchpadTitle("2026-08-02"), "Daily Scratchpad 2026-08-02");
});

test("大量の日次メモを日付降順で本文検索できる", () => {
  const records = Array.from({ length: 800 }, (_, index) => {
    const date = new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10);
    return pad(`pad-${index}`, date, index === 412 ? "固有の検索語 alpha" : `memo ${index}`);
  });
  records.push({ id: "regular-note", title: "alpha", body_markdown: "alpha" });
  const all = filterDailyScratchpads(records);
  assert.equal(all.length, 800);
  assert.ok(dailyScratchpadDate(all[0]) > dailyScratchpadDate(all.at(-1)));
  assert.deepEqual(filterDailyScratchpads(records, "ALPHA").map((record) => record.id), ["pad-412"]);
});

test("日付ごとの同期前ドラフトを独立して退避するキーを持つ", () => {
  assert.notEqual(dailyScratchpadDraftKey("2026-08-01"), dailyScratchpadDraftKey("2026-08-02"));
});

test("TodayとCommand Paletteから開き、選択範囲を既存変換経路へ渡す", () => {
  const app = fs.readFileSync(new URL("../src/renderer/src/features/workspace/WorkspaceApp.tsx", import.meta.url), "utf8");
  const today = fs.readFileSync(new URL("../src/renderer/src/features/workspace/pages/TodayPage.tsx", import.meta.url), "utf8");
  const dialog = fs.readFileSync(new URL("../src/renderer/src/features/workspace/components/DailyScratchpadDialog.tsx", import.meta.url), "utf8");
  assert.match(app, /open:daily-scratchpad/);
  assert.match(today, /今日のScratchpad/);
  assert.match(dialog, /buildSelectionExtractionOperations/);
  assert.match(dialog, /localStorage\.setItem\(dailyScratchpadDraftKey/);
  assert.match(dialog, /daily_scratchpad_autosave/);
  assert.match(dialog, /Activity Logには全文転記されません/);
});
