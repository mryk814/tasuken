export const CAPTURE_ORGANIZER_PROVIDERS = [
  { id: "chatgpt", label: "ChatGPTの契約（推奨）" },
  { id: "openai", label: "OpenAI API" },
  { id: "azure", label: "Azure OpenAI" },
  { id: "gemini", label: "Gemini" },
  { id: "opencode-zen", label: "OpenCode Zen" },
  { id: "opencode-go", label: "OpenCode Go" },
] as const;

export type CaptureOrganizerProvider = (typeof CAPTURE_ORGANIZER_PROVIDERS)[number]["id"];

/** APIキーで従量課金されるprovider。ChatGPTの契約枠はここに含めない。 */
export function isMeteredCaptureOrganizerProvider(provider: CaptureOrganizerProvider): boolean {
  return provider !== "chatgpt";
}

export const CAPTURE_ORGANIZER_MONTHLY_LIMIT_MAX = 100000;

export const CAPTURE_ORGANIZER_CHAT_MODELS = {
  "opencode-zen": [
    "deepseek-v4-pro",
    "deepseek-v4-flash",
    "deepseek-v4-flash-vision-exp",
    "minimax-m3",
    "minimax-m2.7",
    "minimax-m2.5",
    "glm-5.3-flash",
    "glm-5.3",
    "glm-5.2",
    "glm-5.1",
    "glm-5",
    "kimi-k2.5",
    "kimi-k2.6",
    "kimi-k2.7-code",
    "kimi-k3",
    "big-pickle",
  ],
  "opencode-go": [
    "glm-5.3-flash",
    "glm-5.3",
    "glm-5.2",
    "glm-5.1",
    "kimi-k3",
    "kimi-k2.7-code",
    "kimi-k2.6",
    "longcat-2.0",
    "deepseek-v4-pro",
    "deepseek-v4-flash",
    "deepseek-v4-flash-vision-exp",
    "mimo-v2.5",
    "mimo-v2.5-pro",
  ],
} as const;

export interface CaptureOrganizerSettingsInput {
  provider: CaptureOrganizerProvider;
  model: string;
  endpoint: string;
  vocabulary: string;
  apiKey?: string;
  /** 従量APIの月間リクエスト上限。null は上限なし。ChatGPTの契約では使わない。 */
  monthlyRequestLimit?: number | null;
}

export interface CaptureOrganizerSettingsState {
  provider: CaptureOrganizerProvider;
  model: string;
  endpoint: string;
  vocabulary: string;
  hasApiKey: boolean;
  monthlyRequestLimit: number | null;
  /** 今月、従量APIへ送った整理リクエスト数（Tasken内の集計）。 */
  monthlyRequestCount: number;
  source: "saved" | "environment" | "none";
  secureStorageAvailable: boolean;
  configurationError?: string;
}

export interface CaptureOrganizerConnectionResult {
  ok: boolean;
  message: string;
}

export interface ChatGptAccountState {
  status: "disconnected" | "connecting" | "connected" | "reauth_required";
  /** 表示用。ID tokenのemail claim。 */
  email: string | null;
  secureStorageAvailable: boolean;
}

export interface ChatGptModelOption {
  slug: string;
  displayName: string;
}
