import type { MemoStickySaveRequest } from "../shared/ipc/contracts";
import type { Entity, EntityType } from "../shared/types/workspace";

export interface MemoStickySaveTransaction {
  get: (type: EntityType, id: string, includeDeleted?: boolean) => Entity | null;
  save: (type: EntityType, entity: Entity, options?: Record<string, unknown>) => Entity;
}

export type MemoStickySaveOutcome = {
  status: "saved" | "conflict";
  entity: Entity;
  request: MemoStickySaveRequest;
};

const SAVE_REQUEST_KEYS = ["editRevision", "expectedVersion", "saveRequestId", "text"] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeMemoStickySaveRequest(value: unknown): MemoStickySaveRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("付箋メモの保存要求が不正です。画面を再読み込みしてください。");
  }
  const request = value as Record<string, unknown>;
  const keys = Object.keys(request).sort();
  if (keys.length !== SAVE_REQUEST_KEYS.length
    || keys.some((key, index) => key !== SAVE_REQUEST_KEYS[index])
    || typeof request.text !== "string"
    || !Number.isSafeInteger(request.editRevision) || Number(request.editRevision) < 1
    || !Number.isSafeInteger(request.expectedVersion) || Number(request.expectedVersion) < 0
    || typeof request.saveRequestId !== "string"
    || !UUID_PATTERN.test(request.saveRequestId)) {
    throw new Error("付箋メモの保存要求が不正です。画面を再読み込みしてください。");
  }
  return request as unknown as MemoStickySaveRequest;
}

/** Read/version-check/write must be called inside one repository transaction. */
export function saveMemoStickyWithinTransaction(
  transaction: MemoStickySaveTransaction,
  memoId: string,
  value: unknown,
): MemoStickySaveOutcome {
  const request = normalizeMemoStickySaveRequest(value);
  const memo = transaction.get("capture_entry", memoId) as Entity | null;
  if (!memo || memo.kind !== "micro_memo" || memo.state === "archived" || memo.deleted_at) {
    throw new Error("メモが見つかりません。");
  }
  if (Number(memo.version || 0) !== request.expectedVersion) {
    return { status: "conflict", entity: memo, request };
  }
  const entity = transaction.save(
    "capture_entry",
    { ...memo, text: request.text },
    { source: "memo-sticky" },
  ) as Entity;
  return { status: "saved", entity, request };
}
