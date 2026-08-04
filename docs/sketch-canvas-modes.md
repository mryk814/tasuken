# Sketch Canvas mode comparison

## 比較する二つの作業面

| 観点 | Page | Infinite |
|---|---|---|
| 主用途 | 手書きノート、Note埋め込み、順序のある説明 | 構想、関係図、広がりながら考える図解 |
| 面 | 横1200 × 850を既定に、縦・正方形・カスタム寸法をページごとに選択 | 負値を含むWorld座標上の一つの連続面 |
| 移動 | 通常のscrollとzoom | Cameraを上下左右へ移動。移動ツール・中ボタン・Space+ドラッグ、Ctrl+ホイールzoom |
| 複数面 | ページを追加 | 一つの連続面 |
| Export | 現在のページ | 描画範囲（object bounds）または既存原点面を含む全体範囲 |
| 既存データ | modeなしの既存SketchはPageとして読む | 新規作成時に明示選択 |

## 同一サンプル

両modeで次の「実験判断フロー」を作り、道具や内容を変えずに比較する。

1. 左上にテキストで「仮説」。
2. 中央に矩形を3つ並べ、「条件A」「観察」「判断」と書く。
3. 矩形を矢印で接続する。
4. ペンで矩形の周囲に注記を2つ書く。
5. 蛍光ペンで重要箇所を1つ強調する。
6. 画像を1つ貼り、図形と整列させる。

Pageでは内容が収まらなければ2ページ目へ続ける。Infiniteでは原点から上下左右へ続け、負座標の描画と再表示を確認する。

## 評価観点

各項目を1（つらい）〜5（自然）で記録する。

- 書き始めるまでの迷い
- 全体像の把握
- 追記する場所の見つけやすさ
- ペン／図形／テキストの操作差
- Noteへ埋め込んだときの読みやすさ
- PNG / SVGへ出す範囲の分かりやすさ
- 10分後に戻ったときの現在地の分かりやすさ

## 現時点の境界

modeはSketch document全体の契約で、作成後に切り替えない。Pageの幅・高さは既存の`SketchPage.width / height`を正本とし、作成時と編集時に変更できる。追加ページは現在ページの寸法を継承し、縮小時は既存の描画内容が切れない寸法だけを許可する。

## Infinite Canvasの座標モデル

代表例としてtldrawのCamera / Page space分離と、Miroのendless board + navigation controlを比較した。

- tldraw: objectはPage spaceへ固定し、Cameraの`x / y / z`でViewportを動かす。入力はScreenからPageへ変換する。
- Miro: Boardの広がりとCanvas navigationを分離し、空白上でも移動できる。
- 旧Tasken: `page.width / height`とDOM scrollを表示位置の正本にしていたため、左・上へ進めず、描画後の拡張で面の寸法が変わっていた。

Taskenは次を採用する。

1. Sketch objectの座標をWorld座標とし、負値を許す。
2. `document.viewport`へCamera左上のWorld座標`x / y`と`zoom`を任意項目として保存する。
3. Pointer入力は`screenToSketchWorld`、DOM表示は`sketchWorldToScreen`で変換する。
4. Panはobjectを移動せずCameraだけを動かすため、空の状態でも上下左右へ移動でき、表示位置は跳ねない。
5. schema v1の既存documentは`viewport`がなければ`{ x: 0, y: 0, zoom: 0.82 }`として読む。
6. 描画範囲Exportはobject boundsを正規化し、全体Exportは旧来の原点面とobject boundsの和集合を正規化する。

参考:

- https://tldraw.dev/sdk-features/camera
- https://tldraw.dev/sdk-features/coordinates
- https://help.miro.com/hc/en-us/articles/360017730973-Structuring-board-content

## 描画遅延の計測境界

入力処理を次の二つのsurfaceへ分離する。

- Base canvas: 背景、確定済みobject、選択、整列ガイド。objectまたはCameraが変わったときだけ再描画する。
- Live canvas: 現在のstroke / shape / lassoだけを`requestAnimationFrame`で描く。pointer moveごとに確定済みobjectを再描画しない。

`pointermove`を受け取った時刻からLive canvasの次frameまでを`performance.now()`で計測し、画面左下へ直近値とP95を表示する。coalesced eventsとpressureは従来どおりstroke pointsへ保持し、pointer up時は確定objectをBaseへ先に描いてからLiveを消すことで確定時のちらつきを避ける。

### Electron実測（2026-08-04）

1540 × 878 pxの描画面で高速な曲線を60点入力し、開発版Electron上で計測した。

| 経路 | P95 | 描画中のBase再描画 |
|---|---:|---:|
| 変更前相当（確定済み300 stroke / 21,000 pointsを毎frame再描画） | 1.1 ms | 毎frame |
| 変更後（Live canvasのみ更新） | 0.5 ms | 0回 |

変更後はpointer up後にだけBaseを更新し、同じ実機操作でCamera `World -305, -220`、2本の曲線、zoomを保存後に再読み込みして位置と描画の復元を確認した。
