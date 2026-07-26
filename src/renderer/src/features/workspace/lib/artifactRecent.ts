const RECENT_KEY = "artifacts:recent-opened";
const RECENT_LIMIT = 40;

export function readRecentArtifactIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function markArtifactOpened(id: string): void {
  const next = [id, ...readRecentArtifactIds().filter((entry) => entry !== id)].slice(0, RECENT_LIMIT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // localStorage が使えない環境では最近開いた順を諦める。
  }
}
