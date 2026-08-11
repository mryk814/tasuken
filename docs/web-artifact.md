# Web Artifact

HTML成果物はNote本文へ埋め込まず、既存Artifactの`Web Artifact`として保存・関連付ける。

## Preview契約

- `.html` / `.htm` または `mime_type=text/html` をWeb Artifactと判定する。
- MainはRendererからArtifact IDだけを受け取り、managedまたはlinked local fileのHTML本文だけを返す。OS pathはこのIPCの結果へ含めない。外部URLはアプリ内Previewを行わず、ブラウザで開く。
- Static Previewを既定とする。`sandbox=""`、CSP、script/event handler除去によりJavaScript、form、popup、navigation、networkを実行しない。
- Interactive Previewは利用者が明示的に切り替えた場合だけ`sandbox="allow-scripts"`で表示する。preload、Node/Electron API、filesystem APIを注入せず、opaque originとCSPでnetwork・popup・permissionを閉じる。
- Preview用HTMLはMainで`BrowserWindow.loadFile`等へ渡さず、専用iframeの`srcDoc`へだけ渡す。

## Metadata

単一HTMLのArtifactには`web_kind=self_contained_html`、`web_entrypoint`、`web_execution_policy=static`を保存する。Interactiveへの切り替えは一時的なViewer状態であり、Artifactの正本policyを変更しない。
