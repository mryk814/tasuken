#!/bin/bash
# NAS: 照合済みの image へ Tasken の headless replica を入れ替える。通常の更新の入口で、プル型の
# 実行役（nas-pull の nas-pull.sh）も手作業もここを通る。
#   sudo /volume1/@nas-pull/tasken/tasken-update-image.sh --record <record.txt>
# この置き場への初回の導入は nas-pull の install-tasken.sh。nas-install.sh は開発機で作った image を
# 前の置き場（/volume1/docker/tasken）へ入れる古い入口で、プル型の更新とは別物。
#
# awai・kokokana の更新スクリプトと同じ契約（終了コードと最後の行の語）を Tasken の名前で持つ。
# 段: 照合 → 版ずれの事前検査 → 停止 → バックアップ（前の世代との差分）→ 差し替え → health
#     → 失敗したら image を戻す → 古い image でも応答しないときだけ DB も戻す。
# DB を戻すときも、戻す前の data は消さずに別名で残す。
#
# Tasken に固有のこと:
# - 1つの image で、Core（tasken-headless）・tunnel（tasken-tunnel）・HTTP MCP（tasken-mcp-http）が
#   動く。導入のときに今の配備から作った docker-compose.json のサービスを、まとめて止めて作り直す
# - 版ずれ: Desktop（正本の書き手）と replica の契約は共有フォルダの同期差分で、SQLite の schema は
#   端末の中だけのもの。新しい版が Desktop の書いた差分を読めなければ版ずれとみる。読めるかの判定は
#   image の中の replica-check がする（このスクリプトは手で置き直すもので、DB や差分の作りを知らない）
#   - 入れ替えの前: 新しい image を隔離して、共有フォルダの最近の差分を読ませる。読めなければ
#     SYNC_SKEW（終了 2）で何も変えない。Desktop が追いつけば、同じ commit が次の確認で通る
#   - 起動の後: 新しい版の Core が起動の同期を通したか、まだ取り込んでいない差分を読めるか。駄目なら
#     HEALTH_FAIL で image を戻す。前の版でも同じ失敗をしていたなら、それを理由に戻さない
# - DB まで戻すのは、新しい版が共有フォルダへ差分を出していないときだけ。出していたら、戻した DB の
#   連番が出た差分と重なり、Desktop が後の差分を黙って読み飛ばす。戻さずに止める（終了 4）
#
# 終了コード（最後の行はその語）:
#   0 HEALTH_OK（ALREADY_RUNNING も）
#   1 この commit の成果物が駄目（record・image・中身の不一致、検査が動かない）。何も変えていない
#   2 環境の都合で始めなかった（LOCKED・NO_SPACE・INSECURE_PATH・SECRET_BAD・NOT_COMPOSE_MANAGED・
#     SYNC_SKEW など）。何も変えていない。後でやり直せる
#   3 RESTORED_PREVIOUS: image だけ戻した。データには触れていない
#   4 RESTORE_FAILED: 前の版でも動かない（または DB を戻すと同期が壊れる）。人の手が要る
#   5 RESTORED_PREVIOUS だが人が見るべき（DB を戻した、本番 DB の写しが検査に落ちた、止まらなかった）
#   6 NOT_HEALTHY_NOW: 同じ版が動いているのに応答しない。触っていない。人の手が要る
#   7 HEALTH_OK だが、記録（entities）・送った差分（sync_outbox）・取り込んだ位置（cursor）のどれかが
#     前の世代より減っていた（または数えられなかった）ので、前の世代を backups/<data>.kept-* に移して
#     残した。自動では消さない
set -euo pipefail
umask 077
trap '' HUP # ssh が切れても途中で死なない（二つの mv の間で止まると data が無くなる）

BASE="${NAS_PULL_BASE:-/volume1/@nas-pull}"
DEPLOY_DIR="${DEPLOY_DIR:-$BASE/tasken/deploy}"
BACKUP_DIR="${BACKUP_DIR:-$BASE/tasken/backups}"
CONF=tasken.conf
COMPOSE_FILE=docker-compose.json
CORE=tasken-headless # Core のサービス名とコンテナ名
DOCKER="${DOCKER:-/var/packages/ContainerManager/target/usr/bin/docker}"
DC="${DC:-/var/packages/ContainerManager/target/usr/bin/docker-compose}"
SLEEP="${SLEEP:-sleep}"
HEALTH_TRIES="${HEALTH_TRIES:-300}" # 2 秒おきに最大 10 分（Core は起動の同期を終えてから応答する。添付画像の照合をやり直すので長い）
SYNC_TRIES="${SYNC_TRIES:-12}"     # 10 秒おきに最大 120 秒
DOCKER_TIMEOUT="${DOCKER_TIMEOUT:-300}"
CHECK=/app/core-dist/replica-check.mjs

record=""
while [ $# -gt 0 ]; do
  case "$1" in
    --record) record="${2:-}"; shift 2 ;;
    *) echo "USAGE tasken-update-image.sh --record <record.txt>"; exit 2 ;;
  esac
