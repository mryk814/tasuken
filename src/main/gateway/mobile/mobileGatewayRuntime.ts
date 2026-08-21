import type { MobileGatewayAdapter, MobileGatewayStatePort } from "./mobileGatewayAdapter.ts";
import {
  MobileDeviceRegistry,
  type MobileDevicePersistence,
  type MobileDeviceRecord,
  type MobilePairingTicket,
} from "./mobileDeviceRegistry.ts";
import {
  MobileGatewayHost,
  type MobileGatewayHostDiagnostics,
} from "./mobileGatewayHost.ts";

export interface MobileGatewayRuntimeDiagnostics extends MobileGatewayHostDiagnostics {
  devices: MobileDeviceRecord[];
  pairingExpiresAt: string;
}

export interface MobileGatewayRuntimeOptions {
  adapter: MobileGatewayAdapter;
  state: MobileGatewayStatePort;
  persistence: MobileDevicePersistence;
  port?: number;
  now?: () => Date;
  logger?: { warn(event: { id: string; location: "MobileGatewayHost.handle" }): void };
}

export class MobileGatewayRuntime {
  private readonly devices: MobileDeviceRegistry;
  private readonly host: MobileGatewayHost;
  private pairingExpiresAt = "";

  constructor(options: MobileGatewayRuntimeOptions) {
    this.devices = new MobileDeviceRegistry({
      persistence: options.persistence,
      now: options.now,
    });
    this.host = new MobileGatewayHost({
      adapter: options.adapter,
      devices: this.devices,
      state: options.state,
      port: options.port,
      now: options.now,
      logger: options.logger,
    });
  }

  async start(): Promise<boolean> {
    try {
      await this.host.start();
      return true;
    } catch {
      return false;
    }
  }

  async stop(): Promise<void> {
    this.devices.cancelPairing();
    this.pairingExpiresAt = "";
    await this.host.stop();
  }

  issuePairing(): MobilePairingTicket {
    const ticket = this.devices.issuePairing();
    this.pairingExpiresAt = ticket.expiresAt;
    return ticket;
  }

  cancelPairing(): void {
    this.devices.cancelPairing();
    this.pairingExpiresAt = "";
  }

  revokeDevice(deviceId: string): MobileDeviceRecord | null {
    return this.devices.revoke(deviceId);
  }

  diagnostics(): MobileGatewayRuntimeDiagnostics {
    return {
      ...this.host.diagnostics(),
      devices: this.devices.listDevices(),
      pairingExpiresAt: this.pairingExpiresAt,
    };
  }
}
