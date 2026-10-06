import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  CAPTURE_ORGANIZER_MONTHLY_LIMIT_MAX,
  CAPTURE_ORGANIZER_PROVIDERS,
  isMeteredCaptureOrganizerProvider,
  type CaptureOrganizerConnectionResult,
  type CaptureOrganizerSettingsInput,
  type CaptureOrganizerSettingsState,
} from "../../shared/captureOrganizerSettings.ts";
import {
  createCaptureOrganizerFromEnvironment,
  CaptureOrganizerUserError,
  type CaptureOrganizerBatch,
  type CaptureOrganizerInput,
  type ChatGptTokenSource,
} from "../gateway/mobile/public.ts";

interface SecureStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}

const inputSchema = z.strictObject({
  provider: z.enum(CAPTURE_ORGANIZER_PROVIDERS.map((item) => item.id)),
  model: z.string().trim().min(1).max(200),
  endpoint: z.string().trim().max(500),
  vocabulary: z.string().trim().max(4000).default(""),
  apiKey: z.string().trim().max(16000).optional(),
  monthlyRequestLimit: z
    .number()
    .int()
    .min(1)
    .max(CAPTURE_ORGANIZER_MONTHLY_LIMIT_MAX)
    .nullable()
    .default(null),
});
// ChatGPTの契約ではAPIキーを持たない。旧版の保存形式（キー必須・上限なし）もそのまま読む。
const savedSchema = inputSchema.omit({ apiKey: true }).extend({
  encryptedApiKey: z.string().min(1).max(64000).nullable().default(null),
});
type SavedSettings = z.infer<typeof savedSchema>;
type SettingsWithKey = Omit<Required<CaptureOrganizerSettingsInput>, "monthlyRequestLimit"> & {
  monthlyRequestLimit: number | null;
};
const usageSchema = z.strictObject({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  count: z.number().int().min(0),
});

export type ChatGptOrganizerAccount = ChatGptTokenSource & { isConnected(): boolean };

function failure(): Error {
  return new Error(
    "入力整理の設定を読み書きできません。設定と端末の暗号化機能を確認して再試行してください。",
  );
}

/** Device-local settings only: never stored in the workspace DB or its exports. */
export class CaptureOrganizerSettingsService {
  private readonly filePath: string;
  private readonly usagePath: string;

  constructor(
    userDataPath: string,
    private readonly secureStorage: SecureStorage,
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly files: Pick<
      typeof fs,
      "readFileSync" | "writeFileSync" | "renameSync" | "unlinkSync" | "mkdirSync"
    > = fs,
    private readonly chatgpt?: ChatGptOrganizerAccount,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.filePath = path.join(userDataPath, "capture-organizer-settings.json");
    this.usagePath = path.join(userDataPath, "capture-organizer-usage.json");
  }

  private secureAvailable(): boolean {
    try {
      return (
        this.secureStorage.isEncryptionAvailable() &&
        this.secureStorage.getSelectedStorageBackend?.() !== "basic_text"
      );
    } catch {
      return false;
    }
  }

