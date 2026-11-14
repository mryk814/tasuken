import type { TaskenCoreRuntime } from "../composition/taskenCoreRuntime.ts";
import {
  MobileGatewayRuntime,
  refuseMobileWriteForNow,
  type MobileDevicePersistence,
  type MobileGatewayStatePort,
  type MobileWriteGuard,
} from "../gateway/mobile/runtimePublic.ts";

/**
 * NASのheadless nodeでMobile Gatewayを動かす部品（Electron非依存）。
 * Desktopと同じMobileGatewayRuntime・adapterを使い、違いは、既存Entityの書き換えを
 * 共有フォルダの取り込みが追いついている間だけ受けること（下のguard）。
 */

export const DEFAULT_MOBILE_GATEWAY_PORT = 48_177;

interface GatewayPersistence extends MobileDevicePersistence {
  mobileGatewayState(): ReturnType<MobileGatewayStatePort["current"]>;
  hasSyncConflict(entityType: string, entityId: string): boolean;
}

interface GatewaySync {
  sourceStatus(node: "replica"): { state: string };
  isPublishBlocked(): boolean;
}

/**
 * NASの端末の書き込みの守り（R1）。
 * 端末の入力は、オフラインのoutboxと同じく版の照合と競合で守られるが、NASは共有フォルダから
 * Desktopの変更を取り込む側でもある。取り込みが遅れている間に既存のEntityを直すと、遅れて届く
 * Desktopの変更とEntityまるごとの二択の競合になる。そこで、既存Entityを書き換える操作だけを、
 * 次の間は503（retryable）で断る。端末のoutboxは残して自動で再送する。新しいEntityを足すだけの
 * 作成は通す。
 * - そのEntityに、共有フォルダ同期の未解決の競合がある。
 * - 取り込みが追いついていない（starting・waiting_*・blocked・io_error）。state=conflictは別のEntityの
 *   競合なので、ここでは断らず、Entityごとの判定に任せる。
 * さらに、DBが公開済みの状態より古い（古い写しへ戻した）ときは、作成も含めて全部断る。
 */
export function createMobileWriteGuard(
  persistence: Pick<GatewayPersistence, "hasSyncConflict">,
  sync: GatewaySync,
): MobileWriteGuard {
  return (intent) => {
    if (sync.isPublishBlocked()) refuseMobileWriteForNow();
    if (intent.kind === "create") return;
    const state = sync.sourceStatus("replica").state;
    if (state !== "ok" && state !== "conflict") refuseMobileWriteForNow();
    for (const target of intent.targets) {
      if (persistence.hasSyncConflict(target.type, target.id)) refuseMobileWriteForNow();
    }
  };
}

export interface HeadlessMobileGatewayOptions {
  runtime: TaskenCoreRuntime;
  persistence: GatewayPersistence;
  sync: GatewaySync;
  port: number;
}

export interface HeadlessMobileGateway {
  gateway: MobileGatewayRuntime;
  /** 管理用の口（loopback、全権token）。CLIのmobile-pair.mjsが呼ぶ。 */
  adminRoutes: Record<string, (body: unknown) => unknown>;
}

export function createHeadlessMobileGateway(
  options: HeadlessMobileGatewayOptions,
): HeadlessMobileGateway {
  const state: MobileGatewayStatePort = { current: () => options.persistence.mobileGatewayState() };
  const gateway = new MobileGatewayRuntime({
    adapter: options.runtime.createMobileGateway(
      state,
      {
        warn: (event) =>
          console.error(`[tasken-mobile-gateway] unexpected error ${event.location} ${event.id}`),
      },
      createMobileWriteGuard(options.persistence, options.sync),
    ),
    state,
    persistence: options.persistence,
    port: options.port,
    stats: options.runtime.stats,
    logger: {
      warn: (event) =>
        console.error(`[tasken-mobile-gateway] unexpected error ${event.location} ${event.id}`),
    },
  });
  return {
    gateway,
    adminRoutes: {
      "/v1/admin/mobile/pairing": () => gateway.issuePairing(),
      "/v1/admin/mobile/devices": () => ({ devices: gateway.diagnostics().devices }),
      "/v1/admin/mobile/revoke": (body) => {
        const deviceId =
          body &&
          typeof body === "object" &&
          typeof (body as { deviceId?: unknown }).deviceId === "string"
            ? (body as { deviceId: string }).deviceId.trim()
            : "";
        if (!deviceId) throw new Error("deviceIdを指定してください。");
        return { device: gateway.revokeDevice(deviceId) };
      },
    },
  };
}
