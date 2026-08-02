export interface ImageClipboardRequest {
  dataUrl: string;
}

export interface SlideTimelineExportRequest {
  title: string;
  svg: string;
}

export interface SlideTimelineExportResult {
  canceled: boolean;
  filePath?: string;
}
