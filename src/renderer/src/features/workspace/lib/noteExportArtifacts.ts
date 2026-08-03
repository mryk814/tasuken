import { artifactFileTypeFromName, displayNameFromTarget, inferArtifactLinkType } from "../../../../../shared/artifactLinks.mjs";
import type { Resource } from "../domain-model/types";
import type { Artifact, BaseRecord, SaveOperation } from "../types";
import { isChatReference } from "./chatRefs";
import { str, uuid } from "./format";

export type ChatRefRecord = Resource & BaseRecord;
export type NoteExportFormat = "markdown" | "pdf";
export type NoteExportStorageMode = "managed" | "linked";

export interface NoteDocumentExport {
  id: string;
  format: NoteExportFormat;
  filePath: string;
  directory: string;
  exportedAt: string;
  storageMode: NoteExportStorageMode;
  noteId: string;
  noteTitle: string;
  themeId: string | null;
}

const NOTE_EXPORT_HISTORY_LIMIT = 12;

function propertiesOf(note: BaseRecord): Record<string, unknown> {
  const value = note.properties_json;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeExport(value: unknown, note: BaseRecord): NoteDocumentExport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  const format = str(entry.format) === "pdf" ? "pdf" : "markdown";
  const filePath = str(entry.filePath);
  if (!filePath) return null;
  return {
    id: str(entry.id) || `${str(note.id)}:${format}:${filePath}`,
    format,
    filePath,
    directory: str(entry.directory),
    exportedAt: str(entry.exportedAt),
    storageMode: str(entry.storageMode) === "managed" ? "managed" : "linked",
    noteId: str(note.id),
    noteTitle: str(note.title) || "無題のNote",
    themeId: str(note.theme_id || note.project_id) || null,
  };
}

export function noteDocumentExports(note: BaseRecord): NoteDocumentExport[] {
  const properties = propertiesOf(note);
  const stored = Array.isArray(properties.document_exports)
    ? properties.document_exports.map((entry) => normalizeExport(entry, note)).filter(Boolean) as NoteDocumentExport[]
    : [];
  const markdownExport = normalizeExport({
    ...(properties.markdown_export && typeof properties.markdown_export === "object"
      ? properties.markdown_export as Record<string, unknown>
      : {}),
    format: "markdown",
    storageMode: str(
      properties.markdown_export && typeof properties.markdown_export === "object"
        ? (properties.markdown_export as Record<string, unknown>).storageMode
        : "",
    ) === "linked"
      ? "linked"
      : "managed",
  }, note);
  const byTarget = new Map<string, NoteDocumentExport>();
  for (const entry of [...stored, ...(markdownExport ? [markdownExport] : [])]) {
    const key = `${entry.format}:${entry.filePath.toLocaleLowerCase()}`;
    if (!byTarget.has(key)) byTarget.set(key, entry);
  }
  return [...byTarget.values()].sort((left, right) => right.exportedAt.localeCompare(left.exportedAt));
}

export function createNoteDocumentExport(
  note: BaseRecord,
  entry: Omit<NoteDocumentExport, "id" | "noteId" | "noteTitle" | "themeId">,
): NoteDocumentExport {
  return {
    ...entry,
    id: uuid(),
    noteId: str(note.id),
    noteTitle: str(note.title) || "無題のNote",
    themeId: str(note.theme_id || note.project_id) || null,
  };
}

export function withNoteDocumentExport(
  properties: Record<string, unknown>,
  next: NoteDocumentExport,
): Record<string, unknown> {
  const previous = Array.isArray(properties.document_exports)
    ? properties.document_exports
    : [];
  const normalizedTarget = next.filePath.toLocaleLowerCase();
  return {
    ...properties,
    document_exports: [
      next,
      ...previous.filter((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        return str((value as Record<string, unknown>).filePath).toLocaleLowerCase() !== normalizedTarget;
      }),
    ].slice(0, NOTE_EXPORT_HISTORY_LIMIT),
  };
}

