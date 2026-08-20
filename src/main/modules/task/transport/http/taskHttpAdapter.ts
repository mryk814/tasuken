import type { TaskCommandResponse, TaskQueryResponse } from "../../../../../shared/contracts/task/public.ts";
import type { TaskCapabilityService } from "../../application/taskCapabilityService.ts";

export interface TaskHttpRequest {
  method: "POST";
  path: "/v1/task/commands" | "/v1/task/queries";
  body: unknown;
  authorized: boolean;
}

export interface TaskHttpResponse {
  status: number;
  body: TaskCommandResponse | TaskQueryResponse;
}

function statusFor(response: TaskCommandResponse | TaskQueryResponse): number {
  if (response.ok) return 200;
  if (response.error.code === "NOT_FOUND") return 404;
  if (response.error.code === "CONFLICT" || response.error.code === "INVALID_TRANSITION") return 409;
  if (response.error.code === "FORBIDDEN") return 403;
  if (response.error.code === "UNAVAILABLE") return 503;
  if (response.error.code === "INTERNAL_ERROR") return 500;
  return 400;
}

/** Pure HTTP mapping used by the future Mobile Gateway; it does not own a server. */
export function createTaskHttpAdapter(service: TaskCapabilityService) {
  return {
    handle(request: TaskHttpRequest): TaskHttpResponse {
      if (!request.authorized) {
        return {
          status: 403,
          body: {
            ok: false,
            error: { code: "FORBIDDEN", message: "Task capabilityを利用する権限がありません。", issues: [], retryable: false },
          },
        };
      }
      const body = request.path === "/v1/task/commands"
        ? service.executeCommand(request.body)
        : service.executeQuery(request.body);
      return { status: statusFor(body), body };
    },
  };
}
