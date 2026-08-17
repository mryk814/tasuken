import * as z from "zod/v4";

export const contractPathSegmentSchema = z.union([z.string(), z.number().int()]);

export const contractIssueSchema = z.object({
  code: z.string().trim().min(1),
  message: z.string().trim().min(1),
  path: z.array(contractPathSegmentSchema),
}).strict();

export const appErrorSchema = z.object({
  code: z.string().trim().min(1),
  message: z.string().trim().min(1),
  issues: z.array(contractIssueSchema).default([]),
  retryable: z.boolean().default(false),
  details: z.record(z.string(), z.unknown()).optional(),
}).strict();

export type ContractIssue = z.output<typeof contractIssueSchema>;
export type AppError = z.output<typeof appErrorSchema>;

export function zodIssues(error: z.ZodError): ContractIssue[] {
  const issues: ContractIssue[] = [];
  for (const issue of error.issues) {
    const path = issue.path.map((segment) => typeof segment === "number" ? segment : String(segment));
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) issues.push({ code: issue.code, message: issue.message, path: [...path, key] });
    } else {
      issues.push({ code: issue.code, message: issue.message, path });
    }
  }
  return issues;
}
