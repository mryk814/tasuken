# AI Context Preview pure core

`src/shared/aiContextPreview.mjs` は、Theme AI Pack と read-only MCP が実際に返した
plan/responseを表示用の共通モデルへ投影するだけのadapterである。
Entity選択、relation traversal、AI visibility判定は行わない。
producerが返した本文・excerpt・summaryは最初に存在する既知fieldだけをbounded表示し、
上限を超えた場合はadapter truncationとして明示する。外部ファイルやlocator先の本文は展開しない。

Theme AI Pack v1は個別Entityの型、個別除外、relation path、AI metadataをplanへ保持せず、
集計値と未型付けIDだけを返す。そのため `previewThemeM365` は型を推測せず
`entityDetails: aggregate_only` / `exclusionDetails: aggregate_only` を返す。

個別Entity・除外理由・metadataをlosslessに表示するには、次段で既存producer自身が同じ
plan/responseへその情報を保持する必要がある。Preview側に別のqueryや選択規則を追加してはならない。
