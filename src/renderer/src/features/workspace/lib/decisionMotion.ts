/**
 * 提案を決める型の動き（#774）。採る＝本人の判がカードに降りる、見送る＝カードが右へ流れる、
 * 取り消す＝判が浮いて消える／カードが右から戻る。どれも意味を伝えるための動きで、飾りではない。
 *
 * - 採る: カード 1 枚ずつに判（傾けた角丸四角の輪郭にチェック。色は文字の色。赤は誤りと要確認の
 *   色なので使わない）。1.6 倍・-13° から 200ms で降り、0.92 まで沈んで戻る。カードも 0.96 まで
 *   沈む。複数を一度に採る時は 1 枚ごとに 28ms ずらす（上限 224ms）。降りた後 380ms 止まり、
 *   240ms で薄れ、最後に高さが 200ms で詰まる（残りのカードが跳ねない）。
 * - 見送る: 判なしで右へ 48px・2.5°、240ms で流れ、同じく詰まる。
 * - 動きを減らす設定: 採るは判を 500ms 置くだけ、見送るは動かさない、取り消しも動かさない。
 *
 * どれも終わるまでの約束を返す。呼び出し側はそれを待ってからカードを一覧から外す。途中で取り消された
 * 時は `signal.cancelled` を立てて `resetDecision` で見た目を戻す。
 */

export interface MotionSignal {
  cancelled: boolean;
}

const SEAL_CLASS = "decision-seal";
// React が持つ className を描き直しで上書きしても消えないよう、判を載せたカードは data 属性で示す。
const SEAL_HOST_ATTRIBUTE = "data-decision-seal-host";
const SVG = "http://www.w3.org/2000/svg";
export const SEAL_STAGGER_MS = 28;
export const SEAL_STAGGER_CAP_MS = 224;

export function reducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
}

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const settled = (animation: Animation) =>
  animation.finished.then(
    () => {},
    () => {},
  );

function placeSeal(target: HTMLElement): HTMLElement {
  const seal = document.createElement("span");
  seal.className = SEAL_CLASS;
  seal.setAttribute("aria-hidden", "true");
  // 文字の ✓ は書体で形が変わる（根号に見える）ので、線で描く。
  const check = document.createElementNS(SVG, "svg");
  check.setAttribute("viewBox", "0 0 24 24");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", "M5 12.5l4.5 4.5L19 7.5");
  check.append(path);
  seal.append(check);
  target.setAttribute(SEAL_HOST_ATTRIBUTE, "");
  target.append(seal);
  return seal;
}

function collapse(card: HTMLElement): Promise<void> {
  if (reducedMotion() || !card.animate) return Promise.resolve();
  const style = getComputedStyle(card);
  const from = {
    height: `${card.offsetHeight}px`,
    paddingTop: style.paddingTop,
    paddingBottom: style.paddingBottom,
    marginTop: style.marginTop,
    marginBottom: style.marginBottom,
    opacity: 0,
  };
  const to = {
    height: "0px",
    paddingTop: "0px",
    paddingBottom: "0px",
    marginTop: "0px",
    marginBottom: "0px",
    opacity: 0,
  };
  card.style.overflow = "hidden";
  return settled(
    card.animate([from, to], { duration: 200, easing: "ease-in-out", fill: "forwards" }),
  );
}

/** 戻ったカードの高さを 0 から開く（詰まりの逆）。 */
function expand(card: HTMLElement): Promise<void> {
  if (reducedMotion() || !card.animate) return Promise.resolve();
  const style = getComputedStyle(card);
  const to = {
    height: `${card.offsetHeight}px`,
    paddingTop: style.paddingTop,
    paddingBottom: style.paddingBottom,
    marginTop: style.marginTop,
    marginBottom: style.marginBottom,
  };
  const from = {
    height: "0px",
    paddingTop: "0px",
    paddingBottom: "0px",
    marginTop: "0px",
    marginBottom: "0px",
  };
  const previous = card.style.overflow;
  card.style.overflow = "hidden";
  return settled(card.animate([from, to], { duration: 200, easing: "ease-in-out" })).then(() => {
    card.style.overflow = previous;
  });
}

/**
 * 採る。`targets`（採ったカード）それぞれに判を押し、`host`（一覧から外れる 1 件）を薄れさせて
 * 詰める。targets が空なら host に押す。
 */
