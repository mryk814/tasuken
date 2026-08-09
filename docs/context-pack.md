# Context Pack

## 利用者の一周

1. Theme詳細またはCommand Paletteから「AI向けContext」を開く。
2. Task、Note、Resource、Artifactから含める項目を明示的に選ぶ。
3. 目的とAIへの依頼を書き、文字数・概算token数とPreviewを確認する。
4. Markdownをコピーするか、出力時点のSnapshotをPrompt Noteとして保存する。
5. 「AI回答を受け取る」から、保存したContext Packを参照する通常のMarkdown Noteを作る。

## 境界契約

- 何も自動選択せず、利用者が選んだEntityだけを含める。
- Note本文は最大1,200文字の抜粋とし、長文全文を無条件に投入しない。
- Artifactは本文を読まず、名前・種別・保存場所またはURLだけを含める。
- API送信は行わず、標準のAI連携どおりクリップボード往復にする。
- 保存時は専用Entityを増やさず、`properties_json.context_pack`を持つPrompt NoteとしてMarkdownとEntity ID一覧をSnapshot保存する。
- AI回答の入口も通常のMarkdown Noteとし、`source_context_pack_id`で出典を保持する。
