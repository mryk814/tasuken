import type { PageProps } from "../types";
import { PageHeader } from "../components/common";
import { AiProposalPanel } from "../components/AiProposalPanel";

/**
 * `ai-io` は既存hash/deep linkを保つための内部route名です。
 * 画面の責務はSafe Write Proposalの確認Inboxに限定し、他のAI操作は各正本画面へ戻します。
 */
export function ImportExportPage(props: PageProps) {
  return (
    <div className="page ai-inbox-page">
      <PageHeader route="ai-io" />
      <AiProposalPanel {...props} />
    </div>
  );
}
