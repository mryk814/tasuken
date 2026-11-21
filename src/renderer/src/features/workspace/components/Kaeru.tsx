// Tasken の動物（ニホンアマガエル、#776）を画面に置く。いつ何をするかは lib/kaeru.ts、絵は kotoba の
// 写し（lib/generated/kaeruPoses.ts）、見た目と動きは styles/kaeru.css
// （app.css が読む。ここで読むと、この部品を esbuild で束ねる試験が CSS を扱えずに落ちる）。
//
// 入口は 2 つで、どちらもその言葉を持つ画面が置く:
//   <KaeruOnWords />  何も無い画面の黙っている言葉の中（最後の子）に置く。言葉の 1 行目の右端に座る
//   <KaeruWait />     待ちの言葉の枠（kaeru-edge）の中に置く。出ている間が待ちで、外せば一緒に消える
// 本人の設定（設定 > 表示 > アマガエル）は <html data-animal="off"> の 1 つで全部を消すので、
// 置く画面は設定を聞かなくてよい。
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { KAERU_POSES } from "../lib/generated/kaeruPoses";
import {
  animalShown,
  drawingOf,
  firstLine,
  nextStep,
  perchSpot,
  stateAt,
  type KaeruState,
} from "../lib/kaeru";

// 最後に読めた設定。作業台を読む前（起動の待ち）にも本人の選びのままにする。
const REMEMBERED = "tasken.animalShown";

function setShown(shown: boolean) {
  if (shown) delete document.documentElement.dataset.animal;
  else document.documentElement.dataset.animal = "off";
}

/** 本人の設定を当てる。今ある全部のカエルと、後から出る全部に効く。 */
export function applyAnimalShown(value: unknown): void {
  const shown = animalShown(value);
  setShown(shown);
  try {
    localStorage.setItem(REMEMBERED, shown ? "1" : "0");
  } catch {
    // 覚えられなくても、次の起動で作業台を読んだ時に当て直す。
  }
}

// 読み込まれた時（起動の最初）に、最後に読めた設定を当てる。作業台を読む前の待ちのため。
try {
  setShown(localStorage.getItem(REMEMBERED) !== "0");
} catch {
  // 読めなければ既定（出す）のまま。作業台を読んだ時に当て直す。
}

export function isAnimalShown(): boolean {
  return document.documentElement.dataset.animal !== "off";
}

const reducedMotion = () =>
  globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** 4 つの姿を重ねて置き、data-draw の 1 つだけを見せる。中身は kotoba の文字そのまま。 */
function Drawings() {
  return (
    <>
      {Object.entries(KAERU_POSES).map(([pose, svg]) => (
        <span key={pose} data-pose={pose} dangerouslySetInnerHTML={{ __html: svg }} />
      ))}
    </>
  );
}

/**
 * 何も無い画面の黙っている言葉の右端に座る。言葉の要素（position: relative。kaeru-perch）の最後の子に
 * 置く。動かない（何も無い画面は待ちではない）。言葉が折り返しても 1 行目に座り、箱から横へは出ない。
 * 置く所は測ってから見せる（測るまでは隠す）。
 */
export function KaeruOnWords({ words }: { words: string }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const frog = ref.current;
    const p = frog?.parentElement;
    if (!frog || !p) return undefined;
    const place = () => {
      if (!frog.isConnected) return;
      const range = document.createRange();
      range.selectNodeContents(p);
      range.setEndBefore(frog);
      const line = firstLine([...range.getClientRects()]);
      const box = p.getBoundingClientRect();
      if (!line || p.offsetWidth === 0) {
        frog.classList.remove("placed");
        return;
      }
      // 画面の拡大（app-content-viewport の transform）の分を割り戻す。
      const spot = perchSpot(line, box, { scale: box.width / p.offsetWidth });
      frog.style.left = `${spot.left}px`;
      frog.style.top = `${spot.top}px`;
      frog.classList.add("placed");
    };
    place();
    // 幅が変わって言葉が組み直されるたびと、字の形が読めた後に置き直す。
    const watch = new ResizeObserver(place);
    watch.observe(p);
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) place();
    });
    return () => {
      alive = false;
      watch.disconnect();
    };
  }, [words]);
  return (
    <i ref={ref} className="kaeru on-words" aria-hidden="true" data-draw="suwaru">
      <Drawings />
    </i>
  );
}

/**
 * 待ちの言葉の枠の上の縁に止まる。出ている間が待ち: 1.5 秒より短ければ何も見せず、続けば
 * 見る・一度だけ跳ねる・眠る（時刻は lib/kaeru.ts の WAIT_TIMES）。外せば言葉と一緒に消える。
 */
export function KaeruWait() {
  const [state, setState] = useState<KaeruState>("none");
  useEffect(() => {
    const began = performance.now();
    let timer = 0;
    const schedule = (ms: number) => {
      const next = nextStep(ms, { reduced: reducedMotion() });
      if (next) timer = window.setTimeout(tick, Math.max(0, next.at - ms));
    };
    const tick = () => {
      const ms = performance.now() - began;
      setState(stateAt(ms, { reduced: reducedMotion() }));
      schedule(ms);
    };
    schedule(0);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <i
      className="kaeru on-edge"
      aria-hidden="true"
      data-state={state}
      data-draw={drawingOf(state) ?? ""}
    >
      <Drawings />
    </i>
  );
}
