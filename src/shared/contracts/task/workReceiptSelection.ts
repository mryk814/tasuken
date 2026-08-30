import { isoTimestampSchema } from "../../kernel/public.ts";

export interface WorkReceiptSelectionKey {
  id: string;
  reportedAt: string;
  version: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function timestampEpoch(value: string): number {
  const parsed = isoTimestampSchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError("Work Receipt reportedAt must be a valid ISO 8601 timestamp.");
  }
  const epoch = Date.parse(parsed.data);
  if (!Number.isFinite(epoch)) {
    throw new TypeError("Work Receipt reportedAt must resolve to a valid instant.");
  }
  return epoch;
}

/** Canonical latest-first order: reportedAt desc, version desc, id asc. */
export function compareLatestWorkReceipts(
  left: WorkReceiptSelectionKey,
  right: WorkReceiptSelectionKey,
): number {
  return (
    timestampEpoch(right.reportedAt) - timestampEpoch(left.reportedAt) ||
    right.version - left.version ||
    compareText(left.id, right.id)
  );
}

export function selectLatestWorkReceipt<T>(
  receipts: readonly T[],
  keyOf: (receipt: T) => WorkReceiptSelectionKey,
): T | null {
  let latest: T | null = null;
  for (const receipt of receipts) {
    if (latest === null || compareLatestWorkReceipts(keyOf(receipt), keyOf(latest)) < 0) {
      latest = receipt;
    }
  }
  return latest;
}
