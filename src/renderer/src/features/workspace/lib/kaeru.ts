// Tasken の動物（ニホンアマガエル、#776）の、DOM を持たない決まり。components/Kaeru.tsx が画面に
// つなぎ、tests/kaeru.test.mjs が node で動かす。
//
// カエルが出るのは 2 種類の所だけで、どちらも呼ぶのはその言葉を持つ画面（カエルが自分で場所を
// 探すことはしない）:
//  - 何も無い画面: もうある黙っている言葉の右端に、じっと座る（言葉が無い所にはいない）。
//  - 本人が縮められない待ち: 待ちの言葉の枠の上の縁に止まり、待ちが続くと、見る・一度だけ
//    跳ねて戻る・眠る。
// 繰り返す操作（絞り込み・検索・保存）の後には出ない。色は控えめな文字の一色で、アマガエルの
// 緑（印の色）は使わない。世話を求めず、催促せず、主役にしない。
//
// 絵の形には頼らない（kotoba の絵が描き直されても、写し直すだけで替わるように）。頼るのは
// 格子 100×100 と止まる線 y=86 だけ。

/** 描く大きさと、絵の中の足の位置（kotoba: 止まる線は 100 の y=86）。 */
export const KAERU_SIZE = 32;
export const PERCH_LINE = 0.86;

/**
 * 待ちの時刻。待ちの言葉が出てからの ms。正本はここで、styles/kaeru.css の動きの長さもこれに合わせる。
 * 1 匹目（irodori のカワセミ）でできた型のまま。動く姿だけがカエルの「跳ねる」になる。
 */
export const WAIT_TIMES = {
  /** これより短い待ちには出ない。 */
  appearAt: 1500,
  /** 縁に降りて座る（CSS: kaeru-land）。 */
  appearFor: 240,
  /** この間隔で、この長さだけ見る。 */
  lookEvery: 8000,
  lookFor: 600,
  /** 一度だけ: その場で跳ねて、同じ縁に戻る（CSS: kaeru-hop）。 */
  hopAt: 12000,
  hopFor: 560,
  /** ここから待ちが終わるまで眠る。 */
  sleepAt: 40000,
} as const;

/** kotoba の 4 つの姿。動く姿は跳ねる（haneru）。 */
export type KaeruPose = "suwaru" | "miru" | "haneru" | "nemuru";

/**
 * カエルがしていること: `none`（まだいない）、`kuru`（降りてくる。座る絵）と 4 つの姿。
 */
export type KaeruState = "none" | "kuru" | KaeruPose;

export interface KaeruStep {
  at: number;
  state: KaeruState;
}

/**
 * 待ちの全体: 変わる時刻と変わった先を、時刻の順に。動きを減らす設定では座るだけ（それでも
 * `appearAt` は待つので、短い待ちにはどちらでも何も出ない）。
 */
export function waitTimeline({ reduced = false }: { reduced?: boolean } = {}): KaeruStep[] {
  const t = WAIT_TIMES;
  const steps: KaeruStep[] = [{ at: 0, state: "none" }];
  if (reduced) return [...steps, { at: t.appearAt, state: "suwaru" }];
  steps.push({ at: t.appearAt, state: "kuru" }, { at: t.appearAt + t.appearFor, state: "suwaru" });
  const hopEnd = t.hopAt + t.hopFor;
  for (let at = t.lookEvery; at + t.lookFor <= t.sleepAt; at += t.lookEvery) {
    // 見るのは、跳ねる間と降りてくる間には割り込まない。
    if (at + t.lookFor > t.hopAt && at < hopEnd) continue;
    if (at < t.appearAt + t.appearFor) continue;
    steps.push({ at, state: "miru" }, { at: at + t.lookFor, state: "suwaru" });
  }
  steps.push(
    { at: t.hopAt, state: "haneru" },
    { at: hopEnd, state: "suwaru" },
    { at: t.sleepAt, state: "nemuru" },
  );
  return steps.sort((a, b) => a.at - b.at);
}

/** 待ちの `ms` の時点でカエルがしていること。 */
export function stateAt(ms: number, o?: { reduced?: boolean }): KaeruState {
  let state: KaeruState = "none";
  for (const step of waitTimeline(o)) {
    if (step.at > ms) break;
    state = step.state;
  }
  return state;
}

/** `ms` の後の次の変わり目（時計を合わせる先）。眠った後は待ちが終わるまで変わらないので null。 */
export function nextStep(ms: number, o?: { reduced?: boolean }): KaeruStep | null {
  return waitTimeline(o).find((step) => step.at > ms) ?? null;
}

/** その状態で見せる絵（`none` は何も見せない）。 */
export function drawingOf(state: KaeruState): KaeruPose | null {
  if (state === "none") return null;
  if (state === "kuru") return "suwaru";
  return state;
}

/** 本人の設定（設定 > 表示 > アマガエル）。読めていない・知らない値は既定の「出す」。 */
export function animalShown(value: unknown): boolean {
  return value !== false;
}

/**
 * 言葉の上のどこに立つか: 1 行目の右端の、最後の字を少し越えた所。答えは言葉の箱からの
 * 相対の CSS px で、箱から横へは出ない（スマホの幅いっぱいの言葉でも、ページを横に広げない）。
 * `scale` は画面の拡大（app-content-viewport の transform）で、測った値は拡大後の px なので割り戻す。
 */
export function perchSpot(
  words: { left: number; top: number; right: number },
  box: { left: number; top: number; width: number },
  { size = KAERU_SIZE, scale = 1 }: { size?: number; scale?: number } = {},
): { left: number; top: number } {
  const s = scale > 0 ? scale : 1;
  // カエルの 0.6 は最後の字の上、残りは字の先。足は行の上端から 1px 下（行の箱は字の頭より上から
  // 始まる）。鳥の細い脚と違い、カエルはひざが足の高さまで横に張るので、字の頭にかからない高さにした。
  const left = (words.right - box.left) / s - size * 0.6;
  const top = (words.top - box.top) / s + 1 - size * PERCH_LINE;
  return {
    left: Math.round(Math.max(0, Math.min(left, box.width / s - size))),
    top: Math.round(top),
  };
}

/**
 * 文字の範囲の矩形（Range.getClientRects は行の箱と文字の節ごとに 1 つ）のうち、いちばん上の行。
 */
export function firstLine(
  rects: ReadonlyArray<{ left: number; top: number; right: number; bottom: number }>,
): { left: number; top: number; right: number } | null {
  const real = rects.filter((r) => r.right > r.left && r.bottom > r.top);
  if (real.length === 0) return null;
  const top = Math.min(...real.map((r) => r.top));
  const bottom = Math.min(...real.filter((r) => r.top === top).map((r) => r.bottom));
  // 同じ行: いちばん上の矩形の真ん中より上から始まるもの。
  const line = real.filter((r) => r.top < (top + bottom) / 2);
  return {
    left: Math.min(...line.map((r) => r.left)),
    top,
    right: Math.max(...line.map((r) => r.right)),
  };
}
