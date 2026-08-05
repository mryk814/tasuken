import {
  artifactFileTypeFromName,
  displayNameFromTarget,
  inferArtifactLinkType,
} from "../../../../../shared/artifactLinks.mjs";
import type {
  Artifact,
  ArtifactLinkStatus,
  ArtifactLinkType,
  ArtifactSourceType,
  SaveOperation,
  WorkspaceData,
} from "../types";
import { allResourceRecords } from "./domain";
import { uuid } from "./format";

export function buildManagedArtifactOperations(
  files: Array<{ filename: string; storedPath: string; originalPath: string; fileSize: number; mimeType: string; fileType: string; copiedAt?: string }>,
  sourceType: ArtifactSourceType,
  sourceId: string,
  themeId?: string | null,
): SaveOperation[] {
  const now = new Date().toISOString();
  return files.map((file) => ({
    action: "save",
    type: "artifact",
    entity: {
      id: uuid(),
      title: file.filename.replace(/\.[^.]+$/, ""),
      filename: file.filename,
      file_type: file.fileType,
      mime_type: file.mimeType,
      file_size: file.fileSize,
      stored_path: file.storedPath,
      original_path: file.originalPath,
      storage_mode: "managed",
      copied_at: file.copiedAt || now,
      source_type: sourceType,
      source_id: sourceId,
      theme_id: themeId || null,
      description: null,
      generated_by: null,
      link_type: null,
      target: null,
      link_status: null,
      last_checked_at: null,
    },
  }));
}

export function buildLinkedArtifactOperationsFromPaths(
  files: Array<{ path: string; name: string }>,
  sourceType: ArtifactSourceType,
  sourceId: string,
  themeId?: string | null,
): SaveOperation[] {
  return files.map((file) => {
    const target = file.path;
    const filename = file.name || displayNameFromTarget(target, "file");
    const linkType = inferArtifactLinkType(target) as ArtifactLinkType;
    return {
      action: "save",
      type: "artifact",
      entity: {
        id: uuid(),
        title: filename.replace(/\.[^.]+$/, ""),
        filename,
        file_type: artifactFileTypeFromName(filename),
        mime_type: undefined,
        file_size: undefined,
        stored_path: "",
        original_path: null,
        storage_mode: "linked",
        copied_at: null,
        link_type: linkType,
        target,
        link_status: "unknown" as ArtifactLinkStatus,
        last_checked_at: null,
        source_type: sourceType,
        source_id: sourceId,
        theme_id: themeId || null,
        description: null,
        generated_by: null,
      },
    };
  });
}

export function buildLinkedArtifactOperationFromUrl(
  url: string,
  sourceType: ArtifactSourceType,
  sourceId: string,
  themeId?: string | null,
): SaveOperation {
  const target = url.trim();
  const filename = displayNameFromTarget(target, "link");
  const linkType = inferArtifactLinkType(target) as ArtifactLinkType;
  return {
    action: "save",
    type: "artifact",
    entity: {
      id: uuid(),
      title: filename.replace(/\.[^.]+$/, "") || "リンク",
      filename,
      file_type: artifactFileTypeFromName(filename),
      stored_path: "",
      original_path: null,
      storage_mode: "linked",
      copied_at: null,
      link_type: linkType,
      target,
      link_status: "unknown",
      last_checked_at: null,
      source_type: sourceType,
      source_id: sourceId,
      theme_id: themeId || null,
      description: null,
      generated_by: null,
    },
  };
}

export function buildArtifactThemeSyncOperations(
  artifacts: Artifact[],
  source: { sourceTypes: ArtifactSourceType[]; sourceId: string; themeId: string | null },
): SaveOperation[] {
  if (!source.sourceId) return [];
  const nextTheme = source.themeId || null;
  return (artifacts || [])
    .filter((artifact) => (
      source.sourceTypes.includes(artifact.source_type)
      && artifact.source_id === source.sourceId
      && String(artifact.theme_id || "") !== String(nextTheme || "")
    ))
    .map((artifact) => ({
      action: "save",
      type: "artifact",
      entity: {
        ...artifact,
        theme_id: nextTheme,
      },
    }));
}

export function resolveArtifactThemeId(options: {
  sourceType: ArtifactSourceType;
  sourceId: string;
  themeId?: string | null;
  data?: WorkspaceData;
  form?: HTMLFormElement | null;
}): string | null {
  const { sourceType, sourceId, themeId, data } = options;
  const form = options.form
    || (typeof document !== "undefined"
      ? document.querySelector<HTMLFormElement>("aside.drawer form.drawer-form")
      : null);
  if (form) {
    const fieldName = sourceType === "chat_ref" ? "project_id" : "theme_id";
    const named = form.elements.namedItem(fieldName);
    const field = named && !(named instanceof RadioNodeList) && "value" in named
      ? named as { value: string }
      : null;
    if (field) {
      const fromForm = String(field.value || "").trim();
      return fromForm || null;
    }
  }
  const fromProp = String(themeId || "").trim();
  if (fromProp) return fromProp;
  if (sourceType === "theme" && sourceId) return sourceId;
  if (data) {
    if (sourceType === "task") {
      const task = (data.tasks || []).find((entry) => entry.id === sourceId);
      return String(task?.project_id || "").trim() || null;
    }
    if (sourceType === "note" || sourceType === "report") {
      const note = (data.notes || []).find((entry) => entry.id === sourceId);
      return String(note?.theme_id || "").trim() || null;
    }
    if (sourceType === "chat_ref") {
      const resource = allResourceRecords(data).find((entry) => entry.id === sourceId);
      return String(resource?.project_id || resource?.theme_id || "").trim() || null;
    }
  }
  return null;
}
