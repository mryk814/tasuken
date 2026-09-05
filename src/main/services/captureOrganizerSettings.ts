import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  CAPTURE_ORGANIZER_PROVIDERS,
  type CaptureOrganizerConnectionResult,
  type CaptureOrganizerSettingsInput,
  type CaptureOrganizerSettingsState,
} from "../../shared/captureOrganizerSettings.ts";
import {
  createCaptureOrganizerFromEnvironment,
  type CaptureOrganizerInput,
  type CaptureOrganizerProposal,
} from "../gateway/mobile/captureOrganizer.ts";

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
  apiKey: z.string().trim().max(16000).optional(),
});
const savedSchema = inputSchema.omit({ apiKey: true }).extend({
  encryptedApiKey: z.string().min(1).max(64000),
});
type SavedSettings = z.infer<typeof savedSchema>;
type SettingsWithKey = Required<CaptureOrganizerSettingsInput>;

function failure(): Error {
  return new Error(
    "入力整理の設定を読み書きできません。設定と端末の暗号化機能を確認して再試行してください。",
  );
}

/** Device-local settings only: never stored in the workspace DB or its exports. */
export class CaptureOrganizerSettingsService {
  private readonly filePath: string;

  constructor(
    userDataPath: string,
    private readonly secureStorage: SecureStorage,
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly files: Pick<
      typeof fs,
      "readFileSync" | "writeFileSync" | "renameSync" | "unlinkSync" | "mkdirSync"
    > = fs,
  ) {
    this.filePath = path.join(userDataPath, "capture-organizer-settings.json");
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
      apiKey: this.environment.TASKEN_CAPTURE_LLM_API_KEY ?? "",
    }) as SettingsWithKey;
  }

  private normalize(value: unknown): CaptureOrganizerSettingsInput {
    const parsed = inputSchema.parse(value);
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
      TASKEN_CAPTURE_LLM_API_KEY: settings.apiKey,
    };
  }

  private resolveInput(value: unknown): SettingsWithKey {
    const input = this.normalize(value);
    let apiKey = input.apiKey ?? "";
    if (!apiKey) {
      const saved = this.readSaved();
      if (saved && saved.provider === input.provider && saved.endpoint === input.endpoint) {
        if (!this.secureAvailable()) throw failure();
        apiKey = this.secureStorage.decryptString(Buffer.from(saved.encryptedApiKey, "base64"));
      } else if (!saved) {
        const environment = this.fromEnvironment();
        if (environment?.provider === input.provider && environment.endpoint === input.endpoint) {
          apiKey = environment.apiKey;
        }
      }
    }
    if (
      !apiKey ||
      !createCaptureOrganizerFromEnvironment(
        this.environmentFor({ ...input, apiKey }),
        this.fetchImpl,
      )
    ) {
      throw failure();
    }
    return { ...input, apiKey };
  }

  async getSettings(): Promise<CaptureOrganizerSettingsState> {
    try {
      const saved = this.readSaved();
      const settings = saved ?? this.fromEnvironment();
      return {
        provider: settings?.provider ?? "openai",
        model: settings?.model ?? "",
        endpoint: settings?.endpoint ?? "",
        hasApiKey: saved ? true : Boolean(settings && "apiKey" in settings && settings.apiKey),
        source: saved ? "saved" : settings ? "environment" : "none",
        secureStorageAvailable: this.secureAvailable(),
      };
    } catch {
      return {
        provider: "openai",
        model: "",
        endpoint: "",
        hasApiKey: false,
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
      if (!this.secureAvailable()) throw failure();
      const { apiKey, ...settings } = this.resolveInput(value);
      const encryptedApiKey = this.secureStorage.encryptString(apiKey).toString("base64");
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
      if (!saved) return createCaptureOrganizerFromEnvironment(this.environment, this.fetchImpl);
      if (!this.secureAvailable()) throw failure();
      const apiKey = this.secureStorage.decryptString(Buffer.from(saved.encryptedApiKey, "base64"));
      return createCaptureOrganizerFromEnvironment(
        this.environmentFor({ ...saved, apiKey }),
        this.fetchImpl,
      );
    } catch {
      throw failure();
    }
  }

  async testConnection(
    value: CaptureOrganizerSettingsInput,
  ): Promise<CaptureOrganizerConnectionResult> {
    try {
      const settings = this.resolveInput(value);
      const organizer = createCaptureOrganizerFromEnvironment(
        this.environmentFor(settings),
        this.fetchImpl,
      );
      if (!organizer) throw failure();
      await organizer.organize({
        text: "牛乳を買う",
        capturedAt: new Date().toISOString(),
        timeZone: "Asia/Tokyo",
        themeId: null,
        themes: [],
      });
      return { ok: true, message: "接続を確認しました。" };
    } catch {
      return {
        ok: false,
        message: "接続できません。APIキー、モデル、接続先を確認して再試行してください。",
      };
    }
  }

  async organize(input: CaptureOrganizerInput): Promise<CaptureOrganizerProposal> {
    const organizer = this.createOrganizer();
    if (!organizer)
      throw new Error("入力整理の接続が未設定です。設定でAPIキーとモデルを指定してください。");
    return organizer.organize(input);
  }
}
