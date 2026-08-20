import { ipcRenderer } from "electron";

import {
  parseTaskEvent,
  taskCommandResponseSchema,
  taskQueryResponseSchema,
  type TaskCapability,
  type TaskCommand,
  type TaskQuery,
} from "../../shared/contracts/task/public.ts";
import { IPC } from "../../shared/ipc/contracts.ts";

async function invokeTaskCommand(command: TaskCommand) {
  const parsed = taskCommandResponseSchema.safeParse(await ipcRenderer.invoke(IPC.taskCommand, command));
  if (!parsed.success) throw new Error("Mainから受信したTask command結果がcontractに適合しません。");
  return parsed.data;
}

async function invokeTaskQuery(query: TaskQuery) {
  const parsed = taskQueryResponseSchema.safeParse(await ipcRenderer.invoke(IPC.taskQuery, query));
  if (!parsed.success) throw new Error("Mainから受信したTask query結果がcontractに適合しません。");
  return parsed.data;
}

export function createTaskPreloadCapability(): TaskCapability {
  return {
    create: (command) => invokeTaskCommand(command),
    update: (command) => invokeTaskCommand(command),
    delete: (command) => invokeTaskCommand(command),
    complete: (command) => invokeTaskCommand(command),
    reopen: (command) => invokeTaskCommand(command),
    get: async (query) => taskQueryResponseSchema.parse(await invokeTaskQuery(query)) as Awaited<ReturnType<TaskCapability["get"]>>,
    listToday: async (query) => taskQueryResponseSchema.parse(await invokeTaskQuery(query)) as Awaited<ReturnType<TaskCapability["listToday"]>>,
    subscribe: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
        const parsed = parseTaskEvent(value);
        if (parsed.ok) {
          callback(parsed.value);
          return;
        }
        console.error("Mainから受信したTask eventがcontractに適合しません。", parsed.error.issues);
      };
      ipcRenderer.on(IPC.taskChanged, handler);
      return () => { ipcRenderer.removeListener(IPC.taskChanged, handler); };
    },
  };
}
