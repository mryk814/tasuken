export interface DailyContextAutoConfig {
  enabled: boolean;
  root: string;
  timezone: string;
  themeId: string | null;
  fromDate: string;
  includeFullText: boolean;
}

export interface DailyContextDeviceObservation {
  kind: "android_connection" | "shared_folder_received";
  deviceId: string;
  observedAt: string;
  revision?: string | number;
}

export interface DailyContextFreshness {
  observedAt: string;
  configuredFromDate: string;
  publishedThrough: string | null;
  lastLocalWrittenAt: string | null;
  sourceRevision: string | null;
  pendingCount: number | null;
  deviceObservations: DailyContextDeviceObservation[];
}

export interface DailyContextAutoState {
  config: DailyContextAutoConfig;
  pendingDates: string[];
  needsScan: boolean;
  sourceHashes: Record<string, string>;
  checkedThrough: string | null;
  deviceObservations: DailyContextDeviceObservation[];
  lastWrittenAt: string | null;
  lastSourceRevision: string | null;
  error: string | null;
  retryAt: string | null;
}

export interface DailyContextAutoStatus {
  config: DailyContextAutoConfig;
  freshness: DailyContextFreshness;
  error: string | null;
  retryAt: string | null;
}

export function createDailyContextAutoState(): DailyContextAutoState {
  return {
    config: {
      enabled: false,
      root: "",
      timezone: "Asia/Tokyo",
      themeId: null,
      fromDate: "",
      includeFullText: false,
    },
    pendingDates: [],
    needsScan: true,
    sourceHashes: {},
    checkedThrough: null,
    deviceObservations: [],
    lastWrittenAt: null,
    lastSourceRevision: null,
    error: null,
    retryAt: null,
  };
}

export function validateDailyContextAutoConfig(
  config: DailyContextAutoConfig,
): DailyContextAutoConfig {
  if (
    typeof config?.enabled !== "boolean" ||
    typeof config.root !== "string" ||
    typeof config.timezone !== "string" ||
    !config.timezone.trim() ||
    typeof config.fromDate !== "string" ||
    typeof config.includeFullText !== "boolean" ||
    (config.themeId !== null && (typeof config.themeId !== "string" || !config.themeId.trim()))
  )
    throw new Error("自動公開の設定が不正です。");
  try {
    new Intl.DateTimeFormat("en", { timeZone: config.timezone }).format();
  } catch {
    throw new Error("タイムゾーンが不正です。");
  }
  if (
    config.fromDate !== "" &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(config.fromDate) ||
      !Number.isFinite(Date.parse(config.fromDate)) ||
      new Date(config.fromDate).toISOString().slice(0, 10) !== config.fromDate)
  )
    throw new Error("公開開始日が不正です。");
  if (config.enabled && (!config.root.trim() || !config.fromDate))
    throw new Error("公開先と開始日を設定してください。");
  return { ...config };
}
