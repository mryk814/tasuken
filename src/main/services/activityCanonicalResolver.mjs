import fs from "node:fs";
import path from "node:path";

import { normalizeCanonicalRef } from "../../shared/activityEvent.mjs";

/**
 * Resolve only the local side of a canonical ref. The returned path is an
 * internal Main-process value and must never be sent to Renderer/MCP.
 */
export function resolveActivityCanonicalLocalPath(value, roots = {}) {
  const ref = normalizeCanonicalRef(value);
  if (!ref || !ref.storage_root_id || !ref.relative_path) return { status: "missing", ref };
  const root = roots instanceof Map ? roots.get(ref.storage_root_id) : roots[ref.storage_root_id];
  const rootPath = typeof root === "string" ? root : root?.path;
  if (!rootPath) return { status: "missing", ref };
  try {
    const resolvedRoot = fs.realpathSync(path.resolve(rootPath));
    const candidate = path.resolve(resolvedRoot, ref.relative_path);
    const resolvedCandidate = fs.realpathSync(candidate);
    const boundary = `${resolvedRoot}${path.sep}`;
    if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(boundary)) {
      return { status: "outside_root", ref };
    }
    return { status: "ok", ref, path: resolvedCandidate };
  } catch {
    return { status: "missing", ref };
  }
}
