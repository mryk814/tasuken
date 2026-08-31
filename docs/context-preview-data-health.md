# Context Preview / Data Health

Issue #296 の Context Preview と Data Health は、AIへ渡す内容と公開前の異常を同じMain境界で確認する機能です。

## Context Preview

- M365はTheme AI Packの`buildThemeAiPackPlan`をそのまま`previewThemeM365`へ渡します。Taskを選んだ場合も独自Packを作らず、所属Themeの実PackにそのTaskが含まれるかを示します。
- Coding AgentはTasken Coreの`get_task_context` / `get_theme_context` responseを既存adapterへ渡します。Desktop Previewとstdio MCPが同じquery serviceを使い、Core停止時にSQLite直読へfallbackしません。
- RendererからMainへ渡す値は`audience`とtyped `{type,id}`だけです。absolute path、本文、relation queryは受け取りません。
- 表示はseed、included / excluded、relation path、asserted / suggested相当のstatus、visibility、freshness、authority、truncation、推定sizeです。表示上の上限を超える場合は、表示件数と残件数を明記します。

### TaskからCoding Agentへ依頼する

未完了でまだ委任していない自分のTaskは、詳細の「AIへ依頼を準備」で`intended_executor=ai_agent`として保存します。永続化境界が`work_state=ready_for_agent`へ正規化するため、Coding AgentはTasken MCPから対象Taskと同じproducerのContextを取得できます。

この操作は外部Agentを起動・送信しません。保存後に詳細へ現れる「AIへの依頼」から「依頼文をコピー」し、Coding Agentへ貼り付けて作業を始めます。コピーするのはTask ID・タイトル・`tasken.get_task_context`の取得案内だけです。「AIへ渡る内容を確認」を開くと、Context Previewで実際に渡るincluded / excludedも確認できます。作業中、Receipt確認待ち、確認済み、完了・中止Taskは担当を切り替えないため、この準備操作を出しません。

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
