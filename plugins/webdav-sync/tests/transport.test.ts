import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type RequestListener } from "node:http";
import { test, type TestContext } from "node:test";
import { webdavTransport } from "../src/transports/webdav";

async function remote(t: TestContext, handle: RequestListener) {
    const server = createServer((req, res) => {
        if (req.method === "MKCOL") { res.writeHead(201).end(); return; }
        handle(req, res);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const scope = new AbortController(), reads: string[] = [];
    const driver = await webdavTransport.open({
        url, directory: ["sync"], values: {}, signal: scope.signal,
        async request(path, init) {
            if (init.method === "GET" && path.at(-1) === "manifest.json") assert.equal(init.cache, "no-store");
            const response = await fetch(url + "/" + path.map(encodeURIComponent).join("/"), init);
            const blob = response.blob.bind(response);
            t.mock.method(response, "blob", () => { reads.push(path.at(-1)!); return blob(); });
            return response;
        },
    });
    return { driver, reads, scope };
}

test("清单只用同一份完整 GET 的强 ETag；不完整、缺失标记与认证失败均不读取正文", async (t) => {
    let status = 200, headers: Record<string, string> = {}, requests = 0;
    const { driver, reads } = await remote(t, (req, res) => {
        assert.equal(req.method, "GET");
        requests++;
        res.writeHead(status, headers).end("同次响应的正文");
    });
    const path = "canvas/manifest.json";
    for (const revision of ['""', '"a,b\\r!#"']) {
        headers = { ETag: revision };
        const snapshot = await driver.readManifest(path);
        assert.equal(snapshot?.revision, revision);
        assert.equal(await snapshot.blob.text(), "同次响应的正文");
    }
    const failures: [number, Record<string, string>, string][] = [
        [200, {}, "REVISION_UNAVAILABLE"], [200, { ETag: 'W/"weak"' }, "REVISION_UNAVAILABLE"],
        [200, { ETag: '"space inside"' }, "REVISION_UNAVAILABLE"], [200, { ETag: '"a", "b"' }, "REVISION_UNAVAILABLE"],
        [206, { ETag: '"strong"' }, "REVISION_UNAVAILABLE"], [304, { ETag: '"strong"' }, "REVISION_UNAVAILABLE"],
        [200, { ETag: '"strong"', "Content-Range": "bytes 0-1/4" }, "REVISION_UNAVAILABLE"], [204, {}, "REVISION_UNAVAILABLE"],
        [401, {}, "AUTH"], [403, {}, "AUTH"], [503, {}, "READ"],
    ];
    for (const [code, fields, error] of failures) {
        status = code; headers = fields;
        await assert.rejects(driver.readManifest(path), { code: error });
    }
    status = 507; headers = {};
    await assert.rejects(driver.readManifest(path), { code: "READ", detail: "HTTP 507" });
    status = 404;
    assert.equal(await driver.readManifest(path), null);
    assert.equal(requests, failures.length + 4);
    assert.deepEqual(reads, ["manifest.json", "manifest.json"]);
});

test("清单创建和替换使用对应条件，旧版本与异常回执不重试；附件继续按原路径读写", async (t) => {
    const observed: { match?: string; none?: string; path: string }[] = [];
    let revision: string | null = null, body = "", forced: number | undefined;
    const { driver } = await remote(t, async (req, res) => {
        if (req.method === "GET") {
            if (revision === null) res.writeHead(404).end();
            else res.writeHead(200, { ETag: revision }).end(body);
            return;
        }
        assert.equal(req.method, "PUT");
        const match = req.headers["if-match"], none = req.headers["if-none-match"];
        observed.push({ match, none, path: req.url! });
        if (forced !== undefined) { res.writeHead(forced).end(); return; }
        if (req.url?.endsWith("/raw")) { res.writeHead(201).end(); return; }
        if (none === "*" ? revision !== null : match !== revision) { res.writeHead(412).end(); return; }
        const status = revision === null ? 201 : 204;
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk);
        body = Buffer.concat(chunks).toString();
        revision = `"version,${observed.length}"`;
        res.writeHead(status).end();
    });
    const path = "canvas/manifest.json", initial = new Blob(["初次"]), update = new Blob(["新版"]);
    assert.equal(await driver.readManifest(path), null);
    await driver.publishManifest(path, initial, null);
    assert.deepEqual(observed[0], { none: "*", match: undefined, path: "/sync/canvas/manifest.json" });
    const read = await driver.readManifest(path);
    assert.ok(read);
    await assert.rejects(driver.publishManifest(path, update, null), { code: "REMOTE_CONFLICT" });
    await driver.publishManifest(path, update, read.revision);
    assert.deepEqual(observed.at(-1), { none: undefined, match: read.revision, path: "/sync/canvas/manifest.json" });
    await assert.rejects(driver.publishManifest(path, initial, read.revision), { code: "REMOTE_CONFLICT" });
    assert.equal(body, "新版");
    const before = observed.length;
    for (const invalid of ["*", 'W/"weak"', '"x"\n', undefined]) {
        await assert.rejects(driver.publishManifest(path, update, invalid as string), { code: "REVISION_UNAVAILABLE" });
    }
    assert.equal(observed.length, before);
    for (const [expected, code, error] of [
        [null, 200, "REVISION_UNAVAILABLE"], [null, 204, "REVISION_UNAVAILABLE"],
        [read.revision, 201, "REVISION_UNAVAILABLE"], [read.revision, 202, "REVISION_UNAVAILABLE"],
        [read.revision, 401, "AUTH"], [read.revision, 503, "WRITE"],
    ] as const) {
        const count = observed.length;
        forced = code;
        await assert.rejects(driver.publishManifest(path, update, expected), { code: error });
        assert.equal(observed.length, count + 1);
    }
    forced = 200;
    await driver.publishManifest(path, update, read.revision);
    forced = undefined;
    await driver.write("canvas/files/raw", initial, "text/plain");
    assert.deepEqual(observed.at(-1), { none: undefined, match: undefined, path: "/sync/canvas/files/raw" });
});

test("调用方或设置关闭时中断正在读取的完整清单，保留原取消原因", async (t) => {
    for (const cancelScope of [false, true]) {
        const entered = Promise.withResolvers<void>(), stopped = Promise.withResolvers<void>();
        const { driver, scope } = await remote(t, (_req, res) => {
            res.writeHead(200, { ETag: '"active"' });
            res.write("部分内容");
            entered.resolve();
            res.on("close", stopped.resolve);
        });
        const caller = new AbortController(), reason = new Error("关闭");
        const result = assert.rejects(driver.readManifest("canvas/manifest.json", caller.signal), (error) => error === reason);
        await entered.promise;
        (cancelScope ? scope : caller).abort(reason);
        await Promise.all([result, stopped.promise]);
    }
});
