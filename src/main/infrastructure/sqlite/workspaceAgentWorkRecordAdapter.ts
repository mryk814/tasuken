import type {
  AgentWorkRecordPort,
  AgentWorkRecordRow,
  AgentWorkRecordTransaction,
} from "../../core/public.ts";

type Row = Record<string, unknown>;

export interface AgentWorkRecordWorkspacePersistence {
  readonly workspaceId: string;
  remove(type: string, id: string): Row | null;
  runTransaction<T>(
    callback: (repository: {
      get(type: string, id: string, includeDeleted?: boolean): Row | null;
      save(type: string, entity: Row, options?: unknown): Row;
      listAgentWorkRecordsForSession(clientKind: string, sourceSessionId: string): Row[];
      countAgentWorkRecordsWrittenSince(writtenBy: string, since: string): number;
    }) => T,
  ): T;
}

const TYPE = "agent_work_record";

/** AIの作業をSQLiteの`entities`に置く。保存はrepositoryのsaveで、同期の差分を1つだけ出す。 */
export class WorkspaceAgentWorkRecordAdapter implements AgentWorkRecordPort {
  constructor(
    private readonly persistence: AgentWorkRecordWorkspacePersistence,
    private readonly resolveRepository: (cwd: string) => string | null,
    private readonly onCommitted?: () => void,
  ) {}

  get workspaceId() {
    return this.persistence.workspaceId;
  }

  resolveRepositoryContextId(cwd: string): string | null {
    return this.resolveRepository(cwd);
  }

  runTransaction<T>(callback: (transaction: AgentWorkRecordTransaction) => T): T {
    let wrote = false;
    const result = this.persistence.runTransaction((repository) =>
      callback({
        get: (id) => repository.get(TYPE, id, true) as AgentWorkRecordRow | null,
        listForSession: (clientKind, sourceSessionId) =>
          repository.listAgentWorkRecordsForSession(
            clientKind,
            sourceSessionId,
          ) as AgentWorkRecordRow[],
        countWrittenSince: (writtenBy, since) =>
          repository.countAgentWorkRecordsWrittenSince(writtenBy, since),
        exists: (type, id) => Boolean(repository.get(type, id, true)),
        insert: (record) => {
          wrote = true;
          // 経路はCoreが決める（AIの受け口だけがここを通る）。
          return repository.save(TYPE, record, { source: "mcp" }) as AgentWorkRecordRow;
        },
        markDeleted: (id) => {
          wrote = true;
          // removeは自分のtransactionを開くが、better-sqlite3では入れ子のsavepointになる。
          return this.persistence.remove(TYPE, id) as AgentWorkRecordRow | null;
        },
      }),
    );
    if (wrote && this.onCommitted) {
      try {
        this.onCommitted();
      } catch {
        // 保存は済んでいる。画面への知らせの失敗で巻き戻さない。
      }
    }
    return result;
  }
}
