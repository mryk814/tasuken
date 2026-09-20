# Google Calendar 実接続の確認（#273）

Calendar連携は adapter・OAuth・IPC・Today/Activityの表示まで実装済みで、mockとfixtureでは検証している。
**実アカウントでの接続だけが未検証**であり、この手順で確かめる。
設計と表示の規則は [issue-design-plan-2026-09-20.md](./issue-design-plan-2026-09-20.md) の「Calendarの残作業」。

## 前提

- Google Cloud で **OAuth 2.0 クライアントID（アプリケーションの種類: デスクトップ アプリ）** を作る。
  デスクトップ種別は loopback（`http://127.0.0.1:<port>`）のリダイレクトを追加設定なしで許可する。
- クライアントIDは環境変数 `TASKEN_GOOGLE_CLIENT_ID` で渡す。**リポジトリへ書かない。**
- 接続はブラウザでの本人の同意が必要（Googleの同意画面）。

## 実行

```powershell
$env:TASKEN_GOOGLE_CLIENT_ID = "<desktop app client id>"
npm run smoke:calendar-live
```

- 隔離した一時userDataでビルド済みアプリを起動する。**本番プロファイルと実データには触れない。**
- 同意はブラウザで行う。既定5分待つ（`TASKEN_CALENDAR_CONSENT_TIMEOUT_MS` で変更できる）。
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

## mockで確認済み（実接続では再確認しない）

`tests/calendar-integration.test.mjs` が持つ範囲。実接続で見つかった差分だけをここへ足す。

- Google adapterのpageToken、終日予定、private予定の伏せ字
- PKCE + loopbackのOAuth、stateの取り違え拒否、client ID未設定の拒否
- 日付範囲のローカルtimezoneオフセット、キャッシュのstale表示、エラー分類
- Today/Activity/SettingsのDOMとCSSの存在

## 実接続でまだ確認していないこと

| 未確認         | 内容                                                                           |
| -------------- | ------------------------------------------------------------------------------ |
| 同意の失効     | 実アカウントで同意を取り消した後の再取得（`authentication_required` の実挙動） |
| token更新      | 1時間を超える利用での refresh_token による更新                                 |
| 複数カレンダー | 初期実装はprimary calendarのみ。複数選択は別slice                              |
| offline        | 実回線断でのキャッシュ表示（mockでは確認済み）                                 |
| 権限の最小化   | 実接続後に不要scopeを削減できるかの確認                                        |
