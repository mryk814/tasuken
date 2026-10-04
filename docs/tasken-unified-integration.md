# Taskボード・限定開始・AI作業ログの統合候補

候補branchは `codex/komori-20261003-tasken-integration`。既存Taskの一覧／ボードと課題会話、本人用AI Task/Note作成、PC/AndroidのAI由来表示、独立opt-inの開始専用権限、選択した履歴の取込を一つにした。Task／Feed／Proposal／WorkReceipt／AgentSession／Referenceの既存保存経路を使う。

入力は公開base `a98f9955fb88140ac4b944ac9dfbdada3acb18b9` と次の3候補。共通の作成実装はボード版を保持し、開始のガードとログの終端状態を合成した。

| 候補           | 公開head                                   |
| -------------- | ------------------------------------------ |
| ボード・AI由来 | `2b017e29ad3aa7598a98b6f38c27adf5d446bb90` |
| 開始専用       | `54bcf3937b12a8481bcb7d0dd2b421ef53d06ed2` |
| 活動ログ #629  | `bdb34946fca061feb7e8d47ca3e05fb1762eadd9` |

部品・現候補の版・依存・有効化条件は [manifest](tasken-integration-manifest.json)。全componentのsource commitは同じcheckoutの `git rev-parse HEAD` に固定する。Desktopの候補versionとAndroidの既存versionNameは正式配布版の決定を意味しない。

## 統合で直した接点

- Notesの一覧と詳細で、共通AI由来アイコンが二重に追加されていた。ボード版の各面一つの配置へ戻し、ボタン内への入れ子も解消した。実画面監査で個数と既読操作を確認する。
- Androidログ詳細の半展開では元Session欄と閉じる操作が画面外へ出た。他の詳細sheetと同じ全面展開に揃え、phone/Foldで到達と戻る操作を確認した。
- AI作成の未確認・成果報告の採用・Task正式完了を分けたまま限定開始を合成した。人の状態変更後の最新versionで開始し、同じUUIDの再送で重複開始しない。Taskの汎用編集権限は追加しない。
- Mobile TodayのAI由来headerとAgentSession queryは独立にopt-inできる。4通りの組合せ、scope拒否、Task状態不変を確認した。

## 必要な検証と再利用

WindowsはNode 24.4.1 / npm 11.4.2 / Electron 37.10.3。固定依存を独立したworktreeへコピーし、lockfileの依存解決が同じであることを照合した。元のnode_modulesや通常profileは変更していない。

統合候補の全CIは一度実行した。全Node testsは2029件、2021 pass、7 fail、既存package成果物依存の1 skip。7件は統合後の古い期待値、fixtureの必須項目、開いたSessionの期間判定、未登録アイコンに由来した。該当4ファイルの79件を再確認して77 pass、残ったfixture2件を修正後に対象ケースだけ実行し2 pass。全suiteを再実行した結果とは表記しない。

未到達のstrict consistency、architectureのreport/task/core-mcp gate、script inventory、build、Desktop smoke、live MCP Proposal smokeは通過した。Notesの重複修正後に型とbuildを更新し、変更ファイルのlintを確認する。正式MCP/Core bundleも統合ソースから生成した。CI runnerの全test列挙、fail-fast、concurrency=1は変更していない。

Androidはunit 198件でfail/error/skipなし、debug app/test APKの生成成功。専用phone/Fold emulatorでAI由来と採用済みログの共存、詳細、戻る、Task状態不変を操作した。Room 26→27の既存Taskと未送信操作の保全をnative migration testで確認した。実機・署名配布・NAS Linux image実行は対象外。

PCの最終統合監査は18項目成功、53.295秒。架空Task/Noteと一時userDataのみを使い、一覧／ボード、キーボード状態変更、未確認／既読、依頼→限定開始→質問→競合時の返答保持→返答→報告→採用、ログfile input→preview→採用、狭幅詳細、2つの隔離DB間の共有folder同期、再起動と正式完了を確認した。PC 1400/820/420幅とAndroid phone/Foldの取得画像を目視確認した。画像と結果は `output/task-board-audit/`。単独候補の成功記録は各delivery文書に保全する。

