import { IconCopy, IconFileTypeSvg, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import {
  buildSlideTimelineCandidates,
  buildSlideTimelineSvg,
  slideTimelineSvgToPng,
  slideTimelineThemeName,
  type SlideTimelineBackground,
  type SlideTimelineUnit,
} from "../lib/slideTimeline";
import type { StatusUpdate, Theme } from "../types";
import type { WorkspaceDomain } from "../domain-model/types";

interface SlideTimelineDialogProps {
  domain: WorkspaceDomain;
  statusUpdates: StatusUpdate[];
  themes: Theme[];
  initialThemeId: string;
  initialStart: string;
  initialEnd: string;
  /** 画面のTimelineと出力対象を揃える（#318）。 */
  initialShowCompleted: boolean;
  onClose(): void;
  setToast(message: string, tone?: "info" | "success" | "warning" | "danger"): void;
}

export function SlideTimelineDialog({
  domain,
  statusUpdates,
  themes,
  initialThemeId,
  initialStart,
  initialEnd,
  initialShowCompleted,
  onClose,
  setToast,
}: SlideTimelineDialogProps) {
  const [themeId, setThemeId] = useState(initialThemeId);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [unit, setUnit] = useState<SlideTimelineUnit>("month");
  const [background, setBackground] = useState<SlideTimelineBackground>("white");
  const [showTasks, setShowTasks] = useState(true);
  // Activityは既定で混ぜない。必要なときだけ明示的に足す（#318）。
  const [showActivity, setShowActivity] = useState(false);
  // 完了の扱いは画面のTimelineへ合わせ、出力対象を一致させる（#318）。
  const [showCompleted, setShowCompleted] = useState(initialShowCompleted);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState(() => `${slideTimelineThemeName(themes, initialThemeId)} Timeline`);
  const [subtitle, setSubtitle] = useState("Taskenから作業の経緯と予定をまとめました");
  const [busy, setBusy] = useState<"copy" | "svg" | null>(null);

  const candidates = useMemo(() => buildSlideTimelineCandidates(domain, statusUpdates, {
    themeId,
    start,
    end,
  }).filter((item) => (
    (showTasks || item.kind !== "task")
    && (showActivity || item.kind !== "activity")
    && (showCompleted || !(item.kind === "task" && item.status === "done"))
  )), [domain, end, showActivity, showCompleted, showTasks, start, statusUpdates, themeId]);

  useEffect(() => {
    setSelectedIds(new Set(candidates.slice(0, 24).map((item) => item.id)));
  }, [candidates]);

  const selected = candidates.filter((item) => selectedIds.has(item.id));
  const themeName = slideTimelineThemeName(themes, themeId);
  const rangeValid = Boolean(start && end && start <= end);
  const svg = useMemo(() => {
    if (!rangeValid) return "";
    return buildSlideTimelineSvg({
      title,
      subtitle,
      themeName,
      start,
      end,
      unit,
      background,
      items: selected,
    });
  }, [background, end, rangeValid, selected, start, subtitle, themeName, title, unit]);

  async function copyForPowerPoint() {
    if (!svg || !selected.length) {
      setToast("コピーする項目がありません。期間と項目選択を確認してください。", "warning");
      return;
    }
    setBusy("copy");
    try {
      await workspaceApi.copyImage({ dataUrl: await slideTimelineSvgToPng(svg, 2) });
      setToast("高解像度PNGをコピーしました。PowerPointでCtrl+Vしてください。", "success");
    } catch (error) {
      setToast(`スライド用画像をコピーできませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setBusy(null);
    }
  }

  async function exportSvg() {
    if (!svg || !selected.length) {
      setToast("書き出す項目がありません。期間と項目選択を確認してください。", "warning");
      return;
    }
    setBusy("svg");
    try {
      const result = await workspaceApi.exportSlideTimeline({ title: title || "Timeline", svg });
      if (result.canceled) {
        setToast("SVGの書き出しをキャンセルしました。", "info");
      } else {
        setToast(`SVGを書き出しました。${result.filePath || ""}`, "success");
      }
    } catch (error) {
      setToast(`SVGを書き出せませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="modal-backdrop slide-timeline-backdrop">
      <section className="slide-timeline-dialog" role="dialog" aria-modal="true" aria-labelledby="slide-timeline-title">
        <header className="slide-timeline-header">
          <div>
            <h2 id="slide-timeline-title">スライド用タイムライン</h2>
            <p>選んだ項目だけを16:9の一枚に整えます。</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="閉じる"><IconX size={19} /></button>
        </header>

        <div className="slide-timeline-body">
          <aside className="slide-timeline-settings">
            <div className="slide-timeline-field-grid">
              <label>Theme
                <select
                  value={themeId}
                  onChange={(event) => {
                    const next = event.target.value;
                    setThemeId(next);
                    setTitle(`${slideTimelineThemeName(themes, next)} Timeline`);
                  }}
                >
                  <option value="all">すべて</option>
                  {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
                </select>
              </label>
              <label>時間軸
                <select value={unit} onChange={(event) => setUnit(event.target.value as SlideTimelineUnit)}>
                  <option value="day">日</option>
                  <option value="week">週</option>
                  <option value="month">月</option>
                </select>
              </label>
              <label>開始
                <input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
              </label>
              <label>終了
                <input type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
              </label>
            </div>
            {!rangeValid && <p className="field-error">終了日は開始日以降にしてください。</p>}

            <label>タイトル
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} />
            </label>
            <label>サブタイトル
              <input value={subtitle} onChange={(event) => setSubtitle(event.target.value)} maxLength={120} />
            </label>

            <div className="slide-timeline-inline-options">
              <label className="toggle"><input type="checkbox" checked={showTasks} onChange={(event) => setShowTasks(event.target.checked)} />Task</label>
              <label className="toggle"><input type="checkbox" checked={showActivity} onChange={(event) => setShowActivity(event.target.checked)} />Activity</label>
              <label className="toggle"><input type="checkbox" checked={showCompleted} onChange={(event) => setShowCompleted(event.target.checked)} />完了</label>
            </div>
            <div className="segmented" aria-label="背景">
              <button className={background === "white" ? "is-active" : ""} onClick={() => setBackground("white")}>白背景</button>
              <button className={background === "transparent" ? "is-active" : ""} onClick={() => setBackground("transparent")}>透明</button>
            </div>

            <div className="slide-timeline-selection-heading">
              <strong>含める項目</strong>
              <span>{selected.length} / {candidates.length}</span>
              <button className="text-button compact" onClick={() => setSelectedIds(new Set(candidates.map((item) => item.id)))}>すべて</button>
              <button className="text-button compact" onClick={() => setSelectedIds(new Set())}>解除</button>
            </div>
            <div className="slide-timeline-selection" aria-label="出力項目">
              {candidates.map((item) => (
                <label key={item.id}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    onChange={(event) => setSelectedIds((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(item.id);
                      else next.delete(item.id);
                      return next;
                    })}
                  />
                  <span className={`slide-timeline-kind is-${item.kind}`}>{item.kind === "task" ? "TASK" : "ACT"}</span>
                  <span className="slide-timeline-item-title">{item.title}</span>
                  <time>{item.start}</time>
                </label>
              ))}
              {!candidates.length && <div className="empty-state compact">この期間のTask / Activityはありません。</div>}
            </div>
          </aside>

          <main className={`slide-timeline-preview is-${background}`}>
            <div className="slide-timeline-slide">
              {svg
                ? <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt="スライド用タイムラインのプレビュー" />
                : <div className="empty-state">期間を確認してください。</div>}
            </div>
            {selected.length > 24 && <p className="slide-timeline-overflow-note">1枚には先頭24件を表示します。項目を絞ると読みやすくなります。</p>}
          </main>
        </div>

        <footer className="slide-timeline-footer">
          <span>PNG 3200 × 1800 / SVG 1600 × 900</span>
          <button className="secondary-button" disabled={busy !== null} onClick={() => void exportSvg()}><IconFileTypeSvg size={17} />{busy === "svg" ? "書き出し中…" : "SVGを書き出す"}</button>
          <button className="primary-button" disabled={busy !== null} onClick={() => void copyForPowerPoint()}><IconCopy size={17} />{busy === "copy" ? "コピー中…" : "PowerPoint用にコピー"}</button>
        </footer>
      </section>
    </div>
  );
}
