import fs from "node:fs";
import path from "node:path";

import { markdownSignature } from "../../shared/canonicalMarkdown.mjs";
import { CONVERSATION_CONTEXT_DIRECTORY } from "../../shared/conversationContext.mjs";
import { writeAtomicTextFile } from "./atomicText.mjs";
import { assertSafeThemeChildPath } from "./themeAiPackPublisher.mjs";

export const CONVERSATION_CONTEXT_OPERATION_SCHEMA = "tasken-conversation-context-operation/v1";
const MAX_CONTEXT_BYTES = 512 * 1024;

function text(value) {
  return value == null ? "" : String(value).trim();
}

function assertOperationId(value) {
  const operationId = text(value);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(operationId)) throw new Error("Conversation AI Context operation IDが不正です。");
  return operationId;
}

function assertRelativePath(value) {
  const relativePath = text(value).replace(/\\/g, "/");
  if (!relativePath.startsWith(`${CONVERSATION_CONTEXT_DIRECTORY}/`) || !relativePath.toLowerCase().endsWith(".md")) {
    throw new Error("Conversation AI Contextの保存先が不正です。");
  }
  return relativePath;
}

function receiptPath(recoveryDirectory, operationId) {
  return path.join(path.resolve(recoveryDirectory), `${assertOperationId(operationId)}.json`);
}

function writeReceipt(fileSystem, recoveryDirectory, receipt) {
  fileSystem.mkdirSync(recoveryDirectory, { recursive: true });
  const target = receiptPath(recoveryDirectory, receipt.operationId);
  writeAtomicTextFile(target, `${JSON.stringify(receipt, null, 2)}\n`, `${receipt.operationId}-receipt`, fileSystem);
  return target;
}

function readReceipt(fileSystem, filePath) {
  const stat = fileSystem.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) throw new Error("Conversation AI Context recovery receiptが不正です。");
  const receipt = JSON.parse(fileSystem.readFileSync(filePath, "utf8"));
  if (receipt?.schema !== CONVERSATION_CONTEXT_OPERATION_SCHEMA
    || !["publish", "remove"].includes(receipt.action)
    || !["planned", "file_written", "file_removed"].includes(receipt.phase)
    || !/^[A-Za-z0-9_-]{1,200}$/.test(text(receipt.conversationId))
    || !/^[A-Za-z0-9_-]{1,200}$/.test(text(receipt.themeId))
    || (receipt.action === "publish" && !/^sha256:\d+:[a-f0-9]{64}$/.test(text(receipt.contentHash)))) {
    throw new Error("Conversation AI Context recovery receiptが不正です。");
  }
  assertOperationId(receipt.operationId);
  assertRelativePath(receipt.relativePath);
  return receipt;
}

