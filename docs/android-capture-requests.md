# Androidの通知・音声入力・PCなしのAI整理

2026-09-08。Tasken内の要望 `df79d713-c490-3c2a-988a-f6f660c06e8a`、`9c88bef1-d094-3434-8cf5-fa4a9173db87`、`ee427ab3-1ec1-3319-bb7f-2a7151d33089` に対応する。

## 操作

- 共通Snackbarは画面上部へ表示する。一覧・詳細のレイアウトを押し下げず、下部の追加・音声入力・ナビゲーションに重ねない。エラー通知と取り消し操作は維持する。
- 「音声を確定」は認識中欄の下、写真操作の上に置く。認識状態の表示領域を固定し、長い認識文字はその領域内でスクロールする。認識中・再待機・確定処理の切替でボタン位置を変えない。
- Task追加のAI整理欄から「PCなしで整理する設定」を開く。OpenAI / Azure OpenAI / Gemini / OpenCode Zen / OpenCode Go、モデル、Android専用APIキーを指定する。AzureだけHTTPS接続先を入力する。固有語辞書は任意。
- 「この端末から選んだAIへ送信して整理する」を選んで保存した場合、以降のAI整理はAndroidから直接送る。未選択の保存は資格情報の保存だけで、Desktop経由を維持する。「Desktop経由へ戻す」はキーを保持して無効化し、「設定を削除」は端末専用設定を消す。
- 整理結果は既存の候補編集画面へ表示する。候補の切替・編集・除外後、「追加する」を押すまでTaskやOutboxは作成しない。Androidのインターネット接続は必要で、TaskのDesktop同期は従来どおりPCへの接続後に行う。

## 通信と保存

既定はDesktop経由であり、端末直接通信は自動有効化しない。Desktopのキーを読み出したりAndroidへ転送したりしない。接続失敗時に別サービスやDesktopへ転送しない。

画面に選択したサービスと接続先、文字・録音時刻・Theme名・添付写真の送信、API利用料の可能性を表示する。プロバイダー、接続先、モデルの制約は[共通の入力整理](mobile-capture-organizer-providers.md)に合わせる。Azureは許可されたHTTPS resource originだけ、他サービスは固定URLを使う。

専用SharedPreferencesへ設定を保存し、APIキーはAndroidKeyStoreのAES/GCMで暗号化する。暗号文をサービス・Azure接続先に結び付け、変更時はキーの再入力を必要とする。暗号化や保存が失敗した場合は保存せず、入力を保持する。壊れたキーを別サービスに流用せず、再入力で修復する。キーは再表示・ログ出力せず、Room・Draft・同期・Export・画面再生成時の保存状態に含めない。アプリの既存 `allowBackup=false` も維持する。

送信は既存の写真検証、12000文字の原文、最大200件のTheme候補、発話時の日時とtime zoneを使う。録音日からの日付・曜日表を渡し、PCの現在時刻へ置き換えない。返答は最大8候補、余分なキー・不正な型や日付・候補外Theme・途中終了・拒否を採用しない。元の入力は整理失敗や再整理でも保持する。

HTTPはリダイレクト・自動再送なし、30秒で打切り、応答は256KiBまで。OpenAI/Azureには `store:false` を指定する。プロバイダーの処理・保持方針全般を無効にする指定ではない。

## 検証方法

`android-app` で `rtk .\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest --console=plain` を実行する。

自分が起動した隔離API35エミュレータだけへdebug/test APKを入れ、以下のクラスを個別指定してinstrumentationを実行する。

- `DirectCaptureSettingsTest`: 暗号化保存、再読込、資格情報の接続先への結び付け、破損時の修復、PC未接続での提案と未保存の確認。
- `AndroidCaptureRequestsUiTest`: 通知と一覧位置、短文・長文の音声確定位置、明示有効化、保存失敗時の入力保持、無効化・削除、キーボード表示中の実Task追加画面からの設定操作。
- `CaptureOrganizationUiTest` / `CaptureOrganizationRepositoryTest`: 既存の候補編集・除外・保存確認とGateway互換。
- `DirectCaptureSettingsProcessTest` は通常のinstrumentation実行では両メソッドをスキップする。以下のphase引数を付け、save→reloadを別々のinstrumentation呼出しで実行する。プロセスが変わっても復号・再表示できることを確認し、fixtureを削除する。

所有する隔離エミュレータが `emulator-5582` の場合、別プロセス復元は次の順で実行する。

```powershell
rtk adb -s emulator-5582 shell am instrument -w -e class jp.personal.tasken.companion.DirectCaptureSettingsProcessTest -e directCaptureSettingsPhase save jp.personal.tasken.companion.debug.test/androidx.test.runner.AndroidJUnitRunner
rtk adb -s emulator-5582 shell am instrument -w -e class jp.personal.tasken.companion.DirectCaptureSettingsProcessTest -e directCaptureSettingsPhase reload jp.personal.tasken.companion.debug.test/androidx.test.runner.AndroidJUnitRunner
```

実APIの呼出しはfake HTTPへ置き換える。実キー、実モデルの整理品質、実音声認識、物理端末、署名済み配布物はこの検証の対象外。

2026-09-08の隔離検証では、unit 159件、debug APK・test APKのbuildが成功した。暗号化・PC未接続経路5件、設定の別プロセス復元2件、UI4件、既存候補編集8件、既存Gateway互換6件が成功した。UI4件はAPI35の展開幅2076×2152とcompact幅1080×2340で確認し、キーボード表示中の保存操作、通知と一覧位置、短文・長文の認識表示を目視した。スクリーンショットは検証用アプリの `files/ux-android-requests` に保存する。

別プロセステストのphase引数追加後もtest APKを再buildし、phaseなしのクラス指定で2件ともskip・失敗なし、save→reloadを別々に呼び出して各phaseの1件が成功することを再確認した。
