#!/bin/bash
# tasken-update-image.sh の場面の試験。偽の docker・docker-compose と、架空の SQLite・共有フォルダで
# 動かす。本物の docker・NAS・実データには触れない。root の Linux（コンテナ）で動かす:
#   docker run --rm -v "<repo>:/src:ro" alpine:3.20 sh -c \
#     'apk add -q bash coreutils rsync util-linux python3 findutils && cp -r /src/deploy/synology /w && bash /w/test/update-test.sh'
# （コンテナに写すのは、Windows から mount したファイルが root 所有に見えないため）
# 場面の作りは kokokana の deploy/synology/test/update-test.sh と同じ。偽の docker は、image の中の
# replica-check の答え（版ずれ・同期・MCP）を、場面ごとのファイルで返す。
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
script="$here/../tasken-update-image.sh"
fails=0
DEV=aaaaaaaa-1111-2222-3333-444444444444 # replica の端末 ID（架空）

mkdb() { # path entities outbox cursor
  python3 - "$@" << 'PY'
import sqlite3, sys
p, ent, out, cur = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
c = sqlite3.connect(p)
c.execute('create table workspace_meta(key text primary key, value text not null)')
c.execute('create table entities(entity_type text, id text, data_json text, deleted_at text)')
c.execute('create table sync_outbox(change_id text primary key, device_sequence integer, payload_json text, published_at text)')
c.execute('create table sync_device_cursors(device_id text primary key, last_sequence integer)')
c.executemany('insert into workspace_meta values (?,?)', [('schema_version', '7'), ('device_id', 'aaaaaaaa-1111-2222-3333-444444444444'), ('shared_sync_enabled', 'true'), ('shared_sync_last_error', '')])
c.executemany('insert into entities values (?,?,?,?)', [('task', str(i), '{}', None) for i in range(ent)])
c.executemany('insert into sync_outbox values (?,?,?,?)', [(str(i), i, '{}', 't') for i in range(out)])
if cur:
    c.execute('insert into sync_device_cursors values (?,?)', ('desktop', cur))
c.commit()
PY
}
set_meta() { # db key value
  python3 -c "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('update workspace_meta set value=? where key=?', (sys.argv[3], sys.argv[2])); c.commit()" "$1" "$2" "$3"
}
digest() { python3 -c "import hashlib,sys; print(hashlib.sha256(sys.argv[1].encode()).hexdigest()[:16])" "$1"; }

new_world() {
  W=$(mktemp -d)
  F="$W/fake"
  A="$W/base/tasken"
  D="$A/deploy"
  BK="$A/backups"
  VOL="$W/vol"
  DATA="$VOL/state"
  SYNC="$VOL/sync"
  mkdir -p "$F/images" "$F/bins" "$D/secrets" "$BK" "$DATA/attachments" "$SYNC/devices/$DEV" "$SYNC/devices/desktop"
  chmod 755 "$W" "$W/base" "$A" "$D" "$D/secrets"
  chmod 700 "$BK"
  mkdb "$DATA/research-desk.sqlite" 5 3 4
  echo "架空の添付" > "$DATA/attachments/a1"
  echo v1 > "$DATA/schema"
  echo '{}' > "$SYNC/devices/$DEV/000000000003-0000aaaa-0000.json"
  echo '{"架空":"秘密"}' > "$D/secrets/control_plane_api_key"
  echo '{"架空":"秘密"}' > "$D/secrets/mcp_http_clients"
  chmod 600 "$D/secrets/"*
  echo '{"name":"tasken"}' > "$D/docker-compose.json"
  printf 'TASKEN_IMAGE=sha256:old000000000\nTASKEN_UID=0\nTASKEN_GID=0\nTASKEN_ADMIN_GID=101\nTASKEN_DATA_DIR=%s\nTASKEN_SYNC_DIR=%s\nTASKEN_DEVICE_ID=%s\n' "$DATA" "$SYNC" "$DEV" > "$D/tasken.conf"
  chmod 644 "$D/tasken.conf" "$D/docker-compose.json"
  echo "sha256:old" > "$F/images/sha256:old000000000"
  echo "sha256:old000000000" > "$F/running"
  echo up > "$F/state" # 更新の前は、古い版が動いて応答している
  cp "$script" "$A/tasken-update-image.sh"
  chmod 755 "$A/tasken-update-image.sh"
  write_fakes
}

