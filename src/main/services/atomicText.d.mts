export function writeAtomicTextFile(
  filePath: string,
  content: string,
  operationId: string,
  fileSystem?: {
    mkdirSync(path: string, options?: { recursive: boolean }): void;
    writeFileSync(path: string, data: string, encoding?: "utf8"): void;
    openSync(path: string, flags: string): number;
    fsyncSync(handle: number): void;
    closeSync(handle: number): void;
    renameSync(oldPath: string, newPath: string): void;
    existsSync(path: string): boolean;
    unlinkSync(path: string): void;
  },
): string | null;
