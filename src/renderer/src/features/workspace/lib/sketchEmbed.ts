import type { Sketch } from "../types";
import type { SketchDocument, SketchPage } from "./sketch";

export const SKETCH_EMBED_SCHEME = "tasken-sketch:";
export const ACTIVE_SKETCH_ID_KEY = "tasken:sketch:active-id";
export const ACTIVE_SKETCH_PAGE_KEY = "tasken:sketch:active-page-id";

export type SketchEmbedRef = {
  sketchId: string;
  pageId: string;
  key: string;
};

export type SketchEmbedPreview = SketchEmbedRef & {
  title: string;
  dataUrl?: string;
  missing?: boolean;
};

export function sketchEmbedKey(sketchId: string, pageId: string): string {
  return `${sketchId}/${pageId}`;
}

export function sketchEmbedUrl(sketchId: string, pageId: string): string {
  return `${SKETCH_EMBED_SCHEME}${sketchEmbedKey(sketchId, pageId)}`;
}

export function parseSketchEmbedUrl(value: string): SketchEmbedRef | null {
  const match = value.trim().match(/^tasken-sketch:([^/?#]+)\/([^/?#]+)$/i);
  if (!match) return null;
  try {
    const sketchId = decodeURIComponent(match[1]);
    const pageId = decodeURIComponent(match[2]);
    return { sketchId, pageId, key: sketchEmbedKey(sketchId, pageId) };
  } catch {
    return null;
  }
}

export function sketchEmbedMarkdown(sketch: Pick<Sketch, "id" | "title">, page: Pick<SketchPage, "id">): string {
  const title = (sketch.title.trim() || "無題のSketch").replace(/[\r\n\[\]]+/g, " ");
  return `![Sketch: ${title}](${sketchEmbedUrl(sketch.id, page.id)})`;
}

export function extractSketchEmbedRefs(markdown: string): SketchEmbedRef[] {
  const refs = new Map<string, SketchEmbedRef>();
  for (const match of markdown.matchAll(/tasken-sketch:[^)\s]+/gi)) {
    const ref = parseSketchEmbedUrl(match[0]);
    if (ref) refs.set(ref.key, ref);
  }
  return [...refs.values()];
}

export function findSketchPage(document: SketchDocument, pageId: string): SketchPage | null {
  return document.pages.find((page) => page.id === pageId) || null;
}
