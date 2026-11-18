import type {
  DocumentAsset,
  DocumentAssetMediaType,
} from "../../../shared/contracts/task/public.ts";

export interface DocumentAssetManifestEntry {
  reference_id: string;
  file_name: string;
  mime_type: DocumentAssetMediaType;
  size: number;
  sha256: string;
}

export interface PreparedDocumentAssets {
  manifest: readonly DocumentAssetManifestEntry[];
  /** Port-owned state used only by stage and rollback. It is never persisted. */
  prepared: unknown;
}

/**
 * Document（#789）に同梱される画像・動画の準備と保存を担う。
 * note画像のportと同じ形：prepareで検証し、stageで受け側ノードの
 * attachments/document-assets へ決定的な名前で置き、書き込みの確定後に
 * inlineでdata URIへ差し替えてからstage済みファイルを片付ける。
 * 実データはEntityには残らず、自己完結したHTMLだけが保存される。
 */
export interface DocumentAssetPort {
  prepare(input: {
    creationId: string;
    content: string;
    assets: readonly DocumentAsset[];
  }): PreparedDocumentAssets;
  stage(prepared: unknown): void;
  /** Removes only files newly created by stage for this prepared creation. */
  rollback(prepared: unknown): void;
  /** stage済みファイルを検証し、参照をdata URIへ差し替えた自己完結HTMLを返す。 */
  inline(
    creationId: string,
    manifest: readonly DocumentAssetManifestEntry[],
    content: string,
  ): string;
  /** 保存の確定後にstage済みファイルを片付ける。 */
  discard(creationId: string, manifest: readonly DocumentAssetManifestEntry[]): void;
}
