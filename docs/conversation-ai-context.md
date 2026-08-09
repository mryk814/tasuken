# Conversation AI Context

Conversation の正本はローカル SQLite の `resource` (`resource_scope=chat_ref`) と、取り込み時に保持した raw Artifact です。取り込み、閲覧、M365 可視設定だけでは OneDrive へ出力しません。Conversation Viewer で内容を確認し、利用者が「AI Contextへ保存」を実行した場合だけ、M365 用 Markdown projection を作成します。

## 保存先と Theme AI Pack

projection は Theme ID marker (`.tasken-theme.json`) で再発見した Theme folder の `AI Context/Conversations/{first-title}-{id-short}.md` に保存します。初回 binding 後は title を変えても path を動かしません。Theme code や folder 名が変わっても、表示名ではなく marker の Theme ID で同じ folder を再発見します。

Issue #304 の候補だった `AI Pack/Conversations` は採用しません。Theme AI Pack は #295 の固定7ファイルだけを staging swapし、余分なfileを拒否する原子的 projectionです。動的な Conversation file をその配下へ置くと、検証で拒否されるか次回更新で消えるためです。固定 Pack の `03 Meetings.md` は公開済み projection の `theme:{theme-id}:AI Context/Conversations/...` 参照と要約だけを持ち、会話本文を複製しません。

## 公開契約

- schema: `tasken-conversation-context/v1`
- scope: 会話全体 (`full`) または選択した User / Assistant 発言 (`selected_turns`)
- system、tool、raw tool output、未選択発言は理由付きで除外する
- secret candidate とローカル絶対pathを含む行は本文から除外し、Previewに警告する
- source URLはhttp/httpsだけを採用し、credential、query、fragmentを落とす
- Theme、summary、freshness、authority、AI visibility、保存先、除外理由をPreviewに明示する
- `m365` visibilityがない場合、保存と更新をhard blockする。既存公開版はdirtyかつ「解除が必要」と表示し、Pack参照から外す
- 各turn、入力、最終projectionに上限を設け、超過は無言で切らずexclusionを残す

公開後に本文、title、summary、freshness、authority、visibility、scope、選択発言が変わるとdirtyになります。「公開内容を更新」で明示更新し、同じ内容の再保存はfileをrewriteせず `published_at` とmtimeを保ちます。

「AI Contextから外す」はprojection fileとTheme AI Packの参照を削除します。Conversation resource、本文、raw Artifactは変更・削除しません。file成功後にSQLite確定が失敗した場合は、Main-only recovery receiptと`operation_id`から再起動時にread-backして公開または解除を確定します。未完了file操作はfailed stateへ確定してreceiptを除去し、永久retryや古いreceiptの再適用を行いません。

## 境界

Rendererはtyped `conversationContext.preview/publish/remove` IPCだけを使います。保存先の解決、Theme marker検証、containment、symlink/junction拒否、atomic write、recoveryはMainで行います。Rendererへraw filesystem error、絶対path、秘密候補本文を返しません。
