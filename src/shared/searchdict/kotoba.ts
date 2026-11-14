/**
 * 共通の辞書（写しは ./kotoba）を TypeScript で読む。
 *
 * 写しは一般の表記ゆれ（dict/alias.tsv）だけで、辞書を読む側の決まりはここに持つ: 照合のキー
 * （NFKC にしてから小文字）、行の決まり、語を丸ごと広げる expand、文の中の書き方を読み出す find。
 * Android の Kotoba.kt も同じ形にしてある。片方を直したら、もう片方も読み合わせて直す。
 * 決まりは tests/search-dictionary.test.mjs と Android の KotobaTest が、同じ例で確かめる。
 *
 * 辞書の形には、種類の列に alias のほかに asr（音声認識の崩れ）がある。その表は公開のこの
 * リポジトリには写さないので、探すのには使わない。行としては読めて、誤りにはしない
 * （同じ形の辞書のファイルを読んでも壊れないように）。
 */

export type KotobaKind = "alias" | "asr";

export interface KotobaLine {
  readonly file: string;
  readonly num: number;
  readonly kind: KotobaKind;
  readonly forms: readonly string[];
}

/** 文の中で見つけた書き方。at と length はキーの code point で数える。 */
export interface KotobaLocated {
  readonly at: number;
  readonly length: number;
  readonly form: string;
}

export interface KotobaDictionary {
  /** 問いの語のほかの書き方（その語自身は含めない）。語が辞書の書き方そのものでなければ空。 */
  expand(term: string): string[];
  /** 文の問いから辞書の書き方を読み出す（長い方が勝ち、重ならず、書いてある順）。 */
  find(text: string): string[];
  /** find の位置つき。読み替えた問いを作るのに使う。 */
  locate(text: string): KotobaLocated[];
}

/** 照合のキー: NFKC にしてから小文字。 */
export function kotobaKey(value: unknown): string {
  return String(value).normalize("NFKC").toLowerCase();
}

function at(line: { file: string; num: number }): string {
  return `${line.file}:${line.num}`;
}

// 和文の空白は数で書く（見た目では半角の空白と区別できないため）。
function isSpace(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return char === " " || code === 0x3000 || code < 0x20;
}

// 短い書き方は部分一致で、ほかの語の一部に当たる（もち が もちろん・気持ち に）。
function isShortKana(form: string): boolean {
  const chars = [...form.normalize("NFKC")];
  return (
    chars.length <= 2 &&
    chars.every((char) => /[\p{Script=Hiragana}\p{Script=Katakana}ー]/u.test(char))
  );
}

const BOM = String.fromCharCode(0xfeff);

/** 辞書のファイルを一つ読む。誤りの行があれば、見つけた誤りをすべて載せて投げる。 */
export function parseKotoba(file: string, text: string): KotobaLine[] {
  const lines: KotobaLine[] = [];
  const errors: string[] = [];
  text.split("\n").forEach((row, index) => {
    let value = row.endsWith("\r") ? row.slice(0, -1) : row;
    if (index === 0 && value.startsWith(BOM)) value = value.slice(1);
    if (value.trim() === "" || value.startsWith("#")) return;
    const [kind, ...forms] = value.split("\t");
    const place = at({ file, num: index + 1 });
    if (kind !== "alias" && kind !== "asr") {
      errors.push(`${place}: 種類は alias か asr です（${JSON.stringify(kind)}）`);
    } else if (forms.length < 2) {
      errors.push(`${place}: 書き方が2つ以上要ります`);
    } else if (forms.some((form) => form === "" || [...form].some(isSpace))) {
      errors.push(`${place}: 空の書き方か、空白を含む書き方があります`);
    } else if (forms.some(isShortKana)) {
      errors.push(`${place}: かなだけで2文字以下の書き方は、ほかの語の一部に当たるので置きません`);
    } else {
      lines.push({ file, num: index + 1, kind, forms });
    }
  });
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return lines;
}

/**
 * どの書き方も一つの組にしか行かないことを確かめる: 同じ行に同じ書き方は一度だけ、
 * 一つのキーは alias の一行にだけ。
 */
