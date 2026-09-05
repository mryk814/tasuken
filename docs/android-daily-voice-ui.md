# Androidの日常操作・音声入力

2026-09-05。DesktopのTask・Theme・Captureと保存形式を保ったAndroid UIの改善。

## 操作

- Today／ToDo右下の「話して追加」は、空の入力なら音声認識を開始する。入力途中ならその内容を開き、勝手に置き換えない。
- Taskはタイトルだけで追加できる。Theme選択と通常の手入力を維持する。音声の結果もTask名として確認・修正してから追加する。
- 音声認識中は入力・保存を止め、認識失敗時は入力済みタイトルを維持する。再録音は「話し直して置き換える」で明示する。
- 音声で「追加して次へ」を使った場合、キーボードは自動表示しない。次の録音は音声ボタンから始める。
- ToDoの「予定・Themeで絞る」で予定とThemeを組み合わせる。未指定Themeも選べ、検索・完了状態と組み合わせられる。絞り込みは画面再生成時にも復元する。
- 「今日」は既存Todayと同じtodayDate一致。「これから」は今日への割当日・予定開始・予定終了のいずれかが未来。「予定なし」はこれらの日付がすべて未設定。
- 右手の片手操作に合わせ、音声入力は一覧の右下に置く。詳細の完了／今日への割当はスクロール領域から分けた下端に置き、完了を右側にする。Task名の編集と絞り込みは右寄せにする。
- 一覧とChecklistの完了チェックは行の右端に置く。行の選択・詳細表示と完了操作は別のままにする。
- Task名の編集は必要時に開き、閉じても未保存入力を保持する。未編集の名前は同期更新に追随する。

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

## LLM整理の次の検討範囲

「話す→タイトルを確認→保存」を通常経路とする。長く話した場合だけ、任意の整理操作で「短いタイトル＋補足」の候補を出す方向で検討する。
元の発話テキストを失わず、候補の修正・採用後に保存する。日時・Theme・複数Taskへの分割を勝手に確定しない。
今回、LLM呼出し・外部AIへの送信・新しい本文入力欄は追加していない。

## 未検証の境界

確認済み: Debug APK／test APKのビルド、unit test 111件。S23ではTaskDailyFlowUiTest、TaskListContextUiTest、TaskEntryFlowUiTest、TaskStateActionUiTestの計22件が成功。狭幅360dpと展開幅750dpで描画・操作を確認し、入力途中のdraftが幅変更後も残ることを目視した。
S23でマイク権限→認識開始→発話なしのエラー／再試行表示を確認した。代表fixtureはライト・ダークで確認し、詳細の頻用操作がスクロール後も下端に残ることをテストした。
操作領域の実測値は[`android-thumb-reach.md`](./android-thumb-reach.md)に記録した。

- 利用者の発話による日本語認識精度と、認識結果が実Desktop Gatewayへ到達する一往復。
- Galaxy Z Fold7実機の開閉・ヒンジ・キーボード挙動。エミュレーターの幅変更とは別の受入れ項目。
- 署名付きrelease版の更新インストール。今回の成果物はローカルDebug APK。
