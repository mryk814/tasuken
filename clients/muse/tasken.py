#!/usr/bin/env python3
"""Tasken の HTTP API（NAS の replica）を呼ぶ、Muse の道具。

使い方:
  tasken.py describe [tool]                      GET  /api/v1（この client に出ているツールの一覧と hash。
                                                 tool を渡すとそのツールの説明と inputSchema も）
  tasken.py call <tool> '<json>' [--key <idempotency_key>] [--dry-run]
                                                 POST /api/v1/<tool>（ツールを一つ呼ぶ。引数の名前は
                                                 describe <tool> で確かめる）

call は、書き込みのツール（describe の access が read 以外）で、そのツールの入力に idempotency_key があるとき、
鍵を道具が決めて本文に入れ、出力にも必ず入れる（失敗したときも）。応答が切れたら、同じ内容を同じ --key で
送り直すか、get_proposal_status で確かめる。新しい鍵で送り直さない（同じ投稿や Proposal が増える）。
--dry-run は、ツールの入力に dry_run があるときだけ使える（保存せずに検証する）。

出力は JSON 一行。終了コードは成功 0、失敗 1。HTTP の失敗は http_status が付く。

接続先は環境変数 TASKEN_HOST か、この道具と同じフォルダーの host ファイル（1行。例 <NAS の tailnet 名>:8444）。
資格情報はこの道具に置かない。実行環境が登録済みのホストへの要求にだけ本物の Bearer を入れる（surrogate）。
tailnet へは実行環境のトンネルのプロキシ（HTTPS_PROXY のポートを 3130 にしたもの）を通る。証明書の検証は
有効のまま、redirect は断る。

TASKEN_BASE_URL と TASKEN_TEST_TOKEN は試験用（tasken のテストが手元のサーバーへ直に向ける）。そのときは
実行環境の資格情報もプロキシも使わない。
"""

import base64
import json
import os
import re
import secrets
import stat
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
TEST_BASE = os.environ.get("TASKEN_BASE_URL", "")
MAX_MEDIA_BYTES = 12 * 1024 * 1024
MAX_MEDIA_TOTAL_BYTES = 24 * 1024 * 1024
SAFE_FILE_NAME_FORBIDDEN = re.compile(r'[<>:"/\\|?*\x00-\x1f\x7f]')
NOTE_IMAGE_MEDIA_TYPES = ("image/png", "image/jpeg")
DOCUMENT_ASSET_MEDIA_TYPES = (
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "video/mp4",
    "video/webm",
)


def host():
    name = os.environ.get("TASKEN_HOST", "").strip()
    if not name:
        try:
            with open(os.path.join(HERE, "host"), encoding="utf-8") as f:
                name = f.read().strip()
        except OSError:
            pass
    if not name:
        raise RuntimeError(
            "接続先がありません。TASKEN_HOST か、この道具と同じフォルダーの host ファイルに書いてください。"
        )
    return name


def credential_host():
    """The host name without the port. Muse matches the credential against the URL's hostname,
    which never carries a port, so `name:8444` would refuse every request (#720)."""
    return urllib.parse.urlsplit("//" + host()).hostname


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise RuntimeError("redirect refused, verify the endpoint")


def opener_for(request):
    if TEST_BASE:
        return urllib.request.build_opener(NoRedirect())
    sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
    from dynamic_credentials import add_surrogate_to_request

    add_surrogate_to_request(request, "custom.tasken", allowed_hosts=[credential_host()])
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if not proxy:
        raise RuntimeError(
            "HTTPS_PROXY is not set; cannot build the tailnet tunnel proxy"
        )
    proxy = re.sub(r":\d+/?$", ":3130", proxy)
    return urllib.request.build_opener(
        NoRedirect(), urllib.request.ProxyHandler({"https": proxy, "http": proxy})
    )


def send(method, path, body=None, timeout=30):
    """Returns (status, JSON). A broken connection is returned as 599, not raised."""
    base = TEST_BASE or f"https://{host()}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"} if data is not None else {}
    if TEST_BASE and os.environ.get("TASKEN_TEST_TOKEN"):
        # Tests only: a token of the test server, so the request is a client's as on the NAS.
        headers["Authorization"] = "Bearer " + os.environ["TASKEN_TEST_TOKEN"]
    request = urllib.request.Request(
        base + path, data=data, headers=headers, method=method
    )
    try:
        with opener_for(request).open(request, timeout=timeout) as response:
            return response.status, json.loads(
                response.read().decode("utf-8") or "null"
            )
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(text)
        except ValueError:
            return e.code, {"error": text[:2000]}
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        # No answer at all: returned, not raised, so the reply still prints the idempotency_key to resend
        # with. A new key would make another post or Proposal.
        return 599, {
            "error": f"応答がありませんでした（{e}）。保存されたかは分かりません。"
            "同じ --key で送り直すか、get_proposal_status で確かめてください。"
        }


