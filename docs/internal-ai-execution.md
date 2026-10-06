# Tasken内部AIの実行方針（#625）

Tasken自身がAIを呼ぶ処理は、利用者が持つChatGPTの契約枠（Sign in with ChatGPT / ChatGPT plan usage）を既定にする。
APIキーによる従量課金は、利用者が明示的に選んだときだけ使うfallbackとし、月間の送信上限を持たせる。
外部AIがMCPでTaskenを使う経路（External AI → MCP → Tasken）とは、認証も課金境界も分ける。

## call site棚卸し（2026-10-06、main `9e7be15f`）

Tasken内でLLMへ送るのは、Desktopの`src/main/gateway/mobile/captureOrganizer.ts`の`requestJson`と、AndroidのPCなし整理（`DirectCaptureOrganizer.kt`）だけだった。
Desktopの3機能は同じ`requestJson`を通るため、ここにChatGPTの契約経路を加えると3機能をまとめて移行できる。

| 機能                                         | 入口                                                   | 移行前の経路                           | 種別           | 構造化出力         | 分類                                         |
| -------------------------------------------- | ------------------------------------------------------ | -------------------------------------- | -------------- | ------------------ | -------------------------------------------- |
| 入力のTask整理（Quick Capture・Android経由） | `organize` / Mobile Gateway `/v1/capture-organization` | 設定したprovider API（キー必須）       | 対話・30秒以内 | strict JSON Schema | `chatgpt_plan`                               |
| 保存済みCaptureからTask候補                  | `organize`（`mode: saved_capture`）                    | 同上                                   | 対話           | 同上               | `chatgpt_plan`                               |
| 作業ログの分類                               | `organizeWorkLog`                                      | 同上                                   | 対話           | 同上               | `chatgpt_plan`                               |
| Taskの日程変更提案                           | `proposeTaskSchedule`                                  | 同上                                   | 対話           | 同上               | `chatgpt_plan`                               |
| AndroidのPCなし整理                          | `DirectCaptureOrganizer.kt`                            | 端末に設定したprovider API（キー必須） | 対話・PC停止中 | 同上               | `api-required`（明示opt-inのfallback。下記） |

LLMを使っていない処理（相対日の実日付表、Theme候補の照合、日付範囲・件数・文字数の検証、作業ログの文の一致確認）は従来どおりローカルで決定的に行う。
ChatGPTの契約経路でも、モデルの出力は同じローカル検証を通ってから提案になる。新しくLLMへ送る処理は追加していない。

AndroidのPCなし整理は、loopback callbackを使うSign in with ChatGPTを端末単体で完結させる追加の認証実装が要るため、今回は従来のAPIキー経路のまま残す。
既定はDesktop経由の整理であり、Desktop側をChatGPTの契約にすればAndroidからの整理もAPIキーなしで動く。PCなし整理は利用者が端末で明示的に有効化したときだけ使う。

## 実行の優先順位

1. ローカルで決定的に処理できるものはLLMへ送らない。
2. 内部AIは「ChatGPTの契約」を既定にする（未設定時の初期選択）。
3. 従量APIは、利用者がproviderとキーを入力して保存したときだけ使う。

ChatGPTの利用上限に達したとき（`subscription_sharing_usage_limit_exceeded`）は、整理を止めて上限到達を伝える。**従量APIへは自動で切り替えない。**
従量APIへの切替は、利用者がSettingsでproviderを変更して保存する明示操作に限る。

## ChatGPTの契約（Sign in with ChatGPT）

