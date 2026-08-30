import { app, ipcMain } from "electron";
import { privateMcpEntrypoint } from "../mcp/private";

export const currentApplication = app;
export const coreMcpPrivateEntrypoint = privateMcpEntrypoint;

ipcMain.handle("fixture:current-application", () => currentApplication);
