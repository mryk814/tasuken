import type { DocumentAssetPort } from "./documentAssetPort.ts";

export interface WrittenDocumentFile {
  filename: string;
  size: number;
  created: boolean;
}

/**
 * Document（#789）の直接作成が、保存の実務として境界の外へ頼むもの。
 * EntityとChange Eventの保存はAiItemCreationServiceと同じく、このportではなく
 * Core serviceへ渡るpersistence（transaction）が担う。ここはファイル実体と
 * 同梱アセットだけを受け持つ。
 */
export interface AiDocumentCreationPort {
  /** 同梱アセットの検証・stage・インライン化。アセットを受けない配備では省略できる。 */
  assets?: DocumentAssetPort;
  /**
   * 自己完結したHTMLを管理ファイルとして書く。materializationKeyから決定的な
   * 名前を作り、再送は同じ内容へ収束させる（Artifactのmaterializeと同じ規律）。
   */
  writeFile(input: {
    fileName: string;
    content: string;
    materializationKey: string;
  }): WrittenDocumentFile;
  /** 作成の巻き戻しで、今回書いたファイルを消す。無くても失敗にしない。 */
  removeFile(filename: string): void;
  /** 保存が確定した後の画面の更新など。失敗しても保存は覆らない。 */
  onCommitted?: () => void;
}
