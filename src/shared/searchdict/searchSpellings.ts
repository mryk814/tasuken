import { kotobaKey, loadKotoba } from "./kotoba.ts";
import { KOTOBA_FILES } from "./kotobaFiles.generated.ts";

// 読み込んだ時に一度だけ作る。検索のたびには読み直さない。辞書が壊れていれば、一つの検索ではなく
// 起動で止まる（tests/search-dictionary.test.mjs が写しを読めることを見張る）。
const dictionary = loadKotoba(KOTOBA_FILES);

const MAX_QUERY_VARIANTS = 16;

export type TextMatchLevel = "direct" | "alias";

export interface TextSearch {
  /** 書いたままの問い（前後の空白は外す）。 */
  readonly query: string;
  /** ほかの書き方の問い（書いたままの問いは含めない）。 */
  readonly spellings: readonly string[];
  /** textSearchKey で先に作ったキーと比べる（同じ文を何度も比べる画面で、正規化を一度にする）。 */
  matchKey(key: string): TextMatchLevel | null;
  /** 欄のどれかで当たれば当たり。書いたままの問いで当たる欄が一つでもあれば direct。 */
  match(texts: readonly unknown[]): TextMatchLevel | null;
}

/**
 * 問いの一語を、ほかにどう書くか（その語自身は含めない）。引越し → 引っ越し・引越。
 *
 * 語が辞書の書き方そのものなら丸ごと広げる（expand）。語が文（引越しの段取り）なら、文の中の書き方を
 * 長い方から重ならないように読み出し（locate）、その所だけを書き換える。
 * Android の localSearchSpellings も同じ。
 */
export function termSpellings(term: string): string[] {
  if (!term) return [];
  const whole = dictionary.expand(term);
  if (whole.length > 0) return whole;
  const chars = [...kotobaKey(term)];
  const seen = new Set([chars.join("")]);
  const result: string[] = [];
  for (const found of dictionary.locate(term)) {
    for (const spelling of dictionary.expand(found.form)) {
      const variant = [
        ...chars.slice(0, found.at),
        spelling,
        ...chars.slice(found.at + found.length),
      ].join("");
      const key = kotobaKey(variant);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(variant);
    }
  }
  return result;
}

/**
 * 書いたままの問いを先頭に、空白で分けた語を一つずつほかの書き方に替えた問いを続ける。
 * 長い問いで条件が何百にも増えないように数を抑える。
 */
export function searchQueryVariants(query: string | null | undefined): string[] {
  const written = String(query ?? "").trim();
  if (!written) return [];
  const variants = [written];
  const seen = new Set([kotobaKey(written)]);
  const terms = written.split(/\s+/);
  for (let index = 0; index < terms.length; index += 1) {
    for (const spelling of termSpellings(terms[index])) {
      if (variants.length >= MAX_QUERY_VARIANTS) return variants;
      const variant = terms
        .map((term, position) => (position === index ? spelling : term))
        .join(" ");
      const key = kotobaKey(variant);
      if (seen.has(key)) continue;
      seen.add(key);
      variants.push(variant);
    }
  }
  return variants;
}

/**
 * 部分一致の検索に辞書を効かせる。書いたままの問いで当たれば "direct"、ほかの書き方で
 * だけ当たれば "alias"、当たらなければ null。比べるのは照合のキー（NFKC にして小文字）どうし。
 * 並べる側は direct を alias より先にする（本人の言葉そのもので当たった物を先に見せる）。
 * 問いが空なら null を返す（呼ぶ側で「絞り込まない」にする）。
 */
export function createTextSearch(query: string | null | undefined): TextSearch | null {
  const variants = searchQueryVariants(query);
  if (variants.length === 0) return null;
  const [direct, ...aliases] = variants.map(kotobaKey);
  const matchKey = (key: string): TextMatchLevel | null => {
    if (key.includes(direct)) return "direct";
    return aliases.some((alias) => key.includes(alias)) ? "alias" : null;
  };
  return {
    query: variants[0],
    spellings: variants.slice(1),
    matchKey,
    match(texts) {
      let level: TextMatchLevel | null = null;
      for (const value of texts) {
        if (value == null || value === "") continue;
        const matched = matchKey(kotobaKey(value));
        if (matched === "direct") return "direct";
        level = level ?? matched;
      }
      return level;
    },
  };
}

/** createTextSearch の matchKey に渡すキー。 */
export function textSearchKey(value: unknown): string {
  return kotobaKey(value == null ? "" : String(value));
}

/** 当たり方で並べ替える（direct が先、同じ当たり方の中は元の順のまま）。当たらない物は外す。 */
export function orderByTextMatch<T>(
  records: readonly T[],
  levelOf: (record: T) => TextMatchLevel | null,
): T[] {
  const direct: T[] = [];
  const alias: T[] = [];
  for (const record of records) {
    const level = levelOf(record);
    if (level === "direct") direct.push(record);
    else if (level === "alias") alias.push(record);
  }
  return [...direct, ...alias];
}
