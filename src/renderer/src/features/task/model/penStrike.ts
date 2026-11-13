/*
 * 完了の線（#738）。題名に万年筆で引いた取り消し線の形を作る。
 *
 * 線は stroke ではなく、輪郭を塗った形で持つ。万年筆の線は太さが一定でないため：
 * 入り（ペン先を置いた所）にインクが溜まり、走り出すと細くなり、抜きで先が尖る。
 * 手で引いた線なので、わずかに傾き、たわみ、揺れる。形は Task の ID から決まり、
 * 同じ Task なら何度描いても同じになる（幅が変わっても傾きや揺れの性格は変わらない）。
 */

export interface PenStrikeInput {
  /** 形を決める種。Task の ID。 */
  seed: string;
  /** 題名の見えている幅（px）。 */
  width: number;
  /** 題名の行の高さ（px）。 */
  height: number;
  /** 題名の文字の大きさ（px）。線の太さと揺れの幅はこれに比例させる。 */
  fontSize: number;
}

export interface PenStrikeShape {
  /** 塗りの輪郭（SVG path の d）。座標は題名の箱の左上が原点の px。 */
  path: string;
  /** 引く時間の倍率（`--duration-base` に掛ける）。長い線ほど少し長くかかる。 */
  pace: number;
  /** 入りのインク溜まりが収まる幅（px）。ペン先を置く間に見せる範囲。 */
  pool: number;
}

