// Tasken の動物（ニホンアマガエル、#776）: 待ちのどの時点で何をするか、言葉の上のどこに立つか、
// 設定で切れること、絵が kotoba の写しのままであること。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { describe, test } from "node:test";
import { build } from "esbuild";

async function load(entry) {
  const bundled = await build({
    entryPoints: [path.resolve(entry)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
  );
}

const {
  animalShown,
  drawingOf,
  firstLine,
  KAERU_SIZE,
  nextStep,
  perchSpot,
  stateAt,
  WAIT_TIMES,
  waitTimeline,
} = await load("src/renderer/src/features/workspace/lib/kaeru.ts");
const { KAERU_COMMIT, KAERU_POSES, KAERU_SHA256 } = await load(
  "src/renderer/src/features/workspace/lib/generated/kaeruPoses.ts",
);

describe("アマガエルの絵", () => {
  test("kotoba の 4 つの姿を、写したまま持つ（ここでは直さない）", () => {
    assert.deepEqual(Object.keys(KAERU_POSES).sort(), ["haneru", "miru", "nemuru", "suwaru"]);
    for (const [pose, svg] of Object.entries(KAERU_POSES)) {
      assert.equal(
        createHash("sha256").update(svg).digest("hex"),
        KAERU_SHA256[pose],
        `${pose}: kotoba で直して npm run animal:copy で写し直す`,
      );
    }
    assert.match(KAERU_COMMIT, /^[0-9a-f]{40}$/);
  });

  test("色は置く所から取る: 自分の色を持たず、画面へ入れて害のあるものも無い", () => {
    for (const [pose, svg] of Object.entries(KAERU_POSES)) {
      assert.ok(svg.includes("currentColor"), pose);
      assert.deepEqual(svg.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], [], pose);
      assert.ok(!/<script|\son\w+=|href=|<foreignObject/i.test(svg), pose);
      assert.match(svg, /viewBox="0 0 100 100"/, pose);
    }
  });
});

describe("待ちの間のアマガエル", () => {
  test("1.5 秒より短い待ちには出ない", () => {
    for (const ms of [0, 400, 1499]) {
      assert.equal(stateAt(ms), "none");
      assert.equal(stateAt(ms, { reduced: true }), "none");
      assert.equal(drawingOf(stateAt(ms)), null);
    }
    assert.equal(WAIT_TIMES.appearAt, 1500);
  });

  test("1.5 秒で降りて座り、8 秒ごとに見て、12 秒で一度だけ跳ねて戻り、40 秒から眠る", () => {
    assert.equal(stateAt(1500), "kuru");
    assert.equal(drawingOf("kuru"), "suwaru");
    assert.equal(stateAt(1740), "suwaru");
    assert.equal(stateAt(7999), "suwaru");
    for (const at of [8000, 16000, 24000, 32000]) {
      assert.equal(stateAt(at), "miru", String(at));
      assert.equal(stateAt(at + 599), "miru");
      assert.equal(stateAt(at + 600), "suwaru");
    }
    assert.equal(stateAt(12000), "haneru");
    assert.equal(drawingOf("haneru"), "haneru");
    assert.equal(stateAt(12559), "haneru");
    assert.equal(stateAt(12560), "suwaru");
    assert.equal(stateAt(39999), "suwaru");
    assert.equal(stateAt(40000), "nemuru");
    assert.equal(stateAt(10 * 60_000), "nemuru");
  });

  test("跳ねるのと眠るのは一度ずつ、時刻の順に", () => {
    const steps = waitTimeline();
    const times = steps.map((s) => s.at);
    assert.deepEqual(
      times,
      [...times].sort((a, b) => a - b),
    );
    assert.equal(steps.filter((s) => s.state === "haneru").length, 1);
    assert.equal(steps.filter((s) => s.state === "nemuru").length, 1);
    assert.equal(steps.at(-1)?.state, "nemuru");
  });

  test("時計は次の変わり目に合わせ、眠った後は合わせない", () => {
    assert.deepEqual(nextStep(0), { at: 1500, state: "kuru" });
    assert.deepEqual(nextStep(1500), { at: 1740, state: "suwaru" });
    assert.deepEqual(nextStep(9000), { at: 12000, state: "haneru" });
    assert.deepEqual(nextStep(39000), { at: 40000, state: "nemuru" });
    assert.equal(nextStep(40000), null);
  });

  test("動きを減らす設定では座るだけ（降りる・見る・跳ねる・眠るは無い）", () => {
    const o = { reduced: true };
    assert.deepEqual(waitTimeline(o), [
      { at: 0, state: "none" },
      { at: 1500, state: "suwaru" },
    ]);
    for (const ms of [1500, 8000, 12100, 13000, 40000, 600_000]) {
      assert.equal(stateAt(ms, o), "suwaru", String(ms));
    }
    assert.equal(nextStep(1500, o), null);
  });
});

describe("言葉の上のアマガエル", () => {
  test("1 行目の右端に立ち、足は行の少し内側", () => {
    const spot = perchSpot({ left: 120, top: 200, right: 292 }, { left: 10, top: 200, width: 392 });
    assert.deepEqual(spot, {
      left: Math.round(292 - 32 * 0.6 - 10),
      top: Math.round(1 - 32 * 0.86),
    });
  });

  test("言葉の箱から横へは出ない（スマホの幅いっぱいの言葉）", () => {
    const box = { left: 10, top: 100, width: 392 };
    assert.equal(perchSpot({ left: 10, top: 100, right: 402 }, box).left, 392 - KAERU_SIZE);
    assert.equal(perchSpot({ left: 10, top: 100, right: 12 }, box).left, 0);
  });

  test("画面を拡大している時は、測った px を割り戻して同じ所に立つ", () => {
    const plain = perchSpot(
      { left: 120, top: 200, right: 292 },
      { left: 10, top: 200, width: 392 },
    );
    const zoomed = perchSpot(
      { left: 240, top: 400, right: 584 },
      { left: 20, top: 400, width: 784 },
      { scale: 2 },
    );
    assert.deepEqual(zoomed, plain);
    assert.equal(
      perchSpot({ left: 20, top: 0, right: 804 }, { left: 20, top: 0, width: 784 }, { scale: 2 })
        .left,
      392 - KAERU_SIZE,
    );
  });

  test("折り返した言葉の 1 行目: いちばん上の行の矩形だけ", () => {
    assert.deepEqual(
      firstLine([
        { left: 30, top: 100, right: 380, bottom: 120 },
        { left: 150, top: 121, right: 260, bottom: 141 },
      ]),
      { left: 30, top: 100, right: 380 },
    );
    assert.deepEqual(
      firstLine([
        { left: 30, top: 100, right: 200, bottom: 120 },
        { left: 200, top: 102, right: 380, bottom: 118 },
        { left: 100, top: 121, right: 300, bottom: 141 },
      ]),
      { left: 30, top: 100, right: 380 },
    );
    assert.equal(firstLine([]), null);
    assert.equal(firstLine([{ left: 5, top: 5, right: 5, bottom: 5 }]), null);
  });
});

describe("アマガエルを切る設定", () => {
  test("切（false）の時だけ出さない。読めていない値は既定の「出す」", () => {
    assert.equal(animalShown(true), true);
    assert.equal(animalShown(false), false);
    assert.equal(animalShown(undefined), true);
    assert.equal(animalShown(null), true);
    assert.equal(animalShown("false"), true);
  });
});
