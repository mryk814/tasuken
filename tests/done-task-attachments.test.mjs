import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildDoneTaskArtifacts,
  DONE_TASK_ATTACHMENT_LIMIT,
  normalizeDoneTaskAttachments,
} from "../src/shared/doneTaskAttachments.ts";
import { validateEntity } from "../src/main/repositories/domain.mjs";

const RESULT = String.raw`C:\work\result.xlsx`;
const PLOT = String.raw`C:\work\plot.png`;
const REPORT = String.raw`C:\work\report.html`;
const SHARED_DATA = String.raw`\\nas\share\data.csv`;
const controllerSource = readFileSync("src/main/quickCaptureController.ts", "utf8");
const captureWindowSource = readFileSync("src/renderer/capture.html", "utf8");

test("完了Taskの成果物はファイルとhttp(s) URLだけを受け、重複を除く", () => {
  assert.deepEqual(normalizeDoneTaskAttachments(undefined), []);
  assert.deepEqual(
    normalizeDoneTaskAttachments([
      { kind: "file", path: RESULT, name: "result.xlsx" },
      { kind: "file", path: RESULT, name: "result.xlsx" },
      { kind: "file", path: PLOT },
      { kind: "url", url: " https://example.com/report " },
    ]),
    [
      { kind: "file", path: RESULT, name: "result.xlsx" },
      { kind: "file", path: PLOT, name: "plot.png" },
      { kind: "url", url: "https://example.com/report" },
    ],
  );
  assert.throws(() => normalizeDoneTaskAttachments({}), /成果物の指定が不正/);
  assert.throws(
    () => normalizeDoneTaskAttachments([{ kind: "url", url: "file:///C:/a.txt" }]),
    /http/,
  );
  assert.throws(() => normalizeDoneTaskAttachments([{ kind: "file", path: " " }]), /場所/);
  assert.throws(() => normalizeDoneTaskAttachments([{ kind: "note", id: "x" }]), /不正/);
  assert.throws(
    () =>
      normalizeDoneTaskAttachments(
        Array.from({ length: DONE_TASK_ATTACHMENT_LIMIT + 1 }, (_, index) => ({
          kind: "url",
          url: `https://example.com/${index}`,
        })),
      ),
    /件まで/,
  );
});

test("完了Taskを出所にしたArtifactを、元の場所を参照するファイルとURLとして作る", () => {
  let next = 0;
  const artifacts = buildDoneTaskArtifacts({
    taskId: "task-1",
    themeId: "theme-1",
    files: [
      { path: REPORT, name: "report.html" },
      { path: SHARED_DATA, name: "data.csv" },
    ],
    urls: ["https://github.com/mryk814/tasuken/pull/1"],
    newId: () => `artifact-${++next}`,
  });
  assert.deepEqual(
    artifacts.map((artifact) => [
      artifact.id,
      artifact.storage_mode,
      artifact.target,
      artifact.source_type,
      artifact.source_id,
      artifact.theme_id,
    ]),
    [
      ["artifact-1", "linked", REPORT, "task", "task-1", "theme-1"],
      ["artifact-2", "linked", SHARED_DATA, "task", "task-1", "theme-1"],
      [
        "artifact-3",
        "linked",
        "https://github.com/mryk814/tasuken/pull/1",
        "task",
        "task-1",
        "theme-1",
      ],
    ],
  );
  assert.equal(artifacts[0].web_kind, "self_contained_html");
  assert.equal(artifacts[1].title, "data");
  // 保存時の検査を通る形になっている。
  for (const artifact of artifacts) validateEntity("artifact", artifact);
});

test("完了Taskの記録は、見つからないファイルをTask作成より前に止め、成果物をTaskへ添える", () => {
  const branchAt = controllerSource.indexOf('if (mode === "today-task" || mode === "done-task")');
  const checkAt = controllerSource.indexOf("成果物のファイルが見つかりません", branchAt);
  const createAt = controllerSource.indexOf('name: "CreateTask"', branchAt);
  assert.ok(
    branchAt > 0 && checkAt > branchAt && createAt > checkAt,
    "ファイルが見つからなければTaskを作らない",
  );
  assert.match(controllerSource, /taskId,\s*themeId: taskThemeId,\s*files: attachedFiles/);
  assert.doesNotMatch(controllerSource, /importArtifactFiles/);
  assert.match(controllerSource, /成果物は完了Taskの記録でだけ添えられます/);
  // 外からドラッグしてくる間に閉じない。
  assert.match(controllerSource, /visibleMode !== "today-task" && visibleMode !== "done-task"/);
  assert.match(captureWindowSource, /attachmentsSection\.hidden = !isDoneTask/);
  assert.match(captureWindowSource, /window\.captureApi\.pathForFile\(file\)/);
  assert.match(captureWindowSource, /成果物\$\{attached\.length\}件/);
});
