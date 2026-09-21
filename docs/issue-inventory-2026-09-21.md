# GitHub Issueの現在地（2026-09-21）

> 更新日: 2026-09-21 JST
> 対象: `mryk814/tasuken`
> 実装基準: `main@9cafdf8f` / `v0.1.65`

日付付きのスナップショットである。前回は [issue-inventory-2026-09-01.md](./issue-inventory-2026-09-01.md)。
計画と単位の対応は [issue-design-plan-2026-09-20.md](./issue-design-plan-2026-09-20.md)（日付付きの計画書）を参照する。

## 現在の基準点

- Open Issueは14件（#593 Epic、#594–#602、#604、#273、#588、#454）。Open Pull Requestは0件。
- `main` は `origin/main` と同期し、未コミットの変更はない。
- 2026-09-20の計画書が定めた単位A〜Oは**すべて実装し、単位ごとに隔離検証した**。
  証跡は各単位の正本（下表）と `docs/agent-work-contract.md` §11 の受け入れシナリオ対応表に残す。
- 残っているのは、**利用者の操作が要る実測**（実アカウント・実機・NAS・実クライアント）と
  **実利用を経てから決める調整**（Feed第4段階、Habit / Maintenance の評価）だけである。

## 単位とIssueの現在地

| Issue                                                 | 計画の単位 | 実装     | 主な証跡                                                                                                                            | 残っている境界                                                       |
| ----------------------------------------------------- | ---------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [#594](https://github.com/mryk814/tasuken/issues/594) | A          | 完了     | [agent-collaboration.md](./agent-collaboration.md)（用語・再利用範囲・採用contract）                                                | —                                                                    |
| [#595](https://github.com/mryk814/tasuken/issues/595) | B          | 完了     | [agent-work-contract.md](./agent-work-contract.md) §5–6、`tests/fixtures/agentWorkScenarios.mjs`、`tests/agent-work-state.test.mjs` | —                                                                    |
| [#596](https://github.com/mryk814/tasuken/issues/596) | F          | 完了     | `src/shared/contracts/task/attentionQueue.ts`、`tests/attention-queue.test.mjs`、`tests/mobile-attention-golden.test.mjs`           | —                                                                    |
| [#597](https://github.com/mryk814/tasuken/issues/597) | E          | 完了     | `tests/agent-reply.test.mjs`、`tests/mcp-task-context.test.mjs`（人間の返答の再取得）                                               | —                                                                    |
| [#598](https://github.com/mryk814/tasuken/issues/598) | G          | 完了     | `npm run audit:handoff`（Context Preview・開始待ち・新しい作業単位で任せ直す）、`tests/agent-work-attempt.test.mjs`                 | 実行中に解除した相手のagent側の扱い                                  |
| [#599](https://github.com/mryk814/tasuken/issues/599) | H          | 完了     | `npm run audit:agent-desk`（採用・採用して完了・修正を依頼・却下）、`tests/task-work-receipts.test.mjs`                             | —                                                                    |
| [#600](https://github.com/mryk814/tasuken/issues/600) | I          | 完了     | `tests/ai-integration-ia.test.mjs`、route `ai-io`／alias `proposal-inbox` の維持                                                    | —                                                                    |
| [#601](https://github.com/mryk814/tasuken/issues/601) | J          | 実装完了 | Android単体194件、`AgentDeskAttentionUiTest` ほか instrumented、`output/android-attention/*.png`                                    | **実機（SM-F966Q）での目視と通知の実配信**                           |
| [#602](https://github.com/mryk814/tasuken/issues/602) | K          | 実装完了 | `tests/agent-roundtrip-acceptance.test.mjs`、[agent-work-contract.md](./agent-work-contract.md) §11 の14場面対応表                  | **実クライアント（Codex等）からの接続**                              |
| [#604](https://github.com/mryk814/tasuken/issues/604) | C/L        | 実装完了 | `npm run audit:feed` / `:live` / `:bulk` / `:note`、`docs/feed-surface.md`、`tests/feed-*.test.mjs`                                 | 第4段階（日常利用での文章と流れの調整）                              |
| [#273](https://github.com/mryk814/tasuken/issues/273) | M          | 一部実装 | Today / Activityの日次read modelと5状態（`tests/today-calendar-state.test.mjs`、`npm run doctor:calendar-client`）                  | **Desktop種別のOAuthクライアント作成と実接続**（実アカウントが要る） |
| [#588](https://github.com/mryk814/tasuken/issues/588) | N          | 一部実装 | [deploy/synology/DEPLOYED.md](../deploy/synology/DEPLOYED.md)（N1の再測定）                                                         | **NAS側のread-only確認**（3コマンド）→ N2 / N3                       |
| [#454](https://github.com/mryk814/tasuken/issues/454) | D/O        | 実装完了 | `tests/today-ia.test.mjs`、`npm run audit:habit` / `:maintenance`                                                                   | **実利用評価**（Habit 2週間、Maintenance 1サイクル）                 |
| [#593](https://github.com/mryk814/tasuken/issues/593) | 親Epic     | 継続     | 子Issueの証跡（上表）                                                                                                               | 子Issueの決着後にEpicの成果をまとめる                                |

## 利用者の操作が要る残り

旅行中でも進められる順に並べる。**アプリを起動して確かめる項目はPCの前で行う。**

1. **#273（M）**: Google Cloud Console で「**デスクトップ アプリ**」種別のOAuthクライアントを作成し、
   client ID を `TASKEN_GOOGLE_CLIENT_ID` へ設定する。現在設定されているIDはWebアプリ種別のため
   `npm run doctor:calendar-client` が `confidential_client` を返し、実接続できない。
   作成自体はスマートフォンのブラウザでもでき、PCでは環境変数の設定と `npm run smoke:calendar-live`（同意5分）だけを行う。
2. **#588（N）**: NASへ入り、`deploy/synology/DEPLOYED.md` の read-only 3コマンドの結果を渡す。
3. **#601（J）**: SM-F966Q に debug APK を入れて、要対応一覧・回答・Fold詳細ペイン・新着通知を目視する。
   データを消す操作の前には改めて確認する。
4. **実利用評価**: #604 第4段階（1週間程度）、#454 の Habit（2週間）と Maintenance（1サイクル）。

## 次に決めること

- 完了条件を満たしたIssue（#594〜#600）は、残作業を持たないため **close** できる。
  証跡は上表の正本に残っており、Epicの子として開いたままにする理由がない。
- #601 / #602 / #273 / #588 / #454 / #604 は残りの境界が利用者側にあるため **openのまま** とし、
  残りをIssue本文かコメントで一行にしておくと、次に触るときの入口になる。
- #593 Epic は子Issueの決着後に成果をまとめて閉じる。

## Issueを増やす基準

[issue-inventory-2026-09-01.md](./issue-inventory-2026-09-01.md) の基準をそのまま使う。
利用場面と完了条件が一文で書けるものだけを切り出し、横断整理だけを目的にしたIssueは作らない。

## 未検証境界

- Windows配布物とpackaged smokeはGitHub Actionsで確認済み。Androidは単体・instrumented（emulator）まで確認済みで、**実機は未確認**。
- Google Calendarは**実アカウントでの接続が未確認**。表示状態（5状態）は単体テストで確認済み。
- NASは**共有からの読み出し（N1）のみ実測**で、コンテナ側の確認と外部MCP読み出し（N2/N3）は未実施。
- #602の14場面は隔離環境（実SQLite・実stdio MCP・実mobile gateway）で実測済みで、**実クライアントからの接続のみ未確認**。
