# Androidの日常操作・音声入力

2026-09-05。DesktopのTask・Theme・Captureと保存形式を保ったAndroid UIの改善。

## 操作

- Today／ToDo右下には同色の「＋」「マイク」アイコンを置く。マイクは直ちに音声認識を開始し、入力途中の文字がある場合は認識結果を追記する。初回はAndroidのマイク権限確認を挟む。読み上げ用の操作名は保持する。
- Taskはタイトルだけで追加できる。Theme選択と通常の手入力を維持する。音声の結果もTask名として確認・修正してから追加する。
- 追加画面はタイトル・音声入力を先に表示する。種類とThemeは右寄せの「種類・Themeを変更」から開き、Theme選択後は閉じてタイトルへ戻る。選択中のTheme名は閉じても表示し、連続追加でも引き継ぐ。入力元は分類欄内に置く。
- 音声認識中は入力・保存を止め、認識失敗時は入力済みタイトルを維持する。再録音は「話し直して置き換える」で明示する。
- 音声で「追加して次へ」を使った場合、キーボードは自動表示しない。次の録音は音声ボタンから始める。
- ToDoの「予定・Themeで絞る」で予定とThemeを組み合わせる。未指定Themeも選べ、検索・完了状態と組み合わせられる。絞り込みは画面再生成時にも復元する。
- 「今日」は既存Todayと同じtodayDate一致。「これから」は今日への割当日・予定開始・予定終了のいずれかが未来。「予定なし」はこれらの日付がすべて未設定。
- 右手の片手操作に合わせ、音声入力は一覧の右下に置く。詳細の完了／今日への割当はスクロール領域から分けた下端に置き、完了を右側にする。Task名の編集と絞り込みは右寄せにする。
- 一覧とChecklistの完了チェックは行の右端に置く。行の選択・詳細表示と完了操作は別のままにする。
- Task名の編集は必要時に開き、閉じても未保存入力を保持する。未編集の名前は同期更新に追随する。
- 長いTask名・Captureは追加欄で最大6行まで折り返して表示する。既存の保存上限500文字を保ち、400文字から文字数を表示する。上限を超える発話・貼り付けは下書きとして全文を保持し、超過の説明と追加無効化で短縮を促す。編集途中や再読込でも切り捨てない。音声入力後のTheme選択ではキーボードを自動表示しない。
- 詳細はChecklistをTheme・予定より先に表示する。項目は読む・右端で完了する操作を基本にし、名前の変更と削除は「編集」から開く。編集を閉じても入力途中の名前を保持する。
- Checklist追加欄は、保存された項目が正式な表示へ反映されてから空にする。保存が失敗した場合は入力を保持し、同じ内容の再試行では項目IDも維持する。
- 予定は日付と意味の要約を基本表示にし、右側の「予定を編集」で変更する。閉じても未保存の変更は保持し、その存在を表示する。今日への割当・開始・期限・期間の意味は別々のままにする。
- 未委任のTaskではAI設定を必要時に開く。AI Ready・処理中・変更失敗は自動で表示し、Work Receipt・提案の確認、同期競合・Theme却下は折り畳まない。

## 検証用アプリ

Debugは`jp.personal.tasken.companion.debug`（表示名`Tasken Debug`）。通常版を削除せず共存できる。debug専用のショートカットも同じdebug packageへ接続する。
共有・taskenリンクの候補には両方が出るため、検証時はdebugの明示componentを使う。

Windows PowerShellでSDK環境変数を設定し、`android-app`から実行する。

```powershell
$env:ANDROID_HOME = 'C:/Users/ootan/AppData/Local/Android/Sdk'
rtk .\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest --console=plain
```

実機には`adb -s <serial> install -r`でDebug APKとtest APKを入れ、対象クラスを指定して`am instrument -w`を実行する。実データとはペアリングせず、UI fixtureと独立したRoomテストを使う。
`TaskDailyFlowUiTest`は`files/ux-daily`、`TaskEntryFlowUiTest`は`files/ux-audit`にスクリーンショットを保存する。

## Task入力のLLM整理

Taskの入力では「音声後にAIで整理」を切り替えられる。認識結果からDesktop Gateway経由で整理案を取得し、タイトル・Theme・開始/期限・チェック項目・補足を確認して、既存の「追加する」で保存する。手入力からの整理も同じ経路を使う。
整理は正式データを変更しない。失敗・中止時は入力を保持して通常追加へ戻れ、待機中に編集した入力を遅延した整理結果で上書きしない。
Task・日付・チェック項目は一つのコマンドで保存する。原文と補足は既存Task本文へ保持し、詳細の「補足・元の入力」から任意で展開する。
接続設定・対応モデル・送信範囲は[入力整理プロバイダー](mobile-capture-organizer-providers.md)を参照。

