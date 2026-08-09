export interface LatestRequestGate {
  next(): number;
  isCurrent(requestId: number): boolean;
  invalidate(): void;
}
export function createLatestRequestGate(): LatestRequestGate;
