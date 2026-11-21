// Tasken の動物（ニホンアマガエル、#776）の 4 つの姿を、kotoba の元絵から写す。
//
// 姿は kotoba（ishou/animals/tasuken/kaeru-*.svg）で一度だけ描く。ここでは描かず直さない。
// 絵を変える時は kotoba で直して commit し、この script で写し直す。動物は kotoba-copy の
// 組に入っていない（アプリの名前を含むので、公開のリポジトリにも入る組には入れない、という
// kotoba 側の決定）ので、各アプリが自分の動物だけを写す。
//
//   npm run animal:copy [-- <kotoba>]     既定の kotoba は、このリポジトリの本体の隣（../kotoba）
//
// 写すのは kotoba の HEAD の中身（git show。作業ツリーではない）なので、横に書く commit が
// まさにこの絵を指す。写しは 1 つの module で、ファイルの文字そのままと各ファイルの sha256 を
// 持つ。カエルの色は置く側の color（currentColor）で決まるので、img や CSS のマスクではなく
// 画面の中に SVG として入れる。tests/kaeru.test.mjs が文字と sha256 を照らすので、ここで
// 手で直した絵は試験で落ちる。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// worktree の中からでも、本体の checkout の隣を既定にする。
const mainCheckout = dirname(
  execFileSync("git", ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
  }).trim(),
);
const kotoba = resolve(process.argv[2] ?? join(mainCheckout, "../kotoba"));
const out = join(root, "src/renderer/src/features/workspace/lib/generated/kaeruPoses.ts");
const SOURCE = "ishou/animals/tasuken";
// 動く姿の名前はアプリごとに違う。カエルは跳ねる（haneru）。
const POSES = ["suwaru", "miru", "haneru", "nemuru"];

const git = (...args) => execFileSync("git", ["-C", kotoba, ...args], { encoding: "utf8" });

const commit = git("rev-parse", "HEAD").trim();
const rows = POSES.map((pose) => {
  const svg = git("show", `HEAD:${SOURCE}/kaeru-${pose}.svg`);
  if (!svg.includes("<svg") || svg.includes("\r"))
    throw new Error(`kaeru-${pose}.svg: SVG ではないか、CR を含みます`);
  return { pose, svg, sha256: createHash("sha256").update(svg).digest("hex") };
});

const lines = [
  "// 生成物。kotoba の動物の姿（Tasken のアマガエル、#776）の写し。ここで直さず、kotoba の",
  `// ${SOURCE}/ で直してから npm run animal:copy で写し直す。`,
  "// 手で直すと tests/kaeru.test.mjs が落ちる（sha256 は kotoba のファイルの中身のもの）。",
  "",
  `export const KAERU_SOURCE = ${JSON.stringify(SOURCE)};`,
  `export const KAERU_COMMIT = ${JSON.stringify(commit)};`,
  "",
  "/** ファイルの全文（先頭の注記と svg）。kotoba にあるまま。 */",
  "export const KAERU_POSES = {",
  ...rows.map(({ pose, svg }) => `  ${pose}: ${JSON.stringify(svg)},`),
  "} as const;",
  "",
  "export const KAERU_SHA256: Readonly<Record<keyof typeof KAERU_POSES, string>> = {",
  ...rows.map(({ pose, sha256 }) => `  ${pose}: ${JSON.stringify(sha256)},`),
  "};",
  "",
];
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join("\n"));
for (const { pose, sha256 } of rows) console.log(`${pose}\t${sha256}`);
console.log(`kotoba ${commit} -> ${out.slice(root.length + 1).replaceAll("\\", "/")}`);
