# Android入力のAI整理に使うプロバイダー

Desktopの`src/main/gateway/mobile/captureOrganizer.ts`が、利用者の整理要求に対して提案だけを返す。
Taskの保存や既存データの変更は行わない。採用まで原文を保持し、返答をプレビューで確認する。
Androidの整理操作はTask入力にだけ表示する。整理を取り消すと原文と整理前のThemeへ戻る。
APIキーはDesktopのプロセス環境から読み、Android・ログ・返答・プロンプトへ含めない。
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

- 入力は原文最大12000文字、録音時刻`capturedAt`、IANA time zone、選択Theme、最大200件のTheme候補。
- 相対日は録音時刻を指定time zoneへ変換した日付に基づく。日付の言及がなければ予定はnull、曖昧な場合はwarningを返すよう指示する。
- Androidでは認識開始時の時刻とtime zoneを音声Draftに保持する。数日前に作った下書きへ話した場合もDraft作成日を発話日に流用しない。既存Draftにこの情報がない場合だけ従来の作成日時を使う。
- 原文とTheme名はJSONデータとしてsystem指示と分離する。作業の捏造を禁止し、背景・迷いはsupplementへ残すよう指示する。
- 提案はタイトル500文字、checklist最大20件×200文字、supplement12000文字、warnings最大10件×500文字。
- 不正な日付、逆転した日付範囲、候補外Theme、余分なキー、途中終了・拒否・形式不正は採用可能な提案として返さない。
- 意味の正しさはJSON Schemaだけでは証明できない。日付やTask分解は利用者の確認を要する。

1回の要求は30秒で中止し、応答本文は展開後256KiBまで読む。
Mobile Gatewayの要求本文も256KiBを上限とし、日本語の原文・補足を含む整理済みTaskを受け付ける。
リダイレクトは拒否する。raw providerエラーや入力本文を例外へ含めず、共通の再試行案内だけを返す。
OpenAI/Azureには`store:false`を指定するが、プロバイダーの処理・保持方針全般を無効にするものではない。

## 検証

`node scripts/run-electron-node.mjs --test tests/mobile-capture-organizer.test.mjs`

fake fetchで5プロバイダーの送信形式、日付基準、ローカル検証、拒否、サイズ制限、timeout、秘密を含めない失敗を確認する。
APIキーを使う実通信とモデルごとの整理品質は別の検証境界であり、このテストでは確認しない。
