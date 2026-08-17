import * as z from "zod/v4";

/**
 * Existing Tasuken data contains IDs created across several schema generations.
 * The shared kernel therefore owns opacity and boundedness, not one UUID format.
 */
export const entityIdSchema = z.string().trim().min(1).max(200).brand<"EntityId">();

export type EntityId = z.output<typeof entityIdSchema>;

