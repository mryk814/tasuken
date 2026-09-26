# GitHub Issueの現在地（2026-09-26）

> 更新日: 2026-09-26 JST
> 対象: `mryk814/tasuken`
> 実装基準: `main@23b5fdef` / `v0.1.69`（#273の実接続検証まで含む）
> 注: GitHub側の操作（Issueのclose・コメント）は利用者が行う。ここはリポジトリ内の記録である。

日付付きのスナップショットである。前回は [issue-inventory-2026-09-21.md](./issue-inventory-2026-09-21.md)。

## 現在の基準点

- Open Issueは**7件**（#273 / #454 / #588 / #601 / #602 / #604 / #611）。Open Pull Requestは0件。
- ローカル`main`は`origin/main`より10コミット先行（#273の実接続修正・#588・#601 / #602の実測を含む）。**pushはまだ**。
- 2026-09-21の棚卸し以降に決着したもの:
  - **#607**（Todayミニsmokeが環境依存の値で落ちる）→ 原因を特定して修正し、close（PR #612）
  - **#593 Epic**（Agent Desk）→ 子Issueの決着に伴い成果をまとめてclose
  - **#608 / #609**（Feed第4段階の切り出し）→ #604 へ集約してclose
  - **#273**（Google Calendar実接続）→ 2026-09-26に実接続を実測して検証完了（下記）。残るのは失効→再接続の再測だけ
- 残っているのは、**利用者の操作が要る実測**（実アカウント・実機・NAS・実クライアント）と
  **実利用を経てから決める調整**（Feed第4段階、Habit / Maintenance の評価）、
  および**新規の研究PoC**（#611）だけである。

## Issueの現在地

| Issue                                                 | 種別                | 実装                       | 主な証跡                                                                                                                | 残っている境界                                                |
| ----------------------------------------------------- | ------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [#273](https://github.com/mryk814/tasuken/issues/273) | Calendar            | 実装完了                   | `npm run smoke:calendar-live`（実接続9項目OK）、`tests/today-calendar-state.test.mjs`、`npm run doctor:calendar-client` | **失効→再接続の再測だけ**（閉じる判断はコメントへ記録）       |
| [#454](https://github.com/mryk814/tasuken/issues/454) | Product Direction   | 実装完了                   | `tests/today-ia.test.mjs`、`npm run audit:habit` / `:maintenance`                                                       | **実利用評価**（Habit 2週間、Maintenance 1サイクル）          |
| [#588](https://github.com/mryk814/tasuken/issues/588) | Architecture/MCP    | 一部実装                   | [deploy/synology/DEPLOYED.md](../deploy/synology/DEPLOYED.md)（N1の再測定）                                             | **NAS側のread-only確認**（3コマンド）→ N2 / N3                |
| [#601](https://github.com/mryk814/tasuken/issues/601) | Android/AI          | 実装完了                   | Android単体194件、`AgentDeskAttentionUiTest` ほか instrumented、`output/android-attention/*.png`                        | **実機（SM-F966Q）での目視と新着通知の実配信**                |
| [#602](https://github.com/mryk814/tasuken/issues/602) | Acceptance/AI       | 実装完了                   | `tests/agent-roundtrip-acceptance.test.mjs`、[agent-work-contract.md](./agent-work-contract.md) §11                     | **実クライアント（Codex等）からの接続**                       |
| [#604](https://github.com/mryk814/tasuken/issues/604) | Product/UX          | 第1〜3段階＋外部AI往復まで | `npm run audit:feed` / `:live` / `:bulk` / `:note`、[feed-surface.md](./feed-surface.md)                                | **第4段階**（日常利用での調整）と、集約した #609 の決定       |
| [#611](https://github.com/mryk814/tasuken/issues/611) | Research/Android AI | 未着手                     | —                                                                                                                       | オンデバイス小型LLMをsemantic parserとして試すPoC（実装なし） |

## 利用者の操作が要る残り

旅行中でも進められる順に並べる。**アプリを起動して確かめる項目はPCの前で行う。**

1. **#588**: NASへ入り、`deploy/synology/DEPLOYED.md` の read-only 3コマンドの結果を渡す。
2. **#601**: SM-F966Q に debug APK を入れて、要対応一覧・回答・Fold詳細ペイン・新着通知を目視する。
   データを消す操作の前には改めて確認する。
3. **#602**: 実クライアント（Codex等）をMCPへ接続し、14場面のうち残る1場面を実測する。
4. **実利用評価**: #604 第4段階（1週間程度）、#454 の Habit（2週間）と Maintenance（1サイクル）。
5. **#273の残り**: 同意を失効させた後の再接続を実測する（手順は
   [calendar-live-connection.md](./calendar-live-connection.md) の「失効→再接続の再測」）。

## 次に決めること

- **手動貼付とMCP待ちの紐付け**（#609 から #604 へ集約）: 入れるか、入れないかを確定し、
  入れない場合は [feed-surface.md](./feed-surface.md) §9 に確定事項として記録する。
- **Feed第4段階**: `docs/feed-surface.md` §9 の未確認表から、文言・量・運用の順に小さく調整する。
- **#611**: 実装着手時にruntimeとモデルのavailabilityを確認し、PoCの成否を採用 / 条件付き採用 / 不採用で分類する。

## 未検証境界

- Windows配布物とpackaged smokeはGitHub Actionsで確認済み。Androidは単体・instrumented（emulator）まで確認済みで、**実機は未確認**。
- Google Calendarは**実アカウントでの接続・当日表示・再取得・解除まで実測済み**（`npm run smoke:calendar-live`、2026-09-26）。
  **失効→再接続だけ未測**（手順は [calendar-live-connection.md](./calendar-live-connection.md)）。
- NASは**共有からの読み出し（N1）のみ実測**で、コンテナ側の確認と外部MCP読み出し（N2/N3）は未実施。
- #602の14場面は隔離環境（実SQLite・実stdio MCP・実mobile gateway）で実測済みで、**実クライアントからの接続のみ未確認**。
- #611は**実装が無く、PoCの前提（モデル・runtime）も未確認**。

## Issueを増やす基準

[issue-inventory-2026-09-01.md](./issue-inventory-2026-09-01.md) の基準をそのまま使う。
利用場面と完了条件が一文で書けるものだけを切り出し、横断整理だけを目的にしたIssueは作らない。
今回のように、既存Issueの残りを切り出した子Issueは、追跡先が一本化できるなら親へ戻してcloseする。
