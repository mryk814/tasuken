import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

async function importBundled(relativePath) {
  const outDir = mkdtempSync(path.join(tmpdir(), "tasken-pen-strike-"));
  const outfile = path.join(outDir, "bundle.mjs");
  await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
}

const { mergeLingeringRows, penStrikeShape } = await importBundled(
  "src/renderer/src/features/task/model/penStrike.ts",
);

/** 輪郭の点（x, y）を path から拾う。円弧の半径とフラグは除く。 */
function outlinePoints(pathData) {
  const body = pathData.replace(/A[^Z]*Z$/, "");
  const numbers = body.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const points = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    points.push({ x: numbers[index], y: numbers[index + 1] });
  }
  return points;
}

/** x の近くでの線の太さ（上の縁と下の縁の差）。 */
function thicknessAt(points, x) {
  const near = points.filter((point) => Math.abs(point.x - x) <= 2.5);
  assert.ok(near.length >= 2, `x=${x} の近くに輪郭の点がある`);
  return Math.max(...near.map((point) => point.y)) - Math.min(...near.map((point) => point.y));
}

const box = { width: 240, height: 22, fontSize: 14 };

test("線の形は Task の ID で決まり、同じ ID なら同じ形になる", () => {
  const first = penStrikeShape({ seed: "task-a", ...box });
  const again = penStrikeShape({ seed: "task-a", ...box });
  const other = penStrikeShape({ seed: "task-b", ...box });
  assert.equal(first.path, again.path);
  assert.notEqual(first.path, other.path);
  assert.doesNotMatch(first.path, /NaN|Infinity/);
});

test("入りにインクが溜まり、途中は細く、抜きで先が尖る", () => {
  for (const seed of ["task-a", "task-b", "0f3c2a8e-7b1d-4e55-9a41-1c2d3e4f5a6b"]) {
    const points = outlinePoints(penStrikeShape({ seed, ...box }).path);
    const entry = thicknessAt(points, 2);
    const middle = thicknessAt(points, 120);
    const exit = thicknessAt(points, Math.max(...points.map((point) => point.x)) - 2);
    assert.ok(entry > middle * 1.2, `${seed}: 入り ${entry} は途中 ${middle} より太い`);
    assert.ok(exit < middle * 0.6, `${seed}: 抜き ${exit} は途中 ${middle} より細い`);
    assert.ok(middle > 1 && middle < 2.6, `${seed}: 途中の太さ ${middle} は文字を潰さない`);
  }
});

test("線は題名の幅に合わせ、文字の高さの中ほどを通り、まっすぐすぎない", () => {
  for (const width of [48, 240, 620]) {
    const shape = penStrikeShape({ seed: "task-a", ...box, width });
    const points = outlinePoints(shape.path);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    assert.ok(Math.min(...xs) >= 0, "左は題名の箱からはみ出さない");
    assert.ok(Math.max(...xs) > width && Math.max(...xs) < width + 8, "右は少しだけ引き抜く");
    assert.ok(Math.min(...ys) > 4 && Math.max(...ys) < 18, "文字の高さの中ほどに収まる");
    // 引く時間は 250〜400ms（--duration-base 180ms × pace）に収める。
    assert.ok(shape.pace * 180 >= 250 && shape.pace * 180 <= 400, `pace ${shape.pace}`);
  }
  const points = outlinePoints(penStrikeShape({ seed: "task-a", ...box }).path);
  const upper = points.slice(0, points.length / 2).filter((point) => point.x > 20 && point.x < 200);
  const ys = upper.map((point) => point.y);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 0.3, "手で引いた線の傾きと揺れがある");
});

const idOf = (row) => row.id;
const same = (row) => row;

test("完了にした行は、一覧から外れても元の位置に残る", () => {
  const previous = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const rows = [{ id: "a" }, { id: "c" }, { id: "d" }];
  const merged = mergeLingeringRows(rows, previous, idOf, new Set(["b"]), same);
  assert.deepEqual(merged.map(idOf), ["a", "b", "c", "d"]);
  assert.equal(rows.length, 3, "元の一覧は変えない");
});

test("続けて完了にした行も、先頭の行も、並びを保って残る", () => {
  const previous = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const merged = mergeLingeringRows([{ id: "d" }], previous, idOf, new Set(["a", "b", "c"]), same);
  assert.deepEqual(merged.map(idOf), ["a", "b", "c", "d"]);
  const reordered = mergeLingeringRows(
    [{ id: "d" }, { id: "a" }],
    previous,
    idOf,
    new Set(["b"]),
    same,
  );
  assert.deepEqual(reordered.map(idOf), ["d", "a", "b"]);
});

test("残す行は今のデータに写し直し、無くなった Task と線を引いていない行は残さない", () => {
  const previous = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const rows = [{ id: "a" }];
  const merged = mergeLingeringRows(rows, previous, idOf, new Set(["b", "c"]), (row) =>
    row.id === "b" ? { id: "b", state: "done" } : null,
  );
  assert.deepEqual(merged, [{ id: "a" }, { id: "b", state: "done" }]);
  assert.equal(mergeLingeringRows(rows, previous, idOf, new Set(), same), rows);
  assert.equal(mergeLingeringRows(rows, previous, idOf, new Set(["a"]), same), rows);
});

/*
 * 残している行（線を引き終わるまで一覧に残す行）の丸は押せない。
 * 繰り返しの Task は完了で次の回ができるので、ここで未完了へ戻せると同じ繰り返しの未完了が二件になる。
 * 画面を起こさずに確かめるため、丸の disabled に striking が入っていることをソースで見る。
 */
test("残している行の丸は押せない（繰り返しの Task を二重に作らない）", async () => {
  const { readFileSync } = await import("node:fs");
  const pages = "src/renderer/src/features/workspace/pages";
  const disabledByStriking = (file) =>
    readFileSync(`${pages}/${file}`, "utf8").match(
      // 作業ツリーは CRLF のこともある（core.autocrlf）ので、改行は \r?\n で見る。
      /\r?\n\s+disabled=\{[^}\r\n]*\bstriking\}\r?\n\s+aria-disabled=\{[^}\r\n]*\bstriking\}/g,
    ) || [];
  // ToDo の行、Today の「今日やること」「期間内に対応」「継続中」、Theme の未完了。
  assert.equal(disabledByStriking("TodoPage.tsx").length, 1);
  assert.equal(disabledByStriking("TodayPage.tsx").length, 3);
  assert.equal(disabledByStriking("ThemePage.tsx").length, 1);
});
