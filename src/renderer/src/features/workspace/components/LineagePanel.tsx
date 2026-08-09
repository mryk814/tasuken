import { useMemo, useState } from "react";

import { IconChevronDown, IconChevronRight, IconRoute } from "@tabler/icons-react";

import { buildEntityLineage } from "../../../../../shared/conversationLineage.mjs";
import { collectionKeyForEntityType, type RegistryEntityType } from "../../../../../shared/entityRegistry.mjs";
import type { BaseRecord, OpenContentViewer, OpenDrawer, WorkspaceData } from "../types";
import { findSchedule } from "./drawerEntityFields";

const ENTITY_LABELS: Record<string, string> = {
  artifact: "Artifact",
  capture_entry: "Capture",
  knowledge_node: "Knowledge",
  note: "Note",
  plan_node: "計画",
  project: "Theme",
  resource: "Resource",
  sketch: "Sketch",
  task: "Task",
  waiting: "待ち",
};

const RELATION_LABELS: Record<string, string> = {
  attached_to: "添付",
  based_on: "元に作成",
  captured_from: "取り込み元",
  continued_as: "続き",
  created_for: "目的として作成",
  derived_from: "派生",
  exported_from: "書き出し",
  generated_from: "生成",
  triaged_to: "整理先",
  related_to: "関連",
  mentions: "参照",
  blocks: "ブロック",
  supports: "根拠",
};

interface LineageItem {
  ref: { type: string; id: string };
  title: string;
  depth: number;
  is_conversation?: boolean;
  relation: { predicate: string; reason: string; created_at: string; origin: string };
  trail: Array<{ title: string; relation: { predicate: string } }>;
}

interface ReferenceItem {
  ref: { type: string; id: string };
  title: string;
  relation: { predicate: string; reason: string };
}

function entityLabel(item: { ref: { type: string }; is_conversation?: boolean }): string {
  return item.is_conversation ? "Conversation" : ENTITY_LABELS[item.ref.type] || item.ref.type;
}

function relationLabel(predicate: string): string {
  return RELATION_LABELS[predicate] || predicate;
}

function formatTimestamp(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" });
}

function findRecord(data: WorkspaceData, type: string, id: string): BaseRecord | null {
  try {
    const collectionKey = collectionKeyForEntityType(type as RegistryEntityType);
    const records = (data as unknown as Record<string, unknown>)[collectionKey];
    return Array.isArray(records)
      ? (records as BaseRecord[]).find((record) => record.id === id) || null
      : null;
  } catch {
    return null;
  }
}

