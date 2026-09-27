# Tasken Android コンセプト画像の生成記録

方式：内蔵image_gen。プレビュー用の1枚・3画面。生成後に目視確認した。

## 目視所見と補正

紙の記録、右端の完了操作、端末保存とPC反映の区別は方向性の確認に使える。ただし以下は実装へ持ち込まない。

- 右画面のAIタブ選択は誤り。今日の記録はTodayから開く既存Recallを保つ。
- `32/500` は架空の文字数制限。新しい制限を導入しない。
- 左画面のChecklist左側にもチェック状の記号がある。操作は右側へ一本化する。
- 装飾的コピーは常設せず、本人のTaskと記録に置き換える。
- 大きな保存印は絵コンテ上の拡大表現。実UIでは次の操作を遮らない。
- 影、紙の穴、積層は最小限に削り、既存トークンと密度を優先する。
- タブアイコンは既存を維持する。AIを本のアイコンへ変更しない。

## 最終プロンプト

```text
Use case: ui-mockup. Create a polished Japanese Android productivity app concept board, landscape, three equally sized tall narrow phone UI panels on a quiet pale neutral background. Title "Tasken — 仕事の手触り". These are proposed designs, not screenshots. Audience Japanese research engineers, right-handed one-hand Fold cover-screen usage. Realistic densely useful native mobile layouts, mature but tactile and delightful, collectible research notebook aesthetic. Maintain existing visual identity: burgundy #8A2F3B only for actions/selection, pale #F4EEEC background, white surfaces, #26201E body text, #DCC1C4 borders, success green #2E8B57 only for saved state. Modest 7–10dp corners, Japanese rounded sans body akin Noto Sans JP, Nunito date numerals, compact task rows, excellent readable Japanese text. NO huge progress rings, XP, streak flames, mascot, fake charts, gold rewards, neon, glossy 3D, confetti covering text. Signature: a small notebook-like strip with real dated entries and a tactile stamped check on confirmed saving, a subtle attractive layered paper edge on record cards, restrained.
LEFT phone "01 開く": header Today, date 9月27日（日）, small quiet sync indicator. Prominent real task "触媒Aの測定結果を比較" with theme "触媒探索" and checklist "測定値を確認" and "比較図を作る", check controls on RIGHT. Below heading "今日のTask", rows "試料Bを準備" and "考察メモを見直す", small footer section "今日残したもの" with meaningful snippet "温度条件の違いを記録". No invented AI recommendation or start timer. Plus and microphone buttons at lower right above nav. Bottom navigation Today / ToDo / AI.
MIDDLE phone "02 残す": capture bottom sheet occupying most screen, title "一言残す", transcription "温度を上げると反応が速くなった。次は濃度を変えて比べる。", small theme chip "触媒探索", clear editable text area with generous height and small mic icon, quiet helper "内容を確認して保存", bottom right primary "記録を保存", small confirmation shown as storyboard inset below main form "端末に保存しました" with green stamped check and "PCへ未反映". Show a few tiny localized check motion marks only; nothing implying server sync success.
RIGHT phone "03 眺める": header "今日の記録", date, notebook strip of actual two short records and a completed task, discrete labeled rows "作業記録" / "Task完了" / "未整理". Main attractive paper card text "温度条件の違いを記録", snippet "次は濃度を変えて比べる。", second small card "測定値を確認" with task completion label. Simple week date strip with no scoring. Bottom right "一言残す" action. Put small caption outside panels "UIコンセプト / 未実装". Prioritize coherent usable interface rather than advertising illustration. Flat front view without physical device frames. All data entirely fictional.
```
