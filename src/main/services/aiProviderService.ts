import fs from "node:fs";
import path from "node:path";

import { safeStorage } from "electron";

import type {
  AiNoteGenerateRequest,
  AiNoteGenerateResult,
  AiProviderConfig,
  AiProviderConfigUpdate,
} from "../../shared/ai";

const DEFAULT_MODEL = "gpt-5.6";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MAX_BODY_CHARS = 300_000;

interface StoredAiConfig {
  provider: "openai";
  model: string;
  encryptedApiKey?: string;
}

interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

type FetchLike = typeof fetch;

function cleanModel(value: unknown): string {
  const model = typeof value === "string" ? value.trim() : "";
  if (!model || model.length > 120 || !/^[a-zA-Z0-9._:-]+$/.test(model)) {
    throw new Error("モデル名が不正です。英数字・ピリオド・ハイフンで指定してください。");
  }
  return model;
}

function readResponseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text.trim();
  if (!Array.isArray(record.output)) return "";
  return record.output.flatMap((item) => {
    if (!item || typeof item !== "object" || !Array.isArray((item as Record<string, unknown>).content)) return [];
    return ((item as Record<string, unknown>).content as unknown[]).flatMap((content) => {
      if (!content || typeof content !== "object") return [];
      const text = (content as Record<string, unknown>).text;
      return typeof text === "string" ? [text] : [];
    });
  }).join("\n").trim();
}

function validateRequest(value: AiNoteGenerateRequest): AiNoteGenerateRequest {
  if (!value || typeof value !== "object") throw new Error("AI編集の入力が不正です。");
  if (!["rewrite", "continue", "chat"].includes(value.mode)) throw new Error("AI編集モードが不正です。");
  if (!["document", "selection"].includes(value.scope)) throw new Error("AI編集範囲が不正です。");
  if (typeof value.body !== "string" || value.body.length > MAX_BODY_CHARS) {
    throw new Error("Note本文が大きすぎます。30万文字以下にしてください。");
  }
  if (typeof value.instruction !== "string" || !value.instruction.trim() || value.instruction.length > 20_000) {
    throw new Error("AIへの指示を1〜2万文字で入力してください。");
  }
  if (value.scope === "selection") {
    const selection = value.selection;
    if (
      !selection
      || !Number.isInteger(selection.start)
      || !Number.isInteger(selection.end)
      || selection.start < 0
      || selection.end <= selection.start
      || value.body.slice(selection.start, selection.end) !== selection.text
    ) {
      throw new Error("選択範囲が本文と一致しません。範囲を選び直してください。");
    }
  }
  return value;
}

function buildPrompt(request: AiNoteGenerateRequest): string {
  const target = request.scope === "selection" ? request.selection!.text : request.body;
  const task = request.mode === "continue"
    ? "自然な続きをMarkdownで書いてください。既存本文は出力に含めず、追記部分だけを返してください。"
    : "指示に従ってMarkdownを編集してください。説明やコードフェンスを付けず、編集後の対象本文だけを返してください。";
  return [
    `Note title: ${request.title || "無題"}`,
    `Mode: ${request.mode}`,
    task,
    `Instruction: ${request.instruction.trim()}`,
    "",
    "Target Markdown:",
    target,
  ].join("\n");
}

export class AiProviderService {
  private readonly configPath: string;

  constructor(
    userDataPath: string,
    private readonly storage: SafeStorageAdapter = safeStorage,
    private readonly fetcher: FetchLike = fetch,
  ) {
    this.configPath = path.join(userDataPath, "ai-provider.json");
  }

  getConfig(): AiProviderConfig {
    const stored = this.readConfig();
    return {
      provider: "openai",
      model: stored.model,
      hasApiKey: Boolean(stored.encryptedApiKey),
    };
  }

  saveConfig(update: AiProviderConfigUpdate): AiProviderConfig {
    if (!update || update.provider !== "openai") throw new Error("対応していないAIプロバイダーです。");
    const current = this.readConfig();
    const next: StoredAiConfig = {
      provider: "openai",
      model: cleanModel(update.model),
      encryptedApiKey: update.clearApiKey ? undefined : current.encryptedApiKey,
    };
    const apiKey = typeof update.apiKey === "string" ? update.apiKey.trim() : "";
    if (apiKey) {
      if (!this.storage.isEncryptionAvailable()) {
        throw new Error("この端末では資格情報を安全に暗号化できません。OSの資格情報保護を有効にしてください。");
      }
      next.encryptedApiKey = this.storage.encryptString(apiKey).toString("base64");
    }
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    return this.getConfig();
  }

  async generateNote(requestValue: AiNoteGenerateRequest): Promise<AiNoteGenerateResult> {
    const request = validateRequest(requestValue);
    const stored = this.readConfig();
    if (!stored.encryptedApiKey) throw new Error("SettingsでOpenAI APIキーを設定してください。");
    if (!this.storage.isEncryptionAvailable()) throw new Error("保存したAPIキーを復号できません。OSの資格情報保護を確認してください。");
    const apiKey = this.storage.decryptString(Buffer.from(stored.encryptedApiKey, "base64"));
    const response = await this.fetcher(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: stored.model,
        input: buildPrompt(request),
      }),
    });
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const message = payload && typeof payload === "object"
        ? String(((payload as Record<string, unknown>).error as Record<string, unknown> | undefined)?.message || "")
        : "";
      throw new Error(`OpenAI APIが応答しませんでした。${message || `HTTP ${response.status}`}。入力内容は保持されています。`);
    }
    const responseText = readResponseText(payload);
    if (!responseText) throw new Error("OpenAI APIの返答が空でした。入力内容は保持されています。");
    let proposedBody = responseText;
    if (request.mode === "continue") {
      proposedBody = `${request.body.replace(/\s+$/, "")}\n\n${responseText}`;
    } else if (request.scope === "selection") {
      proposedBody = `${request.body.slice(0, request.selection!.start)}${responseText}${request.body.slice(request.selection!.end)}`;
    }
    return { provider: "openai", model: stored.model, proposedBody, responseText };
  }

  private readConfig(): StoredAiConfig {
    if (!fs.existsSync(this.configPath)) return { provider: "openai", model: DEFAULT_MODEL };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.configPath, "utf8")) as Partial<StoredAiConfig>;
      return {
        provider: "openai",
        model: cleanModel(parsed.model || DEFAULT_MODEL),
        encryptedApiKey: typeof parsed.encryptedApiKey === "string" ? parsed.encryptedApiKey : undefined,
      };
    } catch (error) {
      throw new Error(`AI設定を読み込めませんでした。設定ファイルを確認してください。${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
