import { randomUUID } from "node:crypto";

import { CorePublicError, directWriteDisabled } from "../../shared/contracts/task/public.ts";
import { TaskCapabilityService, type WorkspaceTaskPersistence } from "../modules/task/public.ts";
import {
  TASK_CONTRACT_SCHEMA_VERSION,
  aiNoteEditRequestSchema,
  aiNoteEditResponseSchema,
  aiProposalDecisionRequestSchema,
  aiProposalDecisionResponseSchema,
  taskWorkReportsCoveredBy,
  type AiNoteEditRequest,
  type AiNoteEditResponse,
  type AiProposalDecisionRequest,
  type AiProposalDecisionResponse,
  type TaskReadModel,
} from "../../shared/contracts/task/public.ts";
import {
  ApplicationCommandError,
  type CommandEnvelope,
  type CommandReceipt,
} from "../../shared/applicationCommand.ts";
import type { Entity } from "../../shared/types/workspace.ts";
import { AiProposalAcceptanceService } from "./aiProposalAcceptanceService.ts";
import type { ApplicationCommandService } from "./applicationCommandService.ts";
import { stableProposalEntityId } from "../../shared/proposalAcceptance.mjs";

type Persistence = WorkspaceTaskPersistence & {
  listChangeEventsByCommandId(commandId: string): Entity[];
  listChangeEventsForEntity(recordType: string, entityId: string): Entity[];
};

interface Dependencies {
  persistence: Persistence;
  commands: {
    executeAiProposalDecision(input: unknown, annotation: Record<string, unknown>): CommandReceipt;
    executeCanonicalNoteAiProposal?: ApplicationCommandService["executeCanonicalNoteAiProposal"];
  };
  /** Noteの保存（Canonical Markdown）とArtifactの実体化。Desktopの採用と同じもの。 */
  artifacts: ConstructorParameters<typeof AiProposalAcceptanceService>[1];
  /** Coreの提案の入口（propose_contentと同じ）。Note編集のProposalを作る。 */
  proposeContent(request: Record<string, unknown>): { proposal_id?: unknown };
  /** 本人が設定で直接の書き込みを許しているか。要求のたびに読む。 */
  isEnabled(): boolean;
  onCommitted?(receipt: CommandReceipt): void;
}

function payloadOf(proposal: Entity): Record<string, unknown> {
  let payload: unknown = proposal.payload;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = {};
    }
  }
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

/** ApplicationCommandError・採用の検証の失敗を、AIへ返す失敗にする。 */
function decisionError(error: unknown): never {
  if (error instanceof CorePublicError) throw error;
  if (error instanceof ApplicationCommandError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "CONFLICT" || error.code === "COMMAND_ID_REUSED"
          ? 409
          : 422;
    throw new CorePublicError(
      error.code === "COMMAND_ID_REUSED" ? "CONFLICT" : error.code,
      error.message,
      status,
    );
  }
  // 採用の検証（版・編集元の署名など）はError。読み直して決め直す失敗として返す。
  throw new CorePublicError(
    "CONFLICT",
    error instanceof Error ? error.message : "採否できませんでした。",
    409,
  );
}

/**
 * 本人の言葉を根拠に、ローカルのAIがProposalの採否を取り次ぎ、Noteを直接編集する（#703 段3）。
 * Desktopのstdio接続だけに出す。採否には本人の言葉が必ず要る。作業報告（task_work）とNoteを扱い、
 * ほかの種類はDesktopの画面で決める。Noteの編集は「Note編集のProposalを作り、その場で採用する」で、
 * 版の照合とCanonical Markdownの保存はDesktopの採用と同じ経路を通る。
 */
export class AiProposalDecisionService {
  private readonly reader: TaskCapabilityService;

  constructor(private readonly deps: Dependencies) {
    this.reader = new TaskCapabilityService(deps.persistence, () => {
      throw new Error("読み取り専用です。");
    });
  }

