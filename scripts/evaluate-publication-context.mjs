import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
  evaluationIdentity as identity,
  publicationFixture,
  publicationQuestions,
  truncationFixture,
} from "../tests/fixtures/publication-context.fixture.mjs";

const repository = fileURLToPath(new URL("..", import.meta.url));
const bundled = await build({
  stdin: {
    contents: `export { buildDailyContextPlan } from './src/shared/dailyContext.ts'; export { publishDailyContext, readDailyContextSelections } from './src/main/services/dailyContextPublisher.ts'; export { collectDailyContextAutoChanges } from './src/main/services/dailyContextAutoSources.ts'; export { DailyContextAutoPublisher } from './src/main/services/dailyContextAutoPublisher.ts';`,
    resolveDir: repository,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const {
  buildDailyContextPlan,
  publishDailyContext,
  readDailyContextSelections,
  collectDailyContextAutoChanges,
  DailyContextAutoPublisher,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

export function validatePublicationFiles(directory, forbidden = []) {
  const files = fs
    .readdirSync(directory, { recursive: true })
    .filter((name) => name.endsWith(".md"));
  assert.ok(files.length > 0, "Markdown files must exist");
  for (const name of files) {
    const filename = path.join(directory, name);
    const content = fs.readFileSync(filename, "utf8");
    const visibleText = content.replace(/\\([\\`*_{}[\]()<>#!|])/g, "$1");
    for (const marker of forbidden)
      assert.ok(!visibleText.includes(marker), `${name}: forbidden marker ${marker}`);
    for (const [, href] of content.matchAll(/\]\(([^\s)]+)\)/g)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) continue;
      const target = path.resolve(path.dirname(filename), decodeURIComponent(href.split("#")[0]));
      const relative = path.relative(directory, target);
      assert.ok(
        relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
        `${name}: link escapes publication`,
      );
      assert.ok(fs.existsSync(target), `${name}: missing link ${href}`);
    }
  }
  return files;
}

export function validateQuestionSources(plans, snapshot) {
  return publicationQuestions.map((question) => {
    const rows = plans
      .filter((plan) => plan.selection.date >= question.from && plan.selection.date <= question.to)
      .flatMap((plan) => plan.rows)
      .filter(
        (row) =>
          question.stages.includes(row.stage) &&
          (!question.themeId || row.themeId === question.themeId),
      );
    const sources = [...new Set(rows.map((row) => `${row.source.type}:${row.source.id}`))].sort();
    assert.deepEqual(sources, [...question.expectedSources[snapshot]].sort(), question.id);
    return { id: question.id, sources, rowCount: rows.length };
  });
}

export async function runPublicationEvaluation({ output } = {}) {
  // Exclusive creation protects every pre-existing directory, even an empty one.
  const root = output
    ? path.resolve(output)
    : fs.mkdtempSync(path.join(os.tmpdir(), "tasken-publication-evaluation-"));
  if (output) fs.mkdirSync(root);
  const publicationRoot = path.join(root, "current");
  fs.mkdirSync(publicationRoot);
  const statePath = path.join(root, "queue-state.json");
  let workspace = publicationFixture();
  let generatedAt = identity.initialAt;
  const plans = new Map();
  const makePlan = (date, extra = {}) =>
    buildDailyContextPlan({
      workspace,
      workspaceId: identity.workspaceId,
      workspaceDefault: ["m365"],
      generatedAt,
      selection: { date, timezone: identity.timezone, themeId: null, includeFullText: true },
      ...extra,
    });
  const publish = (date, _config, freshness) => {
    const plan = makePlan(date);
    publishDailyContext({
      root: publicationRoot,
      plan,
      expectedContentHash: plan.contentHash,
      ...(freshness
        ? {
            freshness: {
              ...freshness,
              pendingCount: Math.max(0, freshness.pendingCount - 1),
              publishedThrough: freshness.pendingCount === 1 ? identity.today : null,
              sourceRevision: plan.sourceRevision,
              lastLocalWrittenAt: generatedAt,
            },
          }
        : {}),
    });
    plans.set(date, plan);
    return { written: true, generatedAt, sourceRevision: plan.sourceRevision };
  };
  for (const date of identity.historicalDates) publish(date);
  const options = {
    readState: () =>
      fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : null,
    writeState: (state) => fs.writeFileSync(statePath, JSON.stringify(state, null, 2)),
    scan: (state) => ({
      ...collectDailyContextAutoChanges({
        workspace,
        workspaceDefault: ["m365"],
        sourceHashes: state.sourceHashes,
        checkedThrough: state.checkedThrough,
        fromDate: state.config.fromDate,
        today: identity.today,
        timezone: identity.timezone,
        publishedDays: readDailyContextSelections(
          publicationRoot,
          identity.workspaceId,
          identity.timezone,
        ).days,
      }),
      deviceObservations: [
        {
          kind: "android_connection",
          deviceId: "synthetic-android-548",
          observedAt: identity.initialAt,
        },
        {
          kind: "shared_folder_received",
          deviceId: "synthetic-folder-548",
          observedAt: identity.initialAt,
          revision: 7,
        },
      ],
    }),
    publish,
    now: () => new Date(generatedAt),
  };
  let engine = new DailyContextAutoPublisher(options);
  engine.configure({
    enabled: true,
    root: publicationRoot,
    fromDate: identity.fromDate,
    timezone: identity.timezone,
    themeId: null,
    includeFullText: true,
  });
  const drain = async () => {
    for (let iteration = 0; iteration < 30; iteration++) {
      await engine.runOnce();
      assert.equal(engine.status().error, null);
      if (engine.status().freshness.pendingCount === 0) return;
    }
    throw new Error("Evaluation queue did not drain");
  };
  await drain();
  const initial = validateQuestionSources([...plans.values()], "initial");
  const septemberRows = plans.get("2026-09-06").rows;
  assert.ok(
    septemberRows.some((row) => row.source.id === "task-planned" && row.stage === "planned"),
  );
  assert.ok(
    septemberRows.some(
      (row) => row.source.id === "task-ai-unconfirmed" && row.stage === "ai_reported",
    ),
  );
  assert.ok(
    septemberRows.some((row) => row.source.id === "capture-corrected" && row.stage === "input"),
  );
  assert.equal(
    plans.get("2026-08-15").rows.filter((row) => row.source.id === "task-history").length,
    1,
  );
  const directory = path.join(publicationRoot, "Tasken Context");
  validatePublicationFiles(directory, ["NEVER_EXPORT_548"]);
  const initialText = fs
    .readdirSync(directory, { recursive: true })
    .filter((name) => name.endsWith(".md"))
    .map((name) => fs.readFileSync(path.join(directory, name), "utf8"))
    .join("\n");
  assert.ok(initialText.replaceAll("\\_", "_").includes("WITHDRAW_548"));
  assert.ok(initialText.includes("SUPERSEDED_548"));
  workspace = publicationFixture("updated");
  generatedAt = identity.updatedAt;
  engine.wake();
  await engine.runOnce();
  const pendingAtRestart = engine.status().freshness.pendingCount;
  assert.ok(pendingAtRestart > 0, "Restart must occur with known pending work");
  engine = new DailyContextAutoPublisher(options);
  assert.equal(engine.status().freshness.pendingCount, pendingAtRestart);
  await drain();
  const updated = validateQuestionSources([...plans.values()], "updated");
  const files = validatePublicationFiles(directory, [
    "NEVER_EXPORT_548",
    "NEVER_EXPORT\\_548",
    "WITHDRAW_548",
    "WITHDRAW\\_548",
    "SUPERSEDED_548",
    "SUPERSEDED\\_548",
  ]);
  const finalText = files
    .map((name) => fs.readFileSync(path.join(directory, name), "utf8"))
    .join("\n");
  assert.ok(finalText.includes("CORRECTED_548"));
  assert.ok(finalText.includes("FULL_TEXT_END_548"));
  assert.ok(plans.get("2026-09-04").rows.some((row) => row.source.id === "log-late"));
  assert.ok(!plans.get("2026-09-08").rows.some((row) => row.source.id === "log-late"));
  const days = readDailyContextSelections(
    publicationRoot,
    identity.workspaceId,
    identity.timezone,
  ).days;
  for (const [date, plan] of plans) {
    assert.equal(fs.readFileSync(path.join(directory, plan.relativePath), "utf8"), plan.content);
    assert.equal(days[date].sourceRevision, plan.sourceRevision);
    assert.equal(days[date].contentHash, plan.contentHash);
    assert.deepEqual(days[date].sources, plan.sources);
  }
  const readme = fs.readFileSync(path.join(directory, "README.md"), "utf8");
  assert.ok(readme.includes(identity.updatedAt));
  assert.match(readme, /収録期間: 2025-12-31〜2026-09-08/);
  assert.match(readme, /把握した処理残件: 0日/);
  assert.match(readme, /Androidの未送信件数: 不明/);
  assert.match(readme, /クラウド同期・外部AIの索引更新: 未確認/);
  assert.match(readme, /Android最終接続を観測（同期完了ではありません）/);
  assert.match(readme, /synthetic-folder-548.*revision 7/);
  const partialRoot = path.join(root, "partial-case");
  fs.mkdirSync(partialRoot);
  const partial = makePlan(identity.today, { workspace: truncationFixture(), maxPages: 1 });
  assert.equal(partial.partial, true);
  assert.equal(partial.includedCount, 500);
  assert.equal(partial.matchedVisibleCount, 501);
  assert.throws(() =>
    publishDailyContext({
      root: partialRoot,
      plan: partial,
      expectedContentHash: partial.contentHash,
    }),
  );
  publishDailyContext({
    root: partialRoot,
    plan: partial,
    expectedContentHash: partial.contentHash,
    allowPartial: true,
  });
  assert.match(partial.content, /部分取得/);
  validatePublicationFiles(path.join(partialRoot, "Tasken Context"));
  const result = {
    schema: "tasken-publication-evaluation/v1",
    synthetic: true,
    identity,
    initial,
    updated,
    pendingAtRestart,
    publishedDates: Object.keys(days).sort(),
    markdownCount: files.length,
    partial: { included: 500, matched: 501 },
    localValidation: "passed",
    cloudRead: "not_run",
    aiSearch: "not_run",
    groundedAnswer: "not_run",
  };
  fs.writeFileSync(path.join(root, "verification.json"), JSON.stringify(result, null, 2) + "\n");
  fs.writeFileSync(
    path.join(root, "questions.md"),
    publicationQuestions
      .map(
        (q) =>
          `## ${q.id}\n\n${q.question}\n\n期待する出典: ${q.expectedSources.updated.join(", ")}\n\n言ってよい事実:\n${q.allowedFacts.map((v) => `- ${v}`).join("\n")}\n\n推測してはいけない内容:\n${q.forbiddenClaims.map((v) => `- ${v}`).join("\n")}\n`,
      )
      .join("\n"),
  );
  return { root, publicationDirectory: directory, result };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--output"))
      throw new Error(
        "Usage: node scripts/evaluate-publication-context.mjs [--output NEW_DIRECTORY]",
      );
    const result = await runPublicationEvaluation({ output: args[1] });
    console.log(`${result.root}: synthetic publication evaluation passed; live checks not run`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