export function checkKotoba(lines: readonly KotobaLine[]): void {
  const errors: string[] = [];
  const aliasAt = new Map<string, string>();
  for (const line of lines) {
    const seen = new Set<string>();
    for (const form of line.forms) {
      const key = kotobaKey(form);
      if (seen.has(key)) errors.push(`${at(line)}: ${JSON.stringify(form)} が同じ行に2回あります`);
      seen.add(key);
    }
    if (line.kind !== "alias") continue;
    for (const form of line.forms) {
      const previous = aliasAt.get(kotobaKey(form));
      if (previous !== undefined && previous !== at(line)) {
        errors.push(`${at(line)}: ${JSON.stringify(form)} は ${previous} にもあります`);
      }
      aliasAt.set(kotobaKey(form), at(line));
    }
  }
  if (errors.length > 0) throw new Error(errors.sort().join("\n"));
}

/** 写しの dict/*.tsv をまとめて読み、確かめてから辞書を作る。 */
export function loadKotoba(files: Readonly<Record<string, string>>): KotobaDictionary {
  const names = Object.keys(files)
    .filter((name) => /^dict\/[^/]+\.tsv$/.test(name))
    .sort();
  if (names.length === 0) throw new Error("dict/*.tsv がありません");
  const lines: KotobaLine[] = [];
  const errors: string[] = [];
  for (const name of names) {
    try {
      lines.push(...parseKotoba(name.slice("dict/".length), files[name]));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (errors.length > 0) throw new Error(errors.join("\n"));
  checkKotoba(lines);
  return buildKotoba(lines);
}

// 英字か数字（キーは全角を半角にするので、ASCII だけを見ればよい）。
function isLatin(char: string | undefined): boolean {
  return (
    char !== undefined &&
    char.length === 1 &&
    char.charCodeAt(0) < 0x80 &&
    /[\p{L}\p{N}]/u.test(char)
  );
}

function buildKotoba(lines: readonly KotobaLine[]): KotobaDictionary {
  const spellings = new Map<string, readonly string[]>();
  const forms: { form: string; key: string[] }[] = [];
  for (const line of lines) {
    // asr の行は探すのに使わない（このファイルの頭の説明）。
    if (line.kind !== "alias") continue;
    for (const form of line.forms) {
      const key = kotobaKey(form);
      spellings.set(key, line.forms);
      forms.push({ form, key: [...key] });
    }
  }
  // find は長い書き方から見る（Array.prototype.sort は安定）。
  forms.sort((left, right) => right.key.length - left.key.length);

  function locate(text: string): KotobaLocated[] {
    const key = [...kotobaKey(text)];
    const used = new Array<boolean>(key.length).fill(false);
    const found: KotobaLocated[] = [];
    for (const { form, key: formKey } of forms) {
      const size = formKey.length;
      for (let index = 0; index + size <= key.length; index += 1) {
        let same = true;
        for (let offset = 0; offset < size; offset += 1) {
          if (key[index + offset] !== formKey[offset] || used[index + offset]) {
            same = false;
            break;
          }
        }
        if (!same) continue;
        // 英字・数字の書き方は、語の丸ごとのときだけ数える（wifi6・mywifi の中の wifi は数えない）。
        if (
          (index > 0 && isLatin(formKey[0]) && isLatin(key[index - 1])) ||
          (index + size < key.length && isLatin(formKey[size - 1]) && isLatin(key[index + size]))
        ) {
          continue;
        }
        for (let offset = 0; offset < size; offset += 1) used[index + offset] = true;
        found.push({ at: index, length: size, form });
      }
    }
    return found.sort((left, right) => left.at - right.at);
  }

  return {
    expand(term) {
      const own = kotobaKey(term);
      return (spellings.get(own) ?? []).filter((form) => kotobaKey(form) !== own);
    },
    find(text) {
      const result: string[] = [];
      for (const { form } of locate(text)) if (!result.includes(form)) result.push(form);
      return result;
    },
    locate,
  };
}
