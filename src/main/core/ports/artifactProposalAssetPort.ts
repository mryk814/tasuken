import type {
  ArtifactProposalAsset,
  ArtifactProposalAssetMediaType,
} from "../../../shared/contracts/task/public.ts";

export interface ArtifactProposalAssetManifestEntry {
  reference_id: string;
  file_name: string;
  mime_type: ArtifactProposalAssetMediaType;
  size: number;
  sha256: string;
}

export interface PreparedArtifactProposalAssets {
  manifest: readonly ArtifactProposalAssetManifestEntry[];
  /** Port-owned state used only by stage and rollback. It is never persisted. */
  prepared: unknown;
}

/**
 * HTML Artifact提案に同梱される画像・動画の準備と保存を担う（#789）。
 * note画像のportと同じ形：prepareで検証し、stageで受け側ノードの
 * attachments/artifact-assets へ決定的な名前で置く。実データはProposalの
 * 正本（payload）には残らず、manifestだけが残る。
 */
export interface ArtifactProposalAssetPort {
  prepare(input: {
    proposalId: string;
    content: string;
    assets: readonly ArtifactProposalAsset[];
  }): PreparedArtifactProposalAssets;
  stage(prepared: unknown): void;
  /** Removes only files newly created by stage for this prepared proposal. */
  rollback(prepared: unknown): void;
}
