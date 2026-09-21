# Google Calendar 実接続の確認（#273）

Calendar連携は adapter・OAuth・IPC・Today/Activityの表示まで実装済みで、mockとfixtureでは検証している。
**実アカウントでの接続だけが未検証**であり、この手順で確かめる。
設計と表示の規則は [issue-design-plan-2026-09-20.md](./issue-design-plan-2026-09-20.md) の「Calendarの残作業」。

## 前提

- Google Cloud で **OAuth 2.0 クライアントID（アプリケーションの種類: デスクトップ アプリ）** を作る。
  デスクトップ種別は loopback（`http://127.0.0.1:<port>`）のリダイレクトを追加設定なしで許可する。
- クライアントIDは環境変数 `TASKEN_GOOGLE_CLIENT_ID` で渡す。**リポジトリへ書かない。**
- 接続はブラウザでの本人の同意が必要（Googleの同意画面）。

## 先に種類を確かめる（同意画面を開かない）

client ID が**デスクトップ アプリ**種別かどうかは、token endpointへ**わざと無効なcode**を送ると分かる
（secretもcodeもtokenも送らない。同意画面は開かない）。

```powershell
rtk npm run doctor:calendar-client
```

- デスクトップ アプリ種別なら `client_kind: "public_client"`（終了コード0）。
- Web アプリ種別なら `client_kind: "confidential_client"`（終了コード1）で、
  「デスクトップ アプリ種別で作り直す」案内が出る。
- 出力は `oauth_error` と種類、client IDの短い指紋だけ。**本文やclient IDの全文は残さない。**

## 実行

```powershell
$env:TASKEN_GOOGLE_CLIENT_ID = "<desktop app client id>"
npm run smoke:calendar-live
```

- **同意画面を開く前にclient種別を確かめる**（`doctor:calendar-client` と同じ判定）。
  Webアプリ種別のままなら、5分待たずにその場で「デスクトップ アプリ種別で作り直す」案内を出して止まる。
  ネットワークで判定できないときは警告だけ出して続行する。
- 環境変数が無いときは**ユーザー環境変数（レジストリ）も見る**。設定直後でシェルが古くても動く。
- 隔離した一時userDataでビルド済みアプリを起動する。**本プロファイルと実データには触れない。**
- 同意はブラウザで行う。アプリ側の待ち時間は**5分**（`OAUTH_TIMEOUT_MS`）。smokeの待ちは
  `TASKEN_CALENDAR_CONSENT_TIMEOUT_MS` で変更できる。**2分では足りない**ことを実接続で確認したため5分にした。
- 同意を途中でやめた場合は「認証がタイムアウトしました」と出る。接続は作られないので、そのまま再試行できる。
- 失敗の種類は標準エラーへ `TASKEN_CALENDAR_OAUTH_FAILED` として出す（tokenやcodeは出さない）。
  `hint` が原因の切り分けを示す: `client_type`（クライアント種別）／`redirect_uri`／`code_rejected`／
  `client_unknown`。
- 証跡は `output/playwright/calendar-live` へ出す。

## 確認する項目

| #   | 確認               | 期待                                                                  |
| --- | ------------------ | --------------------------------------------------------------------- |
| 1   | 未接続のToday      | 予定欄を出さず、入口はSettingsだけ                                    |
| 2   | Settingsの初期状態 | 「未接続」                                                            |
| 3   | Googleで接続       | 「接続済み」とアカウント名が出る                                      |
| 4   | 当日の予定         | 取得時刻が出る。0件なら「今日の予定はありません」（失敗と混同しない） |
| 5   | 再取得             | 「更新」で取得時刻が進む                                              |
| 6   | Activityの時間軸   | 同じ予定が時刻順に出る。終日は専用行                                  |
| 7   | 接続解除           | ローカルで完結して「未接続」へ戻り、Todayから予定欄が消える           |
| 8   | 認証情報           | 隔離userDataの中だけ。リポジトリ直下に漏れない                        |

