# Design QA

## Comparison Target

- Source visual truth: `qa/reference-home.png`
- Implementation screenshot: `qa/implementation-home-drawer.png`
- Long-term Gantt screenshot: `qa/implementation-timeline.png`
- Full-view comparison: `qa/comparison-home-final.png`
- Focused dashboard comparison: `qa/comparison-dashboard-focus.png`
- Viewport: 1536 x 1080
- State: light theme, 材料A評価, 待ち詳細ドロワー open

## Findings

No actionable P0, P1, or P2 findings remain.

- [P3] Navigation iconography is intentionally reduced.
  - Location: left navigation and header actions.
  - Evidence: the reference uses a full icon set; the implementation uses text labels and a restrained `RD` mark.
  - Impact: navigation remains clear and keyboard accessible, but the visual match is slightly less illustrative.
  - Follow-up: add Tabler Icons after explicit dependency approval.

- [P3] The implementation uses slightly tighter small-text rendering.
  - Location: task dates, memo summaries, and Gantt labels.
  - Evidence: the focused comparison shows marginally smaller optical sizing than the mock.
  - Impact: the compact density remains readable at the target viewport.
  - Follow-up: tune the `--text-xs` and `--text-sm` mapping only if a roomier display is preferred.

## Required Fidelity Surfaces

- Fonts and typography: passed. Nunito-compatible rounded fallbacks, tabular numeric rendering, hierarchy, wrapping, and minimum text size are consistent.
- Spacing and layout rhythm: passed. Three-pane desktop layout, compact cards, 7px controls, section rhythm, and responsive stacking match the target.
- Colors and visual tokens: passed. All application styling uses `design-standard/tokens.css`; burgundy is reserved for primary interaction and danger uses semantic red.
- Image quality and asset fidelity: passed. The selected design contains no required photographic or illustrative content. No placeholder imagery is used.
- Copy and content: passed. Research-specific Japanese sample data and concise action labels match the approved concept.

## Interaction And State Checks

- Theme navigation and hash routes: passed.
- Add-item drawer and form submission: passed.
- Task completion, waiting completion, delete with undo: passed.
- Timeline scale controls, theme filter, baseline and waiting toggles: passed.
- Quick Capture and browser-local persistence: passed.
- Loading, empty, error, and success state preview: passed.
- Light/dark token modes: passed by token integration.
- Mobile layout at 760px: passed after reducing the top navigation to four primary destinations.
- Browser console errors and warnings: none.
- Production build: passed.

## Patches Made During QA

- Changed the waiting detail from an overlay to a true third desktop pane.
- Made the dedicated Timeline page open with all themes visible.
- Replaced gradient-based timeline grid lines with explicit token-colored rules.
- Removed secondary navigation from the compact mobile header.
- Added an explicit Vite root for stable Windows production builds.

## Follow-up Polish

- Add the approved Tabler icon set when dependency expansion is desired.
- Consider user-controlled density settings after real daily usage.

final result: passed
