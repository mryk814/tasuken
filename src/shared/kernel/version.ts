import * as z from "zod/v4";

export const entityVersionSchema = z.number().int().nonnegative();
export const schemaVersionSchema = z.number().int().positive();

export type EntityVersion = z.output<typeof entityVersionSchema>;
export type SchemaVersion = z.output<typeof schemaVersionSchema>;

