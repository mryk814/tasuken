# Taskボードと課題のやり取り

ToDoの一覧とボードは同じTaskと同じ絞り込み条件を使う。
列は既存の `Task.state`（未着手・進行中・待ち・確認待ち・完了・中止）。列用の別状態は保存しない。
カードの「Task状態」からキーボードでも変更でき、完了は既存の繰返しTask生成経路を使う。
表示方法は既存 `todo.preferences` に保存し、旧設定は一覧を維持する。

カードの「次」は `deriveAgentWorkState` と正式Task状態から導出する。
AIの開始待ち・質問・回答済み／再開待ち・成果確認は、ボード列とは別に表示する。
報告採用ではTaskは継続する。採用済みの「Taskを完了」は利用者の別操作。

Task詳細には依頼、質問への返答、報告採用、修正依頼、作業報告、人の返答、Feed投稿への会話がまとまる。
進捗追記と検証・成果物参照は詳細展開する。AIへの依頼準備・任せ直しは既存 `TaskHandoffPanel`、成果物の管理は既存Artifact導線を再利用する。

質問には `ReplyToAgentRequest`、報告採用には `ApplyTaskWorkProposal` または `AcceptTaskWork`、修正依頼には `ReturnTaskWork` を使う。
未採用報告への修正依頼は現在のattemptの成果確認だけを許可し、過去の報告や進捗報告、完了済みTaskには許可しない。
通常コメントはTask参照を持つFeed投稿とFeed返信へ保存する。コメントでTask状態やAIの要対応は変わらない。
保存失敗時は途中入力を保持し、実行中は二重操作を抑止する。

AI作成由来・未確認表示と隔離previewは [task-board-ai-integration.md](task-board-ai-integration.md) を参照。