## 実接続で見つかったこと

| 日付       | 症状                                                             | 原因と対応                                                                                                                                                                                                                                                                                                                                                               |
| ---------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-09-21 | 同意の途中で「認証がタイムアウトしました」                       | アプリの待ち時間が2分で、Googleのアカウント選択と同意には足りなかった。**5分へ延ばした**                                                                                                                                                                                                                                                                                 |
| 2026-09-21 | token交換が `status 400` / `oauth_error: invalid_request` で失敗 | **原因を確定**: 設定されていたclient IDは**Web アプリケーション種別**だった。`npm run doctor:calendar-client` が同じclient IDで `client_secret is missing.` を再現し、`client_kind: "confidential_client"` と判定する。デスクトップ種別はPKCEだけで交換できる（この実装は client secret を持たない）ため、**「デスクトップ アプリ」種別でclient IDを作り直す**必要がある |

失敗の種類は標準エラーへ
`TASKEN_CALENDAR_OAUTH_FAILED {"provider":"google","status":400,"oauth_error":"...","hint":"..."}`
として出る（providerの本文・token・codeは出さない）。`hint` は `client_type` / `redirect_uri` /
`code_rejected` / `client_unknown` / `unknown` のいずれかで、次に直す場所を示す。

## mockで確認済み（実接続では再確認しない）

`tests/calendar-integration.test.mjs` が持つ範囲。実接続で見つかった差分だけをここへ足す。

- Google adapterのpageToken、終日予定、private予定の伏せ字
- PKCE + loopbackのOAuth、stateの取り違え拒否、client ID未設定の拒否
- 日付範囲のローカルtimezoneオフセット、キャッシュのstale表示、エラー分類
- Today/Activity/SettingsのDOMとCSSの存在

## 表示の状態（実装）

Todayの予定欄の状態は `src/renderer/src/features/workspace/lib/calendarState.ts` が決め、
`tests/today-calendar-state.test.mjs` が文言ごと固定する。**「まだ取得できていない」を0件と書かない。**

| 状態                    | 画面                                               | 判定                                                            |
| ----------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| 未接続                  | 予定欄を出さない（入口はSettingsだけ）             | `connected === false`                                           |
| 取得中（結果なし）      | 「予定を取得中…」                                  | まだ結果が無い                                                  |
| 当日の取得成功で0件     | 「今日の予定はありません」                         | `fetchedAt` があり `events` が空                                |
| 取得成功で予定あり      | 一覧（終日は先頭、次の予定を強調）                 | `events` が1件以上                                              |
| offlineでキャッシュあり | 既存予定＋「最終更新 14:20／更新できません」       | `stale === true`                                                |
| 取得成功履歴なし        | 「予定を取得できません」                           | `events` が空で `fetchedAt` も空                                |
| 認証失効                | 「再接続」でSettingsの連携へ戻る。Taskの一覧は残る | `errorCode` が `authentication_required` / `token_expired` など |
| その他の失敗            | エラー文と「再試行」                               | 上記以外の `error`                                              |

更新中でも結果があれば一覧を消さない（前回の結果を保持し、更新操作に「取得中」を出す）。

## 実接続でまだ確認していないこと

| 未確認         | 内容                                                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 実アカウント   | **client IDが Web アプリ種別のため未接続**（`npm run doctor:calendar-client` で確定）。デスクトップ アプリ種別で作り直してから `smoke:calendar-live` を実行する |
| 同意の失効     | 実アカウントで同意を取り消した後の再取得（`authentication_required` の実挙動）                                                                                  |
| token更新      | 1時間を超える利用での refresh_token による更新                                                                                                                  |
| 複数カレンダー | 初期実装はprimary calendarのみ。複数選択は別slice                                                                                                               |
| offline        | 実回線断でのキャッシュ表示（状態の判定と文言はmockで確認済み）                                                                                                  |
| 権限の最小化   | 実接続後に不要scopeを削減できるかの確認                                                                                                                         |
