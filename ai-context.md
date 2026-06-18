# AI Context Export

Generated: 2026-06-18 22:20:39

## Target Directories

- $relativeDir
- $relativeDir
- $relativeDir

## Files

- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative
- $relative

## Contents

### $relative

``markdown
# 私の標準 — デザインガイド

> AIにUIやツールを作らせるときに「**これに従って**」と渡すための、私個人のデザイン標準。
> 方向性は **「親しみ柔らかめ × burgundy」**。温かみはあるが、情報はキビキビ詰めて効率よく読ませる。
> トークンの実値は [`tokens.css`](./tokens.css) / [`tokens.json`](./tokens.json) を参照（このガイドは「なぜ・どう使うか」を定義する）。

---

## 0. このデザインの DNA（一言で）

| 軸 | 決定 | 意図 |
|----|------|------|
| アクセント色 | **burgundy `#8A2F3B`** | 操作・重要を示す唯一の主張色。暗い色なので白文字が映える。革張りの本のような落ち着いた温かみ |
| 背景・余白 | 温かいクリーム系（`#F4EEEC` / `#F9F4F4`） | 無機質にせず、長時間触れても疲れない |
| 角丸 | **控えめ 7px** | やわらかいが、丸すぎず端正。情報密度の高い画面でも締まる |
| 密度 | **コンパクト** | 実験結果・ダッシュボードなど、一画面に多くを正確に見せたい |
| フォント | **丸ゴシック（Nunito 系）** | 親しみの主役。数値は等幅で桁を揃える |
| 枠線 | 標準のはっきりめ（`#DCC1C4`） | 「どこを触れるか」が一目で分かる安心感 |

---

## 1. 設計原則（迷ったらここに立ち返る）

1. **一貫性が最優先。** 同じ意味のものは必ず同じ見た目に。間隔・角丸・色をその場の気分で変えない。必ずトークンの値から選ぶ。
2. **アクセント色は節約する。** burgundy は「押せる／いま重要」だけに使う。多用すると主張が薄れる。画面の大半はニュートラル。
3. **余白で構造を作る。** 線や色で区切る前に、まず余白（`--space-*`）で関係を示す。コンパクトでも詰めすぎない。
4. **数値は正確に、揃えて見せる。** 実験結果・指標・表の数値は等幅（`--font-mono` か `font-variant-numeric: tabular-nums`）で桁を揃える。
5. **状態を省略しない。** hover / focus / disabled と、データ取得・保存に伴う loading / 空 / エラー / 成功を設計する。特に **focus は `--focus-ring` で必ず可視化**（キーボード操作とアクセシビリティ）。
6. **両モード前提。** 視覚言語を決める色・余白・角丸・文字サイズ・影・動きはトークン変数経由にする（ダークモードや画面間の一貫性を守る）。

### 1a. トークンを使う範囲

**必ずトークンを使うもの**
- 色、余白、角丸、文字サイズ、影、アニメーション時間。
- 同じ意味で繰り返し使うコンポーネント寸法（ボタン高、アイコン寸法、サイドバー幅など）。必要なら先に意味のあるトークンを追加する。

**固有値を許可するもの**
- レスポンシブのブレークポイント、`minmax()` の列幅、画面やデータに依存する最大幅。
- SVG の `viewBox`、チャート座標、線幅、データから計算する割合・位置。
- ブラウザ既定の挙動を整える `1px` の境界線など、その値自体にデザイン上の選択肢がないもの。

固有値は構造やデータ表現のために使い、色や余白の微調整を場当たり的な数値で行わない。同じ固有値が3回以上現れ、意味も同じならトークン化を検討する。

---

## 2. カラーの使い分け

- **操作・ブランド** → `--color-accent`（hover/active あり）。主ボタン、主要リンク、選択状態、フォーカスリング。
- **面** → 背景 `--color-bg` ＜ カード `--color-surface` ＜ 入れ子/入力 `--color-surface-subtle`。階層は明度差で表現。
- **文字** → 本文 `--color-text` / 補足 `--color-text-secondary` / ヒント `--color-text-tertiary`。
- **状態色** → `danger`(エラー) / `success`(成功) / `warning`(注意) / `info`(情報)。各 `*-bg` `*-bd` はバナーやタグの背景・枠に。

### 2a. 非ベース色の3つの役割（色で意味を伝える前に必ず読む）

ニュートラル（面・文字・枠）以外の色は、必ず次の3つのどれかとして使う。役割をまたいで流用しない。

| 役割 | 使うトークン | 意味 | 原則 |
|------|------------|------|------|
| **アクセント** | `--color-accent` 系 | 操作・選択・現在地・ブランド | 1色だけ。状態やカテゴリの表現に使わない |
| **意味固定の状態色** | `danger` / `success` / `warning` / `info` | 固定の意味（エラー・成功・注意・情報）を持つ | 同じ意味は必ず同じ色。意味が一致しない物に流用しない |
| **ワークフロー状態色** | `--color-status-*`（idle / active / review / blocked / done / dropped） | 確定した状態enum（未着手→進行中→…→完了 等、意味と順序を持つ） | 状態↔色の対応表を1つ決め全画面で同一に。能動的な状態を前へ、終端・不明はニュートラルへ後退。色は補助・テキスト併記必須 |
| **カテゴリ色** | `--color-chart-1`〜`6` | 系列・工程・分類の「区別」だけ。優劣や状態の意味はない | この順で使う。状態の意味を持たせない |

**色は識別の主役にしない（最重要）。**
タグ・ラベル・バッジ・バーなど「状態や分類を表す部分」は、**色を消してもテキスト（または形状）だけで識別できる**こと。色は識別を速くする補助であって、唯一の手がかりにしない（§4 グラフ・§8 アクセシビリティと同じ原則）。

- **状態に色を割り当てるときは対応表を1つ決め、全画面で同一にする。** 同じ状態が画面ごとに違う色、違う状態が同じ色、テキストと矛盾する色（例: 「未完了」なのに緑）はしない。
- **状態色を「ただの色分け」に転用しない。** 工程バーやタグを赤・緑で塗り分けて区別したいだけなら、それは状態ではなくカテゴリ。`danger`/`success` ではなく `--color-chart-*` を使う。赤は常に「危険・エラー」を意味してしまう。
- **多値の状態（未着手／進行中／確認待ち／待ち／完了／中止 等）は「ワークフロー状態色」(`--color-status-*`) で表す。** ここでニュートラル一色に潰さない——それでは識別性も視線誘導も死に、画面が平坦になる。代わりに**状態↔色の対応表を1つ決め**、能動的な状態（進行中＝`active`）を前に出し、終端・未起動（未着手＝`idle`／完了＝`done`／中止＝`dropped`）を後退させる。全部を1色（特に緑）で塗る／逆に全状態へ強い色を当てるのは両方とも誤読を招く。色は補助で、状態名のテキストは必ず併記する。
- **カテゴリ色（chart-*）も色だけに頼らない。** 凡例・ラベル・線種/形状を併用する。

具体の適用はコンポーネント規定（§3 バッジ/タグ）とデータ可視化（§4）を参照。

### 2b. 色は「節約」と同時に「働かせる」

burgundy を節約する原則（§1-2）は、色を**減らす**ためではなく、効く場所に集中させるためにある。「節約」を「とにかく無彩・ニュートラルに倒す」と誤読すると、画面が平坦になり視線の順序が消える。**色を消した結果として無階層・平坦になっているなら、それは節約のしすぎ。** 次の場面では色を省略せず、はっきり働かせる。

- **密なリスト・表での状態識別**: 状態列は `--color-status-*` で差をつける。全行同色は走査を遅くする。
- **唯一の Primary Action**: 画面で最も実行してほしい操作だけ塗りつぶし burgundy（§2 の優先順位1）。
- **現在地・選択中**: ごく淡い背景"だけ"に頼らず、左アクセントバー（`box-shadow: inset 3px 0 0 var(--color-accent)`）や `--color-accent-subtle-bg-strong` など、離して見ても分かる強さを持たせる。
- **主役の指標・見出し**: 画面に1つ、サイズ（`--text-2xl`〜`3xl`）＋アクセントで視線の起点を作る（§6d）。
- **順序のある軸（優先度・リスク等）**: 高優先だけにアクセントのドット1個、のような最小符号化で差をつける（全要素を均一に並べない）。

### ⚠ 最重要ルール: burgundy と「エラーの赤」を混同しない
burgundy（`#8A2F3B`）は **暗く彩度の低いブランド色**。エラーの赤（`#CE3B3B`）は **明るく純度の高い警告色**。
- burgundy は「操作・ブランド」専用。**エラー・削除・危険の表現には絶対に使わない。**
- 赤い警告には必ず `--color-danger` 系を使う。両者は明度・彩度が十分違うので並んでも区別できる。
- 「削除」ボタンなど破壊的操作は `--color-danger` の枠/文字で表現する。

### burgundy の量と優先順位

burgundy は面積ではなく、視線の順序を作るために使う。

1. 画面の主目的を実行する Primary Action
2. 現在地や選択状態
3. 重要なリンク、focus リング
4. 装飾やブランド表示

- 塗りつぶしの burgundy は原則として Primary Action 1種類に限定する。
- タブや選択行は文字、下線、淡い `--color-accent-subtle-bg` を使い、すべてを塗りつぶさない。
- 画面を離して見たときに burgundy の大きな面が複数競合するなら使いすぎ。ニュートラルへ戻す。

---

## 3. コンポーネント規定

すべて角丸 `--radius-md`(7px)、コンパクト padding が既定。

### ボタン
- **Primary**: 背景 `--color-accent` / 文字 `--color-on-accent`(白) / padding `--pad-button` / weight 600。hover で `--color-accent-hover`、active で `scale(0.98)`。
- **Secondary**: 背景透明 / 文字 `--color-text` / 枠 `--color-border`。hover で背景 `--color-surface-muted`。
- **Danger**: 文字・枠 `--color-danger`。破壊的操作のみ。
- すべて `:focus-visible` で `box-shadow: var(--focus-ring)`。

### 入力欄 (input / select / textarea)
- 背景 `--color-surface-subtle` / 枠 `--color-border` / padding `--pad-input` / 角丸 `--radius-md`。
- focus で枠 `--color-accent` ＋ `--focus-ring`。
- エラー時は枠 `--color-danger`、下に `--color-danger-strong` の補足文。

### カード / パネル
- 背景 `--color-surface` / 枠 `--color-border`(0.5〜1px) / 角丸 `--radius-lg`(10px) / padding `--pad-card`。
- **面と背景の明度差を保つ。** `--color-bg`（背景）＜ `--color-surface`（面）の明度差で、影に頼らずパネルを背景から浮かせる。背景・面・入れ子(`--color-surface-subtle`)・ホバー(`--color-surface-muted`)が同明度に潰れていると全体が平坦になる。
- 影は基本なし。浮かせたい時だけ `--shadow-sm`〜`md`。
- 指標カード（数値表示）は背景 `--color-surface-subtle`、ラベル 11px secondary、数値 `--text-xl`〜`2xl` weight 700・等幅。

### テーブル（実験結果・一覧）
- ヘッダ文字 secondary・11〜13px。行区切りは `--color-border-subtle`。
- 数値列は右揃え＋等幅（桁揃え）。ホバー行 `--color-surface-muted`。
- 罫線は引きすぎない（横罫線中心、縦罫線は原則なし）。

### バッジ / タグ
- 状態: 対応する `*-bg` 背景 ＋ `*-strong` 文字。
- 中立タグ: `--color-accent-subtle-bg` ＋ `--color-accent-strong`、角丸 `--radius-pill`。
- **状態バッジは必ず状態名のテキストを表示し、色は §2a の対応表に従う。** テキストと矛盾する色を当てない。1つのバッジに1つの意味（完了・要判断などを別軸で示すときはバッジを分ける）。
- **種別・分類のタグは中立タグ（1色）で表し、テキストで区別する。** 色で塗り分けたい場合だけ §4 のカテゴリ色（chart-*）を使い、状態色は使わない。

### ナビゲーション / トースト / ドロワー
- **ナビゲーション**: 現在地は `aria-current` ＋ 知覚できる視覚標識（左アクセントバー `box-shadow: inset 3px 0 0 var(--color-accent)` ／ `--color-accent-subtle-bg-strong` の背景 ／ 文字色＋太さ）で示す。ごく淡い背景"だけ"では白い面に埋もれるので、最低2要素を併用する。ただし Primary Action と競合する全面塗りつぶし burgundy は使わない。
- **トースト**: 保存完了など、作業を止めない短い結果通知に使う。通常は `role="status"` / `aria-live="polite"`。自動消去は5〜8秒を目安にし、重要な失敗は消えるトーストだけで済ませず該当箇所にも残す。
- **ドロワー**: 補助編集や詳細確認など、元画面の文脈を保ちたい作業に使う。URLで共有・再訪すべき内容や長い作業はページにする。閉じたら起点へ focus を戻す。

### アイコン
- Web/React の標準候補は **Tabler Icons**。既に導入済みならそれを使う。
- 未導入プロジェクトでは依存追加の許可を取る。許可待ちで実装を止める必要がある場合は、既存のアイコンセット、プラットフォーム標準アイコン、または少数のインライン SVG を使う。
- 同じアプリ内で複数のアイコンセットを混ぜない。装飾は `aria-hidden="true"`、アイコンだけの操作には `aria-label` を付ける。

---

## 4. データ可視化（グラフ・チャート）

実験結果のグラフが主用途なので、配色は厳密に。

- **系列カラー（カテゴリ用・この順で使う）**:
  1. `--color-chart-1` burgundy（主役） 2. `--color-chart-2` blue 3. `--color-chart-3` green 4. `--color-chart-4` amber 5. `--color-chart-5` violet 6. `--color-chart-6` gray
- **色だけに頼らない。** 線種（実線/破線/点線）やマーカー形状を併用し、凡例にも両方示す（色覚多様性・白黒印刷対応）。
- **グリッド線**は `--color-border-subtle` で薄く。軸ラベル・凡例は `--color-text-secondary`。
- **強調したい1系列**だけ burgundy、他はグレー、という「1色強調」は実験のbefore/after比較に有効。
- 数値ラベル・軸は等幅フォントで桁を揃える。
- 連続値（ヒートマップ等）は単色グラデーション（burgundy 1色の濃淡）で。虹色は使わない。
- **ガントの工程バーなど「分類のための色」は系列カラー（chart-1〜6）から取る。** `danger`/`warning`/`success` などの状態色を区別目的で流用しない（赤＝危険の意味が固定されるため）。バーには必ずラベルを表示し、色は補助にとどめる。

---

## 5. UXの挙動（見た目より大事）

見た目が整っていても、挙動が雑だと体験が壊れる。以下は**すべての画面で守る**。

1. **取り消しを確認より優先。** 破壊的操作（削除・上書きなど）は、現実的に復元できるなら **undo（元に戻す）** を用意する。確認ダイアログは思考を中断するため、取り返しがつかない場合に限定する。
2. **4つの状態を到達可能にする。** 各画面に4状態を同時表示するという意味ではない。データを読む・作る・更新する主要な領域や非同期フローごとに、該当しうる **読込中・空・エラー・成功** を設計し、アプリから確認できるようにする。静的な設定画面など、発生しない状態を無理に作らない。
3. **入力を守る。** バリデーションエラーや通信失敗でフォームの入力値を**絶対に消さない**。ユーザーが打ち直す苦痛は信頼を破壊する。
4. **即フィードバック。** ボタンを押したら100ms以内に押下・無効化などの反応を返す。処理が300ms未満で終わる見込みなら大きなスピナーは出さず、300msを超えるときに loading を表示する。1秒を超えるなら処理内容、10秒を超えるなら進捗かキャンセル手段を示す。
5. **妥当な初期値。** フォームを空欄で始めない。よく使う値・前回の入力・推測できる値を既定にする。
6. **状態を適切な場所に保持。** リロードや「戻る」で作業が消えないようにする。共有・再現したい表示状態はURL、一端末だけの設定や下書きは localStorage、複数端末で必要な正式データはサーバーへ保存する。機密情報・認証情報を localStorage に置かない。
7. **操作モードの切り替えで主画面を動かさない。** 接続モード、選択モード、ドラッグ中の案内など、一時的な状態表示で一覧・表・キャンバスの位置や高さを変えない。必要ならパネル内の絶対配置、ツールバー内の固定領域、トーストを使い、クリックした瞬間にメイン画面が押し下がる・スクロール位置がズレる挙動を避ける。

### 5a. 削除・上書きの判断

| 条件 | 使う挙動 |
|------|----------|
| 一覧からの単件削除など、短時間で復元可能 | 即時実行 + undo トースト |
| サーバー側で復元可能、または論理削除できる | 即時実行 + undo / 復元導線 |
| 大量削除、外部送信、課金、権限変更、物理削除 | 実行前に確認 |
| 影響範囲が大きく、対象名の確認が重要 | 対象と影響を具体的に書き、必要なら名称入力で確認 |

確認文は「本当によろしいですか」ではなく、対象・件数・戻せない理由・実行後に起きることを簡潔に示す。

### 5b. 代表画面の骨格

- **フォーム**: 目的ごとに項目をまとめ、ラベルは入力欄の近くに置く。Primary Action はフォーム末尾。エラーは該当欄の直下に残し、最初のエラーへ focus を移す。
- **一覧**: 検索・絞り込み、件数、結果、ページングを同じ読み順に置く。行操作は常時並べすぎず、主要操作1つ + その他メニューを基本にする。
- **ダッシュボード**: 最初に判断に必要な指標、その次に変化と内訳、最後に詳細表。カード数を目的にせず、各チャートに「何を判断するか」を1つ持たせる。

---

## 6. アンチパターン（避ける）

### 6a. 使い勝手の地雷

| 避けること | 代わりにやること |
|-----------|-----------------|
| 無限スピナーを放置 | 進捗表示・スケルトン・タイムアウトで状況を見せる |
| アイコンだけで意味不明 | テキストラベルを併用する。アイコンのみは「意味が自明なもの」（✕で閉じる等）に限る |
| モーダルの多重・乱発 | インライン表示・ドロワー・ページ遷移を優先。モーダルは「今の文脈を完全に中断すべき時」だけ |
| 小さすぎる操作対象 | 最低 32×32px（理想 44×44px）のクリック/タップ領域を確保 |
| 確認ダイアログの乱発 | undo で済むなら確認しない。確認は「本当に取り返しがつかない操作」だけに |

### 6b. AIが作りがちな"いかにも"（これを出したら即やり直し）

| 避けること | なぜダメか / 代わりにやること |
|-----------|------------------------------|
| 紫グラデのヒーロー・派手な装飾 | 自分のトークンでフラットに。グラデーション・光彩・ネオンは使わない |
| 絵文字をアイコン代わりに使う | アイコンフォント（Tabler 等）か SVG を使う。絵文字は環境で見た目が変わり、制御できない |
| 仮データ / lorem ipsum の残骸 | 現実的なサンプルデータか、明示的な空状態（「まだデータがありません」）にする |
| 何でも角丸＋影マシマシ | 標準の角丸 7px・影は `--shadow-sm` 以下で控えめに。影に頼らず枠線と余白で構造を示す |
| 中身の薄いテンプレ構成 | 「機能カード3つ並べ」「巨大な Get Started ボタン」を惰性で置かない。その画面に必要なものだけを置く |
| トークンから外れた値のバラつき | 余白・角丸・色・フォントサイズは**必ず**トークン変数から選ぶ。`padding: 13px` のような中途半端な値を作らない |

### 6c. 説明文の洪水（冗長UI）

AIは「丁寧＝高品質」と学習しているため、あらゆる画面に説明文・注釈・免責を詰め込む。しかし**ユーザーは読まない**。

背景にある原則:
- **Progressive Disclosure**（Norman/Nielsen）: 必要になるまで隠す。詳細は「もっと見る」で出す。
- **Tufteのデータ・インク比**: 意味のないインクを消す。画面上のすべての要素が存在理由を持つべき。
- **Hick's Law**: 情報が多い＝判断が遅い。見せる量を減らせば、ユーザーの行動は速くなる。

**ルール:**
- **通常画面は説明文ゼロから始める。** テストで「これがないと分からない」と証明されたものだけ足す。
- 空状態の次の行動、エラーの原因と直し方、不可逆操作の影響、入力制約など、判断や回復に必要な状態説明は省略しない。
- クリック・ホバー・展開で出せる内容は、初期表示に入れない。
- 初期表示のテキストは「ユーザーの次の一手に必要な最小限」に絞る。
- ラベルは最終手段。データ自体が何か分かるなら、ラベルを付けない（Refactoring UI: "Labels Are a Last Resort"）。

### 6d. 視覚ヒエラルキーの欠如と機能の詰め込み

AIは全要素を同じ大きさ・同じ色・同じ余白で並べる。どれが主役か分からない。さらに1画面に機能を詰め込みすぎる。

背景にある原則:
- **Refactoring UI の3レバー**: ヒエラルキーは**サイズ・太さ・色**の3つで作る。3つとも同じなら平坦に見える。
- **F/Zパターン走査**（Nielsen Norman Group）: ユーザーの視線は左上→右→左下と動く。重要なものはこの動線上に。
- **Hick's Law**: 選択肢が増えると判断速度が対数的に遅くなる。
- **Miller's Law**: 短期記憶は7±2項目。

**ルール:**
- **各画面の主目的は1種類まで。** 同じ目的のアクションをヘッダーとフォーム末尾など複数箇所に置くことは許可するが、強い Primary の見た目を同時に複数見せない。片方をリンク、ショートカット、sticky action など補助表現にする。
- **主役を1つ作り、サイズで差をつける。** ダッシュボードの指標やカードを全部同じサイズ・同じ太さで並べない。画面で最も重要な数値/要素を1つだけ一段大きく（`--text-2xl`→`--text-3xl`）し、アクセント（左バー等）で視線の起点にする。残りは従にする。3レバー（サイズ・太さ・色）のうち色を burgundy 節約で使えないなら、その分**サイズと太さの差を大きく**つけて補う。
- **目を細めるテスト（Squint Test）**: 画面を30cmに離してぼかしたとき、Primary Action（と主役の指標）が最初に目に入ること。入らないならヒエラルキーが足りない。
- **同一階層で並列に比較・判断させる主要操作は7個までを目安にする。** フォーム項目、一覧各行で繰り返す同一操作、ページング、常識的な閉じる操作は単純加算しない。7個を超えたら頻度・重要度・文脈でグループ化し、必要ならタブ、折りたたみ、その他メニュー、別画面へ移す。
- **5秒テスト**: 初見のユーザーが5秒でこの画面の目的を言えるか。言えないなら詰め込みすぎ。

### 6e. 死んだUI（反応のなさ）と文脈の無視

AIが生成したUIは見た目は整っているが、触ると「死んでいる」ことが多い。hover しても何も起きず、押しても反応が見えない。また、内部ツールにマーケティングコピーを入れる等、文脈を無視した構成を出してくる。

背景にある原則:
- **Nielsen Heuristic #1（状態の可視性）**: ユーザーは「今何が起きているか」を常に知るべき。
- **User-Centered Design / Jobs To Be Done**: 「誰が・何のために使うか」が設計の出発点。

**ルール:**
- **操作要素は最低3状態**: default / hover（又は focus） / active（押下中）。状態の変化がないボタンは死んだボタン。
- **ユーザーの操作は100ms以内にフィードバック。** それ以上かかる処理は即座にloading状態を示す。
- **状態遷移にはアニメーション**（`--duration-fast` 〜 `--duration-base`、`--ease`）。ただし `prefers-reduced-motion` では無効にする。
- **AIへの指示には文脈を必ず明記**: (1) アプリの種類（内部ツール / 個人ツール / ダッシュボード等） (2) 使う人 (3) やりたいこと (4) 出してはいけないもの。これがないとAIは訓練データの中央値（＝マーケティングLP）に寄る。

### 6f. コンポーネントの過剰設計

AIは（特にGPT-5系は）必要以上に大量で複雑なコードを生成する。不要なラッパー、使わないProps定義、同じ用途のライブラリの二重import、3行で済むものへのファクトリパターン。

背景にある原則:
- **YAGNI（You Ain't Gonna Need It）**: 必要になるまで作らない。
- **KISS**: 同じことを達成する最もシンプルな方法が最善。

**ルール:**
- 生成されたコードを受け取ったら「**もっと少ない部品で同じことができるか？**」と問う。
- **3箇所以上で再利用しないならコンポーネント化しない。** インラインで書く方がシンプルなら、インラインでいい。
- 不要な抽象化・ラッパーdiv・未使用のPropsは削除する。

---

## 7. 文章・マイクロコピー

UIの中の文章にもトーンの一貫性が要る。

- **エラー文は「原因＋直し方」をセットで。** 「エラーが発生しました」だけでは何も伝わらない。「ファイルサイズが10MBを超えています。10MB以下のファイルを選んでください」のように書く。
- **ボタンは動詞。** 「OK」「はい」ではなく「保存する」「削除する」「送信する」。何が起きるか読めるようにする。
- **簡潔・落ち着いた敬体。** 煽らない、叫ばない、過剰に褒めない。「！」の多用を避ける。トーンを統一する。

---

## 8. アクセシビリティ下限

最低限これを守れば、多くの人が使える状態になる。

- **コントラスト WCAG AA（4.5:1）以上。** 本文と背景、ボタン上の文字。burgundy 面の白文字、各 `*-strong` 文字は確保済み。
- **色だけで情報を伝えない。** アイコン・テキスト・形状を必ず併用する（色覚多様性への配慮）。
- **focus 可視・キーボードで完結。** 操作要素は `:focus-visible` で `--focus-ring` を表示。Tab キーだけで全操作ができること。
- **画像に alt・アイコンに aria-label。** 装飾アイコンは `aria-hidden="true"`、操作アイコンは `aria-label` で意味を伝える。
- **フォーカス順は視覚順と一致。** 正の `tabindex` で順番を作らない。DOM 順を整え、モーダルやドロワーを閉じたら起点へ focus を戻す。
- **HTML の意味を優先。** クリック可能な `div` ではなく `button` / `a` / `input` を使う。見出し階層、`label`、ランドマークを保つ。
- **状態変化を通知。** 保存完了などは `role="status"` / `aria-live="polite"`、ユーザーが直ちに対処すべき通信失敗などは `role="alert"` を使う。同じ内容を連続して読み上げさせない。
- **フォームエラーを関連付ける。** `aria-invalid` と `aria-describedby` を使い、エラー概要だけでなく各入力欄の近くにも原因と直し方を残す。
- **ダークモードでも同じ基準。** トークン変数を使えば自動で満たす。

---

## 9. レスポンシブと密度

- **狭くなったら情報を消す前に並べ替える。** 2カラムを1カラムへ、横並び操作を折り返しへ、表をカード化または横スクロールへ変える。
- ブレークポイントは端末名ではなく、内容が崩れる幅に置く。開始目安は **760px 前後（mobile）**、**1120px 前後（compact desktop）** だが、固有値として画面内容に合わせてよい。
- モバイルではタップ領域を原則44×44px以上にする。デスクトップのコンパクト表示では32px以上を下限とする。
- モバイルでも文字サイズを11px未満にしない。情報量を減らす場合は、主要値・状態・主操作を残し、補足を詳細表示へ移す。
- hover だけで情報や操作を公開しない。タッチ、キーボードでも同じ内容へ到達可能にする。

---

## 10. データ表示規則

- **日付**: 保存・通信は ISO 8601。画面表示は利用者の locale と timezone に合わせる。同一年内では年を省略してよいが、曖昧な `06/07` より `6月7日` を優先する。
- **時刻**: 秒が判断に不要なら `HH:mm`。経過時間は `hh:mm:ss` など、時計時刻と区別できる形式にする。
- **単位**: 値と単位の間隔・表記を画面内で統一する。列見出しに単位がある表では各セルに繰り返さない。単位変換を勝手に行わない。
- **小数桁**: 測定精度または意思決定に必要な桁へ揃える。同じ指標の一覧内では桁数を統一し、不要な `.0` を混在させない。
- **欠損値**: `0` と欠損を混同しない。欠損は `—` を基本とし、理由が重要なら「未測定」「対象外」を使う。空文字で放置しない。
- **確度を保ったまま保存できるようにする。** 未定／仮／確定／実績を同じ「日付」に潰さない。分からない値は分からないまま（`—`・「日程未確定」等）保存でき、後から精度を上げられる入力にする。最初から完全な入力を要求しない（入力＝粗く速く、整理＝後で分類・日付・関連付け、の二段構え）。
- 数値は右揃え + `tabular-nums`。比較する値は同じ単位・同じ桁で並べる。

---

## 11. 実装・ファイル規約

- テキストファイルは **UTF-8** で読み書きする。日本語を含むファイルを PowerShell で扱うときは `Get-Content -Encoding UTF8` / `Set-Content -Encoding UTF8` 相当を明示する。
- 既存プロジェクトのフレームワーク、依存、コンポーネントを優先する。新しい依存パッケージを追加する前に確認を取る。
- ライブラリ導入は目的ではない。標準 Web API や既存部品で明快に実装できる小さな機能は増やさない。

---

## 12. ダークパターン禁止

個人ツールでも、他人に渡す可能性があるなら守る。自分向けでも品位の基準として。

- **不安や罪悪感を煽る文言を使わない。**（「本当にやめるんですか？」「データが失われます！」→ 事実だけを淡々と伝える）
- **解約・削除を意図的に難しくしない。** 始めるのと同じ手順数で終われるようにする。

---

## 13. やって良い / ダメ（まとめ）

✅ 良い
- 画面の大半をニュートラルにし、burgundy を要所だけに効かせる
- 非ベース色は「意味固定の状態色（danger等・流用禁止）」「ワークフロー状態色（--color-status-*・対応表を1つ）」「カテゴリ色（chart-*・区別のみ）」を分ける。意味固定色は意味が一致する所だけ、同じ状態は同じ色
- タグ・バッジ・バーは色を消してもテキストで識別できる（色は補助）。多値の状態は --color-status-* で識別差をつけ、進行中を前に・終端を後退させる（ニュートラル一色に潰さない）
- 面と背景の明度差を保ち、影に頼らずパネルを浮かせる。主役の指標を1つサイズで際立たせ、現在地は淡背景だけに頼らず標識を2要素以上で示す
- 余白でグルーピング、角丸とフォントで親しみを出す
- 数値を等幅で桁揃え
- focus リングを必ず出す
- 主要なデータ領域・非同期フローで、該当する4状態（読込中・空・エラー・成功）へ到達できる
- エラーでも入力値を保持する
- 確認ダイアログより undo を優先する
- ボタンに動詞ラベルを付ける
- 説明文はゼロから始め、必要と証明されたものだけ足す
- 1画面の主目的は1種類、強い Primary は同時に1つ
- 操作要素はdefault/hover/activeの3状態を持つ
- 状態遷移は100ms以内にフィードバック
- 表・一覧にはクリップボードコピー導線を用意する
- エクスポートCSVはUTF-8 BOM付き
- ブラウザ/OSの既定ショートカットを上書きしない

❌ ダメ
- burgundy をエラーや大面積の塗りに使う
- 状態色を単なる色分けに流用する／多値の状態を全部1色（特に緑）で塗る／テキストと矛盾する色を当てる／テキストなしの色だけタグ
- アクセント色を2色以上にする（主張がぶれる）
- 色・余白・角丸・文字サイズをトークンから外れた値で場当たり的にハードコードする
- 角丸を要素ごとにバラバラにする / 間隔を目分量で決める
- 影を濃く多用する（このデザインは影に頼らない）
- 11px 未満の文字を使う
- 絵文字をアイコンにする
- 紫グラデ・影マシマシ・テンプレ構成の"いかにも"を作る
- エラー文を「エラーが発生しました」で済ませる
- 不安を煽る文言・解約を難しくする設計
- 説明文・注釈・免責を画面に詰め込む（Progressive Disclosure で隠す）
- 同一階層に主要操作を8個以上並べ、優先順位もグループも示さない
- hover/active状態のない「死んだボタン」を放置する
- 文脈を無視してマーケティングコピーを内部ツールに入れる
- 3箇所未満でしか使わないのにコンポーネント化する

---

## 14. コピー・エクスポート規約

研究の実験結果が主用途のため、データを持ち出しやすくする。

### 14a. コピー

- 表やデータ一覧には「クリップボードにコピー」の導線を用意する。コピー形式はタブ区切りテキスト（スプレッドシートにそのまま貼れる）を基本とする。
- コピー成功は短いトースト（「コピーしました」）で伝える。ボタンのアイコン差し替え（1〜2秒）でもよい。
- 単一セルの値（ID、数値など）はクリックやボタンでコピーできると便利だが、必須ではない。主要な一覧・表に対してまとめてコピーを優先する。

### 14b. エクスポート

- グラフは **PNG**（発表・共有用）と **SVG**（編集用）でのダウンロードを候補にする。最低限どちらか1つ。
- 表データは **CSV（UTF-8 BOM付き）** でエクスポートする。Excel での文字化けを防ぐため BOM を付与する。
- ファイル名は `{アプリ名}_{内容}_{YYYYMMDD}.{拡張子}` を基本にする（例: `run-workbench_runs_20260613.csv`）。
- エクスポートボタンは Secondary スタイル。メインの作業フローを邪魔しない位置（ヘッダ右端やパネルのツールバー）に置く。

### 14c. 入力時

- CSV/TSV のインポートやペーストによる一括入力に対応する場合は、プレビューを表示してから確定する。直接書き込まない。

---

## 15. キーボードショートカット規約

個人ツールでも、よく使う操作にはショートカットを割り当てると効率が上がる。

### 15a. 基本方針

- ブラウザ・OS の既定ショートカット（Ctrl+C, Ctrl+V, Ctrl+Z, Ctrl+S, F5 など）を上書きしない。
- アプリ固有のショートカットは **表示の切り替え・検索・主操作** など、繰り返し頻度の高いものに限定する。数が多すぎると覚えられない。
- ショートカットはキーボード操作の補助であり、ショートカットなしでもすべての操作に到達可能であること。

### 15b. 推奨キー割り当て

| 操作 | キー | 備考 |
|------|------|------|
| 保存 / 記録 | `Ctrl+S` | ブラウザの保存ダイアログを `preventDefault` で抑止。フォームがあるアプリのみ |
| 検索 / フィルター | `Ctrl+K` または `/` | 検索バーへ focus を移す |
| 新規作成 | `N`（入力欄外で） | フォームやモーダルを開く |
| 元に戻す | `Ctrl+Z` | undo 対応の操作がある場合 |
| テーマ切り替え | なし（ボタンのみ） | 頻度が低いためショートカット不要 |
| ショートカット一覧 | `?`（入力欄外で） | 一覧をダイアログか画面下部に表示する |

上記は目安であり、アプリの性質に合わせて調整する。使わないものは実装しない。

### 15c. 表示と発見

- ショートカット一覧は `?` キーで表示する。
- ボタンやメニュー項目に対応するショートカットがある場合、ツールチップ（hover / focus 時）にキーを表示する。初期表示には入れない。
- ショートカットを使わなくても操作に支障がないことを前提にし、ショートカットを知らないユーザーへの説明は最小限にする。

---

## 16. 情報設計・画面構成（IA）

機能を「どこに置くか」は見た目より上位の設計。データモデルの形をそのまま画面にしない。良い整理とは要素を減らすことだけでなく、**「次にどこを押すか迷う回数」を減らす**こと。

- **データモデル ≠ 画面構成。** DBのオブジェクト1つにつき1画面、にしない。画面は「利用者が何をしたいか」でまとめる。近い目的の情報（例: メモと資料リンク）は1つの一覧に統合し、型の違いはバッジや表示方法で補う。
- **ナビは機能数でなく利用頻度で設計する。** 日常的に使う操作だけを主要ナビへ。設定・情報源・管理などの補助機能は目立たせない（主要操作は §6d の「7個まで」と合わせて絞る）。
- **新画面より既存導線への統合を優先する。** 機能を足す前に、既存画面のフィルター・タブ・詳細欄・一括操作で扱えないか考える。画面を増やすほど判断回数が増える。
- **画面ごとに責任を1つに限定する。** 一覧＝探す・整理する／詳細＝理解する／編集＝変更する。一覧に編集項目を詰め込まない、詳細に管理設定を混ぜない。一覧・詳細・編集は同じデータの異なる投影であり、見える属性や状態が画面間で食い違わないこと。
- **同じ入力目的の導線を重複させない。** クイック記録・一覧の簡易追加・Inbox追加が並立すると、どれを使うか迷う。主導線を1つ決め、他は補助に格下げする。
- **設定画面には「利用者が明示的に変える物」だけ置く。** 表示設定・関係者・バックアップ等。内部ID・スキーマ・情報源レコードなど通常触らない実装詳細は出さない。
- **一件操作と大量操作は別の問題として扱う。** 1件ずつ快適でも、20件の修正が必要になると運用できない。表貼り付け・一括変更・コピー・エクスポートなど、量が増えたときの逃げ道を早めに用意する（§14）。
- **主要画面は次の行動を生む。** ダッシュボードを観察で終わらせない。「遅れている」と表示したら、そこから予定変更や詳細確認へ直接進める導線を置く。
- **意味は説明文でなく配置で伝える。** 上部の説明を増やす前に、見出し・順序・グループ分け・ボタン名で理解できるようにする（§6c）。

---

## 17. 機能の成立条件と監査

「コードがある」と「使える」は別物。機能は入口から再利用まで通って初めて存在する。

- **機能の成立＝一連のループが通ること。** 作成できる → 一覧で見つかる → 詳細で確認できる → 編集・削除できる → 保存後・再起動後も残る。どれか1つでも欠けたら未完成。データとCSSだけ残って入口のない機能は「無い」のと同じ。
- **存在と到達可能性を分けて検証する。** API・データモデルが実装済みでも、通常操作から迷わず辿り着けなければ未実装と扱う。「保存できるか」だけでなく「そこへ辿り着けるか」を確認する。
- **削除・整理のあとは残った導線を実画面で検証する。** ビルド成功では不十分。到達・作成・保存・再表示・削除まで通す。
- **監査は仕様書でなく現在の利用体験を基準にする。** 仕様にあっても、役割が重複・未使用なら再検討する。仕様は実装の免罪符ではない。
- **UIから消すこととデータを壊すことを分ける。** 使われない画面は消してよいが、既存データは互換のため読み込み可能に残す。利用実態を確認してからデータモデルを廃止する。
- **初期データ（seed）はプロダクトの意思表示。** seed を生成している機能は実質「推奨機能」になり、正しい使い方を教える教材にもなる。使わせたくない機能の seed は作らない／見栄え用のダミーで埋めない（§6b）。
- **変更の文脈を残す。** 業務では「今の予定」だけでなく「何が・いつ・なぜ変わったか」が重要。履歴や情報源は後付けの監査機能ではなく、意思決定を再現するための機能として設計する。

> 業務ツールは機能の集合ではなく、**曖昧な情報を素早く受け取り、少しずつ構造化し、変化の理由を保ちながら、安全に見直し・持ち出せる作業環境**として設計する。

---

## 18. AIへの渡し方（コピペ用プロンプト）

新しいツール/UIを作らせるとき、以下を冒頭に貼る:

```
このプロジェクトの design-standard/ にある私のデザイン標準に従ってください。
- design-guide.md の原則・挙動・アンチパターン・文章規定をすべて守る
- 色・余白・角丸・文字サイズ・影・動きは tokens.css の変数を使う。レイアウト幅、ブレークポイント、SVG/チャート座標など構造・データ上の固有値は許可する
- 方向性は「親しみ柔らかめ × burgundy」。アクセント #8A2F3B は操作/重要のみに使い、エラーの赤(--color-danger)とは絶対に混同しない
- 非ベース色は「アクセント／意味固定の状態色(danger等)／ワークフロー状態色(--color-status-*)／カテゴリ色(chart-*)」の4役割を区別し流用しない。意味固定色は意味が一致する所だけ・同じ状態は同じ色、確定した状態enumは--color-status-*で対応表を1つ決め進行中を前に・終端を後退、分類はchart-*。タグ・バッジ・バーは色を消してもテキストで識別できるようにする
- 面と背景の明度差で影に頼らず奥行きを出す。画面の主役指標を1つサイズで際立たせ、現在地は淡背景だけに頼らず視覚標識を2要素以上で示す（平坦・無階層を避ける）
- コンパクト密度・角丸7px・丸ゴシック・等幅数値・focusリング必須・ライト/ダーク両対応
- 主要なデータ領域・非同期フローごとに、該当する4状態（読込中・空・エラー・成功）を到達可能にする。発生しない状態は無理に作らない
- エラーでもフォーム入力を消さない。復元可能な削除はundo、不可逆・大量・外部影響のある操作は具体的な確認を使う
- 絵文字アイコン・紫グラデ・影マシマシ・テンプレ構成の"いかにも"禁止
- 通常画面は説明文ゼロから始める。空・エラー・不可逆操作・入力制約の説明は省略しない
- 各画面の主目的は1種類、強いPrimaryは同時に1つ。同一階層で比較させる主要操作は7個までを目安にする
- 操作要素はdefault/hover/activeの3状態必須。フィードバックは100ms以内。死んだUIを作らない
- loadingは処理が300msを超えるときに表示し、1秒超では処理内容、10秒超では進捗かキャンセル手段を示す
- フォーカス順を視覚順に合わせ、ARIA、live region、フォームエラーの関連付けを実装する
- 日付・単位・小数桁・欠損値の表示を画面内で統一し、数値は等幅で揃える
- Web/Reactのアイコンは既存導入済みならTabler Iconsを優先。未導入なら依存追加前に確認する
- テキストファイルはUTF-8で読み書きする
- コンポーネントの過剰設計を避ける。3箇所以上で使わないならコンポーネント化しない
- エラー文は原因＋直し方をセット。ボタンは動詞。トーンは簡潔・落ち着いた敬体
- 表・一覧にはクリップボードコピー（タブ区切り）の導線を用意する。グラフはPNGかSVG、表データはCSV（UTF-8 BOM付き）でエクスポート可能にする
- ブラウザ/OSの既定ショートカットを上書きしない。アプリ固有のショートカットは`?`キーで一覧表示する
- データモデルを1:1で画面化しない。近い目的の情報は統合、ナビは利用頻度で設計、新画面より既存導線への統合を優先する（§16）
- 機能は「作成→一覧→詳細→編集削除→永続化」が通って初めて成立。到達できない画面・保存されるだけのデータ・未接続コンポーネントを完成扱いにしない（§17）
- 入力は粗く速く・整理は後で（分類/日付/関連付け）の二段構え。未定/仮/確定/実績を同じ日付に潰さない。一件操作だけでなく一括操作・コピー・エクスポートの逃げ道を用意する
実装は tokens.css を読み込み、変数を参照する形にしてください。
```

CSSを使えない環境（ネイティブ/デスクトップアプリ等）では、`tokens.json` の値を各プラットフォームの色・寸法定義に移し替えて使う。

``

### $relative

``markdown
# design-standard/

私（ユーザー）の個人デザイン標準。AIにUI/ツールを作らせるときの参照元。

| ファイル | 役割 |
|----------|------|
| [`design-guide.md`](./design-guide.md) | 原則・使い分け・コンポーネント規定・do/don't・AIへの渡し方（**まずこれを読む**） |
| [`tokens.css`](./tokens.css) | 実装用トークン（CSS変数、ライト/ダーク両対応）。Web/HTMLはこれを読み込む |
| [`tokens.json`](./tokens.json) | 同じトークンの構造化版。ネイティブ/デスクトップアプリ等、CSS以外で使う |

方向性: **「親しみ柔らかめ × burgundy」** — burgundy(`#8A2F3B`)を操作色に、角丸7px・コンパクト密度・丸ゴシック・等幅数値で、情報を効率よく温かく見せる。

``

### $relative

``css
/*
  私の標準 — Design Tokens (CSS Custom Properties)
  方向性: 「親しみ柔らかめ」/ burgundy・コンパクト・角丸控えめ・丸ゴシック
  使い方: アプリの最上位要素に :root として読み込む。ダークモードは
          OSの prefers-color-scheme に自動追従。手動切替は <html data-theme="dark">。
*/

:root {
  /* ---- Brand / Accent (burgundy) ---- */
  --color-accent:            #8A2F3B; /* 主操作色: ボタン・リンク・選択状態 */
  --color-accent-hover:      #73262F;
  --color-accent-active:     #5E1F28;
  --color-accent-strong:     #5E1F28; /* アクセント色面の上に置く濃い文字 */
  --color-accent-subtle-bg:  #FBF3F4; /* 選択行・タグ等のごく淡い背景 */
  --color-accent-subtle-bg-strong: #F3DCE0; /* 現在地・選択中の強めの淡背景（淡背景だけに頼らせない補強） */
  --color-accent-subtle-bd:  #E6BCC1;
  --color-on-accent:         #FFFFFF; /* アクセント色面の上の文字（白でコントラスト確保） */

  /* ---- Surfaces (warm neutrals) ----
     背景〜面の明度差を確保して奥行きを作る（影に頼らず階層を出すための土台）。 */
  --color-bg:                #ECE2DF; /* アプリ全体の背景（白いパネルと明度差を確保） */
  --color-surface:           #FFFFFF; /* 主要なカード・パネル */
  --color-surface-subtle:    #F7F1F1; /* 入れ子のカード・入力欄・指標カード */
  --color-surface-muted:     #E7DCD9; /* ホバー行・無効状態 */

  /* ---- Text ---- */
  --color-text:              #26201E; /* 本文・見出し */
  --color-text-secondary:    #7C746E; /* 補足・ラベル */
  --color-text-tertiary:     #A89F99; /* ヒント・プレースホルダ */

  /* ---- Borders ---- */
  --color-border-subtle:     #ECE0DE; /* 区切り線・控えめな境界 */
  --color-border:            #DCC1C4; /* 標準の枠線（カード・入力欄） */
  --color-border-strong:     #C9A6AA; /* 強調・ホバー時の枠線 */

  /* ---- Semantic（エラー赤はアクセントと明確に別物。明るく純度の高い赤） ---- */
  --color-danger:            #CE3B3B;
  --color-danger-strong:     #A12626;
  --color-danger-bg:         #FBEAEA;
  --color-danger-bd:         #F0C7C7;

  --color-success:           #2E8B57;
  --color-success-strong:    #1C5E3A;
  --color-success-bg:        #E8F3EC;
  --color-success-bd:        #C5E3D1;

  --color-warning:           #C77D29;
  --color-warning-strong:    #8A5212;
  --color-warning-bg:        #FBF0DD;
  --color-warning-bd:        #EFD9B0;

  --color-info:              #2D7FB8;
  --color-info-strong:       #1C557D;
  --color-info-bg:           #E8F1F8;
  --color-info-bd:           #C3DCEE;

  /* ---- Workflow status palette（固定の状態enum専用＝第4の役割。
         danger/success 等の「意味固定色」とも chart-* の「区別だけ」とも別ロール。
         能動的な状態を前に出し、終端・不明はニュートラルへ後退させる。色は補助、テキストは必須。
         意味固定色を別名参照しているのでライト/ダークに自動追従する（review のみ独自値）。 ---- */
  --color-status-idle-fg:    var(--color-text-secondary); /* 未着手・inbox・計画中（未起動） */
  --color-status-idle-bg:    var(--color-surface-muted);
  --color-status-idle-bd:    var(--color-border);
  --color-status-active-fg:  var(--color-info-strong);    /* 進行中（最も前に出す能動状態） */
  --color-status-active-bg:  var(--color-info-bg);
  --color-status-active-bd:  var(--color-info-bd);
  --color-status-review-fg:  #564AA8;                     /* 確認待ち・レビュー中 */
  --color-status-review-bg:  #EEEBFA;
  --color-status-review-bd:  #D6CEF0;
  --color-status-blocked-fg: var(--color-warning-strong); /* 待ち・保留（自分以外で止まっている） */
  --color-status-blocked-bg: var(--color-warning-bg);
  --color-status-blocked-bd: var(--color-warning-bd);
  --color-status-done-fg:    var(--color-success-strong); /* 完了（達成。彩度低めで後退） */
  --color-status-done-bg:    var(--color-success-bg);
  --color-status-done-bd:    var(--color-success-bd);
  --color-status-dropped-fg: var(--color-text-tertiary);  /* 中止・archived（最も後退） */
  --color-status-dropped-bg: var(--color-surface-subtle);
  --color-status-dropped-bd: var(--color-border-subtle);

  /* ---- Data visualization（カテゴリ系列。この順で使う） ---- */
  --color-chart-1:           #8A2F3B;
  --color-chart-2:           #2D7FB8;
  --color-chart-3:           #2E8B57;
  --color-chart-4:           #C77D29;
  --color-chart-5:           #6D5BC7;
  --color-chart-6:           #7C746E;

  /* ---- Focus ring（操作要素のフォーカス可視化。アクセント色の半透明） ---- */
  --focus-ring:              0 0 0 3px rgba(138, 47, 59, 0.32);

  /* ---- Radius（角丸: 控えめ。md=7px が既定） ---- */
  --radius-sm:               4px;
  --radius-md:               7px;  /* ボタン・入力欄・小カード */
  --radius-lg:               10px; /* 大きなパネル・モーダル */
  --radius-pill:             999px;

  /* ---- Spacing（4px基準・コンパクト） ---- */
  --space-1:                 4px;
  --space-2:                 8px;
  --space-3:                 12px;
  --space-4:                 16px;
  --space-5:                 20px;
  --space-6:                 24px;
  --space-8:                 32px;

  /* コンポーネント既定（コンパクト密度） */
  --pad-card:                14px;
  --pad-input:               8px 10px;
  --pad-button:              8px 14px;
  --gap-base:                10px;

  /* ---- Typography ---- */
  --font-base: "Nunito", "Hiragino Maru Gothic ProN", "Quicksand", "Segoe UI", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", "SFMono-Regular", ui-monospace, Consolas, monospace; /* 数値・コード・表の桁揃え */

  --text-xs:                 11px; /* キャプション・タグ */
  --text-sm:                 13px; /* 補足・表セル */
  --text-base:               14px; /* 本文 */
  --text-lg:                 16px; /* セクション見出し */
  --text-xl:                 20px; /* ページ見出し・指標数値 */
  --text-2xl:                24px; /* 大きな数値 */
  --text-3xl:                30px; /* ヒーロー数値（画面内で主役の指標を1つだけ際立たせる） */

  --lh-tight:                1.3;
  --lh-base:                 1.55;

  --weight-normal:           400;
  --weight-medium:           600; /* ボタン・ラベル */
  --weight-bold:             700; /* 見出し */

  /* ---- Elevation（影は控えめ・やわらかく） ---- */
  --shadow-sm:               0 1px 2px rgba(38, 32, 30, 0.06);
  --shadow-md:               0 2px 8px rgba(38, 32, 30, 0.08);
  --shadow-lg:               0 6px 20px rgba(38, 32, 30, 0.10);

  /* ---- Motion ---- */
  --duration-fast:           120ms;
  --duration-base:           180ms;
  --ease:                    cubic-bezier(0.2, 0, 0, 1);
}

/* ============ Dark mode ============ */
:root[data-theme="dark"] {
  --color-accent:            #BD4F5D; /* 暗背景で映えるよう明度を上げたローズ寄り */
  --color-accent-hover:      #CB6371;
  --color-accent-active:     #A53F4D;
  --color-accent-strong:     #E0929C; /* 暗背景上のリンク文字 */
  --color-accent-subtle-bg:  #2F1E21;
  --color-accent-subtle-bg-strong: #45272D;
  --color-accent-subtle-bd:  #5A3338;
  --color-on-accent:         #FFFFFF;

  --color-bg:                #191412;
  --color-surface:           #221B19;
  --color-surface-subtle:    #2B2220;
  --color-surface-muted:     #342927;

  --color-text:              #F1EAE7;
  --color-text-secondary:    #B7ABA6;
  --color-text-tertiary:     #8A7E79;

  --color-border-subtle:     #332927;
  --color-border:            #4A3236;
  --color-border-strong:     #5E3F43;

  --color-danger:            #E06A6A; --color-danger-strong: #E06A6A; --color-danger-bg: #2C1A1A; --color-danger-bd: #533030;
  --color-success:           #5BB98B; --color-success-strong:#5BB98B; --color-success-bg:#16271F; --color-success-bd:#2E4A3A;
  --color-warning:           #D89B4E; --color-warning-strong:#D89B4E; --color-warning-bg:#2A2114; --color-warning-bd:#4D3D22;
  --color-info:              #5FA3D6; --color-info-strong:   #5FA3D6; --color-info-bg:   #16242F; --color-info-bd:   #294454;

  /* Workflow status: review のみ独自値（他は意味固定色の別名参照で自動追従） */
  --color-status-review-fg:  #A99BEC; --color-status-review-bg: #211D33; --color-status-review-bd: #3E3760;

  --color-chart-1:           #D06A78;
  --color-chart-2:           #67A9D8;
  --color-chart-3:           #63BD91;
  --color-chart-4:           #DCA45D;
  --color-chart-5:           #9A8BE0;
  --color-chart-6:           #B7ABA6;

  --focus-ring:              0 0 0 3px rgba(189, 79, 93, 0.45);

  --shadow-sm:               0 1px 2px rgba(0, 0, 0, 0.35);
  --shadow-md:               0 2px 8px rgba(0, 0, 0, 0.45);
  --shadow-lg:               0 6px 20px rgba(0, 0, 0, 0.55);
}

/* OS設定にも自動追従（data-theme 未指定時） */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --color-accent: #BD4F5D; --color-accent-hover: #CB6371; --color-accent-active: #A53F4D;
    --color-accent-strong: #E0929C; --color-accent-subtle-bg: #2F1E21; --color-accent-subtle-bg-strong: #45272D; --color-accent-subtle-bd: #5A3338;
    --color-bg: #191412; --color-surface: #221B19; --color-surface-subtle: #2B2220; --color-surface-muted: #342927;
    --color-text: #F1EAE7; --color-text-secondary: #B7ABA6; --color-text-tertiary: #8A7E79;
    --color-border-subtle: #332927; --color-border: #4A3236; --color-border-strong: #5E3F43;
    --color-danger: #E06A6A; --color-danger-strong: #E06A6A; --color-danger-bg: #2C1A1A; --color-danger-bd: #533030;
    --color-success: #5BB98B; --color-success-strong: #5BB98B; --color-success-bg: #16271F; --color-success-bd: #2E4A3A;
    --color-warning: #D89B4E; --color-warning-strong: #D89B4E; --color-warning-bg: #2A2114; --color-warning-bd: #4D3D22;
    --color-info: #5FA3D6; --color-info-strong: #5FA3D6; --color-info-bg: #16242F; --color-info-bd: #294454;
    --color-status-review-fg: #A99BEC; --color-status-review-bg: #211D33; --color-status-review-bd: #3E3760;
    --color-chart-1: #D06A78; --color-chart-2: #67A9D8; --color-chart-3: #63BD91;
    --color-chart-4: #DCA45D; --color-chart-5: #9A8BE0; --color-chart-6: #B7ABA6;
    --focus-ring: 0 0 0 3px rgba(189, 79, 93, 0.45);
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.35); --shadow-md: 0 2px 8px rgba(0,0,0,0.45); --shadow-lg: 0 6px 20px rgba(0,0,0,0.55);
  }
}

/* ============ Base reset / element defaults ============ */
body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-base);
  font-size: var(--text-base);
  line-height: var(--lh-base);
  font-weight: var(--weight-normal);
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3 { font-weight: var(--weight-bold); line-height: var(--lh-tight); margin: 0; }
h1 { font-size: var(--text-2xl); }
h2 { font-size: var(--text-xl); }
h3 { font-size: var(--text-lg); }

/* 数値の桁を揃える（実験結果・指標・表で読みやすく） */
.num, td.num, .metric-value { font-variant-numeric: tabular-nums; }

``

### $relative

``json
{
  "$meta": {
    "name": "私の標準 (my-standard)",
    "direction": "親しみ柔らかめ / burgundy",
    "summary": "温かみのあるバーガンディを操作色に、角丸控えめ(7px)・コンパクト密度・丸ゴシックで、情報を効率よく読ませる個人向けUI標準。",
    "version": "1.1.0"
  },
  "color": {
    "light": {
      "accent":           "#8A2F3B",
      "accentHover":      "#73262F",
      "accentActive":     "#5E1F28",
      "accentStrong":     "#5E1F28",
      "accentSubtleBg":   "#FBF3F4",
      "accentSubtleBd":   "#E6BCC1",
      "onAccent":         "#FFFFFF",
      "bg":               "#F4EEEC",
      "surface":          "#FFFFFF",
      "surfaceSubtle":    "#F9F4F4",
      "surfaceMuted":     "#EFE7E5",
      "text":             "#26201E",
      "textSecondary":    "#7C746E",
      "textTertiary":     "#A89F99",
      "borderSubtle":     "#ECE0DE",
      "border":           "#DCC1C4",
      "borderStrong":     "#C9A6AA",
      "danger":           "#CE3B3B",
      "dangerStrong":     "#A12626",
      "dangerBg":         "#FBEAEA",
      "dangerBd":         "#F0C7C7",
      "success":          "#2E8B57",
      "successStrong":    "#1C5E3A",
      "successBg":        "#E8F3EC",
      "successBd":        "#C5E3D1",
      "warning":          "#C77D29",
      "warningStrong":    "#8A5212",
      "warningBg":        "#FBF0DD",
      "warningBd":        "#EFD9B0",
      "info":             "#2D7FB8",
      "infoStrong":       "#1C557D",
      "infoBg":           "#E8F1F8",
      "infoBd":           "#C3DCEE"
    },
    "dark": {
      "accent":           "#BD4F5D",
      "accentHover":      "#CB6371",
      "accentActive":     "#A53F4D",
      "accentStrong":     "#E0929C",
      "accentSubtleBg":   "#2F1E21",
      "accentSubtleBd":   "#5A3338",
      "onAccent":         "#FFFFFF",
      "bg":               "#191412",
      "surface":          "#221B19",
      "surfaceSubtle":    "#2B2220",
      "surfaceMuted":     "#342927",
      "text":             "#F1EAE7",
      "textSecondary":    "#B7ABA6",
      "textTertiary":     "#8A7E79",
      "borderSubtle":     "#332927",
      "border":           "#4A3236",
      "borderStrong":     "#5E3F43",
      "danger":           "#E06A6A",
      "dangerStrong":     "#E06A6A",
      "dangerBg":         "#2C1A1A",
      "dangerBd":         "#533030",
      "success":          "#5BB98B",
      "successStrong":    "#5BB98B",
      "successBg":        "#16271F",
      "successBd":        "#2E4A3A",
      "warning":          "#D89B4E",
      "warningStrong":    "#D89B4E",
      "warningBg":        "#2A2114",
      "warningBd":        "#4D3D22",
      "info":             "#5FA3D6",
      "infoStrong":       "#5FA3D6",
      "infoBg":           "#16242F",
      "infoBd":           "#294454"
    }
  },
  "chart": {
    "light": [
      "#8A2F3B",
      "#2D7FB8",
      "#2E8B57",
      "#C77D29",
      "#6D5BC7",
      "#7C746E"
    ],
    "dark": [
      "#D06A78",
      "#67A9D8",
      "#63BD91",
      "#DCA45D",
      "#9A8BE0",
      "#B7ABA6"
    ],
    "usage": "カテゴリ系列は配列順に使い、色だけでなく線種・マーカー・直接ラベルを併用する"
  },
  "radius": {
    "sm":   "4px",
    "md":   "7px",
    "lg":   "10px",
    "pill": "999px"
  },
  "space": {
    "1": "4px",
    "2": "8px",
    "3": "12px",
    "4": "16px",
    "5": "20px",
    "6": "24px",
    "8": "32px"
  },
  "component": {
    "density":     "compact",
    "padCard":     "14px",
    "padInput":    "8px 10px",
    "padButton":   "8px 14px",
    "gapBase":     "10px"
  },
  "typography": {
    "fontBase": "\"Nunito\", \"Hiragino Maru Gothic ProN\", \"Quicksand\", \"Segoe UI\", system-ui, sans-serif",
    "fontMono": "\"JetBrains Mono\", \"SFMono-Regular\", ui-monospace, Consolas, monospace",
    "size": {
      "xs":   "11px",
      "sm":   "13px",
      "base": "14px",
      "lg":   "16px",
      "xl":   "20px",
      "2xl":  "24px"
    },
    "lineHeight": {
      "tight": 1.3,
      "base":  1.55
    },
    "weight": {
      "normal": 400,
      "medium": 600,
      "bold":   700
    },
    "numeric": "font-variant-numeric: tabular-nums (表・指標・実験結果の数値で桁を揃える)"
  },
  "focusRing": {
    "light": "0 0 0 3px rgba(138, 47, 59, 0.32)",
    "dark":  "0 0 0 3px rgba(189, 79, 93, 0.45)"
  },
  "shadow": {
    "light": {
      "sm": "0 1px 2px rgba(38, 32, 30, 0.06)",
      "md": "0 2px 8px rgba(38, 32, 30, 0.08)",
      "lg": "0 6px 20px rgba(38, 32, 30, 0.10)"
    },
    "dark": {
      "sm": "0 1px 2px rgba(0, 0, 0, 0.35)",
      "md": "0 2px 8px rgba(0, 0, 0, 0.45)",
      "lg": "0 6px 20px rgba(0, 0, 0, 0.55)"
    }
  },
  "motion": {
    "durationFast": "120ms",
    "durationBase": "180ms",
    "ease": "cubic-bezier(0.2, 0, 0, 1)"
  }
}

``

### $relative

``
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { app } from "electron";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import { createSnapshot, readSnapshot } from "../src/main/services/snapshotService.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "research-desk-model-test-"));

try {
  const db = new WorkspaceDatabase(path.join(dir, "test.sqlite"));
  db.setPreference("themeMode", "dark");
  const theme = db.save("theme", { id: "theme-1", name: "Test" });
  const item = db.save("item", {
    id: "item-1",
    title: "Plan",
    theme_id: theme.id,
    status: "todo",
    progress: 10,
    planned_start: "2026-06-01",
    planned_end: "2026-06-10",
  });
  const statusUpdate = db.save("status_update", {
    id: "status-1",
    theme_id: theme.id,
    summary: "On track",
    date: "2026-06-01",
  });
  const child = db.save("item", {
    id: "item-child",
    title: "Child",
    theme_id: theme.id,
    parent_item_id: item.id,
    status: "todo",
    progress: 0,
  });
  const dependency = db.save("dependency", {
    id: "dependency-1",
    source_item_id: item.id,
    target_item_id: child.id,
  });
  const note = db.save("note", {
    id: "note-1",
    title: "Observation",
    body_markdown: "A rough note",
    theme_id: theme.id,
  });
  const claim = db.save("knowledge_node", {
    id: "knowledge-claim",
    node_type: "claim",
    title: "Claim",
    body: "Structured from a note",
    theme_id: theme.id,
    source_note_id: note.id,
    confidence: "medium",
    status: "active",
  });
  const evidence = db.save("knowledge_node", {
    id: "knowledge-evidence",
    node_type: "evidence",
    title: "Evidence",
    theme_id: theme.id,
    confidence: "high",
    status: "active",
  });
  const knowledgeRelation = db.save("knowledge_relation", {
    id: "knowledge-relation-1",
    source_node_id: claim.id,
    target_node_id: evidence.id,
    relation_type: "supports",
  });
  db.save("item", { ...item, planned_end: "2026-06-12", progress: 20 }, { reason: "test revision" });
  db.remove("theme", theme.id);
  const detachedTheme = db.get("item", item.id)?.theme_id === null;
  const cascadedStatus = Boolean(db.get("status_update", statusUpdate.id, true)?.deleted_at);
  db.restore("theme", theme.id);
  const restoredThemeReference = db.get("item", item.id)?.theme_id === theme.id;
  const restoredStatus = !db.get("status_update", statusUpdate.id, true)?.deleted_at;

  db.remove("item", item.id);
  const detachedParent = db.get("item", child.id)?.parent_item_id === null;
  const cascadedDependency = Boolean(db.get("dependency", dependency.id, true)?.deleted_at);
  db.restore("item", item.id);
  const restoredParent = db.get("item", child.id)?.parent_item_id === item.id;
  const restoredDependency = !db.get("dependency", dependency.id, true)?.deleted_at;
  db.remove("knowledge_node", evidence.id);
  const cascadedKnowledgeRelation = Boolean(db.get("knowledge_relation", knowledgeRelation.id, true)?.deleted_at);
  db.restore("knowledge_node", evidence.id);
  const restoredKnowledgeRelation = !db.get("knowledge_relation", knowledgeRelation.id, true)?.deleted_at;
  const deletedTheme = db.save("theme", { id: "theme-deleted", name: "Deleted" });
  db.remove("theme", deletedTheme.id);

  let rejected = false;
  try {
    db.save("item", { title: "", progress: 120 });
  } catch {
    rejected = true;
  }
  let rejectedReference = false;
  try {
    db.save("note", {
      id: "bad-reference",
      title: "Bad reference",
      body_markdown: "Body",
      item_id: "missing-item",
    });
  } catch {
    rejectedReference = true;
  }

  let rolledBack = false;
  try {
    db.saveMany([
      {
        action: "save",
        type: "note",
        entity: { id: "note-ok", title: "Valid", body_markdown: "Body" },
      },
      {
        action: "save",
        type: "link",
        entity: { id: "link-bad", title: "Missing URL", url: "" },
      },
    ]);
  } catch {
    rolledBack = db.get("note", "note-ok", true) === null;
  }

  const zipPath = path.join(dir, "snapshot.zip");
  createSnapshot(db.loadWorkspace(true)).writeZip(zipPath);
  const parsed = readSnapshot(zipPath);
  const tombstone = parsed.workspace.themes.find((entry) => entry.id === deletedTheme.id)?.deleted_at;

  const imported = new WorkspaceDatabase(path.join(dir, "imported.sqlite"));
  const decisions = Object.fromEntries(
    imported.previewSnapshot(parsed.workspace).map((change) => [change.key, change.action]),
  );
  imported.applySnapshot(parsed.workspace, decisions, parsed.workspace.plan_revisions);

  const result = {
    rejected,
    rejectedReference,
    rolledBack,
    detachedTheme,
    cascadedStatus,
    restoredThemeReference,
    restoredStatus,
    detachedParent,
    cascadedDependency,
    restoredParent,
    restoredDependency,
    cascadedKnowledgeRelation,
    restoredKnowledgeRelation,
    tombstone: Boolean(tombstone),
    exportedRevisions: parsed.workspace.plan_revisions.length,
    importedRevisions: imported.loadWorkspace(true).plan_revisions.length,
    persistedPreference: db.getPreference("themeMode") === "dark",
    schemaVersion: db.getMeta().schemaVersion,
  };
  const passed = Object.entries(result).every(([key, value]) =>
    key === "schemaVersion" ? value === 1 : key.includes("Revisions") ? value === 1 : value === true);
  console.log(JSON.stringify(result));
  app.exit(passed ? 0 : 1);
} catch (error) {
  console.error(error);
  app.exit(1);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

``

### $relative

``typescript
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { registerIpc } from "./ipc/registerIpc";
import { WorkspaceDatabase } from "./repositories/workspaceRepository.mjs";
import { WorkspaceService } from "./services/workspaceService";

const isSmokeTest = process.argv.includes("--smoke-test");
const userDataArgument = process.argv.find((argument) => argument.startsWith("--user-data-dir="));
const requestedUserDataPath = userDataArgument?.slice("--user-data-dir=".length);
const smokeResultPath = path.join(os.tmpdir(), "research-desk-smoke-result.json");
const APP_NAME = "Tasken";
let workspaceRepository: InstanceType<typeof WorkspaceDatabase>;
let tray: Tray | null = null;
let captureWindow: BrowserWindow | null = null;

function openAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (!["https:", "http:", "mailto:"].includes(parsed.protocol)) return false;
    void shell.openExternal(parsed.toString());
    return true;
  } catch {
    return false;
  }
}

function getAppIconPath(): string {
  return path.join(__dirname, "../../resources/icon.ico");
}

function migrateLegacyUserDataIfNeeded(): void {
  const currentDbPath = path.join(app.getPath("userData"), "research-desk.sqlite");
  if (fs.existsSync(currentDbPath)) return;

  const legacyDbPath = path.join(app.getPath("appData"), "Research Desk", "research-desk.sqlite");
  if (!fs.existsSync(legacyDbPath)) return;

  fs.mkdirSync(path.dirname(currentDbPath), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    const legacyPath = `${legacyDbPath}${suffix}`;
    if (fs.existsSync(legacyPath)) {
      fs.copyFileSync(legacyPath, `${currentDbPath}${suffix}`);
    }
  }
}

function getCapturePreloadPath(): string {
  return path.join(__dirname, "../preload/capture.mjs");
}

function createCaptureWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 180,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: false,
    backgroundColor: "#F4EEEC",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // TODO: sandbox:true breaks the ESM preload bridge in the current smoke path.
      // Revisit when preload output/runtime is adjusted and window.captureApi can be verified.
      sandbox: false,
      preload: getCapturePreloadPath(),
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/capture.html`);
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/capture.html"));
  }

  win.on("blur", () => {
    if (win.isVisible()) win.hide();
  });

  return win;
}

function showCaptureWindow(): void {
  if (!captureWindow || captureWindow.isDestroyed()) {
    captureWindow = createCaptureWindow();
  }

  const themeMode = workspaceRepository?.getPreference("themeMode") ?? "light";
  captureWindow.webContents.send("quick-capture:theme", themeMode);

  captureWindow.center();
  captureWindow.show();
  captureWindow.focus();
  captureWindow.webContents.send("quick-capture:shown");
}

function createTrayIcon(): Electron.NativeImage {
  const icon = nativeImage.createFromPath(getAppIconPath());
  if (!icon.isEmpty()) return icon.resize({ width: 16, height: 16 });

  // 16x16 RGBA: burgundy "RD" マーク
  const size = 16;
  const buf = Buffer.alloc(size * size * 4, 0);
  const accent = [138, 47, 59, 255]; // #8A2F3B
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inOuter = x >= 1 && x < 15 && y >= 1 && y < 15;
      const inInner = x >= 3 && x < 13 && y >= 3 && y < 13;
      if (inOuter && !inInner) {
        buf[i] = accent[0]; buf[i + 1] = accent[1]; buf[i + 2] = accent[2]; buf[i + 3] = accent[3];
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

function setupTray(): void {
  tray = new Tray(createTrayIcon());

  const contextMenu = Menu.buildFromTemplate([
    { label: "クイック記録", accelerator: "CmdOrCtrl+Shift+N", click: showCaptureWindow },
    { type: "separator" },
    { label: `${APP_NAME} を開く`, click: () => {
      const windows = BrowserWindow.getAllWindows().filter((w) => w !== captureWindow);
      if (windows.length) { windows[0].show(); windows[0].focus(); } else { createWindow(); }
    }},
    { type: "separator" },
    { label: "終了", click: () => app.quit() },
  ]);

  tray.setToolTip(APP_NAME);
  tray.setContextMenu(contextMenu);
  tray.on("click", showCaptureWindow);
}

function notifyMainWindowRefresh(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win !== captureWindow && !win.isDestroyed()) {
      win.webContents.send("workspace:changed");
    }
  }
}

function registerCaptureIpc(): void {
  ipcMain.handle("quick-capture:save", (_event, text: string) => {
    const trimmed = (text || "").trim();
    if (!trimmed) throw new Error("入力が空です。");
    const saved = workspaceRepository.save("item", {
      title: trimmed,
      kind: "idea",
      level: "task",
      status: "inbox",
      priority: "normal",
    }, { source: "quick-capture" });
    notifyMainWindowRefresh();
    return saved;
  });

  ipcMain.on("quick-capture:hide", () => {
    if (captureWindow && !captureWindow.isDestroyed()) captureWindow.hide();
  });
}

interface SmokeCreatedResult {
  title: string;
  rootReady: boolean;
  saved: boolean;
  themeMode: string;
  clipboardWritten: boolean;
}

interface SmokeReloadResult {
  persisted: boolean;
  themeMode: string;
}

function recordSmoke(stage: string, details: Record<string, unknown> = {}): void {
  if (!isSmokeTest) return;
  fs.writeFileSync(smokeResultPath, JSON.stringify({ stage, argv: process.argv, ...details }, null, 2));
}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("in-process-gpu");

if (requestedUserDataPath) {
  app.setPath("userData", path.resolve(requestedUserDataPath));
} else if (isSmokeTest) {
  app.setPath("userData", path.join(app.getPath("temp"), "research-desk-smoke-test"));
  recordSmoke("main-started");
  setTimeout(() => {
    recordSmoke("timeout");
    app.exit(1);
  }, 15000);
}

async function runSmokeTest(window: BrowserWindow): Promise<void> {
  recordSmoke("renderer-loaded");
  const testTitle = `デスクトップ動作確認 ${Date.now()}`;
  const created = await window.webContents.executeJavaScript(`
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitForButton = async (label) => {
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const target = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === label);
          if (target) return target;
          await delay(100);
        }
        throw new Error(label + " ボタンが見つかりません。画面: " + document.body.innerText.slice(0, 1000));
      };

      (await waitForButton("Notes")).click();
      await delay(60);
      (await waitForButton("メモを書く")).click();
      await delay(60);

      const title = document.querySelector('input[name="title"]');
      const body = document.querySelector('textarea[name="body_markdown"]');
      const form = document.querySelector(".drawer-form");
      if (!title || !body || !form) throw new Error("メモ入力フォームが見つかりません");

      title.value = ${JSON.stringify(testTitle)};
      body.value = "Electron内で入力と保存を確認しました。";
      form.requestSubmit();
      await delay(120);
      await window.api.preferences.set("themeMode", "dark");
      const themeMode = await window.api.preferences.get("themeMode");
      const clipboardWritten = await window.api.clipboard.writeText("Tasken smoke test");

      return {
        title: document.title,
        rootReady: Boolean(document.querySelector("#root > *")),
        saved: [...document.querySelectorAll("button")].some((button) => button.textContent.includes(${JSON.stringify(testTitle)})),
        themeMode,
        clipboardWritten,
      };
    })()
  `) as SmokeCreatedResult;

  window.webContents.once("did-finish-load", async () => {
    try {
      const afterReload = await window.webContents.executeJavaScript(`
        Promise.all([
          window.api.entities.list("note"),
          window.api.preferences.get("themeMode"),
        ]).then(([notes, themeMode]) => ({
          persisted: notes.some((note) => note.title === ${JSON.stringify(testTitle)}),
          themeMode,
        }))
      `) as SmokeReloadResult;
      const result = {
        ...created,
        persistedAfterReload: afterReload.persisted,
        themeModeAfterReload: afterReload.themeMode,
      };
      console.log(JSON.stringify(result));
      recordSmoke("passed", result);
      app.exit(
        result.persistedAfterReload
        && result.saved
        && result.rootReady
        && result.clipboardWritten
        && result.themeMode === "dark"
        && result.themeModeAfterReload === "dark"
          ? 0
          : 1,
      );
    } catch (error) {
      console.error(error);
      recordSmoke("reload-check-failed", { error: String(error) });
      app.exit(1);
    }
  });
  window.reload();
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 980,
    minHeight: 680,
    show: !isSmokeTest,
    backgroundColor: "#F4EEEC",
    title: APP_NAME,
    icon: getAppIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // TODO: sandbox:true currently prevents window.api/window.researchDesk from being exposed.
      // Keep the verified contextIsolation/nodeIntegration boundary until the preload bridge is migrated.
      sandbox: false,
      preload: path.join(__dirname, "../preload/index.mjs"),
    },
  });

  if (!isSmokeTest) window.once("ready-to-show", () => window.show());
  window.webContents.once("did-finish-load", () => {
    if (isSmokeTest) {
      runSmokeTest(window).catch((error: unknown) => {
        console.error(error);
        app.exit(1);
      });
    }
  });
  window.webContents.on("did-fail-load", (_event, code, description) => {
    recordSmoke("load-failed", { code, description });
    if (isSmokeTest) app.exit(1);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    recordSmoke("renderer-gone", { ...details });
    if (isSmokeTest) app.exit(1);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!openAllowedExternalUrl(url)) {
      console.warn(`Blocked external URL: ${url}`);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
      if (!openAllowedExternalUrl(url)) {
        console.warn(`Blocked navigation URL: ${url}`);
      }
    }
  });
}

void app.whenReady().then(() => {
  migrateLegacyUserDataIfNeeded();
  workspaceRepository = new WorkspaceDatabase(path.join(app.getPath("userData"), "research-desk.sqlite"));
  registerIpc(workspaceRepository, new WorkspaceService(workspaceRepository));
  registerCaptureIpc();
  recordSmoke("app-ready");
  createWindow();

  if (!isSmokeTest) {
    setupTray();
    globalShortcut.register("CmdOrCtrl+Shift+N", showCaptureWindow);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // トレイ常駐中はメインウィンドウを閉じてもアプリを終了しない
  if (process.platform === "darwin") return;
  if (tray && !tray.isDestroyed()) return;
  app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

``

### $relative

``typescript
import { ipcMain } from "electron";

import { IPC } from "../../shared/ipc/contracts";
import { entityTypes, type EntityType } from "../../shared/types/workspace";
import type { WorkspaceService } from "../services/workspaceService";

interface WorkspaceRepository {
  loadWorkspace(includeDeleted?: boolean): unknown;
  bootstrap(legacy: unknown): unknown;
  getMeta(): unknown;
  getPreference(key: string): unknown;
  setPreference(key: string, value: unknown): unknown;
  list(type: EntityType, includeDeleted?: boolean): unknown;
  get(type: EntityType, id: string): unknown;
  save(type: EntityType, entity: unknown, options?: unknown): unknown;
  saveMany(operations: unknown): unknown;
  remove(type: EntityType, id: string): unknown;
  restore(type: EntityType, id: string): unknown;
}

function requireEntityType(value: unknown): EntityType {
  if (typeof value !== "string" || !entityTypes.includes(value as EntityType)) {
    throw new Error("保存対象の種類が不正です。画面を再読み込みして、もう一度試してください。");
  }
  return value as EntityType;
}

function requireId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("対象IDがありません。画面を再読み込みして、もう一度試してください。");
  }
  return value;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label}の形式が不正です。画面を再読み込みして、もう一度試してください。`);
  }
  return value;
}

export function registerIpc(repository: WorkspaceRepository, service: WorkspaceService): void {
  ipcMain.handle(IPC.workspaceLoad, () => repository.loadWorkspace());
  ipcMain.handle(IPC.workspaceBootstrap, (_event, legacy) => repository.bootstrap(legacy));
  ipcMain.handle(IPC.workspaceMeta, () => repository.getMeta());
  ipcMain.handle(IPC.preferenceGet, (_event, key) => repository.getPreference(requireId(key)));
  ipcMain.handle(IPC.preferenceSet, (_event, key, value) => repository.setPreference(requireId(key), value));
  ipcMain.handle(IPC.clipboardWriteText, (_event, text) => service.writeClipboard(requireText(text, "コピーするテキスト")));
  ipcMain.handle(IPC.appReload, (event) => service.reload(event.sender));
  ipcMain.handle(IPC.entityList, (_event, type, includeDeleted) =>
    repository.list(requireEntityType(type), Boolean(includeDeleted)));
  ipcMain.handle(IPC.entityGet, (_event, type, id) =>
    repository.get(requireEntityType(type), requireId(id)));
  ipcMain.handle(IPC.entitySave, (_event, type, entity, options) => {
    if (!entity || typeof entity !== "object" || Array.isArray(entity)) {
      throw new Error("保存内容が不正です。入力内容を確認してください。");
    }
    return repository.save(requireEntityType(type), entity, options);
  });
  ipcMain.handle(IPC.entitySaveMany, (_event, operations) => {
    if (!Array.isArray(operations)) throw new Error("一括保存の内容が不正です。入力内容を確認してください。");
    return repository.saveMany(operations);
  });
  ipcMain.handle(IPC.entityRemove, (_event, type, id) =>
    repository.remove(requireEntityType(type), requireId(id)));
  ipcMain.handle(IPC.entityRestore, (_event, type, id) =>
    repository.restore(requireEntityType(type), requireId(id)));
  ipcMain.handle(IPC.snapshotExport, () => service.exportSnapshot());
  ipcMain.handle(IPC.snapshotInspect, () => service.inspectSnapshot());
  ipcMain.handle(IPC.snapshotApply, (_event, token, decisions) =>
    service.applySnapshot(requireId(token), decisions && typeof decisions === "object" && !Array.isArray(decisions) ? (decisions as Record<string, string>) : {}));
}

``

### $relative

``
export const workspaceEntityTypes = [
  "theme",
  "item",
  "note",
  "link",
  "dependency",
  "view",
  "status_update",
  "source_record",
  "entity_source",
  "relation",
  "field_definition",
  "field_value",
  "log_entry",
  "import_batch",
  "knowledge_node",
  "knowledge_relation",
  "ai_proposal",
];

const requiredTextFields = {
  theme: ["name"],
  item: ["title"],
  note: ["title", "body_markdown"],
  link: ["title", "url"],
  status_update: ["theme_id", "summary"],
  source_record: ["source_title"],
  field_definition: ["name", "field_type", "applies_to"],
  dependency: ["source_item_id", "target_item_id"],
  relation: ["source_entity_type", "source_entity_id", "target_entity_type", "target_entity_id", "relation_type"],
  field_value: ["field_definition_id", "entity_type", "entity_id"],
  knowledge_node: ["node_type", "title"],
  knowledge_relation: ["source_node_id", "target_node_id", "relation_type"],
  ai_proposal: ["source", "payload_type", "status"],
};

const isoDateFields = [
  "baseline_start",
  "baseline_end",
  "planned_start",
  "planned_end",
  "actual_start",
  "actual_end",
  "due_date",
  "date",
  "value_date",
];

const urlFields = ["url", "source_url"];
const allowedUrlProtocols = new Set(["https:", "http:", "mailto:"]);
const knowledgeNodeTypes = new Set(["source", "evidence", "claim", "question", "decision", "insight"]);
const knowledgeRelationTypes = new Set([
  "supports",
  "contradicts",
  "explains",
  "causes",
  "example_of",
  "generalizes",
  "depends_on",
  "derived_from",
  "answers",
  "raises",
  "similar_to",
  "leads_to",
]);
const knowledgeDirectionalRelationTypes = new Set(["depends_on", "causes", "leads_to"]);
const confidenceValues = new Set(["low", "medium", "high"]);
const knowledgeStatusValues = new Set(["active", "resolved", "deprecated", "rejected"]);
const proposalSources = new Set(["mcp", "ai_import", "manual"]);
const proposalPayloadTypes = new Set(["items", "notes", "links", "knowledge_nodes", "status_update"]);
const proposalStatuses = new Set(["pending", "accepted", "rejected", "partially_accepted"]);

function localDateIso(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function isAllowedExternalUrl(value) {
  try {
    return allowedUrlProtocols.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

function hasPath(edges, fromId, toId) {
  const graph = new Map();
  for (const [sourceId, targetId] of edges) {
    if (!sourceId || !targetId) continue;
    const targets = graph.get(sourceId) || [];
    targets.push(targetId);
    graph.set(sourceId, targets);
  }
  const stack = [fromId];
  const seen = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    if (current === toId) return true;
    seen.add(current);
    stack.push(...(graph.get(current) || []));
  }
  return false;
}

export function assertItemParentAcyclic(items, entity, message = "親Itemに自分自身または子孫を指定すると循環します。別の親Itemを選んでください。") {
  if (!entity.parent_item_id) return;
  const entityId = String(entity.id);
  const byId = new Map(items.filter((item) => !item.deleted_at).map((item) => [String(item.id), item]));
  byId.set(entityId, entity);

  const seen = new Set([entityId]);
  let currentId = String(entity.parent_item_id);
  while (currentId) {
    if (seen.has(currentId)) throw new Error(message);
    seen.add(currentId);
    currentId = String(byId.get(currentId)?.parent_item_id || "");
  }
}

export function assertDependencyAcyclic(dependencies, entity, message = "Dependencyが循環します。先行Itemと後続Itemの向きを見直してください。") {
  if (!entity.source_item_id || !entity.target_item_id) return;
  const sourceId = String(entity.source_item_id);
  const targetId = String(entity.target_item_id);
  const edges = dependencies
    .filter((dependency) => !dependency.deleted_at && String(dependency.id) !== String(entity.id))
    .map((dependency) => [String(dependency.source_item_id), String(dependency.target_item_id)]);
  edges.push([sourceId, targetId]);

  if (hasPath(edges, targetId, sourceId)) throw new Error(message);
}

export function assertKnowledgeRelationAcyclic(relations, entity, message = "Knowledge Relationが循環します。関係の向きを見直してください。") {
  if (!knowledgeDirectionalRelationTypes.has(entity.relation_type)) return;
  if (!entity.source_node_id || !entity.target_node_id) return;
  const sourceId = String(entity.source_node_id);
  const targetId = String(entity.target_node_id);
  const edges = relations
    .filter((relation) =>
      !relation.deleted_at
      && String(relation.id) !== String(entity.id)
      && knowledgeDirectionalRelationTypes.has(relation.relation_type))
    .map((relation) => [String(relation.source_node_id), String(relation.target_node_id)]);
  edges.push([sourceId, targetId]);

  if (hasPath(edges, targetId, sourceId)) throw new Error(message);
}

export function assertEntityType(type) {
  if (!workspaceEntityTypes.includes(type)) {
    throw new Error(`未対応のデータ種別です: ${type}`);
  }
}

export function validateEntity(type, input) {
  assertEntityType(type);
  if (!isPlainObject(input)) throw new Error(`${type}の保存内容が不正です。`);

  for (const field of requiredTextFields[type] || []) {
    if (typeof input[field] !== "string" || !input[field].trim()) {
      throw new Error(`${type}.${field}を入力してください。`);
    }
  }

  for (const field of isoDateFields) {
    if (input[field] != null && input[field] !== "" && !isIsoDate(input[field])) {
      throw new Error(`${type}.${field}はYYYY-MM-DD形式で指定してください。`);
    }
  }

  for (const field of urlFields) {
    if (input[field] != null && input[field] !== "" && !isAllowedExternalUrl(input[field])) {
      throw new Error(`${type}.${field}はhttps、http、mailtoのURLを指定してください。fileや未知の形式は開けません。`);
    }
  }

  if (type === "item") {
    const progress = Number(input.progress ?? 0);
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
      throw new Error("item.progressは0から100で指定してください。");
    }
    if (input.planned_start && input.planned_end && input.planned_end < input.planned_start) {
      throw new Error("item.planned_endはplanned_start以降にしてください。");
    }
    if (input.id && input.parent_item_id && String(input.id) === String(input.parent_item_id)) {
      throw new Error("Item自身を親Itemにはできません。");
    }
  }

  if (type === "dependency" && input.source_item_id === input.target_item_id) {
    throw new Error("Dependencyの先行Itemと後続Itemは別にしてください。");
  }

  if (type === "relation"
    && input.source_entity_type === input.target_entity_type
    && input.source_entity_id === input.target_entity_id) {
    throw new Error("Entity自身へのRelationは作成できません。");
  }

  if (type === "knowledge_node") {
    if (!knowledgeNodeTypes.has(input.node_type)) throw new Error("knowledge_node.node_typeが不正です。");
    if (input.confidence != null && input.confidence !== "" && !confidenceValues.has(input.confidence)) {
      throw new Error("knowledge_node.confidenceが不正です。");
    }
    if (input.status != null && input.status !== "" && !knowledgeStatusValues.has(input.status)) {
      throw new Error("knowledge_node.statusが不正です。");
    }
    if (String(input.title || "").length > 200) throw new Error("knowledge_node.titleは200文字以内で入力してください。");
    if (String(input.body || "").length > 20000) throw new Error("knowledge_node.bodyは20000文字以内で入力してください。");
  }

  if (type === "knowledge_relation") {
    if (!knowledgeRelationTypes.has(input.relation_type)) throw new Error("knowledge_relation.relation_typeが不正です。");
    if (input.source_node_id === input.target_node_id) throw new Error("Knowledge Relationで自分自身は参照できません。");
    if (input.confidence != null && input.confidence !== "" && !confidenceValues.has(input.confidence)) {
      throw new Error("knowledge_relation.confidenceが不正です。");
    }
  }

  if (type === "ai_proposal") {
    if (!proposalSources.has(input.source)) throw new Error("ai_proposal.sourceが不正です。");
    if (!proposalPayloadTypes.has(input.payload_type)) throw new Error("ai_proposal.payload_typeが不正です。");
    if (!proposalStatuses.has(input.status)) throw new Error("ai_proposal.statusが不正です。");
    if (input.payload == null) throw new Error("ai_proposal.payloadを入力してください。");
  }

  return input;
}

export function normalizeEntity(type, input) {
  const normalized = { ...input };
  for (const field of requiredTextFields[type] || []) {
    if (typeof normalized[field] === "string") normalized[field] = normalized[field].trim();
  }
  if (type === "item") {
    normalized.schedule_status = normalized.planned_start || normalized.planned_end ? "scheduled" : "unscheduled";
    normalized.progress = Math.max(0, Math.min(100, Number(normalized.progress ?? 0)));
    if (normalized.status === "done") {
      normalized.progress = 100;
      normalized.completed_at ||= new Date().toISOString();
      normalized.actual_end ||= localDateIso();
    } else if (normalized.completed_at) {
      normalized.completed_at = null;
    }
  }
  if (type === "knowledge_node") {
    normalized.status ||= "active";
    normalized.confidence ||= "medium";
  }
  if (type === "knowledge_relation") normalized.confidence ||= "medium";
  if (type === "ai_proposal") normalized.status ||= "pending";
  validateEntity(type, normalized);
  return normalized;
}

``

### $relative

``
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  assertDependencyAcyclic,
  assertEntityType,
  assertItemParentAcyclic,
  assertKnowledgeRelationAcyclic,
  normalizeEntity,
  validateEntity,
  workspaceEntityTypes,
} from "./domain.mjs";

const SCHEMA_VERSION = 1;

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

function parseRow(row) {
  if (!row) return null;
  return {
    ...JSON.parse(row.data_json),
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    device_id: row.device_id,
    source: row.source,
    version: row.version,
  };
}

function contentOf(entity) {
  const {
    id,
    created_at,
    updated_at,
    deleted_at,
    device_id,
    source,
    version,
    ...data
  } = entity;
  return data;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectionKey(type) {
  return `${type}s`;
}

export class WorkspaceDatabase {
  constructor(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
    this.deviceId = this.ensureMeta("device_id", uuid());
    this.workspaceId = this.ensureMeta("workspace_id", uuid());
    this.ensureMeta("theme_mode", "light");
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    const current = Number(
      this.db.prepare("SELECT value FROM workspace_meta WHERE key = 'schema_version'").get()?.value || 0,
    );
    if (current > SCHEMA_VERSION) {
      throw new Error(`DB schema version ${current}は、このアプリでは読み込めません。`);
    }
    const migrations = [
      {
        version: 1,
        up: () => this.db.exec(`
          CREATE TABLE IF NOT EXISTS entities (
            entity_type TEXT NOT NULL,
            id TEXT NOT NULL,
            data_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            device_id TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'manual',
            version INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (entity_type, id)
          );

          CREATE INDEX IF NOT EXISTS idx_entities_type_updated
            ON entities(entity_type, updated_at);
          CREATE INDEX IF NOT EXISTS idx_entities_deleted
            ON entities(entity_type, deleted_at);

          CREATE TABLE IF NOT EXISTS plan_revisions (
            id TEXT PRIMARY KEY,
            item_id TEXT NOT NULL,
            changed_at TEXT NOT NULL,
            changed_by_device_id TEXT NOT NULL,
            old_json TEXT NOT NULL,
            new_json TEXT NOT NULL,
            reason TEXT,
            related_note_id TEXT,
            created_at TEXT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_plan_revisions_item
            ON plan_revisions(item_id, changed_at DESC);
        `),
      },
    ];
    const applyMigrations = this.db.transaction(() => {
      for (const migration of migrations) {
        if (migration.version <= current) continue;
        migration.up();
        this.db.prepare(`
          INSERT INTO workspace_meta(key, value) VALUES('schema_version', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(String(migration.version));
      }
    });
    applyMigrations();
  }

  ensureMeta(key, fallback) {
    const existing = this.db.prepare("SELECT value FROM workspace_meta WHERE key = ?").get(key);
    if (existing) return existing.value;
    this.db.prepare("INSERT INTO workspace_meta(key, value) VALUES(?, ?)").run(key, fallback);
    return fallback;
  }

  getMeta() {
    return {
      schemaVersion: SCHEMA_VERSION,
      workspaceId: this.workspaceId,
      deviceId: this.deviceId,
      themeMode: this.getPreference("themeMode"),
      activeGroup: this.getPreference("activeGroup"),
      entityCount: this.db.prepare("SELECT COUNT(*) AS count FROM entities WHERE deleted_at IS NULL").get().count,
    };
  }

  getPreference(key) {
    if (key === "themeMode") return this.ensureMeta("theme_mode", "light");
    if (key === "activeGroup") return this.ensureMeta("active_group", "");
    throw new Error(`未対応の設定です: ${key}`);
  }

  setPreference(key, value) {
    if (key === "themeMode") {
      if (!["light", "dark"].includes(value)) throw new Error("カラーモードの値が不正です。");
      this.db.prepare(`
        INSERT INTO workspace_meta(key, value) VALUES('theme_mode', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(value);
      return value;
    }
    if (key !== "activeGroup") throw new Error(`未対応の設定です: ${key}`);
    this.db.prepare(`
      INSERT INTO workspace_meta(key, value) VALUES('active_group', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(value || ""));
    return value;
  }

  isEmpty() {
    return this.db.prepare("SELECT COUNT(*) AS count FROM entities").get().count === 0;
  }

  list(type, includeDeleted = false) {
    assertEntityType(type);
    const sql = includeDeleted
      ? "SELECT * FROM entities WHERE entity_type = ? ORDER BY updated_at DESC"
      : "SELECT * FROM entities WHERE entity_type = ? AND deleted_at IS NULL ORDER BY updated_at DESC";
    return this.db.prepare(sql).all(type).map(parseRow);
  }

  loadWorkspace(includeDeleted = false) {
    const result = {};
    for (const type of workspaceEntityTypes) result[`${type}s`] = this.list(type, includeDeleted);
    result.plan_revisions = this.db.prepare(
      "SELECT * FROM plan_revisions ORDER BY changed_at DESC",
    ).all().map((row) => ({
      ...row,
      old: JSON.parse(row.old_json),
      next: JSON.parse(row.new_json),
    }));
    result.meta = this.getMeta();
    return result;
  }

  get(type, id, includeDeleted = false) {
    const row = this.db.prepare(
      `SELECT * FROM entities WHERE entity_type = ? AND id = ? ${includeDeleted ? "" : "AND deleted_at IS NULL"}`,
    ).get(type, String(id));
    return parseRow(row);
  }

  save(type, input, options = {}) {
    const transaction = this.db.transaction(() => this.saveWithinTransaction(type, input, options));
    return transaction();
  }

  saveMany(operations) {
    if (!Array.isArray(operations) || !operations.length) {
      throw new Error("保存するデータがありません。");
    }
    const transaction = this.db.transaction(() => operations.map((operation) => {
      if (!operation || operation.action !== "save") {
        throw new Error("saveManyではaction=saveのみ利用できます。");
      }
      return this.saveWithinTransaction(operation.type, operation.entity, operation.options || {});
    }));
    return transaction();
  }

  saveWithinTransaction(type, input, options = {}) {
    assertEntityType(type);
    const id = String(input.id || uuid());
    const existing = this.get(type, id, true);
    const timestamp = now();
    const entity = normalizeEntity(type, {
      ...input,
      id,
      created_at: existing?.created_at || input.created_at || timestamp,
      updated_at: timestamp,
      deleted_at: null,
      device_id: this.deviceId,
      source: input.source || existing?.source || options.source || "manual",
      version: (existing?.version || Number(input.version) || 0) + 1,
    });
    this.validateReferences(type, entity);
    this.validateGraph(type, entity);

    if (type === "item" && existing) this.recordPlanRevision(existing, entity, options.reason);
    this.db.prepare(`
      INSERT INTO entities(
        entity_type, id, data_json, created_at, updated_at, deleted_at, device_id, source, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_type, id) DO UPDATE SET
        data_json = excluded.data_json,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        device_id = excluded.device_id,
        source = excluded.source,
        version = excluded.version
    `).run(
      type,
      id,
      JSON.stringify(contentOf(entity)),
      entity.created_at,
      entity.updated_at,
      entity.deleted_at,
      entity.device_id,
      entity.source,
      entity.version,
    );
    return this.get(type, id);
  }

  validateReferences(type, entity) {
    const requireReference = (targetType, id, field) => {
      if (!id) return;
      if (!this.get(targetType, id)) {
        throw new Error(`${type}.${field}が存在しない${targetType}を参照しています。`);
      }
    };

    requireReference("theme", entity.theme_id, "theme_id");
    requireReference("item", entity.item_id, "item_id");
    requireReference("note", entity.note_id, "note_id");
    requireReference("source_record", entity.source_record_id, "source_record_id");
    requireReference("item", entity.parent_item_id, "parent_item_id");
    requireReference("field_definition", entity.field_definition_id, "field_definition_id");
    requireReference("note", entity.source_note_id, "source_note_id");
    requireReference("link", entity.source_link_id, "source_link_id");
    requireReference("item", entity.source_item_id, "source_item_id");

    if (type === "dependency") {
      requireReference("item", entity.source_item_id, "source_item_id");
      requireReference("item", entity.target_item_id, "target_item_id");
    }
    if (type === "knowledge_relation") {
      requireReference("knowledge_node", entity.source_node_id, "source_node_id");
      requireReference("knowledge_node", entity.target_node_id, "target_node_id");
    }
    if (type === "relation") {
      requireReference(entity.source_entity_type, entity.source_entity_id, "source_entity_id");
      requireReference(entity.target_entity_type, entity.target_entity_id, "target_entity_id");
    }
    if (type === "field_value" || type === "entity_source") {
      requireReference(entity.entity_type, entity.entity_id, "entity_id");
    }
    if (type === "entity_source") {
      requireReference("source_record", entity.source_record_id, "source_record_id");
    }
  }

  validateGraph(type, entity) {
    if (type === "item") this.validateItemParentGraph(entity);
    if (type === "dependency") this.validateDependencyGraph(entity);
    if (type === "knowledge_relation") this.validateKnowledgeRelationGraph(entity);
  }

  validateItemParentGraph(entity) {
    assertItemParentAcyclic(this.list("item"), entity);
  }

  validateDependencyGraph(entity) {
    assertDependencyAcyclic(this.list("dependency"), entity);
  }

  validateKnowledgeRelationGraph(entity) {
    assertKnowledgeRelationAcyclic(this.list("knowledge_relation"), entity);
  }

  validateSnapshotWorkspace(snapshot) {
    if (!isPlainObject(snapshot)) throw new Error("Snapshotのworkspace構造が不正です。");
    const activeIds = new Map();
    for (const type of workspaceEntityTypes) {
      const records = snapshot[collectionKey(type)] || [];
      if (!Array.isArray(records)) throw new Error(`${collectionKey(type)}は配列で指定してください。`);
      const ids = new Set();
      for (const record of records) {
        if (!isPlainObject(record)) throw new Error(`${type}のレコード構造が不正です。`);
        if (typeof record.id !== "string" || !record.id.trim()) throw new Error(`${type}.idがありません。`);
        validateEntity(type, record);
        if (!record.deleted_at) ids.add(String(record.id));
      }
      activeIds.set(type, ids);
    }

    const requireSnapshotReference = (type, record, targetType, id, field) => {
      if (!id || record.deleted_at) return;
      if (!activeIds.get(targetType)?.has(String(id))) {
        throw new Error(`${type}.${field}がSnapshot内に存在しない${targetType}を参照しています。`);
      }
    };

    for (const type of workspaceEntityTypes) {
      for (const record of snapshot[collectionKey(type)] || []) {
        requireSnapshotReference(type, record, "theme", record.theme_id, "theme_id");
        requireSnapshotReference(type, record, "item", record.item_id, "item_id");
        requireSnapshotReference(type, record, "note", record.note_id, "note_id");
        requireSnapshotReference(type, record, "source_record", record.source_record_id, "source_record_id");
        requireSnapshotReference(type, record, "item", record.parent_item_id, "parent_item_id");
        requireSnapshotReference(type, record, "field_definition", record.field_definition_id, "field_definition_id");
        requireSnapshotReference(type, record, "note", record.source_note_id, "source_note_id");
        requireSnapshotReference(type, record, "link", record.source_link_id, "source_link_id");
        requireSnapshotReference(type, record, "item", record.source_item_id, "source_item_id");
        if (type === "dependency") {
          requireSnapshotReference(type, record, "item", record.source_item_id, "source_item_id");
          requireSnapshotReference(type, record, "item", record.target_item_id, "target_item_id");
        }
        if (type === "knowledge_relation") {
          requireSnapshotReference(type, record, "knowledge_node", record.source_node_id, "source_node_id");
          requireSnapshotReference(type, record, "knowledge_node", record.target_node_id, "target_node_id");
        }
        if (type === "relation") {
          if (!workspaceEntityTypes.includes(record.source_entity_type) || !workspaceEntityTypes.includes(record.target_entity_type)) {
            throw new Error("relationの参照先種別が不正です。");
          }
          requireSnapshotReference(type, record, record.source_entity_type, record.source_entity_id, "source_entity_id");
          requireSnapshotReference(type, record, record.target_entity_type, record.target_entity_id, "target_entity_id");
        }
        if (type === "field_value" || type === "entity_source") {
          if (!workspaceEntityTypes.includes(record.entity_type)) throw new Error(`${type}.entity_typeが不正です。`);
          requireSnapshotReference(type, record, record.entity_type, record.entity_id, "entity_id");
        }
      }
    }

    this.validateSnapshotItemParentGraph(snapshot.items || []);
    this.validateSnapshotDependencyGraph(snapshot.dependencys || []);
    this.validateSnapshotKnowledgeRelationGraph(snapshot.knowledge_relations || []);
  }

  validateSnapshotItemParentGraph(items) {
    for (const item of items.filter((entry) => !entry.deleted_at)) {
      assertItemParentAcyclic(items, item, "Snapshot内のItem親子関係が循環しています。Import前に親Itemを修正してください。");
    }
  }

  validateSnapshotDependencyGraph(dependencies) {
    for (const dependency of dependencies.filter((entry) => !entry.deleted_at)) {
      assertDependencyAcyclic(dependencies, dependency, "Snapshot内のDependencyが循環しています。Import前に依存関係を修正してください。");
    }
  }

  validateSnapshotKnowledgeRelationGraph(relations) {
    for (const relation of relations.filter((entry) => !entry.deleted_at)) {
      assertKnowledgeRelationAcyclic(relations, relation, "Snapshot内のKnowledge Relationが循環しています。Import前に関係の向きを修正してください。");
    }
  }

  recordPlanRevision(oldItem, newItem, reason = "") {
    const fields = [
      "planned_start",
      "planned_end",
      "due_date",
    ];
    const oldValues = Object.fromEntries(fields.map((field) => [field, oldItem[field] ?? null]));
    const newValues = Object.fromEntries(fields.map((field) => [field, newItem[field] ?? null]));
    if (JSON.stringify(oldValues) === JSON.stringify(newValues)) return;
    const timestamp = now();
    this.db.prepare(`
      INSERT INTO plan_revisions(
        id, item_id, changed_at, changed_by_device_id, old_json, new_json, reason, related_note_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuid(),
      newItem.id,
      timestamp,
      this.deviceId,
      JSON.stringify(oldValues),
      JSON.stringify(newValues),
      reason || null,
      newItem.related_note_id || null,
      timestamp,
    );
  }

  remove(type, id) {
    assertEntityType(type);
    const transaction = this.db.transaction(() => {
      const existing = this.get(type, id);
      if (!existing) return null;
      this.applyDeletePolicy(type, String(id));
      this.markRemoved(type, String(id));
      return this.get(type, id, true);
    });
    return transaction();
  }

  restore(type, id) {
    assertEntityType(type);
    const transaction = this.db.transaction(() => {
      const existing = this.get(type, id, true);
      if (!existing) return null;
      const timestamp = now();
      this.db.prepare(`
        UPDATE entities
        SET deleted_at = NULL, updated_at = ?, device_id = ?, version = version + 1
        WHERE entity_type = ? AND id = ?
      `).run(timestamp, this.deviceId, type, String(id));
      this.restoreCascadeChildren(type, String(id));
      return this.get(type, id);
    });
    return transaction();
  }

  applyDeletePolicy(type, id) {
    if (type === "theme") {
      this.nullifyReferences(type, [
        ["item", "theme_id"],
        ["note", "theme_id"],
        ["link", "theme_id"],
        ["field_definition", "theme_id"],
        ["knowledge_node", "theme_id"],
        ["log_entry", "theme_id"],
        ["view", "theme_id"],
      ], id);
      this.cascadeWhere("status_update", (entry) => entry.theme_id === id, type, id);
    }

    if (type === "item") {
      this.nullifyReferences(type, [
        ["item", "parent_item_id"],
        ["note", "item_id"],
        ["link", "item_id"],
        ["knowledge_node", "source_item_id"],
        ["log_entry", "item_id"],
      ], id);
      this.cascadeWhere("dependency", (entry) => entry.source_item_id === id || entry.target_item_id === id, type, id);
    }

    if (type === "note") {
      this.nullifyReferences(type, [["link", "note_id"], ["knowledge_node", "source_note_id"], ["log_entry", "related_note_id"]], id);
    }

    if (type === "link") {
      this.nullifyReferences(type, [["knowledge_node", "source_link_id"]], id);
    }

    if (type === "source_record") {
      this.nullifyReferences(type, [
        ["item", "source_record_id"],
        ["note", "source_record_id"],
        ["link", "source_record_id"],
        ["log_entry", "source_record_id"],
      ], id);
    }

    if (type === "field_definition") {
      this.cascadeWhere("field_value", (entry) => entry.field_definition_id === id, type, id);
    }

    if (type === "knowledge_node") {
      this.cascadeWhere(
        "knowledge_relation",
        (entry) => entry.source_node_id === id || entry.target_node_id === id,
        type,
        id,
      );
    }

    if (["theme", "item", "note", "link", "source_record", "knowledge_node"].includes(type)) {
      this.cascadeWhere(
        "relation",
        (entry) => (entry.source_entity_type === type && entry.source_entity_id === id)
          || (entry.target_entity_type === type && entry.target_entity_id === id),
        type,
        id,
      );
      this.cascadeWhere(
        "entity_source",
        (entry) => (entry.entity_type === type && entry.entity_id === id)
          || (type === "source_record" && entry.source_record_id === id),
        type,
        id,
      );
      this.cascadeWhere(
        "field_value",
        (entry) => entry.entity_type === type && entry.entity_id === id,
        type,
        id,
      );
    }
  }

  nullifyReferences(parentType, targets, removedId) {
    for (const [entityType, field] of targets) {
      for (const entity of this.list(entityType)) {
        if (entity[field] !== removedId) continue;
        const detached = Array.isArray(entity.detached_references) ? entity.detached_references : [];
        this.saveWithinTransaction(entityType, {
          ...entity,
          [field]: null,
          detached_references: [
            ...detached.filter((entry) => entry.field !== field),
            { field, parentType, parentId: removedId },
          ],
        });
      }
    }
  }

  cascadeWhere(entityType, predicate, parentType, parentId) {
    for (const entity of this.list(entityType)) {
      if (!predicate(entity)) continue;
      this.markRemoved(entityType, entity.id, { parentType, parentId });
    }
  }

  markRemoved(type, id, cascade = null) {
    const existing = this.get(type, id, true);
    if (!existing || existing.deleted_at) return;
    const timestamp = now();
    const data = contentOf(existing);
    if (cascade) data.cascade_deleted_by = cascade;
    this.db.prepare(`
      UPDATE entities
      SET data_json = ?, deleted_at = ?, updated_at = ?, device_id = ?, version = version + 1
      WHERE entity_type = ? AND id = ?
    `).run(JSON.stringify(data), timestamp, timestamp, this.deviceId, type, id);
  }

  restoreCascadeChildren(parentType, parentId) {
    for (const entityType of workspaceEntityTypes) {
      for (const entity of this.list(entityType, true)) {
        if (!entity.deleted_at) continue;
        const marker = entity.cascade_deleted_by;
        if (marker?.parentType !== parentType || marker?.parentId !== parentId) continue;
        const { cascade_deleted_by: _marker, ...data } = contentOf(entity);
        const timestamp = now();
        this.db.prepare(`
          UPDATE entities
          SET data_json = ?, deleted_at = NULL, updated_at = ?, device_id = ?, version = version + 1
          WHERE entity_type = ? AND id = ?
        `).run(JSON.stringify(data), timestamp, this.deviceId, entityType, entity.id);
      }
    }
    this.restoreDetachedReferences(parentType, parentId);
  }

  restoreDetachedReferences(parentType, parentId) {
    for (const entityType of workspaceEntityTypes) {
      for (const entity of this.list(entityType)) {
        const detached = Array.isArray(entity.detached_references) ? entity.detached_references : [];
        const matching = detached.filter((entry) => entry.parentType === parentType && entry.parentId === parentId);
        if (!matching.length) continue;
        const next = { ...entity };
        for (const entry of matching) {
          if (!next[entry.field]) next[entry.field] = parentId;
        }
        const remaining = detached.filter((entry) => !matching.includes(entry));
        if (remaining.length) next.detached_references = remaining;
        else delete next.detached_references;
        this.saveWithinTransaction(entityType, next);
      }
    }
  }

  bootstrap(legacyWorkspace) {
    if (!this.isEmpty()) return this.loadWorkspace();
    const transaction = this.db.transaction(() => {
      for (const type of workspaceEntityTypes) {
        const records = legacyWorkspace?.[`${type}s`] || [];
        for (const record of records) this.insertImported(type, record, "legacy");
      }
    });
    transaction();
    return this.loadWorkspace();
  }

  insertImported(type, input, fallbackSource = "imported") {
    assertEntityType(type);
    validateEntity(type, input);
    const timestamp = now();
    const entity = {
      ...input,
      id: String(input.id || uuid()),
      created_at: input.created_at || timestamp,
      updated_at: input.updated_at || timestamp,
      deleted_at: input.deleted_at || null,
      device_id: input.device_id || this.deviceId,
      source: input.source || fallbackSource,
      version: Number(input.version) || 1,
    };
    this.db.prepare(`
      INSERT OR REPLACE INTO entities(
        entity_type, id, data_json, created_at, updated_at, deleted_at, device_id, source, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      type,
      entity.id,
      JSON.stringify(contentOf(entity)),
      entity.created_at,
      entity.updated_at,
      entity.deleted_at,
      entity.device_id,
      entity.source,
      entity.version,
    );
  }

  previewSnapshot(snapshot) {
    this.validateSnapshotWorkspace(snapshot);
    const changes = [];
    for (const type of workspaceEntityTypes) {
      for (const incoming of snapshot?.[`${type}s`] || []) {
        const local = this.get(type, incoming.id, true);
        let category = "new";
        if (local) {
          const sameContent = JSON.stringify(contentOf(local)) === JSON.stringify(contentOf(incoming))
            && Boolean(local.deleted_at) === Boolean(incoming.deleted_at);
          if (sameContent) category = "same";
          else if (Number(incoming.version || 1) > Number(local.version || 1)) category = "update";
          else if (Number(incoming.version || 1) < Number(local.version || 1)) category = "local_newer";
          else category = "conflict";
        }
        changes.push({
          key: `${type}:${incoming.id}`,
          type,
          incoming,
          local,
          category,
          action: category === "new" ? "create" : category === "update" ? "update" : "ignore",
          actions: category === "new" ? ["create", "ignore"] : ["update", "duplicate", "ignore"],
        });
      }
    }
    return changes;
  }

  applySnapshot(snapshot, decisions = {}, revisions = []) {
    this.validateSnapshotWorkspace(snapshot);
    const preview = this.previewSnapshot(snapshot);
    const applied = [];
    const transaction = this.db.transaction(() => {
      for (const change of preview) {
        const action = decisions[change.key] || change.action;
        if (!["create", "update", "ignore", "duplicate"].includes(action)) {
          throw new Error("Snapshotの取り込み操作が不正です。プレビューからやり直してください。");
        }
        if (action === "ignore") continue;
        if (action === "create" && change.local) {
          throw new Error("既存データがあるため、Snapshotのcreateでは上書きできません。updateまたはduplicateを選んでください。");
        }
        if (action === "update" && !change.local) {
          throw new Error("既存データがないため、Snapshotのupdateは実行できません。createを選んでください。");
        }
        if (action === "duplicate") {
          this.insertImported(change.type, {
            ...change.incoming,
            id: uuid(),
            source: "snapshot",
            version: 1,
          }, "snapshot");
        } else {
          this.insertImported(change.type, change.incoming, "snapshot");
        }
        applied.push({ key: change.key, action });
      }
      for (const revision of revisions) this.insertPlanRevision(revision);
      this.insertImported("import_batch", {
        id: uuid(),
        source: "snapshot",
        status: "completed",
        count: applied.length,
        created_at: now(),
      }, "snapshot");
    });
    transaction();
    return { applied, workspace: this.loadWorkspace() };
  }

  insertPlanRevision(revision) {
    if (!revision?.id || !revision.item_id || !revision.changed_at) return;
    this.db.prepare(`
      INSERT OR IGNORE INTO plan_revisions(
        id, item_id, changed_at, changed_by_device_id, old_json, new_json, reason, related_note_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      revision.id,
      revision.item_id,
      revision.changed_at,
      revision.changed_by_device_id || this.deviceId,
      JSON.stringify(revision.old || {}),
      JSON.stringify(revision.next || {}),
      revision.reason || null,
      revision.related_note_id || null,
      revision.created_at || revision.changed_at,
    );
  }
}

export { workspaceEntityTypes };
export const workspaceSchemaVersion = SCHEMA_VERSION;

``

### $relative

``
import AdmZip from "adm-zip";
import crypto from "node:crypto";
import fs from "node:fs";

import { workspaceEntityTypes, workspaceSchemaVersion } from "../repositories/workspaceRepository.mjs";

const checksum = (text) => crypto.createHash("sha256").update(text).digest("hex");
const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024;
const MAX_ENTRY_BYTES = 10 * 1024 * 1024;

function readEntryText(entry, name) {
  if (entry.header.size > MAX_ENTRY_BYTES) {
    throw new Error(`${name}が大きすぎます。Snapshotを分割するか、不要なデータを削除してください。`);
  }
  return entry.getData().toString("utf8");
}

function summaryMarkdown(workspace) {
  const themes = workspace.themes || [];
  const items = (workspace.items || []).filter((item) => !item.deleted_at);
  const notes = (workspace.notes || []).filter((note) => !note.deleted_at);
  return [
    "# Tasken Workspace",
    "",
    `Exported: ${new Date().toISOString()}`,
    "",
    ...themes.flatMap((theme) => {
      const related = items.filter((item) => item.theme_id === theme.id && item.status !== "done");
      const milestones = related.filter((item) => item.kind === "milestone");
      const waiting = related.filter((item) => item.kind === "waiting" || item.status === "waiting");
      const recentNotes = notes.filter((note) => note.theme_id === theme.id).slice(0, 5);
      return [
        `## ${theme.name}`,
        theme.description || "",
        "",
        "### Milestones",
        ...(milestones.length ? milestones.map((item) => `- ${item.planned_end || "予定なし"} ${item.title}`) : ["- なし"]),
        "",
        "### Open Items",
        ...(related.length ? related.map((item) => `- [ ] ${item.planned_end || "予定なし"} ${item.title}`) : ["- なし"]),
        "",
        "### Waiting",
        ...(waiting.length ? waiting.map((item) => `- ${item.title}`) : ["- なし"]),
        "",
        "### Recent Notes",
        ...(recentNotes.length ? recentNotes.map((note) => `- ${note.title}`) : ["- なし"]),
        "",
      ];
    }),
  ].join("\n");
}

export function createSnapshot(workspace) {
  const zip = new AdmZip();
  const files = {};
  for (const type of workspaceEntityTypes) {
    const name = `${type}s.json`;
    const content = JSON.stringify(workspace[`${type}s`] || [], null, 2);
    zip.addFile(name, Buffer.from(content, "utf8"));
    files[name] = checksum(content);
  }
  const revisions = JSON.stringify(workspace.plan_revisions || [], null, 2);
  zip.addFile("plan_revisions.json", Buffer.from(revisions, "utf8"));
  files["plan_revisions.json"] = checksum(revisions);

  const summary = summaryMarkdown(workspace);
  zip.addFile("summary.md", Buffer.from(summary, "utf8"));
  files["summary.md"] = checksum(summary);

  const manifest = {
    format: "research-desk-workspace",
    snapshotVersion: 2,
    schemaVersion: workspaceSchemaVersion,
    workspaceId: workspace.meta?.workspaceId,
    deviceId: workspace.meta?.deviceId,
    exportedAt: new Date().toISOString(),
    files,
  };
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));
  return zip;
}

export function readSnapshot(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_SNAPSHOT_BYTES) {
    throw new Error("Snapshotファイルが大きすぎます。50MB以下のファイルを選択してください。");
  }
  const zip = new AdmZip(filePath);
  const manifestEntry = zip.getEntry("manifest.json");
  if (!manifestEntry) throw new Error("manifest.jsonがないため、TaskenのSnapshotとして読み込めません。");
  const manifest = JSON.parse(readEntryText(manifestEntry, "manifest.json"));
  if (manifest.format !== "research-desk-workspace") throw new Error("対応していないSnapshot形式です。");
  if (manifest.schemaVersion > workspaceSchemaVersion) {
    throw new Error("このSnapshotは新しいバージョンで作成されています。アプリを更新してください。");
  }

  const workspace = { meta: { workspaceId: manifest.workspaceId, deviceId: manifest.deviceId } };
  for (const type of workspaceEntityTypes) {
    const name = `${type}s.json`;
    const entry = zip.getEntry(name);
    if (!entry) {
      workspace[`${type}s`] = [];
      continue;
    }
    const text = readEntryText(entry, name);
    if (manifest.files?.[name] && checksum(text) !== manifest.files[name]) {
      throw new Error(`${name}のチェックサムが一致しません。Snapshotが破損している可能性があります。`);
    }
    workspace[`${type}s`] = JSON.parse(text);
  }
  const revisionsEntry = zip.getEntry("plan_revisions.json");
  if (revisionsEntry) {
    const text = readEntryText(revisionsEntry, "plan_revisions.json");
    if (manifest.files?.["plan_revisions.json"] && checksum(text) !== manifest.files["plan_revisions.json"]) {
      throw new Error("plan_revisions.jsonのチェックサムが一致しません。Snapshotが破損している可能性があります。");
    }
    workspace.plan_revisions = JSON.parse(text);
  } else {
    workspace.plan_revisions = [];
  }
  return { manifest, workspace };
}

``

### $relative

``typescript
import { clipboard, dialog, type WebContents } from "electron";

import type { Workspace } from "../../shared/types/workspace";
import { createSnapshot, readSnapshot } from "./snapshotService.mjs";

type SnapshotDecisions = Record<string, string>;

interface WorkspaceRepository {
  loadWorkspace(includeDeleted?: boolean): unknown;
  previewSnapshot(workspace: unknown): unknown[];
  applySnapshot(workspace: unknown, decisions: SnapshotDecisions, revisions: unknown[]): unknown;
}

function localDateIso(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export class WorkspaceService {
  private readonly pendingSnapshots = new Map<string, Workspace>();

  constructor(private readonly repository: WorkspaceRepository) {}

  writeClipboard(text: unknown): boolean {
    clipboard.writeText(String(text));
    return true;
  }

  reload(sender: WebContents): boolean {
    sender.reload();
    return true;
  }

  async exportSnapshot(): Promise<{ canceled: boolean; filePath?: string }> {
    const date = localDateIso();
    const result = await dialog.showSaveDialog({
      title: "Workspace Snapshotを書き出す",
      defaultPath: `workspace_export_${date}.zip`,
      filters: [{ name: "Tasken Snapshot", extensions: ["zip"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    createSnapshot(this.repository.loadWorkspace(true)).writeZip(result.filePath);
    return { canceled: false, filePath: result.filePath };
  }

  async inspectSnapshot() {
    const result = await dialog.showOpenDialog({
      title: "Workspace Snapshotを読み込む",
      properties: ["openFile"],
      filters: [{ name: "Tasken Snapshot", extensions: ["zip"] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const parsed = readSnapshot(result.filePaths[0]) as {
      manifest: Record<string, unknown>;
      workspace: Workspace;
    };
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.pendingSnapshots.set(token, parsed.workspace);
    return {
      canceled: false,
      token,
      manifest: parsed.manifest,
      changes: this.repository.previewSnapshot(parsed.workspace),
    };
  }

  applySnapshot(token: string, decisions: SnapshotDecisions): Workspace {
    const snapshot = this.pendingSnapshots.get(token);
    if (!snapshot) {
      throw new Error("Importプレビューの有効期限が切れました。もう一度Snapshotを選択してください。");
    }
    const result = this.repository.applySnapshot(snapshot, decisions, snapshot.plan_revisions || []);
    this.pendingSnapshots.delete(token);
    return result as Workspace;
  }
}

``

### $relative

``typescript
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("captureApi", {
  save: (text: string) => ipcRenderer.invoke("quick-capture:save", text),
  hide: () => ipcRenderer.send("quick-capture:hide"),
  onShow: (callback: () => void) => {
    ipcRenderer.on("quick-capture:shown", callback);
  },
  onThemeChange: (callback: (mode: string) => void) => {
    ipcRenderer.on("quick-capture:theme", (_event, mode: string) => callback(mode));
  },
});

``

### $relative

``typescript
import { contextBridge, ipcRenderer } from "electron";

import { IPC, type ResearchDeskApi } from "../shared/ipc/contracts";

type Unsubscribe = () => void;

const api: ResearchDeskApi = {
  workspace: {
    load: () => ipcRenderer.invoke(IPC.workspaceLoad),
    bootstrap: (legacy) => ipcRenderer.invoke(IPC.workspaceBootstrap, legacy),
    getMeta: () => ipcRenderer.invoke(IPC.workspaceMeta),
  },
  preferences: {
    get: (key) => ipcRenderer.invoke(IPC.preferenceGet, key),
    set: (key, value) => ipcRenderer.invoke(IPC.preferenceSet, key, value),
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke(IPC.clipboardWriteText, text),
  },
  app: {
    reload: () => ipcRenderer.invoke(IPC.appReload),
    onWorkspaceChanged: (callback: () => void): Unsubscribe => {
      const handler = (): void => { callback(); };
      ipcRenderer.on("workspace:changed", handler);
      return () => { ipcRenderer.removeListener("workspace:changed", handler); };
    },
  },
  entities: {
    list: (type, includeDeleted = false) => ipcRenderer.invoke(IPC.entityList, type, includeDeleted),
    get: (type, id) => ipcRenderer.invoke(IPC.entityGet, type, id),
    save: (type, entity, options = {}) => ipcRenderer.invoke(IPC.entitySave, type, entity, options),
    saveMany: (operations) => ipcRenderer.invoke(IPC.entitySaveMany, operations),
    remove: (type, id) => ipcRenderer.invoke(IPC.entityRemove, type, id),
    restore: (type, id) => ipcRenderer.invoke(IPC.entityRestore, type, id),
  },
  snapshots: {
    exportFile: () => ipcRenderer.invoke(IPC.snapshotExport),
    inspectFile: () => ipcRenderer.invoke(IPC.snapshotInspect),
    applyImport: (token, decisions) => ipcRenderer.invoke(IPC.snapshotApply, token, decisions),
  },
};

contextBridge.exposeInMainWorld("api", api);
contextBridge.exposeInMainWorld("researchDesk", api);

``

### $relative

``html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' http://localhost:* ws://localhost:*;"
    />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700&display=swap" rel="stylesheet" />
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      html, body { height: 100%; overflow: hidden; }
      body {
        font-family: 'Nunito', sans-serif;
        font-size: 14px;
        color: #3D2E2A;
        background: #F4EEEC;
        border: 1px solid #D5C9C3;
        border-radius: 7px;
      }
      [data-theme="dark"] body {
        color: #E8DDD8;
        background: #2A2220;
        border-color: #4A3E3A;
      }
      .capture-form {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        height: 100%;
      }
      .capture-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        user-select: none;
        -webkit-app-region: drag;
      }
      .capture-header strong {
        font-size: 12px;
        color: #8A2F3B;
      }
      [data-theme="dark"] .capture-header strong {
        color: #D4858F;
      }
      .capture-hint {
        font-size: 11px;
        color: #7A6E69;
        -webkit-app-region: no-drag;
      }
      [data-theme="dark"] .capture-hint {
        color: #9B8E89;
      }
      textarea {
        flex: 1;
        min-height: 60px;
        padding: 8px;
        border: 1px solid #D5C9C3;
        border-radius: 7px;
        background: #FDFBFA;
        font: inherit;
        font-size: 13px;
        color: inherit;
        resize: none;
        outline: none;
      }
      textarea:focus {
        border-color: #8A2F3B;
        box-shadow: 0 0 0 2px rgba(138, 47, 59, 0.15);
      }
      [data-theme="dark"] textarea {
        background: #1E1816;
        border-color: #4A3E3A;
      }
      [data-theme="dark"] textarea:focus {
        border-color: #D4858F;
        box-shadow: 0 0 0 2px rgba(212, 133, 143, 0.2);
      }
      .capture-actions {
        display: flex;
        justify-content: flex-end;
        gap: 6px;
      }
      button {
        min-height: 30px;
        padding: 4px 14px;
        border: 1px solid #8A2F3B;
        border-radius: 7px;
        background: #8A2F3B;
        color: #FFF;
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }
      button:hover { background: #7A2835; }
      button:active { transform: scale(0.98); }
      button:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(138, 47, 59, 0.3); }
      button:disabled { opacity: 0.5; cursor: not-allowed; }
      .feedback {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        background: rgba(138, 47, 59, 0.92);
        color: #FFF;
        font-weight: 600;
        font-size: 13px;
        animation: fade-out 0.8s ease 0.3s forwards;
        pointer-events: none;
      }
      .feedback.error {
        padding: 12px;
        background: rgba(206, 59, 59, 0.96);
        text-align: center;
        animation: none;
      }
      @keyframes fade-out {
        to { opacity: 0; }
      }
    </style>
  </head>
  <body>
    <div class="capture-form">
      <div class="capture-header">
        <strong>Inbox に記録</strong>
        <span class="capture-hint">Ctrl+Enter で送信 / Esc で閉じる</span>
      </div>
      <textarea id="input" placeholder="タスク・メモ・アイデア" autofocus></textarea>
      <div class="capture-actions">
        <button id="submit" type="button">記録する</button>
      </div>
    </div>
    <div id="feedback" class="feedback" style="display:none">記録しました</div>
    <script>
      const input = document.getElementById("input");
      const submitButton = document.getElementById("submit");
      const feedback = document.getElementById("feedback");

      async function submit() {
        const text = input.value.trim();
        if (!text) return;
        submitButton.disabled = true;
        try {
          await window.captureApi.save(text);
          input.value = "";
          feedback.style.display = "";
          feedback.style.animation = "none";
          feedback.offsetHeight;
          feedback.style.animation = "";
          setTimeout(() => {
            feedback.style.display = "none";
            window.captureApi.hide();
          }, 600);
        } catch {
          feedback.textContent = "保存できませんでした。入力は残っています。メイン画面を開いて状態を確認してください。";
          feedback.classList.add("error");
          feedback.style.display = "";
        } finally {
          submitButton.disabled = false;
        }
      }

      submitButton.addEventListener("click", submit);

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          window.captureApi.hide();
          return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          submit();
        }
      });

      window.captureApi.onShow(() => {
        input.value = "";
        input.focus();
        feedback.style.display = "none";
        feedback.classList.remove("error");
        feedback.textContent = "記録しました";
        const theme = document.documentElement.dataset.theme;
        if (!theme) document.documentElement.dataset.theme = "light";
      });

      window.captureApi.onThemeChange((mode) => {
        document.documentElement.dataset.theme = mode;
      });
    </script>
  </body>
</html>

``

### $relative

``html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#F4EEEC" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' http://localhost:* ws://localhost:*;"
    />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700&display=swap" rel="stylesheet" />
    <title>Tasken</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>

``

### $relative

``tsx
import { WorkspaceApp } from "./features/workspace/WorkspaceApp";

export function App() {
  return (
    <div className="min-h-screen font-[var(--font-base)]">
      <WorkspaceApp />
    </div>
  );
}

``

### $relative

``javascript
export const initialThemes = [
  { id: "material-a", name: "材料A評価", subtitle: "材料Aの特性評価と最適条件の検討", status: "進行中" },
  { id: "process", name: "加工条件最適化", subtitle: "加工条件と表面品質の相関整理", status: "計画中" },
  { id: "ai", name: "AI活用検討", subtitle: "解析支援ワークフローの検証", status: "進行中" },
  { id: "monthly", name: "月次報告対応", subtitle: "研究進捗の定例報告", status: "継続" },
];

export const initialTasks = [
  { id: 1, theme: "material-a", title: "測定結果の受領と確認", due: "2026-06-20", status: "todo", kind: "task", priority: "normal" },
  { id: 2, theme: "material-a", title: "条件Bの追加測定の計画確定", due: "2026-06-18", status: "todo", kind: "task", priority: "high" },
  { id: 3, theme: "material-a", title: "中間報告スライド骨子作成", due: "2026-06-23", status: "todo", kind: "task", priority: "normal" },
  { id: 4, theme: "material-a", title: "解析方針の検討", due: "2026-06-27", status: "todo", kind: "task", priority: "decision" },
  { id: 5, theme: "material-a", title: "条件Cの予備試験計画", due: "2026-07-03", status: "todo", kind: "task", priority: "normal" },
  { id: 6, theme: "material-a", title: "中間報告資料の作成", due: "2026-07-01", status: "todo", kind: "task", priority: "normal" },
  { id: 7, theme: "process", title: "加工温度ログの整形", due: "2026-06-25", status: "todo", kind: "task", priority: "normal" },
  { id: 8, theme: "ai", title: "解析プロンプトの比較", due: "2026-06-29", status: "todo", kind: "task", priority: "normal" },
  { id: 9, theme: "material-a", title: "過去データの単位統一", due: "2026-06-12", status: "done", kind: "task", priority: "normal" },
];

export const initialWaiting = [
  {
    id: 101,
    theme: "material-a",
    title: "評価チームから測定結果",
    waitingFor: "材料A 条件Bバリエーションの測定結果",
    owner: "評価チーム（佐藤さん）",
    due: "2026-06-20",
    note: "追加測定の依頼を06/13に実施。条件Bの温度は5℃、各3回ずつの測定。",
    next: "結果受領後、再現性の確認と解析方針の検討に着手。",
    status: "waiting",
  },
  {
    id: 102,
    theme: "material-a",
    title: "試作チームへ試作品を依頼",
    waitingFor: "条件Cの試作品",
    owner: "試作チーム",
    due: "2026-07-15",
    note: "仕様書v1.2を共有済み。",
    next: "受領時に外観とロット番号を確認。",
    status: "waiting",
  },
];

export const initialNotes = [
  { id: 201, theme: "material-a", title: "条件Bバリエーションの測定結果について", type: "研究メモ", body: "条件Bのバリエーション（温度±5℃）の測定結果を受領。強度はやや向上、ばらつきは条件Aより小さい。解析方針はまだ確定せず、再現性の確認が必要。", url: "", updated: "今日 09:12" },
  { id: 202, theme: "material-a", title: "解析方針の候補メモ", type: "検討メモ", body: "多変量解析または曜日ごとの分解を比較検討。再現性が十分でないため、まず曜日まで傾向把握。追加データで多変量に切り替える。", url: "", updated: "昨日 18:40" },
  { id: 203, theme: "material-a", title: "中間報告の構成案", type: "構成メモ", body: "背景 / 目的 / 方法 / 結果（条件A・B）/ 考察 / 今後の予定", url: "", updated: "06/11 21:15" },
  { id: 204, theme: "process", title: "加工条件レビュー", type: "会議メモ", body: "温度・速度・保持時間の3因子を優先。次回までに欠測条件を整理する。", url: "", updated: "06/10 16:30" },
  { id: 301, theme: "material-a", title: "測定計画書_v1.2.pdf", type: "資料", body: "材料Aの測定条件と評価手順", url: "https://example.com/measurement-plan", updated: "" },
  { id: 302, theme: "material-a", title: "データ一覧_20260610.xlsx", type: "資料", body: "条件A・Bの測定結果一覧", url: "https://example.com/measurement-data", updated: "" },
  { id: 303, theme: "material-a", title: "中間報告_骨子.pptx", type: "資料", body: "7月1日の中間報告用資料", url: "https://example.com/interim-report", updated: "" },
];

export const initialPhases = [
  { id: 1, theme: "material-a", label: "測定・評価", start: "2026-06-01", end: "2026-06-26", lane: "plan", tone: "blue" },
  { id: 2, theme: "material-a", label: "解析・考察", start: "2026-06-22", end: "2026-07-31", lane: "plan", tone: "accent" },
  { id: 3, theme: "material-a", label: "条件検討・追加実験", start: "2026-08-01", end: "2026-09-05", lane: "plan", tone: "neutral" },
  { id: 4, theme: "material-a", label: "まとめ・報告", start: "2026-09-06", end: "2026-10-02", lane: "plan", tone: "rose" },
  { id: 5, theme: "process", label: "条件スクリーニング", start: "2026-06-15", end: "2026-08-07", lane: "plan", tone: "green" },
  { id: 6, theme: "process", label: "最適化実験", start: "2026-08-10", end: "2026-10-16", lane: "plan", tone: "blue" },
  { id: 7, theme: "ai", label: "ユースケース整理", start: "2026-06-08", end: "2026-07-10", lane: "plan", tone: "amber" },
  { id: 8, theme: "ai", label: "小規模検証", start: "2026-07-13", end: "2026-09-25", lane: "plan", tone: "accent" },
];

export const initialMilestones = [
  { id: 1, theme: "material-a", label: "条件B追加測定", date: "2026-06-20" },
  { id: 2, theme: "material-a", label: "中間報告", date: "2026-07-01" },
  { id: 3, theme: "material-a", label: "解析方針決定", date: "2026-08-05" },
  { id: 4, theme: "material-a", label: "最終報告", date: "2026-09-15" },
  { id: 5, theme: "process", label: "候補条件決定", date: "2026-08-07" },
  { id: 6, theme: "ai", label: "検証レビュー", date: "2026-09-25" },
];

``

### $relative

``javascript
import {
  initialMilestones,
  initialNotes,
  initialPhases,
  initialTasks,
  initialThemes,
  initialWaiting,
} from "./initialData.js";

const isoNow = () => new Date().toISOString();
const id = (prefix, value) => `${prefix}-${value}`;

function metadata(source = "seed") {
  const timestamp = isoNow();
  return {
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
    device_id: "bootstrap",
    source,
    version: 1,
  };
}

export function buildBootstrapWorkspace() {
  const themes = initialThemes.map((theme) => ({
    id: String(theme.id),
    name: theme.name,
    description: theme.description ?? theme.subtitle ?? "",
    status: theme.status || "計画中",
    color: theme.color || "",
    ...metadata(theme.source || "legacy"),
  }));

  const taskItems = initialTasks.map((task, index) => ({
    id: id("task", task.id),
    title: task.title,
    kind: task.kind === "inbox" ? "idea" : task.kind || "task",
    theme_id: task.theme || null,
    status: task.status || "todo",
    priority: task.priority || "normal",
    parent_item_id: null,
    sort_order: index,
    depth: 0,
    baseline_start: task.baseline_start || null,
    baseline_end: task.baseline_end || task.due || null,
    planned_start: task.planned_start || null,
    planned_end: task.planned_end || task.due || null,
    actual_start: task.actual_start || null,
    actual_end: task.actual_end || null,
    due_date: task.due || null,
    progress: task.status === "done" ? 100 : 0,
    is_personal_task: !task.theme,
    description: task.description || "",
    ...metadata(task.source || "legacy"),
  }));

  const waitingItems = initialWaiting.map((item, index) => ({
    id: id("waiting", item.id),
    title: item.title,
    kind: "waiting",
    theme_id: item.theme || null,
    status: item.status || "waiting",
    priority: "normal",
    parent_item_id: null,
    sort_order: taskItems.length + index,
    depth: 0,
    planned_start: null,
    planned_end: item.due || null,
    due_date: item.due || null,
    progress: item.status === "done" ? 100 : 0,
    waiting_for: item.waitingFor || "",
    next_action: item.next || "",
    description: item.note || "",
    is_personal_task: false,
    ...metadata(item.source || "legacy"),
  }));

  const periodItems = initialPhases.map((phase, index) => ({
    id: id("period", phase.id),
    title: phase.label,
    kind: "period",
    theme_id: phase.theme || null,
    status: "todo",
    priority: "normal",
    parent_item_id: null,
    sort_order: taskItems.length + waitingItems.length + index,
    depth: 0,
    baseline_start: phase.start,
    baseline_end: phase.end,
    planned_start: phase.start,
    planned_end: phase.end,
    due_date: phase.end,
    progress: 0,
    tone: phase.tone || "accent",
    description: "",
    is_personal_task: false,
    ...metadata(phase.source || "legacy"),
  }));

  const milestoneItems = initialMilestones.map((milestone, index) => ({
    id: id("milestone", milestone.id),
    title: milestone.label,
    kind: "milestone",
    theme_id: milestone.theme || null,
    status: "todo",
    priority: "high",
    parent_item_id: null,
    sort_order: taskItems.length + waitingItems.length + periodItems.length + index,
    depth: 0,
    baseline_start: milestone.date,
    baseline_end: milestone.date,
    planned_start: milestone.date,
    planned_end: milestone.date,
    due_date: milestone.date,
    progress: 0,
    description: "",
    is_personal_task: false,
    ...metadata(milestone.source || "legacy"),
  }));

  const notes = initialNotes.map((note) => ({
    id: id("note", note.id),
    title: note.title,
    body_markdown: note.body || "",
    note_type: note.type || "memo",
    theme_id: note.theme || null,
    item_id: note.item_id || null,
    source_url: note.url || "",
    properties_json: {},
    comments: note.comments || [],
    ...metadata(note.source || "legacy"),
  }));

  const links = initialNotes.filter((note) => note.url).map((note) => ({
    id: id("link", note.id),
    title: note.title,
    url: note.url,
    link_type: "other",
    theme_id: note.theme || null,
    item_id: null,
    note_id: id("note", note.id),
    description: note.body || "",
    ...metadata("legacy"),
  }));

  return {
    themes,
    items: [...taskItems, ...waitingItems, ...periodItems, ...milestoneItems],
    notes,
    links,
    dependencys: [],
    views: [],
    status_updates: [],
    source_records: [],
    entity_sources: [],
    relations: [],
    field_definitions: [],
    field_values: [],
    log_entries: [],
    import_batchs: [],
    knowledge_nodes: [],
    knowledge_relations: [],
    ai_proposals: [],
  };
}

export function emptyWorkspace() {
  return {
    themes: [],
    items: [],
    notes: [],
    links: [],
    dependencys: [],
    views: [],
    status_updates: [],
    source_records: [],
    entity_sources: [],
    relations: [],
    field_definitions: [],
    field_values: [],
    log_entries: [],
    import_batchs: [],
    knowledge_nodes: [],
    knowledge_relations: [],
    ai_proposals: [],
    plan_revisions: [],
    meta: {},
  };
}

``

### $relative

``tsx
import { type ReactNode, useEffect, useState } from "react";

import type { BaseRecord, DrawerConfig, Item, Theme } from "../types";
import { statusTone, themeColor } from "../lib/domain";

export type CloseDrawer = (next?: DrawerConfig | null) => void;

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      <div className="header-actions">{children}</div>
    </header>
  );
}

export function StatusBadge({ value, label }: { value?: string; label?: ReactNode }) {
  return <span className={`status-badge ${statusTone(value)}`}>{label || value || "未設定"}</span>;
}

export function Metric({ label, value, tone = "" }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className={`metric-card panel ${tone}`}>
      <span>{label}</span>
      <strong className="metric-value">{value}</strong>
    </div>
  );
}

export function EmptyState({ title, action, onAction }: { title: string; action: string; onAction: () => void }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <button className="secondary-button compact" onClick={onAction}>{action}</button>
    </div>
  );
}

export function SimpleRows({
  records = [],
  onOpen,
  meta,
}: {
  records?: BaseRecord[];
  onOpen: (record: BaseRecord) => void;
  meta: (record: BaseRecord) => ReactNode;
}) {
  return (
    <>
      {records.map((record) => (
        <button className="wide-row" key={record.id} onClick={() => onOpen(record)}>
          <strong>{String(record.title ?? record.name ?? record.summary ?? "")}</strong>
          <span>{meta(record)}</span>
        </button>
      ))}
    </>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label>{label}{children}</label>;
}

export function ThemeSelect({
  themes = [],
  value,
  allowPersonal = false,
  allowAll = false,
}: {
  themes?: Theme[];
  value?: string | null;
  allowPersonal?: boolean;
  allowAll?: boolean;
}) {
  const [selected, setSelected] = useState(value || "");
  useEffect(() => {
    setSelected(value || "");
  }, [value]);
  const noneLabel = allowAll ? "全体共通" : allowPersonal ? "個人業務" : "未設定";
  return (
    <Field label="Theme">
      <input type="hidden" name="theme_id" value={selected} />
      <div className="theme-chips">
        <button
          type="button"
          className={`theme-chip ${!selected ? "is-selected" : ""}`}
          onClick={() => setSelected("")}
        >
          {noneLabel}
        </button>
        {themes.map((theme, index) => (
          <button
            key={theme.id}
            type="button"
            className={`theme-chip ${selected === theme.id ? "is-selected" : ""}`}
            style={{ "--chip-color": `var(--color-${themeColor(theme, index)})` } as React.CSSProperties}
            onClick={() => setSelected(theme.id)}
          >
            <span className="chip-dot" />
            {theme.name}
          </button>
        ))}
      </div>
    </Field>
  );
}

export function ItemSelect({
  items = [],
  value,
  label = "関連タスク",
}: {
  items?: Item[];
  value?: string | null;
  label?: string;
}) {
  return (
    <Field label={label}>
      <select name={label === "親タスク" ? "parent_item_id" : "item_id"} defaultValue={value || ""}>
        <option value="">未設定</option>
        {items.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
    </Field>
  );
}

export function DrawerHeader({ title, close }: { title: string; close: CloseDrawer }) {
  return (
    <div className="drawer-header">
      <strong>{title}</strong>
      <button onClick={() => close()}>閉じる</button>
    </div>
  );
}

``

### $relative

``tsx
import { useState } from "react";

import { todayIso } from "../../../utils/dataFormat.js";
import type {
  DrawerConfig,
  Item,
  KnowledgeNode,
  Note,
  RemoveEntity,
  SaveEntity,
  WorkspaceData,
} from "../types";
import { CHART_COLORS, KIND_LABELS, KNOWLEDGE_NODE_LABELS, KNOWLEDGE_RELATION_LABELS, LEVEL_LABELS, NOTE_TYPE_LABELS, STATUS_LABELS, THEME_STATUS_LABELS, itemLevel, relatedEntityTitle } from "../lib/domain";
import { dateOnly, formatDate, num, str, uuid } from "../lib/format";
import { DrawerHeader, Field, ItemSelect, StatusBadge, ThemeSelect, type CloseDrawer } from "./common";

const LINK_TYPES = ["chatgpt", "claude", "gemini", "copilot", "github", "paper", "notebook", "document", "other"];
const LINK_TYPE_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  copilot: "Copilot",
  github: "GitHub",
  paper: "論文",
  notebook: "Notebook",
  document: "文書",
  other: "その他",
};
const CHAT_REFERENCE_STATUSES = ["inbox", "keep", "adopted", "pending", "stale"];
const CHAT_REFERENCE_STATUS_LABELS: Record<string, string> = {
  inbox: "未整理",
  keep: "参照",
  adopted: "採用",
  pending: "再確認",
  stale: "古い",
};
const normalizeLinkType = (value: unknown) => LINK_TYPES.includes(str(value)) ? str(value) : "other";
const normalizeReferenceStatus = (value: unknown) => CHAT_REFERENCE_STATUSES.includes(str(value)) ? str(value) : "keep";

function ThemeColorPicker({ value }: { value?: string }) {
  const [selected, setSelected] = useState(value || CHART_COLORS[0]);
  return (
    <Field label="カラー">
      <input type="hidden" name="color" value={selected} />
      <div className="color-swatch-picker">
        {CHART_COLORS.map((key) => (
          <button
            key={key}
            type="button"
            className={`color-swatch ${selected === key ? "is-selected" : ""}`}
            style={{ background: `var(--color-${key})` }}
            onClick={() => setSelected(key)}
          />
        ))}
      </div>
    </Field>
  );
}

function ThemeGroupPicker({ value, themes }: { value?: string; themes: WorkspaceData["themes"] }) {
  const [selected, setSelected] = useState(value || "");
  const groups = [...new Set(themes.map((theme) => str(theme.group).trim()).filter(Boolean))];
  return (
    <Field label="グループ">
      <input name="group" value={selected} onChange={(event) => setSelected(event.target.value)} placeholder="新しいグループ名" />
      {groups.length > 0 && (
        <div className="group-chip-list">
          <button
            type="button"
            className={`theme-chip ${!selected ? "is-selected" : ""}`}
            onClick={() => setSelected("")}
          >
            なし
          </button>
          {groups.map((group) => (
            <button
              key={group}
              type="button"
              className={`theme-chip ${selected === group ? "is-selected" : ""}`}
              onClick={() => setSelected(group)}
            >
              {group}
            </button>
          ))}
        </div>
      )}
    </Field>
  );
}

type SaveForm = (event: React.FormEvent<HTMLFormElement>) => void;

interface EntityDrawerProps {
  drawer: DrawerConfig;
  data: WorkspaceData;
  close: CloseDrawer;
  saveForm: SaveForm;
  removeEntity: RemoveEntity;
  toggleItem: (item: Item) => Promise<void>;
  saveEntity: SaveEntity;
}

export function EntityDrawer({ drawer, data, close, saveForm, removeEntity, toggleItem, saveEntity }: EntityDrawerProps) {
  const entity = drawer.entity || {};
  if (drawer.mode === "edit") return <EditDrawer drawer={drawer} data={data} close={close} saveForm={saveForm} />;
  const type = drawer.type;
  if (type === "item") {
    const item = entity as Item;
    const revisions = (data.plan_revisions || []).filter((revision) => revision.item_id === item.id);
    const relations = (data.relations || []).filter((relation) => relation.source_entity_id === item.id || relation.target_entity_id === item.id);
    const dependencies = (data.dependencys || []).filter((dependency) => dependency.source_item_id === item.id || dependency.target_item_id === item.id);
    return (
      <aside className="drawer">
        <DrawerHeader title="タスク詳細" close={close} />
        <div className="drawer-content">
          <div className="badge-row">
            <StatusBadge value={item.status} label={STATUS_LABELS[item.status ?? ""]} />
          </div>
          <h2>{item.title}</h2>
          <p>{item.description || "説明なし"}</p>
          <dl>
            <dt>種類</dt><dd>{KIND_LABELS[item.kind ?? ""]}</dd>
            <dt>予定</dt><dd>{`${formatDate(item.planned_start)} - ${formatDate(item.planned_end)}`}</dd>
          </dl>
          {(relations.length > 0 || dependencies.length > 0) && (
            <div className="revision-list">
              <h3>関係</h3>
              {dependencies.map((dependency) => (
                <div key={dependency.id}>
                  <span>依存: {(data.items || []).find((entry) => entry.id === dependency.source_item_id)?.title} → {(data.items || []).find((entry) => entry.id === dependency.target_item_id)?.title}</span>
                </div>
              ))}
              {relations.map((relation) => (
                <div key={relation.id}>
                  <span>{relation.relation_type}: {relatedEntityTitle(data, relation.target_entity_type ?? "", relation.target_entity_id)}</span>
                </div>
              ))}
            </div>
          )}
          {revisions.length > 0 && (
            <div className="revision-list">
              <h3>予定変更履歴</h3>
              {revisions.slice(0, 8).map((revision) => (
                <div key={revision.id}>
                  <time>{new Date(revision.changed_at).toLocaleString("ja-JP")}</time>
                  <span>{revision.reason || "理由未記入"}</span>
                </div>
              ))}
            </div>
          )}
          <div className="drawer-actions">
            <button className="secondary-button" onClick={() => close({ type: "item", mode: "edit", entity: item })}>編集する</button>
            <button className="secondary-button" onClick={() => close({ type: "dependency", mode: "edit", entity: { source_item_id: item.id } })}>依存を追加</button>
            <button className="secondary-button" onClick={() => close({ type: "relation", mode: "edit", entity: { source_entity_type: "item", source_entity_id: item.id } })}>関係を追加</button>
            <button className="primary-button" onClick={() => { void toggleItem(item); close(); }}>{item.status === "done" ? "未完了に戻す" : "完了にする"}</button>
            <button className="danger-button" onClick={() => removeEntity("item", item)}>削除する</button>
          </div>
        </div>
      </aside>
    );
  }
  if (type === "note") return <NoteDetailDrawer note={entity as Note} close={close} removeEntity={removeEntity} saveEntity={saveEntity} />;
  if (type === "knowledge_node") return <KnowledgeNodeDetailDrawer node={entity as KnowledgeNode} data={data} close={close} removeEntity={removeEntity} />;
  if (type === "link") {
    return (
      <DetailDrawer
        title="リンク詳細"
        close={close}
        onEdit={() => close({ type: "link", mode: "edit", entity })}
        onDelete={() => removeEntity("link", entity)}
      >
        <div className="badge-row">
          <StatusBadge value="neutral" label={LINK_TYPE_LABELS[normalizeLinkType(entity.link_type)]} />
          <StatusBadge value={normalizeReferenceStatus(entity.reference_status)} label={CHAT_REFERENCE_STATUS_LABELS[normalizeReferenceStatus(entity.reference_status)]} />
          {str(entity.importance) === "high" && <StatusBadge value="review" label="重要" />}
        </div>
        <h2>{str(entity.title)}</h2>
        <a href={str(entity.url)} target="_blank" rel="noreferrer">{str(entity.url)}</a>
        <p>{str(entity.description)}</p>
      </DetailDrawer>
    );
  }
  return <EditDrawer drawer={{ ...drawer, mode: "edit" }} data={data} close={close} saveForm={saveForm} />;
}

function EditDrawer({ drawer, data, close, saveForm }: { drawer: DrawerConfig; data: WorkspaceData; close: CloseDrawer; saveForm: SaveForm }) {
  const type = drawer.type;
  const entity = drawer.entity;
  const typeLabels: Record<string, string> = {
    item: "タスク",
    theme: "Theme",
    note: "メモ",
    link: "リンク",
    status_update: "現在地",
    source_record: "情報源",
    field_definition: "追加項目",
    relation: "関連づけ",
    dependency: "依存",
    knowledge_node: "Knowledge",
    knowledge_relation: "Knowledge Relation",
  };
  const kindLabel = type === "item" && !entity.id ? KIND_LABELS[(entity as Partial<Item>).kind ?? ""] || "タスク" : typeLabels[type] || type;
  const title = `${entity.id ? "編集" : "追加"}: ${kindLabel}`;
  return (
    <aside className="drawer">
      <DrawerHeader title={title} close={close} />
      <form className="drawer-form" data-entity-type={type} onSubmit={saveForm} key={`${type}:${str(entity.id) || "new"}:${str(entity.theme_id)}:${str(entity.parent_item_id)}`}>
        {type === "item" && <ItemFields entity={entity as Partial<Item>} data={data} />}
        {type === "theme" && (
          <>
            <Field label="テーマ名"><input name="name" autoFocus defaultValue={str(entity.name)} /></Field>
            <Field label="概要"><textarea name="description" defaultValue={str(entity.description)} /></Field>
            <Field label="状態"><select name="status" defaultValue={str(entity.status) || "計画中"}><option>計画中</option><option>進行中</option><option>継続</option><option>保留</option><option>完了</option></select></Field>
            <ThemeColorPicker value={str(entity.color)} />
            <ThemeGroupPicker value={str(entity.group)} themes={data.themes} />
          </>
        )}
        {type === "note" && (
          <>
            <Field label="タイトル"><input name="title" autoFocus defaultValue={str(entity.title)} /></Field>
            <ThemeSelect themes={data.themes} value={str(entity.theme_id)} />
            <ItemSelect items={data.items} value={str(entity.item_id)} />
            <Field label="種別"><select name="note_type" defaultValue={str(entity.note_type) || "memo"}>{Object.entries(NOTE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <Field label="参照URL"><input name="source_url" type="url" defaultValue={str(entity.source_url)} /></Field>
            <Field label="本文（Markdown）"><textarea className="large-textarea" name="body_markdown" defaultValue={str(entity.body_markdown)} /></Field>
          </>
        )}
        {type === "link" && (
          <>
            <Field label="タイトル"><input name="title" autoFocus defaultValue={str(entity.title)} /></Field>
            <Field label="URL"><input name="url" type="url" defaultValue={str(entity.url)} /></Field>
            <Field label="種別"><select name="link_type" defaultValue={normalizeLinkType(entity.link_type)}>{LINK_TYPES.map((value) => <option key={value} value={value}>{LINK_TYPE_LABELS[value]}</option>)}</select></Field>
            <ThemeSelect themes={data.themes} value={str(entity.theme_id)} />
            <ItemSelect items={data.items} value={str(entity.item_id)} />
            <div className="form-grid">
              <Field label="参照状態">
                <select name="reference_status" defaultValue={normalizeReferenceStatus(entity.reference_status)}>
                  {CHAT_REFERENCE_STATUSES.map((value) => <option key={value} value={value}>{CHAT_REFERENCE_STATUS_LABELS[value]}</option>)}
                </select>
              </Field>
              <Field label="保存日"><input name="captured_at" type="date" defaultValue={dateOnly(entity.captured_at || entity.created_at)} /></Field>
            </div>
            <label className="toggle priority-toggle"><input name="importance_high" type="checkbox" defaultChecked={str(entity.importance) === "high"} />重要として残す</label>
            <Field label="説明"><textarea name="description" defaultValue={str(entity.description)} /></Field>
          </>
        )}
        {type === "status_update" && (
          <>
            <ThemeSelect themes={data.themes} value={str(entity.theme_id)} />
            <Field label="日付"><input name="date" type="date" defaultValue={str(entity.date) || todayIso()} /></Field>
            <Field label="状態"><select name="status" defaultValue={str(entity.status) || "on_track"}>{Object.entries(THEME_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <Field label="概要"><textarea name="summary" autoFocus defaultValue={str(entity.summary)} /></Field>
            <Field label="進捗"><input name="progress" type="number" min="0" max="100" defaultValue={num(entity.progress)} /></Field>
            <Field label="リスク"><textarea name="risks" defaultValue={str(entity.risks)} /></Field>
            <Field label="次アクション"><textarea name="next_actions" defaultValue={str(entity.next_actions)} /></Field>
          </>
        )}
        {type === "source_record" && (
          <>
            <Field label="種類"><select name="source_type" defaultValue={str(entity.source_type) || "manual"}>{["manual", "chatgpt", "copilot", "outlook", "teams", "email", "calendar", "meeting", "document", "sharepoint", "onedrive", "imported_yaml", "imported_json", "snapshot", "other"].map((value) => <option key={value}>{value}</option>)}</select></Field>
            <Field label="タイトル"><input name="source_title" autoFocus defaultValue={str(entity.source_title)} /></Field>
            <Field label="URL"><input name="source_url" type="url" defaultValue={str(entity.source_url)} /></Field>
            <Field label="要約"><textarea name="summary" defaultValue={str(entity.summary)} /></Field>
            <Field label="原文"><textarea className="large-textarea" name="raw_text" defaultValue={str(entity.raw_text)} /></Field>
          </>
        )}
        {type === "field_definition" && (
          <>
            <Field label="項目名"><input name="name" autoFocus defaultValue={str(entity.name)} /></Field>
            <Field label="型"><select name="field_type" defaultValue={str(entity.field_type) || "text"}>{["text", "long_text", "number", "date", "select", "multi_select", "checkbox", "url", "relation"].map((value) => <option key={value}>{value}</option>)}</select></Field>
            <Field label="対象"><select name="applies_to" defaultValue={str(entity.applies_to) || "item"}><option value="theme">Theme</option><option value="item">タスク</option><option value="note">メモ</option><option value="link">リンク</option></select></Field>
            <ThemeSelect themes={data.themes} value={str(entity.theme_id)} allowAll />
            <Field label="選択肢（カンマ区切り）"><input name="options" defaultValue={((entity.options_json as string[] | undefined) || []).join(", ")} /></Field>
            <label className="toggle"><input name="is_required" type="checkbox" defaultChecked={Boolean(entity.is_required)} />必須</label>
          </>
        )}
        {type === "dependency" && (
          <>
            <Field label="先行タスク"><select name="source_item_id" defaultValue={str(entity.source_item_id)}><option value="">選択</option>{(data.items || []).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
            <Field label="後続タスク"><select name="target_item_id" defaultValue={str(entity.target_item_id)}><option value="">選択</option>{(data.items || []).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
            <p className="field-help">初期実装ではfinish-to-startのみ扱います。</p>
          </>
        )}
        {type === "relation" && <RelationFields entity={entity} data={data} />}
        {type === "knowledge_node" && <KnowledgeNodeFields entity={entity} data={data} />}
        {type === "knowledge_relation" && <KnowledgeRelationFields entity={entity} data={data} />}
        <button className="primary-button" type="submit">保存する</button>
      </form>
    </aside>
  );
}

function ItemFields({ entity, data }: { entity: Partial<Item>; data: WorkspaceData }) {
  const isNew = !entity.id;
  const customDefinitions = (data.field_definitions || []).filter((field) => field.applies_to === "item" && (!field.theme_id || field.theme_id === entity.theme_id));

  if (isNew) {
    return (
      <>
        <Field label="タイトル"><input name="title" autoFocus defaultValue={entity.title ?? ""} /></Field>
        <ThemeSelect themes={data.themes} value={entity.theme_id} allowPersonal />
        <Field label="状態"><select name="status" defaultValue={entity.status || "todo"}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        {(entity.kind === "period" || entity.kind === "milestone") && (
          <Field label="予定開始"><input name="planned_start" type="date" defaultValue={dateOnly(entity.planned_start)} /></Field>
        )}
        <Field label="予定終了"><input name="planned_end" type="date" defaultValue={dateOnly(entity.planned_end)} /></Field>
        <Field label="説明"><textarea name="description" defaultValue={entity.description ?? ""} /></Field>
      </>
    );
  }

  return (
    <>
      <Field label="タイトル"><input name="title" autoFocus defaultValue={entity.title ?? ""} /></Field>
      <ThemeSelect themes={data.themes} value={entity.theme_id} allowPersonal />
      <div className="form-grid">
        <Field label="種類"><select name="kind" defaultValue={entity.kind || "task"}>{Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="レベル"><select name="level" defaultValue={itemLevel(entity as Item)}>{Object.entries(LEVEL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      </div>
      <Field label="状態"><select name="status" defaultValue={entity.status || "todo"}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      <ItemSelect label="親タスク" items={(data.items || []).filter((item) => item.id !== entity.id)} value={entity.parent_item_id} />
      <div className="form-grid">
        <Field label="予定開始"><input name="planned_start" type="date" defaultValue={dateOnly(entity.planned_start)} /></Field>
        <Field label="予定終了"><input name="planned_end" type="date" defaultValue={dateOnly(entity.planned_end)} /></Field>
      </div>
      <label className="toggle priority-toggle"><input name="priority_flag" type="checkbox" defaultChecked={entity.priority === "high"} />旗を付ける</label>
      <Field label="説明"><textarea name="description" defaultValue={entity.description ?? ""} /></Field>
      {customDefinitions.map((definition) => {
        const value = (data.field_values || []).find((entry) => entry.field_definition_id === definition.id && entry.entity_id === entity.id);
        return (
          <Field key={definition.id} label={definition.name}>
            <input
              name={`custom:${definition.id}`}
              type={definition.field_type === "date" ? "date" : definition.field_type === "number" ? "number" : definition.field_type === "url" ? "url" : "text"}
              required={definition.is_required}
              defaultValue={value?.value_text ?? ""}
            />
          </Field>
        );
      })}
      {entity.id && <Field label="予定変更理由（任意）"><textarea name="revision_reason" placeholder="測定結果の受領が遅れたため" /></Field>}
    </>
  );
}

function RelationFields({ entity, data }: { entity: DrawerConfig["entity"]; data: WorkspaceData }) {
  const [targetType, setTargetType] = useState(str(entity.target_entity_type) || "item");
  const collections: Record<string, { id: string; title?: string; source_title?: string; name?: string }[]> = {
    item: data.items || [],
    note: data.notes || [],
    link: data.links || [],
    source_record: data.source_records || [],
  };
  const targets = collections[targetType] || [];
  return (
    <>
      <input type="hidden" name="source_entity_type" value={str(entity.source_entity_type) || "item"} />
      <input type="hidden" name="source_entity_id" value={str(entity.source_entity_id)} />
      <Field label="関係種別"><select name="relation_type" defaultValue={str(entity.relation_type) || "relates_to"}>{["blocks", "blocked_by", "relates_to", "duplicated_by", "follows", "references", "created_from", "evidence_for", "caused_by", "supports"].map((value) => <option key={value}>{value}</option>)}</select></Field>
      <Field label="関係先の種類"><select name="target_entity_type" value={targetType} onChange={(event) => setTargetType(event.target.value)}><option value="item">タスク</option><option value="note">メモ</option><option value="link">リンク</option><option value="source_record">情報源</option></select></Field>
      <Field label="関係先"><select name="target_entity_id" defaultValue={str(entity.target_entity_id)} key={targetType}><option value="">選択</option>{targets.map((target) => <option key={target.id} value={target.id}>{target.title || target.source_title || target.name}</option>)}</select></Field>
      {!targets.length && <p className="field-help">選択できる{targetType}がありません。先に対象を追加してください。</p>}
      <Field label="説明"><textarea name="description" defaultValue={str(entity.description)} /></Field>
    </>
  );
}

function KnowledgeNodeFields({ entity, data }: { entity: DrawerConfig["entity"]; data: WorkspaceData }) {
  return (
    <>
      <Field label="種類">
        <select name="node_type" defaultValue={str(entity.node_type) || "insight"}>
          {Object.entries(KNOWLEDGE_NODE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      <Field label="タイトル"><input name="title" autoFocus defaultValue={str(entity.title)} /></Field>
      <ThemeSelect themes={data.themes} value={str(entity.theme_id)} />
      <div className="form-grid">
        <Field label="確度">
          <select name="confidence" defaultValue={str(entity.confidence) || "medium"}>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </Field>
        <Field label="状態">
          <select name="status" defaultValue={str(entity.status) || "active"}>
            <option value="active">active</option>
            <option value="resolved">resolved</option>
            <option value="deprecated">deprecated</option>
            <option value="rejected">rejected</option>
          </select>
        </Field>
      </div>
      <Field label="本文"><textarea className="large-textarea" name="body" defaultValue={str(entity.body)} /></Field>
      <Field label="元メモ">
        <select name="source_note_id" defaultValue={str(entity.source_note_id)}>
          <option value="">未設定</option>
          {(data.notes || []).map((note) => <option key={note.id} value={note.id}>{note.title}</option>)}
        </select>
      </Field>
      <Field label="元リンク">
        <select name="source_link_id" defaultValue={str(entity.source_link_id)}>
          <option value="">未設定</option>
          {(data.links || []).map((link) => <option key={link.id} value={link.id}>{link.title}</option>)}
        </select>
      </Field>
      <Field label="元タスク">
        <select name="source_item_id" defaultValue={str(entity.source_item_id)}>
          <option value="">未設定</option>
          {(data.items || []).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </Field>
    </>
  );
}

function KnowledgeRelationFields({ entity, data }: { entity: DrawerConfig["entity"]; data: WorkspaceData }) {
  const nodes = data.knowledge_nodes || [];
  return (
    <>
      <Field label="関係元">
        <select name="source_node_id" defaultValue={str(entity.source_node_id)}>
          <option value="">選択</option>
          {nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}
        </select>
      </Field>
      <Field label="関係種別">
        <select name="relation_type" defaultValue={str(entity.relation_type) || "supports"}>
          {Object.entries(KNOWLEDGE_RELATION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      <Field label="関係先">
        <select name="target_node_id" defaultValue={str(entity.target_node_id)}>
          <option value="">選択</option>
          {nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}
        </select>
      </Field>
      <Field label="確度">
        <select name="confidence" defaultValue={str(entity.confidence) || "medium"}>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
      </Field>
      <Field label="説明"><textarea name="description" defaultValue={str(entity.description)} /></Field>
    </>
  );
}

function DetailDrawer({
  title,
  close,
  onEdit,
  onDelete,
  children,
}: {
  title: string;
  close: CloseDrawer;
  onEdit: () => void;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  return (
    <aside className="drawer">
      <DrawerHeader title={title} close={close} />
      <div className="drawer-content">
        {children}
        <div className="drawer-actions">
          <button className="primary-button" onClick={onEdit}>編集する</button>
          <button className="danger-button" onClick={onDelete}>削除する</button>
        </div>
      </div>
    </aside>
  );
}

function NoteDetailDrawer({
  note,
  close,
  removeEntity,
  saveEntity,
}: {
  note: Note;
  close: CloseDrawer;
  removeEntity: RemoveEntity;
  saveEntity: SaveEntity;
}) {
  const [comment, setComment] = useState("");
  const comments = note.comments || [];

  async function addComment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = comment.trim();
    if (!body) return;
    const saved = await saveEntity("note", {
      ...note,
      comments: [...comments, { id: uuid(), body, created_at: new Date().toISOString() }],
    });
    setComment("");
    close({ type: "note", entity: saved });
  }

  async function removeComment(commentId: string) {
    const saved = await saveEntity("note", {
      ...note,
      comments: comments.filter((entry) => entry.id !== commentId),
    });
    close({ type: "note", entity: saved });
  }

  return (
    <aside className="drawer">
      <DrawerHeader title="メモ詳細" close={close} />
      <div className="drawer-content">
        <StatusBadge value="neutral" label={NOTE_TYPE_LABELS[note.note_type ?? ""] || note.note_type} />
        <h2>{note.title}</h2>
        {note.source_url && <div className="link-value"><a href={note.source_url} target="_blank" rel="noreferrer">{note.source_url}</a></div>}
        <p className="note-body">{note.body_markdown}</p>
        <section className="comment-thread">
          <h3>コメント {comments.length > 0 && `(${comments.length})`}</h3>
          {comments.length > 0 && (
            <div className="comment-list">
              {comments.map((entry) => (
                <div className="comment-item" key={entry.id}>
                  <div className="comment-body">{entry.body}</div>
                  <div className="comment-meta">
                    <time>{new Date(entry.created_at).toLocaleString("ja-JP")}</time>
                    <button className="text-button compact" onClick={() => removeComment(entry.id)}>削除する</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <form className="comment-input" onSubmit={addComment}>
            <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="補足や確認事項を残す" aria-label="コメント" />
            <button className="secondary-button compact" type="submit">コメントする</button>
          </form>
        </section>
        <div className="drawer-actions">
          <button
            className="secondary-button"
            onClick={() => close({
              type: "knowledge_node",
              mode: "edit",
              entity: {
                node_type: "insight",
                title: note.title,
                body: note.body_markdown,
                theme_id: note.theme_id || null,
                source_note_id: note.id,
                confidence: "medium",
                status: "active",
              },
            })}
          >
            構造化する
          </button>
          <button className="primary-button" onClick={() => close({ type: "note", mode: "edit", entity: note })}>編集する</button>
          <button className="danger-button" onClick={() => removeEntity("note", note)}>削除する</button>
        </div>
      </div>
    </aside>
  );
}

function KnowledgeNodeDetailDrawer({
  node,
  data,
  close,
  removeEntity,
}: {
  node: KnowledgeNode;
  data: WorkspaceData;
  close: CloseDrawer;
  removeEntity: RemoveEntity;
}) {
  const relations = (data.knowledge_relations || []).filter((relation) => relation.source_node_id === node.id || relation.target_node_id === node.id);
  const sourceNote = data.notes.find((note) => note.id === node.source_note_id);
  return (
    <aside className="drawer">
      <DrawerHeader title="Knowledge詳細" close={close} />
      <div className="drawer-content">
        <div className="badge-row">
          <StatusBadge value={node.status} label={KNOWLEDGE_NODE_LABELS[node.node_type] || node.node_type} />
          <StatusBadge value="neutral" label={node.confidence || "medium"} />
        </div>
        <h2>{node.title}</h2>
        <p className="note-body">{node.body || "本文なし"}</p>
        <dl>
          <dt>Theme</dt><dd>{data.themes.find((theme) => theme.id === node.theme_id)?.name || "未設定"}</dd>
          <dt>元メモ</dt><dd>{sourceNote?.title || "未設定"}</dd>
        </dl>
        {relations.length > 0 && (
          <div className="revision-list">
            <h3>関係</h3>
            {relations.map((relation) => {
              const isSource = relation.source_node_id === node.id;
              const other = data.knowledge_nodes.find((entry) => entry.id === (isSource ? relation.target_node_id : relation.source_node_id));
              return (
                <div key={relation.id}>
                  <span>{isSource ? "→" : "←"} {relation.relation_type}: {other?.title || "不明"}</span>
                </div>
              );
            })}
          </div>
        )}
        <div className="drawer-actions">
          <button className="secondary-button" onClick={() => close({ type: "knowledge_relation", mode: "edit", entity: { source_node_id: node.id } })}>関係を追加</button>
          <button className="primary-button" onClick={() => close({ type: "knowledge_node", mode: "edit", entity: node })}>編集する</button>
          <button className="danger-button" onClick={() => removeEntity("knowledge_node", node)}>削除する</button>
        </div>
      </div>
    </aside>
  );
}

``

### $relative

``tsx
import { useEffect, useRef, useState } from "react";

import type { Dependency, Item } from "../types";
import { DAY, hasPlannedSchedule, itemLevel, statusProgress } from "../lib/domain";
import { daysBetween, localDateIso } from "../lib/format";
import type { GanttRange, TimelineRow } from "../lib/timeline";

export interface SelectedDependency {
  dependency: Dependency;
  sourceTitle: string;
  targetTitle: string;
}

function isInProgressStatus(status?: string): boolean {
  return status === "doing" || status === "進行中";
}

type DragMode = "move" | "start" | "end";

export interface ConnectingState {
  sourceId: string;
  sourceTitle: string;
}

export function GanttItemRow({
  item,
  laneItems,
  range,
  hint,
  onOpen,
  onMove,
  connecting,
  onConnect,
  themeColorKey,
  resolveDropTarget,
  onCtrlClick,
}: {
  item: Item;
  laneItems?: Item[];
  range: GanttRange;
  hint: (item: Item) => string;
  onOpen: (item: Item) => void;
  onMove: (item: Item, delta: number, mode: DragMode, targetParent?: Item | null) => void;
  connecting?: ConnectingState | null;
  onConnect?: (item: Item) => void;
  themeColorKey?: string;
  resolveDropTarget?: (clientY: number) => Item | null | undefined;
  onCtrlClick?: (item: Item) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ itemId: string; mode: DragMode; dxPercent: number } | null>(null);
  const movedRef = useRef(false);
  const total = Math.max(1, daysBetween(range.start, range.end));
  const bars = laneItems?.length ? laneItems : [item];

  function beginDrag(event: React.PointerEvent, target: Item, mode: DragMode) {
    event.preventDefault();
    event.stopPropagation();
    const initialX = event.clientX;
    const initialY = event.clientY;
    const trackWidth = rowRef.current?.clientWidth || 1;
    movedRef.current = false;
    const onPointerMove = (moveEvent: PointerEvent) => {
      const dxPercent = ((moveEvent.clientX - initialX) / trackWidth) * 100;
      if (Math.abs(dxPercent) > 0.5 || Math.abs(moveEvent.clientY - initialY) > 6) movedRef.current = true;
      setDrag({ itemId: target.id, mode, dxPercent });
    };
    const cleanup = () => {
      removeEventListener("pointermove", onPointerMove);
      removeEventListener("pointerup", onPointerUp);
      removeEventListener("pointercancel", onPointerCancel);
      setDrag(null);
    };
    const onPointerUp = (upEvent: PointerEvent) => {
      cleanup();
      const delta = Math.round(((upEvent.clientX - initialX) / trackWidth) * total);
      const targetParent = resolveDropTarget?.(upEvent.clientY);
      if (delta || targetParent !== undefined) onMove(target, delta, mode, targetParent);
    };
    const onPointerCancel = () => {
      // キャンセル時は確定せず、プレビューだけ戻す（既存データを壊さない）。
      cleanup();
      movedRef.current = false;
    };
    addEventListener("pointermove", onPointerMove);
    addEventListener("pointerup", onPointerUp);
    addEventListener("pointercancel", onPointerCancel);
  }

  const isConnecting = !!connecting;

  function handleClick(target: Item, event?: React.MouseEvent) {
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }
    if ((event?.ctrlKey || event?.metaKey) && onCtrlClick) {
      onCtrlClick(target);
      return;
    }
    if (isConnecting && onConnect) {
      onConnect(target);
      return;
    }
    onOpen(target);
  }

  return (
    <div className={`gantt-item-row level-${itemLevel(item)}`} ref={rowRef}>
      {bars.map((barItem) => {
        const level = itemLevel(barItem);
        const start = barItem.planned_start || barItem.planned_end;
        const end = barItem.planned_end || start;
        const left = start ? Math.max(0, Math.min(100, (daysBetween(range.start, start) / total) * 100)) : 0;
        const width = start
          ? Math.max(barItem.kind === "milestone" ? 0.8 : 1.4, Math.min(100 - left, ((daysBetween(start, end || start) + 1) / total) * 100))
          : 0;
        let displayLeft = left;
        let displayWidth = width;
        if (drag?.itemId === barItem.id) {
          if (drag.mode === "move") displayLeft = left + drag.dxPercent;
          else if (drag.mode === "start") { displayLeft = left + drag.dxPercent; displayWidth = width - drag.dxPercent; }
          else displayWidth = width + drag.dxPercent;
          displayWidth = Math.max(0.6, displayWidth);
        }
        const isSource = !!connecting?.sourceId && connecting.sourceId === barItem.id;
        const barClass = [
          `gantt-item-bar level-${level}`,
          bars.length > 1 ? "in-lane" : "",
          barItem.kind === "milestone" ? "milestone" : "",
          drag?.itemId === barItem.id ? "is-dragging" : "",
          isSource ? "is-connect-source" : "",
          isConnecting && !isSource ? "is-connect-target" : "",
        ].filter(Boolean).join(" ");
        return hasPlannedSchedule(barItem) && start ? (
          <button
            className={barClass}
            key={barItem.id}
            style={{ left: `${displayLeft}%`, width: `${displayWidth}%`, "--bar-color": themeColorKey ? `var(--color-${themeColorKey})` : undefined } as React.CSSProperties}
            onClick={(e) => handleClick(barItem, e)}
            onPointerDown={isConnecting ? undefined : (event) => beginDrag(event, barItem, "move")}
            title={isConnecting ? (isSource ? `${barItem.title}（選択中）` : `${barItem.title} を後続にする`) : `${hint(barItem)}\nCtrl+クリックで依存を接続`}
          >
            {barItem.kind !== "milestone" && !isConnecting && <span className="resize-handle start" onPointerDown={(event) => beginDrag(event, barItem, "start")} />}
            <span>{barItem.kind === "milestone" ? "◆" : barItem.title}</span>
            {barItem.kind !== "milestone" && !isConnecting && <span className="resize-handle end" onPointerDown={(event) => beginDrag(event, barItem, "end")} />}
          </button>
        ) : null;
      })}
    </div>
  );
}

export function TimeAxis({ start, end, dayWidth }: { start: string; end: string; dayWidth: number }) {
  if (dayWidth >= 16) {
    const blocks: string[] = [];
    const cursor = new Date(`${start}T00:00:00`);
    const last = new Date(`${end}T00:00:00`);
    const step = dayWidth >= 36 ? 7 : 14;
    const dow = cursor.getDay();
    cursor.setTime(cursor.getTime() + ((dow === 0 ? 1 : 8 - dow) % 7) * DAY);
    while (cursor <= last && blocks.length < 400) {
      blocks.push(localDateIso(cursor));
      cursor.setTime(cursor.getTime() + step * DAY);
    }
    return (
      <div className="gantt-axis" style={{ gridTemplateColumns: `repeat(${blocks.length}, 1fr)` }}>
        {blocks.map((value) => <span key={value}>{value.slice(5)}</span>)}
      </div>
    );
  }
  const blocks: { label: string; days: number }[] = [];
  let cursor = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  while (cursor < endDate && blocks.length < 200) {
    const nextMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    const segmentEnd = nextMonth <= endDate ? nextMonth : endDate;
    const days = Math.round((segmentEnd.getTime() - cursor.getTime()) / DAY);
    if (days > 0) blocks.push({ label: localDateIso(cursor).slice(0, 7), days });
    cursor = nextMonth;
  }
  return (
    <div className="gantt-axis" style={{ gridTemplateColumns: blocks.map((b) => `${b.days}fr`).join(" ") }}>
      {blocks.map((b) => <span key={b.label}>{b.label}</span>)}
    </div>
  );
}

function milestoneDate(item: Item): string {
  return String(item.planned_end || item.due_date || item.planned_start || "");
}

function milestoneLabel(item: Item, dayWidth: number): string {
  if (dayWidth < 6) return item.title.length > 10 ? `${item.title.slice(0, 10)}...` : item.title;
  return item.title;
}

export function MilestoneLane({
  milestones,
  range,
  dayWidth,
  hint,
  onOpen,
  onMove,
  themeColorKey,
}: {
  milestones: Item[];
  range: GanttRange;
  dayWidth: number;
  hint: (item: Item) => string;
  onOpen: (item: Item) => void;
  onMove?: (item: Item, delta: number) => void;
  themeColorKey?: string;
}) {
  const laneRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ itemId: string; dxPercent: number } | null>(null);
  const movedRef = useRef(false);
  const total = Math.max(1, daysBetween(range.start, range.end));

  function beginDrag(event: React.PointerEvent, target: Item) {
    if (!onMove) return;
    event.preventDefault();
    event.stopPropagation();
    const initialX = event.clientX;
    const trackWidth = laneRef.current?.clientWidth || 1;
    movedRef.current = false;
    const onPointerMove = (moveEvent: PointerEvent) => {
      const dxPercent = ((moveEvent.clientX - initialX) / trackWidth) * 100;
      if (Math.abs(dxPercent) > 0.5) movedRef.current = true;
      setDrag({ itemId: target.id, dxPercent });
    };
    const cleanup = () => {
      removeEventListener("pointermove", onPointerMove);
      removeEventListener("pointerup", onPointerUp);
      removeEventListener("pointercancel", onPointerCancel);
      setDrag(null);
    };
    const onPointerUp = (upEvent: PointerEvent) => {
      cleanup();
      const delta = Math.round(((upEvent.clientX - initialX) / trackWidth) * total);
      if (delta) onMove(target, delta);
    };
    const onPointerCancel = () => {
      cleanup();
      movedRef.current = false;
    };
    addEventListener("pointermove", onPointerMove);
    addEventListener("pointerup", onPointerUp);
    addEventListener("pointercancel", onPointerCancel);
  }

  const byMonth = new Map<string, Item[]>();
  for (const milestone of milestones) {
    const date = milestoneDate(milestone);
    if (!date) continue;
    const key = date.slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) || []), milestone]);
  }
  const marks = [...byMonth.entries()].flatMap(([month, entries]) => {
    if (entries.length >= 3) return [{ id: month, items: entries, date: `${month}-15` }];
    return entries.map((item) => ({ id: item.id, items: [item], date: milestoneDate(item) }));
  });

  return (
    <div className="gantt-milestone-lane" ref={laneRef}>
      {marks.map((mark) => {
        const baseLeft = Math.max(0, Math.min(100, (daysBetween(range.start, mark.date) / total) * 100));
        const first = mark.items[0];
        const clustered = mark.items.length > 1;
        const isDragging = !clustered && drag?.itemId === first.id;
        const displayLeft = isDragging ? baseLeft + drag!.dxPercent : baseLeft;
        const title = clustered
          ? mark.items.map((item) => `${milestoneDate(item)} ${item.title}`).join("\n")
          : hint(first);
        return (
          <button
            className={`milestone-lane-mark ${clustered ? "is-cluster" : ""} ${isDragging ? "is-dragging" : ""}`}
            key={mark.id}
            style={{ left: `${displayLeft}%`, "--bar-color": themeColorKey ? `var(--color-${themeColorKey})` : undefined } as React.CSSProperties}
            onClick={() => { if (!movedRef.current) onOpen(first); movedRef.current = false; }}
            onPointerDown={clustered ? undefined : (event) => beginDrag(event, first)}
            title={title}
          >
            <span>{clustered ? `◆${mark.items.length}` : "◆"}</span>
            <small>{clustered ? mark.id : milestoneLabel(first, dayWidth)}</small>
          </button>
        );
      })}
    </div>
  );
}

type ItemRow = Extract<TimelineRow, { rowType: "item" }>;

export function DependencyOverlay({
  dependencies,
  rows,
  range,
  selected,
  onSelect,
}: {
  dependencies: Dependency[];
  rows: TimelineRow[];
  range: GanttRange;
  selected?: SelectedDependency | null;
  onSelect?: (sel: SelectedDependency | null) => void;
}) {
  const total = Math.max(1, daysBetween(range.start, range.end));
  const ROW_H = 44;
  const rowIndexOf = (id?: string) => rows.findIndex((row) => row.rowType === "item" && (row.item.id === id || row.laneItems.some((item) => item.id === id)));
  const lines = dependencies.flatMap((dependency) => {
    const sourceIndex = rowIndexOf(dependency.source_item_id);
    const targetIndex = rowIndexOf(dependency.target_item_id);
    if (sourceIndex < 0 || targetIndex < 0) return [];
    const sourceRow = rows[sourceIndex] as ItemRow;
    const targetRow = rows[targetIndex] as ItemRow;
    const source = sourceRow.item.id === dependency.source_item_id ? sourceRow.item : sourceRow.laneItems.find((item) => item.id === dependency.source_item_id) || sourceRow.item;
    const target = targetRow.item.id === dependency.target_item_id ? targetRow.item : targetRow.laneItems.find((item) => item.id === dependency.target_item_id) || targetRow.item;
    const sourceDate = source.planned_end;
    const targetDate = target.planned_start || target.planned_end;
    if (!sourceDate || !targetDate) return [];
    const sourceX = Math.max(0, Math.min(100, ((daysBetween(range.start, sourceDate) + 1) / total) * 100));
    const targetX = Math.max(0, Math.min(100, (daysBetween(range.start, targetDate) / total) * 100));
    const sourceY = sourceIndex * ROW_H + ROW_H / 2;
    const targetY = targetIndex * ROW_H + ROW_H / 2;
    const bendX = Math.max(sourceX + 1.5, (sourceX + targetX) / 2);
    return [{ id: dependency.id, sourceX, sourceY, targetX, targetY, bendX, sourceTitle: source.title, targetTitle: target.title, dependency }];
  });
  if (!lines.length) return null;
  const height = rows.length * ROW_H;
  return (
    <svg className="dependency-overlay" viewBox={`0 0 100 ${height}`} style={{ height }} preserveAspectRatio="none">
      <defs>
        <marker id="dependency-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 Z" />
        </marker>
        <marker id="dependency-arrow-selected" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 Z" className="dep-selected-marker" />
        </marker>
      </defs>
      {lines.map((line) => {
        const isSelected = selected?.dependency.id === line.id;
        const d = `M ${line.sourceX} ${line.sourceY} H ${line.bendX} V ${line.targetY} H ${line.targetX}`;
        return (
          <g key={line.id}>
            {/* 太めの透明ヒットエリア */}
            <path
              d={d}
              className="dep-hit-area"
              onClick={(event) => {
                event.stopPropagation();
                onSelect?.(isSelected ? null : { dependency: line.dependency, sourceTitle: line.sourceTitle, targetTitle: line.targetTitle });
              }}
            >
              <title>{`${line.sourceTitle} → ${line.targetTitle}`}</title>
            </path>
            <path
              d={d}
              className={isSelected ? "dep-line dep-line-selected" : "dep-line"}
              markerEnd={isSelected ? "url(#dependency-arrow-selected)" : "url(#dependency-arrow)"}
            />
          </g>
        );
      })}
    </svg>
  );
}

export function LightningOverlay({
  rows,
  range,
  today,
}: {
  rows: TimelineRow[];
  range: GanttRange;
  today: string;
}) {
  const totalDays = Math.max(1, daysBetween(range.start, range.end));
  const todayX = (daysBetween(range.start, today) / totalDays) * 100;
  const points = rows.flatMap((row, index) => {
    if (row.rowType !== "item") return [];
    const item = row.laneItems[0] || row.item;
    const start = item.planned_start || item.planned_end;
    const end = item.planned_end || start;
    if (!start || !end || !hasPlannedSchedule(item)) return [];
    const duration = Math.max(1, daysBetween(start, end) + 1);
    const elapsed = Math.max(0, Math.min(duration, daysBetween(start, today) + 1));
    const plannedProgress = elapsed / duration;
    const actualProgress = isInProgressStatus(item.status) ? plannedProgress : statusProgress(item.status);
    const varianceDays = (actualProgress - plannedProgress) * duration;
    const x = Math.max(0, Math.min(100, todayX + (varianceDays / totalDays) * 100));
    return [{ x, y: 44 + index * 44 + 22, varianceDays }];
  });
  if (!points.length) return null;
  const height = Math.max(88, rows.length * 44 + 44);
  const path = points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  return (
    <svg className="lightning-overlay" viewBox={`0 0 100 ${height}`} style={{ height }} preserveAspectRatio="none" aria-label="計画進捗と実進捗の差分">
      <path d={path} />
    </svg>
  );
}

``

### $relative

``tsx
import { crossNavigation, toolNavigation } from "../../../pages/routes";
import { todayIso } from "../../../utils/dataFormat.js";
import type { Item, OpenDrawer, Theme } from "../types";
import { themeColor } from "../lib/domain";

export function AppState({ state, message, onRetry }: { state: "loading" | "error"; message?: string; onRetry?: () => void }) {
  return (
    <main className="standalone-state">
      <div className={`state-box ${state}`}>
        {state === "loading" ? (
          <><span className="spinner" /><strong>作業台を読み込んでいます</strong></>
        ) : (
          <>
            <strong>作業台を読み込めませんでした</strong>
            <span>{message} アプリを再起動するか、もう一度試してください。</span>
            <button className="primary-button" onClick={onRetry}>再試行する</button>
          </>
        )}
      </div>
    </main>
  );
}

interface SidebarProps {
  route: string;
  navigate: (next: string) => void;
  themes: Theme[];
  activeThemeId: string;
  setActiveThemeId: (id: string) => void;
  items: Item[];
  openDrawer: OpenDrawer;
}

export function Sidebar({
  route,
  navigate,
  themes,
  activeThemeId,
  setActiveThemeId,
  items,
  openDrawer,
}: SidebarProps) {
  const inbox = items.filter((item) => item.status === "inbox").length;
  const today = todayIso();
  const todayCount = items.filter((item) => item.status !== "done" && (item.today_flag || item.planned_end === today)).length;
  const waiting = items.filter((item) => item.status === "waiting" || item.kind === "waiting").length;
  return (
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">T</span><div><strong>Tasken</strong></div></div>
      <nav className="primary-nav" aria-label="横断ビュー">
        <div className="nav-heading"><span>横断</span></div>
        {crossNavigation.map(([id, label]) => (
          <button key={id} className={route === id ? "is-active" : ""} aria-current={route === id ? "page" : undefined} onClick={() => navigate(id)}>
            <span>{label}</span>
            {id === "today" && todayCount > 0 && <span className="count">{todayCount}</span>}
            {id === "inbox" && inbox > 0 && <span className="count">{inbox}</span>}
            {id === "waiting" && waiting > 0 && <span className="count">{waiting}</span>}
          </button>
        ))}
      </nav>
      <div className="theme-nav">
        <div className="nav-heading"><span>テーマ別</span><button onClick={() => openDrawer({ type: "theme", mode: "edit", entity: {} })}>＋ 追加</button></div>
        <button className={`theme-nav-all ${route === "themes" ? "is-active" : ""}`} aria-current={route === "themes" ? "page" : undefined} onClick={() => navigate("themes")}>
          <span>すべてのテーマ</span><span className="count">{themes.length}</span>
        </button>
        {themes.map((theme, index) => {
          const current = route === "home" && theme.id === activeThemeId;
          return (
            <button key={theme.id} className={current ? "is-active" : ""} aria-current={current ? "page" : undefined} onClick={() => { setActiveThemeId(theme.id); navigate("home"); }}>
              <span className="theme-dot" style={{ background: `var(--color-${themeColor(theme, index)})` }} /><span>{theme.name}</span>
            </button>
          );
        })}
      </div>
      <nav className="primary-nav utility-nav" aria-label="ツール">
        <div className="nav-heading"><span>ツール</span></div>
        {toolNavigation.map(([id, label]) => (
          <button key={id} className={route === id ? "is-active" : ""} aria-current={route === id ? "page" : undefined} onClick={() => navigate(id)}>
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

export function ShortcutDialog({ close }: { close: () => void }) {
  return (
    <div className="shortcut-overlay" onClick={close}>
      <div className="shortcut-dialog" role="dialog" aria-label="キーボードショートカット" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header"><strong>キーボードショートカット</strong><button onClick={close}>閉じる</button></div>
        <dl className="shortcut-list">
          <dt><kbd>?</kbd></dt><dd>この一覧を表示</dd>
          <dt><kbd>Alt</kbd>+<kbd>N</kbd></dt><dd>タスクを追加</dd>
          <dt><kbd>Ctrl</kbd>+<kbd>K</kbd></dt><dd>検索へ移動</dd>
          <dt><kbd>Esc</kbd></dt><dd>パネルを閉じる</dd>
        </dl>
      </div>
    </div>
  );
}

``

### $relative

``javascript
const MAX_IMPORT_BYTES = 1024 * 1024;
const PAYLOAD_KEYS = new Set(["items", "notes", "links", "knowledge_nodes", "knowledge_relations"]);
const ITEM_KINDS = new Set(["task", "milestone", "period", "waiting", "reminder", "idea"]);
const ITEM_STATUSES = new Set(["todo", "doing", "waiting", "review", "done", "inbox"]);
const PRIORITIES = new Set(["normal", "high"]);
const NOTE_TYPES = new Set(["memo", "decision", "meeting", "experiment", "analysis", "ai_chat", "learning", "reflection"]);
const LINK_TYPES = new Set(["chatgpt", "copilot", "github", "paper", "notebook", "document", "other"]);
const ALLOWED_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);
const KNOWLEDGE_NODE_TYPES = new Set(["source", "evidence", "claim", "question", "decision", "insight"]);
const KNOWLEDGE_RELATION_TYPES = new Set(["supports", "contradicts", "explains", "causes", "example_of", "generalizes", "depends_on", "derived_from", "answers", "raises", "similar_to", "leads_to"]);
const CONFIDENCE = new Set(["low", "medium", "high"]);
const KNOWLEDGE_STATUSES = new Set(["active", "resolved", "deprecated", "rejected"]);

export function isAllowedImportUrl(value) {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(String(value)).protocol);
  } catch {
    return false;
  }
}

export function isIsoLocalDate(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function nullableDate(value, issues, field) {
  if (value == null || value === "") return null;
  const normalized = text(value);
  if (!isIsoLocalDate(normalized)) {
    issues.push(`${field}はYYYY-MM-DDまたはnullにしてください`);
    return null;
  }
  return normalized;
}

function enumValue(value, allowed, fallback, issues, field) {
  const normalized = text(value);
  if (!normalized) return fallback;
  if (!allowed.has(normalized)) {
    issues.push(`${field}が不正です`);
    return fallback;
  }
  return normalized;
}

function resolveTheme(themeValue, themes) {
  const normalized = text(themeValue);
  if (!normalized) return undefined;
  return themes.find((theme) => theme.id === normalized || theme.name === normalized);
}

function normalizeArray(payload, key) {
  const value = payload[key];
  if (value == null) return [];
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)) : [];
}

export function parseAiImportPayload(raw, themes, collections) {
  const size = new Blob([raw]).size;
  if (size > MAX_IMPORT_BYTES) throw new Error("Import本文が大きすぎます。1MB以下にしてください。");
  const payload = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("JSON objectを入力してください。");
  }

  const payloadIssues = Object.keys(payload)
    .filter((key) => !PAYLOAD_KEYS.has(key))
    .map((key) => `${key}はAI Import対象外のため無視します`);
  const candidates = [
    ...normalizeArray(payload, "items").map((entry) => normalizeItem(entry, themes, collections.items || [])),
    ...normalizeArray(payload, "notes").map((entry) => normalizeNote(entry, themes, collections.notes || [])),
    ...normalizeArray(payload, "links").map((entry) => normalizeLink(entry, themes, collections.links || [])),
    ...normalizeArray(payload, "knowledge_nodes").map((entry, index) => normalizeKnowledgeNode(entry, index, themes, collections.knowledge_nodes || [])),
  ];
  candidates.push(...normalizeArray(payload, "knowledge_relations").map((entry) =>
    normalizeKnowledgeRelation(entry, candidates, collections.knowledge_nodes || [], collections.knowledge_relations || [])));
  if (!candidates.length) throw new Error("items、notes、links、knowledge_nodes、knowledge_relationsのいずれかを含めてください。");
  return { candidates, payloadIssues };
}

function findDuplicate(collection, title) {
  const normalized = text(title).toLowerCase();
  if (!normalized) return undefined;
  return collection.find((entry) => text(entry.title).toLowerCase() === normalized);
}

function candidateBase(type, entry, themes, collection) {
  const issues = [];
  const title = text(entry.title);
  const theme = resolveTheme(entry.theme, themes);
  const duplicate = findDuplicate(collection, title);
  if (!title) issues.push("titleがありません");
  if (text(entry.theme) && !theme) issues.push("Themeを解決できません");
  if (duplicate && ["done", "archived"].includes(text(duplicate.status))) {
    issues.push("完了済みまたはarchivedの既存候補への更新です");
  }
  return { type, theme, duplicate, issues };
}

function normalizeItem(entry, themes, collection) {
  const base = candidateBase("item", entry, themes, collection);
  const normalized = {
    title: text(entry.title),
    theme: text(entry.theme),
    kind: enumValue(entry.kind, ITEM_KINDS, "task", base.issues, "kind"),
    status: enumValue(entry.status, ITEM_STATUSES, "todo", base.issues, "status"),
    priority: enumValue(entry.priority, PRIORITIES, "normal", base.issues, "priority"),
    planned_start: nullableDate(entry.planned_start, base.issues, "planned_start"),
    planned_end: nullableDate(entry.planned_end, base.issues, "planned_end"),
    description: text(entry.description),
  };
  return finishCandidate(base, normalized);
}

function normalizeNote(entry, themes, collection) {
  const base = candidateBase("note", entry, themes, collection);
  const sourceUrl = text(entry.source_url);
  if (!text(entry.body)) base.issues.push("bodyがありません");
  if (sourceUrl && !isAllowedImportUrl(sourceUrl)) base.issues.push("source_urlはhttps、http、mailtoのみ使えます");
  const normalized = {
    title: text(entry.title),
    theme: text(entry.theme),
    note_type: enumValue(entry.note_type, NOTE_TYPES, "memo", base.issues, "note_type"),
    body: text(entry.body),
    source_url: sourceUrl,
  };
  return finishCandidate(base, normalized);
}

function normalizeLink(entry, themes, collection) {
  const base = candidateBase("link", entry, themes, collection);
  const url = text(entry.url);
  if (!url) base.issues.push("urlがありません");
  else if (!isAllowedImportUrl(url)) base.issues.push("urlはhttps、http、mailtoのみ使えます");
  const normalized = {
    title: text(entry.title),
    url,
    link_type: enumValue(entry.link_type, LINK_TYPES, "other", base.issues, "link_type"),
    theme: text(entry.theme),
    description: text(entry.description),
  };
  return finishCandidate(base, normalized);
}

function normalizeKnowledgeNode(entry, index, themes, collection) {
  const base = candidateBase("knowledge_node", entry, themes, collection);
  const normalized = {
    temp_id: text(entry.temp_id) || `knowledge_node_${index + 1}`,
    node_type: enumValue(entry.node_type, KNOWLEDGE_NODE_TYPES, "insight", base.issues, "node_type"),
    title: text(entry.title),
    body: text(entry.body),
    theme: text(entry.theme),
    source_note_id: text(entry.source_note_id),
    source_link_id: text(entry.source_link_id),
    source_item_id: text(entry.source_item_id),
    confidence: enumValue(entry.confidence, CONFIDENCE, "medium", base.issues, "confidence"),
    status: enumValue(entry.status, KNOWLEDGE_STATUSES, "active", base.issues, "status"),
  };
  if (normalized.title.length > 200) base.issues.push("titleは200文字以内にしてください");
  if (normalized.body.length > 20000) base.issues.push("bodyは20000文字以内にしてください");
  return finishCandidate(base, normalized);
}

function normalizeKnowledgeRelation(entry, nodeCandidates, nodes, collection) {
  const issues = [];
  const relationType = enumValue(entry.relation_type, KNOWLEDGE_RELATION_TYPES, "supports", issues, "relation_type");
  const sourceTempId = text(entry.source_temp_id);
  const targetTempId = text(entry.target_temp_id);
  const sourceNodeId = text(entry.source_node_id);
  const targetNodeId = text(entry.target_node_id);
  const sourceKnown = Boolean(sourceNodeId && nodes.some((node) => node.id === sourceNodeId));
  const targetKnown = Boolean(targetNodeId && nodes.some((node) => node.id === targetNodeId));
  const sourceCandidate = sourceTempId && nodeCandidates.some((candidate) => candidate.type === "knowledge_node" && candidate.entry.temp_id === sourceTempId);
  const targetCandidate = targetTempId && nodeCandidates.some((candidate) => candidate.type === "knowledge_node" && candidate.entry.temp_id === targetTempId);
  if (!sourceKnown && !sourceCandidate) issues.push("source_temp_idまたはsource_node_idを解決できません");
  if (!targetKnown && !targetCandidate) issues.push("target_temp_idまたはtarget_node_idを解決できません");
  if ((sourceNodeId && sourceNodeId === targetNodeId) || (sourceTempId && sourceTempId === targetTempId)) {
    issues.push("relationの自己参照はできません");
  }
  const normalized = {
    source_temp_id: sourceTempId,
    target_temp_id: targetTempId,
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
    relation_type: relationType,
    description: text(entry.description),
    confidence: enumValue(entry.confidence, CONFIDENCE, "medium", issues, "confidence"),
  };
  return finishCandidate({ type: "knowledge_relation", duplicate: findDuplicateRelation(collection, normalized), issues }, normalized);
}

function findDuplicateRelation(collection, entry) {
  return collection.find((relation) =>
    relation.source_node_id === entry.source_node_id
    && relation.target_node_id === entry.target_node_id
    && relation.relation_type === entry.relation_type);
}

function finishCandidate(base, entry) {
  return {
    ...base,
    entry,
    action: base.issues.length ? "ignore" : base.duplicate ? "merge" : "create",
    sourceRecordTitle: "貼り付けAI出力",
  };
}

export function assertImportCandidateSavable(candidate) {
  if (candidate.action === "ignore") return;
  if (candidate.issues?.length) {
    throw new Error(`確認事項が残っている候補は保存できません: ${candidate.issues.join(" / ")}`);
  }
  if (candidate.action === "merge" && !candidate.duplicate) {
    throw new Error("既存候補がないためmergeできません。");
  }
  if (!["create", "merge", "ignore"].includes(candidate.action)) {
    throw new Error("AI Importの取り込み操作が不正です。");
  }
}

export function buildAiImportPrompt(themeNames, aiContextMarkdown) {
  return `あなたは Tasken に取り込むための構造化データを作成します。
以下の作業文脈を読み、JSONだけを返してください。
説明文、Markdownコードブロック、コメントは禁止です。

出力形式:
{
  "items": [
    {
      "title": "string 必須",
      "theme": "既存Theme名。分からなければ空文字",
      "kind": "task | milestone | period | waiting | reminder | idea",
      "status": "todo | doing | waiting | review | done | inbox",
      "priority": "normal | high",
      "planned_start": "YYYY-MM-DD または null",
      "planned_end": "YYYY-MM-DD または null",
      "description": "string"
    }
  ],
  "notes": [
    {
      "title": "string 必須",
      "theme": "既存Theme名。分からなければ空文字",
      "note_type": "memo | decision | meeting | experiment | analysis | ai_chat | learning | reflection",
      "body": "string 必須",
      "source_url": "https/http URL または空文字"
    }
  ],
  "links": [
    {
      "title": "string 必須",
      "url": "https/http/mailto URL",
      "link_type": "chatgpt | copilot | github | paper | notebook | document | other",
      "theme": "既存Theme名。分からなければ空文字",
      "description": "string"
    }
  ],
  "knowledge_nodes": [
    {
      "temp_id": "node-1",
      "node_type": "source | evidence | claim | question | decision | insight",
      "title": "string 必須",
      "body": "string",
      "theme": "既存Theme名。分からなければ空文字",
      "confidence": "low | medium | high",
      "status": "active | resolved | deprecated | rejected"
    }
  ],
  "knowledge_relations": [
    {
      "source_temp_id": "node-1",
      "target_temp_id": "node-2",
      "relation_type": "supports | contradicts | explains | causes | example_of | generalizes | depends_on | derived_from | answers | raises | similar_to | leads_to",
      "description": "string",
      "confidence": "low | medium | high"
    }
  ]
}

ルール:
- JSONだけを返す
- 存在しないThemeは作らない
- Themeが不明なら空文字にする
- 日付が曖昧なら null
- 依存関係や親子関係は作らない
- Knowledge Relationは同じ出力内のknowledge_nodesをtemp_idで参照する
- 完了済みへの更新は避ける
- 推測しすぎず、候補として安全に出す
- ユーザーがTasken上で確認してから保存する前提

既存Theme:
${themeNames || "なし"}

作業文脈:
${aiContextMarkdown || "なし"}`;
}

``

### $relative

``typescript
import type { BaseRecord, Item, Theme, WorkspaceData } from "../types";

export const DAY = 86400000;

export const STATUS_LABELS: Record<string, string> = {
  inbox: "Inbox",
  todo: "未着手",
  doing: "進行中",
  waiting: "待ち",
  review: "確認待ち",
  done: "完了",
  archived: "保留",
  cancelled: "中止",
};

export const KIND_LABELS: Record<string, string> = {
  task: "タスク",
  milestone: "マイルストーン",
  period: "期間予定",
  event: "イベント",
  waiting: "待ち",
  deliverable: "成果物",
  reminder: "備忘",
  idea: "アイデア",
};

export const THEME_STATUS_LABELS: Record<string, string> = {
  on_track: "順調",
  at_risk: "注意",
  delayed: "遅延",
  paused: "保留",
  completed: "完了",
};

export const NOTE_TYPE_LABELS: Record<string, string> = {
  memo: "メモ",
  decision: "意思決定",
  meeting: "会議メモ",
  experiment: "実験記録",
  analysis: "分析",
  ai_chat: "AI対話",
  learning: "学習",
  reflection: "振り返り",
};

export const KNOWLEDGE_NODE_LABELS: Record<string, string> = {
  source: "Source",
  evidence: "Evidence",
  claim: "Claim",
  question: "Question",
  decision: "Decision",
  insight: "Insight",
};

export const KNOWLEDGE_RELATION_LABELS: Record<string, string> = {
  supports: "supports",
  contradicts: "contradicts",
  explains: "explains",
  causes: "causes",
  example_of: "example_of",
  generalizes: "generalizes",
  depends_on: "depends_on",
  derived_from: "derived_from",
  answers: "answers",
  raises: "raises",
  similar_to: "similar_to",
  leads_to: "leads_to",
};

// レベル（粒度）。Timelineに出す「大きな線」と、ToDo中心の「細かい仕事」を区別する。
// kindとは直交。period/milestoneは既定でplan、それ以外はtask。明示値があればそれを優先。
export const PLAN_KINDS = ["period", "milestone"];
export const LEVEL_LABELS: Record<string, string> = { plan: "計画（大きな線）", task: "タスク" };
export const defaultLevel = (kind?: string): string => (kind && PLAN_KINDS.includes(kind) ? "plan" : "task");
export const itemLevel = (item: Item): string => item.level || defaultLevel(item.kind);
export const hasPlannedSchedule = (item: Pick<Item, "planned_start" | "planned_end">): boolean =>
  Boolean(item.planned_start || item.planned_end);

// 進捗率は廃止し、状態（未着手/進行中/完了）から到達度を導く。イナズマ線はこの値で描く。
export function statusProgress(status?: string): number {
  switch (status) {
    case "done": case "completed": case "完了":
      return 1;
    case "doing": case "review": case "進行中": case "確認待ち":
      return 0.5;
    default:
      return 0;
  }
}

// ワークフロー状態 → 状態色トーン（tokens.css の status パレット）。
// 能動的な状態（進行中）を前に、終端（完了・中止）を後退させる。未着手・分類タグは idle（中立）。
export function statusTone(status?: string): string {
  switch (status) {
    case "done": case "completed": case "on_track": case "adopted": case "完了":
      return "done";
    case "doing": case "進行中":
      return "active";
    case "review": case "pending": case "確認待ち":
      return "review";
    case "waiting": case "at_risk": case "paused": case "待ち": case "保留":
      return "blocked";
    case "delayed": case "open":
      return "danger"; // 遅延・未解決など明確な問題系のみ警告の赤
    case "cancelled": case "stale": case "中止":
      return "dropped";
    default:
      return "idle"; // inbox / todo / 計画中 / note_type・link_type 等の分類
  }
}

export function entityTitle(type: string, entity: BaseRecord): string {
  if (type === "theme") return String(entity.name ?? "");
  if (type === "status_update") return String(entity.summary ?? "");
  return String(entity.title ?? entity.name ?? "無題");
}

export const CHART_COLORS = [
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "chart-6",
  "theme-extra-1",
  "theme-extra-2",
  "theme-extra-3",
  "theme-extra-4",
];

export function themeColor(theme: Theme | null | undefined, index = 0): string {
  const color = typeof theme?.color === "string" ? theme.color.trim() : "";
  if (CHART_COLORS.includes(color)) return color;
  const safeIndex = ((index % CHART_COLORS.length) + CHART_COLORS.length) % CHART_COLORS.length;
  return CHART_COLORS[safeIndex];
}

export function relatedEntityTitle(data: WorkspaceData, type: string, id?: string): string {
  const keys: Record<string, keyof WorkspaceData> = {
    item: "items",
    note: "notes",
    link: "links",
    source_record: "source_records",
    knowledge_node: "knowledge_nodes",
  };
  const collection = (data[keys[type]] as BaseRecord[] | undefined) || [];
  const entity = collection.find((entry) => entry.id === id);
  return String(entity?.title ?? entity?.source_title ?? entity?.name ?? id ?? "未設定");
}

``

### $relative

``typescript
import { DAY } from "./domain";

export const uuid = (): string => crypto.randomUUID();

export const str = (value: unknown): string => (value == null ? "" : String(value));
export const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const dateOnly = (value: unknown): string => (value ? String(value).slice(0, 10) : "");

export const localDateIso = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const daysBetween = (from: string, to: string): number =>
  Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / DAY);

export const addDays = (value: unknown, count: number): string => {
  if (!value) return "";
  const date = new Date(`${dateOnly(value)}T00:00:00`);
  date.setDate(date.getDate() + count);
  return localDateIso(date);
};

export const formatDate = (value: unknown): string => {
  if (!value) return "—";
  const date = new Date(`${dateOnly(value)}T00:00:00`);
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
};

// FormDataから値を取り出してtrimする。
export const formText = (data: FormData, key: string, fallback = ""): string =>
  String(data.get(key) ?? fallback).trim();

export const activeRecords = <T extends { deleted_at?: string | null }>(records: T[] = []): T[] =>
  records.filter((record) => !record.deleted_at);

export function compareDate(
  a: { planned_end?: string | null; planned_start?: string | null },
  b: { planned_end?: string | null; planned_start?: string | null },
): number {
  return String(a.planned_end || a.planned_start || "9999-12-31").localeCompare(
    String(b.planned_end || b.planned_start || "9999-12-31"),
  );
}

``

### $relative

``typescript
import { todayIso, toYaml } from "../../../utils/dataFormat.js";
import type {
  BaseRecord,
  Dependency,
  Item,
  KnowledgeNode,
  KnowledgeRelation,
  Link,
  Note,
  SourceRecord,
  StatusUpdate,
  Theme,
  WorkspaceData,
} from "../types";
import { KIND_LABELS, KNOWLEDGE_NODE_LABELS, STATUS_LABELS } from "./domain";
import { addDays } from "./format";

export interface ParsedTaskRow {
  title: string;
  theme_id: string | null;
  planned_end: string | null;
  status: string;
  description: string;
  kind?: string;
  priority?: string;
  planned_start?: string | null;
}

export function parseTaskTable(text: string, themes: Theme[]): ParsedTaskRow[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const delimiter = lines.some((line) => line.includes("\t")) ? "\t" : ",";
  const rows = lines.map((line) => line.split(delimiter).map((value) => value.trim()));
  const normalized = (value: string) => String(value || "").toLowerCase().replace(/\s/g, "");
  const knownHeaders = ["title", "タイトル", "タスク", "theme", "テーマ", "予定終了", "期限", "due", "状態", "status", "説明", "description"];
  const hasHeader = rows[0].some((value) => knownHeaders.includes(normalized(value)));
  const headers = hasHeader ? rows.shift()!.map(normalized) : ["タイトル", "theme", "予定終了", "状態", "説明"];
  const fieldIndex = (aliases: string[]) => headers.findIndex((header) => aliases.includes(header));
  const titleIndex = fieldIndex(["title", "タイトル", "タスク"]);
  const themeIndex = fieldIndex(["theme", "テーマ"]);
  const dueIndex = fieldIndex(["due", "due_date", "期限", "予定終了", "planned_end"]);
  const statusIndex = fieldIndex(["status", "状態"]);
  const descriptionIndex = fieldIndex(["description", "説明"]);
  const statusMap: Record<string, string> = Object.fromEntries(
    Object.entries(STATUS_LABELS).flatMap(([key, label]) => [[key, key], [label, key]]),
  );
  return rows.flatMap<ParsedTaskRow>((row) => {
    const title = row[titleIndex >= 0 ? titleIndex : 0]?.trim();
    if (!title) return [];
    const themeName = row[themeIndex] || "";
    const theme = themes.find((entry) => entry.id === themeName || entry.name === themeName);
    const due = row[dueIndex] || "";
    return [{
      title,
      theme_id: theme?.id || null,
      planned_end: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
      status: statusMap[row[statusIndex]] || "todo",
      description: row[descriptionIndex] || "",
    }];
  });
}

export interface ExportData {
  themes: Theme[];
  items: Item[];
  notes: Note[];
  links: Link[];
  status_updates: StatusUpdate[];
  log_entries: BaseRecord[];
  source_records: SourceRecord[];
  dependencys: Dependency[];
  knowledge_nodes: KnowledgeNode[];
  knowledge_relations: KnowledgeRelation[];
}

interface BuildExportArgs {
  data: WorkspaceData;
  themes: Theme[];
  items: Item[];
  activeTheme: Theme | null;
  scope: string;
}

export function buildExportData({ data, themes, items, activeTheme, scope }: BuildExportArgs): ExportData {
  const today = todayIso();
  const horizon = scope === "week" ? 7 : scope === "month" ? 30 : scope === "quarter" ? 90 : null;
  const inHorizon = (item: Item) => {
    const date = item.planned_end || item.planned_start;
    return Boolean(date && horizon != null && date >= today && date <= addDays(today, horizon));
  };
  let scopedItems = items;
  let scopedNotes = data.notes || [];
  let scopedLinks = data.links || [];
  let scopedKnowledgeNodes = data.knowledge_nodes || [];
  let scopedThemes = themes;
  if (scope === "theme" && activeTheme) {
    scopedThemes = [activeTheme];
    scopedItems = items.filter((item) => item.theme_id === activeTheme.id);
    scopedNotes = scopedNotes.filter((note) => note.theme_id === activeTheme.id);
    scopedLinks = scopedLinks.filter((link) => link.theme_id === activeTheme.id);
    scopedKnowledgeNodes = scopedKnowledgeNodes.filter((node) => node.theme_id === activeTheme.id);
  } else if (horizon) {
    scopedItems = items.filter(inHorizon);
  } else if (scope === "open") {
    scopedItems = items.filter((item) => item.status !== "done" && item.status !== "cancelled");
  } else if (scope === "waiting") {
    scopedItems = items.filter((item) => item.kind === "waiting" || item.status === "waiting");
  } else if (scope === "recent_notes") {
    scopedItems = [];
    scopedNotes = [...scopedNotes].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 20);
  } else if (scope === "milestones") {
    scopedItems = items.filter((item) => item.kind === "milestone");
  }
  const themeIds = new Set(
    [
      ...scopedItems.map((item) => item.theme_id),
      ...scopedNotes.map((note) => note.theme_id),
      ...scopedLinks.map((link) => link.theme_id),
      ...scopedKnowledgeNodes.map((node) => node.theme_id),
    ].filter(Boolean) as string[],
  );
  const knowledgeIds = new Set(scopedKnowledgeNodes.map((node) => node.id));
  if (scope !== "all" && scope !== "theme") scopedThemes = themes.filter((theme) => themeIds.has(theme.id));
  return {
    themes: scopedThemes,
    items: scopedItems,
    notes: scopedNotes,
    links: scopedLinks,
    status_updates: (data.status_updates || []).filter((entry) => !themeIds.size || (entry.theme_id != null && themeIds.has(entry.theme_id))),
    log_entries: (data.log_entries || []).filter((entry) => {
      const themeId = entry.theme_id as string | undefined;
      return !themeIds.size || (themeId != null && themeIds.has(themeId));
    }),
    source_records: data.source_records || [],
    dependencys: (data.dependencys || []).filter((dependency) => {
      const source = scopedItems.find((item) => item.id === dependency.source_item_id);
      const target = scopedItems.find((item) => item.id === dependency.target_item_id);
      return Boolean(source || target);
    }),
    knowledge_nodes: scopedKnowledgeNodes,
    knowledge_relations: (data.knowledge_relations || []).filter((relation) =>
      knowledgeIds.has(String(relation.source_node_id)) || knowledgeIds.has(String(relation.target_node_id))),
  };
}

function sortItemsForExport(items: Item[]): Item[] {
  return [...items].sort((a, b) => {
    const aDone = a.status === "done" ? 1 : 0;
    const bDone = b.status === "done" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    const aDate = a.planned_end || a.planned_start || "9999-12-31";
    const bDate = b.planned_end || b.planned_start || "9999-12-31";
    return aDate.localeCompare(bDate);
  });
}

function formatNoteBody(body: string): string {
  const lines = body.split(/\r?\n/);
  if (lines.length <= 1) return body;
  return "\n" + lines.map((line) => `  > ${line}`).join("\n");
}

function renderItemSection(items: Item[]): string[] {
  const sorted = sortItemsForExport(items);
  const milestones = sorted.filter((item) => item.kind === "milestone");
  const waiting = sorted.filter((item) => item.kind === "waiting" || item.status === "waiting");
  const tasks = sorted.filter((item) => item.kind !== "milestone" && item.kind !== "waiting" && item.status !== "waiting");
  const lines: string[] = [];
  if (tasks.length) {
    lines.push("### Items", ...tasks.map((item) => `- [${item.status === "done" ? "x" : " "}] ${item.planned_end || "予定なし"} ${item.priority === "high" ? "!" : ""} ${item.title}`), "");
  }
  if (milestones.length) {
    lines.push("### Milestones", ...milestones.map((item) => `- ${item.planned_end || "予定なし"} ${item.title}`), "");
  }
  if (waiting.length) {
    lines.push("### Waiting", ...waiting.map((item) => `- ${item.planned_end || "予定なし"} ${item.title}`), "");
  }
  if (!lines.length) lines.push("### Items", "- なし", "");
  return lines;
}

function renderKnowledgeSection(nodes: KnowledgeNode[], relations: KnowledgeRelation[] = []): string[] {
  const activeByType = (type: string) => nodes.filter((node) => node.node_type === type && (node.status || "active") === "active");
  const evidenceIds = new Set(nodes.filter((node) => node.node_type === "evidence").map((node) => node.id));
  const claimsWithoutEvidence = activeByType("claim").filter((claim) => {
    const supportTargets = relations
      .filter((relation) => relation.source_node_id === claim.id && relation.relation_type === "supports")
      .map((relation) => relation.target_node_id);
    return supportTargets.every((id) => !evidenceIds.has(String(id)));
  });
  const contradictions = relations.filter((relation) => relation.relation_type === "contradicts");
  const nodeTitle = (id?: string) => nodes.find((node) => node.id === id)?.title || "不明";
  return [
    "### Questions",
    ...(activeByType("question").length ? activeByType("question").map((node) => `- ${node.title}`) : ["- なし"]),
    "",
    "### Claims",
    ...(activeByType("claim").length ? activeByType("claim").map((node) => `- ${node.title}`) : ["- なし"]),
    "",
    "### Evidence",
    ...(activeByType("evidence").length ? activeByType("evidence").map((node) => `- ${node.title}`) : ["- なし"]),
    "",
    "### Decisions",
    ...(activeByType("decision").length ? activeByType("decision").map((node) => `- ${node.title}`) : ["- なし"]),
    "",
    "### Risks / Contradictions",
    ...(contradictions.length ? contradictions.map((relation) => `- ${nodeTitle(relation.source_node_id)} contradicts ${nodeTitle(relation.target_node_id)}`) : ["- なし"]),
    ...(claimsWithoutEvidence.length ? ["", "### Claims Without Evidence", ...claimsWithoutEvidence.map((node) => `- ${node.title}`)] : []),
    "",
  ];
}

export function exportMarkdown(data: ExportData): string {
  const sections = data.themes.flatMap((theme) => {
    const items = data.items.filter((item) => item.theme_id === theme.id);
    const notes = data.notes.filter((note) => note.theme_id === theme.id);
    const updates = data.status_updates
      .filter((entry) => entry.theme_id === theme.id)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const itemIds = new Set(items.map((item) => item.id));
    const dependencies = data.dependencys.filter((dependency) =>
      (dependency.source_item_id != null && itemIds.has(dependency.source_item_id))
      || (dependency.target_item_id != null && itemIds.has(dependency.target_item_id)));
    const knowledgeNodes = data.knowledge_nodes.filter((node) => node.theme_id === theme.id);
    const knowledgeIds = new Set(knowledgeNodes.map((node) => node.id));
    const knowledgeRelations = data.knowledge_relations.filter((relation) =>
      knowledgeIds.has(String(relation.source_node_id)) || knowledgeIds.has(String(relation.target_node_id)));
    const itemTitle = (id?: string) => data.items.find((item) => item.id === id)?.title || id || "不明";
    return [
      `## Theme: ${theme.name}`,
      theme.description || "",
      "",
      "### Current Status",
      updates[0]?.summary || "- 未記録",
      "",
      ...renderItemSection(items),
      "### Dependencies",
      ...(dependencies.length
        ? dependencies.map((dependency) => `- ${itemTitle(dependency.source_item_id)} -> ${itemTitle(dependency.target_item_id)}`)
        : ["- なし"]),
      "",
      "### Notes",
      ...(notes.length ? notes.map((note) => `- **${note.title}**: ${formatNoteBody(note.body_markdown ?? "")}`) : ["- なし"]),
      "",
      "### Knowledge",
      ...(knowledgeNodes.length
        ? knowledgeNodes.map((node) => `- ${KNOWLEDGE_NODE_LABELS[node.node_type] || node.node_type}: ${node.title}${node.body ? `: ${formatNoteBody(node.body)}` : ""}`)
        : ["- なし"]),
      "",
      ...renderKnowledgeSection(knowledgeNodes, knowledgeRelations),
    ];
  });
  const unscopedItems = data.items.filter((item) => !item.theme_id);
  const unscopedNotes = data.notes.filter((note) => !note.theme_id);
  const unscopedKnowledgeNodes = data.knowledge_nodes.filter((node) => !node.theme_id);
  if (unscopedItems.length || unscopedNotes.length || unscopedKnowledgeNodes.length || !sections.length) {
    sections.push(
      "## Themeなし",
      "",
      ...renderItemSection(unscopedItems),
      "### Notes",
      ...(unscopedNotes.length ? unscopedNotes.map((note) => `- **${note.title}**: ${formatNoteBody(note.body_markdown ?? "")}`) : ["- なし"]),
      "",
      "### Knowledge",
      ...(unscopedKnowledgeNodes.length
        ? unscopedKnowledgeNodes.map((node) => `- ${KNOWLEDGE_NODE_LABELS[node.node_type] || node.node_type}: ${node.title}`)
        : ["- なし"]),
      "",
      ...renderKnowledgeSection(unscopedKnowledgeNodes, data.knowledge_relations),
    );
  }
  return [
    "# Current Work Context",
    "",
    "## AIに渡す時の注意事項",
    "- Taskenの正本はSQLiteです。提案は保存前に差分確認してください。",
    "- タスク親子関係とDependencyは循環禁止です。",
    "- 期限や今日判定は利用者のローカル日付を基準にしてください。",
    "- 不明な参照先は推測で作らず、候補として分けてください。",
    "",
    ...sections,
  ].join("\n");
}

function itemDate(item: Item): string {
  return String(item.planned_end || item.planned_start || item.due_date || "");
}

function isOpen(item: Item): boolean {
  return item.status !== "done" && item.status !== "cancelled" && item.status !== "archived";
}

function latestUpdateFor(theme: Theme, updates: StatusUpdate[]): StatusUpdate | undefined {
  return updates
    .filter((entry) => entry.theme_id === theme.id)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];
}

function itemLine(item: Item): string {
  const status = STATUS_LABELS[item.status ?? ""] || item.status || "未設定";
  const kind = KIND_LABELS[item.kind ?? ""] || "タスク";
  const date = itemDate(item) || "予定なし";
  return `- ${date} / ${status} / ${kind}: ${item.title}${item.priority === "high" ? " [優先]" : ""}`;
}

export function exportProgressReport(data: ExportData): string {
  const today = todayIso();
  const weekStart = addDays(today, -6);
  const soon = addDays(today, 14);
  const completed = data.items
    .filter((item) => item.status === "done" && String(item.completed_at || item.actual_end || item.updated_at || "").slice(0, 10) >= weekStart)
    .sort((a, b) => String(b.completed_at || b.actual_end || b.updated_at || "").localeCompare(String(a.completed_at || a.actual_end || a.updated_at || "")));
  const delayed = data.items
    .filter((item) => isOpen(item) && itemDate(item) && itemDate(item) < today)
    .sort((a, b) => itemDate(a).localeCompare(itemDate(b)));
  const waiting = data.items
    .filter((item) => isOpen(item) && (item.kind === "waiting" || item.status === "waiting"))
    .sort((a, b) => itemDate(a).localeCompare(itemDate(b)));
  const milestones = data.items
    .filter((item) => isOpen(item) && item.kind === "milestone" && itemDate(item) && itemDate(item) <= soon)
    .sort((a, b) => itemDate(a).localeCompare(itemDate(b)));
  const risks = data.status_updates
    .filter((entry) => entry.risks)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 8);
  const nextActions = data.status_updates
    .filter((entry) => entry.next_actions)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 8);
  const sections = data.themes.map((theme) => {
    const update = latestUpdateFor(theme, data.status_updates);
    const themeItems = data.items.filter((item) => item.theme_id === theme.id && isOpen(item));
    return [
      `### ${theme.name}`,
      `- 現在地: ${update?.summary || "未記録"}`,
      update?.risks ? `- リスク: ${update.risks}` : "- リスク: なし",
      update?.next_actions ? `- 次アクション: ${update.next_actions}` : "- 次アクション: 未設定",
      `- 未完了: ${themeItems.length}件`,
    ].join("\n");
  });
  return [
    `# 週報 / 現在地レポート (${weekStart} - ${today})`,
    "",
    "## Themeごとの現在地",
    ...(sections.length ? sections : ["- Themeなし"]),
    "",
    "## 完了したこと",
    ...(completed.length ? completed.map(itemLine) : ["- なし"]),
    "",
    "## 未完了・遅延",
    ...(delayed.length ? delayed.map(itemLine) : ["- なし"]),
    "",
    "## Waiting",
    ...(waiting.length ? waiting.map((item) => `${itemLine(item)}${item.waiting_for ? ` / 相手: ${item.waiting_for}` : ""}${item.next_action ? ` / 次: ${item.next_action}` : ""}`) : ["- なし"]),
    "",
    "## 近いマイルストーン",
    ...(milestones.length ? milestones.map(itemLine) : ["- なし"]),
    "",
    "## リスク",
    ...(risks.length ? risks.map((entry) => `- ${entry.date || "日付なし"} / ${data.themes.find((theme) => theme.id === entry.theme_id)?.name || "全体"}: ${entry.risks}`) : ["- なし"]),
    "",
    "## 次アクション",
    ...(nextActions.length ? nextActions.map((entry) => `- ${entry.date || "日付なし"} / ${data.themes.find((theme) => theme.id === entry.theme_id)?.name || "全体"}: ${entry.next_actions}`) : ["- なし"]),
    "",
    "## AIに依頼したい時の補足",
    "- 上の内容をもとに、過不足の確認、優先順位案、報告文への整形を依頼できます。",
  ].join("\n");
}

export { toYaml };

``

### $relative

``typescript
import type { Item, KnowledgeNode, KnowledgeRelation } from "../types";

export interface KnowledgeHealthIssue {
  id: string;
  kind: "claim_without_evidence" | "unanswered_question" | "contradicted_claim" | "evidence_without_source" | "isolated_node" | "stale_decision";
  node: KnowledgeNode;
  message: string;
  action: string;
}

const STALE_DECISION_DAYS = 90;

function daysSince(value?: string): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return 0;
  return Math.floor((Date.now() - time) / 86400000);
}

function hasRelation(node: KnowledgeNode, relations: KnowledgeRelation[], predicate?: (relation: KnowledgeRelation) => boolean): boolean {
  return relations.some((relation) =>
    (relation.source_node_id === node.id || relation.target_node_id === node.id)
    && (!predicate || predicate(relation)));
}

function hasEvidenceSupport(claim: KnowledgeNode, nodes: KnowledgeNode[], relations: KnowledgeRelation[]): boolean {
  const evidenceIds = new Set(nodes.filter((node) => node.node_type === "evidence").map((node) => node.id));
  return relations.some((relation) => {
    if (relation.relation_type !== "supports") return false;
    if (relation.source_node_id === claim.id && evidenceIds.has(String(relation.target_node_id))) return true;
    if (relation.target_node_id === claim.id && evidenceIds.has(String(relation.source_node_id))) return true;
    return false;
  });
}

export function buildKnowledgeHealth(nodes: KnowledgeNode[], relations: KnowledgeRelation[], items: Item[] = []): KnowledgeHealthIssue[] {
  const issues: KnowledgeHealthIssue[] = [];
  const openItemIds = new Set(items.filter((item) => !["done", "cancelled", "archived"].includes(item.status || "")).map((item) => item.id));
  for (const node of nodes.filter((entry) => (entry.status || "active") === "active")) {
    if (node.node_type === "claim" && !hasEvidenceSupport(node, nodes, relations)) {
      issues.push({
        id: `${node.id}:claim_without_evidence`,
        kind: "claim_without_evidence",
        node,
        message: "根拠となるEvidenceとのsupports関係がありません。",
        action: "Evidenceを追加するか、既存Evidenceとsupportsで接続します。",
      });
    }
    if (node.node_type === "question" && !hasRelation(node, relations, (relation) => relation.relation_type === "answers")) {
      issues.push({
        id: `${node.id}:unanswered_question`,
        kind: "unanswered_question",
        node,
        message: "answers関係がない未解決Questionです。",
        action: "回答候補のDecision / Insight / Evidenceを接続します。",
      });
    }
    if (node.node_type === "claim" && hasRelation(node, relations, (relation) => relation.relation_type === "contradicts")) {
      issues.push({
        id: `${node.id}:contradicted_claim`,
        kind: "contradicted_claim",
        node,
        message: "contradicts関係があるClaimです。",
        action: "どちらの主張を採用するか確認し、statusを更新します。",
      });
    }
    if (node.node_type === "evidence" && !node.source_note_id && !node.source_link_id && !node.source_item_id) {
      issues.push({
        id: `${node.id}:evidence_without_source`,
        kind: "evidence_without_source",
        node,
        message: "Source Note / Link / Itemが未設定のEvidenceです。",
        action: "元メモ、リンク、タスクのいずれかに接続します。",
      });
    }
    if (!hasRelation(node, relations)) {
      issues.push({
        id: `${node.id}:isolated_node`,
        kind: "isolated_node",
        node,
        message: "他のKnowledgeとのrelationがありません。",
        action: "関連する問い・根拠・決定へ接続するか、不要ならrejectedにします。",
      });
    }
    if (node.node_type === "decision" && (!node.source_item_id || !openItemIds.has(String(node.source_item_id))) && daysSince(node.updated_at || node.created_at) >= STALE_DECISION_DAYS) {
      issues.push({
        id: `${node.id}:stale_decision`,
        kind: "stale_decision",
        node,
        message: `${STALE_DECISION_DAYS}日以上更新されていないDecisionです。`,
        action: "まだ有効か確認し、関連タスクまたは新しいDecisionに接続します。",
      });
    }
  }
  return issues;
}

``

### $relative

``typescript
import type { Item, Theme } from "../types";
import { itemLevel } from "./domain";
import { addDays, daysBetween, localDateIso } from "./format";

export type TimelineRow =
  | { rowType: "theme"; groupKey: string; theme: Theme | null; initiativeCount: number; planCount: number }
  | { rowType: "milestones"; groupKey: string; theme: Theme | null; milestones: Item[] }
  | { rowType: "item"; item: Item; depth: number; laneItems: Item[] };

export interface GanttRange {
  start: string;
  end: string;
}

// 年間は年度（4月〜翌3月）で扱う。今が1〜3月なら前年4月始まりの年度に属する。
export function fiscalYearStart(today: string): number {
  const date = new Date(`${today}T00:00:00`);
  return date.getMonth() + 1 >= 4 ? date.getFullYear() : date.getFullYear() - 1;
}

// 指定の暦年・開始月から months ヶ月ぶんの範囲（月初〜月末）。月の繰り上がりは年をまたぐ。
function monthRange(year: number, startMonth: number, months: number): GanttRange {
  return {
    start: localDateIso(new Date(year, startMonth - 1, 1)),
    end: localDateIso(new Date(year, startMonth - 1 + months, 0)),
  };
}

// 年間・半年・四半期は年度の「期」の区切りに合わせる（半年=4〜9 or 10〜3、四半期=4-6/7-9/10-12/1-3）。
// 現在の月がどの期に属するかで範囲を決める。月間・週間は今日を中心にした相対表示のまま。
export function ganttRange(scale: string, today: string): GanttRange {
  const date = new Date(`${today}T00:00:00`);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  if (scale === "year") return monthRange(fiscalYearStart(today), 4, 12);
  if (scale === "half") {
    if (month >= 4 && month <= 9) return monthRange(year, 4, 6);
    if (month >= 10) return monthRange(year, 10, 6);
    return monthRange(year - 1, 10, 6);
  }
  if (scale === "quarter") return monthRange(year, Math.floor((month - 1) / 3) * 3 + 1, 3);
  const span = scale === "week" ? 14 : 31;
  return { start: addDays(today, -Math.round(span * 0.25)), end: addDays(today, Math.round(span * 0.75)) };
}

interface BuildRowsArgs {
  items: Item[];
  themes: Theme[];
  collapsedThemes: string[];
  scale?: string;
}

export function dataRange(items: Item[], today: string, paddingDays = 90): GanttRange {
  let min = today;
  let max = today;
  for (const item of items) {
    for (const d of [item.planned_start, item.planned_end, item.due_date]) {
      if (d && d < min) min = d;
      if (d && d > max) max = d;
    }
  }
  const span = daysBetween(min, max);
  const extra = Math.max(paddingDays, Math.floor((180 - span) / 2));
  return { start: addDays(min, -extra), end: addDays(max, extra) };
}

export function scaleFromDayWidth(dayWidth: number): string {
  if (dayWidth >= 36) return "week";
  if (dayWidth >= 16) return "month";
  if (dayWidth >= 6) return "quarter";
  if (dayWidth >= 3) return "half";
  return "year";
}

export const ZOOM_PRESETS = [
  { id: "year", label: "年間", dayWidth: 2 },
  { id: "half", label: "半年", dayWidth: 4 },
  { id: "quarter", label: "四半期", dayWidth: 8 },
  { id: "month", label: "月間", dayWidth: 24 },
  { id: "week", label: "週間", dayWidth: 48 },
] as const;

export const MIN_DAY_WIDTH = 1;
export const MAX_DAY_WIDTH = 80;

const SCALE_ORDER = ["year", "half", "quarter", "month", "week"];

function dateOf(item: Item): string {
  return String(item.planned_end || item.due_date || item.planned_start || "");
}

function visibilityRank(value?: unknown): number {
  const index = SCALE_ORDER.indexOf(String(value || "year"));
  return index >= 0 ? index : 0;
}

function scaleRank(scale?: string): number {
  const index = SCALE_ORDER.indexOf(String(scale || "quarter"));
  return index >= 0 ? index : 2;
}

function isVisibleAtScale(item: Item, scale?: string): boolean {
  const level = String(item.visibility_level || "");
  if (level) return visibilityRank(level) <= scaleRank(scale);
  const importance = String(item.importance || "");
  if (scale === "year") return importance ? importance === "major" : true;
  if (scale === "half" || scale === "quarter") return importance !== "minor";
  return true;
}

// テーマ別レーンで行を組み立てる。親を持たない計画Itemは左表の「実施事項」、
// その子Itemは同じタイムライン行に並ぶ「計画」として扱う。
export function buildTimelineRows({ items, themes, collapsedThemes, scale }: BuildRowsArgs): TimelineRow[] {
  const themeIds = new Set(themes.map((theme) => theme.id));
  const byTheme = new Map<string | null, Item[]>();
  for (const item of items) {
    const key = item.theme_id && themeIds.has(item.theme_id) ? item.theme_id : null;
    byTheme.set(key, [...(byTheme.get(key) || []), item]);
  }
  const rows: TimelineRow[] = [];
  const order: (string | null)[] = [...themes.map((theme) => theme.id), null];
  for (const themeId of order) {
    const pool = byTheme.get(themeId) || [];
    if (!pool.length) continue;
    const groupKey = themeId || "__none";
    const milestones = pool
      .filter((item) => item.kind === "milestone" && String(item.display_lane || "theme_lane") !== "item_endpoint" && isVisibleAtScale(item, scale))
      .sort((a, b) => dateOf(a).localeCompare(dateOf(b)) || (a.sort_order || 0) - (b.sort_order || 0));
    const allPlans = pool
      .filter((item) => item.kind !== "milestone" && itemLevel(item) === "plan")
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const planIds = new Set(allPlans.map((item) => item.id));
    const initiatives = allPlans.filter((item) => !item.parent_item_id || !planIds.has(item.parent_item_id));
    const planCount = allPlans.length - initiatives.length;
    rows.push({
      rowType: "theme",
      groupKey,
      theme: themes.find((theme) => theme.id === themeId) || null,
      initiativeCount: initiatives.length,
      planCount,
    });
    if (collapsedThemes.includes(groupKey)) continue;
    if (milestones.length) {
      rows.push({
        rowType: "milestones",
        groupKey,
        theme: themes.find((theme) => theme.id === themeId) || null,
        milestones,
      });
    }
    const childPlans = allPlans
      .filter((item) => item.parent_item_id && planIds.has(item.parent_item_id))
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const children = new Map<string, Item[]>();
    for (const item of childPlans) {
      const parent = String(item.parent_item_id);
      children.set(parent, [...(children.get(parent) || []), item]);
    }
    for (const plan of initiatives) {
      const laneItems = children.get(plan.id) || [];
      rows.push({
        rowType: "item",
        item: plan,
        depth: 0,
        laneItems: laneItems.length > 0 ? laneItems : [plan],
      });
    }
  }
  return rows;
}

``

### $relative

``tsx
import { useEffect, useMemo, useState } from "react";
import { IconCopy, IconExternalLink, IconLinkPlus } from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { Item, Link, PageProps, Theme } from "../types";
import { themeColor } from "../lib/domain";
import { formatDate, str } from "../lib/format";
import { EmptyState, PageHeader, StatusBadge } from "../components/common";

const CHAT_LINK_TYPES = ["chatgpt", "claude", "gemini", "copilot"];
const SERVICE_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  copilot: "Copilot",
  other: "その他",
};
const REFERENCE_STATUS_LABELS: Record<string, string> = {
  inbox: "未整理",
  keep: "参照",
  adopted: "採用",
  pending: "再確認",
  stale: "古い",
};

function isChatReference(link: Link): boolean {
  return CHAT_LINK_TYPES.includes(str(link.link_type)) || Boolean(link.reference_status);
}

function referenceStatus(link: Link): string {
  const value = str(link.reference_status);
  return value && REFERENCE_STATUS_LABELS[value] ? value : "keep";
}

function serviceLabel(link: Link): string {
  return SERVICE_LABELS[str(link.link_type)] || str(link.link_type) || "リンク";
}

function linkDate(link: Link): string {
  return str(link.captured_at || link.created_at || link.updated_at);
}

function itemTitle(items: Item[], id?: string | null): string {
  return items.find((item) => item.id === id)?.title || "未設定";
}

function themeTitle(themes: Theme[], id?: string | null): string {
  return themes.find((theme) => theme.id === id)?.name || "未設定";
}

export function ChatRefsPage({
  themes,
  items,
  links,
  activeThemeId,
  setActiveThemeId,
  openDrawer,
  setToast,
}: PageProps) {
  const chatLinks = useMemo(() => links.filter(isChatReference), [links]);
  const [selectedThemeId, setSelectedThemeId] = useState(activeThemeId || themes[0]?.id || "");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    if (!selectedThemeId && themes[0]) setSelectedThemeId(themes[0].id);
  }, [selectedThemeId, themes]);

  useEffect(() => {
    if (activeThemeId && activeThemeId !== selectedThemeId) setSelectedThemeId(activeThemeId);
  }, [activeThemeId, selectedThemeId]);

  const inboxLinks = chatLinks.filter((link) => referenceStatus(link) === "inbox" || !link.theme_id || !link.item_id);
  const selectedTheme = themes.find((theme) => theme.id === selectedThemeId) || null;
  const themeItems = items
    .filter((item) => item.theme_id === selectedThemeId)
    .sort((a, b) => String(a.sort_order ?? 0).localeCompare(String(b.sort_order ?? 0)) || str(a.title).localeCompare(str(b.title), "ja-JP"));

  useEffect(() => {
    if (selectedItemId && themeItems.some((item) => item.id === selectedItemId)) return;
    setSelectedItemId(themeItems[0]?.id || "");
  }, [selectedItemId, themeItems]);

  const scopedLinks = chatLinks.filter((link) => {
    if (selectedItemId) return link.item_id === selectedItemId;
    if (selectedThemeId) return link.theme_id === selectedThemeId && !link.item_id;
    return !link.theme_id;
  });

  const visibleLinks = scopedLinks.filter((link) => {
    if (statusFilter !== "all" && referenceStatus(link) !== statusFilter) return false;
    const haystack = `${link.title} ${link.description} ${link.url} ${serviceLabel(link)} ${themeTitle(themes, link.theme_id)} ${itemTitle(items, link.item_id)}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  function selectTheme(themeId: string) {
    setSelectedThemeId(themeId);
    setActiveThemeId(themeId);
  }

  function copyList() {
    const header = "タイトル\tサービス\tTheme\t実施事項\t状態\tURL\t要約";
    const rows = visibleLinks.map((link) => [
      str(link.title),
      serviceLabel(link),
      themeTitle(themes, link.theme_id),
      itemTitle(items, link.item_id),
      REFERENCE_STATUS_LABELS[referenceStatus(link)],
      str(link.url),
      str(link.description).replace(/\s+/g, " "),
    ].join("\t"));
    workspaceApi.copyText([header, ...rows].join("\n")).then(() => setToast("チャット参照一覧をコピーしました。"));
  }

  function copyUrls() {
    workspaceApi.copyText(visibleLinks.map((link) => link.url).join("\n")).then(() => setToast("チャットURLをコピーしました。"));
  }

  function addChatLink() {
    openDrawer({
      type: "link",
      mode: "edit",
      entity: {
        link_type: "chatgpt",
        reference_status: selectedThemeId && selectedItemId ? "keep" : "inbox",
        theme_id: selectedThemeId || null,
        item_id: selectedItemId || null,
        importance: "normal",
        captured_at: new Date().toISOString().slice(0, 10),
      },
    });
  }

  function addGroup() {
    openDrawer({
      type: "item",
      mode: "edit",
      entity: {
        kind: "task",
        level: "plan",
        status: "todo",
        theme_id: selectedThemeId || null,
      },
    });
  }

  return (
    <div className="page chat-refs-page">
      <PageHeader title="チャット参照棚" subtitle="外部AIチャットをThemeと実施事項へ接続します。">
        <button className="secondary-button" onClick={copyUrls} disabled={!visibleLinks.length}><IconCopy size={16} />URLをコピー</button>
        <button className="secondary-button" onClick={copyList} disabled={!visibleLinks.length}><IconCopy size={16} />一覧をコピー</button>
        <button className="primary-button" onClick={addChatLink}><IconLinkPlus size={16} />チャットリンクを追加</button>
      </PageHeader>

      <section className="chat-ref-toolbar panel">
        <div>
          <span>未整理</span>
          <strong className="metric-value">{inboxLinks.length}</strong>
        </div>
        <div>
          <span>表示中</span>
          <strong className="metric-value">{visibleLinks.length}</strong>
        </div>
        <input data-search value={query} onChange={(event) => setQuery(event.target.value)} placeholder="タイトル、要約、URLを検索" />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="参照状態で絞り込み">
          <option value="all">すべての状態</option>
          {Object.entries(REFERENCE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </section>

      <section className="chat-ref-board">
        <div className="panel chat-ref-column theme-column">
          <div className="section-heading">
            <h2>Theme</h2>
            <span>{themes.length}件</span>
          </div>
          <div className="chat-theme-list">
            {themes.map((theme, index) => {
              const count = chatLinks.filter((link) => link.theme_id === theme.id).length;
              return (
                <button
                  key={theme.id}
                  className={selectedThemeId === theme.id ? "is-active" : ""}
                  style={{ "--chip-color": `var(--color-${themeColor(theme, index)})` } as React.CSSProperties}
                  onClick={() => selectTheme(theme.id)}
                >
                  <span className="chip-dot" />
                  <strong>{theme.name}</strong>
                  <span className="count">{count}</span>
                </button>
              );
            })}
            {!themes.length && <EmptyState title="Themeがありません" action="Themeを追加" onAction={() => openDrawer({ type: "theme", mode: "edit", entity: {} })} />}
          </div>
        </div>

        <div className="panel chat-ref-column group-column">
          <div className="section-heading">
            <h2>実施事項</h2>
            <button className="text-button compact" onClick={addGroup}>追加</button>
          </div>
          <div className="chat-group-list">
            {themeItems.map((item) => {
              const related = chatLinks.filter((link) => link.item_id === item.id);
              const high = related.filter((link) => link.importance === "high").length;
              return (
                <button key={item.id} className={selectedItemId === item.id ? "is-active" : ""} onClick={() => setSelectedItemId(item.id)}>
                  <strong>{item.title}</strong>
                  <span>{str(item.description) || "説明なし"}</span>
                  <small><b className="metric-value">{related.length}</b>件 / 重要 {high}件</small>
                </button>
              );
            })}
            {selectedTheme && !themeItems.length && <EmptyState title="実施事項がありません" action="追加する" onAction={addGroup} />}
          </div>
        </div>

        <div className="panel chat-ref-column link-column">
          <div className="section-heading">
            <h2>{selectedItemId ? itemTitle(items, selectedItemId) : "未分類"}</h2>
            <span>{visibleLinks.length}件</span>
          </div>
          <div className="chat-link-list">
            {visibleLinks.map((link) => (
              <article className="chat-link-card" key={link.id}>
                <div className="badge-row">
                  <StatusBadge value="neutral" label={serviceLabel(link)} />
                  <StatusBadge value={referenceStatus(link)} label={REFERENCE_STATUS_LABELS[referenceStatus(link)]} />
                  {link.importance === "high" && <StatusBadge value="review" label="重要" />}
                </div>
                <button className="chat-link-title" onClick={() => openDrawer({ type: "link", entity: link })}>
                  <strong>{link.title}</strong>
                  <span>{link.description || link.url}</span>
                </button>
                <div className="chat-link-meta">
                  <span>{formatDate(linkDate(link))}</span>
                  <button className="text-button compact" onClick={() => openDrawer({ type: "link", mode: "edit", entity: link })}>編集</button>
                  <a className="secondary-button compact" href={link.url} target="_blank" rel="noreferrer"><IconExternalLink size={15} />開く</a>
                </div>
              </article>
            ))}
            {!visibleLinks.length && <EmptyState title="チャット参照がありません" action="チャットリンクを追加" onAction={addChatLink} />}
          </div>
        </div>
      </section>

      {inboxLinks.length > 0 && (
        <section className="panel chat-inbox-strip">
          <div className="section-heading">
            <h2>未整理チャット</h2>
            <span>{inboxLinks.length}件</span>
          </div>
          <div>
            {inboxLinks.slice(0, 6).map((link) => (
              <button key={link.id} onClick={() => openDrawer({ type: "link", mode: "edit", entity: link })}>
                <strong>{link.title}</strong>
                <span>{serviceLabel(link)} / {themeTitle(themes, link.theme_id)} / {itemTitle(items, link.item_id)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

``

### $relative

``tsx
import type { Item, PageProps } from "../types";
import { compareDate, formatDate } from "../lib/format";
import { EmptyState, Metric, PageHeader, SimpleRows, StatusBadge } from "../components/common";

export function HomePage({ data, activeTheme, items, notes, openDrawer, navigate }: PageProps) {
  if (!activeTheme) {
    return <EmptyState title="テーマがありません" action="テーマを追加" onAction={() => openDrawer({ type: "theme", mode: "edit", entity: {} })} />;
  }
  const related = items.filter((item) => item.theme_id === activeTheme.id);
  const open = related.filter((item) => item.status !== "done");
  const waiting = open.filter((item) => item.kind === "waiting" || item.status === "waiting");
  const milestones = open.filter((item) => item.kind === "milestone").sort(compareDate);
  const updates = (data.status_updates || [])
    .filter((entry) => entry.theme_id === activeTheme.id)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const latest = updates[0];
  const themeNotes = notes.filter((note) => note.theme_id === activeTheme.id);
  return (
    <div className="page">
      <PageHeader title={activeTheme.name} subtitle={activeTheme.description}>
        <StatusBadge value={activeTheme.status} label={activeTheme.status} />
        <button className="secondary-button" onClick={() => openDrawer({ type: "status_update", mode: "edit", entity: { theme_id: activeTheme.id } })}>現在地を記録</button>
        <button className="primary-button" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { theme_id: activeTheme.id } })}>タスクを追加</button>
      </PageHeader>
      <div className="metric-grid home-metrics">
        <Metric label="未完了" value={open.length} tone="primary" />
        <Metric label="待ち" value={waiting.length} />
        <Metric label="マイルストーン" value={milestones.length} />
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="section-heading"><h2>現在地</h2><span>{latest ? formatDate(latest.date) : "未記録"}</span></div>
          {latest ? (
            <div className="status-summary">
              <StatusBadge value={latest.status} label={latest.status} />
              <strong>{latest.summary}</strong>
              {latest.risks && <p>{latest.risks}</p>}
              {latest.next_actions && <p><b>次:</b> {latest.next_actions}</p>}
            </div>
          ) : (
            <EmptyState title="現在地がまだありません" action="記録する" onAction={() => openDrawer({ type: "status_update", mode: "edit", entity: { theme_id: activeTheme.id } })} />
          )}
        </section>
        <section className="panel">
          <div className="section-heading"><h2>近いマイルストーン</h2><button className="text-button compact" onClick={() => navigate("timeline")}>Timelineへ</button></div>
          <SimpleRows records={milestones.slice(0, 5)} onOpen={(item) => openDrawer({ type: "item", entity: item })} meta={(item) => String(formatDate((item as Item).planned_end))} />
        </section>
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="section-heading"><h2>次のタスク</h2><button className="text-button compact" onClick={() => navigate("todo")}>ToDoへ</button></div>
          <SimpleRows
            records={open.filter((item) => item.kind === "task" || item.kind === "deliverable").sort(compareDate).slice(0, 7)}
            onOpen={(item) => openDrawer({ type: "item", entity: item })}
            meta={(item) => formatDate((item as Item).planned_end)}
          />
        </section>
        <section className="panel">
          <div className="section-heading"><h2>最近のメモ</h2><span>{themeNotes.length}件</span></div>
          <SimpleRows records={themeNotes.slice(0, 5)} onOpen={(note) => openDrawer({ type: "note", entity: note })} meta={(note) => String(note.note_type ?? "")} />
        </section>
      </div>
    </div>
  );
}

``

### $relative

``tsx
import { useMemo, useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { BaseRecord, PageProps, SaveOperation, Theme } from "../types";
import { defaultLevel } from "../lib/domain";
import { num, str, uuid } from "../lib/format";
import { assertImportCandidateSavable, buildAiImportPrompt, parseAiImportPayload } from "../lib/aiImport.js";
import { buildExportData, exportMarkdown, exportProgressReport, toYaml } from "../lib/io";
import { PageHeader } from "../components/common";

type ImportEntry = Record<string, unknown>;

interface ImportCandidate {
  type: "item" | "note" | "link" | "knowledge_node" | "knowledge_relation";
  entry: ImportEntry;
  theme?: Theme;
  duplicate?: BaseRecord;
  action: string;
  issues: string[];
  sourceRecordTitle: string;
}

interface ImportPreview {
  candidates: ImportCandidate[];
  payloadIssues: string[];
}

export function ImportExportPage({ data, themes, items, activeTheme, saveEntities, setToast }: PageProps) {
  const [format, setFormat] = useState("markdown");
  const [scope, setScope] = useState("all");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [showSchema, setShowSchema] = useState(false);
  const exportData = useMemo(() => buildExportData({ data, themes, items, activeTheme, scope }), [data, themes, items, activeTheme, scope]);
  const exported = format === "json"
    ? JSON.stringify({ version: 2, exported_at: new Date().toISOString(), ...exportData }, null, 2)
    : format === "yaml"
      ? toYaml(exportData)
      : format === "report"
        ? exportProgressReport(exportData)
        : exportMarkdown(exportData);
  const themeNames = themes.map((theme) => theme.name).join("\n");
  const promptText = useMemo(() => buildAiImportPrompt(themeNames, exported), [themeNames, exported]);

  function parseImport() {
    try {
      const parsed = parseAiImportPayload(text, themes, {
        items,
        notes: data.notes || [],
        links: data.links || [],
        knowledge_nodes: data.knowledge_nodes || [],
        knowledge_relations: data.knowledge_relations || [],
      });
      setPreview(parsed);
    } catch (error) {
      setToast(`内容を解析できませんでした。${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function executeImport() {
    if (!preview) return;
    try {
      preview.candidates.forEach(assertImportCandidateSavable);
    } catch (error) {
      setToast(`取り込めませんでした。${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const source: BaseRecord = {
      id: uuid(),
      source_type: "imported_json",
      source_title: `AI Import ${new Date().toLocaleString("ja-JP")}`,
      captured_at: new Date().toISOString(),
      raw_text: text,
      summary: `${preview.candidates.length}件の候補`,
    };
    const operations: SaveOperation[] = [{ action: "save", type: "source_record", entity: source, options: { source: "imported" } }];
    let count = 0;
    const acceptedKnowledgeNodeIds = new Map<string, string>();
    for (const candidate of preview.candidates.filter((entry) => entry.type === "knowledge_node")) {
      if (candidate.action === "ignore") continue;
      const base: BaseRecord | Record<string, never> = candidate.action === "merge" && candidate.duplicate ? candidate.duplicate : {};
      const entry = candidate.entry;
      const id = str(base.id) || uuid();
      if (str(entry.temp_id)) acceptedKnowledgeNodeIds.set(str(entry.temp_id), id);
      operations.push({
        action: "save",
        type: "knowledge_node",
        entity: {
          ...base,
          id,
          node_type: str(entry.node_type) || "insight",
          title: str(entry.title) || "無題",
          body: str(entry.body),
          theme_id: candidate.theme?.id || str(base.theme_id) || null,
          source_note_id: str(entry.source_note_id) || str(base.source_note_id) || null,
          source_link_id: str(entry.source_link_id) || str(base.source_link_id) || null,
          source_item_id: str(entry.source_item_id) || str(base.source_item_id) || null,
          confidence: str(entry.confidence) || str(base.confidence) || "medium",
          status: str(entry.status) || str(base.status) || "active",
          source_record_id: source.id,
        },
        options: { source: "imported" },
      });
      count += 1;
    }
    for (const candidate of preview.candidates.filter((entry) => entry.type !== "knowledge_node")) {
      if (candidate.action === "ignore") continue;
      const base: BaseRecord | Record<string, never> = candidate.action === "merge" && candidate.duplicate ? candidate.duplicate : {};
      const entry = candidate.entry;
      if (candidate.type === "item") {
        operations.push({
          action: "save",
          type: "item",
          entity: {
            ...base,
            id: str(base.id) || uuid(),
            title: str(entry.title) || "無題",
            kind: str(entry.kind) || str(base.kind) || "task",
            level: str(entry.level) || str(base.level) || defaultLevel(str(entry.kind) || str(base.kind) || "task"),
            theme_id: candidate.theme?.id || str(base.theme_id) || null,
            status: str(entry.status) || str(base.status) || "todo",
            priority: str(entry.priority) === "high" || entry.priority === true ? "high" : "normal",
            planned_start: str(entry.planned_start) || null,
            planned_end: str(entry.planned_end) || null,
            due_date: null,
            schedule_confidence: "fixed",
            date_granularity: "day",
            progress: 0,
            description: str(entry.description) || str(base.description),
            source_record_id: source.id,
          },
          options: { source: "imported" },
        });
      } else if (candidate.type === "note") {
        operations.push({
          action: "save",
          type: "note",
          entity: {
            ...base,
            id: str(base.id) || uuid(),
            title: str(entry.title) || "無題",
            body_markdown: str(entry.body_markdown) || str(entry.body),
            note_type: str(entry.note_type) || str(base.note_type) || "memo",
            theme_id: candidate.theme?.id || str(base.theme_id) || null,
            item_id: str(entry.item_id) || str(base.item_id) || null,
            source_url: str(entry.source_url) || str(base.source_url),
            source_record_id: source.id,
          },
          options: { source: "imported" },
        });
      } else if (candidate.type === "link") {
        operations.push({
          action: "save",
          type: "link",
          entity: {
            ...base,
            id: str(base.id) || uuid(),
            title: str(entry.title) || "無題",
            url: str(entry.url) || str(base.url),
            link_type: str(entry.link_type) || str(base.link_type) || "other",
            theme_id: candidate.theme?.id || str(base.theme_id) || null,
            item_id: str(entry.item_id) || str(base.item_id) || null,
            description: str(entry.description) || str(base.description),
            source_record_id: source.id,
          },
          options: { source: "imported" },
        });
      } else if (candidate.type === "knowledge_relation") {
        const sourceNodeId = str(entry.source_node_id) || acceptedKnowledgeNodeIds.get(str(entry.source_temp_id)) || "";
        const targetNodeId = str(entry.target_node_id) || acceptedKnowledgeNodeIds.get(str(entry.target_temp_id)) || "";
        if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) continue;
        operations.push({
          action: "save",
          type: "knowledge_relation",
          entity: {
            ...base,
            id: str(base.id) || uuid(),
            source_node_id: sourceNodeId,
            target_node_id: targetNodeId,
            relation_type: str(entry.relation_type) || str(base.relation_type) || "supports",
            description: str(entry.description) || str(base.description),
            confidence: str(entry.confidence) || str(base.confidence) || "medium",
          },
          options: { source: "imported" },
        });
      }
      count += 1;
    }
    operations.push({
      action: "save",
      type: "import_batch",
      entity: {
        id: uuid(),
        source: String(source.source_type),
        status: "completed",
        count,
        raw_text: text,
        source_record_id: source.id,
      },
      options: { source: "imported" },
    });
    await saveEntities(operations, `${count}件を取り込みました。`);
    setPreview(null);
    setText("");
  }

  return (
    <div className="page">
      <PageHeader title="AI Import / Export" subtitle="構造化データをプレビューしてから安全に取り込みます。" />
      <div className="io-grid">
        <section className="panel io-panel">
          <div className="section-heading">
            <h2>書き出す</h2>
            <div className="inline-actions">
              <select aria-label="書き出す範囲" value={scope} onChange={(event) => setScope(event.target.value)}>
                <option value="all">全体</option>
                <option value="theme">選択中Theme</option>
                <option value="week">今後7日</option>
                <option value="month">今後30日</option>
                <option value="quarter">今後90日</option>
                <option value="open">未完了タスク</option>
                <option value="waiting">Waitingのみ</option>
                <option value="recent_notes">直近メモ</option>
                <option value="milestones">マイルストーン</option>
              </select>
              <select aria-label="書き出し形式" value={format} onChange={(event) => setFormat(event.target.value)}>
                <option value="markdown">AI Context Markdown</option>
                <option value="report">週報 / 現在地レポート</option>
                <option value="yaml">YAML</option>
                <option value="json">JSON</option>
              </select>
            </div>
          </div>
          <textarea readOnly value={exported} />
          <div className="form-actions">
            <button className="primary-button" onClick={() => workspaceApi.copyText(exported).then(() => setToast("エクスポート内容をコピーしました。"))}>コピーする</button>
            <button className="secondary-button" onClick={() => workspaceApi.copyText(promptText).then(() => setToast("AI依頼プロンプトをコピーしました。"))}>プロンプトをコピー</button>
          </div>
        </section>
        <section className="panel io-panel">
          <div className="section-heading">
            <h2>読み込む</h2>
            <div className="inline-actions">
              <span>タスク / メモ / リンク / Knowledge</span>
              <button className="text-button compact" onClick={() => setShowSchema((current) => !current)}>入力JSONの形式を見る</button>
            </div>
          </div>
          {showSchema && (
            <pre className="schema-help">{`{
  "items": [{ "title": "測定結果を確認", "theme": "材料A評価", "kind": "task", "status": "todo", "priority": "normal", "planned_start": null, "planned_end": "2026-06-20", "description": "" }],
  "notes": [{ "title": "解析方針", "theme": "材料A評価", "note_type": "memo", "body": "条件Bを再確認する", "source_url": "" }],
  "links": [{ "title": "参考", "url": "https://example.com", "link_type": "paper", "theme": "材料A評価", "description": "" }],
  "knowledge_nodes": [{ "temp_id": "n1", "node_type": "claim", "title": "仮説", "theme": "材料A評価", "confidence": "medium" }],
  "knowledge_relations": []
}`}</pre>
          )}
          <textarea value={text} onChange={(event) => { setText(event.target.value); setPreview(null); }} placeholder={'{\n  "items": [\n    { "title": "測定結果を確認", "theme": "材料A評価", "planned_end": "2026-06-20" }\n  ],\n  "knowledge_nodes": [\n    { "temp_id": "n1", "node_type": "claim", "title": "測定条件Bが遅延要因", "theme": "材料A評価" }\n  ]\n}'} />
          <button className="secondary-button" onClick={parseImport}>候補を確認</button>
        </section>
      </div>
      {preview && (
        <section className="panel import-preview">
          <div className="section-heading"><h2>取り込み候補</h2><span>{preview.candidates.length}件</span></div>
          {preview.payloadIssues.length > 0 && <p className="field-help">注意: {preview.payloadIssues.join(" / ")}</p>}
          {preview.candidates.map((candidate, index) => (
            <div className="import-candidate" key={`${candidate.type}-${str(candidate.entry.title)}-${index}`}>
              <div>
                <strong>{str(candidate.entry.title) || "無題"}</strong>
                <small>{candidate.type} / {candidate.theme?.name || "Theme未解決"}{candidate.duplicate ? ` / 既存候補: ${str(candidate.duplicate.title)}` : ""} / source: {candidate.sourceRecordTitle}</small>
                {candidate.issues.length > 0 && <p className="field-help">確認: {candidate.issues.join(" / ")}</p>}
              </div>
              <select value={candidate.action} onChange={(event) => setPreview((current) => current ? { ...current, candidates: current.candidates.map((entry, itemIndex) => itemIndex === index ? { ...entry, action: event.target.value } : entry) } : current)}>
                <option value="create">新規作成</option>
                {candidate.duplicate && <option value="merge">既存を更新</option>}
                <option value="ignore">無視</option>
              </select>
            </div>
          ))}
          <div className="form-actions">
            <button className="secondary-button" onClick={() => setPreview(null)}>戻る</button>
            <button className="primary-button" onClick={executeImport}>取り込む</button>
          </div>
        </section>
      )}
    </div>
  );
}

``

### $relative

``tsx
import { useEffect, useMemo, useState } from "react";
import { IconCalendarCheck, IconFlag, IconFlagFilled } from "@tabler/icons-react";

import { todayIso } from "../../../utils/dataFormat.js";
import type { Item, PageProps } from "../types";
import { defaultLevel } from "../lib/domain";
import { uuid } from "../lib/format";
import { EmptyState, PageHeader } from "../components/common";

type InboxKind = "task" | "memo" | "link" | "waiting" | "idea";

interface InboxDraft {
  output: InboxKind;
  title: string;
  theme_id: string;
  item_id: string;
  planned_end: string;
  today_flag: boolean;
  priority: string;
  description: string;
  link_url: string;
  link_type: string;
  reference_status: string;
}

function draftFromItem(item: Item): InboxDraft {
  return {
    output: item.kind === "waiting" || item.status === "waiting" ? "waiting" : item.kind === "idea" ? "idea" : "task",
    title: item.title,
    theme_id: item.theme_id || "",
    item_id: "",
    planned_end: item.planned_end || "",
    today_flag: item.today_flag === true,
    priority: item.priority === "high" ? "high" : "normal",
    description: item.description || "",
    link_url: "",
    link_type: "chatgpt",
    reference_status: "inbox",
  };
}

function isInboxLike(item: Item): boolean {
  return item.status === "inbox" || item.kind === "idea";
}

export function InboxPage({ themes, items, openDrawer, saveEntity, removeEntityQuiet, setToast }: PageProps) {
  const inboxItems = useMemo(() => items.filter(isInboxLike), [items]);
  const [drafts, setDrafts] = useState<Record<string, InboxDraft>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const today = todayIso();

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      for (const item of inboxItems) {
        if (!next[item.id]) next[item.id] = draftFromItem(item);
      }
      for (const id of Object.keys(next)) {
        if (!inboxItems.some((item) => item.id === id)) delete next[id];
      }
      return next;
    });
  }, [inboxItems]);

  function patchDraft(id: string, patch: Partial<InboxDraft>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  async function organize(item: Item) {
    const draft = drafts[item.id] || draftFromItem(item);
    const title = draft.title.trim();
    if (!title) {
      setToast("タイトルを入力してください。入力内容は保持されています。");
      return;
    }
    if (draft.output === "link" && !draft.link_url.trim()) {
      setToast("リンクに整理するにはURLを入力してください。入力内容は保持されています。");
      return;
    }
    const themeId = draft.theme_id || null;
    const common = {
      title,
      theme_id: themeId,
      description: draft.description,
      source_record_id: item.source_record_id || null,
    };
    try {
      if (draft.output === "memo") {
        await saveEntity("note", {
          id: uuid(),
          title,
          body_markdown: draft.description || item.description || title,
          note_type: "memo",
          theme_id: themeId,
          item_id: null,
          source_url: "",
          source_record_id: item.source_record_id || null,
        });
        await removeEntityQuiet("item", item.id);
      } else if (draft.output === "link") {
        await saveEntity("link", {
          id: uuid(),
          ...common,
          url: draft.link_url.trim(),
          link_type: draft.link_type,
          item_id: draft.item_id || null,
          note_id: null,
          reference_status: draft.reference_status,
          importance: draft.priority === "high" ? "high" : "normal",
          captured_at: new Date().toISOString().slice(0, 10),
        });
        await removeEntityQuiet("item", item.id);
      } else {
        const kind = draft.output === "waiting" ? "waiting" : draft.output === "idea" ? "idea" : "task";
        await saveEntity("item", {
          ...item,
          title,
          kind,
          level: defaultLevel(kind),
          theme_id: themeId,
          status: draft.output === "waiting" ? "waiting" : draft.output === "idea" ? "inbox" : "todo",
          priority: draft.priority,
          planned_end: draft.planned_end || null,
          planned_start: item.planned_start || null,
          today_flag: draft.today_flag,
          is_personal_task: !themeId,
          description: draft.description,
        });
      }
      setSelected((current) => current.filter((id) => id !== item.id));
      setToast("Inboxを整理しました。");
    } catch {
      // saveEntity側のtoastを使い、draftは消さない。
    }
  }

  async function organizeSelectedAsTasks() {
    for (const id of selected) {
      const item = inboxItems.find((entry) => entry.id === id);
      if (item) await organize(item);
    }
  }

  return (
    <div className="page inbox-page">
      <PageHeader title="Inbox整理" subtitle="クイック記録を行の中で分類し、今日の作業やThemeへ接続します。">
        <button className="secondary-button" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { status: "inbox", kind: "idea" } })}>記録を追加</button>
        <button className="secondary-button" onClick={() => openDrawer({ type: "link", mode: "edit", entity: { link_type: "chatgpt", reference_status: "inbox", captured_at: new Date().toISOString().slice(0, 10) } })}>チャットリンクを追加</button>
        <button className="primary-button" disabled={!selected.length} onClick={organizeSelectedAsTasks}>{selected.length ? `${selected.length}件を整理` : "選択して整理"}</button>
      </PageHeader>
      <section className="panel inbox-panel">
        <div className="section-heading">
          <h2>未整理</h2>
          <span>{inboxItems.length}件</span>
        </div>
        {inboxItems.length ? (
          <div className="inbox-list">
            {inboxItems.map((item) => {
              const draft = drafts[item.id] || draftFromItem(item);
              return (
                <div className="inbox-card" key={item.id}>
                  <div className="inbox-card-main">
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))}
                      aria-label={`${item.title}を選択`}
                    />
                    <label>種類
                      <select value={draft.output} onChange={(event) => patchDraft(item.id, { output: event.target.value as InboxKind })}>
                        <option value="task">タスク</option>
                        <option value="memo">メモ</option>
                        <option value="link">リンク</option>
                        <option value="waiting">待ち</option>
                        <option value="idea">アイデア</option>
                      </select>
                    </label>
                    <label className="inbox-title-field">タイトル
                      <input value={draft.title} onChange={(event) => patchDraft(item.id, { title: event.target.value })} />
                    </label>
                    <label>Theme
                      <select value={draft.theme_id} onChange={(event) => patchDraft(item.id, { theme_id: event.target.value })}>
                        <option value="">個人業務</option>
                        {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
                      </select>
                    </label>
                    <label>予定日
                      <input type="date" value={draft.planned_end} onChange={(event) => patchDraft(item.id, { planned_end: event.target.value })} />
                    </label>
                    <button
                      className={`today-plan-button ${draft.today_flag ? "is-active" : ""}`}
                      onClick={() => patchDraft(item.id, { today_flag: !draft.today_flag, planned_end: !draft.today_flag && !draft.planned_end ? today : draft.planned_end })}
                      aria-label={draft.today_flag ? "今日やるから外す" : "今日やるに入れる"}
                      title={draft.today_flag ? "今日やるから外す" : "今日やるに入れる"}
                    >
                      <IconCalendarCheck size={16} />
                    </button>
                    <button
                      className={`priority-flag-button ${draft.priority === "high" ? "is-active" : ""}`}
                      onClick={() => patchDraft(item.id, { priority: draft.priority === "high" ? "normal" : "high" })}
                      aria-label={draft.priority === "high" ? "優先フラグを外す" : "優先フラグを付ける"}
                      title={draft.priority === "high" ? "優先フラグを外す" : "優先フラグを付ける"}
                    >
                      {draft.priority === "high" ? <IconFlagFilled size={16} /> : <IconFlag size={16} />}
                    </button>
                  </div>
                  <div className="inbox-card-details">
                    {draft.output === "link" && (
                      <div className="inbox-link-fields">
                        <label>URL
                          <input value={draft.link_url} onChange={(event) => patchDraft(item.id, { link_url: event.target.value })} placeholder="https://chatgpt.com/..." />
                        </label>
                        <label>サービス
                          <select value={draft.link_type} onChange={(event) => patchDraft(item.id, { link_type: event.target.value })}>
                            <option value="chatgpt">ChatGPT</option>
                            <option value="claude">Claude</option>
                            <option value="gemini">Gemini</option>
                            <option value="copilot">Copilot</option>
                            <option value="other">その他</option>
                          </select>
                        </label>
                        <label>実施事項
                          <select value={draft.item_id} onChange={(event) => patchDraft(item.id, { item_id: event.target.value })}>
                            <option value="">未設定</option>
                            {items
                              .filter((entry) => !draft.theme_id || entry.theme_id === draft.theme_id)
                              .map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
                          </select>
                        </label>
                        <label>参照状態
                          <select value={draft.reference_status} onChange={(event) => patchDraft(item.id, { reference_status: event.target.value })}>
                            <option value="inbox">未整理</option>
                            <option value="keep">参照</option>
                            <option value="adopted">採用</option>
                            <option value="pending">再確認</option>
                            <option value="stale">古い</option>
                          </select>
                        </label>
                      </div>
                    )}
                    <label>説明・補足
                      <textarea value={draft.description} onChange={(event) => patchDraft(item.id, { description: event.target.value })} />
                    </label>
                    <div className="form-actions">
                      <button className="secondary-button compact" onClick={() => openDrawer({ type: "item", entity: item })}>詳細</button>
                      <button className="primary-button compact" onClick={() => organize(item)}>整理する</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="未整理の記録はありません" action="記録を追加" onAction={() => openDrawer({ type: "item", mode: "edit", entity: { status: "inbox", kind: "idea" } })} />
        )}
      </section>
    </div>
  );
}

``

### $relative

``tsx
import { useMemo, useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { KnowledgeNode, PageProps } from "../types";
import { KNOWLEDGE_NODE_LABELS, KNOWLEDGE_RELATION_LABELS } from "../lib/domain";
import { str } from "../lib/format";
import { buildKnowledgeHealth } from "../lib/knowledgeHealth";
import { EmptyState, PageHeader, StatusBadge } from "../components/common";

const ALL = "all";

export function KnowledgePage({ data, themes, openDrawer, setToast }: PageProps) {
  const [query, setQuery] = useState("");
  const [themeId, setThemeId] = useState(ALL);
  const [nodeType, setNodeType] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const nodes = data.knowledge_nodes || [];
  const relations = data.knowledge_relations || [];

  const visible = useMemo(() => nodes.filter((node) => {
    const text = `${node.title} ${node.body ?? ""}`.toLowerCase();
    return (!query || text.includes(query.toLowerCase()))
      && (themeId === ALL || node.theme_id === themeId)
      && (nodeType === ALL || node.node_type === nodeType)
      && (status === ALL || node.status === status);
  }).sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || ""))), [nodes, query, themeId, nodeType, status]);
  const healthIssues = useMemo(() => buildKnowledgeHealth(visible, relations, data.items || []), [visible, relations, data.items]);

  function relationCount(node: KnowledgeNode) {
    return relations.filter((relation) => relation.source_node_id === node.id || relation.target_node_id === node.id).length;
  }

  function themeName(id?: string | null) {
    return themes.find((theme) => theme.id === id)?.name || "未設定";
  }

  function copy() {
    const text = visible.map((node) => [
      KNOWLEDGE_NODE_LABELS[node.node_type] || node.node_type,
      node.title,
      themeName(node.theme_id),
      node.confidence || "medium",
      node.status || "active",
      relationCount(node),
    ].join("\t")).join("\n");
    workspaceApi.copyText(text).then(() => setToast("Knowledge一覧をコピーしました。"));
  }

  return (
    <div className="page">
      <PageHeader title="Knowledge" subtitle="メモから抽出した問い・根拠・主張・決定を整理します">
        <button className="secondary-button" onClick={copy}>一覧をコピー</button>
        <button className="primary-button" onClick={() => openDrawer({ type: "knowledge_node", mode: "edit", entity: {} })}>Knowledgeを追加</button>
      </PageHeader>
      <div className="filter-bar panel">
        <input data-search value={query} onChange={(event) => setQuery(event.target.value)} placeholder="タイトル・本文を検索" />
        <select value={themeId} onChange={(event) => setThemeId(event.target.value)} aria-label="Theme">
          <option value={ALL}>すべてのTheme</option>
          {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
        </select>
        <select value={nodeType} onChange={(event) => setNodeType(event.target.value)} aria-label="Node type">
          <option value={ALL}>すべての種類</option>
          {Object.entries(KNOWLEDGE_NODE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status">
          <option value={ALL}>すべての状態</option>
          <option value="active">active</option>
          <option value="resolved">resolved</option>
          <option value="deprecated">deprecated</option>
          <option value="rejected">rejected</option>
        </select>
        <span>{visible.length}件</span>
      </div>
      <section className="panel list-page">
        <div className="section-heading"><h2>Health Check</h2><span>{healthIssues.length}件</span></div>
        {healthIssues.slice(0, 8).map((issue) => (
          <button className="wide-row" key={issue.id} onClick={() => openDrawer({ type: "knowledge_node", entity: issue.node })}>
            <strong>{issue.node.title}</strong>
            <span>{issue.message} {issue.action}</span>
          </button>
        ))}
        {!healthIssues.length && <div className="empty-state"><strong>目立つ問題はありません</strong></div>}
      </section>
      <section className="panel list-page">
        <div className="section-heading"><h2>Nodes</h2><span>{visible.length}件</span></div>
        {visible.map((node) => {
          const related = relationCount(node);
          const sourceNote = data.notes.find((note) => note.id === node.source_note_id);
          return (
            <div className="note-row" key={node.id}>
              <button className="note-row-main" onClick={() => openDrawer({ type: "knowledge_node", entity: node })}>
                <span className="note-row-head">
                  <StatusBadge value={node.status} label={KNOWLEDGE_NODE_LABELS[node.node_type] || node.node_type} />
                  <strong className="note-row-title">{node.title}</strong>
                  <span className="comment-count" aria-label={`${related}件の関係`}>{related}</span>
                </span>
                <span className="note-row-body">
                  {themeName(node.theme_id)} / {node.confidence || "medium"} / {sourceNote ? `source: ${sourceNote.title}` : "sourceなし"} / {str(node.body) || "本文なし"}
                </span>
              </button>
              <button className="secondary-button compact note-row-open" onClick={() => openDrawer({ type: "knowledge_relation", mode: "edit", entity: { source_node_id: node.id } })}>
                関係を追加
              </button>
            </div>
          );
        })}
        {!visible.length && <EmptyState title="Knowledgeはまだありません" action="Knowledgeを追加" onAction={() => openDrawer({ type: "knowledge_node", mode: "edit", entity: {} })} />}
      </section>
      {relations.length > 0 && (
        <section className="panel list-page">
          <div className="section-heading"><h2>Relations</h2><span>{relations.length}件</span></div>
          {relations.slice(0, 20).map((relation) => {
            const source = nodes.find((node) => node.id === relation.source_node_id);
            const target = nodes.find((node) => node.id === relation.target_node_id);
            return (
              <button className="wide-row" key={relation.id} onClick={() => openDrawer({ type: "knowledge_relation", mode: "edit", entity: relation })}>
                <strong>{source?.title || "不明"} → {target?.title || "不明"}</strong>
                <span>{KNOWLEDGE_RELATION_LABELS[relation.relation_type || "supports"] || relation.relation_type} / {relation.confidence || "medium"}</span>
              </button>
            );
          })}
        </section>
      )}
    </div>
  );
}

``

### $relative

``tsx
import { useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import { todayIso } from "../../../utils/dataFormat.js";
import type { PageProps } from "../types";
import { themeColor } from "../lib/domain";
import { addDays, compareDate, formatDate } from "../lib/format";
import { EmptyState, PageHeader } from "../components/common";

export function MilestonePage({ data, themes, items, openDrawer, setToast }: PageProps) {
  const [range, setRange] = useState("90");
  const today = todayIso();
  const limit = addDays(today, Number(range));
  const allThemes = data.themes || [];
  const records = items
    .filter((item) => {
      const date = item.planned_end;
      return Boolean(item.kind === "milestone" && date && date >= today && date <= limit);
    })
    .sort(compareDate);

  function copy() {
    workspaceApi
      .copyText(records.map((item) => `${item.planned_end}\t${allThemes.find((theme) => theme.id === item.theme_id)?.name || "—"}\t${item.title}`).join("\n"))
      .then(() => setToast("マイルストーンをコピーしました。"));
  }

  return (
    <div className="page">
      <PageHeader title="マイルストーン" subtitle="重要な節目だけをTheme横断で確認します。">
        <button className="secondary-button" onClick={copy}>一覧をコピー</button>
        <button className="primary-button" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "milestone" } })}>マイルストーンを追加</button>
      </PageHeader>
      <div className="filter-bar panel">
        <div className="segmented">{[["30", "30日"], ["90", "90日"], ["180", "半期"], ["365", "年度"]].map(([id, label]) => <button key={id} className={range === id ? "is-active" : ""} onClick={() => setRange(id)}>{label}</button>)}</div>
        <span>{records.length}件</span>
      </div>
      <section className="panel milestone-map">
        {records.map((item) => {
          const theme = allThemes.find((entry) => entry.id === item.theme_id);
          const themeIndex = Math.max(0, allThemes.findIndex((entry) => entry.id === item.theme_id));
          return (
            <button
              key={item.id}
              className="milestone-row"
              style={{ "--chip-color": `var(--color-${themeColor(theme, themeIndex)})` } as React.CSSProperties}
              onClick={() => openDrawer({ type: "item", entity: item })}
            >
              <time>{formatDate(item.planned_end)}</time>
              <strong><span className="chip-dot" />{theme?.name || "Themeなし"}</strong>
              <span>{item.title}</span>
            </button>
          );
        })}
        {!records.length && <EmptyState title="この期間のマイルストーンはありません" action="追加する" onAction={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "milestone" } })} />}
      </section>
    </div>
  );
}

``

### $relative

``tsx
import { useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { BaseRecord, NoteComment, PageProps } from "../types";
import { NOTE_TYPE_LABELS } from "../lib/domain";
import { str } from "../lib/format";
import { EmptyState, PageHeader, StatusBadge } from "../components/common";

type Combined = BaseRecord & { recordType: "note" | "link" };

export function NotesPage({ themes, notes, links, openDrawer, setToast }: PageProps) {
  const [query, setQuery] = useState("");
  const records: Combined[] = [
    ...notes.map((note) => ({ ...note, recordType: "note" as const })),
    ...links
      .filter((link) => !notes.some((note) => note.source_url && note.source_url === link.url))
      .map((link) => ({ ...link, recordType: "link" as const })),
  ].sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  const visible = records.filter((record) =>
    `${str(record.title)} ${str(record.body_markdown || record.description)} ${str(record.url || record.source_url)}`
      .toLowerCase()
      .includes(query.toLowerCase()));

  function copy() {
    workspaceApi
      .copyText(visible.map((record) => `${str(record.title)}\t${record.recordType === "link" ? "link" : str(record.note_type)}\t${themes.find((theme) => theme.id === record.theme_id)?.name || "—"}\t${str(record.url || record.source_url)}`).join("\n"))
      .then(() => setToast("Notes一覧をコピーしました。"));
  }

  return (
    <div className="page">
      <PageHeader title="Notes">
        <button className="secondary-button" onClick={copy}>一覧をコピー</button>
        <button className="primary-button" onClick={() => openDrawer({ type: "note", mode: "edit", entity: {} })}>メモを書く</button>
      </PageHeader>
      <div className="filter-bar panel">
        <input data-search value={query} onChange={(event) => setQuery(event.target.value)} placeholder="タイトル、本文、URLを検索" />
        <span>{visible.length}件</span>
      </div>
      <section className="panel list-page">
        {visible.map((record) => {
          const comments = record.comments as NoteComment[] | undefined;
          const url = str(record.source_url || record.url);
          return (
            <div className="note-row" key={`${record.recordType}-${record.id}`}>
              <button className="note-row-main" onClick={() => openDrawer({ type: record.recordType, entity: record })}>
                <span className="note-row-head">
                  <StatusBadge value="neutral" label={record.recordType === "link" ? "リンク" : (NOTE_TYPE_LABELS[str(record.note_type)] || str(record.note_type))} />
                  <strong className="note-row-title">{str(record.title)}</strong>
                  {record.recordType === "note" && comments && comments.length > 0 && <span className="comment-count" aria-label={`${comments.length}件のコメント`}>{comments.length}</span>}
                </span>
                <span className="note-row-body">{str(record.body_markdown || record.description || record.url) || "本文なし"}</span>
              </button>
              {url && <a className="secondary-button compact note-row-open" href={url} target="_blank" rel="noreferrer">開く</a>}
            </div>
          );
        })}
        {!visible.length && <EmptyState title="一致するメモはありません" action="メモを書く" onAction={() => openDrawer({ type: "note", mode: "edit", entity: {} })} />}
      </section>
    </div>
  );
}

``

### $relative

``tsx
import { useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { PageProps, SnapshotChange, SnapshotPreview, Theme } from "../types";
import { entityTitle } from "../lib/domain";
import { PageHeader } from "../components/common";

interface SettingsPageProps extends PageProps {
  themeMode: "light" | "dark";
  setThemeMode: (mode: "light" | "dark") => void;
  activeGroup: string;
  setActiveGroup: (group: string) => void;
  allThemes: Theme[];
  loadSample: () => Promise<unknown>;
}

export function SettingsPage({ data, themeMode, setThemeMode, activeGroup, setActiveGroup, allThemes, setSnapshotPreview, snapshotPreview, setToast, loadSample }: SettingsPageProps) {
  const [busy, setBusy] = useState(false);
  const isEmpty = (data.themes.length + data.items.length + data.notes.length + data.links.length) === 0;

  async function addSample() {
    if (!isEmpty) {
      setToast("既にデータがあります。サンプルは追加されません。");
      return;
    }
    setBusy(true);
    try {
      await loadSample();
      await workspaceApi.reload();
    } catch (error) {
      setToast(`サンプルを追加できませんでした。${error instanceof Error ? error.message : String(error)}`);
      setBusy(false);
    }
  }

  async function exportSnapshot() {
    setBusy(true);
    try {
      const result = await workspaceApi.exportSnapshot();
      if (!result.canceled) setToast("作業台Snapshotを書き出しました。");
    } catch (error) {
      setToast(`Snapshotを書き出せませんでした。${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function inspectSnapshot() {
    setBusy(true);
    try {
      const result = await workspaceApi.inspectSnapshot();
      if (!result.canceled && result.token) {
        const changes = (result.changes as SnapshotChange[] | undefined) || [];
        const preview: SnapshotPreview = {
          token: result.token,
          manifest: result.manifest,
          changes,
          decisions: Object.fromEntries(changes.map((change) => [change.key, change.action])),
        };
        setSnapshotPreview(preview);
      }
    } catch (error) {
      setToast(`Snapshotを読み込めませんでした。${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function applySnapshot() {
    if (!snapshotPreview) return;
    setBusy(true);
    try {
      await workspaceApi.applySnapshot(snapshotPreview.token, snapshotPreview.decisions);
      await workspaceApi.reload();
    } catch (error) {
      setToast(`Snapshotを反映できませんでした。${error instanceof Error ? error.message : String(error)}`);
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader title="Settings" />
      <div className="settings-grid">
        <section className="panel settings-form">
          <h2>表示</h2>
          <label>カラーモード
            <select value={themeMode} onChange={(event) => setThemeMode(event.target.value === "dark" ? "dark" : "light")}>
              <option value="light">ライト</option>
              <option value="dark">ダーク</option>
            </select>
          </label>
          <h2>テーマグループ</h2>
          <label>活動中のグループ
            <select value={activeGroup} onChange={(event) => setActiveGroup(event.target.value)}>
              <option value="">すべて表示</option>
              {[...new Set(allThemes.map((t) => t.group).filter(Boolean))].map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </label>
          <p className="field-help">グループを選ぶと、サイドバーに表示されるテーマが絞り込まれます。テーマ編集でグループを設定してください。</p>
        </section>
        <section className="panel settings-form">
          <h2>バックアップ</h2>
          <p className="field-help">端末間の移行や復元にはZIP形式のSnapshotを使います。</p>
          <button className="secondary-button" disabled={busy} onClick={exportSnapshot}>バックアップを書き出す</button>
          <button className="secondary-button" disabled={busy} onClick={inspectSnapshot}>バックアップを読み込む</button>
          <h2>サンプルデータ</h2>
          <p className="field-help">{isEmpty ? "空の状態です。研究テーマ・タスクの例を入れて操作を試せます（あとから削除できます）。" : "既にデータがあるため、サンプルは追加できません。"}</p>
          <button className="secondary-button" disabled={busy || !isEmpty} onClick={addSample}>サンプルデータを入れる</button>
        </section>
      </div>
      {snapshotPreview && (
        <section className="panel snapshot-preview">
          <div className="section-heading"><h2>Snapshot差分</h2><span>{snapshotPreview.changes.length}件</span></div>
          {snapshotPreview.changes.map((change) => (
            <div className="import-candidate" key={change.key}>
              <div>
                <strong>{entityTitle(change.type, change.incoming)}</strong>
                <small>{change.type} / {change.category}</small>
              </div>
              <select value={snapshotPreview.decisions[change.key]} onChange={(event) => setSnapshotPreview({ ...snapshotPreview, decisions: { ...snapshotPreview.decisions, [change.key]: event.target.value } })}>
                {(change.actions || ["ignore"]).map((action) => (
                  <option key={action} value={action}>{action === "ignore" ? "無視" : action === "create" ? "新規作成" : action === "update" ? "既存を更新" : "両方残す"}</option>
                ))}
              </select>
            </div>
          ))}
          <div className="form-actions">
            <button className="secondary-button" onClick={() => setSnapshotPreview(null)}>取り消す</button>
            <button className="primary-button" disabled={busy} onClick={applySnapshot}>選択内容を反映</button>
          </div>
        </section>
      )}
    </div>
  );
}

``

### $relative

``tsx
import type { PageProps } from "../types";
import { THEME_STATUS_LABELS, themeColor } from "../lib/domain";
import { PageHeader, StatusBadge } from "../components/common";

export function ThemesPage({ themes, items, data, activeThemeId, setActiveThemeId, navigate, openDrawer }: PageProps) {
  return (
    <div className="page">
      <PageHeader title="Themes" subtitle="研究テーマごとの現在地と負荷を確認します。">
        <button className="primary-button" onClick={() => openDrawer({ type: "theme", mode: "edit", entity: {} })}>テーマを追加</button>
      </PageHeader>
      <div className="theme-card-grid">
        {themes.map((theme, index) => {
          const related = items.filter((item) => item.theme_id === theme.id);
          const latest = (data.status_updates || [])
            .filter((entry) => entry.theme_id === theme.id)
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
          return (
            <article
              className={`panel theme-card ${activeThemeId === theme.id ? "selected" : ""}`}
              key={theme.id}
              style={{ "--chip-color": `var(--color-${themeColor(theme, index)})` } as React.CSSProperties}
            >
              <div className="theme-card-top">
                <StatusBadge value={theme.status} label={THEME_STATUS_LABELS[theme.status ?? ""] || theme.status} />
                <button className="secondary-button compact" onClick={() => openDrawer({ type: "theme", mode: "edit", entity: theme })}>編集</button>
              </div>
              <h2>{theme.name}</h2>
              <p>{latest?.summary || theme.description || "現在地は未記録です。"}</p>
              <div>
                <span><strong className="metric-value">{related.filter((item) => item.status !== "done").length}</strong> 未完了</span>
                <span><strong className="metric-value">{related.filter((item) => item.status === "waiting").length}</strong> 待ち</span>
              </div>
              <button className="text-button compact" onClick={() => { setActiveThemeId(theme.id); navigate("home"); }}>開く</button>
            </article>
          );
        })}
      </div>
    </div>
  );
}

``

### $relative

``tsx
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { todayIso } from "../../../utils/dataFormat.js";
import { usePersistentState } from "../../../utils/usePersistentState";
import type { Item, PageProps } from "../types";
import { STATUS_LABELS, hasPlannedSchedule, itemLevel, themeColor } from "../lib/domain";
import { addDays, daysBetween, formatDate, uuid } from "../lib/format";
import { buildTimelineRows, dataRange, scaleFromDayWidth, ZOOM_PRESETS, MIN_DAY_WIDTH, MAX_DAY_WIDTH } from "../lib/timeline";
import { type ConnectingState, type SelectedDependency, DependencyOverlay, GanttItemRow, LightningOverlay, MilestoneLane, TimeAxis } from "../components/gantt";
import { PageHeader, StatusBadge } from "../components/common";

type DragMode = "move" | "start" | "end";

interface TimelineUndo {
  label: string;
  run(): Promise<void>;
}

interface TimelinePrefs {
  dayWidth: number;
  themeFilter: string;
  showCompleted: boolean;
  showDependencies: boolean;
  showLightning: boolean;
}
const DEFAULT_PREFS: TimelinePrefs = {
  dayWidth: 8,
  themeFilter: "all",
  showCompleted: true,
  showDependencies: true,
  showLightning: true,
};

export function TimelinePage({ data, themes, items, openDrawer, saveEntity, removeEntityQuiet, setToast }: PageProps) {
  const [prefs, setPrefs] = usePersistentState<TimelinePrefs>("timeline:prefs:v5", DEFAULT_PREFS);
  const { dayWidth, themeFilter, showCompleted, showDependencies, showLightning } = prefs;
  const scale = scaleFromDayWidth(dayWidth);
  const updatePrefs = (patch: Partial<TimelinePrefs>) => setPrefs((current) => ({ ...current, ...patch }));
  const [collapsedThemes, setCollapsedThemes] = useState<string[]>([]);
  const [connecting, setConnecting] = useState<ConnectingState | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [selectedDep, setSelectedDep] = useState<SelectedDependency | null>(null);
  const [editingTitle, setEditingTitle] = useState<{ id: string; value: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const undoStack = useRef<TimelineUndo[]>([]);
  const today = todayIso();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inInput = ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "") || target?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey && !inInput) {
        event.preventDefault();
        void undoTimelineOperation();
        return;
      }
      if (event.key === "Escape") {
        setConnecting(null);
        setConnectMode(false);
        setSelectedDep(null);
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedDep) {
        event.preventDefault();
        void deleteDependency(selectedDep);
      }
    };
    addEventListener("keydown", onKeyDown);
    return () => removeEventListener("keydown", onKeyDown);
  }, [selectedDep]);

  function pushUndo(entry: TimelineUndo) {
    undoStack.current = [...undoStack.current.slice(-19), entry];
  }

  async function undoTimelineOperation() {
    const entry = undoStack.current.pop();
    if (!entry) {
      setToast("元に戻せるガント操作はありません。");
      return;
    }
    try {
      await entry.run();
      setToast(`${entry.label}を元に戻しました。`);
    } catch {
      setToast("元に戻せませんでした。変更後のデータを確認してください。");
    }
  }

  async function deleteDependency(sel: SelectedDependency) {
    try {
      await removeEntityQuiet("dependency", sel.dependency.id);
      pushUndo({
        label: "依存削除",
        run: async () => {
          await saveEntity("dependency", sel.dependency);
        },
      });
      setToast("依存を削除しました。Ctrl+Zで元に戻せます。");
    } catch {
      setToast("依存を削除できませんでした。");
    }
    setSelectedDep(null);
  }

  const handleConnect = useCallback(async (target: Item) => {
    if (!connecting) return;
    if (target.id === connecting.sourceId) {
      setConnecting(null);
      return;
    }
    const exists = (data.dependencys || []).some(
      (d) => d.source_item_id === connecting.sourceId && d.target_item_id === target.id,
    );
    if (exists) {
      setToast("この依存関係はすでに登録されています。");
      setConnecting(null);
      return;
    }
    try {
      const saved = await saveEntity("dependency", {
        id: uuid(),
        source_item_id: connecting.sourceId,
        target_item_id: target.id,
        dependency_type: "finish_to_start",
      });
      pushUndo({
        label: "依存追加",
        run: async () => {
          await removeEntityQuiet("dependency", saved.id);
        },
      });
      setToast(`依存を追加: ${connecting.sourceTitle} → ${target.title}`);
    } catch {
      // saveEntity already shows error toast
    }
    setConnecting(null);
    setConnectMode(false);
  }, [connecting, data.dependencys, saveEntity, setToast]);

  function startConnecting(item: Item) {
    if (!connecting && !connectMode) return;
    if (!connecting || !connecting.sourceId) {
      setConnecting({ sourceId: item.id, sourceTitle: item.title });
    } else {
      handleConnect(item);
    }
  }

  function handleCtrlClick(item: Item) {
    if (!connecting) {
      setConnecting({ sourceId: item.id, sourceTitle: item.title });
      setSelectedDep(null);
    } else {
      handleConnect(item);
    }
  }
  const range = dataRange(items, today);
  const timelineItems = items.filter((item) => {
    if (!showCompleted && item.status === "done") return false;
    if (themeFilter !== "all" && item.theme_id !== themeFilter) return false;
    return true;
  });
  const rows = buildTimelineRows({ items: timelineItems, themes, collapsedThemes, scale });
  const groupKeys = rows.filter((row) => row.rowType === "theme").map((row) => (row as Extract<typeof row, { rowType: "theme" }>).groupKey);
  const days = Math.max(1, daysBetween(range.start, range.end));
  const canvasWidth = Math.round(days * dayWidth);
  const todayLeft = (daysBetween(range.start, today) / days) * 100;

  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (!didInitialScroll.current && scrollRef.current) {
      scrollToday();
      didInitialScroll.current = true;
    }
  }, []);

  const dayWidthRef = useRef(dayWidth);
  dayWidthRef.current = dayWidth;
  const pendingScroll = useRef<{ ratio: number; mouseX: number } | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const mouseX = e.clientX - el.getBoundingClientRect().left;
      const oldWidth = el.scrollWidth;
      const ratio = (el.scrollLeft + mouseX) / oldWidth;
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      const next = Math.min(MAX_DAY_WIDTH, Math.max(MIN_DAY_WIDTH, dayWidthRef.current * factor));
      if (Math.abs(next - dayWidthRef.current) > 0.01) {
        pendingScroll.current = { ratio, mouseX };
        updatePrefs({ dayWidth: next });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useLayoutEffect(() => {
    if (pendingScroll.current && scrollRef.current) {
      const { ratio, mouseX } = pendingScroll.current;
      scrollRef.current.scrollLeft = ratio * scrollRef.current.scrollWidth - mouseX;
      pendingScroll.current = null;
    }
  }, [dayWidth]);

  function dateHint(item: Item): string {
    if (!hasPlannedSchedule(item)) return `${item.title}（予定なし）`;
    const span = `${formatDate(item.planned_start)} 〜 ${formatDate(item.planned_end)}`;
    return `${item.title}\n${span}`;
  }

  function scrollToday() {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollLeft = Math.max(0, (element.scrollWidth * todayLeft) / 100 - element.clientWidth / 2);
  }

  function resolveDropTarget(clientY: number): Item | null | undefined {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const y = clientY - canvas.getBoundingClientRect().top - 44;
    const row = rows[Math.floor(y / 44)];
    if (!row || row.rowType !== "item" || itemLevel(row.item) !== "plan") return undefined;
    return row.item;
  }

  async function renameItem(item: Item, title: string) {
    const nextTitle = title.trim();
    setEditingTitle(null);
    if (!nextTitle || nextTitle === item.title) return;
    await saveEntity("item", { ...item, title: nextTitle });
    pushUndo({
      label: "名称変更",
      run: async () => {
        await saveEntity("item", item);
      },
    });
  }

  async function moveItem(item: Item, delta: number, mode: DragMode = "move", targetParent?: Item | null) {
    if (!delta && targetParent === undefined) return;
    const next: Item = { ...item };
    if (delta) {
      if (!hasPlannedSchedule(item)) return;
      if (mode === "start") next.planned_start = addDays(item.planned_start, delta);
      else if (mode === "end") next.planned_end = addDays(item.planned_end, delta);
      else {
        next.planned_start = addDays(item.planned_start, delta);
        next.planned_end = addDays(item.planned_end, delta);
        next.due_date = null;
      }
    }
    if (targetParent && targetParent.id !== item.id && targetParent.id !== item.parent_item_id) {
      next.parent_item_id = targetParent.id;
      next.theme_id = targetParent.theme_id || null;
    }
    if (next.planned_start && next.planned_end && next.planned_end < next.planned_start) {
      setToast("開始日と終了日の順序が逆になるため変更しませんでした。");
      return;
    }
    await saveEntity("item", next);
    pushUndo({
      label: "計画変更",
      run: async () => {
        await saveEntity("item", item);
      },
    });
    setToast("日程を移動しました。Ctrl+Zで戻せます。");
  }

  return (
    <div className="page timeline-wide">
      <PageHeader title="Timeline" subtitle="実施事項ごとに、分析依頼・試験依頼・整理などの計画を並べます。">
        <button className="primary-button" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "period", level: "plan" } })}>実施事項を追加</button>
      </PageHeader>
      <section className="timeline-toolbar panel">
        <label>Theme
          <select value={themeFilter} onChange={(event) => updatePrefs({ themeFilter: event.target.value })}>
            <option value="all">すべて</option>
            {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
          </select>
        </label>
        <div className="segmented">{ZOOM_PRESETS.map(({ id, label, dayWidth: pw }) => <button key={id} className={Math.abs(dayWidth - pw) < 0.5 ? "is-active" : ""} onClick={() => { const scroll = scrollRef.current; if (scroll) { const cx = scroll.clientWidth / 2; pendingScroll.current = { ratio: (scroll.scrollLeft + cx) / scroll.scrollWidth, mouseX: cx }; } updatePrefs({ dayWidth: pw }); }}>{label}</button>)}</div>
        <label className="toggle"><input type="checkbox" checked={showCompleted} onChange={(event) => updatePrefs({ showCompleted: event.target.checked })} />完了タスク</label>
        <label className="toggle"><input type="checkbox" checked={showDependencies} onChange={(event) => updatePrefs({ showDependencies: event.target.checked })} />依存線</label>
        <label className="toggle"><input type="checkbox" checked={showLightning} onChange={(event) => updatePrefs({ showLightning: event.target.checked })} />イナズマ線</label>
        <button
          className={`secondary-button compact ${connectMode || connecting ? "is-active" : ""}`}
          onClick={() => {
            const next = !(connectMode || connecting);
            setConnectMode(next);
            setConnecting(next ? { sourceId: "", sourceTitle: "" } : null);
            setSelectedDep(null);
          }}
        >
          依存をつなぐ
        </button>
        <button className="secondary-button compact" onClick={() => setCollapsedThemes([])}>全展開</button>
        <button className="secondary-button compact" onClick={() => setCollapsedThemes(groupKeys)}>全折りたたみ</button>
      </section>
      <section className={`split-gantt panel ${connecting ? "is-connecting" : ""}`}>
        {connecting && (
          <div className="connect-status-popover" role="status" aria-live="polite">
            <span>{connecting.sourceTitle ? <>先行: <strong>{connecting.sourceTitle}</strong> → 後続タスクをクリック</> : "先行タスクをクリック"}</span>
            <button className="danger-button compact" onClick={() => { setConnecting(null); setConnectMode(false); }}>キャンセル</button>
          </div>
        )}
        <div className="gantt-table">
          <div className="gantt-table-head"><span>実施事項 / 計画</span><span>操作</span></div>
          {rows.map((row) => {
            if (row.rowType === "theme") {
              const collapsed = collapsedThemes.includes(row.groupKey);
              return (
                <div className="gantt-theme-row" key={`theme-${row.groupKey}`}>
                  <button className="gantt-theme-toggle" onClick={() => setCollapsedThemes((current) => current.includes(row.groupKey) ? current.filter((key) => key !== row.groupKey) : [...current, row.groupKey])} aria-expanded={!collapsed}>
                    <span className="gantt-theme-caret">{collapsed ? "▸" : "▾"}</span>
                    <strong>{row.theme?.name || "個人業務 / Themeなし"}</strong>
                    {row.theme && <StatusBadge value={row.theme.status} label={row.theme.status} />}
                  </button>
                  <span className="gantt-theme-count">実施事項 {row.initiativeCount} / 計画 {row.planCount}</span>
                </div>
              );
            }
            if (row.rowType === "milestones") {
              return (
                <div className="gantt-milestone-table-row" key={`milestones-${row.groupKey}`}>
                  <span>Milestones</span>
                  <strong>{row.milestones.length}</strong>
                </div>
              );
            }
            const { item, depth } = row;
            const isPlan = itemLevel(item) === "plan";
            return (
              <div className={`gantt-table-row level-${itemLevel(item)} ${connecting?.sourceId === item.id ? "is-connect-source" : ""}`} key={item.id}>
                <div className="gantt-name" style={{ paddingLeft: `calc(var(--space-2) + ${depth * 14}px)` }}>
                  {item.kind === "milestone" && <span className="gantt-milestone-mark">◆</span>}
                  {editingTitle?.id === item.id ? (
                    <input
                      className="gantt-title-input"
                      autoFocus
                      value={editingTitle.value}
                      onChange={(event) => setEditingTitle({ id: item.id, value: event.target.value })}
                      onBlur={() => renameItem(item, editingTitle.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") setEditingTitle(null);
                      }}
                    />
                  ) : (
                    <button className="gantt-title-button" onClick={(e) => {
                      if ((e.ctrlKey || e.metaKey) && !isPlan) { handleCtrlClick(item); return; }
                      isPlan && !connectMode && !connecting ? setEditingTitle({ id: item.id, value: item.title }) : connecting || connectMode ? startConnecting(item) : openDrawer({ type: "item", entity: item });
                    }}>
                      {item.title}
                    </button>
                  )}
                </div>
                {isPlan
                  ? <button className="gantt-add-plan-button" aria-label={`${item.title}に計画を追加`} title="計画を追加" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "period", level: "plan", parent_item_id: item.id, theme_id: item.theme_id, planned_start: item.planned_start, planned_end: item.planned_end } })}>＋</button>
                  : <StatusBadge value={item.status} label={STATUS_LABELS[item.status ?? ""]} />}
              </div>
            );
          })}
        </div>
        <div className="gantt-scroll" ref={scrollRef}>
          <div className="gantt-canvas" ref={canvasRef} style={{ width: canvasWidth }} onClick={() => selectedDep && setSelectedDep(null)}>
            <TimeAxis start={range.start} end={range.end} dayWidth={dayWidth} />
            <div className="gantt-today" style={{ left: `${todayLeft}%` }}><span>今日</span></div>
            {rows.map((row) => {
              if (row.rowType === "theme") return <div className="gantt-canvas-theme-row" key={`theme-${row.groupKey}`} />;
              if (row.rowType === "milestones") {
                const colorKey = themeColor(row.theme, themes.indexOf(row.theme ?? themes[0]));
                return <MilestoneLane key={`milestones-${row.groupKey}`} milestones={row.milestones} range={range} dayWidth={dayWidth} hint={dateHint} onOpen={(item) => openDrawer({ type: "item", entity: item })} onMove={(item, delta) => moveItem(item, delta, "move")} themeColorKey={colorKey} />;
              }
              const itemTheme = themes.find((t) => t.id === row.item.theme_id);
              const colorKey = themeColor(itemTheme, themes.indexOf(itemTheme ?? themes[0]));
              return <GanttItemRow key={row.item.id} item={row.item} laneItems={row.laneItems} range={range} hint={dateHint} onOpen={(item) => connecting ? startConnecting(item) : openDrawer({ type: "item", entity: item })} onMove={moveItem} connecting={connecting} onConnect={startConnecting} themeColorKey={colorKey} resolveDropTarget={resolveDropTarget} onCtrlClick={handleCtrlClick} />;
            })}
            {showDependencies && <DependencyOverlay dependencies={data.dependencys || []} rows={rows} range={range} selected={selectedDep} onSelect={setSelectedDep} />}
            {showLightning && <LightningOverlay rows={rows} range={range} today={today} />}
          </div>
        </div>
      </section>
      <div className="timeline-legend"><span><i className="legend-solid" />実施事項</span><span><i className="legend-diamond" />マイルストーン</span><span><i className="legend-task" />計画</span><span><i className="legend-lightning" />実進捗の到達日</span><span>予定なしは左表のみ</span></div>
    </div>
  );
}

``

### $relative

``tsx
import { IconCalendarPlus, IconClipboard, IconFlagFilled } from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import { todayIso } from "../../../utils/dataFormat.js";
import type { Item, PageProps } from "../types";
import { KIND_LABELS, STATUS_LABELS, hasPlannedSchedule } from "../lib/domain";
import { addDays, compareDate, formatDate } from "../lib/format";
import { EmptyState, Metric, PageHeader, StatusBadge } from "../components/common";

function itemDate(item: Item): string {
  return String(item.planned_end || item.planned_start || item.due_date || "");
}

function isOpen(item: Item): boolean {
  return item.status !== "done" && item.status !== "cancelled" && item.status !== "archived";
}

function isTodayTask(item: Item, today: string): boolean {
  return item.today_flag === true || item.planned_start === today || item.planned_end === today;
}

function TaskRows({
  items,
  themes,
  empty,
  openDrawer,
  toggleItem,
  saveEntity,
}: Pick<PageProps, "themes" | "openDrawer" | "toggleItem" | "saveEntity"> & {
  items: Item[];
  empty: string;
}) {
  if (!items.length) return <EmptyState title={empty} action="タスクを追加" onAction={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "task" } })} />;
  return (
    <div className="today-task-list">
      {items.map((item) => {
        const theme = themes.find((entry) => entry.id === item.theme_id);
        return (
          <div className="today-task-row" key={item.id}>
            <button className="check-button" aria-label={`${item.title}を完了`} onClick={() => toggleItem(item)} />
            <button className="today-task-title" onClick={() => openDrawer({ type: "item", entity: item })}>
              <strong>{item.title}</strong>
              <span>{theme?.name || "個人業務"} / {KIND_LABELS[item.kind ?? "task"] || "タスク"}</span>
            </button>
            {item.priority === "high" && <IconFlagFilled className="inline-icon accent" size={16} aria-label="優先" />}
            <StatusBadge value={item.status} label={STATUS_LABELS[item.status ?? ""] || item.status} />
            <time>{formatDate(itemDate(item))}</time>
            <button
              className={`today-plan-button ${item.today_flag ? "is-active" : ""}`}
              onClick={() => saveEntity("item", { ...item, today_flag: !item.today_flag })}
              aria-label={item.today_flag ? "今日の予定から外す" : "今日の予定に追加"}
              title={item.today_flag ? "今日の予定から外す" : "今日の予定に追加"}
            >
              <IconCalendarPlus size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function TodayPage({ data, themes, items, openDrawer, navigate, saveEntity, toggleItem, setToast }: PageProps) {
  const today = todayIso();
  const soon = addDays(today, 14);
  const openItems = items.filter(isOpen);
  const todayTasks = openItems
    .filter((item) => item.status !== "inbox" && isTodayTask(item, today))
    .sort(compareDate);
  const overdue = openItems
    .filter((item) => item.status !== "inbox" && itemDate(item) && itemDate(item) < today)
    .sort(compareDate);
  const inbox = items.filter((item) => item.status === "inbox" || item.kind === "idea");
  const noSchedule = openItems
    .filter((item) => item.status !== "inbox" && item.kind !== "milestone" && !hasPlannedSchedule(item))
    .sort((a, b) => Number(b.priority === "high") - Number(a.priority === "high") || a.title.localeCompare(b.title, "ja"));
  const milestones = openItems
    .filter((item) => item.kind === "milestone" && itemDate(item) && itemDate(item) >= today && itemDate(item) <= soon)
    .sort(compareDate);
  const waitingSoon = openItems
    .filter((item) => (item.kind === "waiting" || item.status === "waiting") && itemDate(item) && itemDate(item) <= soon)
    .sort(compareDate);
  const latestUpdates = [...(data.status_updates || [])]
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 5);

  const todayMarkdown = [
    "# Today",
    "",
    "## 今日やること",
    ...(todayTasks.length ? todayTasks.map((item) => `- [ ] ${item.title} (${themes.find((theme) => theme.id === item.theme_id)?.name || "個人業務"})`) : ["- なし"]),
    "",
    "## 期限切れ",
    ...(overdue.length ? overdue.map((item) => `- ${itemDate(item) || "予定なし"} ${item.title}`) : ["- なし"]),
    "",
    "## Waiting",
    ...(waitingSoon.length ? waitingSoon.map((item) => `- ${itemDate(item) || "予定なし"} ${item.title}${item.waiting_for ? ` / ${item.waiting_for}` : ""}`) : ["- なし"]),
  ].join("\n");

  return (
    <div className="page today-page">
      <PageHeader title="Today" subtitle="今日見るものを一か所に集めます。">
        <button className="secondary-button" onClick={() => workspaceApi.copyText(todayMarkdown).then(() => setToast("Todayの内容をコピーしました。"))}>
          <IconClipboard size={16} /> コピー
        </button>
        <button className="primary-button" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "task", today_flag: true, planned_end: today } })}>今日のタスクを追加</button>
      </PageHeader>

      <div className="metric-grid today-metrics">
        <Metric label="今日" value={todayTasks.length} tone="primary" />
        <Metric label="期限切れ" value={overdue.length} tone={overdue.length ? "danger" : ""} />
        <Metric label="Inbox" value={inbox.length} />
        <Metric label="予定なし" value={noSchedule.length} />
      </div>

      <section className="panel today-focus-panel">
        <div className="section-heading">
          <h2>今日やること</h2>
          <button className="text-button compact" onClick={() => navigate("todo")}>ToDoへ</button>
        </div>
        <TaskRows items={todayTasks} themes={themes} empty="今日のタスクはありません" openDrawer={openDrawer} toggleItem={toggleItem} saveEntity={saveEntity} />
      </section>

      <div className="today-grid">
        <section className="panel">
          <div className="section-heading"><h2>期限切れ</h2><span>{overdue.length}件</span></div>
          <TaskRows items={overdue.slice(0, 8)} themes={themes} empty="期限切れはありません" openDrawer={openDrawer} toggleItem={toggleItem} saveEntity={saveEntity} />
        </section>
        <section className="panel">
          <div className="section-heading"><h2>Inbox未整理</h2><button className="text-button compact" onClick={() => navigate("inbox")}>整理へ</button></div>
          <TaskRows items={inbox.slice(0, 8)} themes={themes} empty="未整理の記録はありません" openDrawer={openDrawer} toggleItem={toggleItem} saveEntity={saveEntity} />
        </section>
      </div>

      <div className="today-grid">
        <section className="panel">
          <div className="section-heading"><h2>予定なし</h2><span>{noSchedule.length}件</span></div>
          <TaskRows items={noSchedule.slice(0, 8)} themes={themes} empty="予定なしのタスクはありません" openDrawer={openDrawer} toggleItem={toggleItem} saveEntity={saveEntity} />
        </section>
        <section className="panel">
          <div className="section-heading"><h2>近いマイルストーン</h2><button className="text-button compact" onClick={() => navigate("timeline")}>Timelineへ</button></div>
          <TaskRows items={milestones.slice(0, 8)} themes={themes} empty="近いマイルストーンはありません" openDrawer={openDrawer} toggleItem={toggleItem} saveEntity={saveEntity} />
        </section>
      </div>

      <div className="today-grid">
        <section className="panel">
          <div className="section-heading"><h2>期限が近い待ち</h2><button className="text-button compact" onClick={() => navigate("waiting")}>Waitingへ</button></div>
          <TaskRows items={waitingSoon.slice(0, 8)} themes={themes} empty="近い待ちはありません" openDrawer={openDrawer} toggleItem={toggleItem} saveEntity={saveEntity} />
        </section>
        <section className="panel">
          <div className="section-heading"><h2>最近の現在地</h2><button className="text-button compact" onClick={() => openDrawer({ type: "status_update", mode: "edit", entity: { date: today } })}>記録する</button></div>
          <div className="today-update-list">
            {latestUpdates.length ? latestUpdates.map((entry) => (
              <button key={entry.id} className="wide-row" onClick={() => openDrawer({ type: "status_update", entity: entry })}>
                <strong>{themes.find((theme) => theme.id === entry.theme_id)?.name || "全体"}</strong>
                <span>{formatDate(entry.date)} / {entry.summary}</span>
              </button>
            )) : <EmptyState title="現在地がまだありません" action="記録する" onAction={() => openDrawer({ type: "status_update", mode: "edit", entity: { date: today } })} />}
          </div>
        </section>
      </div>
    </div>
  );
}

``

### $relative

``tsx
import { useState } from "react";
import { IconCalendarPlus, IconCalendarCheck, IconFlag, IconFlagFilled } from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import { todayIso } from "../../../utils/dataFormat.js";
import type { PageProps, SaveOperation } from "../types";
import { STATUS_LABELS, defaultLevel, hasPlannedSchedule, themeColor } from "../lib/domain";
import { addDays, formatDate } from "../lib/format";
import { parseTaskTable, type ParsedTaskRow } from "../lib/io";
import { EmptyState, PageHeader } from "../components/common";

export function TodoPage({ data, themes, items, openDrawer, saveEntity, saveEntities, toggleItem, setToast }: PageProps) {
  const [filter, setFilter] = useState("open");
  const [selected, setSelected] = useState<string[]>([]);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pastePreview, setPastePreview] = useState<ParsedTaskRow[]>([]);
  const [shiftDays, setShiftDays] = useState(7);
  const today = todayIso();
  const tasks = items.filter((item) => item.status === "inbox" || ["task", "deliverable", "reminder"].includes(item.kind ?? "") || !item.theme_id);
  const isTodayTask = (item: typeof tasks[number]) => item.today_flag === true || item.planned_end === today;
  const counters = {
    today: tasks.filter((item) => item.status !== "done" && isTodayTask(item)).length,
    open: tasks.filter((item) => item.status !== "done" && item.status !== "inbox").length,
    overdue: tasks.filter((item) => item.status !== "done" && item.planned_end && item.planned_end < today).length,
    inbox: tasks.filter((item) => item.status === "inbox").length,
    noSchedule: tasks.filter((item) => item.status !== "done" && !hasPlannedSchedule(item)).length,
    done: tasks.filter((item) => item.status === "done").length,
  };
  const visible = tasks.filter((item) => {
    if (filter === "today") return item.status !== "done" && isTodayTask(item);
    if (filter === "done") return item.status === "done";
    if (filter === "inbox") return item.status === "inbox";
    if (filter === "no-schedule") return item.status !== "done" && !hasPlannedSchedule(item);
    if (filter === "overdue") return item.status !== "done" && item.planned_end && item.planned_end < today;
    return item.status !== "done" && item.status !== "inbox";
  }).sort((a, b) => {
    const aToday = isTodayTask(a) ? 0 : 1;
    const bToday = isTodayTask(b) ? 0 : 1;
    if (aToday !== bToday) return aToday - bToday;
    return String(a.planned_end || a.planned_start || "9999-12-31").localeCompare(String(b.planned_end || b.planned_start || "9999-12-31"));
  });

  // 一括操作は1transactionで完結させ、途中失敗時に一部だけ更新された状態を残さない。
  async function bulkUpdate(field: string, value: string) {
    const operations: SaveOperation[] = selected.flatMap((id) => {
      const item = items.find((entry) => entry.id === id);
      return item ? [{ action: "save", type: "item", entity: { ...item, [field]: value } }] : [];
    });
    if (!operations.length) return;
    const count = operations.length;
    await saveEntities(operations, `${count}件を更新しました。`);
    setSelected([]);
  }

  async function shiftSelected() {
    const operations: SaveOperation[] = selected.flatMap((id) => {
      const item = items.find((entry) => entry.id === id);
      return item
        ? [{
          action: "save",
          type: "item",
          entity: {
            ...item,
            planned_start: addDays(item.planned_start, shiftDays),
            planned_end: addDays(item.planned_end, shiftDays),
            due_date: null,
          },
          options: { reason: `一括操作で${shiftDays}日シフト` },
        }]
        : [];
    });
    if (!operations.length) return;
    const count = operations.length;
    await saveEntities(operations, `${count}件の日程を${shiftDays}日移動しました。`);
    setSelected([]);
  }

  function previewPaste() {
    const rows = parseTaskTable(pasteText, themes);
    if (!rows.length) {
      setToast("貼り付け内容を読み取れませんでした。1行に1件、またはTSV/CSVの表を貼り付けてください。");
      return;
    }
    setPastePreview(rows);
  }

  async function importPaste() {
    const operations: SaveOperation[] = pastePreview.map((row, index) => ({
      action: "save",
      type: "item",
      entity: {
        id: crypto.randomUUID(),
        title: row.title,
        kind: row.kind || "task",
        level: defaultLevel(row.kind || "task"),
        theme_id: row.theme_id,
        status: row.status || "todo",
        priority: row.priority === "high" ? "high" : "normal",
        planned_start: row.planned_start ?? null,
        planned_end: row.planned_end ?? null,
        due_date: null,
        schedule_confidence: "fixed",
        date_granularity: "day",
        is_personal_task: !row.theme_id,
        sort_order: items.length + index,
        description: row.description || "",
      },
      options: { source: "pasted_table" },
    }));
    if (!operations.length) return;
    const count = operations.length;
    await saveEntities(operations, `${count}件を追加しました。`);
    setPasteText("");
    setPastePreview([]);
    setShowPaste(false);
  }

  function copyRows() {
    const header = "タスク\t状態\tテーマ\t今日\t予定終了\t旗";
    const rows = visible.map((item) => `${item.title}\t${STATUS_LABELS[item.status ?? ""]}\t${themes.find((theme) => theme.id === item.theme_id)?.name || "個人業務"}\t${isTodayTask(item) ? "今日" : ""}\t${item.planned_end || "予定なし"}\t${item.priority === "high" ? "あり" : "なし"}`);
    workspaceApi.copyText([header, ...rows].join("\n")).then(() => setToast("ToDo一覧をコピーしました。"));
  }

  return (
    <div className="page">
      <PageHeader title="ToDo" subtitle="今日の作業と予定なしの仕事を整理します。">
        <button className="secondary-button" onClick={copyRows}>一覧をコピー</button>
        <button className="secondary-button" onClick={() => setShowPaste((current) => !current)}>表から追加</button>
        <button className="primary-button" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "task" } })}>タスクを追加</button>
      </PageHeader>
      <div className="todo-filter-tabs">
        {([["today", "今日", counters.today], ["open", "未完了", counters.open], ["inbox", "Inbox", counters.inbox], ["overdue", "予定超過", counters.overdue], ["no-schedule", "予定なし", counters.noSchedule], ["done", "完了", counters.done]] as const).map(([id, label, count]) => (
          <button key={id} className={filter === id ? "is-active" : ""} onClick={() => setFilter(id)}>{label}<span className="tab-count">{count}</span></button>
        ))}
      </div>
      {showPaste && (
        <section className="panel paste-panel">
          <div className="section-heading"><h2>表から追加</h2><span>タイトル / Theme / 予定終了 / 状態 / 説明</span></div>
          <textarea value={pasteText} onChange={(event) => { setPasteText(event.target.value); setPastePreview([]); }} placeholder={"タイトル\tTheme\t予定終了\t状態\t説明\n測定条件を確認\t材料A評価\t2026-06-20\t未着手\t条件表と照合"} />
          {pastePreview.length > 0 && (
            <div className="paste-preview">
              {pastePreview.map((row, index) => (
                <div key={`${row.title}-${index}`}>
                  <strong>{row.title}</strong>
                  <span>{themes.find((theme) => theme.id === row.theme_id)?.name || "個人業務"}</span>
                  <time>{row.planned_end || "予定なし"}</time>
                </div>
              ))}
            </div>
          )}
          <div className="form-actions">
            <button className="secondary-button" onClick={() => { setShowPaste(false); setPastePreview([]); }}>閉じる</button>
            {pastePreview.length ? <button className="primary-button" onClick={importPaste}>追加する</button> : <button className="primary-button" onClick={previewPaste}>内容を確認</button>}
          </div>
        </section>
      )}
      <section className="panel list-page">
        {selected.length > 0 && (
          <div className="list-toolbar">
            <div className="inline-actions bulk-actions">
              <span>{selected.length}件選択</span>
              <button className="secondary-button compact" onClick={() => bulkUpdate("status", "done")}>完了にする</button>
              <select aria-label="Themeを一括変更" onChange={(event) => event.target.value && bulkUpdate("theme_id", event.target.value)} defaultValue="">
                <option value="">Theme変更</option>
                {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
              </select>
              <input className="shift-days" aria-label="日程を移動する日数" type="number" value={shiftDays} onChange={(event) => setShiftDays(Number(event.target.value) || 0)} />
              <button className="secondary-button compact" onClick={shiftSelected}>日程を移動</button>
            </div>
          </div>
        )}
        <div className="data-table todo-table">
          <div className="table-head"><span /><span /><span>タスク</span><span>状態</span><span>Theme</span><span>予定終了</span></div>
          {visible.map((item) => {
            const theme = (data.themes || []).find((entry) => entry.id === item.theme_id);
            const themeIndex = Math.max(0, (data.themes || []).findIndex((entry) => entry.id === item.theme_id));
            const chipColor = `var(--color-${themeColor(theme, themeIndex)})`;
            return (
            <div className="table-row" key={item.id} style={{ "--chip-color": chipColor } as React.CSSProperties}>
              <span className="todo-theme-bar" />
              <input type="checkbox" checked={selected.includes(item.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} aria-label={`${item.title}を選択`} />
              <div className="row-title-wrap">
                <button
                  className={`priority-flag-button ${item.priority === "high" ? "is-active" : ""}`}
                  onClick={() => saveEntity("item", { ...item, priority: item.priority === "high" ? "normal" : "high" })}
                  aria-label={item.priority === "high" ? "旗を外す" : "旗を付ける"}
                  title={item.priority === "high" ? "旗を外す" : "旗を付ける"}
                >
                  {item.priority === "high" ? <IconFlagFilled size={16} /> : <IconFlag size={16} />}
                </button>
                <button
                  className={`today-plan-button ${item.today_flag ? "is-active" : ""}`}
                  onClick={() => saveEntity("item", { ...item, today_flag: !item.today_flag })}
                  aria-label={item.today_flag ? "今日の予定から外す" : "今日の予定に追加"}
                  title={item.today_flag ? "今日の予定から外す" : "今日の予定に追加"}
                >
                  {item.today_flag ? <IconCalendarCheck size={16} /> : <IconCalendarPlus size={16} />}
                </button>
                <button className="row-title" onClick={() => openDrawer({ type: "item", entity: item })}>{item.title}</button>
              </div>
              {item.status === "inbox"
                ? <button className="check-action" onClick={() => saveEntity("item", { ...item, status: "todo", kind: item.kind === "idea" ? "task" : item.kind })}>整理</button>
                : <button className="check-action" onClick={() => toggleItem(item)}>{item.status === "done" ? "戻す" : "完了"}</button>}
              <span className="theme-inline">
                <span className="chip-dot" />
                {theme?.name || "個人業務"}
              </span>
              <span className="num">{formatDate(item.planned_end)}</span>
            </div>
            );
          })}
        </div>
        {!visible.length && <EmptyState title="該当するタスクはありません" action="タスクを追加" onAction={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "task" } })} />}
      </section>
    </div>
  );
}

``

### $relative

``tsx
import { workspaceApi } from "../../../services/workspaceApi";
import type { PageProps } from "../types";
import { compareDate, formatDate } from "../lib/format";
import { EmptyState, PageHeader, StatusBadge } from "../components/common";

export function WaitingPage({ themes, items, openDrawer, setToast }: PageProps) {
  const waiting = items.filter((item) => item.kind === "waiting" || item.status === "waiting").sort(compareDate);

  function copy() {
    workspaceApi
      .copyText(waiting.map((item) => `${item.title}\t${item.planned_end || "—"}\t${themes.find((theme) => theme.id === item.theme_id)?.name || "—"}`).join("\n"))
      .then(() => setToast("Waiting一覧をコピーしました。"));
  }

  return (
    <div className="page">
      <PageHeader title="Waiting" subtitle="誰を、何を、いつまで待っているかを確認します。">
        <button className="secondary-button" onClick={copy}>一覧をコピー</button>
        <button className="primary-button" onClick={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "waiting", status: "waiting" } })}>待ちを追加</button>
      </PageHeader>
      <section className="panel list-page">
        {waiting.map((item) => (
          <button className="waiting-row" key={item.id} onClick={() => openDrawer({ type: "item", entity: item })}>
            <div>
              <StatusBadge value="waiting" label="待ち" />
              <strong>{item.title}</strong>
              <span>{themes.find((theme) => theme.id === item.theme_id)?.name || "—"}</span>
            </div>
            <div>
              <time>{formatDate(item.planned_end)}</time>
            </div>
          </button>
        ))}
        {!waiting.length && <EmptyState title="待ちはありません" action="追加する" onAction={() => openDrawer({ type: "item", mode: "edit", entity: { kind: "waiting", status: "waiting" } })} />}
      </section>
    </div>
  );
}

``

### $relative

``typescript
import type {
  Entity,
  EntityType,
  SaveOperation,
  SaveOptions,
  WorkspaceMeta,
} from "../../../../shared/types/workspace";

// shared型をこの層から再エクスポートし、各ファイルの相対パスを単純化する。
export type { Entity, EntityType, SaveOperation, SaveOptions, Workspace } from "../../../../shared/types/workspace";

// DBのdata_jsonはスキーマレスなので、利用するフィールドだけを型付けし、
// それ以外はindex signatureで許容する（カスタム項目・将来フィールドのため）。
export interface BaseRecord {
  id: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
  version?: number;
  source?: string;
  [key: string]: unknown;
}

export interface Theme extends BaseRecord {
  name: string;
  description?: string;
  status?: string;
  color?: string;
  group?: string;
}

export interface Item extends BaseRecord {
  title: string;
  kind?: string;
  level?: string;
  theme_id?: string | null;
  status?: string;
  priority?: string;
  parent_item_id?: string | null;
  sort_order?: number;
  planned_start?: string | null;
  planned_end?: string | null;
  due_date?: string | null;
  actual_start?: string | null;
  actual_end?: string | null;
  baseline_start?: string | null;
  baseline_end?: string | null;
  schedule_confidence?: string;
  date_granularity?: string;
  date_text?: string;
  progress?: number;
  waiting_for?: string;
  next_action?: string;
  is_personal_task?: boolean;
  description?: string;
  source_record_id?: string | null;
  completed_at?: string | null;
  today_flag?: boolean;
}

export interface NoteComment {
  id: string;
  body: string;
  created_at: string;
}

export interface Note extends BaseRecord {
  title: string;
  body_markdown?: string;
  note_type?: string;
  theme_id?: string | null;
  item_id?: string | null;
  source_url?: string;
  source_record_id?: string | null;
  properties_json?: Record<string, unknown>;
  comments?: NoteComment[];
}

export interface Link extends BaseRecord {
  title: string;
  url: string;
  link_type?: string;
  theme_id?: string | null;
  item_id?: string | null;
  note_id?: string | null;
  description?: string;
  source_record_id?: string | null;
  reference_status?: string;
  importance?: string;
  captured_at?: string | null;
}

export interface StatusUpdate extends BaseRecord {
  theme_id?: string | null;
  date?: string;
  status?: string;
  summary?: string;
  progress?: number;
  risks?: string;
  next_actions?: string;
}

export interface SourceRecord extends BaseRecord {
  source_type?: string;
  source_title?: string;
  source_url?: string;
  captured_at?: string;
  raw_text?: string;
  summary?: string;
}

export interface FieldDefinition extends BaseRecord {
  name: string;
  field_type?: string;
  applies_to?: string;
  theme_id?: string | null;
  options_json?: string[];
  sort_order?: number;
  is_required?: boolean;
}

export interface FieldValue extends BaseRecord {
  field_definition_id?: string;
  entity_type?: string;
  entity_id?: string;
  value_text?: string;
  value_number?: number | null;
  value_date?: string | null;
  value_json?: string[] | null;
}

export interface Relation extends BaseRecord {
  source_entity_type?: string;
  source_entity_id?: string;
  target_entity_type?: string;
  target_entity_id?: string;
  relation_type?: string;
  description?: string;
}

export interface Dependency extends BaseRecord {
  source_item_id?: string;
  target_item_id?: string;
  dependency_type?: string;
}

export interface ImportBatch extends BaseRecord {
  source?: string;
  status?: string;
  count?: number;
  raw_text?: string;
  source_record_id?: string | null;
}

export interface PlanRevision extends BaseRecord {
  item_id: string;
  changed_at: string;
  reason?: string | null;
}

export type KnowledgeNodeType =
  | "source"
  | "evidence"
  | "claim"
  | "question"
  | "decision"
  | "insight";

export type KnowledgeRelationType =
  | "supports"
  | "contradicts"
  | "explains"
  | "causes"
  | "example_of"
  | "generalizes"
  | "depends_on"
  | "derived_from"
  | "answers"
  | "raises"
  | "similar_to"
  | "leads_to";

export interface KnowledgeNode extends BaseRecord {
  node_type: KnowledgeNodeType;
  title: string;
  body?: string;
  theme_id?: string | null;
  source_note_id?: string | null;
  source_link_id?: string | null;
  source_item_id?: string | null;
  confidence?: "low" | "medium" | "high";
  status?: "active" | "resolved" | "deprecated" | "rejected";
}

export interface KnowledgeRelation extends BaseRecord {
  source_node_id?: string;
  target_node_id?: string;
  relation_type?: KnowledgeRelationType;
  description?: string;
  confidence?: "low" | "medium" | "high";
}

// activeRecordsで論理削除を除外した「表示用の正本投影」。
export interface WorkspaceData {
  themes: Theme[];
  items: Item[];
  notes: Note[];
  links: Link[];
  dependencys: Dependency[];
  views: BaseRecord[];
  status_updates: StatusUpdate[];
  source_records: SourceRecord[];
  entity_sources: BaseRecord[];
  relations: Relation[];
  field_definitions: FieldDefinition[];
  field_values: FieldValue[];
  log_entries: BaseRecord[];
  import_batchs: ImportBatch[];
  knowledge_nodes: KnowledgeNode[];
  knowledge_relations: KnowledgeRelation[];
  ai_proposals: BaseRecord[];
  plan_revisions: PlanRevision[];
  meta?: WorkspaceMeta;
}

// Drawerに渡すentityは新規（idなし）と既存（id付き）の両方を取り得る。
export interface DrawerEntity {
  id?: string;
  [key: string]: unknown;
}

export type DrawerEntityType =
  | "item"
  | "theme"
  | "note"
  | "link"
  | "status_update"
  | "source_record"
  | "field_definition"
  | "relation"
  | "dependency"
  | "knowledge_node"
  | "knowledge_relation";

export interface DrawerConfig {
  type: DrawerEntityType;
  mode?: "edit";
  entity: DrawerEntity;
}

export interface SnapshotChange {
  key: string;
  type: EntityType;
  category: string;
  action: string;
  actions?: string[];
  incoming: BaseRecord;
  local?: BaseRecord | null;
}

export interface SnapshotPreview {
  token: string;
  manifest?: Record<string, unknown>;
  changes: SnapshotChange[];
  decisions: Record<string, string>;
}

export type SaveEntity = (
  type: EntityType,
  entity: DrawerEntity,
  options?: SaveOptions,
) => Promise<Entity>;

export type SaveEntities = (
  operations: SaveOperation[],
  successMessage?: string,
) => Promise<Entity[]>;

export type RemoveEntity = (type: EntityType, entity: DrawerEntity) => Promise<void>;

export type OpenDrawer = (config: DrawerConfig) => void;

export interface PageProps {
  data: WorkspaceData;
  themes: Theme[];
  items: Item[];
  notes: Note[];
  links: Link[];
  activeTheme: Theme | null;
  activeThemeId: string;
  setActiveThemeId(id: string): void;
  navigate(next: string): void;
  openDrawer: OpenDrawer;
  saveEntity: SaveEntity;
  saveEntities: SaveEntities;
  removeEntity: RemoveEntity;
  removeEntityQuiet(type: EntityType, id: string): Promise<void>;
  toggleItem(item: Item): Promise<void>;
  setToast(message: string): void;
  snapshotPreview: SnapshotPreview | null;
  setSnapshotPreview(preview: SnapshotPreview | null): void;
}

``

### $relative

``tsx
import { useEffect, useMemo, useRef, useState } from "react";

import { workspaceApi } from "../../services/workspaceApi";
import { useUiStore } from "../../stores/uiStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { todayIso } from "../../utils/dataFormat.js";
import type {
  BaseRecord,
  DrawerConfig,
  DrawerEntityType,
  Entity,
  EntityType,
  Item,
  Note,
  PlanRevision,
  SaveEntities,
  SaveEntity,
  SnapshotPreview,
  Theme,
  WorkspaceData,
} from "./types";
import { defaultLevel, entityTitle } from "./lib/domain";
import { activeRecords, formText, uuid } from "./lib/format";
import type { SaveOperation } from "./types";
import { AppState, Sidebar, ShortcutDialog } from "./components/shell";
import { EntityDrawer } from "./components/drawer";
import { HomePage } from "./pages/HomePage";
import { TodoPage } from "./pages/TodoPage";
import { TimelinePage } from "./pages/TimelinePage";
import { ThemesPage } from "./pages/ThemesPage";
import { NotesPage } from "./pages/NotesPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { WaitingPage } from "./pages/WaitingPage";
import { ImportExportPage } from "./pages/ImportExportPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TodayPage } from "./pages/TodayPage";
import { InboxPage } from "./pages/InboxPage";
import { ChatRefsPage } from "./pages/ChatRefsPage";

const ARRAY_KEYS: (keyof WorkspaceData)[] = [
  "themes", "items", "notes", "links", "dependencys", "views",
  "status_updates", "source_records", "entity_sources", "relations",
  "field_definitions", "field_values", "log_entries", "import_batchs",
  "knowledge_nodes", "knowledge_relations", "ai_proposals", "plan_revisions",
];

function emptyData(): WorkspaceData {
  return Object.fromEntries(ARRAY_KEYS.map((key) => [key, []])) as unknown as WorkspaceData;
}

function projectWorkspace(workspace: Record<string, unknown> | null): WorkspaceData {
  const result = emptyData();
  if (!workspace) return result;
  for (const key of ARRAY_KEYS) {
    const value = workspace[key];
    if (Array.isArray(value)) (result[key] as BaseRecord[]) = activeRecords(value as BaseRecord[]);
  }
  result.meta = (workspace.meta as WorkspaceData["meta"]) || undefined;
  return result;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function WorkspaceApp() {
  const workspace = useWorkspaceStore((state) => state.workspace);
  const loadState = useWorkspaceStore((state) => state.loadState);
  const loadError = useWorkspaceStore((state) => state.loadError);
  const loadWorkspaceAction = useWorkspaceStore((state) => state.load);
  const loadSampleAction = useWorkspaceStore((state) => state.loadSample);
  const saveWorkspaceEntity = useWorkspaceStore((state) => state.save);
  const saveWorkspaceEntities = useWorkspaceStore((state) => state.saveMany);
  const removeWorkspaceEntity = useWorkspaceStore((state) => state.remove);
  const restoreWorkspaceEntity = useWorkspaceStore((state) => state.restore);
  const route = useUiStore((state) => state.route);
  const setRoute = useUiStore((state) => state.setRoute);
  const activeThemeId = useUiStore((state) => state.activeThemeId);
  const setActiveThemeId = useUiStore((state) => state.setActiveThemeId);
  const [drawer, setDrawer] = useState<DrawerConfig | null>(null);
  const toast = useUiStore((state) => state.toast);
  const setToast = useUiStore((state) => state.setToast);
  const themeMode = useUiStore((state) => state.themeMode);
  const setThemeMode = useUiStore((state) => state.setThemeMode);
  const activeGroup = useUiStore((state) => state.activeGroup);
  const setActiveGroup = useUiStore((state) => state.setActiveGroup);
  const [snapshotPreview, setSnapshotPreview] = useState<SnapshotPreview | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const lastDeleted = useRef<{ type: EntityType; id: string } | null>(null);
  const drawerTrigger = useRef<HTMLElement | null>(null);

  async function loadWorkspace() {
    try {
      const loaded = await loadWorkspaceAction();
      setThemeMode((loaded.meta?.themeMode as "light" | "dark") || "light");
      setActiveGroup((loaded.meta?.activeGroup as string) || "");
      if (!useUiStore.getState().activeThemeId) {
        setActiveThemeId(activeRecords((loaded.themes as Theme[]) || [])[0]?.id || "");
      }
    } catch {
      // loadStateにerrorが入るので画面側で再試行導線を出す。
    }
  }

  const refreshWorkspace = useWorkspaceStore((state) => state.refresh);

  useEffect(() => {
    void loadWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!window.api?.app?.onWorkspaceChanged) return;
    return window.api.app.onWorkspaceChanged(() => { void refreshWorkspace(); });
  }, [refreshWorkspace]);

  useEffect(() => {
    const onHash = () => setRoute(location.hash.slice(1) || "today");
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, [setRoute]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    if (loadState === "success") {
      workspaceApi.setPreference("themeMode", themeMode).catch((error) => {
        setToast(`表示設定を保存できませんでした。${errorMessage(error)}`);
      });
    }
  }, [themeMode, loadState, setToast]);

  useEffect(() => {
    if (loadState === "success") {
      workspaceApi.setPreference("activeGroup", activeGroup).catch(() => {});
    }
  }, [activeGroup, loadState]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(timer);
  }, [toast, setToast]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const inInput = ["INPUT", "TEXTAREA", "SELECT"].includes(tag ?? "") || target?.isContentEditable;
      if (event.key === "Escape") {
        if (showShortcuts) setShowShortcuts(false);
        else if (drawer) closeDrawer();
        return;
      }
      if (inInput) return;
      if (event.key === "?") {
        event.preventDefault();
        setShowShortcuts((current) => !current);
      }
      if (event.altKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        openDrawer({ type: "item", mode: "edit", entity: {} });
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        (document.querySelector("[data-search]") as HTMLElement | null)?.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawer, showShortcuts]);

  const data = useMemo(() => projectWorkspace(workspace as Record<string, unknown> | null), [workspace]);
  const allThemes = data.themes;
  const themes = activeGroup ? allThemes.filter((t) => t.group === activeGroup) : allThemes;
  const items = data.items;
  const notes = data.notes;
  const links = data.links;
  const activeTheme = themes.find((theme) => theme.id === activeThemeId) || themes[0] || null;

  function navigate(next: string) {
    location.hash = next;
    setRoute(next);
  }

  function openDrawer(config: DrawerConfig) {
    drawerTrigger.current = document.activeElement as HTMLElement | null;
    setDrawer(config);
  }

  function closeDrawer(next: DrawerConfig | null = null) {
    setDrawer(next);
    if (!next) requestAnimationFrame(() => drawerTrigger.current?.focus?.());
  }

  const saveEntity: SaveEntity = async (type, entity, options = {}) => {
    try {
      const saved = await saveWorkspaceEntity(type, entity as Entity, options);
      setToast(entity.id ? "変更を保存しました。" : "追加しました。");
      return saved;
    } catch (error) {
      setToast(`保存できませんでした。${errorMessage(error)}`);
      throw error;
    }
  };

  const saveEntities: SaveEntities = async (operations, successMessage = "変更を保存しました。") => {
    try {
      const saved = await saveWorkspaceEntities(operations);
      setToast(successMessage);
      return saved;
    } catch (error) {
      setToast(`保存できませんでした。${errorMessage(error)}`);
      throw error;
    }
  };

  async function removeEntity(type: EntityType, entity: BaseRecord | { id?: string }) {
    const id = entity.id ?? "";
    try {
      await removeWorkspaceEntity(type, id);
      lastDeleted.current = { type, id };
      closeDrawer();
      setToast(`${entityTitle(type, entity as BaseRecord)}を削除しました。元に戻せます。`);
    } catch (error) {
      setToast(`削除できませんでした。${errorMessage(error)}`);
    }
  }

  async function undoDelete() {
    if (!lastDeleted.current) return;
    await restoreWorkspaceEntity(lastDeleted.current.type, lastDeleted.current.id);
    lastDeleted.current = null;
    setToast("削除を元に戻しました。");
  }

  async function toggleItem(item: Item) {
    await saveEntity("item", {
      ...item,
      status: item.status === "done" ? "todo" : "done",
      completed_at: item.status === "done" ? null : new Date().toISOString(),
    });
  }

  async function removeEntityQuiet(type: EntityType, id: string) {
    await removeWorkspaceEntity(type, id);
  }

  async function saveForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const type = form.dataset.entityType as DrawerEntityType | undefined;
    if (!type) return;
    const named = (name: string) => form.elements.namedItem(name) as HTMLElement | null;
    const base = (drawer?.entity || {}) as Record<string, unknown>;
    let entity: Record<string, unknown> | undefined;

    if (type === "item") {
      const title = formText(values, "title");
      if (!title) {
        (named("title") as HTMLInputElement | null)?.focus();
        setToast("タイトルを入力してください。入力内容は保持されています。");
        return;
      }
      const start = formText(values, "planned_start") || null;
      const end = formText(values, "planned_end") || null;
      if (start && end && end < start) {
        (named("planned_end") as HTMLInputElement | null)?.focus();
        setToast("終了日は開始日以降にしてください。入力内容は保持されています。");
        return;
      }
      const rawKind = formText(values, "kind") || (base.kind as string) || "task";
      const status = formText(values, "status", "todo");
      const kind = rawKind === "idea" && status !== "inbox" ? "task" : rawKind;
      entity = {
        ...base,
        title,
        kind,
        level: formText(values, "level") || (base.level as string) || defaultLevel(kind),
        theme_id: formText(values, "theme_id") || null,
        status,
        priority: values.has("priority_flag") ? "high" : "normal",
        parent_item_id: formText(values, "parent_item_id") || null,
        sort_order: Number(values.get("sort_order") || (base.sort_order as number) || items.length),
        planned_start: start,
        planned_end: end,
        due_date: null,
        actual_start: null,
        actual_end: null,
        baseline_start: start || null,
        baseline_end: end || null,
        schedule_confidence: "fixed",
        date_granularity: "day",
        date_text: "",
        waiting_for: "",
        next_action: "",
        is_personal_task: !formText(values, "theme_id"),
        description: formText(values, "description"),
        source_record_id: null,
      };
    } else if (type === "theme") {
      const name = formText(values, "name");
      if (!name) { setToast("テーマ名を入力してください。"); return; }
      entity = { ...base, name, description: formText(values, "description"), status: formText(values, "status", "計画中"), color: formText(values, "color") || (base.color as string) || "", group: formText(values, "group") };
    } else if (type === "note") {
      const title = formText(values, "title");
      const body = formText(values, "body_markdown");
      if (!title || !body) { setToast("タイトルと本文を入力してください。"); return; }
      entity = {
        ...base,
        title,
        body_markdown: body,
        note_type: formText(values, "note_type", "memo"),
        theme_id: formText(values, "theme_id") || null,
        item_id: formText(values, "item_id") || null,
        source_url: formText(values, "source_url"),
        source_record_id: formText(values, "source_record_id") || null,
        properties_json: (base.properties_json as Record<string, unknown>) || {},
        comments: (base.comments as Note["comments"]) || [],
      };
    } else if (type === "link") {
      const title = formText(values, "title");
      const url = formText(values, "url");
      if (!title || !url) { setToast("タイトルとURLを入力してください。"); return; }
      entity = {
        ...base,
        title,
        url,
        link_type: formText(values, "link_type", "other"),
        theme_id: formText(values, "theme_id") || null,
        item_id: formText(values, "item_id") || null,
        note_id: formText(values, "note_id") || null,
        description: formText(values, "description"),
        source_record_id: formText(values, "source_record_id") || null,
        reference_status: formText(values, "reference_status", "keep"),
        importance: values.has("importance_high") ? "high" : "normal",
        captured_at: formText(values, "captured_at") || (base.captured_at as string) || new Date().toISOString().slice(0, 10),
      };
    } else if (type === "status_update") {
      entity = {
        ...base,
        theme_id: formText(values, "theme_id", activeThemeId),
        date: formText(values, "date", todayIso()),
        status: formText(values, "status", "on_track"),
        summary: formText(values, "summary"),
        progress: Number(values.get("progress") || 0),
        risks: formText(values, "risks"),
        next_actions: formText(values, "next_actions"),
      };
      if (!entity.summary) { setToast("現在地の概要を入力してください。"); return; }
    } else if (type === "source_record") {
      entity = {
        ...base,
        source_type: formText(values, "source_type", "manual"),
        source_title: formText(values, "source_title"),
        source_url: formText(values, "source_url"),
        captured_at: formText(values, "captured_at") || new Date().toISOString(),
        raw_text: formText(values, "raw_text"),
        summary: formText(values, "summary"),
      };
      if (!entity.source_title) { setToast("情報源のタイトルを入力してください。"); return; }
    } else if (type === "field_definition") {
      entity = {
        ...base,
        name: formText(values, "name"),
        field_type: formText(values, "field_type", "text"),
        applies_to: formText(values, "applies_to", "item"),
        theme_id: formText(values, "theme_id") || null,
        options_json: formText(values, "options").split(",").map((value) => value.trim()).filter(Boolean),
        sort_order: Number(values.get("sort_order") || 0),
        is_required: values.get("is_required") === "on",
      };
      if (!entity.name) { setToast("項目名を入力してください。"); return; }
    } else if (type === "relation") {
      entity = {
        ...base,
        source_entity_type: formText(values, "source_entity_type", "item"),
        source_entity_id: formText(values, "source_entity_id"),
        target_entity_type: formText(values, "target_entity_type", "item"),
        target_entity_id: formText(values, "target_entity_id"),
        relation_type: formText(values, "relation_type", "relates_to"),
        description: formText(values, "description"),
      };
      if (!entity.source_entity_id || !entity.target_entity_id) { setToast("関係元と関係先を選択してください。"); return; }
    } else if (type === "knowledge_node") {
      entity = {
        ...base,
        node_type: formText(values, "node_type", "insight"),
        title: formText(values, "title"),
        body: formText(values, "body"),
        theme_id: formText(values, "theme_id") || null,
        source_note_id: formText(values, "source_note_id") || null,
        source_link_id: formText(values, "source_link_id") || null,
        source_item_id: formText(values, "source_item_id") || null,
        confidence: formText(values, "confidence", "medium"),
        status: formText(values, "status", "active"),
      };
      if (!entity.title) { setToast("Knowledgeのタイトルを入力してください。"); return; }
    } else if (type === "knowledge_relation") {
      entity = {
        ...base,
        source_node_id: formText(values, "source_node_id"),
        target_node_id: formText(values, "target_node_id"),
        relation_type: formText(values, "relation_type", "supports"),
        description: formText(values, "description"),
        confidence: formText(values, "confidence", "medium"),
      };
      if (!entity.source_node_id || !entity.target_node_id || entity.source_node_id === entity.target_node_id) {
        setToast("異なる2つのKnowledgeを選択してください。");
        return;
      }
    } else if (type === "dependency") {
      entity = {
        ...base,
        source_item_id: formText(values, "source_item_id"),
        target_item_id: formText(values, "target_item_id"),
        dependency_type: "finish_to_start",
      };
      if (!entity.source_item_id || !entity.target_item_id || entity.source_item_id === entity.target_item_id) {
        setToast("異なる2つのタスクを選択してください。");
        return;
      }
    }

    if (!entity) return;

    let saved: Entity;
    if (type === "item") {
      const id = (entity.id as string) || uuid();
      const itemEntity = { ...entity, id };
      const itemThemeId = entity.theme_id;
      const definitions = (data.field_definitions || []).filter((field) =>
        field.applies_to === "item" && (!field.theme_id || field.theme_id === itemThemeId));
      const operations: SaveOperation[] = [{
        action: "save",
        type: "item",
        entity: itemEntity as Entity,
        options: { reason: formText(values, "revision_reason") },
      }];
      for (const definition of definitions) {
        const rawValue = formText(values, `custom:${definition.id}`);
        const existing = (data.field_values || []).find((value) =>
          value.field_definition_id === definition.id && value.entity_type === "item" && value.entity_id === id);
        if (rawValue || existing) {
          operations.push({
            action: "save",
            type: "field_value",
            entity: {
              ...existing,
              id: existing?.id || uuid(),
              field_definition_id: definition.id,
              entity_type: "item",
              entity_id: id,
              value_text: rawValue,
              value_number: definition.field_type === "number" && rawValue ? Number(rawValue) : null,
              value_date: definition.field_type === "date" ? rawValue || null : null,
              value_json: definition.field_type === "multi_select" ? rawValue.split(",").map((value) => value.trim()).filter(Boolean) : null,
            } as Entity,
          });
        }
      }
      [saved] = await saveEntities(operations, entity.id ? "変更を保存しました。" : "追加しました。");
    } else {
      saved = await saveEntity(type, entity, { reason: formText(values, "revision_reason") });
    }
    if (type === "theme" && !activeThemeId && saved) setActiveThemeId(saved.id);
    closeDrawer();
  }

  if (loadState === "loading") return <AppState state="loading" />;
  if (loadState === "error") return <AppState state="error" message={loadError} onRetry={loadWorkspace} />;
  if (!workspace) return null;

  const common = {
    data,
    themes,
    items,
    notes,
    links,
    activeTheme,
    activeThemeId,
    setActiveThemeId,
    navigate,
    openDrawer,
    saveEntity,
    saveEntities,
    removeEntity,
    removeEntityQuiet,
    toggleItem,
    setToast,
    snapshotPreview,
    setSnapshotPreview,
  };

  const pages: Record<string, React.ReactNode> = {
    today: <TodayPage {...common} />,
    inbox: <InboxPage {...common} />,
    "chat-refs": <ChatRefsPage {...common} />,
    home: <HomePage {...common} />,
    todo: <TodoPage {...common} />,
    timeline: <TimelinePage {...common} />,
    themes: <ThemesPage {...common} />,
    notes: <NotesPage {...common} />,
    knowledge: <KnowledgePage {...common} />,
    waiting: <WaitingPage {...common} />,
    "ai-io": <ImportExportPage {...common} />,
    settings: <SettingsPage {...common} themeMode={themeMode} setThemeMode={setThemeMode} activeGroup={activeGroup} setActiveGroup={setActiveGroup} allThemes={allThemes} loadSample={loadSampleAction} />,
  };

  return (
    <div className={`app-shell ${drawer ? "has-drawer" : ""}`}>
      <Sidebar
        route={route}
        navigate={navigate}
        themes={themes}
        activeThemeId={activeThemeId}
        setActiveThemeId={setActiveThemeId}
        items={items}
        openDrawer={openDrawer}
      />
      <main className="main-area">{pages[route] || pages.today}</main>
      {drawer && (
        <EntityDrawer
          drawer={drawer}
          data={data}
          close={closeDrawer}
          saveForm={saveForm}
          removeEntity={removeEntity}
          toggleItem={toggleItem}
          saveEntity={saveEntity}
        />
      )}
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span>{toast}</span>
          {lastDeleted.current && <button onClick={undoDelete}>元に戻す</button>}
          <button onClick={() => setToast("")}>閉じる</button>
        </div>
      )}
      {showShortcuts && <ShortcutDialog close={() => setShowShortcuts(false)} />}
    </div>
  );
}

``

### $relative

``tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

``

### $relative

``typescript
export const crossNavigation = [
  ["today", "Today"],
  ["inbox", "Inbox整理"],
  ["chat-refs", "チャット参照"],
  ["todo", "ToDo"],
  ["timeline", "Timeline"],
  ["notes", "Notes"],
  ["knowledge", "Knowledge"],
  ["waiting", "Waiting"],
] as const;

export const toolNavigation = [
  ["ai-io", "AI Import / Export"],
  ["settings", "Settings"],
] as const;

export type RouteId =
  | "today"
  | "inbox"
  | "chat-refs"
  | "home"
  | "todo"
  | "timeline"
  | "themes"
  | "notes"
  | "knowledge"
  | "waiting"
  | "ai-io"
  | "settings";

``

### $relative

``typescript
import type {
  Entity,
  EntityType,
  SaveOperation,
  SaveOptions,
  Workspace,
} from "../../../shared/types/workspace";
import { buildBootstrapWorkspace } from "../data/workspace.js";

function desktopApi() {
  if (!window.api) {
    throw new Error("TaskenはElectronデスクトップ版から起動してください。");
  }
  return window.api;
}

export const workspaceApi = {
  load(): Promise<Workspace> {
    // 初回起動でもダミーデータは入れない。空のWorkspaceで開始する。
    return desktopApi().workspace.load();
  },
  // 明示的にサンプルデータを投入する（Settingsの操作からのみ呼ぶ）。
  // Repository側のbootstrapはDBが空のときだけ登録し、データがあれば現状をそのまま返す。
  loadSample(): Promise<Workspace> {
    return desktopApi().workspace.bootstrap(buildBootstrapWorkspace() as Workspace);
  },
  save(type: EntityType, entity: Entity, options: SaveOptions = {}) {
    return desktopApi().entities.save(type, entity, options);
  },
  saveMany(operations: SaveOperation[]) {
    return desktopApi().entities.saveMany(operations);
  },
  remove(type: EntityType, id: string) {
    return desktopApi().entities.remove(type, id);
  },
  restore(type: EntityType, id: string) {
    return desktopApi().entities.restore(type, id);
  },
  setPreference(key: string, value: unknown) {
    return desktopApi().preferences.set(key, value);
  },
  copyText(text: string) {
    return desktopApi().clipboard.writeText(text);
  },
  reload() {
    return desktopApi().app.reload();
  },
  exportSnapshot() {
    return desktopApi().snapshots.exportFile();
  },
  inspectSnapshot() {
    return desktopApi().snapshots.inspectFile();
  },
  applySnapshot(token: string, decisions: Record<string, string>) {
    return desktopApi().snapshots.applyImport(token, decisions);
  },
};

``

### $relative

``typescript
import { create } from "zustand";

interface UiState {
  route: string;
  activeThemeId: string;
  themeMode: "light" | "dark";
  activeGroup: string;
  toast: string;
  setRoute(route: string): void;
  setActiveThemeId(id: string): void;
  setThemeMode(mode: "light" | "dark"): void;
  setActiveGroup(group: string): void;
  setToast(message: string): void;
}

export const useUiStore = create<UiState>((set) => ({
  route: location.hash.slice(1) || "home",
  activeThemeId: "",
  themeMode: "light",
  activeGroup: "",
  toast: "",
  setRoute: (route) => set({ route }),
  setActiveThemeId: (activeThemeId) => set({ activeThemeId }),
  setThemeMode: (themeMode) => set({ themeMode }),
  setActiveGroup: (activeGroup) => set({ activeGroup }),
  setToast: (toast) => set({ toast }),
}));

``

### $relative

``typescript
import { create } from "zustand";

import type { Entity, EntityType, SaveOperation, SaveOptions, Workspace } from "../../../shared/types/workspace";
import { workspaceApi } from "../services/workspaceApi";

type LoadState = "idle" | "loading" | "success" | "error";

interface WorkspaceState {
  workspace: Workspace | null;
  loadState: LoadState;
  loadError: string;
  load(): Promise<Workspace>;
  loadSample(): Promise<Workspace>;
  save(type: EntityType, entity: Entity, options?: SaveOptions): Promise<Entity>;
  saveMany(operations: SaveOperation[]): Promise<Entity[]>;
  remove(type: EntityType, id: string): Promise<Entity>;
  restore(type: EntityType, id: string): Promise<Entity>;
  refresh(): Promise<Workspace>;
}

const entityKeys: Record<EntityType, keyof Workspace> = {
  theme: "themes",
  item: "items",
  note: "notes",
  link: "links",
  dependency: "dependencys",
  view: "views",
  status_update: "status_updates",
  source_record: "source_records",
  entity_source: "entity_sources",
  relation: "relations",
  field_definition: "field_definitions",
  field_value: "field_values",
  log_entry: "log_entries",
  import_batch: "import_batchs",
  knowledge_node: "knowledge_nodes",
  knowledge_relation: "knowledge_relations",
  ai_proposal: "ai_proposals",
};

function replaceEntity(workspace: Workspace, type: EntityType, saved: Entity): Workspace {
  const key = entityKeys[type];
  const records = (workspace[key] as Entity[] | undefined) || [];
  const next = records.some((entry) => entry.id === saved.id)
    ? records.map((entry) => entry.id === saved.id ? saved : entry)
    : [saved, ...records];
  return { ...workspace, [key]: next };
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspace: null,
  loadState: "idle",
  loadError: "",
  async load() {
    set({ loadState: "loading", loadError: "" });
    try {
      const workspace = await workspaceApi.load();
      set({ workspace, loadState: "success" });
      return workspace;
    } catch (error) {
      const loadError = error instanceof Error ? error.message : String(error);
      set({ loadState: "error", loadError });
      throw error;
    }
  },
  async refresh() {
    const workspace = await workspaceApi.load();
    set({ workspace, loadState: "success", loadError: "" });
    return workspace;
  },
  async loadSample() {
    const workspace = await workspaceApi.loadSample();
    set({ workspace, loadState: "success", loadError: "" });
    return workspace;
  },
  async save(type, entity, options = {}) {
    const saved = await workspaceApi.save(type, entity, options);
    const workspace = get().workspace;
    if (workspace) set({ workspace: replaceEntity(workspace, type, saved) });
    return saved;
  },
  async saveMany(operations) {
    const saved = await workspaceApi.saveMany(operations);
    let workspace = get().workspace;
    if (workspace) {
      saved.forEach((entity, index) => {
        workspace = replaceEntity(workspace!, operations[index].type, entity);
      });
      set({ workspace });
    }
    return saved;
  },
  async remove(type, id) {
    const removed = await workspaceApi.remove(type, id);
    await get().refresh();
    return removed;
  },
  async restore(type, id) {
    const restored = await workspaceApi.restore(type, id);
    await get().refresh();
    return restored;
  },
}));

``

### $relative

``css
@import "tailwindcss";
@import "../../../../design-standard/tokens.css";

@theme inline {
  --color-app-accent: var(--color-accent);
  --color-app-surface: var(--color-surface);
  --color-app-background: var(--color-bg);
  --radius-app: var(--radius-md);
  --font-app: var(--font-base);
}

* { box-sizing: border-box; }
html, body, #root { min-height: 100%; margin: 0; }
:root {
  --color-theme-extra-1: color-mix(in srgb, var(--color-chart-1) 70%, var(--color-chart-2));
  --color-theme-extra-2: color-mix(in srgb, var(--color-chart-2) 70%, var(--color-chart-3));
  --color-theme-extra-3: color-mix(in srgb, var(--color-chart-3) 70%, var(--color-chart-4));
  --color-theme-extra-4: color-mix(in srgb, var(--color-chart-5) 65%, var(--color-chart-6));
}
button, input, select, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
button:disabled { cursor: not-allowed; opacity: .55; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: none; box-shadow: var(--focus-ring); border-color: var(--color-accent); }
button:active { transform: scale(0.98); }

.app-shell { min-height: 100vh; display: grid; grid-template-columns: 220px minmax(0, 1fr); background: var(--color-bg); }
.app-shell.has-drawer { grid-template-columns: 220px minmax(0, 1fr) 390px; }
.sidebar { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); background: var(--color-surface); border-right: 1px solid var(--color-border); overflow-y: auto; }
.brand { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-2) var(--space-4); border-bottom: 1px solid var(--color-border-subtle); }
.brand-mark { display: grid; place-items: center; width: 36px; height: 36px; border: 1px solid var(--color-accent); border-radius: var(--radius-md); color: var(--color-accent); font-weight: var(--weight-bold); font-size: var(--text-sm); }
.brand div, .profile div { display: flex; flex-direction: column; min-width: 0; }
.brand strong { color: var(--color-accent-strong); font-size: var(--text-base); }
.brand small, .profile small { color: var(--color-text-secondary); font-size: var(--text-xs); }
.primary-nav { display: grid; gap: var(--space-1); }
.utility-nav { padding-top: var(--space-2); border-top: 1px solid var(--color-border-subtle); }
.primary-nav button, .theme-nav > button { min-height: 36px; display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-2) var(--space-3); border: 1px solid transparent; border-radius: var(--radius-md); background: transparent; text-align: left; transition: background var(--duration-fast) var(--ease), color var(--duration-fast) var(--ease); }
.primary-nav button:hover, .theme-nav > button:hover { background: var(--color-surface-muted); }
.primary-nav button.is-active, .theme-nav > button.is-active { color: var(--color-accent-strong); background: var(--color-accent-subtle-bg-strong); border-color: var(--color-accent-subtle-bd); box-shadow: inset 3px 0 0 var(--color-accent); font-weight: var(--weight-medium); }
.count { min-width: 24px; padding: 1px var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-pill); font: var(--text-xs) var(--font-mono); text-align: center; }
.theme-nav { display: grid; gap: var(--space-1); padding: var(--space-2) 0; border-top: 1px solid var(--color-border-subtle); border-bottom: 1px solid var(--color-border-subtle); }
.nav-heading { display: flex; justify-content: space-between; align-items: center; padding: 0 var(--space-3); color: var(--color-text-secondary); font-size: var(--text-xs); }
.nav-heading button { border: 0; color: var(--color-accent-strong); background: transparent; font-size: var(--text-xs); }
.theme-nav > button { justify-content: flex-start; font-size: var(--text-sm); }
.theme-dot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: var(--radius-pill); background: var(--color-border-strong); }
.theme-nav > button.is-active .theme-dot { background: var(--color-accent); }
.secondary-nav { margin-bottom: auto; }
kbd { color: var(--color-text-secondary); font: var(--text-xs) var(--font-mono); }
.profile { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-2) 0; border-top: 1px solid var(--color-border-subtle); }
.avatar { display: grid; place-items: center; width: 36px; height: 36px; border-radius: var(--radius-pill); background: var(--color-text-secondary); color: var(--color-surface); font-weight: var(--weight-bold); }

.main-area { min-width: 0; }
.page { width: min(1280px, 100%); margin: 0 auto; padding: var(--space-5); }
.page-header { display: flex; justify-content: space-between; align-items: center; gap: var(--space-4); min-height: 58px; }
.page-header h1 { font-size: var(--text-2xl); }
.page-subtitle { margin: var(--space-1) 0 0; color: var(--color-text-secondary); font-size: var(--text-sm); }
.header-actions { display: flex; align-items: center; gap: var(--space-2); }
.panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); }
.section-heading { min-height: 42px; display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-2) var(--pad-card); border-bottom: 1px solid var(--color-border-subtle); }
.section-heading h2 { font-size: var(--text-lg); }
.section-heading > span { color: var(--color-text-secondary); font: var(--text-xs) var(--font-mono); }

.primary-button, .secondary-button, .danger-button, .text-button { min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: var(--space-1); padding: var(--pad-button); border-radius: var(--radius-md); font-weight: var(--weight-medium); transition: background var(--duration-fast) var(--ease), border var(--duration-fast) var(--ease); }
.primary-button { border: 1px solid var(--color-accent); background: var(--color-accent); color: var(--color-on-accent); }
.primary-button:hover { background: var(--color-accent-hover); }
.secondary-button { border: 1px solid var(--color-border); background: var(--color-surface); }
.secondary-button:hover { border-color: var(--color-border-strong); background: var(--color-surface-muted); }
.secondary-button.is-active { border-color: var(--color-accent-subtle-bd); background: var(--color-accent-subtle-bg); color: var(--color-accent-strong); }
.danger-button { border: 1px solid var(--color-danger); background: transparent; color: var(--color-danger-strong); }
.danger-button:hover { background: var(--color-danger-bg); }
.text-button { border: 0; background: transparent; color: var(--color-accent-strong); }
.text-button:hover { background: var(--color-accent-subtle-bg); }
.compact { min-height: 32px; padding: var(--space-1) var(--space-3); font-size: var(--text-sm); }
input, select, textarea { padding: var(--pad-input); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-subtle); }
input:hover, select:hover, textarea:hover { border-color: var(--color-border-strong); }
.status-badge { display: inline-flex; width: fit-content; padding: 2px var(--space-2); border: 1px solid; border-radius: var(--radius-pill); font-size: var(--text-xs); line-height: var(--lh-tight); }
.status-badge.success { color: var(--color-success-strong); border-color: var(--color-success-bd); background: var(--color-success-bg); }
.status-badge.warning { color: var(--color-warning-strong); border-color: var(--color-warning-bd); background: var(--color-warning-bg); }
.status-badge.danger { color: var(--color-danger-strong); border-color: var(--color-danger-bd); background: var(--color-danger-bg); }
.status-badge.neutral { color: var(--color-accent-strong); border-color: var(--color-accent-subtle-bd); background: var(--color-accent-subtle-bg); }
/* ワークフロー状態色（固定enum専用・テキスト併記必須）。進行中を前に、完了/中止を後退させる */
.status-badge.idle    { color: var(--color-status-idle-fg);    border-color: var(--color-status-idle-bd);    background: var(--color-status-idle-bg); }
.status-badge.active  { color: var(--color-status-active-fg);  border-color: var(--color-status-active-bd);  background: var(--color-status-active-bg); }
.status-badge.review  { color: var(--color-status-review-fg);  border-color: var(--color-status-review-bd);  background: var(--color-status-review-bg); }
.status-badge.blocked { color: var(--color-status-blocked-fg); border-color: var(--color-status-blocked-bd); background: var(--color-status-blocked-bg); }
.status-badge.done    { color: var(--color-status-done-fg);    border-color: var(--color-status-done-bd);    background: var(--color-status-done-bg); }
.status-badge.dropped { color: var(--color-status-dropped-fg); border-color: var(--color-status-dropped-bd); background: var(--color-status-dropped-bg); }
.badge-row { display: flex; flex-wrap: wrap; gap: var(--space-2); }

.summary-panel { margin-bottom: var(--space-3); }
.summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-2); padding: var(--pad-card); }
.summary-card { min-height: 126px; display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-subtle); text-align: left; }
.summary-card:hover { border-color: var(--color-border-strong); background: var(--color-surface-muted); }
.summary-card.focus { border-color: var(--color-info-bd); background: var(--color-info-bg); }
.summary-card.warning { border-color: var(--color-warning-bd); background: var(--color-warning-bg); }
.summary-card.danger { border-color: var(--color-danger-bd); background: var(--color-danger-bg); }
.summary-card strong { font-size: var(--text-lg); }
.summary-card small { margin-top: auto; color: var(--color-text-secondary); }
.eyebrow { color: var(--color-accent-strong); font-size: var(--text-sm); font-weight: var(--weight-medium); }
.metric-value { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.metric-card.danger { border-color: var(--color-danger-bd); background: var(--color-danger-bg); }

.mini-timeline { margin-bottom: var(--space-3); overflow: hidden; }
.mini-gantt-grid { position: relative; display: grid; grid-template-columns: 106px repeat(4, 1fr); grid-template-rows: 32px repeat(4, 40px); overflow-x: auto; }
.gantt-corner, .month-head, .lane-label { border-right: 1px solid var(--color-border-subtle); border-bottom: 1px solid var(--color-border-subtle); }
.month-head { display: grid; place-items: center; color: var(--color-text-secondary); font: var(--text-xs) var(--font-mono); }
.lane-label { display: flex; align-items: center; padding-left: var(--space-3); color: var(--color-text-secondary); font-size: var(--text-xs); }
.mini-track { position: relative; grid-column: 2 / -1; border-bottom: 1px solid var(--color-border-subtle); }
.grid-lines { position: absolute; inset: 0; pointer-events: none; }
.grid-lines i { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--color-border-subtle); }
.bar, .waiting-track span { position: absolute; left: calc(var(--start) * 1%); top: 7px; width: calc(var(--span) * 1%); height: 26px; display: grid; place-items: center; overflow: hidden; border: 1px solid; border-radius: var(--radius-sm); font-size: var(--text-xs); white-space: nowrap; }
/* 工程バーのトーン = カテゴリ識別色（chart-1..6）。状態色ではないので意味は持たない。テキストで識別する。 */
.bar.accent,  .phase-bar.accent  { color: var(--color-text); border-color: color-mix(in srgb, var(--color-chart-1) 48%, var(--color-surface)); background: color-mix(in srgb, var(--color-chart-1) 16%, var(--color-surface)); }
.bar.blue,    .phase-bar.blue    { color: var(--color-text); border-color: color-mix(in srgb, var(--color-chart-2) 48%, var(--color-surface)); background: color-mix(in srgb, var(--color-chart-2) 16%, var(--color-surface)); }
.bar.green,   .phase-bar.green   { color: var(--color-text); border-color: color-mix(in srgb, var(--color-chart-3) 48%, var(--color-surface)); background: color-mix(in srgb, var(--color-chart-3) 16%, var(--color-surface)); }
.bar.amber,   .phase-bar.amber   { color: var(--color-text); border-color: color-mix(in srgb, var(--color-chart-4) 48%, var(--color-surface)); background: color-mix(in srgb, var(--color-chart-4) 16%, var(--color-surface)); }
.bar.rose,    .phase-bar.rose    { color: var(--color-text); border-color: color-mix(in srgb, var(--color-chart-5) 48%, var(--color-surface)); background: color-mix(in srgb, var(--color-chart-5) 16%, var(--color-surface)); }
.bar.neutral, .phase-bar.neutral { color: var(--color-text); border-color: var(--color-border); background: var(--color-surface-muted); }
.baseline { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-4); align-items: center; padding: 0 var(--space-2); }
.baseline span, .baseline-bar { height: 12px; border: 1px dashed var(--color-border-strong); border-radius: var(--radius-sm); background: var(--color-surface-muted); opacity: .75; }
.milestones span { position: absolute; left: calc(var(--at) * 1%); top: 3px; color: var(--color-text-secondary); font: var(--text-xs) var(--font-mono); line-height: var(--lh-tight); white-space: nowrap; transform: translateX(-50%); text-align: center; }
.waiting-track span { color: var(--color-warning-strong); border-color: var(--color-warning-bd); background: var(--color-warning-bg); }
.today-line, .full-today { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--color-accent); pointer-events: none; }
.today-line span, .full-today span { position: absolute; top: 0; left: 50%; padding: 1px var(--space-1); transform: translate(-50%, -100%); border-radius: var(--radius-sm); background: var(--color-accent); color: var(--color-on-accent); font-size: var(--text-xs); white-space: nowrap; }

.dashboard-grid { display: grid; grid-template-columns: 1.15fr 1fr; gap: var(--space-3); margin-bottom: var(--space-3); }
.today-page .page-header, .inbox-page .page-header { margin-bottom: var(--space-3); }
.today-metrics { grid-template-columns: repeat(4, 1fr); }
.today-focus-panel { margin-bottom: var(--space-3); overflow: hidden; }
.today-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); margin-bottom: var(--space-3); }
.today-task-list, .today-update-list { display: grid; }
.today-task-row { min-height: 48px; display: grid; grid-template-columns: 24px minmax(0, 1fr) 20px auto 106px 34px; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--pad-card); border-bottom: 1px solid var(--color-border-subtle); }
.today-task-row:last-child { border-bottom: 0; }
.today-task-title { min-width: 0; display: grid; gap: 1px; padding: 0; border: 0; background: transparent; text-align: left; }
.today-task-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.today-task-title span { overflow: hidden; color: var(--color-text-secondary); font-size: var(--text-xs); text-overflow: ellipsis; white-space: nowrap; }
.today-task-row time { color: var(--color-text-secondary); font: var(--text-xs) var(--font-mono); text-align: right; white-space: nowrap; }
.inline-icon.accent { color: var(--color-accent-strong); }

.inbox-panel { overflow: hidden; }
.inbox-list { display: grid; }
.inbox-card { display: grid; gap: var(--space-2); padding: var(--space-3) var(--pad-card); border-bottom: 1px solid var(--color-border-subtle); background: var(--color-surface); }
.inbox-card:last-child { border-bottom: 0; }
.inbox-card-main { display: grid; grid-template-columns: 24px 112px minmax(220px, 1fr) 160px 132px 34px 34px; align-items: end; gap: var(--space-2); }
.inbox-card-main label, .inbox-card-details label { display: grid; gap: var(--space-1); color: var(--color-text-secondary); font-size: var(--text-xs); }
.inbox-card-main input, .inbox-card-main select, .inbox-card-details input, .inbox-card-details textarea { width: 100%; }
.inbox-title-field input { color: var(--color-text); font-weight: var(--weight-medium); }
.inbox-card-details { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: var(--space-2); padding-left: 32px; }
.inbox-card-details label:has(input) { grid-column: 1 / -1; }
.inbox-card-details textarea { min-height: 74px; resize: vertical; }
.inbox-link-fields { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(240px, 1fr) 130px 180px 130px; gap: var(--space-2); }
.tabs { display: flex; gap: var(--space-3); padding: 0 var(--pad-card); border-bottom: 1px solid var(--color-border-subtle); }
.tabs button { min-height: 36px; padding: 0 var(--space-1); border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--color-text-secondary); font-size: var(--text-sm); }
.tabs button[aria-selected="true"] { border-bottom-color: var(--color-accent); color: var(--color-accent-strong); font-weight: var(--weight-medium); }
.task-list { padding: var(--space-2) var(--pad-card) var(--pad-card); }
.task-row { min-height: 38px; display: grid; grid-template-columns: 24px minmax(0, 1fr) auto auto; align-items: center; gap: var(--space-2); border-bottom: 1px solid var(--color-border-subtle); }
.check-button { width: 18px; height: 18px; border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); background: var(--color-surface); }
.check-button:hover { border-color: var(--color-accent); background: var(--color-accent-subtle-bg); }
.task-title { overflow: hidden; border: 0; background: transparent; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.task-title:hover { color: var(--color-accent-strong); }
.task-row time { color: var(--color-text-secondary); font: var(--text-xs) var(--font-mono); white-space: nowrap; }
.note-list { display: grid; gap: var(--space-2); padding: var(--pad-card); }
.note-card { display: grid; grid-template-columns: 1fr auto; gap: var(--space-1); padding: var(--space-2); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--color-surface); text-align: left; }
.note-card:hover { border-color: var(--color-border-strong); background: var(--color-surface-subtle); }
.note-card > span { display: flex; align-items: center; gap: var(--space-2); }
.note-card small { color: var(--color-text-secondary); font: var(--text-xs) var(--font-mono); }
.note-card p { grid-column: 1 / -1; display: -webkit-box; margin: 0; overflow: hidden; color: var(--color-text-secondary); font-size: var(--text-sm); -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.artifacts { margin-bottom: var(--space-6); }
.artifact-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-2); padding: var(--pad-card); }
.artifact-grid button { display: flex; justify-content: space-between; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--color-surface); text-align: left; }
.artifact-grid button:hover { border-color: var(--color-border-strong); background: var(--color-surface-subtle); }
.artifact-grid small { color: var(--color-text-secondary); font: var(--text-xs) var(--font-mono); white-space: nowrap; }

.timeline-toolbar { display: flex; align-items: flex-end; gap: var(--space-3); padding: var(--pad-card); margin-bottom: var(--space-3); }
.timeline-toolbar label { display: grid; gap: var(--space-1); color: var(--color-text-secondary); font-size: var(--text-xs); }
.segmented { display: inline-flex; align-items: center; border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow: hidden; }
.segmented button { min-height: 34px; padding: 0 var(--space-3); border: 0; border-right: 1px solid var(--color-border); background: var(--color-surface); font-size: var(--text-sm); }
.segmented button:last-child { border-right: 0; }
.segmented button:hover { background: var(--color-surface-muted); }
.segmented button.is-active { color: var(--color-accent-strong); background: var(--color-accent-subtle-bg); font-weight: var(--weight-medium); }
.toggle { display: flex !important; grid-template-columns: auto 1fr; align-items: center; gap: var(--space-2) !important; min-height: 36px; }
.toggle input { accent-color: var(--color-accent); }
.full-gantt { position: relative; min-height: 560px; overflow: auto; }
.full-gantt-header { position: sticky; top: 0; z-index: 3; display: grid; grid-template-columns: 170px 1fr; background: var(--color-surface); border-bottom: 1px solid var(--color-border); }
.theme-column { padding: var(--space-3); color: var(--color-text-secondary); font-size: var(--text-xs); }
.time-axis { display: grid; }
.time-axis span { display: grid; place-items: center; min-height: 40px; border-left: 1px solid var(--color-border-subtle); color: var(--color-text-secondary); font: var(--text-xs) var(--font-mono); }
.theme-gantt { display: grid; grid-template-columns: 170px 1fr; border-bottom: 1px solid var(--color-border); }
.theme-gantt-title { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); padding: var(--space-3); border-right: 1px solid var(--color-border); }
.full-lane { grid-column: 2; display: grid; grid-template-columns: 88px minmax(0, 1fr); min-height: 48px; border-bottom: 1px solid var(--color-border-subtle); }
.full-lane:last-child { border-bottom: 0; }
.lane-name { display: flex; align-items: center; padding-left: var(--space-3); color: var(--color-text-secondary); font-size: var(--text-xs); border-right: 1px solid var(--color-border-subtle); }
.full-track { position: relative; }
.phase-bar, .wait-bar { position: absolute; top: 9px; height: 30px; overflow: hidden; padding: 0 var(--space-2); border: 1px solid; border-radius: var(--radius-sm); font-size: var(--text-xs); white-space: nowrap; text-overflow: ellipsis; }
.phase-bar:hover, .wait-bar:hover { filter: brightness(.96); }
.baseline-bar { position: absolute; left: 2%; right: 2%; top: 17px; }
.milestone-mark { position: absolute; top: 3px; width: 80px; height: 42px; display: flex; flex-direction: column; align-items: center; transform: translateX(-50%); border: 0; background: transparent; color: var(--color-accent-strong); font-size: var(--text-xs); }
.milestone-mark small { max-width: 80px; overflow: hidden; color: var(--color-text-secondary); text-overflow: ellipsis; white-space: nowrap; }
.wait-bar { color: var(--color-warning-strong); border-color: var(--color-warning-bd); background: var(--color-warning-bg); }
.full-today { top: 40px; bottom: 0; z-index: 2; }
.full-today span { top: 0; transform: translate(-50%, 0); }
.timeline-legend { display: flex; justify-content: flex-end; gap: var(--space-4); padding: var(--space-3); color: var(--color-text-secondary); font-size: var(--text-xs); }
.timeline-legend span { display: flex; align-items: center; gap: var(--space-1); }
.timeline-legend i { width: 20px; height: 8px; border-radius: var(--radius-sm); }
.legend-solid { border: 1px solid color-mix(in srgb, var(--color-chart-1) 48%, var(--color-surface)); background: color-mix(in srgb, var(--color-chart-1) 16%, var(--color-surface)); }
.legend-hatch { border: 1px dashed var(--color-border-strong); background: var(--color-surface-muted); }
.legend-wait { border: 1px solid var(--color-warning-bd); background: var(--color-warning-bg); }

.list-page { overflow: hidden; }
.wide-row, .waiting-row { width: 100%; min-height: 58px; display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding: var(--space-3) var(--pad-card); border: 0; border-bottom: 1px solid var(--color-border-subtle); background: var(--color-surface); text-align: left; }
.wide-row:hover, .waiting-row:hover { background: var(--color-surface-muted); }
.wide-row span { color: var(--color-text-secondary); font: var(--text-xs) var(--font-mono); }
.inline-actions, .form-actions { display: flex; align-items: center; gap: var(--space-2); }
.inbox-row, .link-row { padding-right: var(--space-3); }
.row-main { min-width: 0; flex: 1; display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: 0; border: 0; background: transparent; text-align: left; }
.row-main strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-main:hover strong { color: var(--color-accent-strong); }
.waiting-row > div { display: flex; align-items: center; gap: var(--space-3); }
.waiting-row > div:last-child { flex-direction: column; align-items: flex-end; }
.waiting-row small { color: var(--color-text-secondary); }
.theme-card-grid, .notes-grid, .metric-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-3); }
.theme-card, .note-tile { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-3); padding: var(--space-4); text-align: left; }
.theme-card { border-left: 5px solid var(--chip-color, var(--color-accent)); }
.theme-card:hover, .note-tile:hover { border-color: var(--color-border-strong); background: var(--color-surface-subtle); }
.theme-card p, .note-tile p { margin: 0; color: var(--color-text-secondary); }
.theme-card > div { display: flex; gap: var(--space-5); margin-top: auto; }
.theme-card > div span { display: flex; align-items: baseline; gap: var(--space-1); color: var(--color-text-secondary); font-size: var(--text-sm); }
.theme-card .metric-value { color: var(--color-text); font-size: var(--text-xl); }
.theme-card-top { width: 100%; justify-content: space-between; margin-top: 0 !important; }
.filter-bar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--pad-card); margin-bottom: var(--space-3); }
.filter-bar input { width: min(420px, 100%); }
.filter-bar span { color: var(--color-text-secondary); font-size: var(--text-sm); }
.note-row { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--pad-card); border-bottom: 1px solid var(--color-border-subtle); background: var(--color-surface); transition: background var(--duration-fast) var(--ease); }
.note-row:last-child { border-bottom: 0; }
.note-row:hover { background: var(--color-surface-muted); }
.note-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); padding: 0; border: 0; background: transparent; text-align: left; }
.note-row-head { display: flex; align-items: center; gap: var(--space-2); }
.note-row-head .status-badge { flex-shrink: 0; }
.note-row-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-sm); }
.note-row-main:hover .note-row-title { color: var(--color-accent-strong); }
.note-row-time { flex-shrink: 0; color: var(--color-text-secondary); font: var(--text-xs) var(--font-mono); }
.note-row-body { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text-secondary); font-size: var(--text-xs); line-height: 1.5; }
.note-row-open { flex-shrink: 0; text-decoration: none; }
.comment-count { flex-shrink: 0; display: grid; place-items: center; min-width: 20px; height: 20px; padding: 0 var(--space-1); border: 1px solid var(--color-accent-subtle-bd); border-radius: var(--radius-pill); background: var(--color-accent-subtle-bg); color: var(--color-accent-strong); font: var(--text-xs) var(--font-mono); }
.comment-thread { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--color-border-subtle); }
.comment-thread h3 { font-size: var(--text-sm); margin: 0; }
.comment-list { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-3); }
.comment-item { padding: var(--space-3); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--color-surface-subtle); }
.comment-body { font-size: var(--text-sm); white-space: pre-wrap; line-height: 1.6; }
.comment-meta { display: flex; align-items: center; justify-content: space-between; margin-top: var(--space-2); }
.comment-meta time { color: var(--color-text-secondary); font: var(--text-xs) var(--font-mono); }
.comment-input { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-3); }
.comment-input textarea { min-height: 64px; resize: vertical; font-size: var(--text-sm); }
.comment-input button { align-self: flex-end; }
.io-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
.io-panel { display: flex; flex-direction: column; gap: var(--space-3); padding-bottom: var(--pad-card); }
.io-panel textarea { min-height: 440px; margin: 0 var(--pad-card); resize: vertical; font: var(--text-xs) var(--font-mono); }
.io-panel > button { align-self: flex-end; margin-right: var(--pad-card); }
.import-preview, .import-history { margin-top: var(--space-3); overflow: hidden; }
.preview-group { display: grid; grid-template-columns: 120px 1fr; gap: var(--space-1) var(--space-3); padding: var(--space-3) var(--pad-card); border-bottom: 1px solid var(--color-border-subtle); }
.preview-group > strong { grid-row: 1 / span 20; color: var(--color-text-secondary); text-transform: uppercase; font-size: var(--text-xs); }
.preview-group > span { padding-bottom: var(--space-1); }
.import-preview > .form-actions { justify-content: flex-end; padding: var(--space-3) var(--pad-card); }
.schema-help {
  margin: 0;
  padding: var(--space-3);
  max-height: 220px;
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface-subtle);
  color: var(--color-text-muted);
  font-size: var(--font-size-small);
  line-height: 1.55;
  white-space: pre-wrap;
}
.metric-grid { grid-template-columns: repeat(4, 1fr); margin-bottom: var(--space-3); }
.home-metrics { grid-template-columns: repeat(3, 1fr); }
.metric-card { display: grid; gap: var(--space-2); padding: var(--space-4); background: var(--color-surface-subtle); }
.metric-card span { color: var(--color-text-secondary); font-size: var(--text-sm); }
.metric-card strong { font-size: var(--text-2xl); }
/* 画面の主役指標。サイズを一段上げ、左アクセントバーで視線の起点にする（1画面に1つ） */
.metric-card.primary { background: var(--color-surface); border-color: var(--color-border-strong); box-shadow: inset 3px 0 0 var(--color-accent); }
.metric-card.primary strong { font-size: var(--text-3xl); }
.stats-table { padding-bottom: var(--space-2); }
.stats-row { display: grid; grid-template-columns: 160px 1fr 48px; align-items: center; gap: var(--space-3); min-height: 48px; padding: 0 var(--pad-card); border-bottom: 1px solid var(--color-border-subtle); }
.stats-row .num { text-align: right; }
.settings-form { display: grid; gap: var(--space-4); max-width: 680px; padding: var(--space-5); }
.settings-form label { display: grid; grid-template-columns: 180px 1fr; align-items: center; gap: var(--space-3); }
.settings-list { overflow: hidden; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); }
.field-help { margin: 0; color: var(--color-text-secondary); font-size: var(--text-sm); }
.state-box { min-height: 110px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: var(--space-2); padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-subtle); }
.state-box > span { color: var(--color-text-secondary); }
.state-box.error { border-color: var(--color-danger-bd); background: var(--color-danger-bg); color: var(--color-danger-strong); }
.state-box.success { border-color: var(--color-success-bd); background: var(--color-success-bg); color: var(--color-success-strong); }
.state-box.loading { flex-direction: row; align-items: center; }
.spinner { width: 20px; height: 20px; border: 2px solid var(--color-border); border-top-color: var(--color-accent); border-radius: var(--radius-pill); animation: spin var(--duration-base) linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.drawer { position: sticky; z-index: 10; top: 0; width: 390px; height: 100vh; display: flex; flex-direction: column; background: var(--color-surface); border-left: 1px solid var(--color-border); }
.drawer-header { min-height: 58px; display: flex; align-items: center; justify-content: space-between; padding: 0 var(--space-4); border-bottom: 1px solid var(--color-border); }
.drawer-header button { min-height: 32px; border: 0; background: transparent; color: var(--color-text-secondary); }
.drawer-form, .drawer-content { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-5); overflow-y: auto; }
.drawer-form label { display: grid; gap: var(--space-1); color: var(--color-text-secondary); font-size: var(--text-sm); }
.drawer-form textarea { min-height: 92px; resize: vertical; }
.drawer-form .large-textarea { min-height: 280px; font-family: var(--font-mono); }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); }
.link-value { overflow-wrap: anywhere; padding: var(--space-3); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--color-surface-subtle); color: var(--color-text-secondary); font-family: var(--font-mono); font-size: var(--text-xs); }
.link-value a { color: var(--color-accent-strong); text-decoration: underline; text-underline-offset: 2px; }
.link-value a:hover { color: var(--color-accent); }
.drawer-content h2 { font-size: var(--text-xl); }
.drawer-content dl { display: grid; gap: var(--space-2); margin: 0; }
.drawer-content dt { margin-top: var(--space-2); color: var(--color-text-secondary); font-size: var(--text-xs); font-weight: var(--weight-medium); }
.drawer-content dd { margin: 0; padding: var(--space-2); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--color-surface-subtle); }
.drawer-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: auto; }
.note-body { white-space: pre-line; }
.toast { position: fixed; z-index: 20; right: var(--space-5); bottom: var(--space-5); display: flex; align-items: center; gap: var(--space-3); max-width: 520px; padding: var(--space-3) var(--space-4); border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface); box-shadow: var(--shadow-md); }
.toast button { min-height: 32px; border: 0; background: transparent; color: var(--color-accent-strong); font-weight: var(--weight-medium); }
.empty-state { min-height: 160px; display: grid; place-content: center; justify-items: center; gap: var(--space-3); color: var(--color-text-secondary); }
.shortcut-overlay { position: fixed; z-index: 30; inset: 0; display: grid; place-items: center; background: rgba(0, 0, 0, 0.35); }
.shortcut-dialog { width: min(400px, 90vw); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); overflow: hidden; }
.shortcut-list { display: grid; grid-template-columns: auto 1fr; gap: var(--space-2) var(--space-4); margin: 0; padding: var(--space-4); }
.shortcut-list dt { text-align: right; }
.shortcut-list dd { margin: 0; }
kbd { display: inline-block; min-width: 24px; padding: 2px var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface-subtle); color: var(--color-text-secondary); font: var(--text-xs) var(--font-mono); text-align: center; }

.standalone-state { min-height: 100vh; display: grid; place-items: center; padding: var(--space-5); background: var(--color-bg); }
.standalone-state .state-box { width: min(520px, 100%); }
.sidebar .primary-nav { overflow-y: auto; }
.timeline-wide { width: min(1600px, 100%); }
.todo-filter-tabs { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-2); padding: 0 var(--pad-card); border-bottom: 1px solid var(--color-border-subtle); }
.todo-filter-tabs button { min-height: 36px; padding: var(--space-1) var(--space-2); border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--color-text-secondary); font-size: var(--text-sm); white-space: nowrap; }
.todo-filter-tabs button:hover:not(.is-active) { color: var(--color-text); }
.todo-filter-tabs button.is-active { border-bottom-color: var(--color-accent); color: var(--color-accent-strong); font-weight: var(--weight-medium); }
.tab-count { margin-left: var(--space-1); font-family: var(--font-mono); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.metric-card.danger { border-color: var(--color-danger-bd); background: var(--color-danger-bg); }
.metric-card.warning { border-color: var(--color-warning-bd); background: var(--color-warning-bg); }
.list-toolbar { min-height: 54px; display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-2) var(--pad-card); border-bottom: 1px solid var(--color-border-subtle); }
.data-table { width: 100%; overflow-x: auto; }
.table-head, .table-row { display: grid; align-items: center; gap: var(--space-2); min-width: 760px; padding: var(--space-2) var(--pad-card); border-bottom: 1px solid var(--color-border-subtle); }
.table-head { min-height: 38px; color: var(--color-text-secondary); background: var(--color-surface-subtle); font-size: var(--text-xs); font-weight: var(--weight-medium); }
.table-row { min-height: 46px; font-size: var(--text-sm); }
.table-row:hover { background: var(--color-surface-muted); }
.todo-table .table-row { background: linear-gradient(90deg, color-mix(in srgb, var(--chip-color, var(--color-surface)) 10%, var(--color-surface)) 0%, var(--color-surface) 46%); }
.todo-table .table-row:hover { background: linear-gradient(90deg, color-mix(in srgb, var(--chip-color, var(--color-surface)) 16%, var(--color-surface)) 0%, var(--color-surface-muted) 46%); }
.todo-table .table-head, .todo-table .table-row { grid-template-columns: 8px 24px minmax(250px, 1fr) 72px 150px 110px; }
.todo-theme-bar { width: 7px; height: 30px; border-radius: var(--radius-pill); background: var(--chip-color, var(--color-border-strong)); }
.row-title-wrap { min-width: 0; display: flex; align-items: center; gap: var(--space-1); }
.row-title { min-width: 0; overflow: hidden; padding: 0; border: 0; background: transparent; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.row-title:hover { color: var(--color-accent-strong); }
.priority-flag-button, .today-plan-button { width: 26px; height: 26px; display: grid; place-items: center; flex: 0 0 auto; padding: 0; border: 1px solid transparent; border-radius: var(--radius-md); background: transparent; color: var(--color-text-tertiary); }
.priority-flag-button:hover, .today-plan-button:hover { border-color: var(--color-border); background: var(--color-surface-muted); color: var(--color-accent-strong); }
.priority-flag-button.is-active, .today-plan-button.is-active { color: var(--color-accent-strong); background: var(--color-accent-subtle-bg); border-color: var(--color-accent-subtle-bd); }
.theme-inline { display: inline-flex; align-items: center; gap: var(--space-1); min-width: 0; }
.check-action { min-height: 30px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); font-size: var(--text-xs); }
.check-action:hover { background: var(--color-surface-muted); }
.status-summary { display: grid; align-content: start; gap: var(--space-3); min-height: 210px; padding: var(--pad-card); }
.status-summary p { margin: 0; color: var(--color-text-secondary); }
.selected { border-color: var(--color-accent-subtle-bd); }

.split-gantt { position: relative; display: grid; grid-template-columns: 300px minmax(0, 1fr); min-height: 580px; overflow: hidden; }
.gantt-table { z-index: 4; border-right: 1px solid var(--color-border); background: var(--color-surface); }
.gantt-table-head, .gantt-table-row { display: grid; grid-template-columns: minmax(150px, 1fr) 92px; align-items: center; gap: var(--space-1); min-height: 44px; padding: 0 var(--space-2); border-bottom: 1px solid var(--color-border-subtle); font-size: var(--text-xs); }
.gantt-table-head { position: sticky; top: 0; z-index: 5; color: var(--color-text-secondary); background: var(--color-surface-subtle); font-weight: var(--weight-medium); }
.gantt-name { display: flex; align-items: center; gap: var(--space-1); min-width: 0; overflow: hidden; border: 0; background: transparent; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.gantt-name > span { flex: 0 0 auto; color: var(--color-accent-strong); }
.gantt-add-plan-button { width: 30px; height: 30px; justify-self: end; display: grid; place-items: center; padding: 0; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-accent-strong); font-weight: var(--weight-bold); }
.gantt-add-plan-button:hover { background: var(--color-accent-subtle-bg); border-color: var(--color-accent-subtle-bd); }
.gantt-title-button { min-width: 0; overflow: hidden; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.gantt-title-button:hover { color: var(--color-accent-strong); }
.gantt-title-input { width: 100%; min-height: 28px; padding: 0 var(--space-1); font-size: var(--text-xs); }
.gantt-scroll { min-width: 0; overflow-x: auto; overflow-y: clip; }
.gantt-canvas { position: relative; min-width: 100%; }
.gantt-axis { position: sticky; z-index: 3; top: 0; height: 44px; display: grid; background: var(--color-surface-subtle); border-bottom: 1px solid var(--color-border); }
.gantt-axis span { display: grid; place-items: center; border-right: 1px solid var(--color-border-subtle); color: var(--color-text-secondary); font: var(--text-xs) var(--font-mono); }
.gantt-item-row { position: relative; height: 44px; border-bottom: 1px solid var(--color-border-subtle); background-image: repeating-linear-gradient(to right, transparent 0, transparent calc(8.333% - 1px), var(--color-border-subtle) calc(8.333% - 1px), var(--color-border-subtle) 8.333%); }
.gantt-item-bar { --bar-color: var(--color-chart-1); position: absolute; z-index: 2; top: 8px; height: 28px; display: flex; align-items: center; justify-content: space-between; gap: var(--space-1); overflow: hidden; padding: 0 var(--space-2); border: 1px solid color-mix(in srgb, var(--bar-color) 48%, var(--color-surface)); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--bar-color) 16%, var(--color-surface)); color: var(--color-text); font-size: var(--text-xs); white-space: nowrap; cursor: grab; }
.gantt-item-bar:active { cursor: grabbing; }
/* ドラッグ中の操作対象を浮かせる（位置/幅はライブプレビュー）。影でなくアクセント枠で示す。 */
.gantt-item-bar.is-dragging { z-index: 6; cursor: grabbing; outline: 2px solid var(--color-accent); outline-offset: 1px; }
.gantt-item-bar.schedule-tentative, .gantt-item-bar.confidence-rough { border-style: dashed; background: color-mix(in srgb, var(--bar-color) 8%, var(--color-surface)); }
.gantt-item-bar.schedule-fixed { border-width: 2px; font-weight: var(--weight-medium); }
.gantt-item-bar.milestone { width: 26px !important; justify-content: center; overflow: visible; padding: 0; border: 0; background: transparent; color: var(--color-accent-strong); font-size: var(--text-lg); }
.resize-handle { width: 5px; align-self: stretch; flex: 0 0 auto; background: color-mix(in srgb, var(--bar-color) 28%, transparent); cursor: ew-resize; }
.gantt-today { position: absolute; z-index: 2; top: 0; bottom: 0; width: 1px; background: var(--color-accent); pointer-events: none; }
.gantt-today span { position: sticky; top: 0; display: block; width: max-content; padding: 1px var(--space-1); transform: translateX(-50%); border-radius: var(--radius-sm); background: var(--color-accent); color: var(--color-on-accent); font-size: var(--text-xs); }
.dependency-overlay { position: absolute; z-index: 1; top: 44px; left: 0; width: 100%; pointer-events: none; overflow: visible; }
.dependency-overlay .dep-hit-area { fill: none; stroke: transparent; stroke-width: 12; vector-effect: non-scaling-stroke; pointer-events: stroke; cursor: pointer; }
.dependency-overlay .dep-hit-area:hover + .dep-line { stroke: var(--color-accent); stroke-width: 2.5; }
.dependency-overlay .dep-line { fill: none; stroke: var(--color-info); stroke-width: 1.5; vector-effect: non-scaling-stroke; pointer-events: none; }
.dependency-overlay .dep-line-selected { stroke: var(--color-danger); stroke-width: 2.5; }
.dependency-overlay marker path { fill: var(--color-info); stroke: none; }
.dependency-overlay .dep-selected-marker { fill: var(--color-danger); stroke: none; }
.lightning-overlay { position: absolute; z-index: 3; top: 0; left: 0; width: 100%; pointer-events: none; overflow: visible; }
.lightning-overlay path { fill: none; stroke: var(--color-chart-4); stroke-width: 2; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.legend-lightning { width: 18px; height: 2px; display: inline-block; background: var(--color-chart-4); }
.legend-diamond { width: 9px; height: 9px; transform: rotate(45deg); border-radius: 1px; background: var(--color-accent-strong); }
.legend-task { width: 20px; height: 5px; border: 1px solid color-mix(in srgb, var(--color-chart-1) 40%, var(--color-surface)); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--color-chart-1) 12%, var(--color-surface)); opacity: .82; }

/* テーマ別レーンのヘッダ行（左表）。面の明度差でグループを区切る（影に頼らない）。 */
.gantt-theme-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-height: 44px; padding: 0 var(--space-2); background: var(--color-surface-muted); border-bottom: 1px solid var(--color-border); }
.gantt-theme-toggle { display: flex; align-items: center; gap: var(--space-2); min-width: 0; border: 0; background: transparent; text-align: left; }
.gantt-theme-toggle strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-sm); }
.gantt-theme-toggle:hover strong { color: var(--color-accent-strong); }
.gantt-theme-caret { flex: 0 0 auto; width: 14px; color: var(--color-accent-strong); }
.gantt-theme-count { flex: 0 0 auto; color: var(--color-text-secondary); font: var(--text-xs) var(--font-mono); white-space: nowrap; }
.gantt-milestone-table-row { min-height: 44px; display: grid; grid-template-columns: minmax(150px, 1fr) 92px; align-items: center; gap: var(--space-1); padding: 0 var(--space-2); border-bottom: 1px solid var(--color-border-subtle); background: color-mix(in srgb, var(--color-accent-subtle-bg) 45%, var(--color-surface)); color: var(--color-text-secondary); font-size: var(--text-xs); }
.gantt-milestone-table-row span { padding-left: 28px; font-weight: var(--weight-medium); }
.gantt-milestone-table-row strong { justify-self: end; padding: 2px var(--space-2); border-radius: var(--radius-pill); background: var(--color-accent-subtle-bg); color: var(--color-accent-strong); font: var(--text-xs) var(--font-mono); }
.gantt-milestone-mark { flex: 0 0 auto; color: var(--color-accent-strong); }
/* task-levelは大きな線に対して後退させる（淡色・細バー）。 */
.gantt-table-row.level-task .gantt-name { color: var(--color-text-secondary); }
.gantt-canvas-theme-row { position: relative; height: 44px; background: var(--color-surface-muted); border-bottom: 1px solid var(--color-border); }
.gantt-milestone-lane { --bar-color: var(--color-chart-1); position: relative; height: 44px; border-bottom: 1px solid var(--color-border-subtle); background: color-mix(in srgb, var(--color-accent-subtle-bg) 38%, var(--color-surface)); background-image: repeating-linear-gradient(to right, transparent 0, transparent calc(8.333% - 1px), var(--color-border-subtle) calc(8.333% - 1px), var(--color-border-subtle) 8.333%); }
.milestone-lane-mark { position: absolute; z-index: 4; top: 5px; width: 84px; min-height: 34px; display: grid; justify-items: center; align-content: center; gap: 1px; transform: translateX(-50%); padding: 0 var(--space-1); border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--color-accent-strong); font-size: var(--text-xs); }
.milestone-lane-mark span { font-family: var(--font-mono); line-height: var(--lh-tight); }
.milestone-lane-mark small { max-width: 76px; overflow: hidden; color: var(--color-text-secondary); font-size: var(--text-xs); text-overflow: ellipsis; white-space: nowrap; }
.milestone-lane-mark:hover { border-color: var(--color-accent-subtle-bd); background: var(--color-accent-subtle-bg); }
.milestone-lane-mark.is-dragging { z-index: 6; cursor: grabbing; outline: 2px solid var(--color-accent); outline-offset: 1px; }
.milestone-lane-mark.is-cluster { border-color: color-mix(in srgb, var(--bar-color) 34%, var(--color-border)); background: color-mix(in srgb, var(--bar-color) 12%, var(--color-surface)); }
.gantt-item-bar.level-task { top: 12px; height: 20px; opacity: .82; }
.gantt-item-bar.in-lane { top: 11px; height: 22px; }

/* 接続モード: 先行タスク確定時のハイライトと、ターゲット候補のホバー強調 */
.connect-status-popover { position: absolute; z-index: 8; top: var(--space-2); right: var(--space-2); max-width: min(520px, calc(100% - var(--space-4))); display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); background: var(--color-info-bg); border: 1px solid var(--color-info-bd); border-radius: var(--radius-md); box-shadow: var(--shadow-sm); font-size: var(--text-sm); color: var(--color-text); }
.connect-status-popover strong { color: var(--color-accent-strong); }
.gantt-item-bar.is-connect-source { outline: 2px solid var(--color-accent); outline-offset: 1px; z-index: 6; }
.gantt-item-bar.is-connect-target { cursor: crosshair; }
.gantt-item-bar.is-connect-target:hover { outline: 2px dashed var(--color-info); outline-offset: 1px; z-index: 5; }
.gantt-table-row.is-connect-source .gantt-name { color: var(--color-accent-strong); font-weight: var(--weight-medium); }

/* サイドバー: 「すべてのテーマ」エントリ（テーマ一覧の管理画面への入口） */
.theme-nav-all { min-height: 34px; display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-2) var(--space-3); border: 1px solid transparent; border-radius: var(--radius-md); background: transparent; text-align: left; }
.theme-nav-all:hover { background: var(--color-surface-muted); }
.theme-nav-all.is-active { color: var(--color-accent-strong); background: var(--color-accent-subtle-bg-strong); border-color: var(--color-accent-subtle-bd); box-shadow: inset 3px 0 0 var(--color-accent); font-weight: var(--weight-medium); }

.paste-panel { display: grid; gap: var(--space-3); padding: var(--pad-card); }
.paste-panel textarea { min-height: 120px; font-family: var(--font-mono); }
.paste-preview { max-height: 240px; overflow: auto; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); }
.paste-preview > div { display: grid; grid-template-columns: minmax(180px, 1fr) 160px 120px; gap: var(--space-2); padding: var(--space-2); border-bottom: 1px solid var(--color-border-subtle); }
.paste-preview > div:last-child { border-bottom: 0; }
.paste-preview span, .paste-preview time { color: var(--color-text-secondary); font-size: var(--text-xs); }
.paste-preview time { font-family: var(--font-mono); }
.shift-days { width: 72px; font-family: var(--font-mono); text-align: right; }

.milestone-map { overflow: hidden; }
.milestone-row { width: 100%; min-height: 52px; display: grid; grid-template-columns: 120px 160px 1fr auto; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--pad-card); border: 0; border-left: 7px solid var(--chip-color, var(--color-border)); border-bottom: 1px solid color-mix(in srgb, var(--chip-color, var(--color-border)) 28%, var(--color-border-subtle)); background: color-mix(in srgb, var(--chip-color, var(--color-surface)) 10%, var(--color-surface)); text-align: left; }
.milestone-row:hover { background: color-mix(in srgb, var(--chip-color, var(--color-surface)) 15%, var(--color-surface)); }
.milestone-row time { padding: 2px var(--space-2); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--chip-color, var(--color-surface)) 16%, var(--color-surface)); color: color-mix(in srgb, var(--chip-color, var(--color-text)) 70%, var(--color-text)); font: var(--text-xs) var(--font-mono); }
.milestone-row strong { display: inline-flex; align-items: center; gap: var(--space-1); }
.import-candidate { min-height: 58px; display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-2) var(--pad-card); border-bottom: 1px solid var(--color-border-subtle); }
.import-candidate > div { display: grid; gap: var(--space-1); }
.import-candidate small { color: var(--color-text-secondary); }
.settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); align-items: start; }
.snapshot-preview { margin-top: var(--space-3); overflow: hidden; }
.snapshot-preview > .form-actions { justify-content: flex-end; padding: var(--pad-card); }
.workspace-meta { display: grid; grid-template-columns: 110px 1fr; gap: var(--space-2); margin: 0; }
.workspace-meta dt { color: var(--color-text-secondary); font-size: var(--text-xs); }
.workspace-meta dd { min-width: 0; overflow-wrap: anywhere; margin: 0; font: var(--text-xs) var(--font-mono); }
.revision-list { display: grid; gap: var(--space-2); padding-top: var(--space-3); border-top: 1px solid var(--color-border-subtle); }
.revision-list h3 { font-size: var(--text-sm); }
.revision-list > div { display: grid; gap: var(--space-1); padding: var(--space-2); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--color-surface-subtle); }
.revision-list time { color: var(--color-text-secondary); font: var(--text-xs) var(--font-mono); }
.stats-row.extended { grid-template-columns: minmax(160px, 1fr) repeat(4, 90px); }

.chat-refs-page .page-header { margin-bottom: var(--space-3); }
.chat-ref-toolbar { display: grid; grid-template-columns: 96px 96px minmax(260px, 1fr) 180px; align-items: end; gap: var(--space-3); padding: var(--pad-card); margin-bottom: var(--space-3); }
.chat-ref-toolbar > div { display: grid; gap: var(--space-1); }
.chat-ref-toolbar span { color: var(--color-text-secondary); font-size: var(--text-xs); }
.chat-ref-toolbar strong { font-size: var(--text-xl); }
.chat-ref-toolbar input, .chat-ref-toolbar select { width: 100%; }
.chat-ref-board { display: grid; grid-template-columns: 220px minmax(260px, .9fr) minmax(380px, 1.35fr); gap: var(--space-3); align-items: start; }
.chat-ref-column { min-height: 560px; overflow: hidden; }
.chat-theme-list, .chat-group-list, .chat-link-list { display: grid; max-height: calc(100vh - 236px); overflow: auto; }
.chat-theme-list button, .chat-group-list button { display: grid; gap: var(--space-1); padding: var(--space-3); border: 0; border-bottom: 1px solid var(--color-border-subtle); background: var(--color-surface); text-align: left; }
.chat-theme-list button:hover, .chat-group-list button:hover { background: var(--color-surface-muted); }
.chat-theme-list button.is-active, .chat-group-list button.is-active { background: color-mix(in srgb, var(--chip-color, var(--color-accent)) 10%, var(--color-surface)); box-shadow: inset 3px 0 0 var(--chip-color, var(--color-accent)); }
.chat-theme-list button { grid-template-columns: 10px minmax(0, 1fr) auto; align-items: center; }
.chat-theme-list strong, .chat-group-list strong, .chat-link-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-group-list button span, .chat-link-title span, .chat-inbox-strip button span { display: -webkit-box; overflow: hidden; color: var(--color-text-secondary); font-size: var(--text-sm); -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.chat-group-list button small { color: var(--color-text-secondary); font-size: var(--text-xs); }
.chat-link-list { gap: var(--space-2); padding: var(--pad-card); }
.chat-link-card { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--color-surface); }
.chat-link-card:hover { border-color: var(--color-border-strong); background: var(--color-surface-subtle); }
.chat-link-title { display: grid; gap: var(--space-1); padding: 0; border: 0; background: transparent; text-align: left; }
.chat-link-title:hover strong { color: var(--color-accent-strong); }
.chat-link-meta { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-2); }
.chat-link-meta > span { margin-right: auto; color: var(--color-text-secondary); font: var(--text-xs) var(--font-mono); }
.chat-inbox-strip { margin-top: var(--space-3); overflow: hidden; }
.chat-inbox-strip > div:last-child { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-2); padding: var(--pad-card); }
.chat-inbox-strip button { display: grid; gap: var(--space-1); padding: var(--space-2); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--color-surface); text-align: left; }
.chat-inbox-strip button:hover { border-color: var(--color-border-strong); background: var(--color-surface-muted); }

@media (max-width: 1120px) {
  .app-shell { grid-template-columns: 190px minmax(0, 1fr); }
  .app-shell.has-drawer { grid-template-columns: 190px minmax(0, 1fr) 340px; }
  .drawer { width: 340px; }
  .summary-grid { grid-template-columns: repeat(2, 1fr); }
  .dashboard-grid { grid-template-columns: 1fr; }
  .artifact-grid { grid-template-columns: 1fr; }
  .metric-grid { grid-template-columns: repeat(2, 1fr); }
  .home-metrics { grid-template-columns: repeat(3, 1fr); }
  .today-grid { grid-template-columns: 1fr; }
  .inbox-card-main { grid-template-columns: 24px 112px minmax(180px, 1fr) 150px 132px 34px 34px; }
  .inbox-link-fields { grid-template-columns: 1fr 1fr; }
  .chat-ref-board { grid-template-columns: 190px minmax(220px, .9fr) minmax(320px, 1.2fr); }
  .chat-ref-toolbar { grid-template-columns: 1fr 1fr; }
  .split-gantt { grid-template-columns: 260px minmax(0, 1fr); }
  .gantt-table-head, .gantt-table-row { grid-template-columns: minmax(140px, 1fr) 74px; }
}

@media (max-width: 760px) {
  .app-shell { display: block; }
  .drawer { position: fixed; inset: 0 0 0 auto; width: min(390px, 100vw); box-shadow: var(--shadow-lg); }
  .sidebar { position: static; width: 100%; height: auto; flex-direction: row; align-items: center; padding: var(--space-2); overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--color-border); }
  .brand { min-width: 160px; padding: 0 var(--space-2); border: 0; }
  .brand small, .theme-nav, .utility-nav, .secondary-nav, .profile, .sidebar .nav-heading { display: none; }
  .primary-nav { display: flex; }
  .primary-nav.utility-nav, .primary-nav.secondary-nav { display: none; }
  .primary-nav button { min-width: 72px; justify-content: center; }
  .page { padding: var(--space-3); padding-bottom: 72px; }
  .page-header { min-height: auto; flex-direction: column; margin-bottom: var(--space-4); }
  .header-actions { width: 100%; flex-wrap: wrap; }
  .summary-grid, .theme-card-grid, .notes-grid, .io-grid, .metric-grid { grid-template-columns: 1fr; }
  .home-metrics { grid-template-columns: 1fr; }
  .today-metrics { grid-template-columns: 1fr; }
  .today-task-row { grid-template-columns: 24px minmax(0, 1fr) auto 34px; }
  .today-task-row .inline-icon, .today-task-row .status-badge, .today-task-row time { grid-column: 2; justify-self: start; text-align: left; }
  .inbox-card-main, .inbox-card-details { grid-template-columns: 1fr; padding-left: 0; }
  .inbox-link-fields { grid-template-columns: 1fr; }
  .inbox-card-main > input[type="checkbox"] { width: 20px; }
  .inbox-card-details .form-actions { justify-content: flex-end; }
  .chat-ref-board, .chat-ref-toolbar, .chat-inbox-strip > div:last-child { grid-template-columns: 1fr; }
  .chat-ref-column { min-height: auto; }
  .chat-theme-list, .chat-group-list, .chat-link-list { max-height: none; }
  .settings-grid { grid-template-columns: 1fr; }
  .split-gantt { grid-template-columns: 220px minmax(680px, 1fr); overflow-x: auto; }
  .gantt-table-head, .gantt-table-row { grid-template-columns: minmax(130px, 1fr) 70px; }
  .milestone-row { grid-template-columns: 110px 1fr; }
  .milestone-row > :nth-child(3), .milestone-row > :nth-child(4) { grid-column: 2; }
  .list-toolbar { align-items: stretch; flex-direction: column; }
  .summary-card { min-height: 104px; }
  .mini-gantt-grid { min-width: 760px; }
  .timeline-toolbar { align-items: stretch; flex-direction: column; }
  .segmented { width: 100%; }
  .segmented button { flex: 1; }
  .task-row { grid-template-columns: 24px minmax(0, 1fr) auto; }
  .task-row .status-badge { display: none; }
  .artifact-grid button, .waiting-row, .waiting-row > div { align-items: flex-start; flex-direction: column; }
  .filter-bar { align-items: stretch; flex-direction: column; }
  .filter-bar input { width: 100%; }
  .settings-form label { grid-template-columns: 1fr; }
  .toast { right: var(--space-3); bottom: 72px; left: var(--space-3); flex-wrap: wrap; }
}

/* --- Theme color swatch picker --- */
.color-swatch-picker { display: flex; gap: var(--space-2); padding: var(--space-1) 0; }
.color-swatch { width: 24px; height: 24px; border: 2px solid transparent; border-radius: var(--radius-pill); cursor: pointer; transition: border-color var(--duration-fast) var(--ease); }
.color-swatch:hover { border-color: var(--color-border-strong); }
.color-swatch.is-selected { border-color: var(--color-text); box-shadow: var(--focus-ring); }

/* --- Theme chips (replace select dropdown) --- */
.theme-chips { display: flex; flex-wrap: wrap; gap: var(--space-1); padding: var(--space-1) 0; }
.group-chip-list { display: flex; flex-wrap: wrap; gap: var(--space-1); padding-top: var(--space-1); }
.theme-chip { display: inline-flex; align-items: center; gap: var(--space-1); padding: 3px var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-pill); background: var(--color-surface); font-size: var(--text-xs); cursor: pointer; transition: background var(--duration-fast) var(--ease), border-color var(--duration-fast) var(--ease); }
.theme-chip:hover { border-color: var(--color-border-strong); background: var(--color-surface-muted); }
.theme-chip.is-selected { border-color: color-mix(in srgb, var(--chip-color, var(--color-accent)) 60%, transparent); background: color-mix(in srgb, var(--chip-color, var(--color-accent)) 12%, var(--color-surface)); font-weight: var(--weight-medium); }
.chip-dot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: var(--radius-pill); background: var(--chip-color, var(--color-border-strong)); }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}

``

### $relative

``javascript
export const todayIso = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const addDays = (value, count) => {
  if (!value) return "";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  date.setDate(date.getDate() + count);
  return todayIso(date);
};

export const newId = () => Date.now() + Math.floor(Math.random() * 1000);

export function formValue(data, key, fallback = "") {
  return String(data.get(key) ?? fallback).trim();
}

export function dateLabel(iso, withYear = false) {
  const d = new Date(`${iso}T00:00:00`);
  const parts = withYear
    ? `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${parts} (${["日", "月", "火", "水", "木", "金", "土"][d.getDay()]})`;
}

export function toMarkdown(data) {
  return [
    "# Current Work Context",
    "",
    ...data.themes.flatMap((theme) => {
      const themeTasks = data.tasks.filter((item) => item.theme === theme.id && item.status !== "done");
      const themeWaiting = data.waiting.filter((item) => item.theme === theme.id && item.status === "waiting");
      const themeNotes = data.notes.filter((item) => item.theme === theme.id).slice(0, 5);
      return [
        `## Theme: ${theme.name}`,
        theme.subtitle || "",
        "",
        "### Items",
        ...(themeTasks.length ? themeTasks.map((item) => `- [ ] ${item.due} ${item.title}`) : ["- なし"]),
        "",
        "### Waiting",
        ...(themeWaiting.length ? themeWaiting.map((item) => `- ${item.due} ${item.title} / ${item.owner}`) : ["- なし"]),
        "",
        "### Recent Notes",
        ...(themeNotes.length ? themeNotes.map((note) => `- ${note.title}: ${note.body}`) : ["- なし"]),
        "",
      ];
    }),
  ].join("\n");
}

function yamlScalar(value) {
  return JSON.stringify(value ?? "");
}

export function toYaml(data) {
  const blocks = [];
  for (const [key, values] of Object.entries(data)) {
    if (!Array.isArray(values)) continue;
    blocks.push(`${key}:`);
    for (const value of values) {
      const entries = Object.entries(value);
      blocks.push(`  - ${entries[0][0]}: ${yamlScalar(entries[0][1])}`);
      entries.slice(1).forEach(([field, fieldValue]) => blocks.push(`    ${field}: ${yamlScalar(fieldValue)}`));
    }
  }
  return blocks.join("\n");
}

function parseYamlValue(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed.replace(/^['"]|['"]$/g, "");
  }
}

export function parseSimpleYaml(text) {
  const result = {};
  let section = null;
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, "  ");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const sectionMatch = line.match(/^([A-Za-z_][\w-]*):\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      result[section] = [];
      current = null;
      continue;
    }
    const itemMatch = line.match(/^\s*-\s+([A-Za-z_][\w-]*):\s*(.*)$/);
    const fieldMatch = line.match(/^\s+([A-Za-z_][\w-]*):\s*(.*)$/);
    if (itemMatch && section) {
      current = {};
      result[section].push(current);
      current[itemMatch[1]] = parseYamlValue(itemMatch[2]);
    } else if (fieldMatch && current) {
      current[fieldMatch[1]] = parseYamlValue(fieldMatch[2]);
    }
  }
  if (!Object.keys(result).length) throw new Error("JSONまたは配列形式のYAMLを入力してください");
  return result;
}

``

### $relative

``typescript
import { useEffect, useState } from "react";

// 画面のUI設定（表示トグル・スケール等）をlocalStorageに残すための小さなフック。
// これは正本データ（SQLite）ではなく「閉じれば捨ててもよいが、次回も同じ表示で開きたい」UI状態。
// キーは {app-name}:{用途} 規約に合わせる。読めない/壊れた値は黙って初期値へフォールバックする。
const PREFIX = "tasuken-research-desk:";

export function usePersistentState<T>(key: string, initial: T): [T, (next: T | ((current: T) => T)) => void] {
  const storageKey = `${PREFIX}${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw == null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // 保存に失敗してもUI状態が消えるだけで正本には影響しないため握りつぶす。
    }
  }, [storageKey, value]);

  return [value, setValue];
}

``

### $relative

``typescript
import type {
  Entity,
  EntityType,
  SaveOperation,
  SaveOptions,
  SnapshotInspectResult,
  Workspace,
  WorkspaceMeta,
} from "../types/workspace";

export const IPC = {
  workspaceLoad: "workspace:load",
  workspaceBootstrap: "workspace:bootstrap",
  workspaceMeta: "workspace:meta",
  preferenceGet: "preference:get",
  preferenceSet: "preference:set",
  clipboardWriteText: "clipboard:write-text",
  appReload: "app:reload",
  entityList: "entity:list",
  entityGet: "entity:get",
  entitySave: "entity:save",
  entitySaveMany: "entity:save-many",
  entityRemove: "entity:remove",
  entityRestore: "entity:restore",
  snapshotExport: "snapshot:export",
  snapshotInspect: "snapshot:inspect",
  snapshotApply: "snapshot:apply",
} as const;

export interface ResearchDeskApi {
  workspace: {
    load(): Promise<Workspace>;
    bootstrap(legacy: Workspace): Promise<Workspace>;
    getMeta(): Promise<WorkspaceMeta>;
  };
  preferences: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<boolean>;
  };
  clipboard: {
    writeText(text: string): Promise<boolean>;
  };
  app: {
    reload(): Promise<boolean>;
    onWorkspaceChanged(callback: () => void): () => void;
  };
  entities: {
    list(type: EntityType, includeDeleted?: boolean): Promise<Entity[]>;
    get(type: EntityType, id: string): Promise<Entity | null>;
    save(type: EntityType, entity: Entity, options?: SaveOptions): Promise<Entity>;
    saveMany(operations: SaveOperation[]): Promise<Entity[]>;
    remove(type: EntityType, id: string): Promise<Entity>;
    restore(type: EntityType, id: string): Promise<Entity>;
  };
  snapshots: {
    exportFile(): Promise<{ canceled: boolean; filePath?: string }>;
    inspectFile(): Promise<SnapshotInspectResult>;
    // decisionsは「change.key -> action」の対応表。配列ではなくオブジェクトで渡す。
    applyImport(token: string, decisions: Record<string, string>): Promise<Workspace>;
  };
}

``

### $relative

``typescript
import type { ResearchDeskApi } from "./contracts";

declare global {
  interface Window {
    api: ResearchDeskApi;
    researchDesk: ResearchDeskApi;
  }
}

export {};

``

### $relative

``typescript
export const entityTypes = [
  "theme",
  "item",
  "note",
  "link",
  "dependency",
  "view",
  "status_update",
  "source_record",
  "entity_source",
  "relation",
  "field_definition",
  "field_value",
  "log_entry",
  "import_batch",
  "knowledge_node",
  "knowledge_relation",
  "ai_proposal",
] as const;

export type EntityType = (typeof entityTypes)[number];

export interface Entity {
  id: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
  version?: number;
  source?: string;
  [key: string]: unknown;
}

export interface WorkspaceMeta {
  schemaVersion?: number;
  workspaceId?: string;
  deviceId?: string;
  themeMode?: "light" | "dark";
  [key: string]: unknown;
}

export interface Workspace {
  meta?: WorkspaceMeta;
  themes?: Entity[];
  items?: Entity[];
  notes?: Entity[];
  links?: Entity[];
  dependencys?: Entity[];
  views?: Entity[];
  status_updates?: Entity[];
  source_records?: Entity[];
  entity_sources?: Entity[];
  relations?: Entity[];
  field_definitions?: Entity[];
  field_values?: Entity[];
  log_entries?: Entity[];
  import_batchs?: Entity[];
  knowledge_nodes?: Entity[];
  knowledge_relations?: Entity[];
  ai_proposals?: Entity[];
  plan_revisions?: Entity[];
  [key: string]: Entity[] | WorkspaceMeta | undefined;
}

export interface SaveOptions {
  reason?: string;
  source?: string;
}

export interface SaveOperation {
  action: "save";
  type: EntityType;
  entity: Entity;
  options?: SaveOptions;
}

export interface SnapshotDecision {
  type: EntityType;
  id: string;
  action: "create" | "update" | "duplicate" | "ignore";
}

export interface SnapshotInspectResult {
  canceled: boolean;
  token?: string;
  manifest?: Record<string, unknown>;
  changes?: unknown[];
}

``

