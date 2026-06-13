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
  { id: 201, theme: "material-a", title: "条件Bバリエーションの測定結果について", type: "研究メモ", updated: "今日 09:12", body: "条件Bのバリエーション（温度±5℃）の測定結果を受領。強度はやや向上、ばらつきは条件Aより小さい。解析方針はまだ確定せず、再現性の確認が必要。" },
  { id: 202, theme: "material-a", title: "解析方針の候補メモ", type: "検討メモ", updated: "昨日 18:40", body: "多変量解析または曜日ごとの分解を比較検討。再現性が十分でないため、まず曜日まで傾向把握。追加データで多変量に切り替える。" },
  { id: 203, theme: "material-a", title: "中間報告の構成案", type: "構成メモ", updated: "06/11 21:15", body: "背景 / 目的 / 方法 / 結果（条件A・B）/ 考察 / 今後の予定" },
  { id: 204, theme: "process", title: "加工条件レビュー", type: "会議メモ", updated: "06/10 16:30", body: "温度・速度・保持時間の3因子を優先。次回までに欠測条件を整理する。" },
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

export const initialLinks = [
  { id: 301, theme: "material-a", title: "測定計画書_v1.2.pdf", url: "https://example.com/measurement-plan", type: "paper", description: "材料Aの測定条件と評価手順" },
  { id: 302, theme: "material-a", title: "データ一覧_20260610.xlsx", url: "https://example.com/measurement-data", type: "sharepoint", description: "条件A・Bの測定結果一覧" },
  { id: 303, theme: "material-a", title: "中間報告_骨子.pptx", url: "https://example.com/interim-report", type: "onedrive", description: "7月1日の中間報告用資料" },
];

export const initialPeople = [
  { id: 401, name: "佐藤さん", role: "評価担当", organization: "評価チーム", note: "材料測定の窓口" },
  { id: 402, name: "田中さん", role: "試作担当", organization: "試作チーム", note: "条件Cの試作担当" },
];
