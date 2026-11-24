import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { once } from "node:events";
import { packTar } from "modern-tar";
import { FsStorage } from "../storage/fs-storage.js";
import { PluginManager } from "./manager.js";
import { PLUGIN_PACKAGE_MAX_BYTES, createPluginPackage } from "@infinite-canvas/shared/plugins";
import { createCanvasHttpApp } from "../server/http.js";
import { CanvasSession } from "../canvas/session.js";

const archiveOf = async (files: Record<string, string>) => gzipSync(await packTar(Object.entries(files).map(([name, body]) => ({ header: { name: `package/${name}`, size: Buffer.byteLength(body), type: "file" as const }, body }))));

test("目录约定生成插件身份：入口、图标与说明按固定文件名查找，id 取包名", () => {
    const pkg = createPluginPackage({ name: "@acme/canvas-plugin-fixture", version: "1.0.0" }, (file) => ["dist/client.js", "icon.svg", "README.md"].includes(file));
    assert.deepEqual({ id: pkg.infiniteCanvas.id, client: pkg.infiniteCanvas.client, icon: pkg.infiniteCanvas.icon, readme: pkg.infiniteCanvas.readme }, { id: "fixture", client: "dist/client.js", icon: "icon.svg", readme: "README.md" });
    assert.equal(createPluginPackage({ name: "local" }, (file) => file === "client.js").version, "local");
    assert.throws(() => createPluginPackage({ name: "fixture" }, () => false), { code: "PLUGIN_INVALID" });
    for (const name of ["data", "files", "builtin", "Bad_Name"]) assert.throws(() => createPluginPackage({ name }, () => true), { code: "PLUGIN_INVALID" });
});

test("手写插件目录靠扫描发现，默认停用，启停、读取与卸载都以目录为准", async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), "canvas-plugin-folder-"));
    const storage = await FsStorage.open(directory);
    const manager = new PluginManager(storage, true);
    t.after(async () => { await manager.close(); await storage.close(); await rm(directory, { recursive: true, force: true }); });
    await mkdir(path.join(directory, "plugins", "hand"), { recursive: true });
    await writeFile(path.join(directory, "plugins", "hand", "client.js"), "export default {};");
    await mkdir(path.join(directory, "plugins", "empty"), { recursive: true });
    const [record, ...others] = await manager.list();
    assert.equal(others.length, 0);
    assert.deepEqual({ id: record.package.infiniteCanvas.id, version: record.package.version, enabled: record.enabled, skipped: record.startupSkipped }, { id: "hand", version: "local", enabled: false, skipped: true });
    assert.equal(await manager.source("hand", "local"), "export default {};");
    await manager.enable("hand", true);
    assert.deepEqual([(await manager.list())[0].enabled, (await manager.list())[0].startupSkipped], [true, undefined]);
    await assert.rejects(manager.enable("missing", true), { code: "PLUGIN_NOT_FOUND" });
    await writeFile(path.join(directory, "plugins", "hand", "client.js"), "export default { name: '变更' };");
    assert.notEqual((await manager.list())[0].clientFiles!.generation, record.clientFiles!.generation);
    await manager.remove("hand");
    assert.equal((await manager.list()).length, 0);
});

