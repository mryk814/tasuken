export const CAPTURE_ORGANIZER_PROVIDERS = [
  { id: "openai", label: "OpenAI" },
  { id: "azure", label: "Azure OpenAI" },
  { id: "gemini", label: "Gemini" },
  { id: "opencode-zen", label: "OpenCode Zen" },
  { id: "opencode-go", label: "OpenCode Go" },
] as const;

export type CaptureOrganizerProvider = (typeof CAPTURE_ORGANIZER_PROVIDERS)[number]["id"];

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
  apiKey?: string;
}

export interface CaptureOrganizerSettingsState {
  provider: CaptureOrganizerProvider;
  model: string;
  endpoint: string;
  hasApiKey: boolean;
  source: "saved" | "environment" | "none";
  secureStorageAvailable: boolean;
  configurationError?: string;
}

export interface CaptureOrganizerConnectionResult {
  ok: boolean;
  message: string;
}
