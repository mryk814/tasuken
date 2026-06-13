# myui

個人用のUI/ツール/ダッシュボードを作るプロジェクト。
主な用途: 研究の実験結果グラフ、データ分析・可視化（Python/Plotly）、個人用デスクトップアプリ（書籍管理等）、Webアプリ・管理画面。

---

## Setup

<!-- プロジェクト固有の起動・ビルド手順をここに書く -->

---

## Project structure

### ディレクトリ構成の原則

プロジェクトの種類に応じて構成を選ぶ。どれを使うかは最初に決め、途中で変えない。

**単一アプリ（ほとんどの場合これ）:**

```
{project}/
├── src/
│   ├── main.jsx          # エントリポイント（描画のみ、ロジックなし）
│   ├── App.jsx           # ルートコンポーネント
│   └── styles.css        # スタイル（tokens.css を @import）
├── index.html
├── vite.config.mjs
├── package.json
└── AGENTS.md
```

**複数アプリ（モノレポ）:**

```
{project}/
├── apps/
│   └── {app-name}/       # 各アプリ（単一アプリと同じ内部構造）
├── shared/               # 共有コード（あれば）
├── package.json          # ルート（workspaces 設定）
└── AGENTS.md
```

- モノレポでは npm/pnpm workspaces を使い、依存を共有する。`file:` symlink で他アプリの `node_modules` を参照しない。
- 1アプリしか作らないのに `apps/` を掘らない。最初は単一アプリで始め、2つ目が必要になったらモノレポに移行する。

### ファイル分割の基準

- **小規模（〜500行程度）は `App.jsx` 1ファイルでよい。** 画面が増えたり、コンポーネントを3箇所以上で再利用する場合に分割する。
- **分割時のディレクトリ:**
  - `src/components/` — 再利用コンポーネント（`StatusBadge.jsx`）
  - `src/pages/` または `src/views/` — 画面単位のコンポーネント
  - `src/utils/` — ロジック・ヘルパー（`formatDate.js`）
  - `src/hooks/` — カスタム hooks（`useLocalStorage.js`）
- **CSS は `src/styles.css` 1ファイルを基本とする。** 800行を超えたらコンポーネント単位で分割してよい。
- **データ・定数**はコンポーネントファイルの先頭か、量が多ければ `src/data/` に置く。
- 使わないディレクトリを先に作らない。必要になった時点で作る。

### 命名規則

| 対象 | 規則 | 例 |
|------|------|------|
| プロジェクト / アプリ名 | kebab-case | `run-workbench`, `book-manager` |
| コンポーネントファイル | PascalCase.jsx | `StatusBadge.jsx`, `RunList.jsx` |
| ユーティリティ・hooks | camelCase.js | `useLocalStorage.js`, `formatDate.js` |
| CSS class | kebab-case（flat） | `run-row`, `panel-heading`, `badge-completed` |
| localStorage キー | `{app-name}:{キー名}` | `run-workbench:runs`, `run-workbench:theme` |

---

## Tech stack

### 既定の選択

新しいプロジェクトを始めるとき、特に理由がなければ以下を使う。用途に応じてプラットフォームを選ぶ。

**Web アプリ（既定）:**

| 項目 | 選択 | 備考 |
|------|------|------|
| 言語 | **JavaScript**（JSX） | TypeScript は複雑さに見合う規模になったら検討（要相談） |
| ビルド | **Vite** | 設定は `vite.config.mjs` |
| UI | **React** | `.jsx` 拡張子 |
| CSS | **vanilla CSS + design-standard/tokens.css** | CSS Modules・CSS-in-JS は使わない |
| アイコン | **Tabler Icons** (`@tabler/icons-react`) | プロジェクト内で他のセットと混ぜない |

**デスクトップアプリ:**

| 項目 | 選択 | 備考 |
|------|------|------|
| フレームワーク | **Electron** (Vite + React) | Web スタックをそのまま活かせる。Tauri は Rust ビルド環境が必要になるため、明確な理由がなければ Electron |
| UI | Web アプリと同じ（React + vanilla CSS） | |
| トークン | Web と同じ `tokens.css` を使う | |
| ファイル操作等 | Electron の Node.js API / IPC | renderer と main process の分離は守る |

**データ分析・可視化（Python）:**

| 項目 | 選択 | 備考 |
|------|------|------|
| 言語 | **Python** | |
| 可視化 | **Plotly**（インタラクティブ） | matplotlib は静的な出力が必要な場合のみ。基本は Plotly を優先 |
| 簡易アプリ化 | **Streamlit** または **Dash** | 結果を触って確認するための軽い画面。本格的な Web アプリにはしない |
| データ操作 | **pandas** / **polars** | プロジェクトに合う方を選ぶ |
| ノートブック | Jupyter は探索段階で使ってよい | 成果物として残す場合はスクリプト（`.py`）に整理する |

- Plotly のカラーパレットは `tokens.json` のチャート色（`chart-1`〜`chart-6`）を `plotly.io.templates` やレイアウトの `colorway` に設定して合わせる。
- 凡例・軸・背景の配色もトークンに寄せる。完全一致は不要だが、burgundy をアクセントに使い、背景はクリーム系にする方向性は保つ。
- 色だけに頼らず、線種・マーカー形状を併用する原則はデザインガイドと同じ。
- Streamlit/Dash で画面を作る場合もデザインガイドのUX規約（4状態、エラー文、操作フィードバック等）は意識する。ただし CSS レベルのトークン厳守は求めない。

