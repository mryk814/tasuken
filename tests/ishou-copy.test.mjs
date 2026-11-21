// 共通の意匠の写し（src/renderer/src/styles/ishou）は、写した時のまま（MANIFEST）で、足したファイルが無く、
// 意匠の元のリポジトリの main と同じ。辞書の写しの試験（search-dictionary.test.mjs）と同じ決まり。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ISHOU_COPY = path.resolve(import.meta.dirname, "../src/renderer/src/styles/ishou");
// 写しの元のリポジトリでの置き場所。MANIFEST の file の行はこの下の名前。
const ISHOU_SOURCE_DIR = "ishou";

// 作業ツリーが CRLF でも同じ結果にする（MANIFEST の hash は LF の中身で取ってある）。
const readCopyFile = (name) =>
  readFileSync(path.join(ISHOU_COPY, name), "utf8").replaceAll("\r\n", "\n");

function readIshouManifest() {
  let commit = null;
  let set = null;
  const files = {};
  for (const row of readCopyFile("MANIFEST").split("\n")) {
    const fields = row.split("\t");
    if (fields[0] === "commit" && fields.length === 2) commit = fields[1];
    if (fields[0] === "set" && fields.length === 2) set = fields[1];
    if (fields[0] === "file" && fields.length === 3) files[fields[1]] = fields[2];
  }
  return { commit, set, files };
}

const manifest = readIshouManifest();

test("意匠の写しは写した時のままで、足したファイルが無い", () => {
  assert.equal(manifest.set, "ishou", "MANIFEST は意匠の組（-set ishou）の写し");
  assert.match(manifest.commit ?? "", /^[0-9a-f]{40}$/, "MANIFEST に元の commit がある");
  const names = Object.keys(manifest.files).sort();
  assert.ok(
    names.includes("tokens.css") && names.includes("offline.css"),
    `意匠の組のファイルが欠けています: ${names}`,
  );
  for (const [name, recorded] of Object.entries(manifest.files)) {
    const actual = createHash("sha256").update(readCopyFile(name)).digest("hex");
    assert.equal(
      actual,
      recorded,
      `${name} が MANIFEST と合いません。写しは手で直さず、元のリポジトリで直してから写し直します`,
    );
  }
  assert.deepEqual(
    readdirSync(ISHOU_COPY).sort(),
    ["MANIFEST", ...names].sort(),
    "写しに MANIFEST に無いファイルがあります",
  );
});

// 写しが元のリポジトリの main より古くなったら、ここで落ちる。元の clone は、このリポジトリの clone の隣に
// kotoba の名前である（worktree からでも main の checkout の隣）。最後に fetch した origin/main と比べ、
// ネットワークは使わない。隣に無い時（GitHub の CI、NAS の build）は比べない。
test("意匠の写しは元のリポジトリの main と同じ", (t) => {
  const git = (cwd, args) =>
    execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  let common;
  try {
    common = git(ISHOU_COPY, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  } catch {
    t.skip("git の外なので、元の main と比べません");
    return;
  }
  const source = path.join(path.dirname(path.dirname(common)), "kotoba");
  let tip;
  try {
    // 写しの元の commit を持っていれば、元のリポジトリの clone とみなす。
    git(source, ["cat-file", "-e", `${manifest.commit}^{commit}`]);
    tip = git(source, ["rev-parse", "origin/main"]);
  } catch {
    t.skip(
      `${source} に写しの元 ${String(manifest.commit).slice(0, 12)} を持つ clone がないので、元の main と比べません`,
    );
    return;
  }
  const changed = git(source, [
    "diff",
    "--name-only",
    manifest.commit,
    tip,
    "--",
    ...Object.keys(manifest.files).map((name) => `${ISHOU_SOURCE_DIR}/${name}`),
  ]);
  assert.equal(
    changed,
    "",
    `意匠の写しが元の main（${tip.slice(0, 12)}）と違います（写しの元 ${manifest.commit.slice(0, 12)}）: ${changed.replaceAll("\n", ", ")}\n` +
      `元のリポジトリの main から、意匠の組（-set ishou）で ${ISHOU_COPY} へ写し直し、試験を通してからコミットします`,
  );
});
