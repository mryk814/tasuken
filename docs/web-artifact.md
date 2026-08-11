# Web Artifact

HTML成果物はNote本文へ埋め込まず、既存Artifactの`Web Artifact`として保存・関連付ける。

## Preview契約

- `.html` / `.htm` または `mime_type=text/html` をWeb Artifactと判定する。
- MainはRendererからArtifact IDだけを受け取り、managedまたはlinked local fileの存在と専用`tasken-web://` Preview URLを返す。HTML本文はMainのprotocol handlerだけが読み、OS pathはRendererへ返さない。外部URLはアプリ内Previewを行わず、ブラウザで開く。
- Previewは常時`sandbox="allow-scripts"`の隔離環境で表示する。preload、Node/Electron API、filesystem APIを注入せず、opaque originとCSPでnetwork・popup・permissionを閉じる。
- Preview用HTMLはMainで`BrowserWindow.loadFile`等へ渡さず、専用protocolのiframeへだけ返す。Electron親画面のCSPとPreview側のCSPを混ぜないため、`srcDoc`や`data:` URLは使わない。

## 確認用サンプル

`docs/web-artifact-demo.html`をArtifactとして取り込み、隔離PreviewでカウンターとCanvasが動くことを確認できる。外部リンク・form・popupも試せる。

## Metadata

単一HTMLのArtifactには`web_kind=self_contained_html`、`web_entrypoint`、`web_execution_policy=sandboxed_interactive`を保存する。既存Artifactの旧`static`値は読み込み時に互換扱いするが、Previewは隔離Interactive固定とする。
