import type {
  AiAdapterKind,
  AiApiSurface,
  AiCapability,
  AiFeature,
  AiFeatureAvailability,
  AiModelProfile,
  AiProviderProfile,
} from "../../../shared/ai";

const IMPLEMENTED_ADAPTER_CAPABILITIES: Partial<Record<AiAdapterKind, AiCapability[]>> = {
  "openai-native": ["text", "streaming", "tool_calling", "parallel_tool_calling", "structured_output"],
  "openai-compatible": ["text", "streaming", "tool_calling", "parallel_tool_calling", "structured_output"],
  "azure-openai": ["text", "streaming", "tool_calling", "parallel_tool_calling", "structured_output"],
};

export function adapterCapabilities(adapterKind: AiAdapterKind, apiSurface: AiApiSurface): AiCapability[] {
  if (apiSurface !== "responses") return [];
  return [...(IMPLEMENTED_ADAPTER_CAPABILITIES[adapterKind] || [])];
}

export const FEATURE_REQUIREMENTS: Record<AiFeature, AiCapability[]> = {
  note_assistant: ["text"],
  structured_output: ["text", "structured_output"],
  tool_use: ["text", "tool_calling"],
  vision: ["text", "vision"],
  embeddings: ["embeddings"],
};

export function resolveFeatureAvailability(
  feature: AiFeature,
  provider: AiProviderProfile,
  model: AiModelProfile,
): AiFeatureAvailability {
  const required = FEATURE_REQUIREMENTS[feature];
  if (!provider.enabled) {
    return { feature, available: false, required, missing: required, reason: "provider_disabled" };
  }
  if (provider.adapterStatus !== "implemented") {
    return { feature, available: false, required, missing: required, reason: "adapter_unimplemented" };
  }
  if (model.lifecycle !== "available" && model.lifecycle !== "experimental") {
    return { feature, available: false, required, missing: required, reason: "model_unavailable" };
  }
  const effectiveCapabilities = model.capabilities.filter((capability) => adapterCapabilities(provider.adapterKind, provider.apiSurface).includes(capability));
  const missing = required.filter((capability) => !effectiveCapabilities.includes(capability));
  return missing.length === 0
    ? { feature, available: true, required, missing: [] }
    : { feature, available: false, required, missing, reason: "capability_missing" };
}
