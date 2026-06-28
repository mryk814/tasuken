import { str } from "./format";

export const CHAT_SERVICE_TYPES = ["chatgpt", "claude", "gemini", "copilot"] as const;

export type ChatServiceType = typeof CHAT_SERVICE_TYPES[number] | "other";

export const CHAT_SERVICE_LABELS: Record<ChatServiceType, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  copilot: "Copilot",
  other: "Other",
};

export const CHAT_SERVICE_SHORT_LABELS: Record<ChatServiceType, string> = {
  chatgpt: "GPT",
  claude: "Claude",
  gemini: "Gemini",
  copilot: "Copilot",
  other: "Other",
};

const CHAT_SERVICE_SET = new Set<string>(CHAT_SERVICE_TYPES);

export function isKnownChatService(value: unknown): value is typeof CHAT_SERVICE_TYPES[number] {
  return CHAT_SERVICE_SET.has(str(value));
}

function hostnameFromUrl(value: unknown): string {
  const raw = str(value).trim();
  if (!raw) return "";
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    try {
      return new URL(`https://${raw}`).hostname.toLowerCase();
    } catch {
      return "";
    }
  }
}

function hostMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function inferChatServiceFromUrl(url: unknown): ChatServiceType {
  const hostname = hostnameFromUrl(url);
  if (!hostname) return "other";
  if (hostMatches(hostname, "chatgpt.com") || hostMatches(hostname, "chat.openai.com")) return "chatgpt";
  if (hostMatches(hostname, "claude.ai")) return "claude";
  if (hostMatches(hostname, "gemini.google.com") || hostMatches(hostname, "aistudio.google.com")) return "gemini";
  if (
    hostMatches(hostname, "copilot.microsoft.com") ||
    hostMatches(hostname, "m365.cloud.microsoft") ||
    hostMatches(hostname, "office.com") ||
    hostMatches(hostname, "microsoft365.com")
  ) {
    return "copilot";
  }
  return "other";
}

export function resolveChatService(resource: { link_type?: unknown; url?: unknown }): ChatServiceType {
  const linkType = str(resource.link_type);
  if (isKnownChatService(linkType)) return linkType;
  if (linkType === "other") return "other";
  return inferChatServiceFromUrl(resource.url);
}
