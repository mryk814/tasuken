import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { FeedLinkPreviewService } from "../src/main/services/feedLinkPreviewService.ts";

// 実ネットワークへは一切出ない。fetchとDNS解決はすべて注入したfakeで置き換える。
const PUBLIC_ADDRESS = "93.184.216.34";
const publicResolver = async () => [PUBLIC_ADDRESS];

// 検証するのはmagic numberだけなので、中身はPNGとして妥当でなくてよい。
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 0x11),
]);
const NOT_AN_IMAGE_BYTES = Buffer.from("%PDF-1.7\nnot an image\n", "latin1");
const HTML_ACCEPT_HEADER = "text/html,application/xhtml+xml";

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function imageResponse(bytes, contentType = "image/png") {
  return new Response(bytes, { status: 200, headers: { "content-type": contentType } });
}

function redirectResponse(location, status = 302) {
  return new Response(null, { status, headers: { location } });
}

/** content-lengthを付けずに流す。受信中に上限で打ち切る経路を通すため。 */
function oversizedResponse(totalBytes) {
  const chunk = Buffer.alloc(64 * 1024, 0x61);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let written = 0; written < totalBytes; written += chunk.length) {
          controller.enqueue(new Uint8Array(chunk));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/html" } },
  );
}

function createFixture(t, routes, resolveHost = publicResolver) {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-link-preview-"));
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }));
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch: ${url}`);
    return typeof route === "function" ? route(url, init) : route;
  };
  return {
    service: new FeedLinkPreviewService(userDataPath, { fetchImpl, resolveHost }),
    calls,
    thumbnailDirectory: path.join(userDataPath, "attachments", "link-previews"),
  };
}

test("literal IPがloopback/private/link-local/CGNATなら拒否する", async (t) => {
  for (const host of ["127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1"]) {
    const fixture = createFixture(t, {});
    const result = await fixture.service.fetchPreview(`http://${host}/meta`);
    assert.equal(result.ok, false, host);
    assert.equal(typeof result.reason, "string", host);
    assert.ok(result.reason.length > 0, host);
    // 拒否はfetchより前に決まる。外部へは1度も出ない。
    assert.deepEqual(fixture.calls, [], host);
  }
});

test("literal IPv6のloopback/unique-local/link-local/multicast/IPv4-mappedも拒否する", async (t) => {
  for (const url of [
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[fd00::1]/",
    "http://[fe80::1]/",
    "http://[ff02::1]/",
  ]) {
    const fixture = createFixture(t, {});
    const result = await fixture.service.fetchPreview(url);
    assert.equal(result.ok, false, url);
    assert.deepEqual(fixture.calls, [], url);
  }
});

test("公開ホスト名でも解決先がprivateなら拒否する（1つでも混ざれば拒否）", async (t) => {
  const privateOnly = createFixture(t, {}, async () => ["10.1.2.3"]);
  assert.equal((await privateOnly.service.fetchPreview("https://internal.example.com/")).ok, false);
  assert.deepEqual(privateOnly.calls, []);

  const mixed = createFixture(t, {}, async () => [PUBLIC_ADDRESS, "192.168.0.5"]);
  assert.equal((await mixed.service.fetchPreview("https://mixed.example.com/")).ok, false);
  assert.deepEqual(mixed.calls, []);

  const ipv6Private = createFixture(t, {}, async () => ["fe80::1"]);
  assert.equal((await ipv6Private.service.fetchPreview("https://v6.example.com/")).ok, false);

  const unresolved = createFixture(t, {}, async () => {
    throw new Error("ENOTFOUND");
  });
  assert.equal((await unresolved.service.fetchPreview("https://missing.example.com/")).ok, false);
  assert.deepEqual(unresolved.calls, []);
});

test("資格情報付きURL・空URL・非http(s)schemeは拒否し、fetchしない", async (t) => {
  const fixture = createFixture(t, {});
  for (const input of [
    "https://user:secret@example.com/article",
    "https://user@example.com/article",
    "",
    "   ",
    "not a url",
    "file:///C:/Windows/win.ini",
    "javascript:alert(1)",
    "data:text/html,<h1>x</h1>",
    "ftp://example.com/a",
  ]) {
    const result = await fixture.service.fetchPreview(input);
    assert.equal(result.ok, false, input);
    assert.ok(result.reason.length > 0, input);
  }
  assert.deepEqual(fixture.calls, []);
});