export function decideAdopt(
  host: HTMLElement | null,
  targets: HTMLElement[],
  signal: MotionSignal,
): Promise<void> {
  if (!host?.isConnected) return Promise.resolve();
  const cards = targets.length ? targets : [host];
  const seals = cards.map(placeSeal);
  if (reducedMotion() || !host.animate) return wait(500);
  const downs = cards.map((card, index) => {
    const delay = Math.min(index * SEAL_STAGGER_MS, SEAL_STAGGER_CAP_MS);
    card.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(.96)", offset: 0.7 },
        { transform: "scale(1)" },
      ],
      { duration: 200, delay, easing: "ease-out" },
    );
    return settled(
      seals[index].animate(
        [
          {
            transform: "rotate(-13deg) scale(1.6)",
            opacity: 0,
            easing: "cubic-bezier(.5,0,.9,.4)",
          },
          { transform: "rotate(-13deg) scale(.92)", opacity: 1, offset: 0.7, easing: "ease-out" },
          { transform: "rotate(-13deg) scale(1)", opacity: 1 },
        ],
        { duration: 200, delay, easing: "ease-out", fill: "both" },
      ),
    );
  });
  return Promise.all(downs)
    .then(() => wait(380))
    .then(() => {
      if (signal.cancelled) return;
      for (const seal of seals) seal.style.opacity = "0.6";
      return settled(
        host.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: 240,
          easing: "ease-in",
          fill: "forwards",
        }),
      );
    })
    .then(() => (signal.cancelled ? undefined : collapse(host)));
}

/** 見送る。判なしで右へ流れて詰まる。 */
export function decideDismiss(host: HTMLElement | null, signal: MotionSignal): Promise<void> {
  if (!host?.isConnected || reducedMotion() || !host.animate) return Promise.resolve();
  return settled(
    host.animate(
      [
        { transform: "none", opacity: 1 },
        { transform: "translateX(48px) rotate(2.5deg)", opacity: 0 },
      ],
      { duration: 240, easing: "ease-in", fill: "forwards" },
    ),
  ).then(() => (signal.cancelled ? undefined : collapse(host)));
}

/** 途中で止めた決定の見た目を、押す前に戻す（判を外し、動きを捨てる）。 */
export function resetDecision(host: HTMLElement | null): void {
  if (!host) return;
  host.getAnimations?.({ subtree: true }).forEach((animation) => animation.cancel());
  host.querySelectorAll(`.${SEAL_CLASS}`).forEach((seal) => seal.remove());
  host.removeAttribute(SEAL_HOST_ATTRIBUTE);
  host
    .querySelectorAll(`[${SEAL_HOST_ATTRIBUTE}]`)
    .forEach((card) => card.removeAttribute(SEAL_HOST_ATTRIBUTE));
  host.style.overflow = "";
}

/** 採るを取り消した: カードが戻り、押してあった判が浮いて消える。 */
export function returnAdopted(host: HTMLElement | null, targets: HTMLElement[]): Promise<void> {
  if (!host?.isConnected || reducedMotion() || !host.animate) return Promise.resolve();
  const cards = targets.length ? targets : [host];
  // 判を押したままの姿で戻り、開き切ってから判だけが浮いて消える。
  const seals = cards.map(placeSeal);
  return expand(host).then(() => {
    const lifts = seals.map((seal) =>
      settled(
        seal.animate(
          [
            { transform: "rotate(-13deg) scale(1)", opacity: 1 },
            { transform: "translateY(-14px) rotate(-13deg) scale(1.25)", opacity: 0 },
          ],
          { duration: 240, easing: "ease-in", fill: "forwards" },
        ),
      ),
    );
    return Promise.all(lifts).then(() => {
      for (const seal of seals) seal.remove();
      for (const card of cards) card.removeAttribute(SEAL_HOST_ATTRIBUTE);
    });
  });
}

/** 見送るを取り消した: カードが右から戻る。 */
export function returnDismissed(host: HTMLElement | null): Promise<void> {
  if (!host?.isConnected || reducedMotion() || !host.animate) return Promise.resolve();
  return expand(host).then(() =>
    settled(
      host.animate(
        [
          { transform: "translateX(48px) rotate(2.5deg)", opacity: 0 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 240, easing: "ease-out" },
      ),
    ),
  );
}
