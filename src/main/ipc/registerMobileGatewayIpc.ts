import { ipcMain } from "electron";

import { IPC } from "../../shared/ipc/contracts";
import type {
  MobileGatewayDevice,
  MobileGatewayDiagnostics,
  MobileGatewayPairingTicket,
} from "../../shared/mobileGatewayIpc.ts";

interface MobileGatewayControl {
  diagnostics(): MobileGatewayDiagnostics;
  issuePairing(): MobileGatewayPairingTicket;
  cancelPairing(): void;
  revokeDevice(deviceId: string): MobileGatewayDevice | null;
}

function requireDeviceId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200) {
    throw new Error("端末IDが不正です。画面を再読み込みして、もう一度試してください。");
  }
  return value.trim();
}

export function registerMobileGatewayIpc(gateway: MobileGatewayControl): void {
  ipcMain.handle(IPC.mobileGatewayDiagnostics, () => gateway.diagnostics());
  ipcMain.handle(IPC.mobileGatewayIssuePairing, () => gateway.issuePairing());
  ipcMain.handle(IPC.mobileGatewayCancelPairing, () => {
    gateway.cancelPairing();
    return true;
  });
  ipcMain.handle(
    IPC.mobileGatewayRevokeDevice,
    (_event, deviceId: unknown) => gateway.revokeDevice(requireDeviceId(deviceId)),
  );
}

