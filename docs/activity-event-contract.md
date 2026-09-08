# Activity Event Contract

## 正本

Activity の正本は change_event Entity に保存する構造化 event です。
表示用の summary や Markdown の行から Entity を復元してはいけません。
Markdown、JSON、MCP、将来の日次 06 Activity.md は
src/shared/activityProjection.mjs の query と projection を共有します。

必須の構造化フィールドは次のとおりです。

- id: stable UUID
- occurred_at: ISO 8601
- event_kind: src/shared/activityEvent.mjs の固定語彙
- entity_ref: { type, id, revision? }
- theme_ref: { kind: "theme" | "none", id }
- actor、origin
- summary、changed_fields
- canonical_refs、source_refs、relation_refs
- work_receipt_ref
- metadata.schema_version、metadata.dedupe_key

entity_type、entity_id、changed_at、change_type、before_json、
after_json、source などの旧フィールドは、既存 reader と snapshot のために
保存し続けます。新しい query は構造化フィールドだけを正本として使います。

## イベント語彙

Task の CompleteTask / ReopenTask はそれぞれ
task_completed / task_reopened です。
Task の作業経路は task_work_recorded（開始・人間作業の報告）、
task_ai_reported（AIのWork Receipt報告）、task_ai_accepted（人間の受入れ）、
task_ai_returned（人間の差戻し）です。Work Receiptは task_id と
work_receipt_ref でTaskへ結びますが、Receipt本文はappend-onlyです。
AIの報告・Receiptの追加はTaskのstateをdoneへ変更せず、
CompleteTaskはAI Taskがacceptedになった後だけ許可します。
Note / Report / Prompt は create/update を分け、Resource は
resource_added / resource_updated、Artifact は
artifact_added / artifact_updated です。

Task の作成と単純な title 編集は履歴には保持しますが、既定 Activity には出しません。
Activity に明示的に含める必要がある producer は
metadata.include_in_activity: true を指定します。

## 移行

SQLite schema version 3 で旧 change_event 行を一度だけ正規化します。
旧フィールドを削除せず、metadata.migrated_from と
metadata.dedupe_key = legacy:<event id> を付けるため、再起動や再移行で
過去の履歴が相互に dedupe されません。
after_json が既に plain entity の場合は再 parse せず、そのまま対象 Entity として扱います。

## Autosave dedupe

同一 Entity の同一 event_kind を five seconds の idle window 内で保存した autosave は、
同じ session_id の一つの event に集約し、after と occurred_at を最新値へ更新します。
five seconds を超える idle、または producer が newSession: true / 新しい
sessionId を渡した場合は別 event です。
Application Command は command retry の idempotency を保ちつつ、
同一 command 内の複数 Entity event を別 key にします。

## Work Receiptの境界

StartTaskWork / AppendWorkReceipt / AcceptTaskWork / ReturnTaskWork は
Task・Receipt・Change Eventを同じtransactionで保存します。
MCPの一覧・参照はread-onlyです。AI Ready Taskを実際に引き受けるときだけ
`tasken.start_task_work`が開始を直接記録し、報告はProposalとしてInboxへ送ります。
報告Receiptの追加が確認待ち状態を作り、
AI ReadyのTaskへ開始Proposalなしで報告が届いた場合は、報告Proposalの採用時に
Receiptのstarted_atを使ったstarted eventと報告eventを同じtransactionで保存します。
完了報告の「採用」自体をWork Receiptの人間確認として扱い、同じtransactionで
work_state=acceptedまで保存します。Taskの完了は人間が別途操作します。
採用時には報告で指定されたChecklist itemだけをチェックし、Taskが完了・中止済み、
または作業が採用済みの場合の追加報告はその状態を保ったまま追記します。
別の開始承認・Receipt承認は要求しません。
Acceptと差戻しはactor.kind=userかつ
非MCP sourceの人間UI commandに限定し、MCP actorのspoofでは受入れできません。
executor_labelは表示用の記録であり、provider/modelはruntime_metadataにだけ保存し、
Taskのexecutor_identity表示名を上書きしません。
Taskの永続化境界では、intended_executor=ai_agentかつstate=doneを
work_state=accepted以外で保存できません。intended_executorの変更は同じ境界で正規化し、
AIへ割り当てる場合はready_for_agent、AIから外す場合はnot_delegatedへ戻します。
in_progress / reported_done / needs_human_review 中の再割当は、Receiptの帰属を曖昧にしないため拒否します。

