import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  captureMatchesQuery,
  fileCaptureContentType,
  firstCaptureUrl,
  quickCaptureContentType,
  quickCaptureTitle,
} from "../src/shared/quickCapture.mjs";

const controllerSource = readFileSync("src/main/quickCaptureController.ts", "utf8");
const captureWindowSource = readFileSync("src/renderer/capture.html", "utf8");
const inboxSource = readFileSync("src/renderer/src/features/workspace/pages/InboxPage.tsx", "utf8");

test("Quick CaptureはURL・Markdown・通常テキストを分類し、短いタイトルを作る", () => {
  assert.equal(quickCaptureContentType("https://example.com/path"), "url");
  assert.equal(quickCaptureContentType("# 実験メモ\n- 条件A"), "markdown");
  assert.equal(quickCaptureContentType("あとで確認する"), "text");
  assert.equal(firstCaptureUrl("参照 https://example.com/a。"), "https://example.com/a");
  assert.equal(quickCaptureTitle("https://www.example.com/path"), "example.com");
  assert.equal(quickCaptureTitle("# 実験メモ\n本文"), "実験メモ");
  assert.equal(quickCaptureTitle(`${"長".repeat(90)}\n本文`).length, 80);
});

test("ファイルCaptureは画像だけの場合と混在ファイルを区別する", () => {
  assert.equal(fileCaptureContentType([{ name: "a.png" }, { name: "b.JPG" }]), "image");
  assert.equal(fileCaptureContentType([{ name: "a.png" }, { name: "data.csv" }]), "file");
});

test("Inbox検索はタイトル・本文・URL・種別を横断する", () => {
  const entry = {
    title: "測定結果",
    text: "あとで解析する",
    url: "https://example.com/result",
    content_type: "url",
  };
  assert.equal(captureMatchesQuery(entry, "測定"), true);
  assert.equal(captureMatchesQuery(entry, "example.com"), true);
  assert.equal(captureMatchesQuery(entry, "URL"), true);
  assert.equal(captureMatchesQuery(entry, "会議"), false);
});

test("Quick CaptureはTheme任意・連続入力・URLメタデータを保存する", () => {
  assert.match(controllerSource, /content_type:\s*contentType/);
  assert.match(controllerSource, /project_id:\s*themeId \|\| null/);
  assert.match(controllerSource, /url:\s*contentType === "url"/);
  assert.match(captureWindowSource, /submit\(event\.shiftKey\)/);
  assert.match(captureWindowSource, /const usesTheme = mode !== "micro-memo"/);
});

test("Inboxはファイル・手書き・整理済み履歴を同じCaptureEntry経路で扱う", () => {
  assert.match(inboxSource, /buildLinkedArtifactOperationsFromPaths\(picked\.files, "capture_entry", captureId\)/);
  assert.match(inboxSource, /content_type:\s*"ink"/);
  assert.match(inboxSource, /lane === "processed"/);
  assert.match(inboxSource, /Inboxへ戻す/);
  assert.match(inboxSource, /draft\.output === "document"/);
  assert.match(inboxSource, /draft\.output === "artifact"/);
});
