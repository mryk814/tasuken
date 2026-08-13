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
      haystack: normalizeCommandQuery([
        entry.label,
        entry.category,
        entry.context,
        entry.searchText,
        ...(entry.keywords || []),
      ].join(" ")),
    },
  }));
}

export function commandMatchScore(entry, query) {
  const needle = normalizeCommandQuery(query);
  if (!needle) return 1;
  const label = typeof entry.searchIndex?.label === "string"
    ? entry.searchIndex.label
    : normalizeCommandQuery(entry.label);
  const haystack = typeof entry.searchIndex?.haystack === "string"
    ? entry.searchIndex.haystack
    : normalizeCommandQuery([
      entry.label,
      entry.category,
      entry.context,
      entry.searchText,
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

export function rankCommandEntries(entries, query, usage = {}) {
  const needle = normalizeCommandQuery(query);
  return entries
    .map((entry) => {
      const match = commandMatchScore(entry, query);
      const usageKey = entry.usageKey || entry.id;
      const record = usage && typeof usage[usageKey] === "object" ? usage[usageKey] : null;
      const count = Number(record?.count || 0);
      const lastUsedAt = Date.parse(String(record?.lastUsedAt || ""));
      const ageHours = Number.isFinite(lastUsedAt) ? Math.max(0, (Date.now() - lastUsedAt) / 3_600_000) : Infinity;
      const usageBoost = Math.min(12, Math.log2(count + 1) * 3) + (ageHours < 24 ? 5 : ageHours < 168 ? 2 : 0);
      return { entry, score: match > 0 ? match + usageBoost : 0 };
    })
    .filter((candidate) => candidate.score > 0 || !needle)
    .sort((left, right) => right.score - left.score || left.entry.label.localeCompare(right.entry.label, "ja"))
    .map((candidate) => candidate.entry);
}
