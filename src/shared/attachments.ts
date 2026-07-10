export interface MarkdownImageAttachmentRequest {
  fileName: string;
  mimeType: string;
  dataUrl: string;
}

export interface MarkdownImageAttachmentResult {
  id: string;
  fileName: string;
  mimeType: string;
  url: string;
}

export interface ArtifactFileImportRequest {
  files: Array<{ path: string; name?: string }>;
  /** Theme に紐づく managed 保存先を決める（未指定は Inbox） */
  themeId?: string | null;
}

export interface ImportedArtifactFile {
  filename: string;
  storedPath: string;
  originalPath: string;
  fileSize: number;
  mimeType: string;
  fileType: string;
  copiedAt?: string;
  storageMode?: "managed";
}

export type ArtifactFileImportResult =
  | { status: "needs_directory" }
  | { status: "ok"; directory: string; files: ImportedArtifactFile[] };
