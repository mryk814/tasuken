import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseArguments,
  seedAgentSessionEntryDemo,
} from "../scripts/seed-agent-session-entry-demo.mjs";

test("Agent Session entry demo requires a valid isolated date and directory argument", () => {
  assert.throws(() => parseArguments(["--date", "2026/08/29"]), /YYYY-MM-DD/);
  assert.throws(() => parseArguments(["--user-data-dir"]), /専用ディレクトリ/);
  assert.throws(() => parseArguments(["--apply-local"]), /未知の引数/);

  const parsed = parseArguments([
    "--user-data-dir",
    path.join("output", "fixture-agent-session-entry"),
    "--date",
    "2026-08-29",
  ]);
  assert.equal(parsed.date, "2026-08-29");
  assert.equal(path.isAbsolute(parsed.userDataPath), true);
});

test("Agent Session entry demo rejects an existing unmarked userData directory", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-agent-session-foreign-data-"));
  try {
    fs.writeFileSync(path.join(root, "foreign.txt"), "do not replace", "utf8");
    await assert.rejects(
      seedAgentSessionEntryDemo({ userDataPath: root, date: "2026-08-29" }),
      /空の専用ディレクトリ/,
    );
    assert.equal(fs.readFileSync(path.join(root, "foreign.txt"), "utf8"), "do not replace");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Codex, Claude Code, and GitHub Copilot lifecycles cross collector, Core Proposal, and acceptance", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-agent-session-entry-demo-"));
  const userDataPath = path.join(root, "userData");
  try {
    const result = await seedAgentSessionEntryDemo({
      userDataPath,
      date: "2026-08-29",
    });

    assert.equal(result.userDataPath, userDataPath);
    assert.equal(result.sessions.length, 3);
    assert.deepEqual(
      result.sessions.map((session) => session.client_kind),
      ["codex", "claude_code", "github_copilot"],
    );
    assert.deepEqual(
      result.submissions.map((submission) => submission.proposal_status),
      ["accepted", "accepted", "accepted"],
    );
    assert.equal(result.activityEventCount, 3);
    assert.equal(
      result.sessions.find((session) => session.client_kind === "github_copilot")?.outcome,
      "EIS特徴量抽出を整理し、境界条件のテスト観点を3件にまとめました。",
    );
    assert.equal(fs.existsSync(path.join(userDataPath, ".agent-session-demo-transient")), false);

    assert.ok(result.sessions.every((session) => session.status === "completed"));
    assert.ok(result.sessions.every((session) => session.request_event_count === 2));
    assert.ok(result.sessions.every((session) => session.response_checkpoint_count === 1));
    assert.ok(
      result.submissions.every(
        (submission) => submission.source_app === `tasken-session-hook:${submission.client_kind}`,
      ),
    );
    assert.deepEqual(result.forbiddenValuesFound, []);

    const observationDirectory = path.join(userDataPath, "agent-session-observations");
    const observations = fs
      .readdirSync(observationDirectory)
      .filter((name) => name.endsWith(".json"))
      .map((name) => fs.readFileSync(path.join(observationDirectory, name), "utf8"))
      .join("\n");
    assert.equal(observations.includes("github-copilot-transcript.jsonl"), false);
    assert.equal(observations.includes("raw-demo-reasoning-must-not-be-persisted"), false);

    const repeated = await seedAgentSessionEntryDemo({
      userDataPath,
      date: "2026-08-29",
    });
    assert.equal(repeated.sessions.length, 3);
    assert.equal(repeated.activityEventCount, 3);
    assert.deepEqual(
      repeated.submissions.map((submission) => submission.proposal_status),
      ["accepted", "accepted", "accepted"],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
