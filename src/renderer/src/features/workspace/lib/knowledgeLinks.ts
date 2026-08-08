import type { BaseRecord } from "../types";
import {
  buildBacklinkContext,
  parseExplicitLinks,
} from "../../../../../shared/contextLinks.mjs";

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

export const parseWikiLinks = parseExplicitLinks;

export function buildKnowledgeLinkContext(
  node: BaseRecord,
  data: { notes?: BaseRecord[]; knowledge_nodes?: BaseRecord[] },
): KnowledgeLinkContext {
  const entries = [
    ...(data.notes || []).map((record) => ({ type: "note" as const, record })),
    ...(data.knowledge_nodes || [])
      .filter((record) => record.id !== node.id)
      .map((record) => ({ type: "knowledge_node" as const, record })),
  ];
  return buildBacklinkContext(node, entries);
}
