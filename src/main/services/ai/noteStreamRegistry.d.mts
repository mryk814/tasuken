export class AiNoteStreamRegistry {
  start(requestId: string): AbortController;
  cancel(requestId: string): boolean;
  finish(requestId: string): boolean;
  has(requestId: string): boolean;
}
