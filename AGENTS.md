# Tasken

standard-version: 2026-09.1

研究開発職向けのテーマ・タスク・長期スケジュール・メモ管理デスクトップアプリ。
Electron + TypeScript + Reactで構成し、SQLiteに利用者の正本データを保存する。

## 作業の入口

- ユーザーが選んだcheckoutで作業し、開始時にstatus・branch・stashを確認する。既存変更、別worktree、稼働中のサービスを保持する。
- 起動・依存導入・実行環境を選ぶときは [開発環境](docs/development-environment.md) と [README](README.md) を読む。実行可能なコマンドは `package.json` を正本にする。
- シェルは `rtk` を付ける。Windowsの組み込み操作は `rtk powershell ...` を使い、日本語ファイルはUTF-8を明示する。RTKの確認方法は [RTK.md](RTK.md)。
- 実装前に変更対象の現状と導線を確認し、変更計画を短く示す。下表から変更に関係する文書・節だけを読む。

| 変更・判断                                             | 正本                                                                                                                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI・UX・画面構成・表示文言                             | [design-guide.md](design-standard/design-guide.md)の該当節。見た目の実値は [tokens.css](design-standard/tokens.css) / [tokens.json](design-standard/tokens.json) |
| Electron・IPC・ウィンドウ・配布                        | [desktop-app-standard.md](docs/desktop-app-standard.md)の該当節                                                                                                  |
| 機能境界・保存・schema・Import/Export・削除/復元・ログ | [engineering-contracts.md](docs/engineering-contracts.md)の該当節                                                                                                |
| MCP・外部AI連携                                        | [ai-collaboration-e2e.md](docs/ai-collaboration-e2e.md)、READMEの外部AI連携案内、設計・データ契約のAI連携節                                                      |
| 画面・エンティティの呼び方が曖昧                       | `docs/glossary.md`（ある場合）                                                                                                                                   |
| アプリの性格や標準からの逸脱を判断                     | `docs/app-charter.md`（ある場合）                                                                                                                                |

本書はTaskenの作業・検証の正本。UI規則の正本はdesign-guide、保存契約の正本はengineering-contractsとする。
必須規則・禁止事項を守り、推奨から外す場合は理由を記録する。規則の改訂時はstandard-versionを更新する。
別worktreeの旧版は、その作業を再開・統合するときに照合する。

## 実装とデータの境界

- 既存のTypeScript strict、`.tsx` / `.ts`、Main / Preload / Renderer / shared構成を継承する。命名・書式・import順は周辺の実装に揃える。
- 実行経路は `React → Zustand → window.api → Preload → IPC → Service → Repository → SQLite/OS`。RendererからDB・Node.js・OSへ直接アクセスしない。
- データ・保存先・Import/Export形式を保ち、変更が必要なら移行と復旧を設計する。秘密情報をコード・ログ・Exportへ含めない。
- AIの書き込みはProposal作成に限定する。正式データへの反映は、利用者がプレビューして採用した後に行う。
- UI変更にはdesign-guideを適用し、トークンを見た目の正本にする。エラー時も入力を保持し、表示文言から挙動を推測せず型や明示引数で分岐する。
- 現在の要件を満たす最小の変更にする。無関係な機能追加・リファクタリングは分け、将来用のschemaや設定を先に作らない。

## 実行と承認

- 通常起動は実ユーザープロファイルへ接続する。検証には一時userDataを用いる既存smoke runnerを優先し、対話確認も保存先を隔離する。
- 実データ、同期先、Snapshot保存先を検証へ流用しない。`workspace:materials-demo*` は `--apply-local` を含むため通常の検証として実行しない。
- 承認された範囲の実装、隔離テスト、変更が原因の失敗の修正と再検証まで進める。最初の実装やテストの無効化を完了にしない。
- 期待動作は依頼・仕様・既存テストから判断する。仕様変更か回帰かをその証拠で決められない場合だけ確認する。
- design-standard自体の変更、大きなリファクタリング、CSS-in-JS・新規サーバー/DB・別フレームワークの導入は、現在の依頼がその範囲を承認していない場合に確認する。
- 実データの破壊、PR作成、公開、外部送信は具体的な対象・操作・送信先について明示的な承認を要する。現在の依頼に含まれる承認を再度求めない。

## Testing

変更した境界を通す最小の既存チェックから始める。以下の適用範囲を、詳細文書の一般的な完成条件より優先する。

| 変更                         | 検証                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文書・エージェント指示のみ   | 差分、参照先、記載コマンドと実装の一致。アプリ起動・packageは不要                                                                                                                                 |
| 業務ロジック・契約・保存処理 | 関連する `tests/*.test.mjs` を `rtk node scripts/run-electron-node.mjs --test tests/<対象>.test.mjs` で実行。TypeScript変更は `rtk npm run typecheck`、ビルド経路に影響すれば `rtk npm run build` |
| Renderer・入力・導線         | 関連テストとtypecheck/buildに加え、隔離userDataで影響する実画面を確認。表示、focus、スクロール、必要な4状態を目視し、スクリーンショットを残す                                                     |
| 永続化・Import・削除・復元   | 一時データで保存→再起動→再表示、該当する削除/undoと失敗時の入力・既存データ保持を確認。既存の `smoke:model` / `smoke:desktop` を利用する                                                          |
| Windows固有機能・配布物      | development-environment.mdのWindows runtime / Actionsで該当境界を確認。配布変更はpackage・packaged smokeも対象にする                                                                              |

- merge前の品質ゲートは `rtk npm run ci`。日常の小変更では関連テストから始め、失敗や影響範囲に応じて広げる。
- `smoke:desktop:focused` はbuildを省略するrunner。関連するソースの変更後はbuildし直し、古い成果物の成功を今回の検証に数えない。
- 自動smoke、目視、packageは別の境界を検証する。必要な実動確認が実行環境の都合でできなければ、残った境界を明記する。

- Electronの対話検証では、利用可能な `playwright-interactive` スキルの対象アプリ確認に従う。検証用userDataを使い、影響する画面の位置・focus・スクロールを確認する。
- ブラウザ操作でplaywright-cliを使う場合は、個人共通の `~/.agents/skills/playwright-cli/SKILL.md` を参照する。Electron検証のためにブラウザ用テスト基盤を新設しない。
- 終了するのは自分が作った検証セッションだけとし、借用した接続はdetachする。
- 完了は該当する検証と必要な文書更新まで。日本語で変更・検証結果・未検証の境界を短く報告する。スクリーンショットの取得だけを目視検証完了としない。

## Git conventions

- コミットは「1フェーズ＝1コミット」を基本にする。ビルドが通らない中間状態でコミットしない。
- コミットメッセージは日本語1行（50字目安）で「何を・なぜ」を書く。詳細が必要なら空行の後に本文を書く。例: `タスク削除にundoトーストを追加（確認ダイアログの置き換え）`
- lockfile更新・自動整形などの機械的な巨大diffは、手書きの変更と混ぜず独立コミットにする。
- ブランチ: 個人開発では main 直コミットでよい。実験的な大変更・移行だけブランチを切る。
