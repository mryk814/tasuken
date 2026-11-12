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

import json
import os
import re
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
TEST_BASE = os.environ.get("TASKEN_BASE_URL", "")


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
