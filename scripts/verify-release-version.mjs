import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const expectedTag = `v${packageJson.version}`;
const tagName = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || process.argv[2] || "";

if (!tagName) {
  console.log(`Release version: package.json is ${packageJson.version}; expected tag is ${expectedTag}.`);
  process.exit(0);
}

if (tagName !== expectedTag) {
  console.error(`Release tag mismatch: package.json version is ${packageJson.version}, but tag is ${tagName}.`);
  console.error(`Use npm version <version> --no-git-tag-version, commit package files, then tag ${expectedTag}.`);
  process.exit(1);
}

console.log(`Release tag ${tagName} matches package.json version ${packageJson.version}.`);
