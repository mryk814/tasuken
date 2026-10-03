import { useState } from "react";
import { workspaceApi } from "../../../services/workspaceApi";

type CreationEntity = { id?: unknown; ai_creation?: unknown; ai_seen_at?: unknown };

export function AiCreationMark({
  entity,
  detail = false,
  type,
}: {
  entity: CreationEntity;
  detail?: boolean;
  type?: string;
}) {
  const origin =
    entity.ai_creation && typeof entity.ai_creation === "object"
      ? (entity.ai_creation as Record<string, unknown>)
      : null;
  const [seen, setSeen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (origin?.schema !== "tasken-ai-creation/v1") return null;
  const seenAt = seen || entity.ai_seen_at;
  async function markSeen() {
    if (type !== "task" && type !== "note") return;
    setSaving(true);
    setError("");
    try {
      const saved = await workspaceApi.markAiItemSeen(type, String(entity.id));
      setSeen(String(saved.ai_seen_at));
    } catch {
      setError("確認状態を保存できませんでした。もう一度お試しください。");
    } finally {
      setSaving(false);
    }
  }
  return (
    <span className={detail ? "ai-creation-detail" : "ai-creation-marks"}>
      <span className="ai-creation-tag">AI作成</span>
      {!seenAt && <span className="ai-creation-tag is-unseen">未確認</span>}
      {detail && (
        <>
          <span>
            {String(origin.caller)} · {String(origin.received_at).slice(0, 10)}
          </span>
          {origin.reason && <span className="ai-creation-reason">{String(origin.reason)}</span>}
          {!seenAt && (type === "task" || type === "note") && (
            <button
              type="button"
              className="text-button compact"
              disabled={saving}
              onClick={() => void markSeen()}
            >
              {saving ? "保存中…" : "見た"}
            </button>
          )}
          {seenAt && <span>既読（内容の正確さの確認とは別です）</span>}
          {error && <span role="alert">{error}</span>}
        </>
      )}
    </span>
  );
}
