import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  markdownSignature,
  noteSaveStateLabel,
  planCanonicalMarkdownWrite,
  shouldCreateExportArtifact,
} from "../src/shared/canonicalMarkdown.mjs";

test("同じ本文は同じ署名、違う本文は違う署名になる（#291）", () => {
  assert.equal(markdownSignature("# 見出し\n本文\n"), markdownSignature("# 見出し\n本文\n"));
  assert.notEqual(markdownSignature("A"), markdownSignature("B"));
  // 長さが同じでも中身が違えば区別する。
  assert.notEqual(markdownSignature("AB"), markdownSignature("BA"));
  assert.equal(markdownSignature(null), markdownSignature(""));
});

test("外部で変更された正本Markdownを黙って上書きしない（#291）", () => {
  const base = {
    canonicalPath: "D:/sync/Notes/note.md",
    nextContent: "新しい本文",
    lastWrittenSignature: markdownSignature("前回書いた本文"),
  };

  // 前回Taskenが書いた内容のままなら、そのまま更新してよい。
  assert.deepEqual(
    planCanonicalMarkdownWrite({ ...base, currentFileSignature: base.lastWrittenSignature }),
    { action: "write" },
  );

  // 外部で変わっていたら確認する。
  const external = markdownSignature("外部で編集された本文");
  assert.deepEqual(
    planCanonicalMarkdownWrite({ ...base, currentFileSignature: external }),
    { action: "confirm", reason: "external_change", externalSignature: external },
  );

  // 外部変更でも、結果が同じ内容になるなら確認を出さない。
  assert.deepEqual(
    planCanonicalMarkdownWrite({ ...base, currentFileSignature: markdownSignature("新しい本文") }),
    { action: "skip", reason: "unchanged" },
  );
});

test("内容が変わっていなければ書き込まない（#291）", () => {
  const content = "同じ本文";
  assert.deepEqual(
    planCanonicalMarkdownWrite({
      canonicalPath: "D:/sync/note.md",
      nextContent: content,
      lastWrittenSignature: markdownSignature(content),
      currentFileSignature: markdownSignature(content),
    }),
    { action: "skip", reason: "unchanged" },
  );
});

test("正本ルートが使えないときは失敗ではなく保留にする（#291）", () => {
  // 保存先が未設定のNoteはファイル更新の対象外。
  assert.deepEqual(
    planCanonicalMarkdownWrite({ canonicalPath: "", nextContent: "x" }),
    { action: "unavailable", reason: "missing_path" },
  );
  // OneDriveが一時的に見えない場合は再試行できるようにする。
  assert.deepEqual(
    planCanonicalMarkdownWrite({ canonicalPath: "D:/sync/note.md", nextContent: "x", rootAvailable: false }),
    { action: "unavailable", reason: "root_unavailable" },
  );
  // ファイルが消えていたら作り直す。外部変更として止めない。
  assert.deepEqual(
    planCanonicalMarkdownWrite({
      canonicalPath: "D:/sync/note.md",
      nextContent: "x",
      lastWrittenSignature: markdownSignature("old"),
      currentFileSignature: null,
      fileExists: false,
    }),
    { action: "write" },
  );
});

test("保存済み表示は内部とファイルの両方を反映する（#291）", () => {
  assert.equal(noteSaveStateLabel({ internalSaved: false }), "保存中…");
  // 片方だけ成功した状態を「すべて保存」に見せない。
  assert.equal(noteSaveStateLabel({ internalSaved: true, fileState: "synced" }), "すべての変更を保存しました");
  assert.match(noteSaveStateLabel({ internalSaved: true, fileState: "pending" }), /Markdownの更新を待っています/);
  assert.match(noteSaveStateLabel({ internalSaved: true, fileState: "external_change" }), /外部で変更されています/);
  assert.match(noteSaveStateLabel({ internalSaved: true, fileState: "failed" }), /更新できませんでした/);
  // 正本Markdownを持たないNoteでは、ファイル状態を語らない。
  assert.equal(noteSaveStateLabel({ internalSaved: true, fileState: "none" }), "保存しました");
});

test("通常保存の正本Markdown更新でArtifactを増やさない（#291）", () => {
  assert.equal(shouldCreateExportArtifact("markdown"), false);
  // PDF等の派生出力だけ別Artifactにする。
  assert.equal(shouldCreateExportArtifact("pdf"), true);
  assert.equal(shouldCreateExportArtifact("svg"), true);

  const notesSource = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
  assert.match(notesSource, /shouldCreateExportArtifact\(exported\.format\)/);
});

test("保存経路が正本Markdownの状態を持ち、外部変更を確認する（#291）", () => {
  const notesSource = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");

  // Tasken内部の保存と .md の更新を別の事実として扱う。
  assert.match(notesSource, /const canonicalFileState: CanonicalMarkdownFileState = \(\) =>|const canonicalFileState: CanonicalMarkdownFileState = \(\(\) => \{/);
  assert.match(notesSource, /noteSaveStateLabel\(\{ internalSaved: true, fileState: canonicalFileState \}\)/);
  // 「保存しました。」の一言でファイル状態まで語らない。
  assert.doesNotMatch(notesSource, /setDraftState\("保存しました。"\)/);

  // 外部変更を検出し、黙って上書きしない。
  assert.match(notesSource, /async function confirmCanonicalMarkdownOverwrite\(nextContent: string\): Promise<boolean>/);
  assert.match(notesSource, /planCanonicalMarkdownWrite\(\{/);
  assert.match(notesSource, /このMarkdownはTaskenの外で変更されています。/);
  assert.match(notesSource, /if \(!chooseDirectory && !\(await confirmCanonicalMarkdownOverwrite\(content\)\)\)/);
  // 保存先を変更する操作では、別ファイルを作るので外部変更確認は不要。
  assert.match(notesSource, /Markdownの更新を中止しました。/);
});