def show(status, out, key=None):
    """Prints the answer. A write's idempotency_key is always in it, also when the call failed."""
    if not isinstance(out, dict):
        out = {"result": out}
    if status >= 400:
        out = {"http_status": status, **out}
    if key:
        out.setdefault("idempotency_key", key)
    print(json.dumps(out, ensure_ascii=False))
    return 0 if status < 400 else 1


def fail(message, key=None, **extra):
    """A refusal made here, before anything was sent."""
    out = {"error": message, **extra}
    if key:
        out["idempotency_key"] = key
    print(json.dumps(out, ensure_ascii=False))
    return 1


def options(args, names):
    """Pulls --name value (or a bare --flag) out of args; returns (values, the rest)."""
    values, rest, i = {}, [], 0
    while i < len(args):
        name = args[i][2:] if args[i].startswith("--") else None
        if names.get(name):
            if i + 1 >= len(args):
                raise SystemExit(f"--{name} に値がありません")
            values[name] = args[i + 1]
            i += 2
        elif name in names:
            values[name] = True
            i += 1
        else:
            rest.append(args[i])
            i += 1
    return values, rest


def first_line(text):
    return (text or "").strip().split("\n", 1)[0]


def detect_media_type(raw, allowed):
    detected = None
    if len(raw) >= 8 and raw[:8] == b"\x89PNG\r\n\x1a\n":
        detected = "image/png"
    elif len(raw) >= 3 and raw[:3] == b"\xff\xd8\xff":
        detected = "image/jpeg"
    elif len(raw) >= 6 and raw[:6] in (b"GIF87a", b"GIF89a"):
        detected = "image/gif"
    elif len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        detected = "image/webp"
    elif len(raw) >= 8 and raw[4:8] == b"ftyp":
        detected = "video/mp4"
    elif len(raw) >= 4 and raw[:4] == b"\x1a\x45\xdf\xa3":
        detected = "video/webm"
    return detected if detected in allowed else None


def resolve_local_media(items, allowed, label):
    """Resolve `file_path` entries on Muse's local filesystem into `data_base64` before HTTP send."""
    if not isinstance(items, list):
        return items, None
    if len(items) > 8:
        return None, f"{label}は 8 点までです。何も送っていません。"
    resolved = []
    total_bytes = 0
    for item in items:
        if isinstance(item, dict) and "file_path" in item and item["file_path"] is None:
            return None, "file_path に null は指定できません。何も送っていません。"
        if not isinstance(item, dict) or item.get("file_path") is None:
            if isinstance(item, dict) and isinstance(item.get("data_base64"), str):
                b64 = item["data_base64"]
                padding = 2 if b64.endswith("==") else 1 if b64.endswith("=") else 0
                total_bytes += max(0, len(b64) * 3 // 4 - padding)
                if total_bytes > MAX_MEDIA_TOTAL_BYTES:
                    return None, f"{label}の合計が 24 MiB を超えています。何も送っていません。"
            resolved.append(item)
            continue
        if item.get("data_base64") is not None:
            return None, "file_path と data_base64 は同時に指定できません。何も送っていません。"
        raw_path = item["file_path"]
        ref_id = item.get("reference_id") or ""
        if not isinstance(raw_path, str) or not raw_path.strip() or "\x00" in raw_path:
            return None, f"{label}の file_path が不正です（{ref_id}）。何も送っていません。"
        file_path = os.path.expanduser(raw_path.strip())
        try:
            # FIFO などで open() が止まらないよう O_NONBLOCK で開き、通常ファイルだけ読む。
            fd = os.open(file_path, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0))
            with os.fdopen(fd, "rb") as f:
                info = os.fstat(f.fileno())
                if not stat.S_ISREG(info.st_mode):
                    return (
                        None,
                        f"{label}の file_path は通常のファイルを指定してください（{ref_id}）。何も送っていません。",
                    )
                if info.st_size <= 0:
                    return None, f"{label}のファイルが空です（{ref_id}）。何も送っていません。"
                if info.st_size > MAX_MEDIA_BYTES:
                    return (
                        None,
                        f"{label}1点が 12 MiB を超えています（{ref_id}）。何も送っていません。",
                    )
                raw = f.read(MAX_MEDIA_BYTES + 1)
        except OSError as e:
            return None, f"{label}のファイルを読み込めませんでした（{ref_id}: {e.strerror or e}）。何も送っていません。"
        if len(raw) <= 0 or len(raw) > MAX_MEDIA_BYTES:
            return None, f"{label}のサイズが範囲外です（{ref_id}）。何も送っていません。"
        total_bytes += len(raw)
        if total_bytes > MAX_MEDIA_TOTAL_BYTES:
            return None, f"{label}の合計が 24 MiB を超えています。何も送っていません。"
        detected = detect_media_type(raw, allowed)
        if detected is None:
            return (
                None,
                f"{label}の形式が対応していません（{ref_id}）。対応形式: {', '.join(allowed)}。何も送っていません。",
            )
        explicit_type = item.get("media_type")
        if explicit_type is not None and explicit_type != detected:
            return (
                None,
                f"{label}の media_type（{explicit_type}）がファイル内容（{detected}）と一致しません（{ref_id}）。何も送っていません。",
            )
        file_name = (
            item["file_name"].strip()
            if isinstance(item.get("file_name"), str) and item["file_name"].strip()
            else os.path.basename(file_path)
        )
        if "file_name" in item and not (
            isinstance(item["file_name"], str) and item["file_name"].strip()
        ):
            return (
                None,
                f"{label}の file_name が不正です（{ref_id}）。省略するかファイル名を指定してください。何も送っていません。",
            )
        if (
            not file_name
            or len(file_name) > 180
            or file_name in (".", "..")
            or SAFE_FILE_NAME_FORBIDDEN.search(file_name)
        ):
            return (
                None,
                f"{label}の file_name に使えない文字があるか長すぎます（{ref_id}）。file_name を明示してください。何も送っていません。",
            )
        converted = {k: v for k, v in item.items() if k != "file_path"}
        converted["file_name"] = file_name
        converted["media_type"] = detected
        converted["data_base64"] = base64.b64encode(raw).decode("ascii")
        resolved.append(converted)
    return resolved, None


