export type SketchExportFormat = "png" | "svg" | "markdown";

export interface SketchExportRequest {
  format: SketchExportFormat;
  title: string;
  dataUrl: string;
  svg: string;
  markdown: string;
  themeId?: string | null;
}

export interface SketchExportResult {
  canceled: boolean;
  filePath?: string;
  companionFilePath?: string;
}