write_fakes() {
  cat > "$F/docker" << 'SH'
#!/bin/bash
F=$(dirname "$0")
W=$(dirname "$F")
img_in() { grep -qx "$(cat "$F/running")" "$F/$1" 2>/dev/null; } # 今動いている Core の image が、そのファイルに書いてあるか
data=$(sed -n 's/^TASKEN_DATA_DIR=//p' "$W/base/tasken/deploy/tasken.conf")
# 起動してすぐ落ちる Core（すぐ落ちる版、または DB の schema が新しくて開けない古い版）
core_dead() { img_in crashes || { img_in needs_v1 && [ "$(cat "$data/schema")" != v1 ]; }; }
image_of() { if [ "$1" = tasken-headless ]; then cat "$F/running"; else cat "$F/img_$1" 2>/dev/null || cat "$F/running"; fi; }
case "$1" in
  image) [ -f "$F/images/$5" ] && cat "$F/images/$5" || exit 1 ;;
  load) exit 0 ;;
  inspect)
    fmt=$3; name=$4
    [ "$(cat "$F/state")" = stopped ] && running=false || running=true
    [ "$name" = tasken-tunnel ] && [ -f "$F/tunnel_down" ] && running=false
    [ "$name" = tasken-headless ] && core_dead && running=false
    case "$fmt" in
      '{{.Config.Image}}') image_of "$name" ;;
      '{{.State.Running}}') echo "$running" ;;
      '{{.State.StartedAt}}') cat "$F/started" 2>/dev/null || echo 2026-11-07T00:00:00.123456789Z ;;
      '{{.RestartCount}}') cat "$F/restarts_$name" 2>/dev/null || echo 0 ;;
      *com.docker.compose.project*)
        svc=$name
        [ "$name" = tasken-tunnel ] && svc=tunnel-client
        [ "$name" = tasken-mcp-http ] && svc=mcp-http
        cat "$F/labels_$name" 2>/dev/null || echo "tasken/$svc" ;;
    esac ;;
  run)
    echo "$*" >> "$F/run_calls"
    shift
    ep=""; pos=()
    while [ $# -gt 0 ]; do
      case "$1" in
        --rm | --read-only) shift ;;
        --entrypoint) ep=$2; shift 2 ;;
        --network | --user | --group-add | --tmpfs | -v | --cap-drop | --security-opt) shift 2 ;;
        *) pos+=("$1"); shift ;;
      esac
    done
    image=${pos[0]}
    case "$ep" in
      sha256sum) echo "$(cat "$F/bins/$image" 2>/dev/null || echo none)  ${pos[1]}" ;;
      sh) [ ! -f "$F/probe_fails" ] ;; # 戻す写しへの書き込みの試し
      node)
        grep -qx "$image" "$F/nocheck" 2>/dev/null && { echo "Error: Cannot find module"; exit 1; }
        grep -qx "$image" "$F/badschema" 2>/dev/null && { echo 'TASKEN_REPLICA_CHECK {"schema_version":2,"check":"packets","compatible":true}'; exit 0; }
        if grep -qx "$image" "$F/skew" 2>/dev/null; then
          echo 'TASKEN_REPLICA_CHECK {"schema_version":1,"check":"packets","compatible":false,"manifest_ok":true,"checked":9,"devices":2,"rejected_total":1,"rejected":[{"device":"deskdesk","sequence":9,"entity_type":"future_kind","reason":"未知のEntity typeです"}]}'
          exit 3
        fi
        echo 'TASKEN_REPLICA_CHECK {"schema_version":1,"check":"packets","compatible":true,"manifest_ok":true,"checked":9,"devices":2,"rejected_total":0,"rejected":[]}' ;;
    esac ;;
  exec)
    shift
    c=$1; shift
    [ "$(cat "$F/state")" = up ] || exit 1
    [ "$c" = tasken-headless ] && core_dead && exit 1
    echo "$c $*" >> "$F/exec_calls"
    if [ "$2" = -e ]; then # health（Core・HTTP MCP・tunnel の readyz）
      img_in bad && exit 1
      [ "$c" = tasken-mcp-http ] && grep -qx "$(image_of tasken-mcp-http)" "$F/http_bad" 2>/dev/null && exit 1
      exit 0
    fi
    case "$3" in
      state)
        verdict=$(sed -n "s|^$(cat "$F/running") ||p" "$F/sync_verdict" 2>/dev/null | tail -1)
        verdict=${verdict:-synced}
        err=$(cat "$F/sync_digest" 2>/dev/null || true)
        echo "TASKEN_REPLICA_CHECK {\"schema_version\":1,\"check\":\"state\",\"verdict\":\"$verdict\",\"sync\":{\"behind\":0,\"last_error\":\"架空の失敗\",\"last_error_sha256\":\"$err\",\"pending_invalid\":{\"entity_type\":\"future_kind\"}}}"
        [ "$verdict" = synced ] || exit 3 ;;
      mcp)
        # 検査の間に、HTTP MCP（または tunnel）が落ちて docker に起こし直された
        if [ -f "$F/restart_after_up" ]; then echo 2 > "$F/restarts_$(cat "$F/restart_after_up")"; fi
        if img_in mcp_bad; then echo 'TASKEN_REPLICA_CHECK {"schema_version":1,"check":"mcp","ok":false,"reason":"架空"}'; exit 3; fi
        echo 'TASKEN_REPLICA_CHECK {"schema_version":1,"check":"mcp","ok":true,"tools":16}' ;;
    esac ;;
