# 旧 Draft Workspace data

独立したDraft Workspace UIはIssue #314で撤去し、Notes右側の`NoteAiDrawer`へ統合した。
既存の`properties_json.draft_workspace.sources`は削除せず、Note IDに紐づく旧会話履歴としてread-only表示する。

新しいAI返答は`ai_proposal`へPendingで保存する。途中tokenは保存せず、採用時だけApplication Commandを通してNoteの`body_markdown`とcanonical Markdownを更新する。
したがってWorking Draftの正本は引き続きNote本文だけであり、旧Draftデータへ新規書込みする経路はない。
