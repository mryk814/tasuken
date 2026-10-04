import { createHash } from "node:crypto";

import {
  aiTaskStartRequestSchema,
  taskCommandResponseSchema,
  startTaskWorkCommandSchema,
  TASK_CONTRACT_SCHEMA_VERSION,
  type AiTaskStartRequest,
  type StartTaskWorkCommand,
  type TaskCommandResponse,
} from "../../../shared/contracts/task/public.ts";

export interface AiTaskStartPort {
  /** Execute through the limited transactional guard and return canonical readback. */
  execute(command: StartTaskWorkCommand): TaskCommandResponse;
}

export class AiTaskStartService {
  constructor(
    private readonly workspaceId: string,
    private readonly port: AiTaskStartPort,
  ) {}

  execute(input: AiTaskStartRequest): TaskCommandResponse {
    const request = aiTaskStartRequestSchema.parse(input);
    // One namespace per owner workspace. Changing the caller or payload for a
    // reused key must reach the existing command-fingerprint conflict check.
    const commandId = createHash("sha256")
      .update(JSON.stringify(["task.start_work", this.workspaceId, request.idempotency_key]))
      .digest("hex");
    return taskCommandResponseSchema.parse(
      this.port.execute(
        startTaskWorkCommandSchema.parse({
          schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
          command_id: commandId,
          name: "StartTaskWork",
          actor: { kind: "ai_agent", id: request.caller },
          source: "mcp",
          entrypoint: "mcp",
          issued_at: request.started_at,
          payload: {
            task_id: request.task_id,
            expected_version: request.expected_version,
            executor_identity: request.caller,
            started_at: request.started_at,
            work_attempt_id: request.work_attempt_id,
            ...(request.source_session ? { source_session: request.source_session } : {}),
          },
        }),
      ),
    );
  }
}
