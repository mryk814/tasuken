import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { mergeLingeringRows, penStrikeShape } from "../model/penStrike";

/*
 * 完了の線（#738）。本人がその場で完了にした Task の題名に、万年筆で取り消し線を引く。
 *
 * - 動くのは、その場で完了にした時だけ。開いた時にすでに完了していた題名は、同じ形の線を動かさずに出す。
 * - 保存は待たない。線は押した時（完了の音と同じ時）に引き始め、保存は並んで進む。
 * - OS の「動きを減らす」では動かさず、最初から引いた線を出す（app.css）。
 */

/**
 * 完了にした行を一覧に残しておく長さ。線を引き終わり（長くて約 400ms）、引いた線が
 * 目に入るだけの間を置く。続けて完了にする邪魔にならないよう 1 秒より短くする。
 */
const LINGER_MS = 720;

export interface FreshCompletions {
  /** 今、線を引いている（引き終えて行を残している）Task の ID。 */
  ids: ReadonlySet<string>;
  /** 完了にした時に呼ぶ。完了の音と同じ所で呼ぶ。 */
  mark: (id: string) => void;
  /** 完了を取り消した時、保存に失敗した時に呼ぶ。線を消す。 */
  clear: (id: string) => void;
}

/**
 * その場で完了にした Task を覚える。`isDone` は今のデータでその Task が完了しているかを返す。
 * 完了が保存された後で未完了に戻った（取り消された）ら、どの入口から戻しても線を消す。
 */
export function useFreshCompletions(isDone: (id: string) => boolean): FreshCompletions {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Map<string, number>());
  const seenDone = useRef(new Set<string>());

  const clear = useCallback((id: string) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    seenDone.current.delete(id);
    setIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const mark = useCallback(
    (id: string) => {
      window.clearTimeout(timers.current.get(id));
      timers.current.set(
        id,
        window.setTimeout(() => clear(id), LINGER_MS),
      );
      seenDone.current.delete(id);
      setIds((current) => new Set(current).add(id));
    },
    [clear],
  );

  useEffect(() => {
    ids.forEach((id) => {
      if (isDone(id)) seenDone.current.add(id);
      else if (seenDone.current.has(id)) clear(id);
    });
  });

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  return useMemo(() => ({ ids, mark, clear }), [ids, mark, clear]);
}

/**
 * 完了にした行が一覧から外れる画面で、線を引き終わるまで行を元の位置に残す。
 * `refresh` は残す行を今のデータに写し直す（Task が無くなっていたら null）。
 */
export function useLingeringRows<T>(
  rows: T[],
  idOf: (row: T) => string,
  lingering: ReadonlySet<string>,
  refresh: (row: T) => T | null,
): T[] {
  const previous = useRef<T[]>([]);
  const merged = mergeLingeringRows(rows, previous.current, idOf, lingering, refresh);
  useEffect(() => {
    previous.current = merged;
  });
  return merged;
}

/**
 * Task の題名。`struck` で取り消し線を出し、`drawing` の間だけ線を引く動きを付ける。
 * 線は題名の見えている幅に合わせる（長い題名が省略されたら、省略された幅まで）。
 */
export function StruckTitle({
  text,
  seed,
  struck,
  drawing,
}: {
  text: string;
  seed: string;
  struck: boolean;
  drawing: boolean;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<{ width: number; height: number; fontSize: number } | null>(null);

  useLayoutEffect(() => {
    const element = host.current;
    if (!struck || !element) return undefined;
    const measure = () => {
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const fontSize = Number.parseFloat(window.getComputedStyle(element).fontSize) || 14;
      setBox((current) =>
        current &&
        current.width === width &&
        current.height === height &&
        current.fontSize === fontSize
          ? current
          : { width, height, fontSize },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [struck, text]);

  const shape = useMemo(
    () => (struck && box && box.width > 0 ? penStrikeShape({ seed, ...box }) : null),
    [box, seed, struck],
  );

  return (
    <span ref={host} className={`pen-strike-host${struck ? " is-struck" : ""}`}>
      <span className="pen-strike-text">{text}</span>
      {shape && box && (
        <svg
          className={`pen-strike${drawing ? " is-drawing" : ""}`}
          width={box.width}
          height={box.height}
          viewBox={`0 0 ${box.width} ${box.height}`}
          aria-hidden="true"
          focusable="false"
          style={
            {
              "--pen-strike-pace": shape.pace,
              "--pen-strike-pool": `${shape.pool.toFixed(1)}px`,
            } as CSSProperties
          }
        >
          <path d={shape.path} />
        </svg>
      )}
    </span>
  );
}