esac
SH
  cat > "$F/dc" << 'SH'
#!/bin/bash
F=$(dirname "$0")
W=$(dirname "$F")
D="$W/base/tasken/deploy"
args="$*"
while [ "${1:-}" != "" ] && [ "$1" != config ] && [ "$1" != stop ] && [ "$1" != up ]; do shift; done
case "${1:-}" in
  config)
    cat << JSON
{"name":"tasken","services":{
 "tasken-headless":{"container_name":"tasken-headless","image":"$TASKEN_IMAGE","volumes":[{"type":"bind","source":"$W/vol/state","target":"/data"}]},
 "tunnel-client":{"container_name":"tasken-tunnel","image":"$TASKEN_IMAGE","volumes":[{"type":"bind","source":"$D/secrets/control_plane_api_key","target":"/run/secrets/control_plane_api_key","read_only":true}]},
 "mcp-http":{"container_name":"tasken-mcp-http","image":"${TASKEN_IMAGE_MCP_HTTP:-$TASKEN_IMAGE}"}},
 "secrets":{"mcp_http_clients":{"file":"$D/secrets/mcp_http_clients"}}}
JSON
    ;;
  stop)
    echo "stop $args" >> "$F/calls"
    [ -f "$F/stop_noop" ] || echo stopped > "$F/state" ;;
  up)
    shift
    svcs=()
    for a in "$@"; do case "$a" in -* | never) ;; *) svcs+=("$a") ;; esac; done
    [ "${#svcs[@]}" -gt 0 ] || svcs=(tasken-headless tunnel-client mcp-http)
    echo "up $TASKEN_IMAGE ${svcs[*]} $args" >> "$F/calls"
    [ -f "$F/up_fails" ] && { echo "偽の compose の失敗" >&2; exit 1; }
    data=$(sed -n 's/^TASKEN_DATA_DIR=//p' "$D/tasken.conf")
    dependents=0
    for s in "${svcs[@]}"; do
      case "$s" in
        tasken-headless)
          echo "$TASKEN_IMAGE" > "$F/running"; echo up > "$F/state"
          if grep -qx "$TASKEN_IMAGE" "$F/migrates" 2>/dev/null; then
            echo v2 > "$data/schema"
            python3 -c "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('insert into entities values (\"n\",\"n\",\"{}\",null)'); c.commit()" "$data/research-desk.sqlite"
          fi
          # 試しの間に、新しい版が共有フォルダへ差分を出した
          if grep -qx "$TASKEN_IMAGE" "$F/publishes" 2>/dev/null; then
            echo '{}' > "$W/vol/sync/devices/aaaaaaaa-1111-2222-3333-444444444444/000000000004-0000bbbb-0000.json"
          fi ;;
        tunnel-client) echo "$TASKEN_IMAGE" > "$F/img_tasken-tunnel"; dependents=1 ;;
        mcp-http) echo "${TASKEN_IMAGE_MCP_HTTP:-$TASKEN_IMAGE}" > "$F/img_tasken-mcp-http"; dependents=1 ;;
      esac
    done
    rm -f "$F"/restarts_*
    # Core の network を使うサービスは、Core が動いていないと起こせない（compose ごと失敗する）
    if [ "$dependents" = 1 ] && "$F/docker" inspect --format '{{.State.Running}}' tasken-headless | grep -qx false; then
      echo "cannot join network of a non running container" >&2
      exit 1
    fi ;;
esac
SH
  chmod 755 "$F/docker" "$F/dc"
}

record() { # tag id [core_sha]
  printf 'source_sha=%s\nimage_tag=%s\nimage_id=%s\n' "$(printf '%s' "$1" | sha1sum | cut -c1-40)" "$1" "$2" > "$W/record.txt"
  [ -n "${3:-}" ] && printf 'core_sha256=%s\n' "$3" >> "$W/record.txt"
  echo "$2" > "$F/images/$1"
}

