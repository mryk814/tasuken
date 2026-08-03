import { useState } from "react";
import { IconSparkles } from "@tabler/icons-react";

import type { AiNoteMode, AiNoteScope } from "../../../../../shared/ai";
import { workspaceApi } from "../../../services/workspaceApi";
import type { BaseRecord, PageProps, SaveEntity } from "../types";
import { str, uuid } from "../lib/format";

export interface NoteAiTarget {
  scope: AiNoteScope;
  start?: number;
  end?: number;
  text?: string;
}

export function NoteAiDialog({ note, body, target, saveEntity, setToast, onClose }: {
  note: BaseRecord;
  body: string;
  target: NoteAiTarget;
  saveEntity: SaveEntity;
  setToast: PageProps["setToast"];
  onClose: () => void;
}) {
  const [mode, setMode] = useState<AiNoteMode>("rewrite");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);

  async function createProposal() {
    setBusy(true);
    try {
      const result = await workspaceApi.generateNoteWithAi({
        mode,
        scope: target.scope,
        title: str(note.title),
        body,
        instruction,
        selection: target.scope === "selection"
          ? { start: target.start!, end: target.end!, text: target.text! }
          : undefined,
      });
      await saveEntity("ai_proposal", {
        id: uuid(),
        source: "embedded_llm",
        source_app: `${result.provider}:${result.model}`,
        payload_type: "notes",
        status: "pending",
        payload: {
          notes: [{
            action: "merge",
            target_id: note.id,
            base_version: Number(note.version) || 1,
            title: str(note.title) || "無題",
            body: result.proposedBody,
            reason: instruction.trim(),
          }],
        },
        request: {
          mode,
          scope: target.scope,
          target: { type: "note", id: note.id, base_version: Number(note.version) || 1 },
        },
      }, { source: "embedded_llm" });
      setToast("AIの返答をPending Proposalへ追加しました。AI連携で差分を選んで採用できます。", "success");
      onClose();
    } catch (error) {
      setToast(`AI編集を実行できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-card note-ai-dialog" role="dialog" aria-modal="true" aria-label="NoteをAIで編集">
        <div className="section-heading">
          <h2><IconSparkles size={18} />Note AI</h2>
          <span>{target.scope === "selection" ? "選択範囲" : "文書全体"}</span>
        </div>
        <div className="segmented" aria-label="AI編集モード">
          <button className={mode === "rewrite" ? "is-active" : ""} onClick={() => setMode("rewrite")}>書き換え</button>
          <button className={mode === "continue" ? "is-active" : ""} onClick={() => setMode("continue")}>続きを書く</button>
          <button className={mode === "chat" ? "is-active" : ""} onClick={() => setMode("chat")}>相談して編集</button>
        </div>
        {target.scope === "selection" && <blockquote className="note-ai-selection">{target.text}</blockquote>}
        <label>指示
          <textarea
            autoFocus
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder={mode === "continue" ? "次に扱う内容、長さ、文体…" : "残したい内容と変えたい点…"}
          />
        </label>
        <p className="field-help">Noteは直接変更しません。生成結果をProposalとして保存し、差分確認後に採用します。</p>
        <div className="form-actions">
          <button className="secondary-button" disabled={busy} onClick={onClose}>閉じる</button>
          <button className="primary-button" disabled={busy || !instruction.trim()} onClick={createProposal}>
            {busy ? "生成中" : "Proposalを作る"}
          </button>
        </div>
      </section>
    </div>
  );
}
