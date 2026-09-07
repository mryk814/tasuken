import type {
  NoteProposalImage,
  NoteProposalImageMediaType,
} from "../../../shared/contracts/task/public.ts";

export interface CaptureImageManifestEntry {
  reference_id: string;
  file_name: string;
  mime_type: NoteProposalImageMediaType;
  size: number;
  sha256: string;
  url: string;
}

export interface StagedCaptureImages {
  manifest: readonly CaptureImageManifestEntry[];
  /** Port-owned state used only by rollback. It is never persisted. */
  staged: unknown;
}

/** Owns managed image staging and cleanup for a mobile photo Capture or Task. */
export interface CaptureImagePort {
  stage(input: { ownerId: string; images: readonly NoteProposalImage[] }): StagedCaptureImages;
  /** Removes only files newly created by stage for this owner. */
  rollback(staged: unknown): void;
  /** Reads staged bytes for LLM handoff. Only files owned by a staged manifest are served. */
  read(fileName: string): Uint8Array;
}
