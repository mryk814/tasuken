import { z } from "zod";
import {
  mobileCaptureOrganizationTimedBatchSchema,
  mobileCaptureOrganizationTimedSchema,
} from "./contracts/mobile/public.ts";
import { isoTimestampSchema } from "./kernel/public.ts";

export const savedCaptureOrganizationBatchSchema = mobileCaptureOrganizationTimedBatchSchema.extend(
  {
    tasks: z.array(mobileCaptureOrganizationTimedSchema).max(8),
  },
);
export const savedCaptureOrganizationRequestSchema = z.strictObject({
  captureId: z.string().min(1).max(200),
  captureVersion: z.number().int().min(1),
  timeZone: z
    .string()
    .min(1)
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value }).format();
        return true;
      } catch {
        return false;
      }
    }),
});
export const savedCaptureOrganizationSubmissionSchema =
  mobileCaptureOrganizationTimedBatchSchema.extend({
    captureId: z.string().min(1).max(200),
    captureVersion: z.number().int().min(1),
    submissionId: z.uuid(),
    issuedAt: isoTimestampSchema,
  });
export interface SavedCaptureOrganizationSource {
  id: string;
  version: number;
  text: string;
  capturedAt: string;
  timeZone: string;
  themeId: string | null;
  canOrganize: boolean;
}
