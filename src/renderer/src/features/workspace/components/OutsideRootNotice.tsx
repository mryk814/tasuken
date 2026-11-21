import { IconFolderShare } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import type { TaskenRootOutsideNotice } from "../../../../../shared/ipc/contracts";
import { workspaceApi } from "../../../services/workspaceApi";
import { Button } from "./common";

function entryLabel(entry: TaskenRootOutsideNotice["entries"][number]): string {
  if (entry.kind === "activity") return "日誌";
  return `Theme「${entry.themeName || entry.themeId || ""}」`;
}

/**
 * 置き場所の段 2（#810）: この版の最初の起動で一度だけ、新しい保存に使わなくなったルートの外の
 * 指定（Theme の保存先・日誌の個別指定）を並べて知らせる。ファイルは動かしていないので、場所を
 * 見せて閉じるだけにする。閉じたら二度と出さない（印は端末ごと）。同じ一覧は Settings の
 * 「ルートの外」にも残る。
 */
export function OutsideRootNotice() {
  const [notice, setNotice] = useState<TaskenRootOutsideNotice | null>(null);

  useEffect(() => {
    let canceled = false;
    workspaceApi
      .taskenRootOutsideNotice()
      .then((value) => {
        if (!canceled) setNotice(value);
      })
      .catch(() => {});
    return () => {
      canceled = true;
    };
  }, []);

  if (!notice?.entries.length) return null;

  const dismiss = (openSettings: boolean) => {
    setNotice(null);
    void workspaceApi.dismissTaskenRootOutsideNotice().catch(() => {});
    if (openSettings) window.location.hash = "settings/storage";
  };

  return (
    <section className="outside-root-notice" aria-labelledby="outside-root-notice-title">
      <h2 id="outside-root-notice-title">
        <IconFolderShare size={18} aria-hidden="true" />
        新しい保存は Tasken ルートへ
      </h2>
      <p>次の場所は、これからの保存に使いません。前に置いたファイルはそのまま残っています。</p>
      <ul>
        {notice.entries.map((entry) => (
          <li key={`${entry.kind}:${entry.themeId || entry.path}`}>
            <span className="outside-root-notice-label">{entryLabel(entry)}</span>
            <span className="mono-value" title={entry.path}>
              {entry.path}
            </span>
          </li>
        ))}
      </ul>
      <div className="outside-root-notice-actions">
        <Button variant="ghost" compact onClick={() => dismiss(true)}>
          Settings で見る
        </Button>
        <Button variant="secondary" compact onClick={() => dismiss(false)}>
          わかった
        </Button>
      </div>
    </section>
  );
}
