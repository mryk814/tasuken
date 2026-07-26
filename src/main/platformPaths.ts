import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export function getAppIconPath(): string {
  return path.join(__dirname, "../../resources/icon.ico");
}

export function migrateLegacyUserDataIfNeeded(): void {
  const currentDbPath = path.join(app.getPath("userData"), "research-desk.sqlite");
  if (fs.existsSync(currentDbPath)) return;

  const legacyDbPath = path.join(app.getPath("appData"), "Research Desk", "research-desk.sqlite");
  if (!fs.existsSync(legacyDbPath)) return;

  fs.mkdirSync(path.dirname(currentDbPath), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    const legacyPath = `${legacyDbPath}${suffix}`;
    if (fs.existsSync(legacyPath)) {
      fs.copyFileSync(legacyPath, `${currentDbPath}${suffix}`);
    }
  }
}
