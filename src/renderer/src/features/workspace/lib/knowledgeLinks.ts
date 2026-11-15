import { parseExplicitLinks } from "../../../../../shared/contextLinks.mjs";

export interface WikiLink {
  raw: string;
  target: string;
  alias: string;
}

export const parseWikiLinks = parseExplicitLinks;
