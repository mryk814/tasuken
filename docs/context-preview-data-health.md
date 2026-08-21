# Context Preview / Data Health

Issue #296 の Context Preview と Data Health は、AIへ渡す内容と公開前の異常を同じMain境界で確認する機能です。

## Context Preview

- M365はTheme AI Packの`buildThemeAiPackPlan`をそのまま`previewThemeM365`へ渡します。Taskを選んだ場合も独自Packを作らず、所属Themeの実PackにそのTaskが含まれるかを示します。
- Coding AgentはTasken Coreの`get_task_context` / `get_theme_context` responseを既存adapterへ渡します。Desktop Previewとstdio MCPが同じquery serviceを使い、Core停止時にSQLite直読へfallbackしません。
- RendererからMainへ渡す値は`audience`とtyped `{type,id}`だけです。absolute path、本文、relation queryは受け取りません。
- 表示はseed、included / excluded、relation path、asserted / suggested相当のstatus、visibility、freshness、authority、truncation、推定sizeです。表示上の上限を超える場合は、表示件数と残件数を明記します。

## Data Health

固定rule registryが次を検出します。

- AI summary / visibility / provenance / freshnessの不足やstale / superseded
- broken Internal Link / Relation、孤立Entity、同名候補
- Note単位のCanonical Markdown同期異常とcanonical root異常
- AI Packのdirty / missing / warning / recovery error
- M365公開範囲と確定要約・freshnessの不一致

EvaluatorはEntity単位のsignature cacheを持ち、通常Entityを1件変更した場合はその1件だけを再評価します。Relation、重複、保存Rootなど集合依存ruleは別cacheで評価します。

無視/解決済み状態は`tasken-data-health-state/v1`としてSQLiteの`workspace_meta`へ保存します。Repositoryのtyped APIがtransaction内CASを行うため、複数windowの同時更新で後着更新が状態を失いません。Data Healthは修正候補と元Entityへの導線だけを示し、本文・Relation・AI公開設定を自動変更しません。

## 検証

```powershell
node --test tests/data-health.test.mjs tests/ai-context-preview-workspace.test.mjs tests/ai-context-preview-ipc-ui.test.mjs
npm.cmd run typecheck
npm.cmd run build
```
