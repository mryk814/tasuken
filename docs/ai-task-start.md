# MCPの開始専用権限

`task.start_work`は、人がAI Readyにした本人の個人Taskについて、外部AIの着手を直接記録する独立した権限。
新規作成権限や`create-only`から暗黙に許可しない。

## 操作・対象・保存

| 項目           | 契約                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| MCP / Core     | 既存`tasken.start_task_work` / `POST /v1/commands/start-ai-task-work`                                                                     |
| 対象           | 固定Workspaceのtheme-personal-default、requester=self、intended_executor=ai_agent、work_state=ready_for_agent。削除・完了・中止済みは拒否 |
| 保存           | work_state、work_started_at、executor_identity、work_attempt_idと既存監査イベント。通常のversion/updated_atも更新                         |
| 保存先         | Coreの既存SQLite正本と既存の共有フォルダ同期。schema・保存場所は変更しない                                                                |
| 禁止入力       | actor、source、command名、本文、題名、完了、削除、採用、委任、Workspaceや保存path                                                         |
| actor / source | Coreがai_agent / mcpに固定。callerは表示・監査名で、本人認証や特定AIへの排他的grantとは別                                                 |
| 再送           | キー・version・caller・時刻・UUID・sessionを保持。内容違いの同一キーはfingerprint競合                                                     |
| 作業中         | 新しい要求を拒否。同じ要求の再送だけ認め、他executorのclaimを取り直さない                                                                 |
| 作業単位       | UUID必須。この経路で開始済みのUUIDを同じTaskで再利用しない。開始イベントを識別記録として使う                                              |

汎用`task.command`を公開しない。
旧Desktopの汎用経路は互換用に残るが、開始専用経路からの拒否を迂回させない。
このCoreの開始toolを許可された接続は、上記条件を満たす本人のTaskを開始できる。
caller名を「こもり」等に固定しても特定AIだけの認可にはならないため、接続単位のtool許可はclient側で管理する。

## 受領から報告まで

1. 利用者がTaskをAI Readyにし、会話で対象を指定する。ReadyだけではAIを自動起動・通知・定期実行しない。
2. AIが文脈と最新Taskを読み、実際に着手するときだけ開始する。UUIDは人の再委任で用意された新しい作業単位IDがあればそれを使う。
3. 応答のTaskがin_progressで、work_attempt_idとexecutor_identityが自分の要求に一致することを確認する。再送は過去の開始を受領しても現在の正本を返すため、再委任・レビュー・削除後の応答を着手許可にしない。
4. 最新versionと同じ作業単位IDで、進捗・成果・未完了部分を既存の報告Proposalへ送る。
5. 人が報告を採用する。Task完了は別の人間操作。購入など未実施の作業はそのまま明示する。

## 有効化と撤回

既定は無効。APIオプション`allowAiTaskStart: true`、引数`--allow-ai-task-start`、または`TASKEN_CORE_AI_TASK_START=1`で明示する。
read-onlyとの併用は起動時に拒否する。proposals/create-onlyは単独では開始を許可しない。
MCP bridgeのread-onlyも解除済みである必要がある。

profileはproposals + startが`proposals-and-start`、create-only + startが`create-and-start`。
Note編集・Feed返信・画像投稿・Agent Session権限を増やさない。
`get_capabilities`のwrites.task_startとtool availabilityで確認する。

撤回は環境変数を0へ戻し、opt-in引数があれば除いてCoreを正常に再起動する。
新規開始を拒否し、保存済みTask・開始イベント・作業単位・Proposal・Receiptを保持する。
DB restoreやTaskの自動Ready化はしない。必要な状態変更は利用者が既存の再委任・差戻しで判断する。

## 本番有効化の承認対象

今回の成果はコードと隔離検証のみ。本番設定・connector grant・NAS image/Compose・DB・同期先は変更していない。
承認対象は現在のTasken NAS Core/MCP image更新と開始専用opt-in、必要なclient側`start_task_work`許可・tool schema更新。
Desktop/Androidは既存のReady・報告採用UIを使えるため、今回のためのUI更新は不要。
board #628、ログ取込 #629、個人ログ収集は含めない。

配備時はcommit・image digestを固定し、更新前image/Compose/環境値を保存する。
Coreを正常停止してSQLite・WAL/SHM・正本stateをbackupし、checksumとSQLite integrityを確認する。
本番同期先を使わないcandidateで検証した後、同じUID/GID・mount・WorkspaceのままTasken対象サービスだけを正常に更新する。
ACL、sudoers、ネットワーク、Tunnel資格情報、保存場所、DB schemaは変更しない。

停止の目安は1〜3分。backup量、image load、起動・確認に依存し、NAS所要時間は今回未計測。
停止対象は更新するCore/MCPと必要ならTunnel sidecar。Desktop/Androidや他アプリの停止は不要。
有効化後にtask.commandなし、task_start=true、note_edit/feed_reply/note_images=falseを読み取り確認し、利用者が指定したReady Taskだけで開始を試す。

不具合時はopt-inを無効にして新規claimを停止する。
必要なら更新前のimage/Composeへ戻し、現在のDB・同期履歴を保持する。schema変更がないため、通常の撤回にDB restoreは不要。
backup restoreは後続の書込みや同期差分を失うため自動では行わない。

## 検証

`tests/ai-task-start.test.mjs`は独立opt-in、read-only、HTTP認証、入力範囲、対象状態、version/fingerprint競合、作業中claim拒否、transaction rollback、再起動、削除後readback、撤回、再委任時UUIDを検証する。
実際のstdio MCPから開始し、隔離共有フォルダでDesktopへ同期し、進捗/完了報告Proposalを人間経路で採用するE2Eも含む。
既存のTask capability、work-attempt、human review、creation-only、headless、MCP互換も検証する。

開始grantの再レビューでは、HTTPの汎用command不在とtransaction入口の拒否を、本文編集・削除・完了・再委任・報告採用ごとに確認する。
別Workspaceのcredential、MCPを接続したままのCore opt-in撤回、限定経路が返した認証・入力・状態・version拒否を汎用経路へ再送しないことも検証する。
create-onlyへ開始opt-inを加えた前後で、writesの差分がtask_startだけであることを実stdio MCPで比較する。
既存の`tests/ai-collaboration-e2e.test.mjs`の明示開始にもUUIDが必要であり、開始から進捗・完了報告まで同じIDを渡す。
