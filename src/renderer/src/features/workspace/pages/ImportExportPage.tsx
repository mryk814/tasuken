import type { PageProps } from "../types";
import { PageHeader } from "../components/common";
import { AiProposalPanel } from "../components/AiProposalPanel";
import { AgentDeskPanel } from "../components/AgentDeskPanel";

/**
 * `ai-io` は既存hash/deep linkを保つための内部route名です。
 * 画面の責務はSafe Write Proposalの確認Inboxに限定し、他のAI操作は各正本画面へ戻します。
 *
 * #599 でAgent Deskの一往復（対応待ち／作業中／開始待ち／最近の結果）を同じ面の先頭へ置きました。
 * 表示名と内容の統合は #600 で行います。
 */
export function ImportExportPage(props: PageProps) {
  return (
    <div className="page ai-inbox-page">
      <PageHeader route="ai-io" />
      <AgentDeskPanel {...props} />
      <AiProposalPanel {...props} />
    </div>
  );
}
