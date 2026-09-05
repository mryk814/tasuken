import type {
  NoteProposalImage,
  NoteProposalImageMediaType,
} from "../../../shared/contracts/task/public.ts";

export interface NoteProposalImageManifestEntry {
  reference_id: string;
  file_name: string;
  mime_type: NoteProposalImageMediaType;
  size: number;
  sha256: string;
  url: string;
}

export interface PreparedNoteProposalImages {
  body: string;
  manifest: readonly NoteProposalImageManifestEntry[];
  /** Port-owned state used only by stage and rollback. It is never persisted. */
  prepared: unknown;
}

/** Owns managed image preparation and cleanup for a note-create Proposal. */
export interface NoteProposalImagePort {
  prepare(input: {
    proposalId: string;
    body: string;
    images: readonly NoteProposalImage[];
  }): PreparedNoteProposalImages;
  stage(prepared: unknown): void;
  /** Removes only files newly created by stage for this prepared proposal. */
  rollback(prepared: unknown): void;
}
