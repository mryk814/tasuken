export function writeAtomicTextFile(
  filePath: string,
  content: string,
  operationId: string,
  fileSystem?: {
    mkdirSync(path: string, options?: unknown): void;
    writeFileSync(path: string, data: string, encoding?: string): void;
    openSync(path: string, flags: string): number;
    fsyncSync(handle: number): void;
    closeSync(handle: number): void;
    renameSync(oldPath: string, newPath: string): void;
    existsSync(path: string): boolean;
    unlinkSync(path: string): void;
  },
): string | null;
