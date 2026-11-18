export function validateSafeSvg(value: unknown): string;
export function validateArtifactProposal(value: unknown): {
  title: string;
  fileName: string;
  mediaType: string;
  content: string;
};
export function findTaskenUploadAssetReferences(content: unknown): string[];
export function hasTaskenUploadAssetReference(content: unknown): boolean;