/** 文字列から 32bit の種を作る（FNV-1a）。 */
export function penStrikeSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 種から決まる乱数（mulberry32）。0 以上 1 未満。 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fixed(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

/**
 * 中心線に沿って測る位置（始点からの px）。入りと抜きは形が速く変わるので細かく、
 * 途中は粗く取る（長い題名で path が大きくなりすぎないように）。
 */
function sampleDistances(length: number, fontSize: number, taper: number): number[] {
  const head = Math.min(length * 0.4, fontSize * 1.2);
  const tailStart = Math.max(head, length - taper);
  const distances: number[] = [];
  for (let d = 0; d < head; d += 0.6) distances.push(d);
  for (let d = head; d < tailStart; d += 4) distances.push(d);
  for (let d = tailStart; d < length; d += 1.2) distances.push(d);
  distances.push(length);
  return distances;
}

export function penStrikeShape({ seed, width, height, fontSize }: PenStrikeInput): PenStrikeShape {
  const random = seededRandom(penStrikeSeed(seed));
  const between = (min: number, max: number) => min + (max - min) * random();

  // 太さ。14px の文字で約 1.7px。入りの溜まりは、その 1.5 倍ほどまで太る。
  const base = clamp(fontSize * 0.062, 0.6, 1.4);
  const poolRadius = base * between(1.4, 1.65);
  const poolSpread = fontSize * between(0.2, 0.3);

  // 線は題名の少し先まで引き抜く。左は題名の箱で切られるので、溜まりが収まる所から始める。
  const startX = poolRadius + 0.5;
  const endX = Math.max(startX + fontSize, width + fontSize * between(0.15, 0.35));
  const length = endX - startX;

  // 文字の高さの中ほど。和文の字面の中心と欧文の x-height の中心の間を通す。
  const middle = height * 0.5 + fontSize * between(-0.05, 0.01);
  // 右利きの速い線は、右へわずかに上がることが多い。
  const rise =
    (random() < 0.8 ? -1 : 1) * Math.min(length * between(0.006, 0.018), fontSize * 0.16);
  const bow = between(-0.35, 0.65) * fontSize * 0.07 * Math.min(1, length / 120);
  const sway = {
    amp: fontSize * between(0.012, 0.028),
    wave: between(55, 110),
    phase: between(0, Math.PI * 2),
  };
  const tremor = {
    amp: fontSize * between(0.005, 0.012),
    wave: between(18, 34),
    phase: between(0, Math.PI * 2),
  };
  const settle = between(-0.45, 0.45);
  const pressure = {
    amp: between(0.09, 0.15),
    wave: between(70, 140),
    phase: between(0, Math.PI * 2),
  };

  // 抜き。終わりに向けて細くなり、ペンが紙を離れる向き（上）へ少し跳ねる。
  const taper = clamp(length * 0.24, fontSize, fontSize * 3.2);
  const flick = fontSize * between(0.03, 0.09);
  const flickSpan = Math.min(length * 0.12, fontSize);

  const centerY = (d: number): number => {
    const u = d / length;
    let y = middle + rise * (u - 0.5) - bow * Math.sin(Math.PI * u);
    y += sway.amp * Math.sin((d / sway.wave) * Math.PI * 2 + sway.phase);
    y += tremor.amp * Math.sin((d / tremor.wave) * Math.PI * 2 + tremor.phase);
    // ペン先を置いた直後は、置いた位置から線の高さへ落ち着く。
    y += settle * Math.exp(-d / 3);
    const untilEnd = length - d;
    if (untilEnd < flickSpan) y -= flick * (1 - untilEnd / flickSpan) ** 2;
    return y;
  };

  const halfWidth = (d: number): number => {
    const u = d / length;
    // 入り：置いた所にインクが溜まる。
    const pooled = 1 + (poolRadius / base - 1) * Math.exp(-((d / poolSpread) ** 2));
    // 走り出し：速さが乗ると、溜まりの直後がいったん細くなる。
    const neck = 1 - 0.14 * Math.exp(-(((d - fontSize * 0.6) / (fontSize * 0.45)) ** 2));
    // 途中：筆圧のゆっくりした変化。置いた側が重く、速さが乗る終わりへ向けて軽くなる。
    const pressed = 1 + pressure.amp * Math.sin((d / pressure.wave) * Math.PI * 2 + pressure.phase);
    const eased = 1.1 - 0.24 * u;
    // 抜き：先が尖る。
    const untilEnd = length - d;
    const lifted = untilEnd < taper ? 0.08 + 0.92 * (untilEnd / taper) ** 0.65 : 1;
    return base * pooled * neck * pressed * eased * lifted;
  };

  const distances = sampleDistances(length, fontSize, taper);
  const top: string[] = [];
  const bottom: string[] = [];
  distances.forEach((d) => {
    // ほぼ水平な線なので、法線は中心線の傾きから求める。
    const slope = (centerY(Math.min(length, d + 0.5)) - centerY(Math.max(0, d - 0.5))) / 1;
    const norm = Math.hypot(1, slope);
    const nx = -slope / norm;
    const ny = 1 / norm;
    const x = startX + d;
    const y = centerY(d);
    const r = halfWidth(d);
    top.push(`${fixed(x - nx * r)} ${fixed(y - ny * r)}`);
    bottom.push(`${fixed(x + nx * r)} ${fixed(y + ny * r)}`);
  });

  const capRadius = fixed(halfWidth(0));
  const path =
    `M${top[0]}L${top.slice(1).join(" ")} ${bottom.reverse().slice(0, -1).join(" ")} ` +
    // 入りの丸み：下の縁から左を回って上の縁へ戻る。
    `${bottom[bottom.length - 1]}A${capRadius} ${capRadius} 0 0 1 ${top[0]}Z`;

  return {
    path,
    pace: clamp(1.45 + length / 420, 1.5, 2.2),
    pool: startX + poolRadius + poolSpread,
  };
}

/**
 * 完了にした行が一覧から外れても、線を引き終わるまでは元の位置に残す。
 *
 * `rows` は今の一覧、`previous` は直前に描いた一覧。`lingering` にある ID のうち
 * `rows` に無い行を、直前の並びで前にあった行のすぐ後ろへ戻す。戻す行は `refresh` で
 * 今のデータに写し直す（null を返した行は戻さない）。データは変えず、描く並びだけを作る。
 */
export function mergeLingeringRows<T>(
  rows: readonly T[],
  previous: readonly T[],
  idOf: (row: T) => string,
  lingering: ReadonlySet<string>,
  refresh: (row: T) => T | null,
): T[] {
  if (!lingering.size || !previous.length) return rows as T[];
  const present = new Set(rows.map(idOf));
  const merged = [...rows];
  let changed = false;
  previous.forEach((row, index) => {
    const id = idOf(row);
    if (!lingering.has(id) || present.has(id)) return;
    const kept = refresh(row);
    if (!kept) return;
    let insertAt = 0;
    for (let before = index - 1; before >= 0; before -= 1) {
      const anchor = merged.findIndex((entry) => idOf(entry) === idOf(previous[before]));
      if (anchor >= 0) {
        insertAt = anchor + 1;
        break;
      }
    }
    merged.splice(insertAt, 0, kept);
    present.add(id);
    changed = true;
  });
  return changed ? merged : (rows as T[]);
}
