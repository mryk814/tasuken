# AI作成とTaskボードの統合

明示的なcreate-only経路で作成した本人用Task/Noteを、既存一覧・ボード・課題会話で扱う。
AI作成由来はアイコン、未確認は小さな点で示し、タップ／クリック／キーボードで作成元と状態を読む。
「見た」は既読metadataだけを保存し、Task完了やAI報告の採用とは分ける。

課題の正本は既存Task/Proposal/WorkReceipt/Feed。依頼・質問・返答・成果報告・修正依頼と人の会話を同じ課題から扱う。
AI作成Taskは本人実行・未委任で始まり、利用者が既存の依頼操作でAIへ渡す。

`scripts/task-handoff-audit.mjs --task-board --integrated` は実Core作成、一覧/ボードの同じID、既読保存、競合時の返答保持、報告採用後のTask継続、2つの隔離DB間の共有folder同期、Electron再起動を確認する。
ソースからの再生成と隔離previewは [task-board-ci-integration.md](task-board-ci-integration.md) を参照。
