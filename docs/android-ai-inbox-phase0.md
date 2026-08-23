# Android read-only AI Inbox — Phase 0

Issue: #402  
Date: 2026-08-23

## Problem

Hermes / MCP が書く Task `work_state` と Work Receipt は Desktop 正本にある。Android から同じ事実を確認する読み取り面がなかった。

## Decision

新しい AI Task DB も Android 上の LLM も作らない。既存 Task と Work Receipt から Gateway が投影し、既存 Room Task cache と list-detail scaffold で見せる。

| 対象 | 正本 | Android の扱い |
|---|---|---|
| AI 作業状態 | Task `work_state` | 既存 cache。Inbox は AI 関連値だけを section 分け |
| 最新報告 | `work_receipt` の最新 1 件 | bootstrap / sync の `latestWorkReceipt`。summary のみ |
| 承認 / 差戻し | 後段 | Phase 0 では出さない |

## Inbox sections

- 作業中: `in_progress`, `ready_for_agent`（旧 `working` / `delegated` も読む）
- 確認待ち: `needs_human_review`, `reported_done`
- 停止中: `blocked`, `failed`
- 最近完了: `accepted`

`not_delegated` は Inbox に出さない。Proposal・通知・Discord・AcceptTaskWork は非ゴール。

## Receipt summary

公開するのは `id` / `reportedAt` / `executorLabel` / `summary` だけ。raw tool output と chain-of-thought は投影しない。Today 一覧は従来どおり Receipt を載せない。

## Labels

`TaskLabels` は canonical `work_state` を日本語にする。旧キーは alias として残し、内部値を画面に出さない。

## Remaining

- Proposal approve / reject（Phase 1）
- AI へ任せる / Discord share（Phase 2）
- #400 Desktop 時刻表示は別ギャップ。この slice では扱わない
