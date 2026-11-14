// 共通の辞書の写し（src/shared/searchdict/kotoba）と、それを使う検索。
// 写しは辞書の中身のまま（MANIFEST）で一般の表記ゆれだけ、生成した module は写しのまま、読み手の決まり
// （照合のキー・行の決まり・expand・find）はここの例のとおりに動き、Task と Note の検索がほかの書き方でも
// 当たって、書いたままの問いで当たった物が先に並ぶ。
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

import {
  KOTOBA_COPY,
  KOTOBA_GENERATED,
  readKotobaCopy,
  renderKotobaModule,
} from "../scripts/generate-search-dictionary.mjs";
import {
  filterCommandEntries,
  prepareCommandEntries,
  rankCommandEntries,
} from "../src/shared/commandPalette.mjs";
import {
  checkKotoba,
  kotobaKey,
  loadKotoba,
  parseKotoba,
} from "../src/shared/searchdict/kotoba.ts";
import {
  createTextSearch,
  searchQueryVariants,
  termSpellings,
} from "../src/shared/searchdict/searchSpellings.ts";

const copy = readKotobaCopy();

async function importTs(relativePath) {
  const bundle = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );
}

test("写しは辞書の中身のままで、一般の表記ゆれだけを持ち、足したファイルが無い", () => {
  // このリポジトリは公開なので、写しに置いてよいのは一般の表記ゆれの表だけ。
  assert.deepEqual(Object.keys(copy.files), ["dict/alias.tsv"]);
  const walk = (directory) =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(path.join(directory, entry.name))
        : [path.relative(KOTOBA_COPY, path.join(directory, entry.name)).split(path.sep).join("/")],
    );
  assert.deepEqual(
    walk(KOTOBA_COPY).sort(),
    ["MANIFEST", "dict/alias.tsv"],
    "写しに MANIFEST に無いファイルがあります",
  );
});

test("写しを手で直すと MANIFEST と合わず、ほかの組の写しは受け付けない", (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasken-search-dictionary-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  cpSync(KOTOBA_COPY, directory, { recursive: true });
  assert.deepEqual(readKotobaCopy(directory), copy);

  const alias = path.join(directory, "dict/alias.tsv");
  const original = readFileSync(alias);
  writeFileSync(alias, Buffer.concat([original, Buffer.from("alias\t架空\tかくう\n")]));
  assert.throws(() => readKotobaCopy(directory), /MANIFEST と合いません/);
  writeFileSync(alias, original);

  const manifest = path.join(directory, "MANIFEST");
  writeFileSync(manifest, readFileSync(manifest, "utf8").replace("set\talias", "set\tdict"));
  assert.throws(() => readKotobaCopy(directory), /一般の表記ゆれの組/);
});