export function listRecentNoteExports(notes: BaseRecord[]): NoteDocumentExport[] {
  return notes
    .flatMap((note) => noteDocumentExports(note))
    .sort((left, right) => right.exportedAt.localeCompare(left.exportedAt));
}

function draftChatUrls(note: BaseRecord): Set<string> {
  const workspace = propertiesOf(note).draft_workspace;
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) return new Set();
  const sources = Array.isArray((workspace as Record<string, unknown>).sources)
    ? (workspace as Record<string, unknown>).sources as unknown[]
    : [];
  return new Set(sources.flatMap((source) => (
    source && typeof source === "object" && !Array.isArray(source)
      ? [str((source as Record<string, unknown>).chat_url)]
      : []
  )).filter(Boolean));
}

export function rankChatRefsForNote(
  resources: ChatRefRecord[],
  note: BaseRecord,
  artifacts: Artifact[],
): ChatRefRecord[] {
  const relatedIds = new Set(artifacts
    .filter((artifact) => artifact.origin_note_id === note.id && artifact.source_type === "chat_ref")
    .map((artifact) => artifact.source_id));
  const sourceUrls = draftChatUrls(note);
  const themeId = str(note.theme_id || note.project_id);
  const score = (resource: ChatRefRecord): number => (
    (relatedIds.has(resource.id) ? 1_000 : 0)
    + (sourceUrls.has(str(resource.url)) ? 500 : 0)
    + (themeId && str(resource.project_id || resource.theme_id) === themeId ? 100 : 0)
  );
  return resources
    .filter(isChatReference)
    .sort((left, right) => (
      score(right) - score(left)
      || str(right.updated_at || right.created_at).localeCompare(str(left.updated_at || left.created_at))
      || str(left.title).localeCompare(str(right.title), "ja-JP")
    ));
}

function normalizedTarget(value: string): string {
  return value.trim().replace(/\//g, "\\").toLocaleLowerCase();
}

export function buildNoteExportArtifactOperation(options: {
  exported: NoteDocumentExport;
  chatRef: ChatRefRecord;
  artifacts: Artifact[];
}): { operation: SaveOperation; reused: boolean } {
  const { exported, chatRef, artifacts } = options;
  const targetKey = normalizedTarget(exported.filePath);
  const existing = artifacts.find((artifact) => (
    artifact.source_type === "chat_ref"
    && artifact.source_id === chatRef.id
    && artifact.origin_note_id === exported.noteId
    && normalizedTarget(str(artifact.stored_path || artifact.target)) === targetKey
  ));
  const filename = displayNameFromTarget(exported.filePath, `${exported.noteTitle}.${exported.format === "pdf" ? "pdf" : "md"}`);
  const managed = exported.storageMode === "managed";
  const exportedAt = exported.exportedAt || new Date().toISOString();
  return {
    reused: Boolean(existing),
    operation: {
      action: "save",
      type: "artifact",
      entity: {
        ...(existing || {}),
        id: existing?.id || uuid(),
        title: filename.replace(/\.[^.]+$/, "") || exported.noteTitle,
        filename,
        file_type: artifactFileTypeFromName(filename),
        stored_path: managed ? exported.filePath : "",
        original_path: null,
        storage_mode: exported.storageMode,
        copied_at: managed ? exportedAt : null,
        link_type: managed ? null : inferArtifactLinkType(exported.filePath),
        target: managed ? null : exported.filePath,
        link_status: managed ? null : "unknown",
        last_checked_at: null,
        source_type: "chat_ref",
        source_id: chatRef.id,
        theme_id: exported.themeId || str(chatRef.project_id || chatRef.theme_id) || null,
        description: `Note「${exported.noteTitle}」から${exported.format === "pdf" ? "PDF" : "Markdown"}出力`,
        generated_by: "manual",
        origin_note_id: exported.noteId,
        origin_note_title: exported.noteTitle,
        export_format: exported.format,
        exported_at: exportedAt,
      },
    },
  };
}
