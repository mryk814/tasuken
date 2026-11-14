import { searchQueryVariants } from "./searchdict/searchSpellings.ts";

export function normalizeCommandQuery(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function prepareCommandEntries(entries) {
  return entries.map((entry) => ({
    ...entry,
    searchIndex: {
      label: normalizeCommandQuery(entry.label),
      haystack: normalizeCommandQuery(
        [
          entry.label,
          entry.category,
          entry.context,
          entry.searchText,
          ...(entry.keywords || []),
        ].join(" "),
      ),
    },
  }));
}

function entryIndex(entry) {
  const label =
    typeof entry.searchIndex?.label === "string"
      ? entry.searchIndex.label
      : normalizeCommandQuery(entry.label);
  const haystack =
    typeof entry.searchIndex?.haystack === "string"
      ? entry.searchIndex.haystack
      : normalizeCommandQuery(
          [
            entry.label,
            entry.category,
            entry.context,
            entry.searchText,
            ...(entry.keywords || []),
          ].join(" "),
        );
  return { label, haystack };
}

function needleScore({ label, haystack }, needle) {
  if (label === needle) return 120;
  if (label.startsWith(needle)) return 100 - Math.min(40, label.length - needle.length);
  if (label.includes(needle)) return 70 - Math.min(30, label.indexOf(needle));
  const tokens = needle.split(" ").filter(Boolean);
  if (tokens.every((token) => haystack.includes(token)))
    return 40 - Math.min(20, haystack.length / 100);
  return 0;
}

export function commandMatchScore(entry, query) {
  const needle = normalizeCommandQuery(query);
  if (!needle) return 1;
  return needleScore(entryIndex(entry), needle);
}

/**
 * 問いを一度だけ読み、項目ごとの当たり方を返す。共通の辞書でほかの書き方（引越し → 引っ越し）にも当てる。
 * tier 0 は書いたままの問いで当たった項目、tier 1 はほかの書き方でだけ当たった項目で、並べる時は
 * tier 0 を必ず先にする（使った回数の上乗せでも入れ替えない）。
 */
function commandMatcher(query) {
  const needle = normalizeCommandQuery(query);
  const aliases = needle ? searchQueryVariants(needle).slice(1).map(normalizeCommandQuery) : [];
  return (entry) => {
    if (!needle) return { tier: 0, score: 1 };
    const index = entryIndex(entry);
    const direct = needleScore(index, needle);
    if (direct > 0) return { tier: 0, score: direct };
    let best = 0;
    for (const alias of aliases) best = Math.max(best, needleScore(index, alias));
    return { tier: 1, score: best };
  };
}

function byMatch(left, right) {
  return (
    left.tier - right.tier ||
    right.score - left.score ||
    left.entry.label.localeCompare(right.entry.label, "ja")
  );
}

export function filterCommandEntries(entries, query) {
  const match = commandMatcher(query);
  return entries
    .map((entry) => ({ entry, ...match(entry) }))
    .filter((candidate) => candidate.score > 0)
    .sort(byMatch)
    .map((candidate) => candidate.entry);
}

export function rankCommandEntries(entries, query, usage = {}) {
  const needle = normalizeCommandQuery(query);
  const matchEntry = commandMatcher(query);
  return entries
    .map((entry) => {
      const { tier, score: match } = matchEntry(entry);
      const usageKey = entry.usageKey || entry.id;
      const record = usage && typeof usage[usageKey] === "object" ? usage[usageKey] : null;
      const count = Number(record?.count || 0);
      const lastUsedAt = Date.parse(String(record?.lastUsedAt || ""));
      const ageHours = Number.isFinite(lastUsedAt)
        ? Math.max(0, (Date.now() - lastUsedAt) / 3_600_000)
        : Infinity;
      const usageBoost =
        Math.min(12, Math.log2(count + 1) * 3) + (ageHours < 24 ? 5 : ageHours < 168 ? 2 : 0);
      return { entry, tier, score: match > 0 ? match + usageBoost : 0 };
    })
    .filter((candidate) => candidate.score > 0 || !needle)
    .sort(byMatch)
    .map((candidate) => candidate.entry);
}
