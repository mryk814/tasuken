export interface MobileGatewayDevice {
  id: string;
  label: string;
  scopes: Array<
    | "mobile:read"
    | "mobile:task-write"
    | "mobile:capture-write"
    | "mobile:proposal-review"
    | "mobile:human-review"
    | "mobile:context-read"
  >;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  revokedAt: string;
  version: number;
}

export interface MobileGatewayRequestDiagnostic {
  at: string;
  method: string;
  path: string;
  status: number;
  deviceId: string;
}

export interface MobileGatewayDiagnostics {
  status: "stopped" | "ready" | "error";
  localOrigin: string;
  port: number;
  startedAt: string;
  lastError: string;
  latestRequest: MobileGatewayRequestDiagnostic | null;
  devices: MobileGatewayDevice[];
  pairingExpiresAt: string;
}

export interface MobileGatewayPairingTicket {
  code: string;
  expiresAt: string;
}
