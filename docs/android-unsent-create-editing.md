# Android 未送信Taskの編集

Issue: #532（Epic #530）

`CreateTask` が `Pending`、`attemptCount = 0`、依存commandなしの場合だけ、タイトル、Theme、Today日付、開始日・期限・期間、Checklistを既存Createへまとめる。
送信claim後や、一度送信を試みてPendingへ戻ったcommandは変更しない。

`MobileLocalDao.editUnsentCreate` はtransaction内で最新のcacheとenvelopeを読み、指定fieldを変更する。
command ID、request ID、Task ID、provenance、原文descriptionは維持する。
条件付きUPDATEはcommandの状態と元のenvelopeも照合し、成功した場合だけoptimistic cacheを保存する。
cache保存に失敗するとenvelopeの更新もrollbackする。

同じdraftの再submitは既存Task IDを返す。
古い入力に残るタイトル・Theme・日付・Checklistで編集済みCreateを上書きしない。
descriptionとprovenanceが変わった同一draftの再利用は従来どおり拒否する。
既存の未送信Undoとバッチtransactionを使用し、Room schemaの追加・移行は不要。

UIはcacheから導出した `canEditPendingCreate` と `canEditPendingTask` を使用する。
編集中に送信が始まった場合は、#533の後続commandとして保存し、元のCreate envelopeは変更しない。
Room保存が失敗した場合は画面の編集draftを保持し、再試行できるようにする。

検証対象は `MobileOutboxDatabaseTest` の全field更新、再submit、部分編集後のバッチ再submit、Undo、claim前後、cache保存失敗rollback、DB再読込。
Composeでの入力保持、compact/expanded実描画、Desktop同期後の一件への収束は別の実動境界として確認する。

2026-09-06の確認では、Android unit 133件、API35 compactの関連instrumentation 88件（Outbox 53件を含む）、FoldのUI 18件が成功した。
送信開始・保存失敗時の名前draft保持を両画面で確認した。
Desktop同期後のTask／Create receipt一件への収束は#534／#537の実Gateway journeyで確認した。
全fieldの連続操作はRepository／Roomから検証しており、実画面操作とは区別する。
