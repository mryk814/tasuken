# Research Desk

研究開発職向けの、テーマ・タスク・長期スケジュール・メモ管理デスクトップアプリです。
データは端末内のElectronユーザープロファイルにあるSQLiteへ保存され、外部サーバーへ送信されません。

## 起動

```powershell
npm install
npm run dev
```

表示先: `http://127.0.0.1:5173`

## ビルド

```powershell
npm run build
```

## デスクトップ版

開発用に起動:

```powershell
npm run desktop
```

Electron内の入力・保存・再読み込みを自動確認:

```powershell
npm run smoke:desktop
```

Windowsインストーラーを作成:

```powershell
npm run package
```

生成先: `release/Research-Desk-Setup-0.1.0.exe`

## 主な画面

- 今日: テーマの現在地、近いマイルストーン、次のタスク、最近のメモ
- ToDo: 未完了、Inbox、期限超過、日程未確定の整理
- Timeline: テーマ横断の長期ガントとマイルストーン一覧
- Themes / Notes（URL・コメントを含む）/ Waiting
- AI Import / Export: JSON / YAMLの取り込みと、JSON / YAML / Markdownの書き出し
- Workspace Snapshot: ZIPによるバックアップ、差分プレビュー、競合選択付きImport
- Theme Status / Plan Revision / 情報源管理 / Settings

## 使い始める流れ

1. `Themes` で担当テーマを作り、`今日` でテーマの現在地を記録します。
2. 思いついた内容は左下の `クイック記録` から Inbox に入れます。
3. `ToDo` の Inbox フィルターで内容を具体化し、期限・Theme・状態を整えます。Excel等の表は `表から追加` でプレビューしてから取り込めます。
4. `Timeline` で長期予定を調整します。バー移動・リサイズ、依存線、計画進捗と実進捗の差分を示すイナズマ線を利用できます。
5. 会議・実験・AI壁打ちは `Notes`、成果物は `Links`、外部待ちは `Waiting` に残します。
6. 週次レビューやAIへの相談時は `AI Import / Export` で範囲と形式を選んでコピーします。
7. 定期的に `Settings` から Workspace Snapshot を書き出してバックアップします。

詳細な実装状況は [`PLAN.md`](./PLAN.md) を参照してください。
