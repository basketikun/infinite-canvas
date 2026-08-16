import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";

type SharedStorageMeta = {
    key: string;
    type: string;
    mimeType: string;
    updatedAt: string;
};

function encodeSegment(value: string) {
    return Buffer.from(value, "utf8").toString("base64url");
}

function isLoopbackRequest(request: IncomingMessage) {
    const address = request.socket.remoteAddress || "";
    return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(value));
}

function entryPaths(root: string, store: string, key: string) {
    const storeDirectory = join(root, encodeSegment(store));
    const keySegment = encodeSegment(key);
    return {
        storeDirectory,
        dataPath: join(storeDirectory, `${keySegment}.data`),
        metaPath: join(storeDirectory, `${keySegment}.meta.json`),
    };
}

async function readRequestBody(request: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
}

async function writeAtomically(path: string, data: string | Buffer) {
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, data);
    await rename(temporaryPath, path);
}

async function readMeta(path: string) {
    try {
        return JSON.parse(await readFile(path, "utf8")) as SharedStorageMeta;
    } catch {
        return null;
    }
}

async function listKeys(root: string, store: string) {
    const storeDirectory = join(root, encodeSegment(store));
    try {
        const entries = await readdir(storeDirectory);
        const keys: string[] = [];
        for (const entry of entries.filter((name) => name.endsWith(".meta.json"))) {
            const meta = await readMeta(join(storeDirectory, entry));
            if (meta?.key) keys.push(meta.key);
        }
        return keys;
    } catch {
        return [];
    }
}

async function handleSharedStorage(request: IncomingMessage, response: ServerResponse, root: string) {
    if (!isLoopbackRequest(request)) {
        sendJson(response, 403, { error: "Shared storage is only available from this computer" });
        return;
    }

    const requestUrl = new URL(request.url || "/", "http://localhost");
    const action = requestUrl.pathname.split("/").filter(Boolean).pop() || "";
    const store = requestUrl.searchParams.get("store");
    const key = requestUrl.searchParams.get("key");
    if (!store || (action === "item" && key === null)) {
        sendJson(response, 400, { error: "store and key are required" });
        return;
    }

    if (action === "keys" && request.method === "GET") {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify(await listKeys(root, store)));
        return;
    }

    if (action === "keys" && request.method === "DELETE") {
        await rm(join(root, encodeSegment(store)), { recursive: true, force: true });
        response.statusCode = 204;
        response.end();
        return;
    }

    if (action !== "item" || key === null) {
        sendJson(response, 404, { error: "Shared storage endpoint not found" });
        return;
    }

    const paths = entryPaths(root, store, key);
    if (request.method === "GET") {
        const meta = await readMeta(paths.metaPath);
        if (!meta) {
            sendJson(response, 404, { error: "Shared storage item not found" });
            return;
        }
        try {
            const data = await readFile(paths.dataPath);
            response.setHeader("X-Shared-Storage-Type", meta.type);
            response.setHeader("Content-Type", meta.mimeType || "application/octet-stream");
            response.setHeader("Cache-Control", "no-store");
            response.end(data);
        } catch {
            sendJson(response, 404, { error: "Shared storage item not found" });
        }
        return;
    }

    if (request.method === "PUT") {
        const body = await readRequestBody(request);
        const typeHeader = request.headers["x-shared-storage-type"];
        const contentTypeHeader = request.headers["content-type"];
        const type = Array.isArray(typeHeader) ? typeHeader[0] : typeHeader || "json";
        const mimeType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader || "application/octet-stream";
        await mkdir(paths.storeDirectory, { recursive: true });
        await writeAtomically(paths.dataPath, body);
        await writeAtomically(
            paths.metaPath,
            JSON.stringify({ key, type, mimeType, updatedAt: new Date().toISOString() } satisfies SharedStorageMeta),
        );
        response.statusCode = 204;
        response.end();
        return;
    }

    if (request.method === "DELETE") {
        await Promise.all([rm(paths.dataPath, { force: true }), rm(paths.metaPath, { force: true })]);
        response.statusCode = 204;
        response.end();
        return;
    }

    response.setHeader("Allow", "GET, PUT, DELETE");
    sendJson(response, 405, { error: "Method not allowed" });
}

function attachSharedStorage(server: ViteDevServer | PreviewServer, root: string) {
    server.middlewares.use("/api/shared-storage", (request, response, next) => {
        void handleSharedStorage(request, response, root).catch((error) => {
            console.error("[shared-storage] request failed", error);
            if (!response.headersSent) sendJson(response, 500, { error: "Shared storage request failed" });
            else response.end();
        });
        if (!request.url) next();
    });
}

export function sharedStorage(root: string): Plugin {
    return {
        name: "shared-local-storage",
        configureServer: (server) => attachSharedStorage(server, root),
        configurePreviewServer: (server) => attachSharedStorage(server, root),
    };
}
