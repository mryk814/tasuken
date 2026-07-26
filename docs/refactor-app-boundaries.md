# Application boundary refactor

## 目的

現在の利用者向け挙動を変えずに、Renderer、Main、Repository、テストの変更境界を明確にする。

## 非交渉の互換条件

1. 既存の SQLite、Workspace Snapshot、Import / Export 形式を変えない。
2. `window.api`、Preload、IPC の公開契約を変えない。
3. Notes、Drawer、Artifact、Timeline、Quick Capture、Today Mini の操作結果を変えない。
4. Entity の validation、delete / restore、参照整合性、Snapshot差分の結果を変えない。
5. `npm test`、typecheck、production build、model / desktop smoke、NSIS / portable packageを維持する。

## フェーズ

1. ソース文字列へ強く依存するテストを、共有した契約検査と挙動検査へ寄せる。
2. `WorkspaceApp.tsx` からフォーム変換、購読、画面ルーティングを分離する。
3. Artifact の表示・操作・永続化境界を Renderer / Main それぞれで分離する。
4. Repository から validation、delete policy、Snapshot規則を純粋モジュールへ分離する。
5. Drawer詳細群とCSSを、実際の責務境界に合わせて整理する。

各フェーズは独立コミットとし、その時点でテスト・型検査・buildが通る状態へ戻す。
