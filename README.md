# Research Desk

研究開発職向けの、テーマ・タスク・長期スケジュール・メモ管理デスクトップアプリです。
データは端末内のElectronユーザープロファイルに保存され、外部サーバーへ送信されません。

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

- 今日: テーマコックピット、ミニガント、次のタスク、最近のメモ
- Timeline: テーマ横断の長期ガント
- Inbox / Themes / Notes / Links / Waiting
- AI Import / Export: JSON / YAMLの取り込みと、JSON / YAML / Markdownの書き出し
- Stats / Settings
