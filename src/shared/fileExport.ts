export interface MarkdownFileExportRequest {
  title: string;
  content: string;
  directory?: string | null;
  chooseDirectory?: boolean;
  fileName?: string | null;
}

export interface MarkdownFileExportResult {
  canceled: boolean;
  filePath?: string;
  directory?: string;
  exportedAt?: string;
}
