# Theme AI Pack

Theme AI Pack は、Theme の公開可能な情報を M365 向けの固定 Markdown 一式として同期ルートへ生成する read-only projection です。正本は SQLite 内の Theme / Task / Note 等であり、AI Pack を編集しても正本には取り込みません。

## 生成物

保存先は Theme ID manifest（`.tasken-theme.json`）で再発見した `Themes/{folder}/AI Pack/` です。Theme code や表示名を変更しても、Theme ID が一致する既存 folder を再利用します。

- `00 Theme Overview.md`
- `01 Current Work.md`
- `02 Decisions.md`
- `03 Meetings.md`
- `04 Procedures.md`
- `05 Knowledge.md`
- `06 Activity.md`
- `.tasken-ai-pack.json`

上記以外のファイルがある Pack は更新済みとみなしません。Preview と Update は同じ `buildThemeAiPackPlan` を使い、Update は `{ themeId, expectedContentHash }` だけを Main へ渡します。Main は正本から plan を再構築し、hash が変わっていれば `stale_preview` として書き込み前に停止します。

## 公開と復旧

公開は sibling staging directory に全ファイルを書いて hash を再検証した後、既存 Pack を backup へ移し、directory rename で一括反映します。各 operation は userData 内の recovery receipt と内部 operation marker で追跡します。

- 同一 content hash かつ実ファイルも一致する場合は `skipped` とし、mtime と公開日時を変えません。
- root unavailable は既存 Pack と正本を変更せず、`retryPending` を返します。
- 起動時 recovery は receipt と directory 内 manifest の Theme ID、operation ID、phase、固定 allowlist、各 file hash、Pack hashがすべて一致する対象だけを回収します。
- symlink / junction、path traversal、改ざん済み staging / backup は自動 publish・restore・削除しません。

Theme Overview の「M365向け AI Pack」では生成内容、収録・除外件数、警告、文字数、最終生成日時を確認してから更新できます。`recovery_required` と Theme ID競合は error、root unavailable と再試行可能な失敗は warning として表示します。
