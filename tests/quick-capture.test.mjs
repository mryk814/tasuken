import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  captureMatchesQuery,
  fileCaptureContentType,
  firstCaptureUrl,
  quickCaptureContentType,
  quickCaptureDueLabel,
  quickCaptureScheduleLabel,
  parseQuickCaptureSchedule,
  quickCaptureTitle,
  parseQuickCaptureDue,
  splitQuickCaptureInput,
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

test("Quick Captureの一行入力は全角・半角の区切りで本体と補足へ分かれる（#308）", () => {
  assert.deepEqual(splitQuickCaptureInput("報告書の下書きを送った｜ひとまず形になった"), {
    main: "報告書の下書きを送った",
    extra: "ひとまず形になった",
  });
  assert.deepEqual(splitQuickCaptureInput("住民票を取る|金曜まで"), {
    main: "住民票を取る",
    extra: "金曜まで",
  });
  assert.deepEqual(splitQuickCaptureInput("測定データを整理した"), {
    main: "測定データを整理した",
    extra: "",
  });
  // 補足側の区切りは分割せずそのまま残す。
  assert.equal(splitQuickCaptureInput("A｜B｜C").extra, "B｜C");
});

test("期限表現は相対語・曜日・日付・時刻を解釈する（#308）", () => {
  const today = "2026-08-06"; // 木曜
  const due = (text) => parseQuickCaptureDue(text, today);

  assert.equal(due("今日").date, "2026-08-06");
  assert.equal(due("明日").date, "2026-08-07");
  assert.equal(due("あさって").date, "2026-08-08");
  assert.equal(due("3日後").date, "2026-08-09");
  assert.equal(due("2週間後").date, "2026-08-20");
  assert.equal(due("金曜まで").date, "2026-08-07");
  // 今日と同じ曜日は「今日」ではなく次週を指す。
  assert.equal(due("木曜").date, "2026-08-13");
  assert.equal(due("来週金曜").date, "2026-08-14");
  assert.equal(due("今週末").date, "2026-08-08");
  assert.equal(due("来週").date, "2026-08-13");
  assert.equal(due("今月末").date, "2026-08-31");
  assert.equal(due("8月15日").date, "2026-08-15");
  assert.equal(due("8/15").date, "2026-08-15");
  assert.equal(due("2026-09-01").date, "2026-09-01");
  assert.equal(due("１５日").date, "2026-08-15");
  // 過ぎた月日は翌年として読む。
  assert.equal(due("1/5").date, "2027-01-05");

  assert.deepEqual(
    { date: due("明日17時まで").date, time: due("明日17時まで").time },
    { date: "2026-08-07", time: "17:00" },
  );
  assert.equal(due("明日 9:30").time, "09:30");
  assert.equal(due("明日午後3時").time, "15:00");
  assert.equal(due("今日18時半").time, "18:30");
  assert.equal(due("17時").date, "2026-08-06");
});

test("日付範囲はexecution windowを既定にし、継続の明示だけをongoing候補にする（#326）", () => {
  const ambiguous = parseQuickCaptureSchedule("8/10〜8/15", "2026-08-06");
  assert.equal(ambiguous.ok, true);
  assert.equal(ambiguous.startDate, "2026-08-10");
  assert.equal(ambiguous.endDate, "2026-08-15");
  assert.equal(ambiguous.rangeSemantics, "once_within_window");
  assert.equal(ambiguous.ambiguous, true);
  assert.match(quickCaptureScheduleLabel(ambiguous), /期間内に一度/);

  const ongoing = parseQuickCaptureSchedule("8/10〜8/15 継続", "2026-08-06");
  assert.equal(ongoing.ok, true);
  assert.equal(ongoing.rangeSemantics, "ongoing");
  assert.equal(ongoing.ambiguous, false);
  assert.match(quickCaptureScheduleLabel(ongoing), /継続/);
});

test("読み取れない期限は保存させずに直し方を返す（#308）", () => {
  const failed = parseQuickCaptureDue("なるはやで", "2026-08-06");
  assert.equal(failed.ok, false);
  assert.match(failed.message, /読み取れませんでした/);
  assert.match(failed.message, /8\/15/);
  assert.equal(parseQuickCaptureDue("", "2026-08-06").ok, false);
  assert.equal(parseQuickCaptureDue("13月40日", "2026-08-06").ok, false);
});

test("期限のラベルは曜日と時刻を添えて確認できる（#308）", () => {
  assert.equal(quickCaptureDueLabel({ date: "2026-08-07", time: "" }), "2026-08-07（金）");
  assert.equal(quickCaptureDueLabel({ date: "2026-08-07", time: "17:00" }), "2026-08-07（金） 17:00");
  assert.equal(quickCaptureDueLabel(null), "");
});

test("Quick Captureはmodeごとに補足を解釈し、期限つきTaskを直接保存する（#308）", () => {
  // 期限modeはdeadline scheduleで保存し、時刻があればリマインダーにする。
  assert.match(controllerSource, /date_kind: isRange \? "range" : mode === "due-task" \? "deadline" : "point"/);
  assert.match(controllerSource, /range_semantics: rangeSemantics/);
  assert.match(controllerSource, /reminder_at: parsedDue\?\.kind === "single" && parsedDue\.time/);
  // 読めない期限は例外にして、期限なしのまま保存しない。
  assert.match(controllerSource, /if \(due && !due\.ok\) throw new Error\(due\.message\)/);
  // やったことのひとことは本文と分けて保存する。
  assert.match(controllerSource, /completion_note: isDoneTask && extra \? extra : null/);
  // 入口ごとにmodeを決めて開く。
  assert.match(controllerSource, /期限つきタスクを追加/);
  assert.match(captureWindowSource, /previewDue/);
  assert.match(captureWindowSource, /期間中継続/);
  assert.match(captureWindowSource, /selectedRangeSemantics/);
});
