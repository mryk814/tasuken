import * as z from "zod/v4";

/**
 * Taskを外部agentへ任せる（Handoff）ときの契約（#598）。
 *
 * Handoffは**Taskの正本を変えない**。委任先と依頼内容をTaskへ記録するだけで、
 * Taskの本文・完了条件・ownerはそのまま残る。
 * 正本の判断は `docs/agent-collaboration.md`、手順は `docs/external-ai-integration.md`。
 */

/** 任せる相手。初回は外部AIという一般指定を許し、モデル設定を要求しない。 */
export const handoffDelegateSchema = z.enum(["external_ai", "codex", "claude_code", "other"]);

export type HandoffDelegate = z.output<typeof handoffDelegateSchema>;

export const HANDOFF_DELEGATE_LABELS: Record<HandoffDelegate, string> = {
  external_ai: "外部AI",
  codex: "Codex",
  claude_code: "Claude Code",
  other: "その他",
};

/**
 * Context Previewが指す参照版。
 *
 * 「コピーする依頼」と「Previewで確認した内容」が同じ対象・同じ参照版を指すことを、
 * 画面が比較できるようにする。**新しい記録ではない**。previewから毎回導出する。
 */
export function handoffContextRef(preview: unknown): string {
  const value = preview && typeof preview === "object" ? (preview as Record<string, unknown>) : {};
  const seed =
    value.seed && typeof value.seed === "object" ? (value.seed as Record<string, unknown>) : null;
  const included = Array.isArray(value.included) ? value.included : [];
  const refs = included
    .map((entry) => {
      const item = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      const ref =
        item.ref && typeof item.ref === "object" ? (item.ref as Record<string, unknown>) : null;
      if (!ref) return null;
      const type = typeof ref.type === "string" ? ref.type : "";
      const id = typeof ref.id === "string" ? ref.id : "";
      if (!type || !id) return null;
      return `${type}:${id}`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .sort();
  const truncation =
    value.truncation && typeof value.truncation === "object"
      ? (value.truncation as Record<string, unknown>)
      : {};
  const parts = [
    `seed=${seed ? `${String(seed.type)}:${String(seed.id)}` : "none"}`,
    `included=${refs.length}`,
    `truncated=${truncation.truncated === true ? "yes" : "no"}`,
    ...refs,
  ];
  return parts.join("|").slice(0, 2000);
}

/**
 * 参照版が一致するか。Previewのあとに対象や関連資料が変わっていれば false になる。
 * 画面はこの結果で「再確認してください」を出す。
 */
export function isSameHandoffContextRef(
  previous: string | null | undefined,
  current: string,
): boolean {
  return Boolean(previous) && previous === current;
}

/** Previewの差分を、画面に出せる短い説明へ変える。 */
export function describeHandoffContextChange(previous: string, current: string): string {
  // 先頭は見出し（seed / included / truncated）、以降が実体の参照。
  const HEADER = /^(seed=|included=|truncated=)/;
  const parse = (value: string) => {
    const parts = value.split("|");
    return { head: parts[0] || "", refs: new Set(parts.filter((part) => !HEADER.test(part))) };
  };
  const before = parse(previous);
  const after = parse(current);
  const added = [...after.refs].filter((ref) => !before.refs.has(ref));
  const removed = [...before.refs].filter((ref) => !after.refs.has(ref));
  if (before.head !== after.head && !added.length && !removed.length) {
    return "Contextの範囲が変わりました。";
  }
  const parts: string[] = [];
  if (added.length) parts.push(`追加 ${added.length}件`);
  if (removed.length) parts.push(`削除 ${removed.length}件`);
  return parts.length
    ? `Contextが更新されました（${parts.join("／")}）。`
    : "Contextが更新されました。";
}