## canonical / AI projection

Canonical ref は storage_root_id + relative_path を優先し、
web_url は任意です。root の実パスは resolver の内部だけで使い、
MCP やその他の AI projection に絶対パスを返しません。
既存の `workspace_meta.artifact_directory` は `sync`（および互換別名）へ、
Theme の `storage_root` は Theme ID／`theme:<id>` へ typed resolver で束ねます。
root が変更されても event の identity は書き換えず、現在の設定で再解決します。
Today の開く操作だけが Main の安全境界を通り、壊れた参照は status: "broken" として
非活性表示します。local root が未設定・不存在でも有効な https `web_url` があれば
それを開き、`local_status: "broken"` を併記します。traversal や symlink で root 外へ
出る参照は拒否します。Renderer／MCPへ返す root 情報は `ok`／`broken` の状態だけです。

#294 の visibility / authority / freshness は projection 時点で評価します。
local_only は M365 projection に含めず、除外件数と理由だけを返します。

明示的なrecall profileの当時名称・所属と現在の公開判定は、
[振り返り履歴契約](activity-recall-history.md)に従います（#542）。

## Android操作と同期の日時（#538）

AndroidのCreateCapture、CompleteTask／ReopenTask、Checklistのcheck／uncheckは、端末で操作した時の`issuedAt`をActivityの`occurred_at`へ使う。
日曜23:55 JSTの操作を火曜に受理しても、Asia/Tokyoの期間queryでは日曜に属する。
CompleteTaskの`completed_at`も同じ操作時刻とする。
これは「完了と記録した時刻」であり、実際の作業開始・終了や所要時間を保証しない。

Captureは既存の`capturedAt == issuedAt`契約を維持し、入力取得時刻を保存する。
Checklist itemの`completed_at`、command ID、元のoffset付き`issuedAt`も変更しない。
Desktopの保存時刻は`changed_at`と`metadata.accepted_at`に分離する。
`metadata.time_basis = client_operation`、`operation_issued_at`、`clock_status = unverified_client_clock`で由来を示し、公開projectionにもこの時刻情報だけを引き継ぐ。

新しいMobile要求にはoffset付きの有効なISO日時を要求する。
不正な日付・offsetのない日時は受理せず、現在時刻に補正しない。
形式が正しい未来や過去の時刻は元の申告値を残し、端末時計を検証済みとも実際の作業事実とも扱わない。
`occurred_at`は同じ瞬間のUTC表記へ正規化し、期間所属はqueryのIANA timezoneで求める。
日付だけの予定はこの変換を通さない。

同一commandの再送は元のevent／receiptを返し、再起動・後続commandの確定で操作時刻を差し替えない。
旧payloadの有効な日時と旧event／Snapshotの読み取りは維持し、既存eventの日時をbackfillしない。
時刻の由来metadataがない旧eventは従来の記録値であり、端末操作時刻だったとは断定しない。
DesktopやAIの他のproducerは本変更の対象外とする。

`application-command.test.mjs`と`mobile-gateway-phase4a.test.mjs`で、日曜操作・火曜受理、Core経由の送信、同一receipt、SQLite再読込、SnapshotのJSON往復、不正日時と未来の端末時計を確認する。
`MobileOperationTimeGatewayTest`は隔離Gateway runnerで実行し、日曜23:55 JSTの5操作をRoomへ保存して別Androidプロセスで再読込する。
再送側のtimezoneをPacific/Kiritimati、時計を火曜へ変え、親・後続commandの応答消失とDesktop再起動を挟んでも、操作時刻・command identity・receipt・eventが変わらず重複しないことを確認する。
