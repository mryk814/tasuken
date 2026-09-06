# Today のローカル先行表示（#531）

Today は起動時から Room の日付別Taskと同期履歴を購読する。
GatewayとProposalの応答を待たず、保存済みTaskを表示し、既存のローカル追加・完了経路を利用できる。
Desktop SQLiteが正本であること、Roomとoutboxの保存契約は変えない。

- Roomの最終同期時刻がある0件と、取得履歴がない初回状態を区別する。
- Gateway失敗をキャッシュ取得成功へ置き換えない。認証失効が確認された場合は再接続を案内し、キャッシュを残す。
- 未観測の未反映件数・競合件数はnullで保持する。最終同期時刻を現在時刻で補わない。
- 再読込は一覧をLoadingへ戻さない。Todayの接続確認とProposal更新は別の状態・Jobを持つ。
- 接続状態が変わっても一覧のCompositionと表示領域を保ち、選択・スクロール・入力draftを保持する。
- 復帰時とAndroidの日付・時刻・タイムゾーン変更通知で日付別購読を更新する。古い購読と単発取得の遅延結果を新日の表示へ適用しない。
- 明示的な再接続フォームを表示している間は、キャッシュ更新でフォームを閉じない。

## 検証

`TodayViewModelTest`は、応答しないGateway、応答しないProposal、同期済み0件、初回、再接続フォーム、日付跨ぎの遅延結果と購読数を検証する。
`MobileTodayOfflineRepositoryTest`は実RoomとHTTP fakeで、通信失敗・認証失効と保存済み同期履歴を検証する。
`TodayOfflineUiTest`は一覧の位置・選択・draft復元を確認し、各状態の画像を端末のテスト出力`today-offline/`へ保存する。

Windowsで`android-app`を作業ディレクトリとして実行する。

```powershell
rtk .\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest
rtk adb -s <test-emulator> shell am instrument -w -e class jp.personal.tasken.companion.TodayOfflineUiTest,jp.personal.tasken.companion.MobileTodayOfflineRepositoryTest jp.personal.tasken.companion.debug.test/androidx.test.runner.AndroidJUnitRunner
```

2026-09-06の途中確認では、API35のPixel 8 compactとFold emulatorでTodayのComposeテストが成功し、一覧・再読込・接続失敗・同期済み0件を目視確認した。
API37 emulatorはEspressoの`InputManager.getInstance`呼出しでUIテストが失敗するため、その実行を表示検証成功には数えない。
実端末のプロファイルは検証へ流用していない。
PC停止から再接続までの実コマンド・再起動の横断journeyは#537で確認する。
