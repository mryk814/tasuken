# Google Calendar 実接続の確認（#273）

Calendar連携は adapter・OAuth・IPC・Today/Activityの表示まで実装済みで、mockとfixtureでは検証している。
**実アカウントでの接続だけが未検証**であり、この手順で確かめる。
設計と表示の規則は [issue-design-plan-2026-09-20.md](./issue-design-plan-2026-09-20.md) の「Calendarの残作業」。

## 前提

- Google Cloud で **OAuth 2.0 クライアントID（アプリケーションの種類: デスクトップ アプリ）** を作る。
  デスクトップ種別は loopback（`http://127.0.0.1:<port>`）のリダイレクトを追加設定なしで許可する。
- クライアントIDは環境変数 `TASKEN_GOOGLE_CLIENT_ID`、**クライアントシークレットは
  `TASKEN_GOOGLE_CLIENT_SECRET`** で渡す。**どちらもリポジトリへ書かない。**
- 接続はブラウザでの本人の同意が必要（Googleの同意画面）。

### Googleはデスクトップ アプリ種別でもclient secretを要求する（実測・#273）

Googleのtoken endpointは、PKCEを使っていてもsecretが無い交換を
`invalid_request: client_secret is missing.` で拒否する。**公式ドキュメントは`client_secret`を
`Optional`と書いているが、デスクトップ アプリ種別では必須**である（Web アプリ種別の話ではない）。

- したがって `TASKEN_GOOGLE_CLIENT_SECRET` を設定する。値はデスクトップ アプリ種別の
  「クライアント シークレット」で、Google自身が「アプリに埋め込むもので秘密ではない」と扱う。
