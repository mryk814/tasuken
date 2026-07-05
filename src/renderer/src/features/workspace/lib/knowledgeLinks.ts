import type { BaseRecord } from "../types";

export interface WikiLink {
  raw: string;
  target: string;
  alias: string;
}

export interface KnowledgeLinkEntry {
  id: string;
  type: "note" | "knowledge_node";
  title: string;
  body: string;
  record: BaseRecord;
}

export interface KnowledgeLinkContext {
  backlinks: KnowledgeLinkEntry[];
  unlinkedMentions: KnowledgeLinkEntry[];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function entryBody(record: BaseRecord): string {
  return text(record.body_markdown || record.body || record.text || record.description);
}

function entryTitle(record: BaseRecord): string {
  return text(record.title) || text(record.name) || record.id;
}

export function parseWikiLinks(value: unknown): WikiLink[] {
  const source = text(value);
  if (!source) return [];
  const links: WikiLink[] = [];
  const pattern = /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const target = text(match[1]);
    if (!target) continue;
    links.push({
      raw: match[0],
      target,
      alias: text(match[2]) || target,
    });
  }
  return links;
}

function hasExplicitWikiLink(record: BaseRecord, targetTitle: string): boolean {
  return parseWikiLinks(entryBody(record)).some((link) => link.target.toLocaleLowerCase("ja-JP") === targetTitle.toLocaleLowerCase("ja-JP"));
}

function mentionsTitle(record: BaseRecord, targetTitle: string): boolean {
  const body = `${entryTitle(record)}\n${entryBody(record)}`.toLocaleLowerCase("ja-JP");
  return body.includes(targetTitle.toLocaleLowerCase("ja-JP"));
}

function toEntry(type: KnowledgeLinkEntry["type"], record: BaseRecord): KnowledgeLinkEntry {
  return {
    id: record.id,
    type,
    title: entryTitle(record),
    body: entryBody(record),
    record,
  };
}

export function buildKnowledgeLinkContext(
  node: BaseRecord,
  data: { notes?: BaseRecord[]; knowledge_nodes?: BaseRecord[] },
): KnowledgeLinkContext {
  const title = entryTitle(node);
  const noteEntries = (data.notes || []).map((record) => toEntry("note", record));
  const knowledgeEntries = (data.knowledge_nodes || [])
    .filter((record) => record.id !== node.id)
    .map((record) => toEntry("knowledge_node", record));
  const entries = [...noteEntries, ...knowledgeEntries];

  const backlinks = entries.filter((entry) => hasExplicitWikiLink(entry.record, title));
  const backlinkIds = new Set(backlinks.map((entry) => `${entry.type}:${entry.id}`));
  const unlinkedMentions = entries
    .filter((entry) => !backlinkIds.has(`${entry.type}:${entry.id}`) && mentionsTitle(entry.record, title))
    .sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title, "ja"));

  return { backlinks, unlinkedMentions };
}
