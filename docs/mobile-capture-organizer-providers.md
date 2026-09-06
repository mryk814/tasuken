# Desktop・Android共通の入力AI整理

2026-09-06更新: 音声向け指示、現地日時・相対日の実日付・曜日表、固有語辞書、Androidの複数Task案を追加。関連Nodeテスト32件、typecheck、変更箇所のESLint、Desktop buildが成功。隔離Electronでは辞書の入力・保存・再起動後の復元・保存失敗時の入力保持・削除を実画面で確認した。実APIでの今回の整理品質は未検証。

Desktopの`src/main/gateway/mobile/captureOrganizer.ts`が、利用者の整理要求に対して提案だけを返す。
Taskの保存や既存データの変更は行わない。採用まで原文を保持し、返答をプレビューで確認する。
Androidの整理操作はTask入力にだけ表示する。整理を取り消すと原文と整理前のThemeへ戻る。
DesktopのQuick CaptureではTask入力の「AIで整理」から同じ処理を使う。整理案のタイトル・Theme・日付・チェック項目・補足を修正し、「追加」で保存する。元の入力へ戻すこともできる。
APIキーはDesktopで管理し、Android・ログ・返答・プロンプトへ含めない。

## 画面から設定する

「Settings → AI & Context → 入力のAI整理」でプロバイダー、モデル（Azureではデプロイ名）、APIキーを入力する。Azureのみ接続先も指定する。音声認識で誤記されやすい固有語は「音声・固有語辞書」へ1行に1語で登録できる。
「接続を確認」は入力中の設定で短い固定テキストを送信する。API利用料が発生する場合があり、設定の保存やTaskの作成は行わない。
「保存」するとDesktopとAndroidの次の整理要求から適用され、再起動は不要。
保存済みのキーは空欄のまま再利用できるが、プロバイダーまたはAzure接続先を変えると再入力が必要になる。

設定はElectronのuserData配下の`capture-organizer-settings.json`へ保存し、APIキーはOSのsafeStorageで暗号化する。暗号化が利用できない環境では保存しない。
キーは画面へ再表示せず、TaskのDB・同期・Exportには含めない。別端末では設定し直す。
保存済み設定を削除すると環境変数の設定へ戻る。環境変数もなければ未設定になる。
壊れた設定は画面から削除するか、キーを再入力して保存し直せる。

## 環境変数で設定する場合

画面で保存した設定が優先され、保存済み設定がない場合だけ以下を使う。
このモジュールは`.env`ファイルを自動では読まない。
`.env.example`は変数名の見本として使う。OSまたは起動用シェルの環境変数へ設定した後、Desktopを終了して同じ環境から起動し直す。
Android側にはAPIキーを設定せず、Desktop Gatewayとの既存のペアリングを利用する。

## 設定

| 環境変数                      | 内容                                                            |
| ----------------------------- | --------------------------------------------------------------- |
| `TASKEN_CAPTURE_LLM_PROVIDER` | `openai` / `azure` / `gemini` / `opencode-zen` / `opencode-go`  |
| `TASKEN_CAPTURE_LLM_MODEL`    | 利用するモデルID。Azureではデプロイ名。必須であり自動選択しない |
| `TASKEN_CAPTURE_LLM_API_KEY`  | 選んだプロバイダーのAPIキー                                     |
| `TASKEN_CAPTURE_LLM_ENDPOINT` | Azureのみ。例: `https://YOUR-RESOURCE.openai.azure.com/`        |

provider・model・APIキーのどれかが未設定なら整理機能を無効として返す。
不正なprovider、モデルID、Azure接続先は設定エラーになる。
AzureはHTTPSのresource originだけを受け付け、パス・ユーザー情報・query・独自portを認めない。
`*.openai.azure.com`と`*.services.ai.azure.com`のresourceに対応する。
それ以外のプロバイダーの接続先は固定で、任意URLへの送信機能は持たない。

## API方式と対象範囲