run_update() { # [extra args...]
  local args=(--record "$W/record.txt")
  [ $# -gt 0 ] && args=("$@")
  set +e
  out=$(DEPLOY_DIR="$D" BACKUP_DIR="$BK" DOCKER="$F/docker" DC="$F/dc" SLEEP=true \
    HEALTH_TRIES=3 SYNC_TRIES=2 "$A/tasken-update-image.sh" "${args[@]}" 2>&1)
  code=$?
  set -e
  last=$(printf '%s\n' "$out" | tail -1)
}

rows() { python3 -c "import sqlite3,sys; print(sqlite3.connect(sys.argv[1]).execute('select count(*) from entities').fetchone()[0])" "$1"; }
conf_image() { sed -n 's/^TASKEN_IMAGE=//p' "$D/tasken.conf"; }
gens() { ls -1d "$BK"/state.before-* 2>/dev/null | wc -l | tr -d ' '; }
expect() { # name 'condition'
  if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; printf '%s\n' "$out" | sed 's/^/     | /'; fails=$((fails + 1)); fi
}

# 1. 良い版に入れ替わり、前の世代は消え、今回の世代が一つ残る
new_world
mkdir -p "$BK/state.before-aaaaaaaaaaaa-20260101T000000"
mkdb "$BK/state.before-aaaaaaaaaaaa-20260101T000000/research-desk.sqlite" 5 3 4
record tasken:new111111111 sha256:new
run_update
expect "成功: HEALTH_OK・終了 0" '[ "$code" = 0 ] && [ "$last" = HEALTH_OK ]'
expect "成功: tasken.conf が新しい image を指す" '[ "$(conf_image)" = tasken:new111111111 ]'
expect "成功: 前の世代は消え、今回の世代が一つ" '[ "$(gens)" = 1 ]'
expect "成功: 版ずれの事前検査・同期・MCP を通る" 'grep -q "^SYNC_PACKETS_OK" <<< "$out" && grep -q "^SYNC synced" <<< "$out" && grep -q "^MCP tools=16" <<< "$out"'
expect "成功: 事前検査は隔離して、共有フォルダを読み取り専用で渡す" 'grep -- "--entrypoint node tasken:new111111111" "$F/run_calls" | grep -q -- "--network none --read-only" && grep -q -- "-v $SYNC:/sync:ro" "$F/run_calls"'
expect "成功: 同期の検査に起動の時刻をミリ秒で渡す" 'grep -q -- "--since=2026-11-07T00:00:00.123Z" "$F/exec_calls"'
expect "成功: HTTP MCP の health を確かめる" 'grep -q "^tasken-mcp-http node -e" "$F/exec_calls"'
expect "成功: バックアップに -shm を写さない・root の -shm を残さない" '! ls "$BK"/state.before-*/*-shm >/dev/null 2>&1'
expect "成功: 事前検査で replica 自身の端末を外す" 'grep -q -- "--exclude-device=$DEV" "$F/run_calls"'

# 1b. HTTP MCP だけ別の image で動いていた（2026-10-22 の配備）: 入れ替えで揃い、戻すときはそれぞれの前の image へ
new_world
echo "TASKEN_IMAGE_MCP_HTTP=sha256:http00000000" >> "$D/tasken.conf"
echo sha256:http00000000 > "$F/img_tasken-mcp-http"
record tasken:new1b1b1b1b1 sha256:new1b
run_update
expect "image が別だった HTTP MCP: 入れ替えで同じ tag に揃う" '[ "$code" = 0 ] && grep -qx "TASKEN_IMAGE_MCP_HTTP=tasken:new1b1b1b1b1" "$D/tasken.conf" && [ "$(cat "$F/img_tasken-mcp-http")" = tasken:new1b1b1b1b1 ]'
new_world
echo "TASKEN_IMAGE_MCP_HTTP=sha256:http00000000" >> "$D/tasken.conf"
echo sha256:http00000000 > "$F/img_tasken-mcp-http"
record tasken:bad1c1c1c1c1 sha256:bad1c
echo tasken:bad1c1c1c1c1 > "$F/bad"
run_update
expect "image が別だった HTTP MCP: 戻すときは HTTP MCP の前の image へ" '[ "$code" = 3 ] && [ "$(cat "$F/img_tasken-mcp-http")" = sha256:http00000000 ] && [ "$(cat "$F/img_tasken-tunnel")" = sha256:old000000000 ] && grep -qx "TASKEN_IMAGE_MCP_HTTP=sha256:http00000000" "$D/tasken.conf"'

# 2. 起動しない版は image だけ戻る
new_world
record tasken:bad222222222 sha256:bad
echo tasken:bad222222222 > "$F/bad"
run_update
expect "image の戻し: 終了 3・古い版で動く・DB はそのまま" '[ "$code" = 3 ] && [ "$(conf_image)" = sha256:old000000000 ] && [ "$(rows "$DATA/research-desk.sqlite")" = 5 ] && grep -q "^HEALTH_FAIL$" <<< "$out" && grep -q "^BACKUP_OK" <<< "$out"'
expect "image の戻し: Core を先に一つで起こし、ほかはその後" 'grep -q "^up sha256:old000000000 tasken-headless " "$F/calls" && grep -q "^up sha256:old000000000 mcp-http tunnel-client " "$F/calls"'
# すぐ落ちる版: 新しい Core が動いていないと、ほかのサービスを起こせず compose ごと落ちる。それでも戻る
new_world
record tasken:crs2b2b2b2b2 sha256:crs
echo tasken:crs2b2b2b2b2 > "$F/crashes"
run_update
expect "すぐ落ちる版: 終了 3・古い版で動く" '[ "$code" = 3 ] && grep -q "^COMPOSE_UP_FAILED" <<< "$out" && [ "$(cat "$F/running")" = sha256:old000000000 ]'

# 3. schema に触って落ちる版。古い版は新しい schema の DB を開けず、起動してすぐ落ちる → DB も戻す（終了 5）。
#    古い Core がすぐ落ちても、Core を先に一つで起こすので、二段目に届く（まとめて起こすと compose ごと落ちて終了 4）
new_world
record tasken:mig333333333 sha256:mig
echo tasken:mig333333333 > "$F/bad"
echo tasken:mig333333333 > "$F/migrates"
echo sha256:old000000000 > "$F/needs_v1"
run_update
expect "DB の戻し: 終了 5・db_restored=1" '[ "$code" = 5 ] && [[ "$last" == *db_restored=1* ]]'
expect "DB の戻し: DB と添付が戻り、戻す前を残す" '[ "$(rows "$DATA/research-desk.sqlite")" = 5 ] && [ "$(cat "$DATA/attachments/a1")" = "架空の添付" ] && [ "$(rows "$(ls -1d "$VOL"/state.failed-*)/state/research-desk.sqlite")" = 6 ]'
expect "DB の戻し: 写しへの書き込みを、コンテナの利用者と追加の group で試す" 'grep -q -- "--user 0:0 --group-add 101 --entrypoint sh" "$F/run_calls"'
# 新しい版が試しの間に共有フォルダへ差分を出していたら、DB を戻さない（連番が重なる）
new_world
record tasken:mig3c3c3c3c3 sha256:mig3c
echo tasken:mig3c3c3c3c3 > "$F/bad"
echo tasken:mig3c3c3c3c3 > "$F/migrates"
echo tasken:mig3c3c3c3c3 > "$F/publishes"
echo sha256:old000000000 > "$F/needs_v1"
run_update
expect "差分を出した版: 終了 4・DB は戻さない" '[ "$code" = 4 ] && [[ "$last" == *reason=published_during_trial* ]] && ! grep -q ROLLBACK_DB <<< "$out" && [ "$(rows "$DATA/research-desk.sqlite")" = 6 ]'
# 戻す写しにコンテナの利用者が書けないなら、差し替えない（今の data のまま、終了 4）
new_world
record tasken:mig3b3b3b3b3 sha256:mig3b
echo tasken:mig3b3b3b3b3 > "$F/bad"
echo tasken:mig3b3b3b3b3 > "$F/migrates"
echo sha256:old000000000 > "$F/needs_v1"
touch "$F/probe_fails"
run_update
expect "書けない写し: 終了 4・db_restored と言わない" '[ "$code" = 4 ] && grep -q RESTORE_NOT_WRITABLE <<< "$out" && ! grep -q db_restored <<< "$out"'
expect "書けない写し: data は差し替えず、failed- も作らない" '[ "$(rows "$DATA/research-desk.sqlite")" = 6 ] && ! ls -d "$VOL"/state.failed-* >/dev/null 2>&1'

# 4. 何をしても起動しない → 終了 4
new_world
record tasken:bad444444444 sha256:bad4
printf 'tasken:bad444444444\nsha256:old000000000\n' > "$F/bad"
run_update
expect "戻せない: RESTORE_FAILED・終了 4" '[ "$code" = 4 ] && [[ "$last" == RESTORE_FAILED* ]]'

# 5. 記録が減っていたら前の世代を kept- に移し、次の更新でも消さない（終了 7）
new_world
mkdir -p "$BK/state.before-bbbbbbbbbbbb-20260101T000000"
mkdb "$BK/state.before-bbbbbbbbbbbb-20260101T000000/research-desk.sqlite" 9 3 4
record tasken:new555555555 sha256:new5
run_update
expect "記録が減った: 終了 7・entities=9->5・kept- に残す" '[ "$code" = 7 ] && grep -q "RECORDS_SHRANK entities=9->5 kept=" <<< "$out" && [ -d "$BK/state.kept-bbbbbbbbbbbb-20260101T000000" ] && [ "$(gens)" = 1 ]'
record tasken:new5b5b5b5b5 sha256:new5b
run_update
expect "記録が減った: 次の更新でも kept- は残る" '[ "$code" = 0 ] && [ -d "$BK/state.kept-bbbbbbbbbbbb-20260101T000000" ]'
# 送った差分・取り込んだ位置が減っても知らせる（どちらも今の版に減る経路は無い）
new_world
mkdir -p "$BK/state.before-cccccccccccc-20260101T000000"
mkdb "$BK/state.before-cccccccccccc-20260101T000000/research-desk.sqlite" 5 8 9
record tasken:new5c5c5c5c5 sha256:new5c
run_update
expect "差分と位置が減った: 終了 7" '[ "$code" = 7 ] && grep -q "RECORDS_SHRANK sync_outbox=8->3 cursors=9->4 kept=" <<< "$out"'
# 前の世代が数えられない（DB が無い）なら、消さずに残す側に倒す
new_world
mkdir -p "$BK/state.before-a0a0a0a0a0a0-20260101T000000"
record tasken:new5g5g5g5g5 sha256:new5g
run_update
expect "数えられない前の世代: 終了 7・kept- に残す" '[ "$code" = 7 ] && grep -q "RECORDS_SHRANK uncountable" <<< "$out" && [ -d "$BK/state.kept-a0a0a0a0a0a0-20260101T000000" ]'

# 5b. 前の世代の DB と、大きさも更新時刻も同じで中身が違う DB でも、今の中身を写す
new_world
mkdir -p "$BK/state.before-dddddddddddd-20260101T000000"
mkdb "$BK/state.before-dddddddddddd-20260101T000000/research-desk.sqlite" 4 3 4 # 今より少ない（減りの検査に掛けない）
touch -r "$DATA/research-desk.sqlite" "$BK/state.before-dddddddddddd-20260101T000000/research-desk.sqlite"
same_size=no
[ "$(stat -c %s "$DATA/research-desk.sqlite")" = "$(stat -c %s "$BK/state.before-dddddddddddd-20260101T000000/research-desk.sqlite")" ] && same_size=yes
record tasken:new5d5d5d5d5 sha256:new5d
run_update
expect "同じ大きさ・同じ時刻（前提）: 二つの DB は同じ大きさ" '[ "$same_size" = yes ]'
expect "同じ大きさ・同じ時刻: 今の中身（5件）を写す" '[ "$code" = 0 ] && [ "$(gens)" = 1 ] && [ "$(rows "$(ls -1d "$BK"/state.before-*)/research-desk.sqlite")" = 5 ]'

# 5c. 止めたときに -wal が残っていても、その中身まで数えて検査する。root の -shm を残さない
new_world
python3 - "$DATA/research-desk.sqlite" << 'PY'
import os, shutil, sqlite3, sys, tempfile
p = sys.argv[1]
c = sqlite3.connect(p)
c.execute('pragma journal_mode=wal')
c.execute('pragma wal_autocheckpoint=0')
c.execute("insert into entities values ('task','w','{}',null)")
c.commit()
# 閉じると -wal が畳まれるので、閉じる前に三つを写して「閉じずに止まった」形を作る
t = tempfile.mkdtemp()
for s in ('', '-wal', '-shm'):
    if os.path.exists(p + s):
        shutil.copy2(p + s, os.path.join(t, 'db' + s))
c.close()
for s in ('', '-wal', '-shm'):
    if os.path.exists(p + s):
        os.remove(p + s)
    if os.path.exists(os.path.join(t, 'db' + s)):
        shutil.copy2(os.path.join(t, 'db' + s), p + s)
PY
record tasken:new5w5w5w5w5 sha256:new5w
run_update
expect "-wal の残り: 終了 0・wal=1・entities=6 を数える" '[ "$code" = 0 ] && grep -q "^BACKUP_OK entities=6 sync_outbox=3 cursors=4 wal=1" <<< "$out"'
expect "-wal の残り: バックアップに -shm を残さない" '! ls "$BK"/state.before-*/*-shm >/dev/null 2>&1'

# 6. compose の up の失敗では DB を戻さない／止まらないなら写さない
new_world
record tasken:upf666666666 sha256:upf
touch "$F/up_fails"
run_update
expect "up の失敗: 終了 4 で DB は動かさない" '[ "$code" = 4 ] && ! grep -q ROLLBACK_DB <<< "$out" && ! ls -d "$VOL"/state.failed-* >/dev/null 2>&1'
new_world
record tasken:stp666666666 sha256:stp
touch "$F/stop_noop"
run_update
expect "止まらない: 終了 5 で写さない" '[ "$code" = 5 ] && grep -q STOP_FAILED <<< "$out" && [ "$(gens)" = 0 ]'

# 7. 版ずれの事前検査: 新しい版が Desktop の差分を読めなければ、何も止めずに後回し（終了 2）
new_world
record tasken:skw777777777 sha256:skw
echo tasken:skw777777777 > "$F/skew"
run_update
expect "版ずれ（事前）: SYNC_SKEW・終了 2・止めない" '[ "$code" = 2 ] && [[ "$last" == SYNC_SKEW* ]] && [[ "$last" == *future_kind* ]] && [ ! -f "$F/calls" ] && [ "$(gens)" = 0 ]'
new_world
record tasken:nck777777777 sha256:nck
echo tasken:nck777777777 > "$F/nocheck"
run_update
expect "検査が動かない版: CHECK_FAILED・終了 1・止めない" '[ "$code" = 1 ] && [[ "$last" == "CHECK_FAILED packets"* ]] && [ ! -f "$F/calls" ]'

# 8. 起動の後の同期
new_world
record tasken:inc888888888 sha256:inc
echo "tasken:inc888888888 incompatible" > "$F/sync_verdict"
run_update
expect "取り込めない差分（起動の後）: 終了 3・image だけ戻す" '[ "$code" = 3 ] && grep -q "^HEALTH_FAIL sync_incompatible" <<< "$out" && ! grep -q ROLLBACK_DB <<< "$out" && [ "$(conf_image)" = sha256:old000000000 ]'
new_world
set_meta "$DATA/research-desk.sqlite" shared_sync_last_error "架空の前からの失敗"
digest "架空の前からの失敗" > "$F/sync_digest"
record tasken:unc888888888 sha256:unc
echo "tasken:unc888888888 error" > "$F/sync_verdict"
run_update
expect "前の版と同じ同期の失敗: 戻さない・終了 0" '[ "$code" = 0 ] && grep -q "^SYNC unchanged_error" <<< "$out"'
new_world
digest "新しい失敗" > "$F/sync_digest"
record tasken:new8c8c8c8c8 sha256:new8c
echo "tasken:new8c8c8c8c8 error" > "$F/sync_verdict"
run_update
expect "新しい同期の失敗: 終了 3" '[ "$code" = 3 ] && grep -q "^HEALTH_FAIL sync_error" <<< "$out"'
new_world
record tasken:wai8d8d8d8d8 sha256:wai
echo "tasken:wai8d8d8d8d8 waiting" > "$F/sync_verdict"
run_update
expect "差分の到着待ち: 版のせいではないので終了 0" '[ "$code" = 0 ] && grep -q "^SYNC waiting" <<< "$out"'
new_world
record tasken:pnd8e8e8e8e8 sha256:pnd
echo "tasken:pnd8e8e8e8e8 pending" > "$F/sync_verdict"
run_update
expect "同期が一度も通らない: 終了 3" '[ "$code" = 3 ] && grep -q "^HEALTH_FAIL sync_pending" <<< "$out"'
new_world
set_meta "$DATA/research-desk.sqlite" shared_sync_enabled false
record tasken:dis8f8f8f8f8 sha256:dis
echo "tasken:dis8f8f8f8f8 disabled" > "$F/sync_verdict"
run_update
expect "前の版で同期が無効: 同期は見ずに終了 0" '[ "$code" = 0 ] && grep -q "^SYNC skipped" <<< "$out"'

# 9. MCP・HTTP MCP・再起動
new_world
record tasken:mcp999999999 sha256:mcp
echo tasken:mcp999999999 > "$F/mcp_bad"
run_update
expect "MCP が出せない版: 終了 3" '[ "$code" = 3 ] && grep -q "^HEALTH_FAIL mcp" <<< "$out"'
new_world
record tasken:htp999999999 sha256:htp
echo tasken:htp999999999 > "$F/http_bad"
run_update
expect "HTTP MCP が応答しない版: 終了 3" '[ "$code" = 3 ] && grep -q "^HEALTH_FAIL mcp_http" <<< "$out"'
new_world
record tasken:rst999999999 sha256:rst
echo tasken-mcp-http > "$F/restart_after_up"
run_update
expect "作り直した後に再起動を繰り返す版: 終了 3" '[ "$code" = 3 ] && grep -q "^HEALTH_FAIL restarting" <<< "$out"'
new_world
record tasken:rsu999999999 sha256:rsu
echo tasken-tunnel > "$F/restart_after_up"
run_update
expect "tunnel の再起動は外の都合なので合否に入れない: 終了 0" '[ "$code" = 0 ]'
new_world
record tasken:sch999999999 sha256:sch
echo tasken:sch999999999 > "$F/badschema"
run_update
expect "検査の出力の形の版が違う: CHECK_FAILED・終了 1・止めない" '[ "$code" = 1 ] && [[ "$last" == "CHECK_FAILED packets"* ]] && [ ! -f "$F/calls" ]'

# 10. 前提の不一致・書ける設定・親・symlink・record なし
new_world
record tasken:newaaaaaaaaa sha256:newa deadbeef
echo cafebabe > "$F/bins/tasken:newaaaaaaaaa"
run_update
expect "成果物の不一致: CORE_MISMATCH・終了 1・止めない" '[ "$code" = 1 ] && [ "$last" = CORE_MISMATCH ] && [ ! -f "$F/calls" ]'
new_world
record tasken:newbbbbbbbbb sha256:newb
chmod 666 "$D/tasken.conf"
run_update
expect "書ける設定: INSECURE_PATH・終了 2" '[ "$code" = 2 ] && [[ "$last" == INSECURE_PATH* ]] && [ ! -f "$F/calls" ]'
new_world
record tasken:newccccccccc sha256:newc
chmod 777 "$W/base"
run_update
expect "書ける親: 終了 2" '[ "$code" = 2 ] && [[ "$last" == "INSECURE_PATH $W/base"* ]]'
new_world
record tasken:newddddddddd sha256:newd
mv "$DATA" "$VOL/real" && ln -s "$VOL/real" "$DATA"
run_update
expect "symlink の data: 終了 2" '[ "$code" = 2 ] && [ "$last" = DATA_DIR_SYMLINK ]'
new_world
run_update --no-record-given
expect "record なし: 終了 2" '[ "$code" = 2 ] && [[ "$last" == USAGE* ]]'
new_world
record kokokana:neweeeeeeeee sha256:newe
run_update
expect "別のサービスの image: BAD_TAG・終了 1" '[ "$code" = 1 ] && [ "$last" = BAD_TAG ]'

# 11. 動いている版: 何もしない／応答しなければ終了 6
new_world
record sha256:old000000000 sha256:old
sed -i 's/^image_tag=.*/image_tag=tasken:old000000000/' "$W/record.txt"
echo sha256:old > "$F/images/tasken:old000000000"
echo tasken:old000000000 > "$F/running"
run_update
expect "動いている版: HEALTH_OK で何も止めない" '[ "$code" = 0 ] && [[ "$out" == *ALREADY_RUNNING* ]] && [ ! -f "$F/calls" ]'
echo tasken:old000000000 > "$F/bad"
run_update
expect "動いている版が応答しない: 終了 6" '[ "$code" = 6 ] && [ "$last" = NOT_HEALTHY_NOW ]'

# 12. 本番 DB の写しが検査に落ちたら入れ替えない（終了 5）
new_world
record tasken:newfffffffff sha256:newf
printf 'SQLite format 3\000not really' > "$DATA/research-desk.sqlite"
run_update
expect "壊れた DB: 終了 5・古い版のまま" '[ "$code" = 5 ] && [ "$(cat "$F/running")" = sha256:old000000000 ] && [[ "$last" == *attention=BACKUP_BAD* ]]'

# 13. 秘密のファイルが、そのまま渡して通る形でなければ止める前に終わる
for bad in mode640 symlink missing empty owner; do
  new_world
  record tasken:new13a13a13a sha256:new13
  s="$D/secrets/mcp_http_clients"
  case "$bad" in
    mode640) chmod 640 "$s" ;;
    symlink) mv "$s" "$W/elsewhere" && ln -s "$W/elsewhere" "$s" ;;
    missing) rm "$s" ;;
    empty) : > "$s" ;;
    owner) sed -i 's/^TASKEN_UID=0$/TASKEN_UID=1234/' "$D/tasken.conf" ;;
  esac
  run_update
  expect "秘密（$bad）: SECRET_BAD・終了 2・止めない" '[ "$code" = 2 ] && [[ "$last" == SECRET_BAD* ]] && [ ! -f "$F/calls" ]'
done

# 14. 動いているコンテナが compose の外・止まっているサービスがあるなら始めない
new_world
record tasken:new14141414a sha256:new14
echo synology/tasken-headless > "$F/labels_tasken-headless"
run_update
expect "compose の外のコンテナ: NOT_COMPOSE_MANAGED・終了 2・止めない" '[ "$code" = 2 ] && [[ "$last" == "NOT_COMPOSE_MANAGED tasken-headless running=synology/tasken-headless want=tasken/tasken-headless" ]] && [ ! -f "$F/calls" ]'
new_world
record tasken:new14b14b14b sha256:new14b
touch "$F/tunnel_down"
run_update
expect "止めてある tunnel: SERVICE_NOT_RUNNING・終了 2・起こさない" '[ "$code" = 2 ] && [ "$last" = "SERVICE_NOT_RUNNING tasken-tunnel" ] && [ ! -f "$F/calls" ]'

if [ "$fails" = 0 ]; then echo ALL_PASSED; else echo "FAILED $fails"; exit 1; fi
