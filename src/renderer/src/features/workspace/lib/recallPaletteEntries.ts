import type { CanonicalRouteId } from "../../../pages/routes";
import type { DrawerEntityType, Theme, WorkspaceData } from "../types";
import type { WorkspaceDomain } from "../domain-model/types";
import {
  CAPTURE_ENTRY_STATE_LABELS,
  TASK_STATE_LABELS,
  WAITING_STATE_LABELS,
} from "../domain-model/labels";
import { KNOWLEDGE_NODE_LABELS, NOTE_TYPE_LABELS } from "./domain";
import { isChatReference } from "./chatRefs";
import { CHAT_SERVICE_LABELS, resolveChatService } from "./chatServices";

export type RecallPaletteCategory =
  | "Commands"
  | "Tasks"
  | "Plans / Milestones"
  | "Notes / Documents"
  | "Waiting / Inbox"
  | "Knowledge / Chat"
  | "Themes"
  | "Resources / Artifacts";

export type RecallPaletteTarget =
  | { kind: "drawer"; route: CanonicalRouteId; entityType: DrawerEntityType; entityId: string; mode?: "edit" | "view" }
  | { kind: "theme"; route: "theme"; entityId: string }
  | { kind: "artifact"; route: "artifacts"; entityId: string };

export interface RecallPaletteDescriptor {
  id: string;
  label: string;
  keywords: string[];
  searchText: string;
  context: string;
  category: RecallPaletteCategory;
  target: RecallPaletteTarget;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function compactText(value: unknown, maxLength = 96): string {
  const normalized = text(value).replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function context(parts: unknown[]): string {
  return parts.map((part) => compactText(part)).filter(Boolean).join(" · ");
}

export function buildRecallPaletteEntries({
  data,
  domain,
  themes,
}: {
  data: WorkspaceData;
  domain: WorkspaceDomain;
  themes: Theme[];
}): RecallPaletteDescriptor[] {
  const themeNames = new Map(themes.map((theme) => [theme.id, theme.name]));
  const themeName = (projectId: unknown) => themeNames.get(text(projectId)) || "Theme未設定";

  const tasks: RecallPaletteDescriptor[] = domain.tasks.map((task) => {
    const description = compactText(task.description);
    return {
      id: `task:${task.id}`,
      label: text(task.title) || "無題のTask",
      keywords: ["task", "タスク", themeName(task.project_id), TASK_STATE_LABELS[task.state]],
      searchText: [task.description, task.completion_note, ...(task.checklist_items || []).map((item) => item.title)].map(text).join(" "),
      category: "Tasks",
      context: context(["Task", themeName(task.project_id), TASK_STATE_LABELS[task.state], description]),
      target: { kind: "drawer", route: "todo", entityType: "task", entityId: task.id },
    };
  });

  const notes: RecallPaletteDescriptor[] = domain.notes.map((note) => {
    const noteLabel = NOTE_TYPE_LABELS[text(note.note_type)] || "Note";
    return {
      id: `note:${note.id}`,
      label: text(note.title) || "無題のNote",
      keywords: ["note", "markdown", "文書", noteLabel, themeName(note.project_id)],
      searchText: text(note.body_markdown),
      category: "Notes / Documents",
      context: context([noteLabel, themeName(note.project_id), compactText(note.body_markdown)]),
      target: { kind: "drawer", route: "notes", entityType: "note", entityId: note.id },
    };
  });

  const planNodes: RecallPaletteDescriptor[] = domain.plan_nodes.map((planNode) => ({
    id: `plan:${planNode.id}`,
    label: text(planNode.title) || "無題のPlan",
    keywords: ["plan", "計画", "milestone", "マイルストーン", themeName(planNode.project_id), text(planNode.type), text(planNode.state)],
    searchText: text(planNode.description),
    category: "Plans / Milestones",
    context: context([planNode.type === "milestone" ? "Milestone" : "Plan", themeName(planNode.project_id), compactText(planNode.description)]),
    target: { kind: "drawer", route: "timeline", entityType: "plan_node", entityId: planNode.id, mode: "edit" },
  }));

  const waitings: RecallPaletteDescriptor[] = domain.waitings.map((waiting) => ({
    id: `waiting:${waiting.id}`,
    label: text(waiting.title) || "無題のWaiting",
    keywords: ["waiting", "待ち", themeName(waiting.project_id), WAITING_STATE_LABELS[waiting.state]],
    searchText: [waiting.description, waiting.waiting_for, waiting.next_action].map(text).join(" "),
    category: "Waiting / Inbox",
    context: context(["Waiting", themeName(waiting.project_id), `相手: ${waiting.waiting_for}`, WAITING_STATE_LABELS[waiting.state], compactText(waiting.next_action || waiting.description)]),
    target: { kind: "drawer", route: "waiting", entityType: "waiting", entityId: waiting.id, mode: "edit" },
  }));

  const captures: RecallPaletteDescriptor[] = domain.capture_entries.map((capture) => {
    const captureLabel = capture.kind === "micro_memo" ? "付箋メモ" : "Inbox記録";
    return {
      id: `capture:${capture.id}`,
      label: compactText(capture.title || capture.text, 72) || "無題の記録",
      keywords: ["capture", "inbox", "記録", captureLabel, themeName(capture.project_id), CAPTURE_ENTRY_STATE_LABELS[capture.state]],
      searchText: [capture.text, capture.url].map(text).join(" "),
      category: "Waiting / Inbox",
      context: context([captureLabel, themeName(capture.project_id), CAPTURE_ENTRY_STATE_LABELS[capture.state], compactText(capture.text)]),
      target: { kind: "drawer", route: "inbox", entityType: "capture_entry", entityId: capture.id, mode: "edit" },
    };
  });

  const knowledge: RecallPaletteDescriptor[] = domain.knowledge_nodes.map((node) => {
    const nodeLabel = KNOWLEDGE_NODE_LABELS[node.node_type] || "Knowledge";
    return {
      id: `knowledge:${node.id}`,
      label: text(node.title) || "無題のKnowledge",
      keywords: ["knowledge", "知識", nodeLabel, themeName(node.project_id)],
      searchText: text(node.body),
      category: "Knowledge / Chat",
      context: context([nodeLabel, themeName(node.project_id), compactText(node.body)]),
      target: { kind: "drawer", route: "knowledge", entityType: "knowledge_node", entityId: node.id, mode: "view" },
    };
  });

  const resources: RecallPaletteDescriptor[] = domain.resources.map((resource) => {
    const chat = isChatReference(resource);
    const service = chat ? CHAT_SERVICE_LABELS[resolveChatService(resource)] : "Resource";
    return {
      id: `${chat ? "chat" : "resource"}:${resource.id}`,
      label: text(resource.title) || (chat ? "無題のChat Ref" : "無題のResource"),
      keywords: [chat ? "chat" : "resource", chat ? "チャット" : "資料", service, themeName(resource.project_id), text(resource.chat_group), text(resource.url)],
      searchText: [resource.description, resource.body_markdown, resource.url, resource.chat_group].map(text).join(" "),
      category: chat ? "Knowledge / Chat" : "Resources / Artifacts",
      context: context([chat ? `Chat Ref · ${service}` : "Resource", themeName(resource.project_id), resource.chat_group, compactText(resource.body_markdown || resource.description || resource.url)]),
      target: chat
        ? { kind: "drawer", route: "chat-refs", entityType: "resource", entityId: resource.id, mode: "edit" }
        : { kind: "drawer", route: "notes", entityType: "resource", entityId: resource.id },
    };
  });

  const artifacts: RecallPaletteDescriptor[] = (data.artifacts || []).map((artifact) => ({
    id: `artifact:${artifact.id}`,
    label: text(artifact.title || artifact.filename) || "Artifact",
    keywords: ["artifact", "成果物", "ファイル", themeName(artifact.theme_id), text(artifact.media_kind || artifact.file_type)],
    searchText: [artifact.filename, artifact.stored_path, artifact.original_path, artifact.target, artifact.description].map(text).join(" "),
    category: "Resources / Artifacts",
    context: context(["Artifact", themeName(artifact.theme_id), artifact.media_kind || artifact.file_type || "File", compactText(artifact.description)]),
    target: { kind: "artifact", route: "artifacts", entityId: artifact.id },
  }));

  const themeEntries: RecallPaletteDescriptor[] = themes.map((theme) => ({
    id: `theme:${theme.id}`,
    label: text(theme.name) || "無題のTheme",
    keywords: ["theme", "テーマ", text(theme.code)],
    searchText: [theme.description, theme.group].map(text).join(" "),
    category: "Themes",
    context: context(["Theme", theme.group, compactText(theme.description)]),
    target: { kind: "theme", route: "theme", entityId: theme.id },
  }));

  return [
    ...tasks,
    ...planNodes,
    ...notes,
    ...waitings,
    ...captures,
    ...knowledge,
    ...resources,
    ...artifacts,
    ...themeEntries,
  ];
}
