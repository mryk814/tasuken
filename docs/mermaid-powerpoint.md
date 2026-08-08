# Mermaid PowerPoint 出力

## 対応範囲

Markdown Preview の Mermaid block には、handler が接続された画面に限って可視の「出力」メニューを表示する。右クリックは shortcut として残すが、同じ操作へ可視 UI と keyboard から到達できる。block ID と source を action へ渡すため、複数図がある場合も選択した図だけを出力する。

PowerPoint 編集用 SVG は Mermaid の計算済み SVG を Office 向けに再レンダリング・正規化する。`htmlLabels:false` を Mermaid の global config と flowchart config の両方へ適用し、`text`/`tspan` と確定済み CSS を使う。`foreignObject`、`script`、`style`、event handler、外部 resource は出力しない。namespace、`viewBox`（負の minX/minY を含む）、日本語 text、ID と marker 参照は保持する。

Windows clipboard の製品経路は可視メニュー → 既存の `image/svg+xml` write IPC である。Main 側で write 後の format を検証し、SVG として確認できない場合は UI に明示して SVG 保存または PPTX 出力を回復導線として示す。clipboard read 用の新しい production IPC は追加していない。

## Native PPTX MVP

native PPTX は flowchart/graph に限定する。PptxGenJS 4.0.1 を使い、手書き OOXML generator は採用していない。PptxGenJS は relationship、theme、font、connector の保守をライブラリに委譲でき、生成物は PowerPoint の DrawingML として検証できるためである。Presentations skill の artifact-tool は QA の render/slides_test にだけ使い、product output を置き換えない。

対応する native object は rectangle、rounded rectangle、circle、diamond、node text、edge/arrow、edge label、subgraph である。edge は node より先に配置する。SVG の viewBox 原点を transform で差し引き、Mermaid が計算した位置・サイズを再レイアウトしない。対応できない shape や曲線/arc の直線近似は warning に残し、元 SVG 保存を回復導線にする。

native の node、node text、edge、edge label は PowerPoint 上で個別選択・編集できる。native 非対応の Mermaid type（sequence diagram など）は SVG copy/export のみ有効で、native PPTX ボタンは disabled とする。

## 検証記録

代表監査成果物は `audit-shots/mermaid-powerpoint/` に保存する。

- `mermaid-flowchart.office.svg`: flowchart の Office SVG。
- `mermaid-sequence.office.svg`: sequence diagram の Office SVG。日本語通知を含む。
- `mermaid-flowchart.editable.pptx`: 製品の `extractMermaidPptxDiagram` → `buildMermaidPptxBuffer` 経路で生成した native PPTX。
- `rendered/slide-1.png`: Presentations skill の render 結果。full-size 画像を目視確認した。
- `mermaid-flowchart.com-qa.pptx`: 元の監査成果物を保持した PowerPoint COM 編集・再オープン用コピー。

実行した検証は次のとおり。

- security、純粋 validation、edge label routing、複数 viewBox 原点、native PPTX XML/relationship の unit test。
- `npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run build`。
- Electron audit: 3 block routing、可視 menu、SVG clipboard Main read-back、flowchart native extraction/build、scroll 位置、通常 Preview の Nunito 復元を確認。
- `render_slides.py` と `slides_test.py`: 全 slide render、overflow なし、full-size 画像確認。
- PowerPoint COM: version `16.0`、file/product version `16.0.20228.20124`。コピーを開いて node 日本語 text、node fill/position、edge position を変更し、save → reopen 後の値と DrawingML `<p:sp>`、編集済み text を確認した。
- PowerPoint への SVG 挿入は COM で成功し、SVG shape type `28` として保持された。

PowerPoint COM はこの環境では `Visible = false` を拒否するため、実機検証時は可視 window を使った。PowerPoint UI の「図形に変換」に相当する `ConvertToShape` は、この build の COM object では method が公開されず、COM からの変換は未確認である。したがって native PPTX の editability と SVG の挿入成功は確認済みだが、SVG の UI 図形変換成功とは扱わない。LibreOffice は環境に存在しないため、LibreOffice round-trip は未実施である。PowerPoint の version/build 差による SVG import/convert の差は残る。

Presentations QA runtime を使う場合は、worktree 内の `.cache` ではなく bundled runtime を明示し、`HOME=C:\Users\ootan` を設定して `render_slides.py` と `slides_test.py` を実行する。
