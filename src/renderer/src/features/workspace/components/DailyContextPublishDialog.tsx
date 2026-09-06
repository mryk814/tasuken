import { useEffect, useRef, useState } from "react";
import type { DailyContextPlan } from "../../../../../shared/dailyContext";
import { useWorkspaceStore } from "../../../stores/workspaceStore";
import { workspaceApi } from "../../../services/workspaceApi";
import type { PageProps } from "../types";
import { Button, ThemePickerSelect } from "./common";
import "./DailyContextPublishDialog.css";

export function DailyContextPublishDialog({
  today,
  themes,
  close,
}: {
  today: string;
  themes: PageProps["themes"];
  close(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const [date, setDate] = useState(today);
  const [theme, setTheme] = useState("all");
  const [root, setRoot] = useState("");
  const [plan, setPlan] = useState<DailyContextPlan | null>(null);
  const [working, setWorking] = useState(false);
  const [partialConfirmed, setPartialConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const preview = useWorkspaceStore((state) => state.previewDailyContext);
  const publish = useWorkspaceStore((state) => state.publishDailyContext);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus({ preventScroll: true });
    };
  }, []);
  function changed() {
    setPlan(null);
    setError("");
    setResult("");
    setPartialConfirmed(false);
  }
  async function run(action: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setError("");
    setResult("");
    try {
      await action();
    } catch (failure) {
      setError(
        (failure instanceof Error ? failure.message : String(failure)).replace(
          /^Error invoking remote method '[^']+': (?:Error: )?/,
          "",
        ),
      );
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="daily-context-dialog"
      aria-labelledby="daily-context-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy.current) close();
      }}
    >
      <h2 id="daily-context-title">公開用Markdown</h2>
      <p>現在M365への公開を許可した記録を、読み取り専用のMarkdownにまとめます。</p>
      <fieldset disabled={working}>
        <label>
          対象日
          <input
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
              changed();
            }}
          />
        </label>
        <span className="muted">タイムゾーン: {timezone}</span>
        <label>
          Theme（記録当時の所属）
          <ThemePickerSelect
            themes={themes}
            value={theme}
            allowAll
            allLabel="全Theme・未設定"
            ariaLabel="公開するTheme"
            onChange={(value) => {
              setTheme(value);
              changed();
            }}
          />
        </label>
        <div className="daily-context-destination">
          <span>{root || "公開先を選択してください"}</span>
          <Button
            variant="secondary"
            onClick={() =>
              void run(async () => {
                const selected = await workspaceApi.chooseDirectory(
                  "公開用Markdownの保存先（OneDrive内など）",
                );
                if (!selected.canceled && selected.path) {
                  setRoot(selected.path);
                  changed();
                }
              })
            }
          >
            フォルダーを選ぶ
          </Button>
        </div>
        <Button
          variant="secondary"
          disabled={!date || !root}
          onClick={() =>
            void run(async () => {
              setPlan(null);
              setPlan(await preview({ date, timezone, themeId: theme === "all" ? null : theme }));
            })
          }
        >
          公開内容を確認
        </Button>
      </fieldset>
      {plan && (
        <>
          <p>
            {plan.includedCount}件を収録・{plan.excludedCount}件を除外。保存先: Tasken Context/
            {plan.relativePath}
          </p>
          <pre className="daily-context-preview" tabIndex={0} aria-label="公開Markdownプレビュー">
            {plan.content}
          </pre>
          {plan.partial && (
            <label>
              <input
                type="checkbox"
                checked={partialConfirmed}
                disabled={working}
                onChange={(event) => setPartialConfirmed(event.target.checked)}
              />
              続きが未収録であることを確認しました
            </label>
          )}
          <p className="muted">
            同じ日付の公開物を置き換えます。範囲を狭めた場合も、クラウドやAI側の旧内容の削除・更新はここでは確認できません。
          </p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {result && <p role="status">{result}</p>}
      <footer>
        <Button variant="secondary" disabled={working} onClick={close}>
          閉じる
        </Button>
        <Button
          disabled={working || !plan || (plan.partial && !partialConfirmed)}
          onClick={() =>
            void run(async () => {
              if (!plan) return;
              const saved = await publish({
                root,
                selection: plan.selection,
                generatedAt: plan.generatedAt,
                expectedContentHash: plan.contentHash,
                allowPartial: partialConfirmed,
              });
              setResult(
                `ローカルフォルダーへ保存しました: ${saved.path}。OneDrive同期・外部AIの反映は未確認です。`,
              );
            })
          }
        >
          {working ? "処理中…" : "この内容を保存"}
        </Button>
      </footer>
    </dialog>
  );
}
