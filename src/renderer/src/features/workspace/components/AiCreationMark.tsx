import { useId, useRef, useState } from "react";
import { workspaceApi } from "../../../services/workspaceApi";
import { SEMANTIC_ICONS } from "../../../pages/semanticIcons";

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
  const explanationId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  if (origin?.schema !== "tasken-ai-creation/v1") return null;
  const seenAt = seen || entity.ai_seen_at;
  const label = `AI作成 · ${seenAt ? "既読" : "未確認"}`;
  const OriginIcon = SEMANTIC_ICONS.aiGenerated;
  async function markSeen() {
    if (type !== "task" && type !== "note") return;
    setSaving(true);
    setError("");
    try {
      const saved = await workspaceApi.markAiItemSeen(type, String(entity.id));
      setSeen(String(saved.ai_seen_at));
      trigger.current?.focus();
    } catch {
      setError("確認状態を保存できませんでした。もう一度お試しください。");
    } finally {
      setSaving(false);
    }
  }
  return (
    <span
      className="ai-creation-marks"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape" && event.currentTarget.querySelector(":popover-open")) {
          event.stopPropagation();
        }
      }}
    >
      <button
        type="button"
        className="ai-creation-mark"
        ref={trigger}
        aria-label={`${label}。作成元を表示`}
        title={label}
        popoverTarget={explanationId}
      >
        <OriginIcon aria-hidden="true" />
        {!seenAt && <span className="ai-creation-dot" aria-hidden="true" />}
      </button>
      <span id={explanationId} popover="auto" className="ai-creation-explanation">
        <strong>{label}</strong>
        <span className="ai-creation-source">
          {String(origin.caller)} · {String(origin.received_at).slice(0, 10)}
        </span>
        {Boolean(origin.reason) && (
          <span className="ai-creation-reason">{String(origin.reason)}</span>
        )}
        {detail && !seenAt && (type === "task" || type === "note") && (
          <button
            type="button"
            className="text-button compact"
            disabled={saving}
            onClick={() => void markSeen()}
          >
            {saving ? "保存中…" : "見た"}
          </button>
        )}
        <span className="ai-creation-reason">既読は内容の正確さの確認やTask完了とは別です。</span>
        {error && <span role="alert">{error}</span>}
      </span>
    </span>
  );
}
