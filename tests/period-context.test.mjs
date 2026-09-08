import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { build } from "esbuild";
import { markdownSignature } from "../src/shared/canonicalMarkdown.mjs";

const bundle = await build({
  stdin: {
    contents: `export * from './src/shared/periodContext.ts'; export * from './src/main/services/dailyContextPublisher.ts';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { buildPeriodContextFiles, contextIsoWeek, publishDailyContext } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
function plan(date, { title = "研究", empty = false, partial = false } = {}) {
  const source = { type: "work_log", id: "same-source", revision: 1 };
  const content = `# ${date}\n\n${empty ? "収録0件" : title + "\nwork_log:same-source"}\n`;
  return {
    schema: "tasken-daily-context/v1",
    workspaceId: "fixture",
    selection: { date, timezone: "Asia/Tokyo", themeId: null },
    generatedAt: "2026-09-06T00:00:00.000Z",
    sourceRevision: "revision-1",
    contentHash: markdownSignature(content),
    relativePath: `Days/${date}.md`,
    content,
    sources: empty ? [] : [source],
    includedCount: empty ? 0 : 2,
    excludedCount: 0,
    excludedReasons: [],
    partial,
    rows: empty
      ? []
      : [
          { themeId: "research", themeTitle: title, source },
          { themeId: null, themeTitle: null, source },
        ],
  };
}
function root(t) {
  const result = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-period-"));
  t.after(() => fs.rmSync(result, { recursive: true, force: true }));
  return result;
}
function publish(root, value, fileSystem = fs) {
  return publishDailyContext({
    root,
    plan: value,
    expectedContentHash: value.contentHash,
    allowPartial: true,
    fileSystem,
  });
}
function manifest(root) {
  return JSON.parse(
    fs.readFileSync(path.join(root, "Tasken Context/.tasken-context.json"), "utf8"),
  );
}

test("ISO calendar uses Monday and week-year across calendar years", () => {
  assert.deepEqual(contextIsoWeek("2021-01-01"), {
    key: "2020-W53",
    start: "2020-12-28",
    end: "2021-01-03",
  });
  assert.deepEqual(contextIsoWeek("2024-12-30"), {
    key: "2025-W01",
    start: "2024-12-30",
    end: "2025-01-05",
  });
});

test("indexes link years through months and weeks to days, distinguish coverage, and deduplicate sources", (t) => {
  const destination = root(t);
  for (const value of [
    plan("2020-12-31"),
    plan("2021-01-01", { partial: true }),
    plan("2024-02-28"),
    plan("2024-02-29", { empty: true }),
  ])
    publish(destination, value);
  const saved = manifest(destination);
  const files = buildPeriodContextFiles({ days: saved.days, timezone: saved.timezone });
  assert.match(files["Weeks/2020-W53.md"], /公開日 2日 \/ 未公開日 5日 \/ 重複を除いた出典 1件/);
  assert.match(files["Weeks/2020-W53.md"], /部分公開・収録打切り/);
  assert.match(files["Months/2024-02.md"], /公開日 2日 \/ 未公開日 27日/);
  assert.match(files["Months/2024-02.md"], /公開済み・収録0件/);
  assert.match(files["Years/2024.md"], /未公開日 364日/);
  assert.match(files["Years/2020.md"], /Themeなし/);
  assert.match(files["Years/2020.md"], /研究/);
  assert.match(files["Years/2020.md"], /work\\_log: 1件/);
  for (const [name, content] of Object.entries(files)) {
    assert.equal(fs.readFileSync(path.join(destination, "Tasken Context", name), "utf8"), content);
    for (const [, href] of content.matchAll(/\]\(([^)]+)\)/g)) {
      const linked = path.resolve(destination, "Tasken Context", path.dirname(name), href);
      assert.ok(fs.existsSync(linked), `${name} -> ${href}`);
    }
  }
  assert.deepEqual(buildPeriodContextFiles({ days: saved.days, timezone: saved.timezone }), files);
  assert.match(
    buildPeriodContextFiles({
      days: saved.days,
      timezone: saved.timezone,
      pendingDate: "2021-01-01",
    })["README.md"],
    /未反映: 2021-01-01/,
  );
});

