export const todayIso = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
export const newId = () => Date.now() + Math.floor(Math.random() * 1000);

export function formValue(data, key, fallback = "") {
  return String(data.get(key) ?? fallback).trim();
}

export function dateLabel(iso, withYear = false) {
  const d = new Date(`${iso}T00:00:00`);
  const parts = withYear
    ? `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${parts} (${["日", "月", "火", "水", "木", "金", "土"][d.getDay()]})`;
}

export function toMarkdown(data) {
  return [
    "# Current Work Context",
    "",
    ...data.themes.flatMap((theme) => {
      const themeTasks = data.tasks.filter((item) => item.theme === theme.id && item.status !== "done");
      const themeWaiting = data.waiting.filter((item) => item.theme === theme.id && item.status === "waiting");
      const themeNotes = data.notes.filter((item) => item.theme === theme.id).slice(0, 5);
      return [
        `## Theme: ${theme.name}`,
        theme.subtitle || "",
        "",
        "### Items",
        ...(themeTasks.length ? themeTasks.map((item) => `- [ ] ${item.due} ${item.title}`) : ["- なし"]),
        "",
        "### Waiting",
        ...(themeWaiting.length ? themeWaiting.map((item) => `- ${item.due} ${item.title} / ${item.owner}`) : ["- なし"]),
        "",
        "### Recent Notes",
        ...(themeNotes.length ? themeNotes.map((note) => `- ${note.title}: ${note.body}`) : ["- なし"]),
        "",
      ];
    }),
  ].join("\n");
}

function yamlScalar(value) {
  return JSON.stringify(value ?? "");
}

export function toYaml(data) {
  const blocks = [];
  for (const [key, values] of Object.entries(data)) {
    if (!Array.isArray(values)) continue;
    blocks.push(`${key}:`);
    for (const value of values) {
      const entries = Object.entries(value);
      blocks.push(`  - ${entries[0][0]}: ${yamlScalar(entries[0][1])}`);
      entries.slice(1).forEach(([field, fieldValue]) => blocks.push(`    ${field}: ${yamlScalar(fieldValue)}`));
    }
  }
  return blocks.join("\n");
}

function parseYamlValue(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed.replace(/^['"]|['"]$/g, "");
  }
}

export function parseSimpleYaml(text) {
  const result = {};
  let section = null;
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, "  ");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const sectionMatch = line.match(/^([A-Za-z_][\w-]*):\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      result[section] = [];
      current = null;
      continue;
    }
    const itemMatch = line.match(/^\s*-\s+([A-Za-z_][\w-]*):\s*(.*)$/);
    const fieldMatch = line.match(/^\s+([A-Za-z_][\w-]*):\s*(.*)$/);
    if (itemMatch && section) {
      current = {};
      result[section].push(current);
      current[itemMatch[1]] = parseYamlValue(itemMatch[2]);
    } else if (fieldMatch && current) {
      current[fieldMatch[1]] = parseYamlValue(fieldMatch[2]);
    }
  }
  if (!Object.keys(result).length) throw new Error("JSONまたは配列形式のYAMLを入力してください");
  return result;
}