  /**
   * Desktopの採用（AiProposalAcceptanceService）をそのまま使い、中で呼ぶcommandだけを
   * 本人の言葉を取り次ぐ採否の入口に通す（根拠をEventに付け、ai_agentの採否を許す）。
   */
  private acceptance(annotation: Record<string, unknown>): AiProposalAcceptanceService {
    return new AiProposalAcceptanceService(
      {
        execute: (input) => this.deps.commands.executeAiProposalDecision(input, annotation),
        ...(this.deps.commands.executeCanonicalNoteAiProposal
          ? {
              executeCanonicalNoteAiProposal: (input, save) =>
                this.deps.commands.executeCanonicalNoteAiProposal!(input, save),
            }
          : {}),
      },
      this.deps.artifacts,
      this.deps.persistence,
    );
  }

  decide(input: AiProposalDecisionRequest): AiProposalDecisionResponse {
    if (!this.deps.isEnabled()) throw directWriteDisabled();
    const request = aiProposalDecisionRequestSchema.parse(input);
    const proposal = this.deps.persistence.get("ai_proposal", request.proposal_id);
    if (!proposal)
      throw new CorePublicError("NOT_FOUND", "Proposalがありません。", 404, {
        proposal_id: request.proposal_id,
      });
    const type = String(proposal.payload_type || "");
    if (type !== "task_work" && type !== "notes")
      throw new CorePublicError(
        "DECIDE_IN_DESKTOP",
        "この種類のProposalは、Desktopの画面で採否してください。",
        422,
        { payload_type: type },
      );
    const annotation = {
      schema: "tasken-ai-direct/v1",
      action: "decide_proposal",
      decision: request.decision,
      said: request.said,
      caller: request.caller,
      source_app: request.source_app,
      source_session: request.source_session,
    };
    const actor = { kind: "ai_agent" as const, id: request.caller };
    const changeId =
      type === "task_work"
        ? `${proposal.id}:ai-decide:${request.decision}`
        : `${proposal.id}:accept:v${request.expected_version}`;
    const decided = this.deps.persistence.listChangeEventsByCommandId(changeId).length > 0;
    if (proposal.status !== "pending") {
      if (!decided)
        throw new CorePublicError("ALREADY_DECIDED", "このProposalは既に決まっています。", 409, {
          proposal_status: proposal.status,
        });
      if (type === "task_work" && request.complete_task)
        this.completeTask(proposal, actor, annotation);
      return this.decisionResponse("duplicate", proposal.id, changeId);
    }
    if (Number(proposal.version || 0) !== request.expected_version)
      throw new CorePublicError(
        "CONFLICT",
        "Proposalが更新されています。読み直して送り直してください。",
        409,
        { current_version: Number(proposal.version || 0) },
      );
    try {
      if (type === "task_work") {
        const entry =
          (payloadOf(proposal).task_work as Entity[] | undefined)?.[0] ?? ({} as Entity);
        const taskId = String(entry.task_id || "");
        const task = this.deps.persistence.get("task", taskId);
        if (!task) throw new CorePublicError("NOT_FOUND", "対象のTaskがありません。", 404);
        const covered =
          request.decision === "accept"
            ? taskWorkReportsCoveredBy(proposal, this.deps.persistence.list("ai_proposal"))
            : [];
        this.commit(
          this.deps.commands.executeAiProposalDecision(
            {
              commandId: changeId,
              name: "ApplyTaskWorkProposal",
              actor,
              source: "mcp",
              issuedAt: new Date().toISOString(),
              payload: {
                proposalId: proposal.id,
                decision: request.decision,
                ...(covered.length
                  ? { coveredProposalIds: covered.map((report) => report.id) }
                  : {}),
              },
              expectedVersions: [
                { type: "task", id: taskId, version: Number(task.version || 0) },
                ...covered.map((report) => ({
                  type: "ai_proposal",
                  id: String(report.id),
                  version: Number(report.version || 0),
                })),
                { type: "ai_proposal", id: proposal.id, version: request.expected_version },
              ],
            },
            annotation,
          ),
        );
        if (request.decision === "accept" && request.complete_task)
          this.completeTask(proposal, actor, annotation);
      } else {
        const acceptance = this.acceptance(annotation);
        const command = acceptance.noteDecisionCommand(proposal.id, request.decision, actor);
        this.commit(acceptance.execute(command));
        this.annotate(command.commandId, annotation);
      }
    } catch (error) {
      decisionError(error);
    }
    return this.decisionResponse("applied", proposal.id, changeId);
  }

