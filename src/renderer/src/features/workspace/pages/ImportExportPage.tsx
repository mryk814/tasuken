import type { PageProps } from "../types";
import { PageHeader } from "../components/common";
import { AgentDeskPanel } from "../components/AgentDeskPanel";

/**
 * `ai-io` は既存hash/deep linkを保つための内部route名です。
 * 画面の責務は任せた仕事の進み具合（対応待ち／作業中／開始待ち／最近の結果）に限定します。
 * 変更案の確認・採否はFeedの「対応待ち」タブの「提案の確認」で行います。
 */
export function ImportExportPage(props: PageProps) {
  return (
    <div className="page ai-inbox-page">
      <PageHeader route="ai-io" />
      <AgentDeskPanel {...props} />
    </div>
  );
}