## 既存DBと戻す境界

Desktop SQLiteのmigrationコードは公開baseから変更していない。新metadataと既存AgentSession／Referenceを保存する。AndroidはRoom 27へnullableな由来cache列を追加し、26のTaskと未送信操作を保持する。

公開baseの`publicAgentSession`と新しい関数を同じfixtureで比較した。従来のcompleted/Codexは新側で読める。`unknown`／`interrupted`、`opencode`／`deepseek_harness`は新側で受け付け、旧側では拒否する。したがって新履歴を採用する前に、同じworkspaceのPC/Core/MCPを統合版へ揃える。旧版混在で新Sessionを読み書きする運用や、新ログ保存後にコードだけを旧版へ戻す方法は使わない。

復旧時はwriterを止め、更新前の各端末の保存状態と共有sync状態、旧componentを一組で戻す。AndroidのRoom 27を旧APKでそのまま開くdowngradeは確認していない。更新後の新しい記録がある場合は保存してから復旧を判断する。実ユーザーDBの移行・復旧は今回実行していない。

## 試す最短手順

既にこのsource／環境でbuild・監査が成功している場合は最後のpreviewだけを使う。新しいPC、依存差、変更した境界がある場合だけ必要な生成を行う。

```powershell
rtk git clone --single-branch --branch codex/komori-20261003-tasken-integration https://github.com/mryk814/tasuken.git tasken-integration
Set-Location tasken-integration
rtk git rev-parse HEAD
rtk npm ci
rtk npm run build
rtk node scripts/run-electron-node.mjs scripts/task-handoff-audit.mjs --task-board --integrated --all-features
pwsh -NoProfile -File scripts/preview-task-board.ps1
```

previewは監査結果のTemp profileに限定する。通常DB、同期先、個人履歴は指定しない。ボードの架空Task、Notesの架空Note、Debriefの採用済み架空履歴を試せる。通常アプリを更新しない。

## 承認後に一度で更新する手順案

現段階は準備だけ。main merge、配布物生成・署名・install、NAS rolloutは実行しない。

1. 採用する一つのcommitを確定しmanifestへ記録する。正式Desktop version、Android versionName／versionCode（現行以上）、署名鍵と現行tunnelの固定imageを運用担当と照合する。同じcommitからDesktop／Core／MCP／Androidの必要な配布物を各一度生成し、artifact hashを記録する。
2. 更新時間を一度決め、PC/Coreのwriterとsyncを停止する。Androidの未送信操作を確認・保全し、Desktopの保存状態、NASの`state`、共有syncの更新前コピーを保存する。既存の [NAS backup手順](../deploy/synology/README.md) を使い、SQLiteだけを稼働中に裸でコピーしない。
3. 同じcommitのCoreとMCPをNASへ一度配置し、既存volume／UID／GID／tunnelを保持する。開始単独更新は挟まない。承認された範囲だけ`create-only`、`TASKEN_CORE_AI_TASK_START=1`、MCP write公開を設定する。既定値は無効のまま。
4. 同じcommitから用意したDesktopとAndroidを各一度更新し、保存先・package identity・署名を保持する。全PC/Coreの更新が済むまで新形式ログの採用を待つ。既存Taskと未送信操作が残ることを確認してsyncを再開する。
5. 本人が指定した一つの試用Taskで、AI Ready→開始→PC/Androidの作業中表示→質問／返答→報告確認→人による完了を一回確認する。本人が選んだログをpreviewして採用し、ボード／AI印／ログが独立したまま反映することを見る。失敗時は保存した一組へ戻し、別々のcomponent更新を追加で繰り返さない。

今回のsource branch pushは既存workflowの起動条件に該当しない。PR、main更新、tag、手動dispatch、releaseは作成しない。
