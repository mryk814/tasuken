import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const releaseDirectory = path.join(root, "release");
const files = [
  `Tasken-Setup-${packageJson.version}-x64.exe`,
  `Tasken-Portable-${packageJson.version}-x64.exe`,
];

const lines = [];
for (const file of files) {
  const bytes = await readFile(path.join(releaseDirectory, file));
  const digest = createHash("sha256").update(bytes).digest("hex");
  lines.push(`${digest} *${file}`);
}

const outputPath = path.join(releaseDirectory, "SHA256SUMS.txt");
await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
console.log(`Release checksums: ${outputPath}`);
