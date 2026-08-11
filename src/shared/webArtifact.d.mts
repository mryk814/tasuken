export const WEB_ARTIFACT_EXECUTION_POLICIES: readonly ["static", "sandboxed_interactive"];
export const WEB_ARTIFACT_KIND: "self_contained_html";

export type WebArtifactExecutionPolicy = "static" | "sandboxed_interactive";

export function isWebArtifact(input: unknown): boolean;
export function normalizeWebArtifactExecutionPolicy(value: unknown): WebArtifactExecutionPolicy;
export function sanitizeWebArtifactHtml(value: string, policy?: WebArtifactExecutionPolicy): string;
export function webArtifactCsp(policy?: WebArtifactExecutionPolicy): string;
export function buildWebArtifactDocument(value: string, policy?: WebArtifactExecutionPolicy): string;
