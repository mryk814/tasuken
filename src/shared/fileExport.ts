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

export interface MarkdownPdfExportRequest {
  title: string;
  html: string;
  directory?: string | null;
  chooseDirectory?: boolean;
  fileName?: string | null;
}

export interface MarkdownPdfExportResult {
  canceled: boolean;
  filePath?: string;
  directory?: string;
  exportedAt?: string;
}
