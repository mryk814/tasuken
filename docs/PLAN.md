# Tasken 実装状況

旧名「Research Desk」時代のロードマップは役割を終えたため、現在地の案内に置き換えた。
作業の正本は `AGENTS.md`、仕様は `docs/SPEC.md`、UI規則は `design-standard/design-guide.md`、
保存契約は `docs/engineering-contracts.md` とする。

## 現在地（2026-09-20）

- 日常利用の摩擦は大きなIssueへ溜めず、見つけ次第小さなIssueへ切り出す運用に変えた（#518 は閉じた）。
- 進行中の大きな方向性は GitHub の Open Issue が正本である。
  - Agent Desk と Feed の AI 連携群（#593 Epic、#594–#602、#604）
    - #594（用語・再利用範囲・採用contractの固定）は [agent-collaboration.md](./agent-collaboration.md) に成果を残した。以降の実装は同書の用語・導出表・route統合方針を参照する。
  - Synology 常時稼働 replica（#588。Phase 3 は外部要因で保留）
  - 全文公開の WIP はローカルの stash（`#546 全文公開の途中作業`）に保持している。
- 版ごとの利用者向け変更は `docs/releases/` を参照する。
  v0.1.47–v0.1.65 は `docs/releases/v0.1.47-v0.1.65.md` の回顧メモにまとめた。
- 2026-09-01 時点の Issue 棚卸しは `docs/issue-inventory-2026-09-01.md` に残す（日付付きスナップショットであり、書き換えない）。

## 継続改善

0. UX/IAの導線整理は[`ia-ux-improvement-plan.md`](./ia-ux-improvement-plan.md)の6フェーズ計画に従う。
1. [`desktop-app-standard.md`](./desktop-app-standard.md)を個人用Electronアプリの既定作法とする。
2. 互換維持のためfeature単位に残したJSXは、機能変更時にpage/component単位でTypeScript化する。
3. Critical Path、Workload / Capacity、グラフビューは実データで必要性を確認して設計する。
4. Spreadsheet Modeの列マッピング保存や行単位エラー修正は、日常運用で必要性を確認して追加する。

## 検証

- `npm run typecheck`
- `npm run build`
- `npm run smoke:desktop`
- `npm run smoke:model`
- `npm run package`

データ移行、保存、再起動後の復元、Snapshot Importはすべて失敗時に既存データを残す。