def cmd_describe(args):
    if len(args) > 1:
        raise SystemExit("usage: tasken.py describe [tool]")
    status, out = send("GET", "/api/v1")
    if status >= 400 or not isinstance(out, dict):
        return show(status, out)
    tools = out.get("tools", [])
    if args:
        tool = next((t for t in tools if t.get("name") == args[0]), None)
        if tool is None:
            return fail(
                "unknown_tool", tool=args[0], tools=[t.get("name") for t in tools]
            )
        return show(status, {"hash": out.get("hash"), **tool})
    listed = [
        {
            "name": t["name"],
            "access": t.get("access"),
            "description": first_line(t.get("description")),
        }
        for t in tools
    ]
    return show(status, {"tools": listed, "hash": out.get("hash")})


def cmd_call(args):
    opts, rest = options(args, {"key": True, "dry-run": False})
    if len(rest) != 2:
        raise SystemExit(
            "usage: tasken.py call <tool> '<json>' [--key <idempotency_key>] [--dry-run]"
        )
    name = rest[0]
    try:
        body = json.loads(rest[1])
    except ValueError as e:
        return fail(f"引数が JSON ではありません（{e}）。何も送っていません。")
    if not isinstance(body, dict):
        return fail("引数は JSON のオブジェクトで渡してください。何も送っていません。")

    # The tool's shape decides whether it writes and whether it takes a key; read it from the server.
    status, listing = send("GET", "/api/v1")
    if status >= 400 or not isinstance(listing, dict):
        return show(
            status,
            {"step": "describe", **(listing if isinstance(listing, dict) else {})},
        )
    tool = next((t for t in listing.get("tools", []) if t.get("name") == name), None)
    if tool is None:
        return fail(
            "tool_not_listed: この client に出ていないツールです。何も送っていません。",
            tool=name,
            tools=[t.get("name") for t in listing.get("tools", [])],
        )
    properties = (tool.get("inputSchema") or {}).get("properties") or {}
    is_write = tool.get("access") != "read"

    key = None
    if is_write and "idempotency_key" in properties:
        if body.get("idempotency_key") is not None and opts.get("key") not in (
            None,
            body["idempotency_key"],
        ):
            return fail(
                "--key と本文の idempotency_key が違います。何も送っていません。"
            )
        key = body.get("idempotency_key") or opts.get("key") or secrets.token_hex(16)
        body["idempotency_key"] = key
    elif opts.get("key"):
        return fail("このツールは idempotency_key を取りません。何も送っていません。")

    if opts.get("dry-run"):
        if "dry_run" not in properties:
            return fail("このツールは dry_run を取りません。何も送っていません。", key)
        body["dry_run"] = True

    if "images" in properties and "images" in body:
        resolved_images, err = resolve_local_media(body["images"], NOTE_IMAGE_MEDIA_TYPES, "画像")
        if err:
            return fail(err, key)
        body["images"] = resolved_images
    if (
        "article" in properties
        and isinstance(body.get("article"), dict)
        and "images" in body["article"]
    ):
        resolved_images, err = resolve_local_media(
            body["article"]["images"], NOTE_IMAGE_MEDIA_TYPES, "画像"
        )
        if err:
            return fail(err, key)
        body["article"] = {**body["article"], "images": resolved_images}
    if "assets" in properties and "assets" in body:
        resolved_assets, err = resolve_local_media(
            body["assets"], DOCUMENT_ASSET_MEDIA_TYPES, "アセット"
        )
        if err:
            return fail(err, key)
        body["assets"] = resolved_assets

    status, out = send("POST", "/api/v1/" + urllib.parse.quote(name), body, timeout=60)
    return show(status, out, key)


COMMANDS = {"describe": cmd_describe, "call": cmd_call}


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(__doc__, file=sys.stderr)
        return 2
    return COMMANDS[sys.argv[1]](sys.argv[2:])


if __name__ == "__main__":
    sys.exit(main())
