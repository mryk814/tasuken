#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { TaskenCoreClient } from "../mcp/taskenCoreClient.mjs";
import { resolveTaskenUserDataPath } from "../../shared/taskenPaths.mjs";

const HELP = `NASのMobile Gatewayに、端末（Android）をペアリングする。稼働中のCore（--mobile-gateway）が要る。

Usage（NASでは docker exec tasken-headless <下の行>）:
  node core-dist/mobile-pair.mjs [pair]            8桁のペアリングコードを発行する（5分間有効）
  node core-dist/mobile-pair.mjs list              ペア済みの端末を一覧する
  node core-dist/mobile-pair.mjs revoke <deviceId>  端末の接続を取り消す

Options:
  --user-data-dir  CoreのuserData。省略時はTASKEN_USER_DATA_DIR（NASのimageでは/data）。
  -h, --help       このhelpを表示する。

コードはAndroidの「接続」画面に入力する。tokenは出力しない。`;

interface PairedDevice {
  id: string;
  label: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string;
}

export interface MobilePairCliIo {
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
  env?: NodeJS.ProcessEnv;
}

/** 戻り値は終了コード。0は成功、78は設定や接続の失敗（headless.mjsと同じ）。 */
export async function runMobilePairCli(argv: string[], io: MobilePairCliIo): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      options: { "user-data-dir": { type: "string" }, help: { type: "boolean", short: "h" } },
      allowPositionals: true,
    });
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : "引数が不正です。"}\n`);
    return 78;
  }
  if (parsed.values.help) {
    io.stdout.write(`${HELP}\n`);
    return 0;
  }
  const [command = "pair", target] = parsed.positionals;
  const userDataOption = parsed.values["user-data-dir"];
  const userDataPath = path.resolve(
    typeof userDataOption === "string" && userDataOption.trim()
      ? userDataOption
      : resolveTaskenUserDataPath({ env: io.env || process.env }),
  );
  const client = new TaskenCoreClient({ userDataPath });
  try {
    if (command === "pair") {
      const ticket = (await client.admin("mobile/pairing")) as { code: string; expiresAt: string };
      io.stdout.write(
        `ペアリングコード: ${ticket.code}\n有効期限: ${ticket.expiresAt}（5分間、1回だけ使えます）\n`,
      );
      return 0;
    }
    if (command === "list") {
      const { devices } = (await client.admin("mobile/devices")) as { devices: PairedDevice[] };
      if (!devices.length) io.stdout.write("ペア済みの端末はありません。\n");
      for (const device of devices) {
        io.stdout.write(
          [
            device.id,
            device.label,
            `paired=${device.createdAt}`,
            `last_seen=${device.lastSeenAt || "-"}`,
            device.revokedAt ? `revoked=${device.revokedAt}` : "active",
          ].join("\t") + "\n",
        );
      }
      return 0;
    }
    if (command === "revoke") {
      if (!target?.trim()) {
        io.stderr.write("取り消す端末のdeviceIdを指定してください（list で確認できます）。\n");
        return 78;
      }
      const { device } = (await client.admin("mobile/revoke", { deviceId: target.trim() })) as {
        device: PairedDevice | null;
      };
      if (!device) {
        io.stderr.write("その端末は見つかりません。\n");
        return 78;
      }
      io.stdout.write(`取り消しました: ${device.id} ${device.label}\n`);
      return 0;
    }
    io.stderr.write(`不明なコマンドです: ${command}\n`);
    return 78;
  } catch (error) {
    io.stderr.write(
      `${error instanceof Error ? error.message : "Coreへ接続できませんでした。"}\n` +
        "Coreが--mobile-gatewayで起動しているか確認してください。\n",
    );
    return 78;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  void runMobilePairCli(process.argv.slice(2), process).then((code) => {
    process.exitCode = code;
  });
}
