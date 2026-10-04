# AI作業ログの週表示改善

既存DebriefのAI作業ログを改善する。PCの週／日カレンダー、Client／Repositoryフィルター、Proposal採用、Session詳細は継承する。狭い幅は日別リストにし、同時Sessionも依頼・成果要約・Repositoryを読んで詳細を開ける。PCの棒はClientと依頼を優先し、Repositoryと全文はtooltip・詳細に残す。日見出しはSession件数を示す。詳細では変更対象・判断・次の提案・関連Task/Work Receipt/外部参照を必要時に展開できる。Client・Agent・Modelの記録は収録範囲へ分ける。

日境界・時刻・取込後の表示日はJSTで統一する。終了未確認を現在まで伸ばさず、履歴は最終観測までに制限する。実働時間・費用は未収録と表示する。日を跨ぐ詳細は両側の日付を示す。日付移動では詳細を閉じ、閉じる／Escapeでは日付とフィルターを保持する。

参考: [cc-calendar](https://github.com/atinfinity/cc-calendar/tree/609f22d8c2e44923357f44715a3eee83e35161e1) の週表示・重複レーン・詳細導線。MIT ©2026 atinfinity。コード・画像・assetsをコピーせずTaskenの既存layoutとSession契約で実装する。上流のgapによるactive time推定、未知modelの費用ゼロ、稼働推定は採用しない。上流コードをインストール・実行せず、実ログも送信しない。新adapterやOAuthは追加しない。

検証済み: 合成Sessionで未確認終了／最終観測上限／進行中／日跨ぎ／重複／JST午前0時の点と成果詳細を確認。既存取込テストで5 provider契約と冪等性・再開・再起動を確認。時間表示9件とarchitecture audit 18件、typecheck、変更ファイルESLint、build、既存Electron smokeが成功した。1760×1024と390×844の実Electron画像を検査し、期間移動、フィルター、詳細、成果展開、関連Taskを開く／閉じる、Escapeとfocus復帰、空、エラーを確認した。画像は `output/playwright/agent-work-logs/` に保存する。

残る境界: 現行履歴adapterは依頼と回答の文章を取り込み、構造化commit/PRを新たに抽出しない。変更対象が記録されていれば表示し、外部成果へのリンクは関連Work Receiptの既存external_referencesにある場合に表示する。ないリンク・費用・実働時間を作らない。

未検証: 永続Node REPLがこのセッションにないため、指定スキルの永続対話セッションは未検証。既存smokeの実操作と画像確認は実施済み。Android実機・本番配布は未検証。ユーザーが試す隔離合成デモの候補ウィンドウはPC上で表示し、通常版と保存先を分けた。本番PC・Fold・NAS、version draft、#546には変更しない。最初のCIのarchitecture consumer増加は、既存モジュール／テストへの集約で修正し、監査の例外は追加しなかった。