// 写しが辞書の main より古くなったら、ここで落ちる。辞書の元のリポジトリの clone は、このリポジトリの
// clone の隣に、写しのフォルダーと同じ名前である（worktree からでも main の checkout の隣）。最後に fetch した
// origin/main と比べ、ネットワークは使わない。隣に無い時（GitHub の CI、NAS の build）は比べない。
test("写しは共通の辞書の main と同じ", (t) => {
  const git = (cwd, args) =>
    execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  let common;
  try {
    common = git(KOTOBA_COPY, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  } catch {
    t.skip("git の外なので、辞書の main と比べません");
    return;
  }
  const source = path.join(path.dirname(path.dirname(common)), path.basename(KOTOBA_COPY));
  let tip;
  try {
    // 写しの元の commit を持っていれば、辞書の元のリポジトリの clone とみなす。
    git(source, ["cat-file", "-e", `${copy.commit}^{commit}`]);
    tip = git(source, ["rev-parse", "origin/main"]);
  } catch {
    t.skip(
      `${source} に写しの元 ${copy.commit.slice(0, 12)} を持つ辞書の clone がないので、辞書の main と比べません`,
    );
    return;
  }
  const changed = git(source, [
    "diff",
    "--name-only",
    copy.commit,
    tip,
    "--",
    ...Object.keys(copy.files),
  ]);
  assert.equal(
    changed,
    "",
    `写しが辞書の main（${tip.slice(0, 12)}）と違います（写しの元 ${copy.commit.slice(0, 12)}）: ${changed.replaceAll("\n", ", ")}\n` +
      `辞書の元のリポジトリの main から、一般の表記ゆれだけの組（-set alias）で ${KOTOBA_COPY} へ写し直し、` +
      `npm run search-dictionary:generate の後に試験を通してからコミットします`,
  );
});

test("生成した module は写しのまま", () => {
  assert.equal(
    readFileSync(KOTOBA_GENERATED, "utf8"),
    renderKotobaModule(copy),
    "kotobaFiles.generated.ts が写しと合いません。npm run search-dictionary:generate で作り直します",
  );
  const tampered = { ...copy, files: { ...copy.files } };
  tampered.files["dict/alias.tsv"] += "alias\t架空\tかくう\n";
  assert.notEqual(renderKotobaModule(tampered), renderKotobaModule(copy));
});

// 照合のキーの例。Android の KotobaTest も同じ例を持つ（片方を変えたら、もう片方も）。
test("照合のキーは NFKC にしてから小文字", () => {
  const examples = {
    ＷｉＦｉ: "wifi",
    "Wi-Fi": "wi-fi",
    ＡＢＣ１２３: "abc123",
    ｶﾞｲﾄﾞ: "ガイド",
    ガイド: "ガイド",
    "①": "1",
    "㈱": "(株)",
    ｷﾛ: "キロ",
    "㌔": "キロ",
    引っ越し: "引っ越し",
    "ひらがな カタカナ": "ひらがな カタカナ",
    "全角　空白": "全角 空白",
    Ｓｔｒａßｅ: "straße",
    ÀÉ: "àé",
  };
  for (const [input, key] of Object.entries(examples)) {
    assert.equal(kotobaKey(input), key, `key(${input})`);
  }
  assert.notEqual(kotobaKey("かな"), kotobaKey("カナ"), "かなとカナは分けたまま");
});

// expand と find の例。Android の KotobaTest も同じ例を持つ。
test("expand は語を丸ごと広げ、find は文の中の書き方を長い方から読み出す", () => {
  const sample = loadKotoba({
    "dict/x.tsv": ["alias\t献立\tこんだて\tメニュー", "alias\tWi-Fi\tWiFi\t無線LAN"].join("\n"),
  });
  const expansions = {
    献立: ["こんだて", "メニュー"],
    こんだて: ["献立", "メニュー"],
    ﾒﾆｭｰ: ["献立", "こんだて"],
    ＷＩＦＩ: ["Wi-Fi", "無線LAN"],
    無線ｌａｎ: ["Wi-Fi", "WiFi"],
    旅行: [],
    献立表: [],
  };
  for (const [term, expected] of Object.entries(expansions)) {
    assert.deepEqual(sample.expand(term), expected, `expand(${term})`);
  }
  const finds = {
    献立とwifiとまた献立: ["献立", "WiFi"],
    "ＷＩ－ＦＩのこんだて": ["Wi-Fi", "こんだて"],
    旅行の話: [],
    "wifi6 と mywifi": [],
    "(wifi)と献立表": ["WiFi", "献立"],
  };
  for (const [text, expected] of Object.entries(finds)) {
    assert.deepEqual(sample.find(text), expected, `find(${text})`);
  }
  assert.deepEqual(sample.locate("夜の献立とwifi"), [
    { at: 2, length: 2, form: "献立" },
    { at: 5, length: 4, form: "WiFi" },
  ]);
  const long = loadKotoba({ "dict/x.tsv": "alias\t引っ越し\t引越し\nalias\t越し\t超し\n" });
  assert.deepEqual(long.find("引っ越しの日"), ["引っ越し"], "長い書き方が勝つ");
});

test("誤りの行と、二つの組に行く書き方を見つける", () => {
  assert.throws(
    () =>
      parseKotoba(
        "x.tsv",
        "﻿# 説明\n\nsame\tA\tB\nalias\tA\nalias\tA\t\nalias\tA\tB C\nalias\t献立\tこんだて\r\nalias\t餅\tもち\nalias\tご飯\tごはん\n",
      ),
    (error) =>
      ["x.tsv:3", "x.tsv:4", "x.tsv:5", "x.tsv:6", "x.tsv:8"].every((place) =>
        error.message.includes(place),
      ) && ["x.tsv:1:", "x.tsv:7", "x.tsv:9"].every((place) => !error.message.includes(place)),
  );
  assert.equal(parseKotoba("x.tsv", "alias\t献立\tこんだて\r\n").length, 1);
  for (const [name, text] of Object.entries({
    同じ行に2回: "alias\tWiFi\twifi\n",
    "二つの alias": "alias\t引越し\t引越\nalias\t引っ越し\t引越\n",
  })) {
    assert.throws(() => checkKotoba(parseKotoba("x.tsv", text)), undefined, name);
  }
});

// 辞書の形には asr（音声認識の崩れ）の行もある。その表はここには写さないが、同じ形のファイルを
// 読んでも壊れず、崩れた書き方では探さない。
test("asr の行は読めて、探すのには使わない", () => {
  const text = "alias\t議事録\tぎじろく\nasr\t議事録\t技術録\t記事録\n";
  assert.deepEqual(
    parseKotoba("x.tsv", text).map((line) => line.kind),
    ["alias", "asr"],
  );
  const sample = loadKotoba({ "dict/x.tsv": text });
  assert.deepEqual(sample.expand("議事録"), ["ぎじろく"]);
  assert.deepEqual(sample.expand("技術録"), []);
  assert.deepEqual(sample.find("技術録と議事録"), ["議事録"]);
});

test("問いのほかの書き方: 語は丸ごと、文は中の書き方だけを替える", () => {
  assert.deepEqual(termSpellings("引越し"), ["引っ越し", "引越"]);
  assert.deepEqual(termSpellings("打合せ"), ["打ち合わせ", "打ち合せ"]);
  assert.deepEqual(termSpellings("引越しの段取り"), ["引っ越しの段取り", "引越の段取り"]);
  assert.deepEqual(termSpellings("宇宙"), []);
  assert.deepEqual(searchQueryVariants("  引越し 段取り "), [
    "引越し 段取り",
    "引っ越し 段取り",
    "引越 段取り",
  ]);
  assert.deepEqual(searchQueryVariants(""), []);
  assert.ok(searchQueryVariants(Array(40).fill("引越し").join(" ")).length <= 16, "数を抑える");

  const search = createTextSearch("引越し");
  assert.equal(search.match(["引越しの段取り"]), "direct");
  assert.equal(search.match(["来週の引っ越し"]), "alias");
  assert.equal(search.match(["", null, "無関係"]), null);
  assert.equal(
    search.match(["来週の引っ越し", "引越しの段取り"]),
    "direct",
    "どれかの欄で書いたまま当たれば direct",
  );
  assert.equal(createTextSearch("打合せ").match(["来週の打ち合わせ"]), "alias");
  assert.equal(
    createTextSearch("ＷｉＦｉ").match(["WiFi の設定"]),
    "direct",
    "全角の問いも同じキーで比べる",
  );
  assert.equal(createTextSearch("  "), null);
});

function fakeTask(id, title, updatedAt, extra = {}) {
  return {
    id,
    title,
    state: "todo",
    priority: "normal",
    project_id: null,
    description: "",
    created_at: updatedAt,
    updated_at: updatedAt,
    deleted_at: null,
    ...extra,
  };
}

test("Task の検索: 引越し で 引っ越し の Task も当たり、書いたまま当たった Task が先", async () => {
  const { ItemQueryService } = await importTs("src/main/core/services/itemQueryService.ts");
  const snapshot = {
    items: [],
    // 新しい順では 引っ越し（別名）が先だが、並べるのは書いたまま当たった方が先。
    tasks: [
      fakeTask("t-alias", "新居への引っ越し", "2026-11-14T10:00:00.000Z"),
      fakeTask("t-direct", "引越しの段取り", "2026-11-13T10:00:00.000Z"),
      fakeTask("t-desc", "見積もりを取る", "2026-11-12T10:00:00.000Z", {
        description: "引越業者に連絡",
      }),
      fakeTask("t-other", "献立を決める", "2026-11-11T10:00:00.000Z"),
    ],
    waitings: [],
    planNodes: [],
    schedules: [],
    themes: [],
  };
  const service = new ItemQueryService({ readItemQuerySnapshot: () => snapshot });
  const ids = service.searchItems({ query: "引越し" }).items.map((item) => item.id);
  assert.deepEqual(ids, ["t-direct", "t-alias", "t-desc"]);
  assert.deepEqual(
    service.searchItems({ query: "引っ越し" }).items.map((item) => item.id),
    ["t-alias", "t-direct", "t-desc"],
  );
  const response = service.searchItems({ query: "引越し", limit: 1 });
  assert.equal(response.result_meta.matched_visible_count, 3, "別名で当たった物も数に入る");
  assert.equal(response.result_meta.truncated, true);
  assert.equal(service.searchItems({}).items.length, 4, "問いが無ければ絞り込まない");
});

test("Note の検索: 引越し で 引っ越し の Note も当たり、書いたまま当たった Note が先", async () => {
  const { KnowledgeQueryService } = await importTs(
    "src/main/core/services/knowledgeQueryService.ts",
  );
  const notes = [
    {
      id: "n-alias",
      title: "週末メモ",
      body_markdown: "引っ越しの荷造りを始める",
      updated_at: "2026-11-14T10:00:00.000Z",
    },
    {
      id: "n-direct",
      title: "引越しの手続き",
      body_markdown: "転出届",
      updated_at: "2026-11-13T10:00:00.000Z",
    },
    {
      id: "n-other",
      title: "献立",
      body_markdown: "カレー",
      updated_at: "2026-11-12T10:00:00.000Z",
    },
  ];
  const service = new KnowledgeQueryService({ list: (type) => (type === "note" ? notes : []) });
  const response = service.getRecentNotes({ query: "引越し" });
  assert.deepEqual(
    response.notes.map((note) => note.id),
    ["n-direct", "n-alias"],
  );
  assert.equal(response.result_meta.matched_visible_count, 2);
  assert.deepEqual(
    service.getRecentNotes({}).notes.map((note) => note.id),
    ["n-alias", "n-direct", "n-other"],
    "問いが無ければ新しい順のまま",
  );
});

test("パレット: 引越し で 引っ越し の項目も出し、書いたまま当たった項目を先にする", () => {
  const entries = prepareCommandEntries([
    { id: "a", label: "新居への引っ越し", category: "Tasks" },
    { id: "b", label: "週末の予定", category: "ノート / 文書", searchText: "引越しの荷造り" },
    { id: "c", label: "献立", category: "Tasks" },
  ]);
  assert.deepEqual(
    filterCommandEntries(entries, "引越し").map((entry) => entry.id),
    ["b", "a"],
  );
  // 使った回数の上乗せでも、別名で当たった項目は書いたまま当たった項目を越えない。
  const usage = { a: { count: 1000, lastUsedAt: new Date().toISOString() } };
  assert.deepEqual(
    rankCommandEntries(entries, "引越し", usage).map((entry) => entry.id),
    ["b", "a"],
  );
  assert.equal(rankCommandEntries(entries, "", usage).length, 3);
});
