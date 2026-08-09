import { existsSync } from "node:fs";
import path from "node:path";

import { runElectronSmoke } from "./run-electron-smoke.mjs";

const cwd = process.cwd();
const executablePath = path.resolve(process.argv[2] || path.join(cwd, "release", "win-unpacked", "Tasken.exe"));
if (!existsSync(executablePath)) throw new Error(`packaged Tasken executableが見つかりません: ${executablePath}`);
runElectronSmoke({ cwd, executablePath, packaged: true });
