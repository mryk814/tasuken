import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const drawerSource = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
const commonSource = readFileSync("src/renderer/src/features/workspace/components/common.tsx", "utf8");
const workspaceAppSource = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");

test("Note編集UIに関連タスク（ItemSelect / item_id）を出さない", () => {
  // NoteFields 周辺に ItemSelect や item_id の select が残っていないこと。
  assert.doesNotMatch(drawerSource, /ItemSelect/);
  assert.doesNotMatch(drawerSource, /name="item_id"/);
  assert.doesNotMatch(commonSource, /function ItemSelect|export function ItemSelect/);

  // NoteFields ブロック内に「関連タスク」ラベルが無いこと（Resource詳細の関連タスク表示とは別）。
  const noteFieldsStart = drawerSource.indexOf("function NoteFields");
  assert.notEqual(noteFieldsStart, -1);
  const noteFieldsEnd = drawerSource.indexOf("\nfunction ", noteFieldsStart + 1);
  const noteFields = drawerSource.slice(noteFieldsStart, noteFieldsEnd === -1 ? undefined : noteFieldsEnd);
  assert.doesNotMatch(noteFields, /関連タスク/);
  assert.doesNotMatch(noteFields, /item_id/);
});

test("Note保存は item_id フォームが無いとき既存値を保持する", () => {
  // フォームから外したあと再保存で item_id が null に潰されないこと（#144）。
  assert.match(
    workspaceAppSource,
    /item_id:\s*noteType\s*===\s*"report"\s*\?\s*null\s*:\s*\(named\("item_id"\)\s*\?\s*\(formText\(values,\s*"item_id"\)\s*\|\|\s*null\)\s*:\s*\(\(base\.item_id/,
  );
});

test("Task詳細の learning notes（item_id）導線は残す", () => {
  assert.match(drawerSource, /note\.item_id\s*===\s*task\.id/);
  assert.match(drawerSource, /note_type:\s*"learning"/);
  assert.match(drawerSource, /item_id:\s*task\.id/);
});
