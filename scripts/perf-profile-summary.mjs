// .cpuprofile の自己時間と、関数を含む時間（inclusive）の上位を出す。
//   npm run bench:profile-summary -- <file.cpuprofile> [--top 25]
import fs from "node:fs";

const file = process.argv[2];
const topIndex = process.argv.indexOf("--top");
const top = topIndex >= 0 ? Number(process.argv[topIndex + 1]) || 25 : 25;
const profile = JSON.parse(fs.readFileSync(file, "utf8"));
const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const parent = new Map();
for (const node of profile.nodes)
  for (const child of node.children || []) parent.set(child, node.id);

const interval = new Map();
for (let index = 0; index < profile.samples.length; index += 1) {
  const delta = (profile.timeDeltas[index + 1] ?? profile.timeDeltas[index] ?? 0) / 1000;
  interval.set(profile.samples[index], (interval.get(profile.samples[index]) || 0) + delta);
}

const label = (node) => {
  const frame = node.callFrame;
  const url = (frame.url || "").replace(/^.*[\\/](src|out|node_modules)[\\/]/, "$1/");
  return `${frame.functionName || "(anonymous)"} ${url}:${frame.lineNumber + 1}`;
};

const self = new Map();
const inclusive = new Map();
for (const [id, ms] of interval) {
  const node = nodes.get(id);
  const key = label(node);
  self.set(key, (self.get(key) || 0) + ms);
  const seen = new Set();
  for (let current = id; current !== undefined; current = parent.get(current)) {
    const currentKey = label(nodes.get(current));
    if (seen.has(currentKey)) continue;
    seen.add(currentKey);
    inclusive.set(currentKey, (inclusive.get(currentKey) || 0) + ms);
  }
}

const print = (title, map) => {
  console.log(`--- ${title}`);
  for (const [key, ms] of [...map].sort((a, b) => b[1] - a[1]).slice(0, top)) {
    console.log(`${ms.toFixed(0).padStart(8)}ms  ${key}`);
  }
};
print("self", self);
print("inclusive", inclusive);
