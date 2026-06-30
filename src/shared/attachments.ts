export interface MarkdownImageAttachmentRequest {
  fileName: string;
  mimeType: string;
  dataUrl: string;
}

export interface MarkdownImageAttachmentResult {
  id: string;
  fileName: string;
  mimeType: string;
  url: string;
}
