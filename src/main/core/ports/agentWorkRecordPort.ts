/** 保存済みのAIの作業。中身は contracts/task/agentWorkRecord.ts の欄と共通の列。 */
export type AgentWorkRecordRow = Record<string, unknown> & {
  id: string;
  created_at?: string;
  deleted_at?: string | null;
};

export interface AgentWorkRecordTransaction {
  get(id: string): AgentWorkRecordRow | null;
  /** 同じAI（client_kind）の同じ会話の記録。消した物も含む。 */
  listForSession(clientKind: string, sourceSessionId: string): AgentWorkRecordRow[];
  /**
   * 同じAIの同じ会話の、古い会話（agent_session）。消した物も含む。拾い上げが、古い形で
   * もう入っている会話を拾い直さないために読む。移行（#751 PR 4）で会話を畳んだ後に消す。
   */
  listLegacySessions(clientKind: string, sourceSessionId: string): AgentWorkRecordRow[];
  /**
   * 同じAIが、そのリポジトリのどれかについて書いた記録のうち、createdSince以降に書かれた物
   * （消した物も含む）。拾い上げが、会話のIDが違う記録との重なりを見るために読む。
   */
  listReportsForRepositories(
    clientKind: string,
    repositoryContextIds: readonly string[],
    createdSince: string,
  ): AgentWorkRecordRow[];
  /** 書き手がsince以降に書いた件数。消した物も含む。 */
  countWrittenSince(writtenBy: string, since: string): number;
  /** 指定したThemeなどが（消した物も含めて）あるか。 */
  exists(type: "theme" | "task" | "repository_context", id: string): boolean;
  /** 新しい1件を書く。保存1回で同期の差分が1つ出る。来歴は作らない。 */
  insert(record: AgentWorkRecordRow): AgentWorkRecordRow;
  /** 消した印を付ける（同期の差分が1つ出る）。 */
  markDeleted(id: string): AgentWorkRecordRow | null;
}

/** AIの作業の書き込みの境界。読み取りと書き込みを1つのtransactionに束ねる。 */
export interface AgentWorkRecordPort {
  readonly workspaceId: string;
  runTransaction<T>(callback: (transaction: AgentWorkRecordTransaction) => T): T;
  /** 作業場所（cwd）を、登録済みのリポジトリのIDに直す。直せなければnull。場所そのものは返さない。 */
  resolveRepositoryContextId(cwd: string): string | null;
}
