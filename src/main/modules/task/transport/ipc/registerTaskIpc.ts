import type {
  TaskCommandResponse,
  TaskQueryResponse,
} from "../../../../../shared/contracts/task/public.ts";

interface TaskCapabilityHandler {
  executeCommand(input: unknown): TaskCommandResponse;
  executeQuery(input: unknown): TaskQueryResponse;
}

export interface TaskIpcHost {
  channels: {
    command: string;
    query: string;
    changed: string;
  };
  handle(channel: string, listener: (event: unknown, payload: unknown) => unknown): void;
  publish(channel: string, payload: unknown): void;
  authorize?(event: unknown, operation: "command" | "query"): boolean;
}

function forbidden() {
  return {
    ok: false as const,
    error: {
      code: "FORBIDDEN" as const,
      message: "このウィンドウにはTask capabilityの利用権限がありません。",
      issues: [],
      retryable: false,
    },
  };
}

export function registerTaskIpc(
  host: TaskIpcHost,
  service: TaskCapabilityHandler,
  notifyTaskChanged: () => void = () => {},
): void {
  host.handle(host.channels.command, (event, command) => {
    if (host.authorize && !host.authorize(event, "command")) return forbidden();
    const response = service.executeCommand(command);
    if (response.ok) {
      if (response.value.event) host.publish(host.channels.changed, response.value.event);
      notifyTaskChanged();
    }
    return response;
  });
  host.handle(host.channels.query, (event, query) => (
    host.authorize && !host.authorize(event, "query") ? forbidden() : service.executeQuery(query)
  ));
}
