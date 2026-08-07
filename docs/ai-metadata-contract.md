# AI可読metadata契約（#294）

Tasken内のEntityをMicrosoft 365 CopilotやCoding Agentへ渡すとき、Entityごとに独自の渡し方を作らないための共通契約。
本文schemaは種別ごとに別のまま、**概要・鮮度・根拠・公開範囲・出典**だけを同じ意味で持つ。

正本は [`src/shared/aiMetadata.mjs`](../src/shared/aiMetadata.mjs)。MCP・AI Pack・Context Previewはすべてこの関数群を通す。

## 対象Entity

`theme` / `project` / `item` / `task` / `waiting` / `plan_node` / `note` / `resource` / `capture_entry` / `knowledge_node` / `artifact` / `sketch`

`AI_METADATA_ENTITY_TYPES` が正本。ここに無い種別（schedule・reference・change_event等）は契約の対象外で、metadataフィールドを持たない。

## 保存フィールド

`ai_` を前置きする。Issue本文の名称（`summary` / `authority` 等）をそのまま使わないのは、既存の `status_update.summary` や永続化層の `source` と衝突するため。

| フィールド | 値 | 意味 |
|---|---|---|
| `ai_summary` | 400文字以内 / null | 本文を読む前に判断できる短い概要 |
| `ai_summary_authority` | `user_confirmed` / `rule_generated` / `ai_generated` / `excerpt` | 概要を誰が決めたか |
| `ai_freshness` | `current` / `stale` / `superseded` / null | 現在も有効か |
| `ai_authority` | `user_confirmed` / `imported` / `ai_generated` / `inferred` / `external_source` / null | 何を根拠にした情報か |
| `ai_visibility` | audience配列 / null | 渡してよい相手（後述） |
| `ai_last_verified_at` | ISO日時 / null | 最後に人が確認した時点 |
| `ai_superseded_by` | `{ type, id }` / null | 置き換えたEntity |
| `ai_source_refs` | 出典配列（20件まで） | 出典（後述） |
| `default_ai_visibility` | audience配列 / null | **themeのみ**。配下Entityが継承する既定 |

`null` は「未設定」を意味する。「明示的にローカルのみ」は `ai_visibility: []` で表し、未設定と区別する。

DB migrationは不要（Entityは `entities.data_json` のJSON blob）。既存Entityは全フィールドが未設定として読め、本文は一切変わらない。

## AI公開範囲

audienceは3つ。**単一のladderにしない**。M365 CopilotとCoding Agentへ渡してよい情報は一致しないため、独立したgrantの集合として持つ。

- `m365` — OneDrive経由のMicrosoft 365 Copilot
- `coding_agent` — MCP経由のCoding Agent
- `external_ai` — 外部AIサービス

Issue #294のvisibility語彙は `AI_VISIBILITY_PRESETS` としてUI表示用のpreset名に残す（`local_only` = `[]`、`m365_allowed` = `["m365"]` 等）。

### 継承

`resolveAiVisibility` が次の順で解決し、**どこから来た値かを必ず返す**。

1. Entityの `ai_visibility`（`source: "entity"`）
2. Themeの `default_ai_visibility`（`source: "theme"`）
3. workspace既定（`source: "workspace_default"`）

workspace既定は `workspace_meta.ai_visibility_default`。出荷時は `["coding_agent"]`。
MCPは同一端末のread-only経路なので現行動作を保ち、OneDrive公開と外部AIは明示許可を要求する、という安全側の切り分け。Settingsの「AI公開範囲の既定」で変更できる。

### 判定

`projectEntityForAi(type, entity, { audience, theme, workspaceDefault })` が唯一の判定入口。
許可されないEntityは **本文もheaderも返さない**。呼び出し側は `summarizeAiExclusions` で件数と理由だけを提示する。

## 鮮度と根拠の導出

明示値が無いときも「不明」で終わらせず、決定的ルールから導出したうえで **導出であることを添えて** 返す。導出値はDBへ書き戻さない。

- 鮮度: `ai_superseded_by` があれば `superseded`。それ以外は `unknown`。**日付が古いだけでstaleにはしない**。
- 根拠: `source === "imported"` → `imported`、`source === "ai"` → `ai_generated`、artifactの `generated_by` がAI → `ai_generated`、`source_record_id` あり → `imported`。
- 概要: 明示 → 無ければ本文先頭からの暫定生成（`authority: "excerpt"`）。暫定生成をuser_confirmedと混同しない。

`ai_freshness` を `superseded` にするには `ai_superseded_by` が必須。理由なく古い扱いへ倒さない。

## 出典（source_refs）

```
kind: url | file | canonical_document | conversation | meeting | repository | external_system
locator
title?           captured_at?      last_checked_at?
storage_root_id? relative_path?
```

正本Markdown（#291 / #306）はprivateな絶対パスに依存させず、`storage_root_id + relative_path` で辿れるようにする。

## MCP / AI Packとの接続

- MCPの既定audienceは `coding_agent`。全一覧tool（items / notes / knowledge / theme context / health）が同じ判定を通る。
- 件数制限（limit）は**公開範囲の判定後**に適用する。除外分でlimitを消費させない。
- `tasken.export_ai_context` は `audience` 引数で公開先を切り替える。OneDrive AI Pack（#295）は `m365` を指定する。
- 出力には `ai_audience` と `excluded_count` / `excluded_reasons` が必ず付く。「全部渡した」ように見せない。
- Markdown出力では `stale` / `superseded` / `ai_generated` 等を項目の横へ短く添える。

## UI

- 詳細ドロワー: 「AI・情報状態」セクション（読み取り）。未設定は空欄にせず、理由の分かる語で示す。
- 編集ドロワー: 折りたたみの入力欄。通常編集の主目的を圧迫しない。
- Theme編集: 「配下のAI公開既定」。
- Settings: 「AI公開範囲の既定」（workspace既定）。

表示ラベルは [`domain-model/labels.ts`](../src/renderer/src/features/workspace/domain-model/labels.ts) に集約し、内部コードを画面へ出さない。

## 非ゴール

- すべてのEntity本文を一つの共通schemaへ変換すること
- AIがsummary / relation / visibilityを無確認で確定すること
- 完全な情報分類・DLP製品
- 古い情報を自動削除すること
