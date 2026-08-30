import * as z from "zod/v4";

/**
 * Existing Tasuken data contains IDs created across several schema generations.
 * The shared kernel therefore owns opacity and boundedness, not one UUID format.
 */
export function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export const entityIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(isWellFormedUnicode, "IDはwell-formed Unicodeで指定してください。")
  .brand<"EntityId">();

export type EntityId = z.output<typeof entityIdSchema>;