export function LineagePanel({
  data,
  seed,
  conversation = false,
  openDrawer,
  openContentViewer,
}: {
  data: WorkspaceData;
  seed: { type: string; id: string };
  conversation?: boolean;
  openDrawer?: OpenDrawer;
  openContentViewer?: OpenContentViewer;
}) {
  const [expanded, setExpanded] = useState(false);
  const [maxDepth, setMaxDepth] = useState<1 | 2>(2);
  const lineage = useMemo(
    () => buildEntityLineage(data, seed, { maxDepth, maxItems: 24 }),
    [data, maxDepth, seed.id, seed.type],
  );
  const hasRelations = lineage.ancestors.length > 0 || lineage.descendants.length > 0 || lineage.references.length > 0;
  if (!conversation && !hasRelations) return null;

  function openItem(item: { ref: { type: string; id: string } }) {
    if (item.ref.type === "artifact") {
      openContentViewer?.({ type: "artifact", artifactId: item.ref.id });
      return;
    }
    const record = findRecord(data, item.ref.type, item.ref.id);
    if (!record || !openDrawer || !["capture_entry", "knowledge_node", "note", "plan_node", "resource", "sketch", "task", "waiting"].includes(item.ref.type)) return;
    const entity = item.ref.type === "task" || item.ref.type === "waiting" || item.ref.type === "plan_node"
      ? { ...record, _schedule: findSchedule(data, item.ref.type as "task" | "waiting" | "plan_node", item.ref.id) }
      : record;
    openDrawer({
      type: item.ref.type as "capture_entry" | "knowledge_node" | "note" | "plan_node" | "resource" | "sketch" | "task" | "waiting",
      entity,
    });
  }

  const summary = lineage.summary;
  const summaryText = [
    `Task ${summary.task}`,
    `Note ${summary.note}`,
    `Artifact ${summary.artifact}`,
    `派生Conversation ${summary.conversation}`,
    ...(summary.other ? [`その他 ${summary.other}`] : []),
  ].join(" · ");

  function itemRow(item: LineageItem) {
    const canOpen = Boolean(openContentViewer && item.ref.type === "artifact") || Boolean(openDrawer && findRecord(data, item.ref.type, item.ref.id));
    const pathLabel = [lineage.seed.title || entityLabel({ ref: seed, is_conversation: conversation })]
      .concat(item.trail.flatMap((step) => [relationLabel(step.relation.predicate), step.title]))
      .join(" → ");
    return (
      <li key={`${item.ref.type}:${item.ref.id}`} className={`lineage-row lineage-depth-${item.depth}`}>
        <button type="button" disabled={!canOpen} onClick={() => openItem(item)}>
          <span className="lineage-node-kind">{entityLabel(item)}</span>
          <strong>{item.title}</strong>
          <span className="lineage-relation">{relationLabel(item.relation.predicate)} · {item.relation.reason}</span>
          {item.relation.created_at && <time>{formatTimestamp(item.relation.created_at)}</time>}
          <span className="lineage-path">{pathLabel}</span>
        </button>
      </li>
    );
  }

  return (
    <section className="lineage-panel" aria-label={conversation ? "この会話から生まれたもの" : "生成経路"}>
      <button
        type="button"
        className="lineage-summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <IconRoute size={16} />
        <span>
          <strong>{conversation ? "この会話から生まれたもの" : "来歴"}</strong>
          <small>{conversation ? summaryText : hasRelations ? `${lineage.ancestors.length + lineage.descendants.length}件の生成経路` : "生成経路はありません"}</small>
        </span>
        {expanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
      </button>

      {expanded && (
        <div className="lineage-body">
          <div className="segmented lineage-depth-switch" aria-label="系譜の深さ">
            <button type="button" className={maxDepth === 1 ? "is-active" : ""} onClick={() => setMaxDepth(1)}>直接</button>
            <button type="button" className={maxDepth === 2 ? "is-active" : ""} onClick={() => setMaxDepth(2)}>2段階</button>
          </div>
          {lineage.ancestors.length > 0 && (
            <div className="lineage-group">
              <h4>元になったもの</h4>
              <ul>{lineage.ancestors.map((item: LineageItem) => itemRow(item))}</ul>
            </div>
          )}
          {lineage.descendants.length > 0 && (
            <div className="lineage-group">
              <h4>この項目から生まれたもの</h4>
              <ul>{lineage.descendants.map((item: LineageItem) => itemRow(item))}</ul>
            </div>
          )}
          {lineage.references.length > 0 && (
            <div className="lineage-group lineage-reference-group">
              <h4>参照（派生ではありません）</h4>
              <ul>
                {lineage.references.map((item: ReferenceItem) => (
                  <li key={`${item.ref.type}:${item.ref.id}:${item.relation.predicate}`} className="lineage-row">
                    <button type="button" onClick={() => openItem(item)}>
                      <span className="lineage-node-kind">{entityLabel(item)}</span>
                      <strong>{item.title}</strong>
                      <span className="lineage-relation">{relationLabel(item.relation.predicate)} · {item.relation.reason}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!hasRelations && <p className="lineage-empty">この会話から生まれた項目はまだありません。</p>}
          {lineage.truncated && <p className="lineage-limit">区分ごとに24件まで表示しています。深さを「直接」にすると起点の近くへ絞れます。</p>}
        </div>
      )}
    </section>
  );
}
