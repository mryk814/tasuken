import { app, protocol } from "electron";
import fs from "node:fs";
import path from "node:path";

export const ATTACHMENT_PROTOCOL = "tasken-attachment";

export function registerAttachmentScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ATTACHMENT_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
}

function markdownAttachmentDirectory(): string {
  return path.join(app.getPath("userData"), "attachments", "markdown-images");
}

function attachmentMimeType(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".bmp") return "image/bmp";
  return "image/png";
}

export function registerAttachmentProtocol(): void {
  protocol.handle(ATTACHMENT_PROTOCOL, (request) => {
    try {
      const parsed = new URL(request.url);
      if (parsed.hostname !== "local") return new Response("Not found", { status: 404 });
      const fileName = decodeURIComponent(parsed.pathname.split("/").filter(Boolean)[0] || "");
      if (!/^[a-f0-9-]+\.(png|jpg|gif|webp|bmp)$/i.test(fileName)) {
        return new Response("Not found", { status: 404 });
      }
      const root = path.resolve(markdownAttachmentDirectory());
      const filePath = path.resolve(root, fileName);
      if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath)) {
        return new Response("Not found", { status: 404 });
      }
      const bytes = fs.readFileSync(filePath);
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          "content-type": attachmentMimeType(fileName),
          "cache-control": "no-store",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}