function fileSignature(fileSystem, filePath) {
  try {
    const stat = fileSystem.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    if (stat.size > MAX_CONTEXT_BYTES) throw new Error("Conversation AI Contextファイルが上限を超えています。");
    return markdownSignature(fileSystem.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function safelyMatchesSignature(fileSystem, filePath, expected) {
  try { return fileSignature(fileSystem, filePath) === expected; } catch { return false; }
}

function safelyMissing(fileSystem, filePath) {
  try { return !fileSystem.existsSync(filePath); } catch { return false; }
}

export function inspectConversationContextFile({ themeFolder, relativePath, contentHash, fileSystem = fs } = {}) {
  const normalizedPath = assertRelativePath(relativePath);
  const filePath = assertSafeThemeChildPath({ themeFolder, relativePath: normalizedPath, fileSystem });
  const actualHash = fileSignature(fileSystem, filePath);
  return {
    filePath,
    exists: Boolean(actualHash),
    current: Boolean(actualHash && actualHash === text(contentHash)),
    actualHash,
  };
}

export function publishConversationContextFile({
  themeFolder,
  conversationId,
  themeId,
  relativePath,
  content,
  contentHash,
  operationId,
  recoveryDirectory,
  fileSystem = fs,
} = {}) {
  operationId = assertOperationId(operationId);
  const normalizedPath = assertRelativePath(relativePath);
  if (Buffer.byteLength(String(content), "utf8") > MAX_CONTEXT_BYTES) throw new Error("Conversation AI Context本文が上限を超えています。");
  if (markdownSignature(String(content)) !== text(contentHash)) throw new Error("Conversation AI Contextのcontent hashが一致しません。");
  let filePath = assertSafeThemeChildPath({ themeFolder, relativePath: normalizedPath, fileSystem });
  const receipt = {
    schema: CONVERSATION_CONTEXT_OPERATION_SCHEMA,
    operationId,
    action: "publish",
    phase: "planned",
    conversationId: text(conversationId),
    themeId: text(themeId),
    relativePath: normalizedPath,
    contentHash: text(contentHash),
  };
  const savedReceiptPath = writeReceipt(fileSystem, recoveryDirectory, receipt);
  try {
    const beforeHash = fileSignature(fileSystem, filePath);
    let written = false;
    if (beforeHash !== receipt.contentHash) {
      fileSystem.mkdirSync(path.dirname(filePath), { recursive: true });
      filePath = assertSafeThemeChildPath({ themeFolder, relativePath: normalizedPath, fileSystem });
      writeAtomicTextFile(filePath, String(content), operationId, fileSystem);
      written = true;
    }
    if (fileSignature(fileSystem, filePath) !== receipt.contentHash) throw new Error("Conversation AI Contextのread-back verificationに失敗しました。");
    writeReceipt(fileSystem, recoveryDirectory, { ...receipt, phase: "file_written" });
    return { filePath, receiptPath: savedReceiptPath, written };
  } catch (error) {
    if (safelyMatchesSignature(fileSystem, filePath, receipt.contentHash)) {
      writeReceipt(fileSystem, recoveryDirectory, { ...receipt, phase: "file_written" });
    } else if (fileSystem.existsSync(savedReceiptPath)) {
      fileSystem.unlinkSync(savedReceiptPath);
    }
    throw error;
  }
}

export function removeConversationContextFile({
  themeFolder,
  conversationId,
  themeId,
  relativePath,
  operationId,
  recoveryDirectory,
  fileSystem = fs,
} = {}) {
  operationId = assertOperationId(operationId);
  const normalizedPath = assertRelativePath(relativePath);
  const filePath = assertSafeThemeChildPath({ themeFolder, relativePath: normalizedPath, fileSystem });
  const receipt = {
    schema: CONVERSATION_CONTEXT_OPERATION_SCHEMA,
    operationId,
    action: "remove",
    phase: "planned",
    conversationId: text(conversationId),
    themeId: text(themeId),
    relativePath: normalizedPath,
    contentHash: null,
  };
  const savedReceiptPath = writeReceipt(fileSystem, recoveryDirectory, receipt);
  try {
    let removed = false;
    if (fileSystem.existsSync(filePath)) {
      const stat = fileSystem.lstatSync(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Conversation AI Contextの削除先が通常ファイルではありません。");
      fileSystem.unlinkSync(filePath);
      removed = true;
    }
    if (fileSystem.existsSync(filePath)) throw new Error("Conversation AI Contextを削除できませんでした。");
    writeReceipt(fileSystem, recoveryDirectory, { ...receipt, phase: "file_removed" });
    return { filePath, receiptPath: savedReceiptPath, removed };
  } catch (error) {
    if (safelyMissing(fileSystem, filePath)) {
      writeReceipt(fileSystem, recoveryDirectory, { ...receipt, phase: "file_removed" });
    } else if (fileSystem.existsSync(savedReceiptPath)) {
      fileSystem.unlinkSync(savedReceiptPath);
    }
    throw error;
  }
}

export function completeConversationContextOperation(recoveryDirectory, operationId, { fileSystem = fs } = {}) {
  const target = receiptPath(recoveryDirectory, operationId);
  if (fileSystem.existsSync(target)) fileSystem.unlinkSync(target);
}

export function listConversationContextOperations(recoveryDirectory, { fileSystem = fs } = {}) {
  if (!fileSystem.existsSync(recoveryDirectory)) return [];
  const root = path.resolve(recoveryDirectory);
  const rootStat = fileSystem.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    return [{ receipt: null, receiptPath: root, error: "Conversation AI Context recovery directoryが不正です。" }];
  }
  const results = [];
  for (const name of fileSystem.readdirSync(root).filter((entry) => entry.endsWith(".json")).sort()) {
    const filePath = path.join(root, name);
    try {
      const receipt = readReceipt(fileSystem, filePath);
      if (path.basename(filePath, ".json") !== assertOperationId(receipt.operationId)) throw new Error("receipt名がoperation IDと一致しません。");
      results.push({ receipt, receiptPath: filePath });
    } catch (error) {
      results.push({ receipt: null, receiptPath: filePath, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
