import {
  issueCoreClientToken,
  listCoreClients,
  revokeCoreClientToken,
} from "../src/main/infrastructure/http/coreClientTokens.mjs";
import { resolveTaskenUserDataPath } from "../src/shared/taskenPaths.mjs";

/**
 * Manages read-only Tasken Core client tokens.
 *
 *   node scripts/tasken-core-client.mjs issue <name>   # token on stdout only, shown once
 *   node scripts/tasken-core-client.mjs list
 *   node scripts/tasken-core-client.mjs revoke <name>
 *
 * Pipe `issue` straight into the client's secret file. TASKEN_USER_DATA_DIR
 * selects a non-default profile.
 */
const usage = "Usage: node scripts/tasken-core-client.mjs issue <name> | list | revoke <name>";

try {
  const [command, name, ...extra] = process.argv.slice(2);
  const userDataPath = resolveTaskenUserDataPath();
  if (extra.length > 0) throw new Error(usage);
  if (command === "issue" && name) {
    const { token } = await issueCoreClientToken(userDataPath, name);
    process.stdout.write(token);
    process.stderr.write(
      `Issued read-only client "${name}". Store it only in that client's secret file.\n`,
    );
  } else if (command === "revoke" && name) {
    await revokeCoreClientToken(userDataPath, name);
    process.stderr.write(`Revoked client "${name}".\n`);
  } else if (command === "list" && !name) {
    for (const client of await listCoreClients(userDataPath)) {
      const state = client.revoked_at ? `revoked ${client.revoked_at}` : "active";
      process.stdout.write(`${client.name}\t${client.scope}\t${client.created_at}\t${state}\n`);
    }
  } else {
    throw new Error(usage);
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Client token management failed."}\n`,
  );
  process.exitCode = 1;
}