- Taskenは`google`だけにsecretを送る（MicrosoftはPKCEだけで通るため送らない）。
- secretはtoken交換とrefreshでのみ送り、**画面・ログ・エラー文・Exportへ出さない**。
- 参考: [Google Developer forums](https://discuss.google.dev/t/is-it-ok-to-put-a-client-secret-in-a-desktop-app/296820)、
  [同じ症状の報告（loopback + PKCE + secret無し）](https://discuss.google.dev/t/google-auth-platform-question-about-desktop-app-client-and-secret/178938)

```powershell
# ユーザー環境変数へ設定する（値はGitへ入れない）
[Environment]::SetEnvironmentVariable("TASKEN_GOOGLE_CLIENT_ID", "<desktop app client id>", "User")
[Environment]::SetEnvironmentVariable("TASKEN_GOOGLE_CLIENT_SECRET", "<desktop app client secret>", "User")
```

## 先に種類を確かめる（同意画面を開かない）

client ID が**デスクトップ アプリ**種別かどうかは、token endpointへ**わざと無効なcode**を送ると分かる
（secretもcodeもtokenも送らない。同意画面は開かない）。

```powershell
rtk npm run doctor:calendar-client
```

- デスクトップ アプリ種別なら `client_kind: "public_client"`（終了コード0）。
  `client_secret is missing.` が返っても**種別はデスクトップ**で、secretを設定すれば通る。
- 登録の無いclient IDは `client_kind: "unknown_client"`（終了コード1）で、値のコピー漏れを案内する。
- 出力は `oauth_error` と種類、client IDの短い指紋だけ。**本文やclient IDの全文は残さない。**

## 実行

```powershell
$env:TASKEN_GOOGLE_CLIENT_ID = "<desktop app client id>"
$env:TASKEN_GOOGLE_CLIENT_SECRET = "<desktop app client secret>"
npm run smoke:calendar-live
```

- **同意画面を開く前にclient種別を確かめる**（`doctor:calendar-client` と同じ判定）。
  登録の無いclient IDなら、5分待たずにその場で案内を出して止まる。
  ネットワークで判定できないときは警告だけ出して続行する。
- 環境変数が無いときは**ユーザー環境変数（レジストリ）も見る**。設定直後でシェルが古くても動く。
- 隔離した一時userDataでビルド済みアプリを起動する。**本プロファイルと実データには触れない。**
- 同意はブラウザで行う。アプリ側の待ち時間は**5分**（`OAUTH_TIMEOUT_MS`）。smokeの待ちは
  `TASKEN_CALENDAR_CONSENT_TIMEOUT_MS` で変更できる。**2分では足りない**ことを実接続で確認したため5分にした。
- 同意を途中でやめた場合は「認証がタイムアウトしました」と出る。接続は作られないので、そのまま再試行できる。
- 失敗の種類は標準エラーへ `TASKEN_CALENDAR_OAUTH_FAILED` として出す（tokenやcodeは出さない）。
  `hint` が原因の切り分けを示す: `client_secret`（secret未設定/値違い）／`redirect_uri`／
  `code_rejected`／`client_unknown`。
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
| 2026-09-26 | 同意後に「Googleの認証が必要です」で拒否（`invalid_grant`）      | **client種別ではなくsecretの欠落だった**。`doctor:calendar-client` の初版が `client_secret is missing.` を「Web アプリ種別」と誤判定していた。同じDesktop clientへ無効codeを送っても同じ応答が返る。`TASKEN_GOOGLE_CLIENT_SECRET` 対応とdoctorの判定修正を行った（下記）。加えて、**callbackの重複で同じ認証コードを2回交換し得る欠陥**も修正した                        |

### Googleのデスクトップ アプリ種別はsecret必須（2026-09-26・実測）

secret無しで交換すると `invalid_request: client_secret is missing.` が返る。これは「Web アプリ種別だから」
ではなく、**デスクトップ アプリ種別でもsecretを要求するGoogleの実装**である（公式ドキュメントは`Optional`と記載）。
同意画面は最後まで通るため、画面上は「同意したのに拒否された」に見える。

| 送った内容                     | Googleの応答                                     | 次に直す場所                             |
| ------------------------------ | ------------------------------------------------ | ---------------------------------------- |
| client_id + code（secret無し） | `400 invalid_request: client_secret is missing.` | `TASKEN_GOOGLE_CLIENT_SECRET` を設定する |
| client_id + secret違い         | `400 invalid_client`                             | secretの値をコピーし直す                 |
| 登録の無いclient_id            | `404 invalid_client`                             | client IDの値をコピーし直す              |

Taskenは`google`にだけsecretを送り、MicrosoftはPKCEのままにする（`CalendarService.tokenAuthParams`）。

### callbackの重複（実装の欠陥・2026-09-26修正）

loopbackのcallbackは同じ認証コードでも何度でも受け付け、成功・失敗いずれの経路も複数回resolve/rejectし得た。
Googleの認証コードは1回限りなので、ブラウザの再送や「戻る」で2回目の交換が起きると `invalid_grant` になる。
**1回の接続で交換するのは1回だけ**にし、処理済みのcallbackへは409を返す（`calendarService.listenForAuthCode`）。
`tests/calendar-integration.test.mjs` の「OAuth callback exchanges the authorization code only once」が固定する。

### 同意後に拒否されたときの見分け方（2026-09-26）

端末の画面の文言は失敗の種類ごとに分かれている。`invalid_grant` は `authentication_required` へ分類される。

| 画面の文言                                         | 意味                                            | 次に直す場所                                    |
| -------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| 「Google連携が未設定です。…クライアントIDを設定…」 | client IDが空                                   | 環境変数 `TASKEN_GOOGLE_CLIENT_ID`              |
| 「Googleの認証が必要です。Settingsから再接続…」    | token交換をGoogleが拒否（`invalid_grant` など） | `TASKEN_GOOGLE_CLIENT_SECRET` とclient IDの種別 |
| 「Googleのカレンダー権限への同意が必要です。…」    | 同意そのものが未完了                            | ブラウザでの同意を最後まで終える                |
| 「カレンダー権限が拒否されました。…」              | 同意画面で拒否した                              | 同意し直す                                      |

client IDやsecretを変えたら**アプリを完全に終了して起動し直す**（環境変数は起動時に一度だけ読む）。

失敗の種類は標準エラーへ
`TASKEN_CALENDAR_OAUTH_FAILED {"provider":"google","status":400,"oauth_error":"...","hint":"..."}`
として出る（providerの本文・token・code・secretは出さない）。`hint` は `client_secret` / `redirect_uri` /
`code_rejected` / `client_unknown` / `unknown` のいずれかで、次に直す場所を示す。

## mockで確認済み（実接続では再確認しない）

`tests/calendar-integration.test.mjs` が持つ範囲。実接続で見つかった差分だけをここへ足す。

- Google adapterのpageToken、終日予定、private予定の伏せ字
- PKCE + loopbackのOAuth、stateの取り違え拒否、client ID未設定の拒否、同じ認証コードの二重交換の拒否
- Googleのtoken交換とrefreshでclient secretを送る（Microsoftへは送らない）
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

| 未確認         | 内容                                                                                                                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 実アカウント   | **secret未設定のため未接続**。デスクトップ アプリ種別のclient ID（`753087716606-…`・指紋 `a893ef9f`）は確認済みで、`TASKEN_GOOGLE_CLIENT_SECRET` を設定して `smoke:calendar-live` を実行する。2026-09-26時点で未解消 |
| secret付き交換 | secretを送ったtoken交換とrefreshの実測。mockでは固定済み                                                                                                                                                             |
| 同意の失効     | 実アカウントで同意を取り消した後の再取得（`authentication_required` の実挙動）                                                                                                                                       |
| token更新      | 1時間を超える利用での refresh_token による更新                                                                                                                                                                       |
| 複数カレンダー | 初期実装はprimary calendarのみ。複数選択は別slice                                                                                                                                                                    |
| offline        | 実回線断でのキャッシュ表示（状態の判定と文言はmockで確認済み）                                                                                                                                                       |
| 権限の最小化   | 実接続後に不要scopeを削減できるかの確認                                                                                                                                                                              |
