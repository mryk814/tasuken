import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import type { MobilePrincipal } from "./mobileGatewayAdapter.ts";
import { TASKEN_MOBILE_SCOPES, type MobileScope } from "../../../shared/contracts/mobile/public.ts";

const ACCESS_TOKEN_BYTES = 32;
const ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PAIRING_CODE_PATTERN = /^\d{8}$/;
const DEFAULT_PAIRING_TTL_MS = 5 * 60 * 1_000;

export const MOBILE_DEVICE_DEFAULT_SCOPES = Object.freeze([
  TASKEN_MOBILE_SCOPES.read,
  TASKEN_MOBILE_SCOPES.contextRead,
  TASKEN_MOBILE_SCOPES.taskWrite,
  TASKEN_MOBILE_SCOPES.captureWrite,
  TASKEN_MOBILE_SCOPES.proposalReview,
  TASKEN_MOBILE_SCOPES.humanReview,
] satisfies MobileScope[]);

export interface MobileDeviceRecord {
  id: string;
  label: string;
  scopes: MobileScope[];
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  revokedAt: string;
  version: number;
}

export interface StoredMobileDeviceRecord extends MobileDeviceRecord {
  tokenHash: string;
}

export interface PairMobileDeviceRecord {
  id: string;
  label: string;
  tokenHash: string;
  scopes: MobileScope[];
  pairedAt: string;
}

export interface MobileDevicePersistence {
  pairMobileDevice(input: PairMobileDeviceRecord): StoredMobileDeviceRecord;
  findMobileDeviceByTokenHash(tokenHash: string): StoredMobileDeviceRecord | null;
  listMobileDevices(): StoredMobileDeviceRecord[];
  revokeMobileDevice(id: string, revokedAt: string): StoredMobileDeviceRecord | null;
  touchMobileDevice(id: string, lastSeenAt: string): void;
}

export interface MobilePairingTicket {
  code: string;
  expiresAt: string;
}

export interface MobilePairingInput {
  code: string;
  deviceId: string;
  deviceLabel: string;
}

export interface MobilePairingResult {
  accessToken: string;
  device: MobileDeviceRecord;
}

export interface MobileDeviceRegistryOptions {
  persistence: MobileDevicePersistence;
  now?: () => Date;
  pairingTtlMs?: number;
  createAccessToken?: () => string;
  createPairingCode?: () => string;
}

interface PendingPairing {
  digest: Buffer;
  expiresAtMs: number;
}

export class MobileDeviceRegistryError extends Error {
  readonly code: "pairing_code_invalid" | "entity_conflict";

  constructor(code: MobileDeviceRegistryError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MobileDeviceRegistryError";
    this.code = code;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function pairingDigest(value: string): Buffer {
  return createHash("sha256")
    .update("tasken-mobile-pairing:" + value, "utf8")
    .digest();
}

function publicDevice(record: StoredMobileDeviceRecord): MobileDeviceRecord {
  return {
    id: record.id,
    label: record.label,
    scopes: [...record.scopes],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastSeenAt: record.lastSeenAt,
    revokedAt: record.revokedAt,
    version: record.version,
  };
}

function defaultPairingCode(): string {
  return String(randomInt(0, 100_000_000)).padStart(8, "0");
}

function defaultAccessToken(): string {
  return randomBytes(ACCESS_TOKEN_BYTES).toString("base64url");
}

export class MobileDeviceRegistry {
  private readonly persistence: MobileDevicePersistence;
  private readonly now: () => Date;
  private readonly pairingTtlMs: number;
  private readonly createAccessToken: () => string;
  private readonly createPairingCode: () => string;
  private pendingPairing: PendingPairing | null = null;

  constructor(options: MobileDeviceRegistryOptions) {
    this.persistence = options.persistence;
    this.now = options.now || (() => new Date());
    this.pairingTtlMs = options.pairingTtlMs || DEFAULT_PAIRING_TTL_MS;
    this.createAccessToken = options.createAccessToken || defaultAccessToken;
    this.createPairingCode = options.createPairingCode || defaultPairingCode;
  }

  issuePairing(): MobilePairingTicket {
    const code = this.createPairingCode();
    if (!PAIRING_CODE_PATTERN.test(code))
      throw new Error("Mobile pairing code generator returned an invalid value");
    const expiresAtMs = this.now().getTime() + this.pairingTtlMs;
    this.pendingPairing = { digest: pairingDigest(code), expiresAtMs };
    return { code, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  cancelPairing(): void {
    this.pendingPairing = null;
  }

  pair(input: MobilePairingInput): MobilePairingResult {
    const pending = this.pendingPairing;
    const suppliedDigest = pairingDigest(input.code);
    const valid = Boolean(
      pending &&
      this.now().getTime() <= pending.expiresAtMs &&
      pending.digest.length === suppliedDigest.length &&
      timingSafeEqual(pending.digest, suppliedDigest),
    );
    if (!valid) {
      throw new MobileDeviceRegistryError(
        "pairing_code_invalid",
        "Pairing code is invalid or expired",
      );
    }
    const accessToken = this.createAccessToken();
    if (!ACCESS_TOKEN_PATTERN.test(accessToken))
      throw new Error("Mobile access token generator returned an invalid value");
    const pairedAt = this.now().toISOString();
    try {
      const record = this.persistence.pairMobileDevice({
        id: input.deviceId,
        label: input.deviceLabel,
        tokenHash: sha256(accessToken),
        scopes: [...MOBILE_DEVICE_DEFAULT_SCOPES],
        pairedAt,
      });
      this.pendingPairing = null;
      return { accessToken, device: publicDevice(record) };
    } catch (error) {
      throw new MobileDeviceRegistryError("entity_conflict", "Mobile device already exists", {
        cause: error,
      });
    }
  }

  authenticate(accessToken: string): MobilePrincipal | null {
    if (!ACCESS_TOKEN_PATTERN.test(accessToken)) return null;
    const record = this.persistence.findMobileDeviceByTokenHash(sha256(accessToken));
    if (!record || record.revokedAt) return null;
    this.persistence.touchMobileDevice(record.id, this.now().toISOString());
    return { kind: "mobile_device", deviceId: record.id, scopes: [...record.scopes] };
  }

  listDevices(): MobileDeviceRecord[] {
    return this.persistence.listMobileDevices().map(publicDevice);
  }

  revoke(deviceId: string): MobileDeviceRecord | null {
    const record = this.persistence.revokeMobileDevice(deviceId, this.now().toISOString());
    return record ? publicDevice(record) : null;
  }
}
