export function normalizeCommandQuery(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function commandMatchScore(entry, query) {
  const needle = normalizeCommandQuery(query);
  if (!needle) return 1;
  const label = normalizeCommandQuery(entry.label);
  const haystack = normalizeCommandQuery([
    entry.label,
    entry.category,
    ...(entry.keywords || []),
  ].join(" "));
  if (label === needle) return 120;
  if (label.startsWith(needle)) return 100 - Math.min(40, label.length - needle.length);
  if (label.includes(needle)) return 70 - Math.min(30, label.indexOf(needle));
  const tokens = needle.split(" ").filter(Boolean);
  if (tokens.every((token) => haystack.includes(token))) return 40 - Math.min(20, haystack.length / 100);
  return 0;
}

export function filterCommandEntries(entries, query) {
  return entries
    .map((entry) => ({ entry, score: commandMatchScore(entry, query) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.entry.label.localeCompare(right.entry.label, "ja"))
    .map((candidate) => candidate.entry);
}
