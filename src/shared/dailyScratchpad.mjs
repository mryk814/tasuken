export const DAILY_SCRATCHPAD_ROLE = "daily_scratchpad";

export function dailyScratchpadProperties(record) {
  const value = record?.properties_json;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function dailyScratchpadDate(record) {
  const properties = dailyScratchpadProperties(record);
  return properties.document_role === DAILY_SCRATCHPAD_ROLE
    ? String(properties.scratchpad_date || "")
    : "";
}

export function isDailyScratchpad(record) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dailyScratchpadDate(record));
}

export function dailyScratchpadTitle(date) {
  return `Daily Scratchpad ${date}`;
}

export function dailyScratchpadDraftKey(date) {
  return `tasken:daily-scratchpad:draft:${date}`;
}

export function filterDailyScratchpads(records, query = "") {
  const normalized = String(query).trim().toLocaleLowerCase();
  return records
    .filter(isDailyScratchpad)
    .filter((record) => {
      if (!normalized) return true;
      return `${dailyScratchpadDate(record)} ${record.title || ""} ${record.body_markdown || ""}`
        .toLocaleLowerCase()
        .includes(normalized);
    })
    .sort((left, right) => (
      dailyScratchpadDate(right).localeCompare(dailyScratchpadDate(left))
      || String(right.updated_at || "").localeCompare(String(left.updated_at || ""))
      || String(left.id || "").localeCompare(String(right.id || ""))
    ));
}