test("og:*を優先して抽出し、PNGサムネイルを内容hash名で保存する", async (t) => {
  const html = [
    "<!doctype html><html><head>",
    "<title>Fallback Title</title>",
    '<meta property="og:title" content="OG &amp; Title">',
    '<meta property="og:description" content="  OG <b>description</b>  ">',
    '<meta property="og:site_name" content="Example Site">',
    '<meta property="og:image" content="/assets/thumb.png">',
    '<meta name="description" content="plain description">',
    '<meta name="twitter:image" content="https://cdn.example.com/twitter.png">',
    "</head><body>body</body></html>",
  ].join("");
  const fixture = createFixture(t, {
    "https://example.com/article": () => htmlResponse(html),
    "https://example.com/assets/thumb.png": () => imageResponse(PNG_BYTES),
  });

  const result = await fixture.service.fetchPreview("https://example.com/article");
  assert.equal(result.ok, true);
  const expectedName = `${createHash("sha256").update(PNG_BYTES).digest("hex")}.png`;
  assert.deepEqual(result.preview, {
    url: "https://example.com/article",
    title: "OG & Title",
    description: "OG description",
    siteName: "Example Site",
    imageFileName: expectedName,
  });
  assert.deepEqual(fixture.calls, [
    "https://example.com/article",
    "https://example.com/assets/thumb.png",
  ]);

  // 保存された実バイトがPNGであり、名前が内容のsha256であること。
  const stored = fs.readFileSync(path.join(fixture.thumbnailDirectory, expectedName));
  assert.deepEqual([...stored.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(stored.equals(PNG_BYTES), true);
});

test("og:*が無いときはtitleタグとname=descriptionへ落とし、画像はnullにする", async (t) => {
  const html =
    "<html><head><title>  A &amp; <b>B</b>  </title>" +
    '<meta name="description" content="Only description">' +
    "</head></html>";
  const fixture = createFixture(t, { "https://fallback.example.com/": () => htmlResponse(html) });

  const result = await fixture.service.fetchPreview("https://fallback.example.com/");
  assert.equal(result.ok, true);
  assert.deepEqual(result.preview, {
    url: "https://fallback.example.com/",
    title: "A & B",
    description: "Only description",
    siteName: "",
    imageFileName: null,
  });
  assert.equal(fs.existsSync(fixture.thumbnailDirectory), false);
});

test("3 hopまでの転送は追い、4 hop目は拒否する", async (t) => {
  const fixture = createFixture(t, {
    "https://start.example.com/": () => redirectResponse("https://start.example.com/1"),
    "https://start.example.com/1": () => redirectResponse("https://start.example.com/2", 301),
    "https://start.example.com/2": () => redirectResponse("https://start.example.com/3", 307),
    "https://start.example.com/3": () => htmlResponse("<title>Landed</title>"),
    "https://loop.example.com/": () => redirectResponse("https://loop.example.com/1"),
    "https://loop.example.com/1": () => redirectResponse("https://loop.example.com/2"),
    "https://loop.example.com/2": () => redirectResponse("https://loop.example.com/3"),
    "https://loop.example.com/3": () => redirectResponse("https://loop.example.com/4"),
  });

  const landed = await fixture.service.fetchPreview("https://start.example.com/");
  assert.equal(landed.ok, true);
  assert.equal(landed.preview.url, "https://start.example.com/3");
  assert.equal(landed.preview.title, "Landed");

  const looped = await fixture.service.fetchPreview("https://loop.example.com/");
  assert.equal(looped.ok, false);
  assert.equal(
    fixture.calls.filter((url) => url.startsWith("https://loop.example.com/")).length,
    4,
  );
});

test("転送先がprivate literal IPなら、その先を取得せず拒否する", async (t) => {
  const fixture = createFixture(t, {
    "https://safe.example.com/": () => redirectResponse("http://169.254.169.254/latest/meta-data/"),
  });
  const result = await fixture.service.fetchPreview("https://safe.example.com/");
  assert.equal(result.ok, false);
  assert.deepEqual(fixture.calls, ["https://safe.example.com/"]);
});

test("転送先のホスト名がprivateへ解決する場合も拒否する", async (t) => {
  const fixture = createFixture(
    t,
    { "https://safe.example.com/": () => redirectResponse("http://internal.example.com/") },
    async (hostname) => (hostname === "internal.example.com" ? ["10.0.0.5"] : [PUBLIC_ADDRESS]),
  );
  const result = await fixture.service.fetchPreview("https://safe.example.com/");
  assert.equal(result.ok, false);
  assert.deepEqual(fixture.calls, ["https://safe.example.com/"]);
});

test("転送先のschemeがhttp(s)でなければ拒否する", async (t) => {
  const fixture = createFixture(t, {
    "https://safe.example.com/": () => redirectResponse("file:///C:/Windows/win.ini"),
  });
  const result = await fixture.service.fetchPreview("https://safe.example.com/");
  assert.equal(result.ok, false);
  assert.deepEqual(fixture.calls, ["https://safe.example.com/"]);
});

test("HTMLが512 KiBを超えたら打ち切って失敗にする", async (t) => {
  const fixture = createFixture(t, {
    "https://big.example.com/": () => oversizedResponse(700 * 1024),
  });
  const result = await fixture.service.fetchPreview("https://big.example.com/");
  assert.equal(result.ok, false);
  assert.ok(result.reason.length > 0);
});

test("画像が2 MiBを超えたらサムネイルだけ諦め、Previewは返す", async (t) => {
  const html = '<meta property="og:image" content="https://big.example.com/thumb.png">';
  const fixture = createFixture(t, {
    "https://big.example.com/": () => htmlResponse(html),
    "https://big.example.com/thumb.png": () => oversizedResponse(3 * 1024 * 1024),
  });
  const result = await fixture.service.fetchPreview("https://big.example.com/");
  assert.equal(result.ok, true);
  assert.equal(result.preview.imageFileName, null);
  assert.equal(fs.existsSync(fixture.thumbnailDirectory), false);
});

test("content-typeがimage/pngでも実バイトが画像でなければ保存しない", async (t) => {
  const html = '<meta property="og:image" content="https://example.com/fake.png">';
  const fixture = createFixture(t, {
    "https://example.com/": () => htmlResponse(html),
    "https://example.com/fake.png": () => imageResponse(NOT_AN_IMAGE_BYTES, "image/png"),
  });
  const result = await fixture.service.fetchPreview("https://example.com/");
  assert.equal(result.ok, true);
  assert.equal(result.preview.imageFileName, null);
  assert.equal(fs.existsSync(fixture.thumbnailDirectory), false);
});

test("実バイトがWebPなら宣言されたcontent-typeと食い違ってもmagic numberで保存する", async (t) => {
  const webp = Buffer.concat([
    Buffer.from("RIFF", "latin1"),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from("WEBP", "latin1"),
    Buffer.alloc(16, 0x22),
  ]);
  const html = '<meta property="og:image" content="https://example.com/thumb.bin">';
  const fixture = createFixture(t, {
    "https://example.com/": () => htmlResponse(html),
    "https://example.com/thumb.bin": () => imageResponse(webp, "application/octet-stream"),
  });
  const result = await fixture.service.fetchPreview("https://example.com/");
  assert.equal(result.ok, true);
  const expectedName = `${createHash("sha256").update(webp).digest("hex")}.webp`;
  assert.equal(result.preview.imageFileName, expectedName);
  assert.equal(fs.existsSync(path.join(fixture.thumbnailDirectory, expectedName)), true);
});

test("同じURLの2回目はfetchも名前解決もしない（cache hit）", async (t) => {
  let resolutions = 0;
  const html = "<title>Cached</title>";
  const fixture = createFixture(
    t,
    { "https://example.com/a?x=1": () => htmlResponse(html) },
    async () => {
      resolutions += 1;
      return [PUBLIC_ADDRESS];
    },
  );

  const first = await fixture.service.fetchPreview("https://example.com/a?x=1");
  assert.equal(first.ok, true);
  // fragmentだけ違うURLは同じリンクとして扱う。
  const second = await fixture.service.fetchPreview("https://example.com/a?x=1#section");
  assert.deepEqual(second, first);
  assert.deepEqual(fixture.calls, ["https://example.com/a?x=1"]);
  assert.equal(resolutions, 1);
});

test("失敗も短時間cacheし、renderのたびに取得し直さない", async (t) => {
  const fixture = createFixture(t, {
    "https://broken.example.com/": () => new Response("boom", { status: 500 }),
  });
  const first = await fixture.service.fetchPreview("https://broken.example.com/");
  const second = await fixture.service.fetchPreview("https://broken.example.com/");
  assert.equal(first.ok, false);
  assert.deepEqual(second, first);
  assert.deepEqual(fixture.calls, ["https://broken.example.com/"]);
  // URL・query・取得元のmessageを文言へ混ぜない。
  assert.doesNotMatch(first.reason, /broken|example|boom|500/);
});

test("取得はUser-Agentだけを送り、Cookie/Authorization/Refererを送らない", async (t) => {
  let seenInit = null;
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-link-preview-"));
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }));
  const service = new FeedLinkPreviewService(userDataPath, {
    fetchImpl: async (url, init) => {
      seenInit = init;
      return htmlResponse("<title>Headers</title>");
    },
    resolveHost: publicResolver,
  });

  await service.fetchPreview("https://example.com/");
  assert.equal(seenInit.redirect, "manual");
  assert.equal(seenInit.credentials, "omit");
  assert.equal(seenInit.referrer, "");
  assert.equal(seenInit.referrerPolicy, "no-referrer");
  assert.deepEqual(
    Object.keys(seenInit.headers)
      .map((key) => key.toLowerCase())
      .sort(),
    ["accept", "user-agent"],
  );
  assert.equal(seenInit.headers.accept, HTML_ACCEPT_HEADER);
  assert.equal(typeof seenInit.headers["user-agent"], "string");
  assert.ok(seenInit.signal instanceof AbortSignal);
});