  editNote(input: AiNoteEditRequest): AiNoteEditResponse {
    if (!this.deps.isEnabled()) throw directWriteDisabled();
    const request = aiNoteEditRequestSchema.parse(input);
    const note = this.deps.persistence.get("note", request.note_id);
    if (!note)
      throw new CorePublicError("NOT_FOUND", "Noteがありません。", 404, {
        note_id: request.note_id,
      });
    const proposalRequest = {
      kind: "note_edit",
      note_id: request.note_id,
      base_version: request.base_version,
      title: request.title || String(note.title || "無題"),
      body: request.body,
      reason: request.said || request.why,
      idempotency_key: request.idempotency_key,
      caller: request.caller,
      source_session: request.source_session,
      source_app: request.source_app,
      actor: { kind: "ai_agent" },
      source: "mcp",
    };
    // 先に保存せずにProposal IDだけを得る（同じ鍵・違う内容はここで競合になる）。
    // 本人の言葉が要るのに無いときなどは、Proposalを残さずに断るため。
    const proposalId = String(
      this.deps.proposeContent({ ...proposalRequest, dry_run: true }).proposal_id || "",
    );
    const existing = this.deps.persistence.get("ai_proposal", proposalId);
    if (existing && existing.status !== "pending") {
      const changeId = `${existing.id}:accept:v${Number(existing.version || 0) - 1}`;
      const accepted = this.deps.persistence
        .listChangeEventsByCommandId(changeId)
        .some((event) => (event.record_type || event.entity_type) === "note");
      if (!accepted)
        throw new CorePublicError(
          "ALREADY_DECIDED",
          "この編集のProposalは既に決まっています。新しいidempotency_keyで送ってください。",
          409,
        );
      return this.noteResponse("duplicate", changeId, existing.id, request.note_id);
    }
    if (Number(note.version || 0) !== request.base_version)
      throw new CorePublicError(
        "CONFLICT",
        "Noteが更新されています。読み直して、今の版で送り直してください。",
        409,
        { current_note: { id: note.id, version: note.version, title: note.title } },
      );
    if (!request.said && this.needsUserWords(note))
      throw new CorePublicError(
        "ASK_USER",
        "このNoteの編集には本人の言葉が要ります。保存していません。",
        422,
        { reason: "needs_user_words" },
      );
    this.deps.proposeContent(proposalRequest);
    const proposal = this.deps.persistence.get("ai_proposal", proposalId);
    if (!proposal || proposal.status !== "pending")
      throw new Error("Note編集のProposalを読み戻せません。");
    const changeId = `${proposal.id}:accept:v${Number(proposal.version || 0)}`;
    try {
      const annotation = {
        schema: "tasken-ai-direct/v1",
        action: "edit_note",
        ...(request.said ? { said: request.said } : { why: request.why }),
        caller: request.caller,
        source_app: request.source_app,
        source_session: request.source_session,
      };
      const acceptance = this.acceptance(annotation);
      const command = acceptance.noteDecisionCommand(proposal.id, "accept", {
        kind: "ai_agent",
        id: request.caller,
      });
      this.commit(acceptance.execute(command));
      this.annotate(command.commandId, annotation);
    } catch (error) {
      decisionError(error);
    }
    return this.noteResponse("applied", changeId, proposal.id, request.note_id);
  }

  /** AIが作って本人がまだ触っていないNoteだけ、本人の言葉なしで直せる（Taskと同じ決まり）。 */
  private needsUserWords(note: Entity): boolean {
    if (!note.ai_creation) return true;
    const events = this.deps.persistence
      .listChangeEventsForEntity("note", String(note.id))
      .filter((event) => !event.no_change);
    if (events.some((event) => event.actor_kind !== "ai_agent")) return true;
    return events.length !== Number(note.version);
  }

