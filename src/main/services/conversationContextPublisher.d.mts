import type fs from "node:fs";

interface PublisherBase {
  themeFolder: string;
  conversationId: string;
  themeId: string;
  relativePath: string;
  operationId: string;
  recoveryDirectory: string;
  fileSystem?: typeof fs;
}

export const CONVERSATION_CONTEXT_OPERATION_SCHEMA: "tasken-conversation-context-operation/v1";
export function inspectConversationContextFile(input: {
  themeFolder: string;
  relativePath: string;
  contentHash: string | null;
  fileSystem?: typeof fs;
}): { filePath: string; exists: boolean; current: boolean; actualHash: string | null };
export function publishConversationContextFile(input: PublisherBase & {
  content: string;
  contentHash: string;
}): { filePath: string; receiptPath: string; written: boolean };
export function removeConversationContextFile(input: PublisherBase): { filePath: string; receiptPath: string; removed: boolean };
export function completeConversationContextOperation(recoveryDirectory: string, operationId: string, options?: { fileSystem?: typeof fs }): void;
export function listConversationContextOperations(recoveryDirectory: string, options?: { fileSystem?: typeof fs }): Array<{
  receipt: null | {
    schema: string;
    operationId: string;
    action: "publish" | "remove";
    phase: "planned" | "file_written" | "file_removed";
    conversationId: string;
    themeId: string;
    relativePath: string;
    contentHash: string | null;
  };
  receiptPath: string;
  error?: string;
}>;
