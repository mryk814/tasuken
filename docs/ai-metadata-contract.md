# AI可読metadata契約（#294）

Tasken内のEntityをMicrosoft 365 CopilotやCoding Agentへ渡すとき、Entityごとに独自の渡し方を作らないための共通契約。
本文schemaは種別ごとに別のまま、**概要・鮮度・根拠・出典**だけを同じ意味で持つ。

正本は [`src/shared/aiMetadata.mjs`](../src/shared/aiMetadata.mjs)。MCP・AI Pack・Context Previewはすべてこの関数群を通す。

## 対象Entity

`theme` / `project` / `item` / `task` / `waiting` / `plan_node` / `note` / `resource` / `capture_entry` / `knowledge_node` / `artifact` / `sketch`

`AI_METADATA_ENTITY_TYPES` が正本。ここに無い種別（schedule・reference・change_event等）は契約の対象外で、metadataフィールドを持たない。

## 保存フィールド

`ai_` を前置きする。Issue本文の名称（`summary` / `authority` 等）をそのまま使わないのは、既存の `status_update.summary` や永続化層の `source` と衝突するため。

| フィールド             | 値                                                                                     | 意味                             |
| ---------------------- | -------------------------------------------------------------------------------------- | -------------------------------- |
| `ai_summary`           | 400文字以内 / null                                                                     | 本文を読む前に判断できる短い概要 |
| `ai_summary_authority` | `user_confirmed` / `rule_generated` / `ai_generated` / `excerpt`                       | 概要を誰が決めたか               |
| `ai_freshness`         | `current` / `stale` / `superseded` / null                                              | 現在も有効か                     |
| `ai_authority`         | `user_confirmed` / `imported` / `ai_generated` / `inferred` / `external_source` / null | 何を根拠にした情報か             |
| `ai_last_verified_at`  | ISO日時 / null                                                                         | 最後に人が確認した時点           |
| `ai_superseded_by`     | `{ type, id }` / null                                                                  | 置き換えたEntity                 |
| `ai_source_refs`       | 出典配列（20件まで）                                                                   | 出典（後述）                     |

`null` は「未設定」を意味する。

DB migrationは不要（Entityは `entities.data_json` のJSON blob）。既存Entityは全フィールドが未設定として読め、本文は一切変わらない。

## AIへ渡す範囲

**AIに見せる・見せないを決める概念は無い**（本人の判断、2026-11-08・11-12）。MCP・AI Pack・Context Preview・Mobileのtask-contextは、同じ共通metadata（header）を付けて全Entityを返す。
かつて `ai_visibility` / `default_ai_visibility`（Entity・Theme単位の公開先）と、workspaceの既定（端末設定 `aiVisibilityDefault`）があったが、実データに明示設定が無いことを確かめて削除した。

更新前の端末（NAS replica・別PCのDesktop・Android）は、同期やコマンドに `ai_visibility` / `default_ai_visibility` を載せることがある。**拒否せず、保存せずに捨てる**（`normalizeEntity` が全種別で落とす。Taskの作成・変更の入力 `taskDraftSchema` も受けて、値は使わない）。DB上の古い値は移行せず、そのまま残るが、どこからも読まれない。
`workspace_meta.ai_visibility_default` も同じく残るだけで読まれない。

AIが読めないものが無いので、Core/MCPの出力に `ai_audience` や、公開範囲で外した件数（`excluded_count`）は付かない。`excluded_count` / `excluded_reasons` が残るのは、公開範囲と関係の無い理由（完了済み・範囲外・件数上限・AI Packの未公開Conversationなど）で外したときだけ。

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

- 全一覧tool（items / notes / knowledge / theme context / health）は、各Entityへ `buildAiEntityHeader` のheaderを付ける。
- `export_ai_context`（Core/HTTP。MCP非公開）に公開先の引数は無い。OneDrive AI Pack（#295）は別に組み立てる。
- Markdown出力では `stale` / `superseded` / `ai_generated` 等を項目の横へ短く添える。

## UI

- 詳細ドロワー: 「AI・情報状態」セクション（読み取り）。未設定は空欄にせず、理由の分かる語で示す。
- 編集ドロワー: 折りたたみの入力欄。通常編集の主目的を圧迫しない。

表示ラベルは [`domain-model/labels.ts`](../src/renderer/src/features/workspace/domain-model/labels.ts) に集約し、内部コードを画面へ出さない。

## 非ゴール

- すべてのEntity本文を一つの共通schemaへ変換すること
- AIがsummary / relationを無確認で確定すること
- 完全な情報分類・DLP製品
- 古い情報を自動削除すること