  private completeTask(
    proposal: Entity,
    actor: CommandEnvelope["actor"],
    annotation: Record<string, unknown>,
  ): void {
    const commandId = `${proposal.id}:ai-decide:complete`;
    if (this.deps.persistence.listChangeEventsByCommandId(commandId).length > 0) return;
    const entry = (payloadOf(proposal).task_work as Entity[] | undefined)?.[0] ?? ({} as Entity);
    const task = this.deps.persistence.get("task", String(entry.task_id || ""));
    if (!task) throw new CorePublicError("NOT_FOUND", "対象のTaskがありません。", 404);
    this.commit(
      this.deps.commands.executeAiProposalDecision(
        {
          commandId,
          name: "AcceptTaskWork",
          actor,
          source: "mcp",
          issuedAt: new Date().toISOString(),
          payload: { taskId: task.id, receiptId: proposal.id, completeTask: true },
          expectedVersions: [{ type: "task", id: task.id, version: Number(task.version || 0) }],
        },
        { ...annotation, action: "complete_task" },
      ),
    );
  }

  /** 採用の経路（Note）は根拠を知らないので、出来た記録に後から根拠を付けてActivityに出す。 */
  private annotate(commandId: string, annotation: Record<string, unknown>): void {
    for (const event of this.deps.persistence.listChangeEventsByCommandId(commandId)) {
      const metadata =
        event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
          ? (event.metadata as Record<string, unknown>)
          : {};
      this.deps.persistence.save("change_event", {
        ...event,
        metadata: { ...metadata, include_in_activity: true, ai_direct: annotation },
      });
    }
  }

  private commit(receipt: CommandReceipt): void {
    this.deps.onCommitted?.(receipt);
  }

  private readTask(taskId: string): TaskReadModel | null {
    const result = this.reader.executeQuery({
      schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
      query_id: randomUUID(),
      name: "GetTask",
      parameters: { task_id: taskId, include_deleted: true },
    });
    return result.ok && result.value.name === "GetTask" ? result.value.task : null;
  }

  private decisionResponse(
    status: AiProposalDecisionResponse["status"],
    proposalId: string,
    changeId: string,
  ): AiProposalDecisionResponse {
    const proposal = this.deps.persistence.get("ai_proposal", proposalId, true);
    const payload = proposal ? payloadOf(proposal) : {};
    const taskId = String((payload.task_work as Entity[] | undefined)?.[0]?.task_id || "");
    const noteEntry = ((payload.notes as Entity[] | undefined) || [])[0];
    // 作成のProposalは、採用で決まるIDのNoteになる（Desktopの採用と同じ導き方）。
    const noteId = noteEntry
      ? String(noteEntry.target_id || stableProposalEntityId(proposalId, "note", 0))
      : "";
    const note = noteId ? this.deps.persistence.get("note", noteId, true) : null;
    return aiProposalDecisionResponseSchema.parse({
      schema: "tasken-ai-proposal-decision/v1",
      status,
      proposal_id: proposalId,
      proposal_status: String(proposal?.status || ""),
      change_id: changeId,
      task: taskId ? this.readTask(taskId) : null,
      note: note
        ? { id: String(note.id), version: Number(note.version), title: String(note.title || "") }
        : null,
    });
  }

  private noteResponse(
    status: AiNoteEditResponse["status"],
    changeId: string,
    proposalId: string,
    noteId: string,
  ): AiNoteEditResponse {
    const note = this.deps.persistence.get("note", noteId, true);
    if (!note) throw new Error("編集したNoteを読み戻せません。");
    return aiNoteEditResponseSchema.parse({
      schema: "tasken-ai-note-edit/v1",
      status,
      change_id: changeId,
      proposal_id: proposalId,
      note: { id: String(note.id), version: Number(note.version), title: String(note.title || "") },
    });
  }
}