  private currentMonth(): string {
    const now = this.now();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  /** 今月、従量APIへ送った回数。月が替わると0に戻る。 */
  private monthlyCount(): number {
    try {
      const usage = usageSchema.parse(JSON.parse(this.files.readFileSync(this.usagePath, "utf8")));
      return usage.month === this.currentMonth() ? usage.count : 0;
    } catch {
      return 0;
    }
  }

  /** 従量APIへ送る直前の上限確認。上限に達していれば送らない。 */
  private meteredGuard(limit: number | null): () => void {
    return () => {
      const count = this.monthlyCount();
      if (limit !== null && count >= limit)
        throw new CaptureOrganizerUserError(
          `今月のAPI利用回数が上限（${limit}回）に達したため送信しませんでした。Settingsの「入力のAI整理」で上限を見直せます。原文は保持されています。`,
          "monthly_limit",
        );
      const temporaryPath = `${this.usagePath}.${randomUUID()}.tmp`;
      try {
        this.files.mkdirSync(path.dirname(this.usagePath), { recursive: true });
        this.files.writeFileSync(
          temporaryPath,
          JSON.stringify({ month: this.currentMonth(), count: count + 1 }),
          { mode: 0o600, flag: "wx" },
        );
        this.files.renameSync(temporaryPath, this.usagePath);
      } catch {
        // 集計できない状態で上限を素通りさせない。
        throw new CaptureOrganizerUserError(
          "API利用回数を記録できないため送信しませんでした。保存先の権限を確認してください。原文は保持されています。",
          "monthly_limit",
        );
      } finally {
        try {
          this.files.unlinkSync(temporaryPath);
        } catch {
          /* Renamed. */
        }
      }
    };
  }

  private organizerFor(settings: SettingsWithKey) {
    return createCaptureOrganizerFromEnvironment(this.environmentFor(settings), this.fetchImpl, {
      chatgpt: settings.provider === "chatgpt" ? this.chatgpt : undefined,
      beforeMeteredRequest: isMeteredCaptureOrganizerProvider(settings.provider)
        ? this.meteredGuard(settings.monthlyRequestLimit)
        : undefined,
    });
  }

  private readSaved(): SavedSettings | null {
    try {
      return savedSchema.parse(JSON.parse(this.files.readFileSync(this.filePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw failure();
    }
  }

  private fromEnvironment(): SettingsWithKey | null {
    if (
      !this.environment.TASKEN_CAPTURE_LLM_PROVIDER?.trim() ||
      !this.environment.TASKEN_CAPTURE_LLM_MODEL?.trim() ||
      !this.environment.TASKEN_CAPTURE_LLM_API_KEY?.trim()
    )
      return null;
    return this.normalize({
      provider: this.environment.TASKEN_CAPTURE_LLM_PROVIDER,
      model: this.environment.TASKEN_CAPTURE_LLM_MODEL ?? "",
      endpoint: this.environment.TASKEN_CAPTURE_LLM_ENDPOINT ?? "",
      vocabulary: this.environment.TASKEN_CAPTURE_LLM_VOCABULARY ?? "",
      apiKey: this.environment.TASKEN_CAPTURE_LLM_API_KEY ?? "",
    }) as SettingsWithKey;
  }

  private normalize(value: unknown): z.infer<typeof inputSchema> {
    const parsed = inputSchema.parse(value);
    if (parsed.provider === "chatgpt")
      return { ...parsed, endpoint: "", apiKey: undefined, monthlyRequestLimit: null };
    if (parsed.provider !== "azure") return { ...parsed, endpoint: "" };
    const endpoint = new URL(parsed.endpoint);
    if (
      endpoint.protocol !== "https:" ||
      endpoint.port ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname !== "/" ||
      !/^[a-zA-Z0-9-]+\.(openai\.azure\.com|services\.ai\.azure\.com)$/.test(endpoint.hostname)
    ) {
      throw failure();
    }
    return { ...parsed, endpoint: endpoint.origin };
  }

  private environmentFor(settings: SettingsWithKey): NodeJS.ProcessEnv {
    return {
      TASKEN_CAPTURE_LLM_PROVIDER: settings.provider,
      TASKEN_CAPTURE_LLM_MODEL: settings.model,
      TASKEN_CAPTURE_LLM_ENDPOINT: settings.endpoint,
      TASKEN_CAPTURE_LLM_VOCABULARY: settings.vocabulary,
      TASKEN_CAPTURE_LLM_API_KEY: settings.apiKey,
    };
  }

  private resolveInput(value: unknown): SettingsWithKey {
    const input = this.normalize(value);
    if (input.provider === "chatgpt") {
      const settings = { ...input, apiKey: "" };
      if (!this.organizerFor(settings)) throw failure();
      return settings;
    }
    let apiKey = input.apiKey ?? "";
    if (!apiKey) {
      const saved = this.readSaved();
      if (
        saved?.encryptedApiKey &&
        saved.provider === input.provider &&
        saved.endpoint === input.endpoint
      ) {
        if (!this.secureAvailable()) throw failure();
        apiKey = this.secureStorage.decryptString(Buffer.from(saved.encryptedApiKey, "base64"));
      } else if (!saved) {
        const environment = this.fromEnvironment();
        if (environment?.provider === input.provider && environment.endpoint === input.endpoint) {
          apiKey = environment.apiKey;
        }
      }
    }
    if (!apiKey || !this.organizerFor({ ...input, apiKey })) throw failure();
    return { ...input, apiKey };
  }

  async getSettings(): Promise<CaptureOrganizerSettingsState> {
    try {
      const saved = this.readSaved();
      const settings = saved ?? this.fromEnvironment();
      return {
        provider: settings?.provider ?? "chatgpt",
        model: settings?.model ?? "",
        endpoint: settings?.endpoint ?? "",
        vocabulary: settings?.vocabulary ?? "",
        hasApiKey: saved
          ? Boolean(saved.encryptedApiKey)
          : Boolean(settings && "apiKey" in settings && settings.apiKey),
        monthlyRequestLimit: settings?.monthlyRequestLimit ?? null,
        monthlyRequestCount: this.monthlyCount(),
        source: saved ? "saved" : settings ? "environment" : "none",
        secureStorageAvailable: this.secureAvailable(),
      };
    } catch {
      return {
        provider: "chatgpt",
        model: "",
        endpoint: "",
        vocabulary: "",
        hasApiKey: false,
        monthlyRequestLimit: null,
        monthlyRequestCount: this.monthlyCount(),
        source: "none",
        secureStorageAvailable: this.secureAvailable(),
        configurationError:
          "設定を読み込めません。APIキーを含む設定を入力して保存するか、保存設定を削除してください。",
      };
    }
  }

  async saveSettings(value: CaptureOrganizerSettingsInput): Promise<CaptureOrganizerSettingsState> {
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      const { apiKey, ...settings } = this.resolveInput(value);
      if (settings.provider !== "chatgpt" && !this.secureAvailable()) throw failure();
      const encryptedApiKey = apiKey
        ? this.secureStorage.encryptString(apiKey).toString("base64")
        : null;
      this.files.mkdirSync(path.dirname(this.filePath), { recursive: true });
      this.files.writeFileSync(temporaryPath, JSON.stringify({ ...settings, encryptedApiKey }), {
        mode: 0o600,
        flag: "wx",
      });
      this.files.renameSync(temporaryPath, this.filePath);
      return await this.getSettings();
    } catch {
      throw failure();
    } finally {
      try {
        this.files.unlinkSync(temporaryPath);
      } catch {
        /* No temporary file after successful rename or before a write. */
      }
    }
  }

  async clearSettings(): Promise<CaptureOrganizerSettingsState> {
    try {
      try {
        this.files.unlinkSync(this.filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      return await this.getSettings();
    } catch {
      throw failure();
    }
  }

  createOrganizer(): ReturnType<typeof createCaptureOrganizerFromEnvironment> {
    try {
      const saved = this.readSaved();
      if (!saved) {
        const environment = this.fromEnvironment();
        return environment ? this.organizerFor(environment) : null;
      }
      if (saved.provider === "chatgpt") return this.organizerFor({ ...saved, apiKey: "" });
      if (!saved.encryptedApiKey || !this.secureAvailable()) throw failure();
      const apiKey = this.secureStorage.decryptString(Buffer.from(saved.encryptedApiKey, "base64"));
      return this.organizerFor({ ...saved, apiKey });
    } catch {
      throw failure();
    }
  }

  async testConnection(
    value: CaptureOrganizerSettingsInput,
  ): Promise<CaptureOrganizerConnectionResult> {
    try {
      const settings = this.resolveInput(value);
      if (settings.provider === "chatgpt" && !this.chatgpt?.isConnected())
        return { ok: false, message: "先にChatGPTと接続してください。" };
      const organizer = this.organizerFor(settings);
      if (!organizer) throw failure();
      await organizer.organize({
        text: "牛乳を買う",
        capturedAt: new Date().toISOString(),
        timeZone: "Asia/Tokyo",
        themeId: null,
        themes: [],
        maxTasks: 1,
      });
      return { ok: true, message: "接続を確認しました。" };
    } catch (error) {
      if (error instanceof CaptureOrganizerUserError) return { ok: false, message: error.message };
      return {
        ok: false,
        message: "接続できません。APIキー、モデル、接続先を確認して再試行してください。",
      };
    }
  }

  async organize(input: CaptureOrganizerInput): Promise<CaptureOrganizerBatch> {
    const organizer = this.createOrganizer();
    if (!organizer)
      throw new Error(
        "入力整理の接続が未設定です。SettingsでChatGPTと接続するか、APIキーとモデルを指定してください。",
      );
    return organizer.organize(input);
  }
}