**CLI / スクリプト:**

| 項目 | 選択 | 備考 |
|------|------|------|
| 言語 | **Python** または **Node.js**（ESM） | データ処理寄りなら Python、Web ツール寄りなら Node.js |
| 出力の色 | `tokens.json` のカラーを参考にしてよいが、ターミナル標準色で十分 | |

- プラットフォームの選択は自由にしてよい。迷ったら Web アプリから始める（ブラウザさえあれば動く）。
- デザイントークンは全プラットフォーム共通。CSS が使えない環境では `tokens.json` の値をプラットフォームの色・寸法定義に移し替える。

### 技術選定の判断基準

- **状態管理**: `useState` + `useReducer` で済むなら外部ライブラリを入れない。状態が複数コンポーネント間で複雑に共有されるなら検討（要相談）。
- **永続化**: ブラウザ完結なら `localStorage`。デスクトップアプリはローカルファイル（JSON / SQLite）。複数端末同期やデータ量が大きい場合はサーバー/DB（要相談）。
- **依存追加**: 標準 API や既存コードで実現できるなら追加しない。追加する場合は理由を示して確認を取る。

### やらないこと

- 使う予定のないツール・設定を「念のため」入れない（ESLint, Prettier, husky 等は必要になったら足す）。
- ボイラープレートジェネレータ（create-react-app, create-next-app 等）の出力をそのまま使わない。不要なファイルが大量に入る。必要なものだけ手で置く。

---

## Code style

- フォーマットは一般的な整形に従う（セミコロンあり、引用符はプロジェクト内で統一）。
- `import` はフレームワーク → 外部ライブラリ → ローカル の順。

---

## Design standard

このプロジェクトには確定済みの個人デザイン標準がある。
UI・GUI・グラフ・ツールの見た目を作る作業では**必ず従うこと**。

**詳細は以下を参照（これが唯一の真実）:**

- 原則・挙動・アンチパターン・文章規定: [`design-standard/design-guide.md`](./design-standard/design-guide.md)
- トークン（CSS変数、ライト/ダーク両対応）: [`design-standard/tokens.css`](./design-standard/tokens.css)
- トークン（JSON、CSS以外の環境用）: [`design-standard/tokens.json`](./design-standard/tokens.json)

### 要約（全文は design-guide.md）

- 方向性: 「親しみ柔らかめ × burgundy」
- アクセント `#8A2F3B` は操作/重要のみ。エラーの赤(`#CE3B3B`)と混同しない
- 非ベース色は「状態色（意味固定・流用禁止）」と「カテゴリ色（chart-*・区別のみ）」を分ける。タグ/バッジ/バーは色を消してもテキストで識別できること（色は補助）。多値の状態は既定をニュートラル
- コンパクト密度・角丸7px・丸ゴシック(Nunito系)・数値は等幅で桁揃え
- focusリング必須・ライト/ダーク両対応
- 主要なデータ領域・非同期フローで、該当する4状態（読込中・空・エラー・成功）を到達可能にする
- エラーでもフォーム入力を消さない。復元可能な操作はundo、不可逆・大量・外部影響のある操作は具体的に確認
- 操作要素はdefault/hover/activeの3状態必須。フィードバックは100ms以内
- 通常画面は説明文ゼロから始める。状態説明は省略しない。1画面の主目的は1種類、強いPrimaryは同時に1つ
- 同一階層で並列に判断させる主要操作は7個までを目安にする
- 絵文字アイコン・紫グラデ・影マシマシ・テンプレ構成の"いかにも"禁止
- コンポーネントの過剰設計を避ける
- エラー文は原因＋直し方。ボタンは動詞。トーンは簡潔・落ち着いた敬体
- テキストファイルはUTF-8で読み書きする

---

## Testing

<!-- TODO: テストの走らせ方・方針が決まったら記載 -->

---

## Git conventions

<!-- TODO: ブランチ命名・コミットメッセージ・PR規約が決まったら記載 -->

---

## Boundaries

### Always do

- design-standard/ のトークンを参照する
- 主要なデータ領域・非同期フローで、発生しうる4状態を設計する
- focusリングを表示する
- 数値は等幅で桁揃え
- 色・余白・角丸・文字サイズ・影・動きはトークン変数から
- 日本語を含むファイルはUTF-8を明示して扱う
- Project structure / Tech stack セクションの構成・命名規則に従う
- 表・一覧にはクリップボードコピーの導線を用意する

### Ask first

- 新しい依存パッケージの追加
- design-standard/ 自体の変更
- 大きなリファクタリング
- TypeScript への移行、CSS-in-JS の導入
- サーバー/DB の新規導入
- Tech stack の既定以外のフレームワーク選定（Tauri、Flutter 等）

### Never do

- トークンから外れた色・余白・角丸・文字サイズを場当たり的にハードコード
- burgundy をエラー表示に使う
- 11px未満の文字
- 絵文字アイコン
- 説明文の洪水・テンプレ構成の"いかにも"
- `file:` symlink で他パッケージの `node_modules` を参照する
- ブラウザ/OS の既定キーボードショートカットを上書きする
- ボイラープレートジェネレータの出力をそのまま使う
