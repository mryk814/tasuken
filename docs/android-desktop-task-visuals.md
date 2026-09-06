# AndroidのTask表示とTheme色

Desktopの完了操作とTheme色をAndroidの一覧・詳細へ揃える。

- `TaskCompletionControl` は22dpの丸い完了表示を48dp以上の操作領域へ置く。完了時はdesign-standardのsuccess色を使い、Checkboxの選択状態・無効状態・クリック操作を保持する。
- `ColoredThemeLabel` はTheme自身の色を使う。`chart-1`〜`chart-6`は `design-standard/tokens.json`、追加4色のsRGB混色はDesktopの `app.css` と一致させる。
- 色指定がないThemeはDesktopのTheme一覧順による従来の色選択をGatewayで解決する。旧Desktopから色が返らない場合は `chart-1` を表示する。
- Today・ToDo一覧はTaskの下にChecklistを3件まで横並びで表示し、その場で完了／未完了を変更できる。各項目は小さな丸と1行のラベルで表し、長い名前は省略、狭い画面では折り返す。項目全体をタップできる44dp以上の領域を保つ。残りの項目は「ほかN項目」から詳細で確認する。Task本体の完了操作は右側に置く。
- 詳細ではTask名・Checklist項目名・予定の表示をタップして同じ場所で編集する。鉛筆アイコンも入口として残す。名前はキーボードの確定または保存で反映し、保存失敗や編集欄を閉じた場合も未保存入力を保持する。

## 配信と保存の互換性

`GET /v1/themes` に `includeColors=true` を指定した場合だけ、各Themeへ `color` を追加する。指定しない従来クライアントには `id` / `title` のみを返す。色を含むページのcursorは色変更時も無効になる。

Androidは色を要求し、旧Desktopが追加queryを `400 validation_failed` で拒否した場合、初回ページを従来queryで再取得する。その後のページも従来queryを使う。

Room 18→19では `theme_cache.color` のnullable列のみを追加する。既存Theme・Task・未送信Outboxは保持し、次のTheme同期で色を補完する。

## 回帰検証

- `tests/mobile-gateway-phase4a.test.mjs`: 色のopt-in、旧形式維持、既存Themeの色、未指定色、色変更時のcursor失効。
- `TaskVisualsColorTest` / `TaskVisualsUiTest`: Desktop token一致、48dpの操作領域、Checkbox状態、無効時の操作抑制。
- `MobileThemeContractTest` / `MobileThemeCatalogRepositoryTest`: 色の検証、キャッシュからUIへの伝播、旧Desktopへのfallback。
- `MobileLocalDatabaseMigrationTest`: 18→19移行でThemeとOutboxを保持。
- `TaskInlineEditingUiTest` / `TaskDailyDetailUiTest`: 直接編集時のfocus、失敗時の入力保持と再保存、一覧からのChecklist完了、未保存の項目名と予定の保持。
