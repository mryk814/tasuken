# AndroidでThemeの目的・現在地を読む

Task詳細の「Themeの目的・現在地を読む」から、既存のTheme CharterとStateを表示する。
Task詳細はDialogの背後に保持し、閉じたときも選択とスクロール位置を保つ。
編集やAIへの外部共有は追加しない。

## 読み取りと保存

- `GET /v1/theme-context` は `apiVersion=1`、`schemaVersion=7`、`themeId` を受け取る。
- 本人端末の `mobile:read` 権限を使う。AI公開設定で本人の閲覧を制限しない。
- Healthの `mobile.theme-context.read` は対応するread portがあるGatewayだけが返す。
- Theme名・version・更新日時とCharter/Stateだけを返し、既存Theme catalogの色opt-inは変更しない。
- 未設定のCharter/Stateはnull。削除済みThemeはHTTP 200の `not_found`、旧Gatewayの404は非対応として区別する。
- Room 24でserver/Theme別の `theme_context_cache` を追加する。23→24移行は既存Task、Capture、関連資料、outboxを変更しない。
- 取得時刻と失敗状態も保存し、再起動やoffline時は前回取得済み内容を読める。「古い可能性」を常に明示し、未受信の変更を検出済みとは扱わない。
- 削除受信時は古い本文を除外する。同一serverから検証済みの401/403を受けた場合はThemeと関連資料の本人閲覧cacheを削除する。取得中の古い応答が削除後にcacheを復元しないよう、DAOの世代を確認して保存する。

## 検証

- `tests/mobile-theme-context.test.mjs`: Kotlin golden parity、本人権限と旧Gateway、未設定・削除・長文、実SQLiteのDesktop更新と再起動。
- `MobileThemeContextContractTest`: strict DTOとUnicode/文字数の境界。
- `MobileThemeContextDatabaseTest`: 更新、再読込とoffline、最大長文、旧Gateway、権限失効と並行応答。
- `MobileThemeContextGatewayTest`: 実HTTP/Core/SQLiteの更新を取得し、Android別プロセスでoffline再表示、Desktop再起動後の同内容と削除受信を確認。
- `MobileLocalDatabaseMigrationTest`: 23→24移行で既存関連資料を保持する。
- `MobileThemeContextUiTest` / `MobileThemeContextTodayUiTest`: 全項目・長文・未取得・非対応・未設定・部分入力・削除・権限失効、Task詳細への往復。

2026-09-08に専用read-only Pixel 8 emulatorでRoom/migration/UI 32件、expanded UI 3件、実Gateway 4フェーズを実行した。
411dp / 1200dpの全画面スクリーンショットで、長文スクロール中も戻る導線が表示され、本文と未取得・非対応・未設定・削除・権限失効を判別できることを目視した。
個人の物理端末・実Gateway・実データはこの検証に使わない。
