// 共通の辞書の写し（src/shared/searchdict/kotoba）から、src/shared/searchdict/kotobaFiles.generated.ts を作る。
// 写しが元で、その MANIFEST に辞書の commit が書いてある。
// 写しは一般の表記ゆれ（dict/alias.tsv）だけの組。生成した module は、辞書を Desktop の main・
// renderer・NAS の headless core のどれにも同じように運ぶ（どれも src/ の module だけを束ねる）。
// Android は写しの dict/*.tsv を build の時に直接読むので、この module は使わない。
//
//   node scripts/generate-search-dictionary.mjs           作る
//   node scripts/generate-search-dictionary.mjs --check   古ければ落ちる
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const KOTOBA_COPY = join(root, "src/shared/searchdict/kotoba");
export const KOTOBA_GENERATED = join(root, "src/shared/searchdict/kotobaFiles.generated.ts");

/** MANIFEST を読み、載っているファイルがどれも載っている sha256 と同じでなければ落ちる。 */
export function readKotobaCopy(copy = KOTOBA_COPY) {
  const manifest = readFileSync(join(copy, "MANIFEST"), "utf8");
  let commit = null;
  let set = null;
  const files = {};
  for (const row of manifest.replaceAll("\r", "").split("\n")) {
    const fields = row.split("\t");
    if (fields[0] === "commit" && fields.length === 2) commit = fields[1];
    if (fields[0] === "set" && fields.length === 2) set = fields[1];
    if (fields[0] !== "file" || fields.length !== 3) continue;
    const bytes = readFileSync(join(copy, fields[1]));
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== fields[2]) {
      throw new Error(
        `${fields[1]} が MANIFEST と合いません。写しは手で直さず、辞書の元のリポジトリで直してから写し直します`,
      );
    }
    files[fields[1]] = bytes.toString("utf8");
  }
  // 公開のこのリポジトリに置くのは、一般の表記ゆれだけの組。ほかの組（音声認識の崩れや、辞書を読む側の
  // コードが入る）を写してしまったら、ここで止める。
  if (set !== "alias")
    throw new Error(`写しが一般の表記ゆれの組（alias）ではありません（${set ?? "組の行が無い"}）`);
  if (!commit || !/^[0-9a-f]{40}$/.test(commit))
    throw new Error("MANIFEST に辞書の commit がありません");
  if (Object.keys(files).length === 0) throw new Error("MANIFEST にファイルがありません");
  return { commit, files };
}

export function renderKotobaModule({ commit, files }) {
  const dictionary = Object.keys(files)
    .filter((name) => /^dict\/[^/]+\.tsv$/.test(name))
    .sort();
  const entries = dictionary.map(
    (name) => `  ${JSON.stringify(name)}: ${JSON.stringify(files[name])},`,
  );
  return [
    "// 生成物。src/shared/searchdict/kotoba の写しから scripts/generate-search-dictionary.mjs が作る。手で直さない。",
    `export const KOTOBA_COMMIT = ${JSON.stringify(commit)};`,
    "",
    "export const KOTOBA_FILES: Readonly<Record<string, string>> = {",
    ...entries,
    "};",
    "",
  ].join("\n");
}

// 両側を realpath にする。経路に junction があっても、直に起動したかの判定を外さない。
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const expected = renderKotobaModule(readKotobaCopy());
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(KOTOBA_GENERATED, "utf8");
    } catch {
      // 無いのも古いとみなす。
    }
    if (current !== expected) {
      console.error(
        "kotobaFiles.generated.ts が写しと合いません。npm run search-dictionary:generate で作り直します",
      );
      process.exit(1);
    }
    console.log("kotobaFiles.generated.ts は写しと同じです");
  } else {
    writeFileSync(KOTOBA_GENERATED, expected);
    console.log(`${KOTOBA_GENERATED} を作りました`);
  }
}
