import type { DailyContextPlan, DailyContextSource } from "./dailyContext";
import type { PublicSourceProjection } from "./publicSourceProjection";

export interface PublishedContextDay extends Pick<
  DailyContextPlan,
  | "relativePath"
  | "contentHash"
  | "sourceRevision"
  | "generatedAt"
  | "selection"
  | "sources"
  | "includedCount"
  | "excludedCount"
  | "excludedReasons"
  | "partial"
> {
  groups?: Array<{
    themeId: string | null;
    themeTitle: string | null;
    sources: DailyContextSource[];
  }>;
  bodySources?: Array<
    Pick<PublicSourceProjection, "source" | "themeId" | "title" | "relativePath" | "contentHash">
  >;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inline = (value: string) =>
  value.replace(/[\r\n]+/g, " ").replace(/[\\`*_{}[\]()<>#!|]/g, "\\$&");
const dateText = (date: Date) => date.toISOString().slice(0, 10);
const dateOf = (date: string) => new Date(`${date}T00:00:00Z`);
const sourceKey = (source: DailyContextSource) => JSON.stringify([source.type, source.id]);

export function publishedDayGroups(
  plan: DailyContextPlan,
): NonNullable<PublishedContextDay["groups"]> {
  const groups = new Map<
    string | null,
    { themeId: string | null; themeTitle: string | null; sources: Map<string, DailyContextSource> }
  >();
  for (const row of plan.rows) {
    let group = groups.get(row.themeId);
    if (!group) {
      group = { themeId: row.themeId, themeTitle: row.themeTitle, sources: new Map() };
      groups.set(row.themeId, group);
    }
    group.sources.set(sourceKey(row.source), row.source);
  }
  return [...groups.values()]
    .sort((a, b) => compare(a.themeId ?? "", b.themeId ?? ""))
    .map((group) => ({
      ...group,
      sources: [...group.sources.values()].sort((a, b) => compare(sourceKey(a), sourceKey(b))),
    }));
}

/** Calendar dates are already selected in the manifest timezone; ISO weeks start Monday. */
export function contextIsoWeek(date: string): { key: string; start: string; end: string } {
  const monday = dateOf(date);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const thursday = new Date(monday);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const first = dateOf(`${year}-01-04`);
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  const number = 1 + Math.round((monday.getTime() - first.getTime()) / 604800000);
  const end = new Date(monday);
  end.setUTCDate(end.getUTCDate() + 6);
  return {
    key: `${year}-W${String(number).padStart(2, "0")}`,
    start: dateText(monday),
    end: dateText(end),
  };
}

/** Builds only from previously published projection metadata, never canonical records. */
export function buildPeriodContextFiles({
  days,
  timezone,
  pendingDate = null,
}: {
  days: Record<string, PublishedContextDay>;
  timezone: string;
  pendingDate?: string | null;
}): Record<string, string> {
  const dates = Object.keys(days).sort(compare);
  const files: Record<string, string> = {};
  const years = [...new Set(dates.map((date) => date.slice(0, 4)))];
  const months = [...new Set(dates.map((date) => date.slice(0, 7)))];
  const weeks = [
    ...new Map(
      dates.map((date) => {
        const week = contextIsoWeek(date);
        return [week.key, week] as const;
      }),
    ).values(),
  ].sort((a, b) => compare(a.key, b.key));
  const link = (file: string, label: string) => `[${inline(label)}](${file})`;
  const common = `タイムゾーン: ${inline(timezone)}。日付はこのタイムゾーンの暦日です。週は月曜始まりのISO週（週番号の年は暦年と異なる場合があります）。\n\n公開記録への索引です。予定・入力・作業記録を成果や作業時間へ読み替えません。件数は型とIDで重複を除いた出典数で、実績件数ではありません。未公開は未活動を意味せず、公開0件も「何もしなかった」を意味しません。クラウド同期・検索反映は未確認です。\n\n公開処理の完了はルートの管理ファイル .tasken-context.json の pending が null で、管理対象の退避ファイル（.tmp / .bak）が残っていないことを確認してください。未完了の場合、索引と日別ファイルに更新前後の内容が混在するため、同じ日を再公開するまで振り返りの根拠に使用しないでください。`;
  function dayLine(date: string) {
    const day = days[date];
    const count = new Set(day.sources.map(sourceKey)).size;
    const state =
      pendingDate === date
        ? "未反映・再公開が必要（前回の公開内容）"
        : day.partial
          ? "部分公開・収録打切り"
          : day.includedCount === 0
            ? "公開済み・収録0件"
            : "公開済み";
    return `- ${link(`../${day.relativePath}`, date)} — ${state} / 出典 ${count}件 / 除外 ${day.excludedCount}件 / ${day.selection.themeId ? "選択Themeのみ" : "Theme横断"} / 最終生成 ${inline(day.generatedAt)} / revision ${inline(day.sourceRevision)}`;
  }
  function period(title: string, start: string, end: string, children: string[]) {
    const selected = dates.filter((date) => date >= start && date <= end);
    const calendarDays =
      Math.round((dateOf(end).getTime() - dateOf(start).getTime()) / 86400000) + 1;
    const sourceCount = new Set(selected.flatMap((date) => days[date].sources.map(sourceKey))).size;
    const groups = new Map<string, { title: string; dates: Set<string> }>();
    const types = new Map<string, Set<string>>();
    for (const date of selected) {
      const day = days[date];
      for (const source of day.sources) {
        const entries = types.get(source.type) ?? new Set<string>();
        entries.add(sourceKey(source));
        types.set(source.type, entries);
      }
      for (const group of day.groups ?? [
        { themeId: null, themeTitle: "所属情報未収録（旧公開物）", sources: day.sources },
      ]) {
        const key = JSON.stringify([group.themeId, group.themeTitle]);
        const entry = groups.get(key) ?? {
          title: group.themeTitle ?? (group.themeId ? "名称未収録のTheme" : "Themeなし"),
          dates: new Set<string>(),
        };
        entry.dates.add(date);
        groups.set(key, entry);
      }
    }
    return `# ${title}\n\n${common}\n\n対象: ${start}〜${end}\n公開日 ${selected.length}日 / 未公開日 ${calendarDays - selected.length}日 / 重複を除いた出典 ${sourceCount}件\n\nここに列挙されていない対象期間内の日は未公開です。除外された内容は収録されていません。\n\n${children.length ? `## 期間への入口\n\n${children.join("\n")}\n\n` : ""}## 日別の収録範囲と出典\n\n${selected.map(dayLine).join("\n") || "公開済みの日はありません。"}\n\n日別ファイル内の型・ID・revision・関連参照から元記録を確認できます。\n\n## Theme別\n\n${
      [...groups.entries()]
        .sort(([a], [b]) => compare(a, b))
        .map(
          ([, group]) =>
            `### ${inline(group.title)}\n\n${[...group.dates]
              .sort(compare)
              .map((date) => `- ${link(`../${days[date].relativePath}`, date)}`)
              .join("\n")}`,
        )
        .join("\n\n") || "収録されたTheme情報はありません。"
    }\n\n## 記録種別別の出典数\n\n${
      [...types]
        .sort(([a], [b]) => compare(a, b))
        .map(([type, sources]) => `- ${inline(type)}: ${sources.size}件`)
        .join("\n") || "出典0件"
    }\n`;
  }
  for (const week of weeks)
    files[`Weeks/${week.key}.md`] = period(week.key, week.start, week.end, []);
  for (const month of months) {
    const end = dateOf(`${month}-01`);
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(0);
    files[`Months/${month}.md`] = period(
      month,
      `${month}-01`,
      dateText(end),
      weeks
        .filter((week) => week.start <= dateText(end) && week.end >= `${month}-01`)
        .map((week) => `- ${link(`../Weeks/${week.key}.md`, week.key)}`),
    );
  }
  for (const year of years)
    files[`Years/${year}.md`] = period(year, `${year}-01-01`, `${year}-12-31`, [
      ...months
        .filter((month) => month.startsWith(year))
        .map((month) => `- ${link(`../Months/${month}.md`, month)}`),
      ...weeks
        .filter((week) => week.start <= `${year}-12-31` && week.end >= `${year}-01-01`)
        .map((week) => `- ${link(`../Weeks/${week.key}.md`, week.key)}`),
    ]);
  files["README.md"] =
    `# Taskenの公開記録\n\n${common}\n\n収録期間: ${dates.length ? `${dates[0]}〜${dates.at(-1)}` : "公開日なし"}\n\n${pendingDate ? `未反映: ${pendingDate}。再公開が必要です。\n\n` : ""}## 年から読む\n\n${years.map((year) => `- ${link(`Years/${year}.md`, year)}`).join("\n") || "公開日なし"}\n\n各年の索引から月・週、日別記録、出典へ進めます。掲載のない日は未公開です。\n`;
  return files;
}
