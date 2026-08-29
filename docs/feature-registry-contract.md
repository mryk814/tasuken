# Feature Registry Contract

`docs/product-atlas.md`を手書きの図だけで終わらせず、Route・Command Palette・Experimental表示・監査へ接続するための最小契約。

## Definition

```ts
export type FeatureMaturity =
  "core" | "supporting" | "experimental" | "diagnostic" | "dormant" | "deprecated";

export type ExpectedFrequency = "daily" | "weekly" | "occasional" | "research";

export interface FeatureDefinition {
  id: string;
  label: string;
  purpose: string;
  maturity: FeatureMaturity;
  canonicalEntities: string[];
  primarySurface?: string;
  secondarySurfaces?: string[];
  entryPoints: string[];
  expectedFrequency: ExpectedFrequency;
  replacement?: string;
  relatedIssues?: number[];
}
```

## Rules

- `Feature`はcomponentやbuttonではなく、利用者から見た一つの能力。
- Routeを持たない機能も登録する。例: Quick Capture、付箋、別Window、MCP、canonical Markdown。
- `core`は通常の主導線へ置ける。
- `experimental`は通常機能と区別し、削除可能な境界を持つ。
- `diagnostic`は日常作業面へ常設しない。
- `dormant`はデータを削除せず、入口を弱める判断対象。
- `deprecated`は新規作成不可を基本とする。
- primary surfaceは原則一つ。同じ能力を複数場所から起動する場合も、同じApplication Commandを利用する。

## Local Census

外部送信しない端末内集計として、必要な場合だけ次を保持する。

```ts
export interface FeatureUsageSummary {
  featureId: string;
  firstUsedAt?: string;
  lastUsedAt?: string;
  approximateUseCount?: number;
  relatedEntityCount?: number;
  lastEntityChangedAt?: string;
}
```

### 注意

- 利用回数だけで自動削除・降格しない。
- 常時background trackingを増やさず、既存command / route eventから集計する。
- 内容、本文、ファイル名、URLをtelemetryへ複製しない。
- 外部analytics送信は行わない。

## Audit

候補: `npm run audit:features`

検出対象:

- RouteにFeature対応が無い
- Featureのprimary surfaceが複数
- Entityはあるが開くsurface / locatorが無い
- experimental機能が無印でprimary navigationへ出ている
- deprecated機能が新規Entityを作れる
  -同じaction labelが異なるcommandを呼ぶ
- README / route label / Atlas名称の不一致

## Initial Capability Groups

```text
capture
  quick-capture
  inbox
  memo
  sticky-memo
  voice-capture
  screen-recording

document
  notes-workbench
  canonical-markdown
  detached-note
  sketch

work
  task-management
  today
  todo
  waiting
  focus
  timeline
  theme-overview

source-output
  resources
  chat-refs
  artifacts
  media-artifacts
  web-artifacts

ai-context
  agent-session
  ai-proposal-review
  mcp-context
  work-receipts
  ai-pack
  context-preview
  source-anchor
  provenance

diagnostic
  knowledge-diagnostic
  data-health
  settings
```

最初から全機能を厳密に登録せず、RouteとSatellite Windowから始め、実利用レビューごとに増やす。