公式: [ChatGPT plan usage for open-source and locally hosted apps](https://developers.openai.com/siwc/token-sharing-open-source)。
ローカルで動くアプリは、事前のclient ID申請なしに`dynamic_agent_client`で動的登録できる（有料・リモートホストのアプリは別途申請）。

| 項目       | 実装                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| 実装       | `src/main/services/chatgptAccount.ts`（認証）、`captureOrganizer.ts`の`requestChatGptJson`（推論）                       |
| 認可       | `https://auth.openai.com/api/accounts/authorize`、PKCE S256、`state`・`nonce`は毎回新規                                  |
| callback   | `http://127.0.0.1:{port}/auth/callback`。1455番を優先し、使用中なら空きポートへ。待機は5分で中止                         |
| scope      | `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`                                          |
| 登録       | 初回は`client_id=dynamic_agent_client`と`agent_name_hint=Tasken`。callbackの発行client IDを保存して再利用                |
| host ID    | 端末ごとに固定の乱数UUID（`ext_agent_host_id`）。再接続でも同じ値                                                        |
| ID token   | JWKSでRS256署名、`iss`・`aud`（発行client ID）・`nonce`・`exp`を検証し、`sub`を固定の本人識別に使う                      |
| 許可の確認 | 付与scopeに`chatgpt.tokens.use.direct`がなければ接続を失敗にし、何も保存しない                                           |
| 推論       | `POST https://api.openai.com/v1/responses`、`store:false`・`stream:true`、`text.format`のstrict JSON Schema              |
| 成功判定   | SSEの`response.completed`を受け取ったときだけ。途中終了・`response.failed`・`incomplete`は失敗                           |
| モデル     | `GET /v1/models`の`visibility: "list"`だけをSettingsに表示し、利用者が選ぶ。自動選択はしない                             |
| 構造化出力 | `subscription_sharing_unsupported_capability`（`param`が`text…`）のときだけ形式指定を外して1回再送。ローカル検証は同じ   |
| 失効       | 401は1回だけtokenを更新して再送。`subscription_sharing_invalid_user`やrefresh不能（`invalid_grant`等）は「再接続が必要」 |
| 解除       | revocation endpointへrefresh tokenを送り、失敗してもローカルのtokenを消す                                                |

再認可のcallbackに別のclient IDが含まれる場合は拒否し、選択済みの登録と本人識別を保持する。接続解除はローカルの資格情報を先に消し、解除前に始まったrefreshや認可交換の結果を保存しない。

保存するのは`userData/chatgpt-account.json`の発行client ID・host ID・`sub`・email・**safeStorageで暗号化したrefresh token**だけ。
access tokenはメモリだけに置く。どの値もworkspace DB・同期・Export・ログ・MCP応答・Receiptへ含めない。
safeStorageが使えない環境では接続できない。

### 状態とエラー

| 状態・コード                                | 表示                                            | 再試行                  |
| ------------------------------------------- | ----------------------------------------------- | ----------------------- |
| 未接続                                      | 「ChatGPTで続ける」                             | 利用者が接続            |
| `reauth_required`（失効・refresh不能）      | 「接続が切れました」と再接続ボタン              | 利用者が再接続          |
| `subscription_sharing_usage_limit_exceeded` | 利用上限に達した。APIへは自動で切り替えていない | 利用者がChatGPT側で確認 |
| `subscription_sharing_user_not_eligible`    | このアカウントでは契約枠を外部アプリで使えない  | 同じ要求を繰り返さない  |
| それ以外（503・形式不正・timeout等）        | 共通の「整理できませんでした」                  | 利用者が再試行          |

どの失敗でも原文と入力中の内容を保持する。

## 従量API（明示opt-in）

OpenAI API・Azure OpenAI・Gemini・OpenCode Zen / Goは従来どおり使える。providerとキーを入力して保存したときだけ有効になる。
「月間の送信上限（回）」を設定すると、その月の送信回数が上限に達した時点で送信前に止める。空欄は上限なし（既存設定の互換）。
回数は`userData/capture-organizer-usage.json`に月単位で数え、接続確認の送信も含める。記録に失敗した場合は送信しない。
金額ではなく送信回数の上限であり、providerの料金は各providerの管理画面で確認する。

## 検証

`rtk node scripts/run-electron-node.mjs --test tests/chatgpt-plan-organizer.test.mjs tests/mobile-capture-organizer.test.mjs tests/capture-organizer-settings.test.mjs`

fake fetchと実loopback serverで、動的登録・PKCE・ID token署名検証・暗号化保存・refresh・失効・解除、Responsesの送信形式・SSE完了判定・上限到達で従量APIへ送らないこと・構造化出力の段階的な縮退、月間上限と月替わり、旧保存形式の互換を確認する。
実アカウントでのログインと推論品質は、本人のChatGPT契約が必要なため別の検証境界とする。
