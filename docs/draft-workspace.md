# 旧 Draft Workspace data

独立したDraft WorkspaceとNote AI UIは撤去済みである。

既存Noteの`properties_json.draft_workspace`は未知フィールドとして読込・保存時に保持する。専用表示、追記、再依頼、内蔵AI実行の経路は持たない。

外部Agentから返る新しいNote変更案は`ai_proposal`へPendingで保存し、利用者のPreview／採用後だけApplication Commandを通してNote本文とcanonical Markdownを更新する。
