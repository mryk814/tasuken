import * as z from "zod/v4";

export const isoTimestampSchema = z.iso.datetime({ offset: true });
export const localDateSchema = z.iso.date();

export type IsoTimestamp = z.output<typeof isoTimestampSchema>;
export type LocalDate = z.output<typeof localDateSchema>;

