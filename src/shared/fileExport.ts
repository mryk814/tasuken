export interface MarkdownFileExportRequest {
  title: string;
  content: string;
  directory?: string | null;
  chooseDirectory?: boolean;
  fileName?: string | null;
  /** 既定フォルダ解決用。Note の Theme に合わせて Notes/ へ書く */
  themeId?: string | null;
}

export interface MarkdownFileExportResult {
  canceled: boolean;
  filePath?: string;
  directory?: string;
  exportedAt?: string;
}

/** Markdown本文の変更検知用。Document Publish の再出力判定に使う。 */
export function noteExportSignature(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export interface MarkdownPdfExportRequest {
  title: string;
  html: string;
  directory?: string | null;
  chooseDirectory?: boolean;
  fileName?: string | null;
  /** ダイアログ初期フォルダ用。Theme の Exports/ を候補にする */
  themeId?: string | null;
}

export interface MarkdownPdfExportResult {
  canceled: boolean;
  filePath?: string;
  directory?: string;
  exportedAt?: string;
  /** 画像欠落など、出力はできたが確認すべき点 */
  warnings?: string[];
}
