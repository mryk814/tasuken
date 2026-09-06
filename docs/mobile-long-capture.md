# 長文Captureの保存境界

Androidからの `CreateCapture` 本文は12,000 UTF-16コード単位まで受け付ける。
JavaScriptの `String.length` とKotlinの `String.length` を基準とし、絵文字のサロゲートペアは2として数える。
Taskタイトルの500文字上限は変えない。

新AndroidはCapture候補に `textContract: "verbatim-utf16-12000"` を付ける。
旧Desktopのstrict schemaはこのフィールドを拒否するため、短い原文でも旧trim処理へ誤って通らない。
新Desktopはこのフィールドを任意として受け付け、旧Androidの保存済みcommandも受信できる。

本文は空白のみの入力を拒否するが、前後の空白、改行、日本語、絵文字、URLを正規化・trimしない。
GatewayとCoreの両方で上限を検証し、canonical Captureへ原文のまま保存する。
DesktopではInbox行の編集ボタンから本文全体を開く。
編集フォームでも前後の空白と改行を保持し、再保存で原文を変えない。

`fixtures/mobile-capture-text-boundaries.json` はAndroidとDesktopで共有する生成的fixture。
各caseの本文は `unit.repeat(repeat) + suffix` で復元し、500／501／12,000／12,001の境界を確認する。

Gateway HTTP bodyの上限は256KiBのまま。
12,000コード単位を全てJSONの `\uXXXX` 形式にしても本文は72KBであり、通常のcommand envelopeと合わせても上限内に収まる。
HTTPテストでescapeされた本文が欠落せず復元されることを確認する。

関連テストは `application-command.test.mjs`、`mobile-gateway-phase4a.test.mjs`、`mobile-gateway-runtime.test.mjs`。
SQLite保存後のreopen、同一commandのreceipt replay、DeleteCaptureの期待versionと重複防止、削除後の原文保持を検証する。
Androidの送信待ちCaptureは既存outboxを読み取り、一覧から全文表示・全文コピーを提供する。
旧Desktopの契約拒否は原文と同じcommandを `rejected` で保持する。
自動再試行を繰り返さず、利用者がDesktopを更新した後の「再送する」で同じenvelopeを再送する。
再送の条件付きUPDATEは別Desktopや既に送信中のcommandを変更せず、attemptCountをリセットしない。

12,001文字以上も入力欄・draft保存から削除しない。
利用者が明示的に編集するか、「全文をコピー」で回収できる。
Capture入力は複数行の改行を許可し、IMEのEnterを送信へ割り当てない。

## 検証記録（2026-09-06）

- `MobileCaptureTextContractTest` は共有fixtureのUTF-16長、原文roundtrip、旧Desktopのvalidation/version拒否を確認。
- `MobileLongCaptureDatabaseTest` はRoom再読込、旧Desktop拒否後の停止・明示再送、Undo、原文保持、outbox書込失敗のreceipt rollbackを確認。
- `MobileLongCaptureUiTest` は12,000文字の追加、12,001文字の全文コピーと編集、旧Desktopの理由表示と再送、LLM失敗後のCapture追加を確認。
- `MobileLongCaptureProcessTest` は `captureProcessPhase=seed` と `verify` を別instrumentationで実行し、その間に対象debugプロセスをforce-stopする。
  PIDが変わったことと、draft・outboxからの12,000文字再表示を確認。
- compact API35（emulator-5556）とFold API35（emulator-5558）でDB/UI検証とprocess終了回復が成功。
  画像は `artifacts/capture535-compact`、`artifacts/capture535-fold` に保存し、入力欄と本文の高さ、コピー・再送・追加ボタンの到達を目視した。
- Desktopの隔離userDataで12,000文字の保存→プロセス終了→再起動→Inbox編集の原文一致を確認。
  上部・末尾の目視、横はみ出しなし、閉じる操作後のfocus復帰を確認。画像は `artifacts/capture535-desktop`。

Androidから実Gateway/Core/SQLiteへの連続検証は次で実行する。
各methodは別instrumentationプロセスで動き、同じ一時Desktopを共有する。

```powershell
rtk node scripts/run-electron-node.mjs tests/helpers/run-android-offline-journey.mjs emulator-5556 MobileLongCaptureGatewayTest#seedOfflineCapture MobileLongCaptureGatewayTest#verifyAfterProcessExitAndDesktopRestart --cleanup=MobileLongCaptureGatewayTest#cleanup
```

12,000文字をPC停止中に保存し、別Androidプロセスで回復、再接続後のCreate応答欠落、Desktop再起動、同じCreate再送を通して本文が一致する。
さらにUndo応答欠落とDesktop再起動後のDelete再送を行い、Capture一件（削除済み）、Create/Delete eventとreceipt各一件、Android outboxゼロへ収束する。
この連続検証はcompact API35とFold API35の両方で成功した。
この検証はloopback HTTPの隔離fixtureを使う。
production HTTPS/Tailscaleの疎通、実機S23での操作はこの検証の対象外。
