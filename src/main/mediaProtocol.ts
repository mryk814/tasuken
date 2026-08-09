import fs from "node:fs";
import { Readable } from "node:stream";
import { protocol } from "electron";

import type { MediaCaptureService, MediaFileResolution } from "./services/mediaCaptureService";

export const MEDIA_PROTOCOL = "tasken-media";

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: MEDIA_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  }]);
}

type ByteRange = { start: number; end: number };

export function parseMediaRange(value: string | null, fileSize: number): ByteRange | null | "invalid" {
  if (!value) return null;
  const match = value.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2]) || fileSize <= 0) return "invalid";
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) return "invalid";
    return { start: Math.max(0, fileSize - suffix), end: fileSize - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : fileSize - 1;
  if (!Number.isInteger(start) || !Number.isInteger(requestedEnd) || start < 0 || start >= fileSize || requestedEnd < start) return "invalid";
  return { start, end: Math.min(requestedEnd, fileSize - 1) };
}

function unavailableResponse(result: MediaFileResolution): Response {
  const status = result.availability === "missing" ? 404
    : result.availability === "unsupported_codec" ? 415
      : 409;
  return new Response(null, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-tasken-media-availability": result.availability,
      "content-length": "0",
    },
  });
}

function closeDescriptor(descriptor: number): void {
  try {
    fs.closeSync(descriptor);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code !== "EBADF") throw error;
  }
}

export function mediaResponse(request: Request, result: MediaFileResolution): Response {
  if (result.availability !== "available") {
    return unavailableResponse(result);
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    closeDescriptor(result.fileDescriptor);
    return new Response(null, {
      status: 405,
      headers: { allow: "GET, HEAD", "content-length": "0", "cache-control": "no-store" },
    });
  }
  const range = parseMediaRange(request.headers.get("range"), result.fileSize);
  if (range === "invalid") {
    closeDescriptor(result.fileDescriptor);
    return new Response(null, {
      status: 416,
      headers: {
        "accept-ranges": "bytes",
        "content-range": `bytes */${result.fileSize}`,
        "content-length": "0",
        "cache-control": "no-store",
      },
    });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? result.fileSize - 1;
  const length = Math.max(0, end - start + 1);
  const headers: Record<string, string> = {
    "accept-ranges": "bytes",
    "content-type": result.mimeType,
    "content-length": String(length),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
  if (range) headers["content-range"] = `bytes ${start}-${end}/${result.fileSize}`;
  if (request.method === "HEAD") {
    closeDescriptor(result.fileDescriptor);
    return new Response(null, { status: range ? 206 : 200, headers });
  }
  let stream: fs.ReadStream | null = null;
  try {
    // pathは再解決・再openしない。Serviceが検証した同一FDだけをRange streamへ渡す。
    stream = fs.createReadStream("", { fd: result.fileDescriptor, autoClose: true, start, end });
    stream.once("error", () => {
      if (stream && !stream.closed) stream.close();
    });
    return new Response(Readable.toWeb(stream) as unknown as BodyInit, { status: range ? 206 : 200, headers });
  } catch {
    if (stream) stream.destroy();
    else closeDescriptor(result.fileDescriptor);
    return new Response(null, { status: 500, headers: { "content-length": "0", "cache-control": "no-store" } });
  }
}

export function registerMediaProtocol(media: MediaCaptureService): void {
  protocol.handle(MEDIA_PROTOCOL, (request) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response(null, {
          status: 405,
          headers: { allow: "GET, HEAD", "content-length": "0", "cache-control": "no-store" },
        });
      }
      const parsed = new URL(request.url);
      const id = decodeURIComponent(parsed.pathname.split("/").filter(Boolean)[0] || "");
      const result = parsed.hostname === "session"
        ? media.resolveSessionMedia(id)
        : parsed.hostname === "artifact"
          ? media.resolveArtifactMedia(id)
          : { availability: "missing" as const };
      return mediaResponse(request, result);
    } catch {
      return new Response(null, { status: 404, headers: { "content-length": "0", "cache-control": "no-store" } });
    }
  });
}
