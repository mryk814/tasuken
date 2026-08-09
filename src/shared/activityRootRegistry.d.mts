export type ActivityRootRegistry = Record<string, string>;

export interface ActivityRootStatus {
  status: "ok" | "broken";
}

export type ActivityRootStatusMap = Record<string, ActivityRootStatus>;

export function buildActivityRootRegistry(options?: {
  artifactDirectory?: string | null;
  themes?: Array<Record<string, unknown>>;
}): ActivityRootRegistry;

export function publicActivityRootStatus(
  registry?: ActivityRootRegistry,
  exists?: (root: string) => boolean,
): ActivityRootStatusMap;
