# 開発用Workspaceデータ

## 正本

開発中の具体例確認には、材料インフォマティクス研究者「佐伯 遥」が2026年6月から利用している想定のWorkspaceを使う。
主研究はTa置換LLZO固体電解質の組成・焼成条件探索、副研究は再生Al-Mg-Si合金の熱処理最適化である。

データは通常のTaskenと同じSQLite Repositoryへ投入する。保存先はElectronの`userData`に合わせて解決される。

- Windows通常起動: `%APPDATA%\\tasken\\research-desk.sqlite`
- WSL/Linux: `$XDG_CONFIG_HOME/tasken/research-desk.sqlite`（通常は`~/.config/tasken/research-desk.sqlite`）
- 専用Windows runtime clone: `%LOCALAPPDATA%\\TaskenDevRuntime\\user-data\\research-desk.sqlite`

投入時には既存WorkspaceのSnapshotとSQLite本体を、DBと同じフォルダの`development-data-backups`へ退避する。
WSLではWindows側の`APPDATA`が環境変数へ引き継がれていても、Linux版Electronの保存先を使う。

## 再作成

```powershell
npm.cmd run workspace:materials-demo
```

```bash
# WSL / Linux
node --run workspace:materials-demo
```

WSLの`npm`がWindows側へ解決されてUNCパスエラーになる環境では、Node 22以降の`node --run`を使う。

実行すると、現在のローカルWorkspaceを退避してから、決定的なIDを持つデモWorkspaceへ完全に置き換える。
何度実行しても同じ人物・研究テーマ・Entity間の関係が再現される。

## 日付を今日へ更新する

開発を再開した日には、Workspaceを置き換えずに「今日」のSchedule、Daily Scratchpad、Status Updateだけを更新する。

```powershell
npm.cmd run workspace:materials-demo:today
```

```bash
# WSL / Linux
node --run workspace:materials-demo:today
```

既存のTask、Note、操作中に追加したデータは残る。
更新前にはSnapshotを `development-data-backups` へ保存する。
同じ日に再実行しても日付単位のEntity IDは同じになり、データ件数は増えない。

任意の日付の画面を再現する場合は `--date` を渡す。

```powershell
npm.cmd run workspace:materials-demo:today -- --date 2026-09-15
```

```bash
node --run workspace:materials-demo:today -- --date 2026-09-15
```

## 状況変化を追加する

その日に起きた状況を、TaskだけでなくSchedule、Note、Reference、履歴まで一まとまりで追加する。

```powershell
npm.cmd run workspace:materials-demo:add -- --scenario experiment
npm.cmd run workspace:materials-demo:add -- --scenario model
npm.cmd run workspace:materials-demo:add -- --scenario report
npm.cmd run workspace:materials-demo:add -- --scenario waiting
```

```bash
node --run workspace:materials-demo:add -- --scenario experiment
node --run workspace:materials-demo:add -- --scenario model
node --run workspace:materials-demo:add -- --scenario report
node --run workspace:materials-demo:add -- --scenario waiting
```

| scenario | 追加される具体例 |
|---|---|
| `experiment` | 焼成後密度のTask、当日Schedule、実験ログ、未整理の観察 |
| `model` | calibration診断Task、モデル診断Note、Evidence |
| `report` | レビュー待ちTask、進捗Report、予測と実測を分けた記述 |
| `waiting` | SEM画像の受領待ちTask、Waiting、Reminder、受領後チェックNote |

`--date YYYY-MM-DD` も併用できる。
同じ日付とscenarioの組み合わせは決定的なIDを使うため、再実行しても重複しない。
材料MI開発Workspace以外のDBでは停止する。

実データを触らず検証だけ行う場合は、任意の一時DBを指定する。

```bash
node scripts/run-electron-node.mjs scripts/seed-materials-informatics-workspace.mjs --target "${TMPDIR:-/tmp}/tasken-mi-check.sqlite"
```

`TASKEN_DB_PATH`または`TASKEN_USER_DATA_DIR`を指定すると、`--apply-local`の保存先も明示的に上書きできる。

## 見てほしい具体例

- Today: 当日、期限超過、期間内に一度、期間中継続、待ち、Focus Sessionの履歴
- ToDo: 全状態、優先度、チェックリスト、繰り返し、親子Task、保存済みビュー
- Timeline: 実施事項、Phase、Milestone、Deliverable、依存、baselineとactual
- Themes: 現在地、週報、研究Note、成果物、進行中と完了の混在
- Inbox: 未整理、整理済み、URL、Markdown、手書き起点
- Notes: Note / Resource / Report / Prompt、数式、表、Mermaid、Callout、Daily Scratchpad
- Knowledge: Question / Evidence / Claim / Decision / Insightと支持・反証・依存関係
- Chat Refs / Artifacts: 外部AIとの検討履歴、ローカルCSV/JSON/Markdown、URL参照
- Sketch: ベイズ最適化ループと焼結プロセスの手描き風図解
- AI Inbox: Pendingと採用済みProposal

画面確認用なので、すべてを成功状態に揃えない。
未整理・待ち・確認待ち・期限超過・リンク切れ・低信頼の仮説も意図的に残す。