done
# 既定の record は置かない。本人の利用者が書ける場所の tar を root で load しないため。
[ -n "$record" ] || { echo "USAGE tasken-update-image.sh --record <record.txt>"; exit 2; }

[ "$(id -u)" = 0 ] || { echo NEED_ROOT; exit 2; }
for t in "$DOCKER" "$DC"; do [ -x "$t" ] || { echo "DOCKER_MISSING $t"; exit 2; }; done
for t in python3 flock rsync timeout; do command -v "$t" >/dev/null || { echo "TOOL_MISSING $t"; exit 2; }; done
dk() { timeout "$DOCKER_TIMEOUT" "$DOCKER" "$@"; }

# path と、その親をたどって / まで: root 所有で、group と other が書けない（root の sticky は可）。
insecure() {
  local p owner mode
  for p in "$@"; do
    [ -e "$p" ] || { echo "PATH_MISSING $p"; return 0; }
    p=$(readlink -f "$p")
    while :; do
      owner=$(stat -c %u "$p")
      mode=$(stat -c %a "$p")
      if [ "$owner" != 0 ] || { [ $((8#$mode & 8#022)) -ne 0 ] && [ $((8#$mode & 8#1000)) -eq 0 ]; }; then
        echo "INSECURE_PATH $p owner=$owner mode=$mode"
        return 0
      fi
      [ "$p" = / ] && break
      p=$(dirname "$p")
    done
  done
  return 1
}
self=$(readlink -f "$0")
mkdir -p "$BACKUP_DIR"
if insecure "$self" "$DEPLOY_DIR/$COMPOSE_FILE" "$DEPLOY_DIR/$CONF" "$DEPLOY_DIR/secrets" "$BACKUP_DIR"; then exit 2; fi
[ "$(stat -c %a "$BACKUP_DIR")" = 700 ] || chmod 700 "$BACKUP_DIR"
cd "$DEPLOY_DIR"

exec 9>"$DEPLOY_DIR/.update.lock"
flock -n 9 || { echo LOCKED; exit 2; }

[ -f "$record" ] || { echo RECORD_MISSING; exit 1; }
rv() { tr -d '\r' < "$record" | sed -n "s/^$1=//p" | tail -1; }
source_sha=$(rv source_sha)
tag=$(rv image_tag)
want_id=$(rv image_id)
want_config=$(rv image_config_sha256) # 開発機の record。NAS の docker はこちらを ID として返す
tar_name=$(rv tar)
want_tar=$(rv tar_sha256)
want_core=$(rv core_sha256)
want_tunnel=$(rv tunnel_client_sha256)
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || { echo BAD_SOURCE; exit 1; }
[[ "$tag" =~ ^tasken:[A-Za-z0-9._-]+$ ]] || { echo BAD_TAG; exit 1; }

# 開発機で作って運んだ tar なら、照合してから load する。NAS で作った image は既にある。
if [ -n "$want_tar" ]; then
  [[ -n "$tar_name" && "$tar_name" != */* && "$tar_name" != *..* ]] || { echo BAD_TAR_NAME; exit 1; }
  tar_file="$(dirname "$record")/$tar_name"
  [ -f "$tar_file" ] || { echo TAR_MISSING; exit 1; }
  [ "$(sha256sum "$tar_file" | cut -d' ' -f1)" = "$want_tar" ] || { echo TAR_MISMATCH; exit 1; }
  dk load -i "$tar_file" >/dev/null
fi
got_id=$(dk image inspect --format '{{.Id}}' "$tag" 2>/dev/null) || { echo IMAGE_MISSING; exit 1; }
if [ "$got_id" != "$want_id" ] && { [ -z "$want_config" ] || [ "$got_id" != "$want_config" ]; }; then
  echo ID_MISMATCH
  exit 1
fi
image_sha() { # path → image の中のファイルの SHA256
  dk run --rm --network none --read-only --entrypoint sha256sum "$tag" "$1" | cut -d' ' -f1
}
if [ -n "$want_core" ] && [ "$(image_sha /app/core-dist/headless.mjs)" != "$want_core" ]; then
  echo CORE_MISMATCH
  exit 1
fi
if [ -n "$want_tunnel" ] && [ "$(image_sha /usr/local/bin/tunnel-client)" != "$want_tunnel" ]; then
  echo TUNNEL_CLIENT_MISMATCH
  exit 1
fi

conf() { tr -d '\r' < "$DEPLOY_DIR/$CONF" | sed -n "s/^$1=//p" | tail -1; }
data=$(conf TASKEN_DATA_DIR)
data="${data%/}"
sync_dir=$(conf TASKEN_SYNC_DIR)
sync_dir="${sync_dir%/}"
[[ "$data" == /*/* ]] || { echo BAD_DATA_DIR; exit 2; }
[ -L "$data" ] && { echo DATA_DIR_SYMLINK; exit 2; }
[ -d "$data" ] || { echo DATA_DIR_MISSING; exit 2; }
[ -f "$data/research-desk.sqlite" ] || { echo DB_MISSING; exit 2; }
[[ "$sync_dir" == /*/* && -d "$sync_dir" ]] || { echo SYNC_DIR_MISSING; exit 2; }
parent=${data%/*}
base=${data##*/}
uid=$(conf TASKEN_UID)
gid=$(conf TASKEN_GID)
admin_gid=$(conf TASKEN_ADMIN_GID)
[[ "$uid" =~ ^[0-9]+$ && "$gid" =~ ^[0-9]+$ && "$admin_gid" =~ ^[0-9]*$ ]] || { echo BAD_UID; exit 2; }

compose() { timeout "$DOCKER_TIMEOUT" "$DC" --env-file "$CONF" -f "$COMPOSE_FILE" "$@"; }

old=$(dk inspect --format '{{.Config.Image}}' "$CORE" 2>/dev/null || true)
[ -n "$old" ] || { echo NO_CURRENT_CONTAINER; exit 2; } # 初回は install-tasken.sh

# Core が応答し、その image で動いているか。戻すかどうかの判断はこれだけで決める（版ずれや MCP は
# 新しい版を受け入れるかだけに使う。戻した版でそれを見ると、DB を戻す段へ進んでしまう）。
# return には必ず値を書く。戻しは EXIT の trap から動くので、引数なしの return は関数の中ではなく
# trap の前のコマンド（exit 1）の値を返してしまう（bash の決まり）。
# 待ちは回数と経過時間の両方で打ち切る。
core_healthy() {
  local want=$1 i end=$((SECONDS + HEALTH_TRIES * 2 + 60))
  for ((i = 0; i < HEALTH_TRIES && SECONDS < end; i++)); do
    if dk exec "$CORE" node -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync("/data/tasken-core.json","utf8"));fetch(d.origin+"/health",{headers:{authorization:"Bearer "+d.token},signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' \
      >/dev/null 2>&1; then
      [ "$(dk inspect --format '{{.Config.Image}}' "$CORE" 2>/dev/null || true)" = "$want" ] && return 0
      return 1
    fi
    "$SLEEP" 2
  done
  return 1
}

# image はサービスごとの変数で持つ（TASKEN_IMAGE が Core と tunnel、TASKEN_IMAGE_<名前> がそれ以外）。
# 導入の時点で、HTTP MCP だけ別の image で動いていることがある（2026-10-22 の配備）。戻すときに
# Core の古い image で HTTP MCP を起こすと、http-server.mjs が無くて再起動を繰り返す。
# 先に環境にある値は --env-file より優先されるので、tasken.conf の値をいつも環境にも出す。
export_images() {
  local line
  while read -r line; do
    [[ "$line" =~ ^(TASKEN_IMAGE[A-Z0-9_]*)=(.*)$ ]] && export "${BASH_REMATCH[1]}=${BASH_REMATCH[2]}"
  done < <(tr -d '\r' < "$CONF")
  return 0
}
set_images() { # 新しい image へ: すべての TASKEN_IMAGE* を同じ tag に
  awk -v img="$1" '/^TASKEN_IMAGE[A-Z0-9_]*=/ { sub(/=.*/, "=" img); found = 1 } { print } END { if (!found) print "TASKEN_IMAGE=" img }' \
    "$CONF" > "$CONF.tmp"
  chmod 644 "$CONF.tmp"
  mv "$CONF.tmp" "$CONF"
  export_images
}
export_images

if [ "$old" = "$tag" ]; then
  if core_healthy "$tag"; then
    echo ALREADY_RUNNING
    echo HEALTH_OK
    exit 0
  fi
  echo NOT_HEALTHY_NOW
  exit 6
fi

cfg=$(TASKEN_IMAGE="$tag" compose config --format json 2>/dev/null) || { echo COMPOSE_CONFIG_FAILED; exit 2; }
# compose の中身: project 名、サービスとコンテナ名、秘密として渡すファイル（compose の secrets と、
# deploy/secrets の下を bind するもの）。
compose_py() {
  python3 -c '
import json, os, sys
cfg = json.loads(sys.stdin.read())
what, deploy = sys.argv[1], sys.argv[2]
if what == "project":
    print(cfg.get("name", ""))
elif what == "services":
    for name, svc in sorted(cfg.get("services", {}).items()):
        print(name, svc.get("container_name") or "-")
elif what == "secrets":
    files = set()
    for item in (cfg.get("secrets") or {}).values():
        if isinstance(item, dict) and item.get("file"):
            files.add(item["file"])
    for svc in cfg.get("services", {}).values():
        for vol in svc.get("volumes") or []:
            if isinstance(vol, dict) and vol.get("type") == "bind":
                src = vol.get("source", "")
                if src.startswith(os.path.join(deploy, "secrets") + "/"):
                    files.add(src)
    for f in sorted(files):
        print(f)
' "$1" "$DEPLOY_DIR" <<< "$cfg"
}
project=$(compose_py project)
[ -n "$project" ] || { echo COMPOSE_CONFIG_FAILED; exit 2; }
services=()
containers=()
while read -r s c; do
  [ -n "$s" ] || continue
  [ "$c" != - ] || { echo "NO_CONTAINER_NAME $s"; exit 2; }
  services+=("$s")
  containers+=("$c")
done < <(compose_py services)
core_in=0
for i in "${!services[@]}"; do [ "${services[$i]}" = "$CORE" ] && [ "${containers[$i]}" = "$CORE" ] && core_in=1; done
[ "$core_in" = 1 ] || { echo "NO_CORE_SERVICE $CORE"; exit 2; }

# 動いているコンテナが、この compose の project・service のものか。違うと compose stop で止まらず
# （STOP_FAILED）、戻すときの up も container_name の衝突で落ちて、毎回終了 4 になる。
# compose にあるサービスは、すべて動いていること（入れ替えで、止めてあったものを起こさない）。
for i in "${!services[@]}"; do
  c=${containers[$i]}
  labels=$(dk inspect --format '{{index .Config.Labels "com.docker.compose.project"}}/{{index .Config.Labels "com.docker.compose.service"}}' "$c" 2>/dev/null || true)
  [ "$labels" = "$project/${services[$i]}" ] || { echo "NOT_COMPOSE_MANAGED $c running=$labels want=$project/${services[$i]}"; exit 2; }
  [ "$(dk inspect --format '{{.State.Running}}' "$c" 2>/dev/null || true)" = true ] || { echo "SERVICE_NOT_RUNNING $c"; exit 2; }
done

# 秘密のファイルは、ホストの持ち主と mode がそのままコンテナに見える（NAS の docker-compose v2.20.1 は
# compose に書いた uid・gid・mode を黙って無視する）。無いと止めた後の up が mount で落ちる。
# 止める前に、コンテナの利用者の 600 か 400 の、空でない通常のファイルかを確かめる。
while read -r s; do
  [ -n "$s" ] || continue
  if [ -L "$s" ] || [ ! -f "$s" ] || [ ! -s "$s" ] || [ "$(stat -c %u "$s")" != "$uid" ] ||
    [ $((8#$(stat -c %a "$s") & 8#077)) -ne 0 ]; then
    echo "SECRET_BAD ${s##*/}（TASKEN_UID=$uid の所有で 600 か 400 の、空でない通常のファイルにする）"
    exit 2
  fi
done < <(compose_py secrets)

# replica-check の結果（最後の TASKEN_REPLICA_CHECK の行の JSON）から値を取り出す。
check_value() { # json key（"." 区切り）
  python3 -c '
import json, sys
d = json.loads(sys.argv[1])
for k in sys.argv[2].split("."):
    d = d.get(k) if isinstance(d, dict) else None
print("" if d is None else (json.dumps(d) if isinstance(d, (dict, list, bool)) else d))
' "$1" "$2" 2>/dev/null || true
}
# 最後の TASKEN_REPLICA_CHECK の行。出力の形の版が 1 でなければ読まない（空を返す）。
check_line() {
  local line
  line=$(sed -n 's/^TASKEN_REPLICA_CHECK //p' <<< "$1" | tail -1)
  [ -n "$line" ] && [ "$(check_value "$line" schema_version)" = 1 ] && printf '%s' "$line"
  return 0
}

# 版ずれの事前検査。新しい image を隔離して（ネットワークなし・読み取り専用・DB なし）、共有フォルダの
# 最近の差分をこの版の取り込み規則で読ませる。Core と同じ利用者と追加の group で読む（Synology の ACL）。
# replica 自身の端末（導入のときに tasken.conf へ書いた TASKEN_DEVICE_ID）は、取り込みが読まないので外す。
device_conf=$(conf TASKEN_DEVICE_ID)
[[ "$device_conf" =~ ^[0-9a-fA-F-]+$ ]] || device_conf=""
set +e
pre_out=$(dk run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --user "$uid:$gid" ${admin_gid:+--group-add "$admin_gid"} --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m \
  -v "$sync_dir:/sync:ro" --entrypoint node "$tag" "$CHECK" packets --sync-dir=/sync \
  ${device_conf:+--exclude-device="$device_conf"} 2>&1)
pre_rc=$?
set -e
pre=$(check_line "$pre_out")
if [ -z "$pre" ] || { [ "$pre_rc" != 0 ] && [ "$pre_rc" != 3 ]; }; then
  echo "CHECK_FAILED packets rc=$pre_rc $(tail -2 <<< "$pre_out" | tr '\n' ' ' | cut -c1-200)"
  exit 1
fi
if [ "$pre_rc" = 3 ]; then
  echo "SYNC_SKEW $(check_value "$pre" reason) rejected=$(check_value "$pre" rejected_total) first=$(check_value "$pre" rejected)" | cut -c1-400
  exit 2
fi
echo "SYNC_PACKETS_OK checked=$(check_value "$pre" checked) devices=$(check_value "$pre" devices)"

need_kb=$(du -sk "$data" | cut -f1)
for d in "$BACKUP_DIR" "$parent"; do
  avail_kb=$(df -Pk "$d" | awk 'NR == 2 { print $4 }')
  [ "$avail_kb" -gt $((need_kb * 2 + 102400)) ] || { echo "NO_SPACE $d"; exit 2; }
done

ts=$(date +%Y%m%dT%H%M%S)
new_bk="$BACKUP_DIR/$base.before-${source_sha:0:12}-${ts}"
# 同じ名前が既にあると、mv が既存のディレクトリの中へ入れてしまう。始める前に止める。
[ -e "$new_bk" ] && { echo "BACKUP_NAME_TAKEN ${new_bk##*/}"; exit 2; }
is_generation() { # バックアップの世代の名前か（消してよいものを名前で厳密に絞る）
  local name=${1##*/} rest
  [[ "$name" == "$base".before-* ]] || return 1
  rest=${name#"$base".before-}
  [[ "$rest" =~ ^[0-9a-f]{12}-[0-9]{8}T[0-9]{6}(\.partial)?$ ]]
}
prev_bk=""
while read -r d; do
  if [ -d "$d" ] && is_generation "$d" && [[ "$d" != *.partial ]]; then prev_bk=$d; break; fi
done < <(ls -1dt "$BACKUP_DIR/$base".before-* 2>/dev/null || true)

# check DIR → 一行の要約 | count DIR → "entities sync_outbox cursor の合計" | meta DIR KEY → 値
db_py() {
  python3 - "$@" << 'PY'
import hashlib, os, sqlite3, sys
mode, root = sys.argv[1], sys.argv[2]
p = os.path.join(root, 'research-desk.sqlite')
if not os.path.isfile(p) or os.path.islink(p):
    print('DB_NOT_FOUND')
    sys.exit(1)
wal = p + '-wal'
has_wal = os.path.isfile(wal) and os.path.getsize(wal) > 0
shm = p + '-shm'
had_shm = os.path.exists(shm)
# 止めてから写した写し（root だけの置き場）。-wal が残っていればそれも読む（immutable では読まない）。
# そのとき SQLite が作る -shm は、閉じた後に消す（戻す写しに root の -shm を残さない）。
uri = 'file:' + p + ('?mode=ro' if has_wal else '?mode=ro&immutable=1')
con = sqlite3.connect(uri, uri=True)
try:
    if mode == 'check':
        result = con.execute('PRAGMA quick_check').fetchone()[0]
        if result != 'ok':
            print('DB_CHECK_FAILED research-desk.sqlite')
            sys.exit(1)
    if mode == 'meta':
        row = con.execute('select value from workspace_meta where key = ?', (sys.argv[3],)).fetchone()
        value = row[0] if row else ''
        if len(sys.argv) > 4 and sys.argv[4] == 'digest':
            value = hashlib.sha256(value.encode('utf-8')).hexdigest()[:16] if value else ''
        print(value)
        sys.exit(0)
    tables = {r[0] for r in con.execute("select name from sqlite_master where type = 'table'")}
    one = lambda sql, t: con.execute(sql).fetchone()[0] if t in tables else 0
    # どれも今の版に減る経路が無い: entities は論理削除だけ、sync_outbox は足すだけ、cursor は MAX で進むだけ。
    entities = one('select count(*) from entities', 'entities')
    outbox = one('select count(*) from sync_outbox', 'sync_outbox')
    cursors = one('select coalesce(sum(last_sequence), 0) from sync_device_cursors', 'sync_device_cursors')
finally:
    con.close()
    if not had_shm and os.path.exists(shm):
        os.remove(shm)
if mode == 'count':
    print(entities, outbox, cursors)
else:
    print('entities=%d sync_outbox=%d cursors=%d wal=%d' % (entities, outbox, cursors, 1 if has_wal else 0))
PY
}

# replica が共有フォルダへ出した差分（自分の端末の置き場）の名前・大きさ・時刻の要約。
# DB を戻してよいかの判断に使う（新しい版が差分を出していたら、戻した DB と連番が重なる）。
published_fp() { # device_id
  python3 - "$sync_dir/devices/$1" << 'PY'
import hashlib, os, re, sys
d = sys.argv[1]
h = hashlib.sha256()
if os.path.isdir(d):
    for name in sorted(os.listdir(d)):
        if re.fullmatch(r'\d{12}-[0-9a-fA-F-]+\.json', name):
            st = os.stat(os.path.join(d, name))
            h.update(('%s %d %d\n' % (name, st.st_size, st.st_mtime_ns)).encode())
print(h.hexdigest())
PY
}

# 戻す写しを、古い image のコンテナの利用者（compose と同じ uid・gid・追加の group）で書けるか。
writable_by_app() {
  dk run --rm --network none --user "$uid:$gid" ${admin_gid:+--group-add "$admin_gid"} \
    --entrypoint sh -v "$1:/data" "$old" -c \
    'touch /data/.write-probe && rm /data/.write-probe && test -w /data/research-desk.sqlite && { [ ! -d /data/attachments ] || test -w /data/attachments; }' \
    >/dev/null 2>&1
}

stopped=0
finished=0
attention="" # 戻せても人が見るべき理由（終了 5）
device_id=""
published_before=""

# 戻すときは Core だけを先に起こし、応答してから、Core の network を使うほかのサービスを起こす。
# まとめて up すると、古い Core がすぐ落ちたとき（DB の schema が新しくて開けないなど）に、ほかの
# サービスが Core の network に入れず compose ごと失敗し、DB を戻す二段目に届かない。
up_core() {
  compose up -d --no-build --pull never --force-recreate --no-deps "$CORE" > "$DEPLOY_DIR/.compose.log" 2>&1
}
up_others() { # 起こせて、動いていれば 0
  local others=() i
  for i in "${!services[@]}"; do [ "${services[$i]}" = "$CORE" ] || others+=("${services[$i]}"); done
  [ "${#others[@]}" -gt 0 ] || return 0
  compose up -d --no-build --pull never --force-recreate --no-deps "${others[@]}" >> "$DEPLOY_DIR/.compose.log" 2>&1 || return 1
  for i in "${!services[@]}"; do
    [ "${services[$i]}" = "$CORE" ] && continue
    [ "$(dk inspect --format '{{.State.Running}}' "${containers[$i]}" 2>/dev/null || true)" = true ] || return 1
  done
  return 0
}

# 戻し方は二段。1) image を戻す。2) 古い image でも応答しないときだけ、今の data を別名で残してから、
# 更新前のバックアップを丸ごと写して戻す（SQLite は書き換えるので、ハードリンクではなく写す）。
rollback() {
  trap - EXIT
  set +e
  echo ROLLBACK_IMAGE
  # サービスごとの前の image（入れ替える前の tasken.conf）に戻す。書き換える前に落ちたなら今のまま。
  if [ -n "${ts:-}" ] && [ -f "$CONF.before-$ts" ]; then cp -p "$CONF.before-$ts" "$CONF"; fi
  export_images
  # compose そのものが動かないなら、DB を戻しても直らない。二段目に進まずに止める。
  if ! up_core; then
    echo "COMPOSE_UP_FAILED $(tail -3 "$DEPLOY_DIR/.compose.log" | tr '\n' ' ')"
    echo "RESTORE_FAILED image=$old kept=none（データには触れていない）"
    exit 4
  fi
  if core_healthy "$old"; then
    up_others || attention="${attention:+$attention,}OTHER_SERVICES_NOT_RUNNING"
    if [ -n "$attention" ]; then
      echo "RESTORED_PREVIOUS image=$old attention=$attention"
      exit 5
    fi
    echo "RESTORED_PREVIOUS image=$old"
    exit 3
  fi
  local failed restoring restored=0
  if [ -d "$new_bk" ] && [ ! -L "$data" ]; then
    compose stop >/dev/null 2>&1
    # 新しい版が共有フォルダへ差分を出していたら、DB を戻さない。戻した DB は出した差分を知らず、
    # 同じ連番で別の差分を出す。Desktop は連番で読むので、後の方を黙って読み飛ばす。
    if [ -z "$device_id" ] || [ "$(published_fp "$device_id")" != "$published_before" ]; then
      echo "RESTORE_FAILED image=$old kept=none reason=published_during_trial（DB は戻していない。新しい版が共有フォルダへ差分を出した）"
      exit 4
    fi
    echo ROLLBACK_DB
    # 名前は mktemp で作る（本人の利用者が書ける場所なので、先回りされない名前にする）
    restoring=$(mktemp -d "$parent/.$base.restoring.XXXXXX") &&
      cp -a --reflink=auto -- "$new_bk/." "$restoring/" &&
      chown --reference="$new_bk" "$restoring" && chmod --reference="$new_bk" "$restoring" &&
      rm -f -- "$restoring"/*-shm &&
      # 本番の data の書き込みは Synology の ACL で通っていることがある。rsync -a のバックアップに
      # ACL は入らないので、写しは mode だけになる。持ち主に書かせ、コンテナの利用者で書けると
      # 確かめてから差し替える。書けないなら差し替えない（今の data のまま止めておく）。
      find "$restoring" -type d ! -perm -u=rwx -exec chmod u+rwx {} + &&
      { writable_by_app "$restoring" || { echo "RESTORE_NOT_WRITABLE kept=$restoring"; false; }; } &&
      failed=$(mktemp -d "$parent/$base.failed-$ts.XXXXXX") &&
      mv -- "$data" "$failed/" &&
      mv -- "$restoring" "$data" &&
      restored=1
    # 差し替えまで済んだときだけ起動して確かめる。途中で止まったなら data は元のままか
    # failed- の中で、db_restored と言ってはいけない。
    if [ "$restored" = 1 ]; then
      up_core
      if core_healthy "$old"; then
        others=""
        up_others || others=" attention=OTHER_SERVICES_NOT_RUNNING"
        echo "RESTORED_PREVIOUS image=$old db_restored=1 kept=${failed:-none}/$base$others"
        exit 5
      fi
    fi
  fi
  echo "RESTORE_FAILED image=$old kept=${failed:-none}"
  exit 4
}
on_exit() {
  local code=$?
  if [ "$stopped" = 1 ] && [ "$finished" != 1 ]; then rollback; fi
  exit "$code"
}
trap on_exit EXIT

echo STOP
stopped=1
compose stop >/dev/null
# 止まったことを確かめてから写す。動いている DB を写すと、揃っていない写しになる。
for c in "${containers[@]}"; do
  if [ "$(dk inspect --format '{{.State.Running}}' "$c" 2>/dev/null || true)" = true ]; then
    echo "STOP_FAILED $c"
    attention=STOP_FAILED
    exit 1
  fi
done

echo BACKUP
rm -rf -- "$new_bk.partial"
# --checksum: rsync の既定は大きさと更新時刻だけで「同じ」とみなし、前の世代へハードリンクする。
# 同じ大きさ・同じ秒の DB だと、中身が違っても前の世代の DB がバックアップに入ってしまう。
# -shm は SQLite が開くときに作り直す共有メモリの写しなので写さない。
if [ -n "$prev_bk" ]; then
  rsync -a --checksum --exclude='*.sqlite-shm' --link-dest="$prev_bk/" "$data/" "$new_bk.partial/"
else
  rsync -a --exclude='*.sqlite-shm' "$data/" "$new_bk.partial/"
fi
if ! summary=$(db_py check "$new_bk.partial"); then
  # 止めた本番 DB をそのまま写したものが検査に落ちた＝本番 DB が壊れているかもしれない
  echo "BACKUP_BAD $summary"
  attention=BACKUP_BAD
  exit 1
fi
mv -- "$new_bk.partial" "$new_bk"
echo "BACKUP_OK $summary prev=${prev_bk:+${prev_bk##*/}}"

# 入れ替える前の同期の様子（止めた DB の写しから）。前の版でも同じ失敗をしていたなら、
# 新しい版を、その失敗を理由に戻さない。
device_id=$(db_py meta "$new_bk" device_id || true)
sync_enabled_before=$(db_py meta "$new_bk" shared_sync_enabled || true)
sync_error_before=$(db_py meta "$new_bk" shared_sync_last_error digest || true)
published_before=$(published_fp "$device_id")
echo "SYNC_BEFORE enabled=${sync_enabled_before:-unknown} error=${sync_error_before:-none}"

cp -p "$CONF" "$CONF.before-$ts"
set_images "$tag"
echo RECREATE
if ! compose up -d --no-build --pull never --force-recreate > "$DEPLOY_DIR/.compose.log" 2>&1; then
  echo "COMPOSE_UP_FAILED $(tail -3 "$DEPLOY_DIR/.compose.log" | tr '\n' ' ')"
  exit 1
fi

if ! core_healthy "$tag"; then
  echo HEALTH_FAIL
  exit 1
fi
# 作り直した後の再起動を数える。tunnel は外す（制御面が前の接続を放す前に client が終わって起こし
# 直されることがあり、readyz と同じく外の都合で揺れる）。
restarts() {
  local i
  for i in "${!services[@]}"; do
    [ "${services[$i]}" = tunnel-client ] && continue
    printf '%s=%s ' "${containers[$i]}" "$(dk inspect --format '{{.RestartCount}}' "${containers[$i]}" 2>/dev/null || echo x)"
  done
}
restarts_after_up=$(restarts)

# 新しい版を受け入れるか（ここで落ちたら image だけ戻す。core_healthy には入れない）。
# 1) 同期: 起動の後に同期が通ったか、まだ取り込んでいない差分をこの版で読めるか。
if [ "$sync_enabled_before" = true ]; then
  started=$(dk inspect --format '{{.State.StartedAt}}' "$CORE" 2>/dev/null || true)
  since=$(sed -E 's/(\.[0-9]{3})[0-9]*/\1/' <<< "$started")
  sync_ok=""
  for ((i = 0; i < SYNC_TRIES; i++)); do
    set +e
    st_out=$(dk exec "$CORE" node "$CHECK" state --user-data-dir=/data --sync-dir=/sync --since="$since" 2>&1)
    set -e
    st=$(check_line "$st_out")
    [ -n "$st" ] || { echo "HEALTH_FAIL sync_check_failed $(tail -1 <<< "$st_out" | cut -c1-160)"; exit 1; }
    verdict=$(check_value "$st" verdict)
    digest=$(check_value "$st" sync.last_error_sha256)
    case "$verdict" in
      synced) sync_ok="synced behind=$(check_value "$st" sync.behind)"; break ;;
      incompatible)
        echo "HEALTH_FAIL sync_incompatible $(check_value "$st" sync.pending_invalid)"
        exit 1 ;;
      waiting | error)
        if [ -n "$digest" ] && [ "$digest" = "$sync_error_before" ]; then
          sync_ok="unchanged_error（前の版と同じ失敗）"
          break
        fi ;;
    esac
    if [ $((i + 1)) -lt "$SYNC_TRIES" ]; then "$SLEEP" 10; fi
  done
  if [ -z "$sync_ok" ]; then
    if [ "$verdict" = waiting ]; then
      # 共有フォルダへのコピーの途中で、版のせいではない。取り込めた分までは通っている。
      sync_ok="waiting（差分の到着待ち）"
    else
      echo "HEALTH_FAIL sync_$verdict $(check_value "$st" sync.last_error)"
      exit 1
    fi
  fi
  echo "SYNC $sync_ok"
else
  echo "SYNC skipped（前の版で同期が有効でない: ${sync_enabled_before:-unknown}）"
fi

# 2) MCP: この版の bridge が、この版の Core につながって tool を出せるか（読み取り専用）。
set +e
mcp_out=$(dk exec "$CORE" node "$CHECK" mcp --user-data-dir=/data 2>&1)
set -e
mcp=$(check_line "$mcp_out")
if [ "$(check_value "$mcp" ok)" != true ]; then
  echo "HEALTH_FAIL mcp $(check_value "$mcp" reason)"
  exit 1
fi
echo "MCP tools=$(check_value "$mcp" tools)"

# 3) ほかのサービス: 新しい image で動いていて、作り直してから再起動していない。HTTP MCP は
#    自分の health に答える。tunnel の readyz は外（制御面）の都合で揺れるので合否に入れない。
for i in "${!services[@]}"; do
  c=${containers[$i]}
  [ "$c" = "$CORE" ] && continue
  [ "$(dk inspect --format '{{.State.Running}}' "$c" 2>/dev/null || true)" = true ] || { echo "HEALTH_FAIL not_running $c"; exit 1; }
  [ "$(dk inspect --format '{{.Config.Image}}' "$c" 2>/dev/null || true)" = "$tag" ] || { echo "HEALTH_FAIL image_not_switched $c"; exit 1; }
  if [ "${services[$i]}" = mcp-http ]; then
    ok=0
    for ((j = 0; j < 15; j++)); do
      if dk exec "$c" node -e 'fetch("http://127.0.0.1:"+process.env.TASKEN_MCP_HTTP_PORT+"/health",{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then
        ok=1
        break
      fi
      "$SLEEP" 2
    done
    [ "$ok" = 1 ] || { echo "HEALTH_FAIL mcp_http $c"; exit 1; }
  fi
  if [ "${services[$i]}" = tunnel-client ]; then
    if dk exec "$c" node -e 'fetch("http://127.0.0.1:18080/readyz",{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then
      echo "TUNNEL ready"
    else
      echo "TUNNEL not_ready_yet（合否に入れない）"
    fi
  fi
done
restarts_now=$(restarts)
[ "$restarts_now" = "$restarts_after_up" ] || { echo "HEALTH_FAIL restarting $restarts_now"; exit 1; }

finished=1
trap - EXIT
# ここから先は入れ替えが済んだ後の片付け。思わぬ失敗で「前の版のまま」と誤って伝えない。
set +e

# 1世代だけ残す。消すのは HEALTH_OK の後だけで、名前の形で厳密に絞る。
# ただし前の世代より記録・送った差分・取り込んだ位置のどれかが減っていたら、前の版がデータを
# 落とした疑いがある。前の世代を自動の片付けの外の名前（kept-）に移して残す（人が見てから消す）。
# 数えられなかったときも残す側に倒す。
code=0
if [ -n "$prev_bk" ]; then
  prev_n=$(db_py count "$prev_bk" 2>/dev/null) || prev_n=""
  new_n=$(db_py count "$new_bk" 2>/dev/null) || new_n=""
  shrank=""
  counted='^[0-9]+ [0-9]+ [0-9]+$'
  if [[ ! "$prev_n" =~ $counted || ! "$new_n" =~ $counted ]]; then
    shrank=" uncountable"
  else
    read -r pe po pc <<< "$prev_n"
    read -r ne no nc <<< "$new_n"
    [ "$ne" -lt "$pe" ] && shrank+=" entities=$pe->$ne"
    [ "$no" -lt "$po" ] && shrank+=" sync_outbox=$po->$no"
    [ "$nc" -lt "$pc" ] && shrank+=" cursors=$pc->$nc"
  fi
  if [ -n "$shrank" ]; then
    kept="$BACKUP_DIR/$base.kept-${prev_bk##*.before-}"
    mv -- "$prev_bk" "$kept"
    echo "RECORDS_SHRANK$shrank kept=${kept##*/}"
    code=7
  fi
fi
for d in "$BACKUP_DIR/$base".before-*; do
  [ -e "$d" ] || continue
  [ "$d" = "$new_bk" ] && continue
  is_generation "$d" && rm -rf -- "$d"
done
ls -1t "$CONF".before-* 2>/dev/null | tail -n +2 | while read -r f; do rm -f -- "$f"; done

echo "UPDATED $old -> $tag source=$source_sha"
echo HEALTH_OK
exit "$code"
