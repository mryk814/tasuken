#!/usr/bin/env bash
# Tasken headless replica の state snapshot（read-only replica用）
#
# NAS上でDocker権限を持って、ownerが承認した保守窓で実行する。
#   sudo bash deploy/synology/backup.sh
#
# 目的: 稼働中replicaの /data（SQLite・discovery・同期cursor）を停止中にarchive化し、
#       checksum・展開・隔離したread-only SQLite整合性まで検証して再起動する。
# 注意: これはreplicaの復旧用であり、正本のwriter権限を移すものではない。
#       復元したstateを別nodeとして同時起動しない（二重writerにしない）。
set -euo pipefail
umask 077
export PATH="/usr/local/bin:/var/packages/ContainerManager/target/usr/bin:$PATH"
cd "$(dirname "${BASH_SOURCE[0]}")"
deploy=$(pwd -P)

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

compose() {
  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    docker compose "$@"
  fi
}

[[ -d backup ]] || mkdir -p backup/snapshots
lock="$deploy/backup/.snapshot-lock"
mkdir "$lock" 2>/dev/null || fail "Another snapshot may be in progress. Inspect the lock before removing it."
restart_needed=no
bundle=
container="${TASKEN_CONTAINER:-$(compose ps -q tasken-headless)}"

wait_healthy() {
  for _ in {1..12}; do
    if docker exec "$container" node -e \
      'const fs=require("fs");const d=JSON.parse(fs.readFileSync("/data/tasken-core.json","utf8"));fetch(d.origin+"/health",{headers:{authorization:"Bearer "+d.token},signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' \
      >/dev/null 2>&1; then return 0; fi
    sleep 5
  done
  return 1
}

restart_original() {
  restart_needed=no
  docker start "$container" >>"$bundle/restart.log" 2>&1 && wait_healthy
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ "$restart_needed" == yes ]]; then
    if ! restart_original; then
      printf '%s\n' "The replica did not become healthy after restart. Inspect the NAS." >&2
      status=1
    fi
  fi
  rmdir "$lock" || status=1
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

[[ -n "$container" && "$container" != *[[:space:]]* ]] || fail "Expected exactly one tasken-headless container."
[[ "$(docker inspect --format '{{.State.Running}}' "$container")" == true ]] \
  || fail "The container is not running; this operation will not start a previously stopped service."
image=$(docker inspect --format '{{.Image}}' "$container")
run_user=$(docker inspect --format '{{.Config.User}}' "$container")
[[ "$run_user" =~ ^[0-9]+:[0-9]+$ ]] || fail "The container must have an explicit numeric UID:GID (compose user:)."
state=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$container")
[[ -d "$state" && -f "$state/research-desk.sqlite" ]] || fail "The running container's /data state is unavailable."

mkdir -p backup/snapshots
state_kb=$(du -sk "$state" | awk '{print $1}')
free_kb=$(df -Pk backup/snapshots | awk 'NR == 2 {print $4}')
[[ "$state_kb" =~ ^[0-9]+$ && "$free_kb" =~ ^[0-9]+$ ]] || fail "Could not determine snapshot capacity."
(( free_kb >= state_kb * 3 + 262144 )) || fail "Insufficient space for the archive, isolated restore, and margin."

bundle=$(mktemp -d "$deploy/backup/snapshots/nas-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
mkdir "$bundle/restored-state"
printf '%s\n' "$image" >"$bundle/image-id"

# Arm recovery before stop: even a partial stop must attempt to resume.
restart_needed=yes
docker stop --time 20 "$container" >"$bundle/stop.log" 2>&1
[[ "$(docker inspect --format '{{.State.Running}}' "$container")" == false ]] || fail "The replica did not stop."

# Capture stopped state without opening its database.
tar -C "$state" -czf "$bundle/state.tar.gz" .
chmod 600 "$bundle/state.tar.gz"
(cd "$bundle" && sha256sum state.tar.gz >SHA256SUMS)

# Resume the same container/image before the potentially longer restore check.
restart_original || fail "Restart did not become healthy; snapshot is not marked verified."
(cd "$bundle" && sha256sum -c SHA256SUMS) >"$bundle/checksums.log"
tar -xzf "$bundle/state.tar.gz" -C "$bundle/restored-state"
chown -R "$run_user" "$bundle/restored-state"

# Isolated verifier: never mount live state. Only the disposable copy is writable
# so SQLite can create WAL/SHM sidecars; the database itself is opened readonly.
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --user "$run_user" \
  --mount "type=bind,src=$bundle/restored-state,dst=/restore" \
  --entrypoint node "$image" -e '
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const Database = require("better-sqlite3");
const digest = (p) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const dbPath = "/restore/research-desk.sqlite";
const before = digest(dbPath);
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  assert.deepEqual(db.pragma("integrity_check"), [{ integrity_check: "ok" }]);
  const row = db.prepare("SELECT value FROM workspace_meta WHERE key = ?").get("workspace_id");
  assert.ok(row && typeof row.value === "string" && row.value.length > 0, "workspace_id is missing");
} finally { db.close(); }
assert.equal(digest(dbPath), before, "Restored database changed during read-only verification");
' >"$bundle/restore-check.log" 2>&1
printf '%s\n' "Archive checksums, extraction and isolated database integrity passed." >"$bundle/VERIFIED"
printf 'Snapshot verified; replica is healthy. Private bundle: %s\n' "$bundle"
