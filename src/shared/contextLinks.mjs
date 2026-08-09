function text(value) {
  return value == null ? "" : String(value).trim();
}

export function parseExplicitLinks(value) {
  const source = text(value);
  if (!source) return [];
  const links = [];
  const pattern = /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const target = text(match[1]);
    if (!target) continue;
    links.push({ raw: match[0], target, alias: text(match[2]) || target });
  }
  return links;
}

function entryBody(record) {
  return text(record.body_markdown || record.body || record.text || record.description);
}

function entryTitle(record) {
  return text(record.title) || text(record.name) || record.id;
}

function toEntry(type, record) {
  return {
    id: record.id,
    type,
    title: entryTitle(record),
    body: entryBody(record),
    record,
  };
}

function hasExplicitLink(record, targetTitle) {
  return parseExplicitLinks(entryBody(record)).some((link) => link.target.toLocaleLowerCase("ja-JP") === targetTitle.toLocaleLowerCase("ja-JP"));
}

function mentionsTitle(record, targetTitle) {
  const body = `${entryTitle(record)}\n${entryBody(record)}`.toLocaleLowerCase("ja-JP");
  return body.includes(targetTitle.toLocaleLowerCase("ja-JP"));
}

/**
 * Shared read projection for explicit backlinks and unlinked mention candidates.
 * Callers provide typed records; the projection has no Knowledge-page dependency.
 */
export function buildBacklinkContext(target, records = []) {
  const title = entryTitle(target);
  const entries = records
    .filter((entry) => entry && entry.record && entry.record.id !== target.id)
    .map((entry) => toEntry(entry.type, entry.record));
  const backlinks = entries.filter((entry) => hasExplicitLink(entry.record, title));
  const backlinkIds = new Set(backlinks.map((entry) => `${entry.type}:${entry.id}`));
  const unlinkedMentions = entries
    .filter((entry) => !backlinkIds.has(`${entry.type}:${entry.id}`) && mentionsTitle(entry.record, title))
    .sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title, "ja"));
  return { backlinks, unlinkedMentions };
}
