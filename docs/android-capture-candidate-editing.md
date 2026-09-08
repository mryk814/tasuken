# Androidの複数Task整理案の編集

#554。AI整理で返された最大8件の候補を、候補番号から選んで同じ欄で編集する。
タイトル、Theme、開始・期限、期間の意味、対応するDesktopが提案した予定時刻・所要時間、Checklist、補足を扱う。
候補別のwarning、原文、追加対象数、除外数を表示する。

除外は候補の削除ではなく、ローカル整理案の `excluded` フラグで保持する。
先頭候補も除外・復帰でき、全件除外時には追加できない。
除外中の不完全な入力はほかの候補の保存を妨げない。
原文と候補順を保持し、従来の `draftId` / `draftId:task:index` から生成するTask・command・request IDを変えない。
同じ内容の再試行で重複を作らない。

追加操作は既存のRoom transactionで対象候補をすべてローカル保存してから成功を返す。
保存エラーではdraftを保持する。
各TaskのDesktop同期は個別に行われ、クラウドへの全件同時保存は保証しない。
正式データへAIが自動採用する処理や、整理API・Room schemaの変更はない。

既存draftの `excluded` 欠落はfalseとして読み込む。
編集途中の日付などもDraftStoreとActivityの保存状態へ残す。
整理中に入力が変わった場合は従来のrequest番号とdraft一致判定で古い応答を破棄する。

## 回帰確認

- `MobileCaptureDraftOrganizationTest`: 8候補、長い原文、先頭除外、全除外、復帰、Activity保存状態と保存ID。
- `TodayViewModelTest`: 全除外が保存へ到達しないこと。
- `CaptureOrganizationUiTest`: 共通editorの全項目、切替、日付エラー、原文、追加前の除外、遅延応答。
- `MobileCaptureDraftStoreTest`: 新しいstoreインスタンスで候補別編集・除外・IDを復元。
- `MobileOutboxDatabaseTest`: 後続候補の編集mapping、一括保存の途中失敗と再試行、重複防止。
- `CaptureOrganizationProcessTest`: `captureOrganizationPhase=seed` で保存後、対象テストアプリをforce-stopし、`verify` で異なるPIDから再読込・再送。同じ7件だけが残る。

Androidの検証は専用read-onlyエミュレーターとテスト用データで行う。
実機の接続診断と競合しないよう、S23へのAPKインストール・データ変更は行わない。

2026-09-08の検証結果:

- `testDebugUnitTest`、`assembleDebug`、`assembleDebugAndroidTest` 成功。
- API 35 Foldの保存・Outbox系63件、Compose 8件成功。
- 同じ専用エミュレーターを1080×2340 / density 420へ変更したcompact画面でもCompose 8件成功。
- process試験のseed → force-stop → verify成功。異なるPIDで同じdraftと7件のTaskを再読込し、再送で増えない。
- `output/issue-554-fold/ux-organization` と `output/issue-554-compact/ux-organization` のスクリーンショットで、候補番号・除外数・選択状態・長文・Theme・日付・Checklist・入力focusを目視確認。
- S23実機、実際の折り畳み中の同一Activity遷移は未確認。画面幅別の検証とActivity保存状態の回帰テストは、その実機境界を代替しない。

最新APIのPixel 10 Pro Foldでは既存Espressoの `InputManager.getInstance` 互換性例外によりUIテストを実行できず、API 35へ切り替えた。
API 35の一度のART native crashは独立再実行で再現せず、アプリ・ライブラリの変更を加えず上記のUI全件が成功した。
