# AI作業ログの週表示改善

既存DebriefのAI作業ログを改善する。PCの週／日カレンダー、Client／Repositoryフィルター、Proposal採用、Session詳細は継承する。狭い幅は日別リストにし、同時Sessionも全文の依頼とRepositoryを読んで詳細を開ける。PCの棒はRepositoryとClientを優先し、依頼全文はtooltip・アクセシブル名・詳細に残す。日見出しはSession件数を示す。

日境界・時刻・取込後の表示日はJSTで統一する。終了未確認を現在まで伸ばさず、履歴は最終観測までに制限する。実働時間・費用は未収録と表示する。日を跨ぐ詳細は両側の日付を示す。日付移動では詳細を閉じ、閉じる／Escapeでは日付とフィルターを保持する。

参考: [cc-calendar](https://github.com/atinfinity/cc-calendar/tree/609f22d8c2e44923357f44715a3eee83e35161e1) の週表示・重複レーン・詳細導線。MIT ©2026 atinfinity。コード・画像・assetsをコピーせずTaskenの既存layoutとSession契約で実装する。上流のgapによるactive time推定、未知modelの費用ゼロ、稼働推定は採用しない。上流コードをインストール・実行せず、実ログも送信しない。新adapterやOAuthは追加しない。

検証済み: 合成Sessionで未確認終了／最終観測上限／進行中／日跨ぎ／重複／JST午前0時の点を確認。既存取込テストで5 provider契約と冪等性・再開・再起動を確認。focused tests 15件、typecheck、変更ファイルのESLint、build、既存Electron smokeが成功した。1760×1024と390×844の実Electron画像を検査し、期間移動、フィルター、詳細、Escapeとfocus復帰、空、エラーを確認した。画像は `output/playwright/agent-work-logs/` に保存する。

未検証: 対話Node REPLがこのセッションにないため、指定スキルの永続セッションでのライブ対話検証は未完了。Android実機・本番配布・全体CIは今回の成功に含めない。既存smoke runnerの実画面操作と画像確認をその代替証拠として明示する。検証アプリは終了し、一時DBは削除済み。本番のPC・Fold・NAS、version draft、#546には変更しない。