- OpenAI: `/v1/chat/completions`のstrict JSON Schema出力。Chat CompletionsのStructured Outputs対応モデルを指定する。[OpenAI公式ガイド](https://developers.openai.com/api/docs/guides/structured-outputs)
- Azure OpenAI: resourceの`/openai/v1/chat/completions`へAPIキーで認証。Structured Outputs対応デプロイを指定する。[Microsoft公式ガイド](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs)
- Gemini: `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`へ`x-goog-api-key`で認証。`generationConfig.responseMimeType`と`responseJsonSchema`を送る。[Google公式API参照](https://ai.google.dev/api/generate-content)
- OpenCode Zen / Go: OpenAI互換Chat Completionsのみ。Zenは`https://opencode.ai/zen/v1/chat/completions`、Goは`https://opencode.ai/zen/go/v1/chat/completions`を使用する。[Zen公式](https://opencode.ai/docs/zen/)、[Go公式](https://opencode.ai/docs/go/)

OpenCodeは同じプロバイダー内でもモデルごとにwire形式が異なる。
2026-09-05に公式のChat Completions欄を確認した以下のモデルIDだけを許可する。

| プロバイダー | この実装で受け付けるID                                                                                                                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zen          | `deepseek-v4-pro`, `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`, `minimax-m3`, `minimax-m2.7`, `minimax-m2.5`, `glm-5.3-flash`, `glm-5.3`, `glm-5.2`, `glm-5.1`, `glm-5`, `kimi-k2.5`, `kimi-k2.6`, `kimi-k2.7-code`, `kimi-k3`, `big-pickle` |
| Go           | `glm-5.3-flash`, `glm-5.3`, `glm-5.2`, `glm-5.1`, `kimi-k3`, `kimi-k2.7-code`, `kimi-k2.6`, `longcat-2.0`, `deepseek-v4-pro`, `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`, `mimo-v2.5`, `mimo-v2.5-pro`                                      |

ZenのGPT・Claude・Gemini系やGoのMiniMaxなど別形式のモデルは、この実装では設定エラーにする。
同じChat CompletionsでもモデルによるJSON Schema対応の差があるため、上記は経路の対応表であり実通信成功の保証ではない。
非対応モデルへの自動切替、形式を緩めた再送、他プロバイダーへの転送はしない。

## 入力と提案の境界

- 入力は原文最大12000文字、録音時刻`capturedAt`、IANA time zone、選択Theme、最大200件のTheme候補。辞書は最大4000文字で保存し、送信時は改行またはカンマで最大100語に分ける。
- 相対日は録音時刻を指定time zoneへ変換した現地日付・時刻・曜日に基づく。今日から14日先までの日付と曜日の対応表も渡し、「次の金曜」などは表を正本に解決させる。日付の言及がなければ予定はnull、曖昧な場合はwarningを返すよう指示する。
- 「今日・明日・明後日」はそれぞれの実日付も渡す。数値の日付と曜日が食い違う場合は推測で選ばず、日付を未設定にして注意を返すよう指示する。発話の言い直しは最後の明示的な訂正を優先し、不確かな専門語は断定して置換しない。
- Androidでは認識開始時の時刻とtime zoneを音声Draftに保持する。数日前に作った下書きへ話した場合もDraft作成日を発話日に流用しない。既存Draftにこの情報がない場合だけ従来の作成日時を使う。
- 原文とTheme名はJSONデータとしてsystem指示と分離する。作業の捏造を禁止し、背景・迷いはsupplementへ残すよう指示する。
- Androidは一度の入力から最大8件、Desktop Quick Captureは現在の確認UIに合わせ1件の提案を受け取る。提案ごとにタイトル500文字、checklist最大20件×200文字、supplement12000文字、warnings最大10件×500文字。
- 不正な日付、逆転した日付範囲、候補外Theme、余分なキー、途中終了・拒否・形式不正は採用可能な提案として返さない。
- 意味の正しさはJSON Schemaだけでは証明できない。日付やTask分解は利用者の確認を要する。

Mobile要求の`maxTasks`は省略時1件。新Androidは8件を要求し、`proposals`配列をプレビューする。Desktopは従来の`proposal`も返し、旧Androidの1件入力を維持する。

予定時刻に対応するAndroidは`includePlannedTime:true`も要求する。
この場合だけ、Desktopは`plannedTimeSupported:true`と、各提案に必須nullableの`plannedStartTime`（`HH:mm`）・`plannedDurationMinutes`（整数1〜10080分）を返す。
指定のない旧クライアントには時刻フィールドを追加せず、時刻の言及は補足・注意に残す。
旧Desktopが`validation_failed`で拒否した場合、新Androidは時刻拡張を外した複数提案要求、その要求も拒否された場合だけ従来の1件要求へ戻す。
その整理案では時刻・所要時間を編集できず、Desktop更新後の再整理を案内する。対応状態は下書きとともに保存する。

「明日の15時から30分」は実行日・予定開始・所要時間へ、「15時、いや16時」は最後の明示訂正へ接続するよう指示する。
「30分」だけで日付や開始時刻を補わず、「午後」など幅のある指定を固定時刻へ変換しない。判断できない部分は未指定にして注意と原文を残す。
開始時刻は期限時刻ではなく、今日の割当を自動で追加する情報でもない。
DesktopとAndroidで確認・編集した値だけを、既存CreateTaskの予定項目と日付へ一度に保存する。
旧GatewayがCreateTaskの予定項目を拒否した場合も、それを削って再送せず、入力・未送信コマンドを保持する。
Desktopの相対日基準も入力開始時に固定し、整理失敗・再整理で日付が変わらないようにする。

1回の要求は30秒で中止し、応答本文は展開後256KiBまで読む。
Mobile Gatewayの要求本文も256KiBを上限とし、日本語の原文・補足を含む整理済みTaskを受け付ける。
リダイレクトは拒否する。raw providerエラーや入力本文を例外へ含めず、共通の再試行案内だけを返す。
OpenAI/Azureには`store:false`を指定するが、プロバイダーの処理・保持方針全般を無効にするものではない。

## 検証

`rtk node scripts/run-electron-node.mjs --test tests/mobile-capture-organizer.test.mjs tests/mobile-capture-organization-gateway.test.mjs tests/quick-capture-organization.test.mjs`

fake fetchで5プロバイダーの送信形式、日付基準、ローカル検証、拒否、サイズ制限、timeout、秘密を含めない失敗を確認する。
APIキーを使う実通信とモデルごとの整理品質は別の検証境界であり、このテストでは確認しない。

共通設定とDesktop入力の回帰確認:

```sh
rtk node --test tests/capture-organizer-settings.test.mjs tests/settings-ia.test.mjs
rtk npm run typecheck
rtk npm run package
```

2026-09-05の隔離Electron実動確認では、設定の暗号化保存・再起動後の復元・削除、失敗時の入力保持、Azure欄、ライト／ダーク表示を確認した。
Quick Captureは推論応答だけを固定fixtureへ置き換え、編集したタイトル・補足・原文・チェック項目・期限を実際のCreateTask経路で保存して正本から読み戻した。
日付逆転時の入力保持、元の入力への復元、整理待ち中の編集に対する古い結果の破棄も確認した。
接続成功の画面表示にはテスト応答を用い、実APIの成功とは区別した。実キーによる通信・整理品質は未検証。
2026-09-06にはWindows配布版でも、隔離userDataでTaskの原文・3件のチェック項目の復元、設定の保存・再起動後の復元・削除を確認した。NSIS／portableの生成も成功した。

同日の予定時刻対応では、Androidのunit 140件、整理UI 7件、Gateway互換6件、Outbox 54件、Draft保存7件が成功した。
予定開始・所要時間の編集、無効値で追加を止める動作、追加Taskの整理案と編集中の時刻の復元、CreateコマンドとRoomの保存後再読込を確認した。
検証用Androidエミュレータの展開幅とcompact幅で、日付と時刻の区別、追加Taskの編集欄、キーボード表示中のfocusとスクロールを目視した。
Windowsの隔離Electronでも、整理失敗・元の入力への復元・再整理を経て入力開始時の日時とtime zoneが維持されること、無効な所要時間で保存を止めること、保存失敗後も編集値が残ることを確認した。
予定開始16:30・所要75分へ編集してCreateTaskへ保存し、SQLiteを開き直して原文・日付・予定値を読み戻した。ライト／ダーク表示も目視した。
これらの提案は固定fixtureであり、実音声認識・実APIによる時刻解釈の品質を示す結果ではない。
