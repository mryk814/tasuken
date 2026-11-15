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