test("republishing privacy shrink removes previous Theme text from every managed index and leaves foreign files", (t) => {
  const destination = root(t);
  publish(destination, plan("2026-09-06", { title: "非公開にする名前" }));
  const foreign = path.join(destination, "Tasken Context", "my-notes.txt");
  fs.writeFileSync(foreign, "keep");
  publish(destination, plan("2026-09-06", { empty: true }));
  for (const name of Object.keys(manifest(destination).indexFiles))
    assert.ok(
      !fs
        .readFileSync(path.join(destination, "Tasken Context", name), "utf8")
        .includes("非公開にする名前"),
    );
  assert.equal(fs.readFileSync(foreign, "utf8"), "keep");
  const before = manifest(destination).indexFiles;
  publish(destination, plan("2026-09-06", { empty: true }));
  assert.deepEqual(manifest(destination).indexFiles, before);
});

test("interrupted indexes remain pending and repeated failures with revised plans can recover", (t) => {
  const destination = root(t);
  publish(destination, plan("2026-09-06", { title: "old" }));
  const fail = {
    ...fs,
    writeFileSync(file, ...args) {
      if (String(file).includes(`${path.sep}Years${path.sep}`)) throw new Error("disk full");
      return fs.writeFileSync(file, ...args);
    },
  };
  assert.throws(
    () => publish(destination, plan("2026-09-06", { title: "middle" }), fail),
    /未完了/,
  );
  assert.ok(manifest(destination).pending);
  assert.throws(
    () => publish(destination, plan("2026-09-06", { title: "latest" }), fail),
    /未完了/,
  );
  publish(destination, plan("2026-09-06", { title: "latest" }));
  const saved = manifest(destination);
  assert.equal(saved.pending, null);
  for (const [name, hash] of Object.entries(saved.indexFiles))
    assert.equal(
      markdownSignature(fs.readFileSync(path.join(destination, "Tasken Context", name), "utf8")),
      hash,
    );
  assert.match(
    fs.readFileSync(path.join(destination, "Tasken Context/Years/2026.md"), "utf8"),
    /latest/,
  );
});

test("retry cleans owned Windows backup files before completing privacy withdrawal", (t) => {
  for (const { marker, failAt } of [
    { marker: "Years", failAt: 1 },
    { marker: ".tasken-context.json", failAt: 1 },
    { marker: ".tasken-context.json", failAt: 2 },
  ]) {
    const destination = root(t);
    publish(destination, plan("2026-09-06", { title: "old-private-title" }));
    let backups = 0;
    const fail = {
      ...fs,
      renameSync(from, to) {
        if (String(from).endsWith(".tmp") && String(to).includes(marker) && fs.existsSync(to))
          throw Object.assign(new Error("Windows replace denied"), { code: "EPERM" });
        return fs.renameSync(from, to);
      },
      unlinkSync(file) {
        if (String(file).endsWith(".bak") && String(file).includes(marker)) {
          backups++;
          if (backups === failAt) throw new Error("backup is locked");
        }
        return fs.unlinkSync(file);
      },
    };
    assert.throws(() => publish(destination, plan("2026-09-06", { empty: true }), fail));
    assert.ok(backups > 0);
    publish(destination, plan("2026-09-06", { empty: true }));
    const folder = path.join(destination, "Tasken Context");
    for (const relative of fs.readdirSync(folder, { recursive: true })) {
      const file = path.join(folder, relative);
      if (fs.statSync(file).isFile())
        assert.ok(!fs.readFileSync(file, "utf8").includes("old-private-title"), relative);
    }
    assert.equal(manifest(destination).pending, null);
  }
});

test("external edits to indexes are rejected before changing the day", (t) => {
  const destination = root(t);
  const original = plan("2026-09-06");
  publish(destination, original);
  fs.writeFileSync(path.join(destination, "Tasken Context/README.md"), "user content");
  assert.throws(() => publish(destination, plan("2026-09-06", { empty: true })), /外部で変更/);
  assert.equal(
    fs.readFileSync(path.join(destination, "Tasken Context", original.relativePath), "utf8"),
    original.content,
  );
  assert.equal(manifest(destination).pending, null);
});

test("withdrawn day files remove obsolete period indexes and preserve unrelated neighboring files", (t) => {
  const destination = root(t);
  publish(destination, plan("2024-02-29", { title: "withdrawn" }));
  const folder = path.join(destination, "Tasken Context");
  fs.writeFileSync(path.join(folder, "Years/personal.md"), "keep");
  fs.unlinkSync(path.join(folder, "Days/2024-02-29.md"));
  publish(destination, plan("2026-09-06"));
  assert.equal(manifest(destination).days["2024-02-29"], undefined);
  assert.equal(fs.existsSync(path.join(folder, "Years/2024.md")), false);
  assert.equal(fs.readFileSync(path.join(folder, "Years/personal.md"), "utf8"), "keep");
  assert.ok(!fs.readFileSync(path.join(folder, "README.md"), "utf8").includes("2024"));
});