2026-09-05のS23検証ではCaptureOrganizationUiTest・MobileCaptureDraftStoreTest・MobileOutboxDatabaseTest・MobileLocalDatabaseMigrationTestの計75件が成功。整理案と原文展開のスクリーンショットを目視し、重なりがないこと、追加が右下にあることを確認した。原文を長く展開した場合はスクロールして追加する。
SQLiteの16→17移行はnullableの本文列追加のみで、既存Task・送信待ちデータの保持と移行後再読込を確認した。
APIキーを使う実通信、実際の発話からの整理品質、Fold7での今回の整理画面は未検証。

整理動作の修正後、Android単体121件とS23の上記4クラス＋CaptureOrganizationRepositoryTest・TaskEntryFlowUiTest（合計82件）が成功した。S23 DebugはこのAPKへ更新済み。
Desktopはtypecheck・production build・Windows NSIS/portable packageが成功。模擬provider、Gatewayの認証/JSON/HTTPサイズ境界、Coreの実SQLite rollbackを確認した。実APIキーでの疎通や通常版への導入はこの検証に含めない。

通信schema 7・Room 18への移行後もAndroid単体121件が成功。S23では12クラス115項目を確認し、初回にテストAPKへの18.json同梱漏れで失敗した移行テストは、スキーマ生成後のテストAPK再ビルド・再インストールで移行18件すべて成功した。最終Debug APKをS23へ更新済み。Task詳細の原文展開・折畳み・別Taskへの切替も確認した。

## 未検証の境界

### 2026-09-05 日常操作の追加検証

同日の最終候補でunit test 113件が成功。S23でTaskDailyFlowUiTest・TaskEntryFlowUiTest・TaskDailyDetailUiTest・TaskScheduleEditorUiTest・TaskDelegationUiTestが成功（最初の20件後、Checklist保存保持テストを加えた詳細4件＋委任2件を再実行）。音声超過保持の修正後、TaskDailyFlowUiTest・TaskEntryFlowUiTest・CaptureThemePickerUiTestの15件も再実行して成功した。
新しい確認項目は、長文Captureの改行保持・複数行表示・Theme選択後のフォーカス・上限超過から短縮して追加する流れ、予定の開閉と未保存draft保持、Checklist一押し完了・名前編集の保持・保存失敗後の再試行、AI設定の表示条件。

専用AVDの360dp（1080×2340）・750dp（2250×2340）、480dpiで上記5クラス20件ずつが成功。詳細4件を最終修正後に両幅で再実行した。長文Capture、音声結果、ダーク表示、Checklist、予定要約、スクロール後も残る完了操作を目視確認した。
音声超過保持の修正後、両幅でTaskDailyFlowUiTest 3件ずつ、360dpでMobileCaptureDraftStoreTest 6件を再実行し成功。572文字の全文保持・追加無効の表示を両幅で目視した。専用AVDは検証後に停止済み。

S23 Debugには最終候補を更新済み。Fold7は途中で切断されたため、直前の入力画面改善版までの反映であり、今回の最終候補は未反映。main合流・push・通常版の更新は行っていない。

専用AVDではTask/Captureの原子的保存・再送抑止・receipt反映、offline repository、draft/Undo保存、Activity再生成の計12件も成功した。Roomのin-memoryテストとfixtureによる検証であり、実Desktopの同期成功を意味しない。

以下は先行フェーズの検証履歴であり、今回の端末更新結果と区別する。

確認済み: Debug APK／test APKのビルド、unit test 111件。S23ではTaskDailyFlowUiTest、TaskListContextUiTest、TaskEntryFlowUiTest、TaskStateActionUiTestの計22件が成功。狭幅360dpと展開幅750dpで描画・操作を確認し、入力途中のdraftが幅変更後も残ることを目視した。
S23でマイク権限→認識開始→発話なしのエラー／再試行表示を確認した。代表fixtureはライト・ダークで確認し、詳細の頻用操作がスクロール後も下端に残ることをテストした。
操作領域の実測値は[`android-thumb-reach.md`](./android-thumb-reach.md)に記録した。

- 利用者の発話による日本語認識精度と、認識結果が実Desktop Gatewayへ到達する一往復。
- Galaxy Z Fold7実機の開閉・ヒンジ・キーボード挙動。エミュレーターの幅変更とは別の受入れ項目。
- 署名付きrelease版の更新インストール。今回の成果物はローカルDebug APK。
