<!-- GitHub Copilot: project-level instructions -->
<!-- Canonical source: AGENTS.md at project root + design-standard/ directory -->

# myui

個人用のUI/ツール/ダッシュボードを作るプロジェクト。
詳細なプロジェクト指示は `AGENTS.md` を参照。

## Design standard

確定済みの個人デザイン標準がある。UI作業では必ず従う。

- Full guide: `design-standard/design-guide.md`
- CSS tokens: `design-standard/tokens.css`
- JSON tokens: `design-standard/tokens.json`

Quick rules:
- Direction: "warm & approachable × burgundy"
- Accent `#8A2F3B` for actions only. Errors use `#CE3B3B`
- 7px radius, compact density, Nunito font, tabular-nums
- Focus ring required, light/dark mode required
- 4 states per screen (loading, empty, error, success)
- No emoji icons, no purple gradients, no shadow-heavy, no template filler
- Zero explanatory text by default (Progressive Disclosure)
- One Primary Action per screen
- 3 states per interactive element (default/hover/active)
- Error messages: cause + fix. Buttons: verbs. Tone: concise, calm