test("上传与软件源安装解压到插件目录，同名替换保留启用状态，文件访问仅限同源且只开放客户端文件", async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), "canvas-plugin-install-"));
    const storage = await FsStorage.open(path.join(directory, "workspace"));
    const manager = new PluginManager(storage);
    let version = "1.0.0", css = ".fixture { color: red }";
    const bundle = () => archiveOf({
        "package.json": JSON.stringify({ name: "canvas-plugin-fixture", version, description: "测试" }),
        "dist/client.js": "export default {};", "dist/client.js.files.json": JSON.stringify({ files: ["dist/client.js", "dist/plugin.css"], styles: ["dist/plugin.css"] }),
        "dist/plugin.css": css, "icon.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>', "GUIDE.md": "# 插件教程", "secret.txt": "private",
    });
    let origin = "";
    const registry = createServer(async (req, res) => {
        const bytes = await bundle();
        if (req.url === "/fixture.tgz") { res.end(bytes); return; }
        if (req.url === "/index.json") {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ version: 1, plugins: [{ name: "canvas-plugin-fixture", title: "夹具", versions: { [version]: { tarball: "fixture.tgz", integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`, host: ">=1.0.0", pluginApi: 3 } } }] }));
            return;
        }
        res.writeHead(404).end();
    }).listen(0, "127.0.0.1");
    const http = createCanvasHttpApp({ url: "" }, new CanvasSession(), { storage, plugins: manager }).listen(0, "127.0.0.1");
    await Promise.all([once(registry, "listening"), once(http, "listening")]);
    t.after(async () => {
        for (const server of [registry, http]) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
        await manager.close(); await storage.close(); await rm(directory, { recursive: true, force: true });
    });
    origin = `http://127.0.0.1:${(registry.address() as { port: number }).port}`;
    await manager.configure({ registry: `${origin}/index.json` });
    const first = await manager.install({ name: "canvas-plugin-fixture", version: "latest", host: "1.0.0" });
    assert.deepEqual([first.package.infiniteCanvas.id, first.enabled, first.package.description], ["fixture", true, "测试"]);
    assert.equal(await manager.source("fixture", "1.0.0"), "export default {};");
    assert.equal(await manager.asset("fixture", "1.0.0", "readme"), "# 插件教程");
    assert.match(await manager.asset("fixture", "1.0.0", "icon"), /^data:image\/svg\+xml;base64,/);
    await assert.rejects(manager.asset("fixture", "2.0.0", "readme"));
    const api = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
    const headers = {};
    const resource = (generation: string) => `${api}/api/plugins/fixture/files/1.0.0/${generation}/${randomUUID()}`;
    const original = resource(first.clientFiles!.generation);
    assert.equal((await fetch(`${original}/dist/plugin.css`, { headers: { origin: "http://evil.example" } })).status, 403);
    const stylesheet = await fetch(`${original}/dist/plugin.css`, { headers });
    assert.match(stylesheet.headers.get("content-type")!, /text\/css/);
    assert.equal(await stylesheet.text(), css);
    for (const privateFile of ["package.json", "secret.txt", "dist/client.js.files.json"]) assert.equal((await fetch(`${original}/${privateFile}`, { headers })).status, 404);
    await manager.enable("fixture", false);
    version = "2.0.0";
    css = ".fixture { color: blue }";
    const updated = await manager.install({ name: "canvas-plugin-fixture", version: "latest", host: "1.0.0" });
    assert.equal(updated.enabled, false);
    assert.equal((await manager.list()).length, 1);
    assert.equal(await (await fetch(`${api}/api/plugins/fixture/files/2.0.0/${updated.clientFiles!.generation}/${randomUUID()}/dist/plugin.css`, { headers })).text(), css);
    await assert.rejects(manager.source("fixture", "2.0.0", first.clientFiles!.generation), { code: "PLUGIN_NOT_FOUND" });
    assert.equal((await fetch(`${api}/api/plugins`)).status, 200);
    assert.equal((await fetch(`${api}/api/plugins`, { headers: { ...headers, origin: "https://outside.example" } })).status, 403);
    const upload = { "content-type": "application/octet-stream" };
    const archive = await archiveOf({ "package.json": JSON.stringify({ name: "canvas-plugin-upload-fixture", version: "1.0.0" }), "client.js": "export default {};" });
    assert.deepEqual(await (await fetch(`${api}/api/plugins/package/inspect`, { method: "POST", headers: upload, body: archive })).json(), { id: "upload-fixture", name: "canvas-plugin-upload-fixture", version: "1.0.0" });
    const installed = await (await fetch(`${api}/api/plugins/package`, { method: "POST", headers: upload, body: archive })).json();
    assert.deepEqual([installed.uploaded, installed.registry], [true, ""]);
    await mkdir(path.join(directory, "workspace", "plugins", "conflict"), { recursive: true });
    await writeFile(path.join(directory, "workspace", "plugins", "conflict", "client.js"), "export default {};");
    await assert.rejects(manager.installPackage(await archiveOf({ "package.json": JSON.stringify({ name: "@x/canvas-plugin-conflict", version: "1.0.0" }), "client.js": "export default {};" })), { code: "PLUGIN_CONFLICT" });
    const broken = await fetch(`${api}/api/plugins/package`, { method: "POST", headers: upload, body: new Uint8Array([1, 2, 3]) });
    assert.deepEqual([broken.status, await broken.json()], [400, { code: "PLUGIN_PACKAGE_INVALID" }]);
    const large = await fetch(`${api}/api/plugins/package`, { method: "POST", headers: upload, body: new Uint8Array(PLUGIN_PACKAGE_MAX_BYTES + 1) });
    assert.deepEqual([large.status, await large.json()], [413, { code: "PLUGIN_PACKAGE_TOO_LARGE" }]);
    await manager.remove("fixture");
    await assert.rejects(manager.readClientFile("fixture", "2.0.0", updated.clientFiles!.generation, "dist/plugin.css"), { code: "PLUGIN_NOT_FOUND" });
    assert.equal(await readFile(path.join(directory, "workspace", "plugins", "upload-fixture", "client.js"), "utf8"), "export default {};");
});
