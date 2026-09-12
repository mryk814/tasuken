#!/usr/bin/env bash
# Tasken headless replica を Synology へ配置する（NAS上で root として実行）。
#
# 使い方（NAS上）:
#   sudo bash /volume1/tasken/_deploy/nas-install.sh
#
# 前提:
#   - /volume1/tasken/_deploy/ に tasken-source.tar と tasken-headless-linux-amd64.tar
#   - /volume1/tasken/sync がデータ端末と共有済み（tasken-sync.json がある）
#   - Container Manager 導入済み
#
# パスが違う場合は環境変数で上書きする:
#   sudo DEPLOY_SRC=/volume1/... SYNC_DIR=/volume1/... PROJECT_DIR=/volume1/... bash nas-install.sh
set -euo pipefail
umask 077

DEPLOY_SRC="${DEPLOY_SRC:-/volume1/tasken/_deploy}"
SYNC_DIR="${SYNC_DIR:-/volume1/tasken/sync}"
PROJECT_DIR="${PROJECT_DIR:-/volume1/docker/tasken}"
IMAGE_TAR="${IMAGE_TAR:-$DEPLOY_SRC/tasken-headless-linux-amd64.tar}"
SOURCE_TAR="${SOURCE_TAR:-$DEPLOY_SRC/tasken-source.tar}"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

[[ "$(id -u)" == 0 ]] || fail "rootで実行してください: sudo bash $0"
[[ -f "$IMAGE_TAR" ]] || fail "image tarがありません: $IMAGE_TAR"
[[ -f "$SOURCE_TAR" ]] || fail "source tarがありません: $SOURCE_TAR"
[[ -f "$SYNC_DIR/tasken-sync.json" ]] || fail "共有フォルダが未初期化です（tasken-sync.jsonなし）: $SYNC_DIR"

DOCKER="$(command -v docker || true)"
[[ -n "$DOCKER" ]] || DOCKER="/var/packages/ContainerManager/target/usr/bin/docker"
DC="$(command -v docker-compose || true)"
[[ -n "$DC" ]] || DC="/var/packages/ContainerManager/target/usr/bin/docker-compose"
[[ -x "$DOCKER" ]] || fail "dockerが見つかりません"
[[ -x "$DC" ]] || fail "docker-composeが見つかりません"

uid_gid="$(stat -c '%u:%g' "$SYNC_DIR")"
uid="${uid_gid%%:*}"
gid="${uid_gid##*:}"
admin_gid="${TASKEN_ADMIN_GID:-$(getent group administrators 2>/dev/null | cut -d: -f3 || true)}"
[[ -n "$admin_gid" ]] || admin_gid=101

printf '== project=%s\n== sync=%s\n== uid:gid=%s\n== admin_gid=%s\n' \
  "$PROJECT_DIR" "$SYNC_DIR" "$uid_gid" "$admin_gid"

mkdir -p "$PROJECT_DIR"
tar -xf "$SOURCE_TAR" -C "$PROJECT_DIR"
"$DOCKER" load -i "$IMAGE_TAR"

deploy="$PROJECT_DIR/deploy/synology"
[[ -f "$deploy/docker-compose.yml" ]] || fail "composeが見つかりません: $deploy"

# 既存の.envを尊重する（特にCONTROL_PLANE_TUNNEL_IDを消さない）。
existing_tunnel_id=""
if [[ -f "$deploy/.env" ]]; then
  existing_tunnel_id="$(sed -n 's/^CONTROL_PLANE_TUNNEL_ID=//p' "$deploy/.env" | tail -1)"
fi
tunnel_id="${CONTROL_PLANE_TUNNEL_ID:-$existing_tunnel_id}"

printf 'TASKEN_UID=%s\nTASKEN_GID=%s\nTASKEN_ADMIN_GID=%s\nTASKEN_SYNC_DIR=%s\nCONTROL_PLANE_TUNNEL_ID=%s\n' \
  "$uid" "$gid" "$admin_gid" "$SYNC_DIR" "$tunnel_id" >"$deploy/.env"
mkdir -p "$deploy/state" "$deploy/secrets"
chmod 700 "$deploy/secrets"
chown -R "$uid:$gid" "$deploy/state" "$SYNC_DIR" "$deploy/secrets"
# .envもコンテナ実行uidが読み書きできるようにする（root所有のままだと編集にsudoが要る）。
chown "$uid:$gid" "$deploy/.env"
chmod 600 "$deploy/.env"

printf '== write probe\n'
"$DOCKER" run --rm --read-only --cap-drop ALL --security-opt no-new-privileges \
  --user "$uid:$gid" --group-add "$admin_gid" --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  -v "$deploy/state:/data" -v "$SYNC_DIR:/sync" \
  --entrypoint node tasken-headless:local -e \
  "const fs=require('node:fs');for(const p of ['/data/.write-probe','/sync/.write-probe']){fs.writeFileSync(p,'ok');fs.unlinkSync(p)};console.log('WRITE_OK')"

printf '== up\n'
# 旧プロジェクト（synology）で作られた同名コンテナが残っていても作り直せるようにする。
# nemorium等の別コンテナには触らない。tunnelはCoreのnetwork namespaceに依存するため先に外す。
"$DOCKER" rm -f tasken-tunnel >/dev/null 2>&1 || true
"$DOCKER" rm -f tasken-headless >/dev/null 2>&1 || true
"$DC" --env-file "$deploy/.env" -f "$deploy/docker-compose.yml" up -d --no-build
sleep 3
"$DC" --env-file "$deploy/.env" -f "$deploy/docker-compose.yml" logs --tail=50 tasken-headless || true

if [[ -n "$tunnel_id" && -s "$deploy/secrets/control_plane_api_key" ]]; then
  printf '== tunnel up\n'
  "$DC" --env-file "$deploy/.env" \
    -f "$deploy/docker-compose.yml" -f "$deploy/docker-compose.tunnel.yml" up -d --no-build
  sleep 3
  "$DC" --env-file "$deploy/.env" \
    -f "$deploy/docker-compose.yml" -f "$deploy/docker-compose.tunnel.yml" logs --tail=30 tasken-tunnel || true
else
  printf '== tunnel未起動（CONTROL_PLANE_TUNNEL_IDまたはsecrets/control_plane_api_keyが未設定）\n'
  printf '   .envにCONTROL_PLANE_TUNNEL_IDを設定し、secrets/control_plane_api_keyへRuntime API keyを保存して再実行\n'
fi
printf '== done. 期待ログ: TASKEN_HEADLESS_CORE_READY ... "sync_directory":"/sync"\n'
