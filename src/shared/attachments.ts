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

export interface ArtifactProposalMaterializeRequest {
  title: string;
  fileName: string;
  mediaType: string;
  content: string;
  themeId?: string | null;
  /** Stable candidate identity used to make retries resolve to the same managed file. */
  materializationKey?: string;
  /**
   * 同梱アセット（#789）。content中の `tasken-upload://<reference_id>` を、
   * stage済みファイルのdata URIへ差し替えてから保存する。
   */
  assets?: {
    proposalId: string;
    manifest: readonly {
      reference_id: string;
      file_name: string;
      media_type: string;
      size: number;
      sha256: string;
    }[];
  };
}

export type ArtifactProposalMaterializeResult =
  | { status: "needs_directory" }
  | { status: "ok"; directory: string; file: ImportedArtifactFile; created: boolean };
