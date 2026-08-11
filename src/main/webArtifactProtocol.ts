import { protocol } from "electron";

import {
  buildWebArtifactDocument,
  normalizeWebArtifactExecutionPolicy,
  webArtifactCsp,
} from "../shared/webArtifact.mjs";
import type { WorkspaceService } from "./services/workspaceService";

export const WEB_ARTIFACT_PROTOCOL = "tasken-web";

export function registerWebArtifactScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: WEB_ARTIFACT_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  }]);
}

function parseWebArtifactRequest(requestUrl: string): { id: string; policy: "static" | "sandboxed_interactive" } | null {
  try {
    const parsed = new URL(requestUrl);
    if (
      parsed.protocol !== `${WEB_ARTIFACT_PROTOCOL}:`
      || parsed.hostname !== "preview"
      || parsed.username
      || parsed.password
      || parsed.hash
      || /%2f|%5c/i.test(parsed.pathname)
    ) return null;
    const match = parsed.pathname.match(/^\/([^/]+)$/);
    if (!match) return null;
    const id = decodeURIComponent(match[1]);
    if (!id.trim()) return null;
    return { id, policy: normalizeWebArtifactExecutionPolicy(parsed.searchParams.get("policy")) };
  } catch {
    return null;
  }
}

export function registerWebArtifactProtocol(workspaceService: WorkspaceService): void {
  protocol.handle(WEB_ARTIFACT_PROTOCOL, (request) => {
    try {
      if (request.method !== "GET") {
        return new Response(null, { status: 405, headers: { allow: "GET", "cache-control": "no-store" } });
      }
      const target = parseWebArtifactRequest(request.url);
      if (!target) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
      const result = workspaceService.readWebArtifactPreviewDocument(target.id, target.policy);
      if (!result.ok) {
        return new Response(result.error, {
          status: 404,
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        });
      }
      const document = buildWebArtifactDocument(result.html, result.executionPolicy);
      return new Response(document, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": webArtifactCsp(result.executionPolicy),
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
    }
  });
}
