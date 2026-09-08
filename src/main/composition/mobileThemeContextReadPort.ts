import { normalizeThemeCharter, normalizeThemeState } from "../../shared/themeRef.mjs";
import { isoTimestampSchema } from "../../shared/kernel/public.ts";
import {
  mobileThemeContextDataSchema,
  type MobileThemeContextRequest,
} from "../../shared/contracts/mobile/public.ts";

interface Persistence {
  get(type: string, id: string): Record<string, unknown> | null;
}

/** The paired owner reads existing canonical intent, independently of AI publication policy. */
export function createMobileThemeContextReadPort(persistence: Persistence) {
  return (input: MobileThemeContextRequest) => {
    const theme = persistence.get("theme", input.themeId);
    if (!theme || theme.deleted_at) {
      return mobileThemeContextDataSchema.parse({
        themeId: input.themeId,
        status: "not_found",
        theme: null,
      });
    }
    const currentState = normalizeThemeState(theme.theme_state);
    return mobileThemeContextDataSchema.parse({
      themeId: input.themeId,
      status: "available",
      theme: {
        id: input.themeId,
        title: String(theme.name || "Theme").slice(0, 500),
        version: theme.version,
        updatedAt: isoTimestampSchema.safeParse(theme.updated_at).success ? theme.updated_at : null,
        charter: normalizeThemeCharter(theme.theme_charter),
        currentState: currentState
          ? {
              ...currentState,
              updated_at: isoTimestampSchema.safeParse(currentState.updated_at).success
                ? currentState.updated_at
                : null,
            }
          : null,
      },
    });
  };
}
