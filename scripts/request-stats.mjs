#!/usr/bin/env node
import { parseArgs } from "node:util";

import { TaskenCoreClient } from "../src/main/mcp/taskenCoreClient.mjs";

// 入口ごとの計測（#733）をCoreから読んでJSONで出す。discoveryの場所はTaskenCoreClientの既定（環境変数）に従う。
const { values } = parseArgs({ options: { days: { type: "string", default: "7" } } });
const days = /^[0-9]{1,3}$/.test(values.days) ? Number(values.days) : 0;
if (days < 1 || days > 366) {
  console.error("--days は1〜366の整数で指定してください。");
  process.exit(2);
}
try {
  process.stdout.write(`${JSON.stringify(await new TaskenCoreClient().getStats(days), null, 2)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "計測を読めませんでした。");
  process.exit(1);
}
