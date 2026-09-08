import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  runPublicationEvaluation,
  validatePublicationFiles,
  validateQuestionSources,
} from "../scripts/evaluate-publication-context.mjs";
import { publicationQuestions } from "./fixtures/publication-context.fixture.mjs";

test("synthetic publication evaluation completes locally and leaves live checks unclaimed", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-publication-evaluation-test-"));
  try {
    const output = path.join(parent, "new-evaluation");
    const { root, publicationDirectory, result } = await runPublicationEvaluation({ output });
    assert.equal(root, output);
    assert.equal(publicationDirectory, path.join(output, "current", "Tasken Context"));
    assert.equal(result.synthetic, true);
    assert.equal(result.localValidation, "passed");
    for (const field of ["cloudRead", "aiSearch", "groundedAnswer"])
      assert.equal(result[field], "not_run");
    assert.ok(result.pendingAtRestart > 0);
    assert.deepEqual(result.partial, { included: 500, matched: 501 });
    for (const snapshot of ["initial", "updated"])
      assert.deepEqual(
        result[snapshot].map(({ id, sources }) => ({ id, sources })),
        publicationQuestions.map((question) => ({
          id: question.id,
          sources: [...question.expectedSources[snapshot]].sort(),
        })),
      );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(root, "verification.json"), "utf8")),
      result,
    );
    const questions = fs.readFileSync(path.join(root, "questions.md"), "utf8");
    for (const question of publicationQuestions) assert.ok(questions.includes(question.question));
    const before = fs.readFileSync(path.join(root, "verification.json"));
    await assert.rejects(runPublicationEvaluation({ output }), { code: "EEXIST" });
    assert.deepEqual(fs.readFileSync(path.join(root, "verification.json")), before);
    const empty = path.join(parent, "existing-empty");
    fs.mkdirSync(empty);
    await assert.rejects(runPublicationEvaluation({ output: empty }), { code: "EEXIST" });
    assert.deepEqual(fs.readdirSync(empty), []);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("publication validation rejects broken links, escaped links and forbidden content", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-publication-validation-test-"));
  try {
    const directory = path.join(parent, "publication");
    fs.mkdirSync(directory);
    const index = path.join(directory, "README.md");
    fs.writeFileSync(path.join(directory, "source.md"), "公開してよい架空の本文");
    fs.writeFileSync(index, "[出典](source.md)");
    assert.equal(validatePublicationFiles(directory).length, 2);
    fs.writeFileSync(index, "[出典](missing.md)");
    assert.throws(() => validatePublicationFiles(directory), /missing link/);
    fs.writeFileSync(path.join(parent, "outside.md"), "範囲外の架空ファイル");
    fs.writeFileSync(index, "[出典](..%2Foutside.md)");
    assert.throws(() => validatePublicationFiles(directory), /link escapes publication/);
    fs.writeFileSync(index, "NEVER_EXPORT_548");
    assert.throws(
      () => validatePublicationFiles(directory, ["NEVER_EXPORT_548"]),
      /forbidden marker/,
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("question source validation rejects an unrelated source in the requested day", () => {
  const plans = [
    {
      selection: { date: "2026-09-06" },
      rows: [
        {
          stage: "work_recorded",
          themeId: "theme-a",
          source: { type: "note", id: "unrelated-source" },
        },
      ],
    },
  ];
  assert.throws(() => validateQuestionSources(plans, "updated"), /day-work/);
});
