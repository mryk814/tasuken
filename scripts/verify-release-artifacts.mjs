import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { readFile } from "node:fs/promises";

const root = process.cwd();
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const releaseDirectory = path.join(root, "release");
const expectedFiles = [
  `Tasken-Setup-${packageJson.version}-x64.exe`,
  `Tasken-Portable-${packageJson.version}-x64.exe`,
];

const missing = expectedFiles.filter((file) => {
  const filePath = path.join(releaseDirectory, file);
  return !existsSync(filePath) || statSync(filePath).size === 0;
});
const unpackedExecutable = path.join(releaseDirectory, "win-unpacked", "Tasken.exe");

if (missing.length > 0) {
  throw new Error(`Windows配布物がありません: ${missing.join(", ")}`);
}
if (!existsSync(unpackedExecutable) || statSync(unpackedExecutable).size === 0) {
  throw new Error(`packaged smoke用の実行ファイルがありません: ${unpackedExecutable}`);
}

console.log(`Windows release artifacts: ${expectedFiles.join(", ")}`);
console.log(`Packaged executable: ${unpackedExecutable}`);
