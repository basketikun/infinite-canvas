import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";

const EAGLE_ORIGIN = "http://127.0.0.1:41595";
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "heic", "heif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "m4v", "avi", "mkv", "wmv", "flv", "mpeg", "mpg", "3gp"]);
const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown"]);

type EagleFolder = { id: string; name: string; parent?: string };
type EagleItem = {
    id: string;
    name: string;
    ext: string;
    size?: number;
    btime?: number;
    mtime?: number;
    modificationTime?: number;
    tags?: string[];
    folders?: string[];
    annotation?: string;
    width?: number;
    height?: number;
};
type EagleItemWrite = {
    base64?: string;
    url?: string;
    path?: string;
    name?: string;
    tags?: string[];
    folders?: string[];
    annotation?: string;
};
type EagleApiResponse<T> = { status: "success" | "error"; data: T; message?: string };

function json(res: ServerResponse, status: number, value: unknown) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(value));
}

function isLoopback(req: IncomingMessage) {
    const address = req.socket.remoteAddress || "";
    return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

async function eagleJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${EAGLE_ORIGIN}${path}`, init);
    const payload = (await response.json()) as EagleApiResponse<T>;
    if (!response.ok || payload.status === "error") throw new Error(payload.message || `Eagle API returned HTTP ${response.status}`);
    return payload.data;
}

async function readRequestBody(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (!chunks.length) return {} as Record<string, unknown>;
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

async function addEagleItem(input: EagleItemWrite) {
    if (!input.base64 && !input.url && !input.path) throw new Error("Eagle asset requires base64, url, or path");
    return eagleJson<{ id?: string; ids?: string[] }>("/api/v2/item/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    });
}

function textFileName(name?: string) {
    const safeName = basename((name || "文本资产").trim()).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_") || "文本资产";
    return /\.[a-z0-9]{1,8}$/i.test(safeName) ? safeName : `${safeName}.txt`;
}

async function addEagleText(input: { content: string; name?: string; tags?: string[]; folders?: string[]; annotation?: string }) {
    if (input.content.length > 10 * 1024 * 1024) throw new Error("Eagle text asset is larger than 10 MB");
    const temporaryPath = join(tmpdir(), `infinite-canvas-eagle-${randomUUID()}.txt`);
    await writeFile(temporaryPath, input.content, "utf8");
    let copied = false;
    try {
        const created = await addEagleItem({ path: temporaryPath, name: textFileName(input.name), tags: input.tags, folders: input.folders, annotation: input.annotation });
        const id = created.id || created.ids?.[0];
        if (!id) throw new Error("Eagle did not return the text asset id");
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline) {
            const payload = await eagleJson<{ data: EagleItem[] }>("/api/v2/item/get", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: [id] }),
            });
            if (payload.data?.some((item) => item.id === id)) {
                copied = true;
                return created;
            }
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
        throw new Error("Eagle did not finish importing the text asset");
    } finally {
        if (copied) await unlink(temporaryPath).catch(() => undefined);
    }
}

async function updateEagleItem(id: string, patch: Pick<EagleItemWrite, "name" | "tags" | "annotation"> & { content?: string }) {
    if (typeof patch.content === "string") {
        const payload = await eagleJson<{ data: EagleItem[] }>("/api/v2/item/get", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [id] }),
        });
        const current = payload.data?.[0];
        if (!current) throw new Error("Eagle text asset was not found");
        const created = await addEagleText({ content: patch.content, name: patch.name || current.name, tags: patch.tags ?? current.tags, folders: current.folders, annotation: patch.annotation ?? current.annotation });
        try {
            await moveEagleItemToTrash(id);
        } catch (error) {
            if (created.id) await moveEagleItemToTrash(created.id).catch(() => undefined);
            throw error;
        }
        return { ...created, replacedId: id };
    }
    return eagleJson<boolean>("/api/v2/item/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
    });
}

async function moveEagleItemToTrash(id: string) {
    return eagleJson<boolean>("/api/item/moveToTrash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: [id] }),
    });
}

async function listEagleFolders() {
    const payload = await eagleJson<{ data: EagleFolder[] }>("/api/v2/folder/get?limit=1000");
    return payload.data || [];
}

async function listEagleItems() {
    const first = await eagleJson<{ data: EagleItem[]; total: number }>("/api/v2/item/get?limit=1000&offset=0");
    const items = [...(first.data || [])];
    for (let offset = items.length; offset < first.total; offset += 1000) {
        const next = await eagleJson<{ data: EagleItem[] }>(`/api/v2/item/get?limit=1000&offset=${offset}`);
        items.push(...(next.data || []));
    }
    return items;
}

function assetKind(item: EagleItem) {
    const ext = item.ext.replace(/^\./, "").toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) return "image" as const;
    if (VIDEO_EXTENSIONS.has(ext)) return "video" as const;
    if (TEXT_EXTENSIONS.has(ext)) return "text" as const;
    return null;
}

async function normalizeAsset(item: EagleItem, folderMap: Map<string, EagleFolder>) {
    const kind = assetKind(item);
    if (!kind) return null;
    const folderIds = item.folders || [];
    const folderNames = folderIds.map((id) => folderMap.get(id)?.name).filter((name): name is string => Boolean(name));
    const encodedId = encodeURIComponent(item.id);
    const fileUrl = `/api/eagle/items/${encodedId}/file`;
    const thumbnailUrl = `/api/eagle/items/${encodedId}/thumbnail`;
    const timestamp = item.btime || item.mtime || item.modificationTime || Date.now();
    const extension = item.ext.replace(/^\./, "").toLowerCase();
    const mimeType = kind === "text" ? "text/plain" : `${kind}/${extension || (kind === "image" ? "png" : "mp4")}`;
    let textContent = "";
    if (kind === "text") {
        try {
            textContent = await readFile(await eagleFilePath(item.id, "file"), "utf8");
        } catch {
            textContent = item.annotation || "";
        }
    }
    return {
        id: `eagle:${item.id}`,
        kind,
        title: item.name,
        coverUrl: kind === "text" ? "" : thumbnailUrl,
        tags: item.tags || [],
        source: `Eagle · ${folderNames.join(" / ") || "未分类"}`,
        note: item.annotation || undefined,
        createdAt: new Date(timestamp).toISOString(),
        updatedAt: new Date(item.mtime || item.modificationTime || timestamp).toISOString(),
        metadata: { source: "eagle", provider: "eagle", eagleItemId: item.id, eagleFolderIds: folderIds, eagleFolderNames: folderNames },
        data:
            kind === "text"
                ? { content: textContent }
                : kind === "image"
                  ? { dataUrl: fileUrl, width: item.width || 0, height: item.height || 0, bytes: item.size || 0, mimeType }
                  : { url: fileUrl, width: item.width || 0, height: item.height || 0, bytes: item.size || 0, mimeType },
    };
}

async function eagleLibraryPath() {
    const info = await eagleJson<{ path: string }>("/api/v2/library/info");
    return normalize(info.path);
}

function assertInside(childPath: string, parentPath: string) {
    const child = resolve(childPath);
    const parent = resolve(parentPath);
    const rel = relative(parent, child);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith("..\\") || rel.startsWith("../")) throw new Error("Eagle file path is outside the configured library");
    return child;
}

async function eagleFilePath(id: string, kind: "file" | "thumbnail") {
    const thumbnail = await eagleJson<string>(`/api/item/thumbnail?id=${encodeURIComponent(id)}`);
    const thumbnailPath = normalize(decodeURIComponent(thumbnail));
    const imagesRoot = join(await eagleLibraryPath(), "images");
    const safeThumbnailPath = assertInside(thumbnailPath, imagesRoot);
    if (kind === "thumbnail") return safeThumbnailPath;

    const item = await eagleJson<EagleItem>(`/api/item/info?id=${encodeURIComponent(id)}`);
    const directory = assertInside(dirname(safeThumbnailPath), imagesRoot);
    const thumbnailStem = basename(safeThumbnailPath).replace(/_thumbnail\.[^.]+$/i, "");
    const wantedPath = join(directory, `${thumbnailStem}.${item.ext.replace(/^\./, "")}`);
    if (existsSync(wantedPath)) return assertInside(wantedPath, imagesRoot);

    const fallback = readdirSync(directory).find((file) => file !== "metadata.json" && !file.toLowerCase().includes("_thumbnail"));
    if (!fallback) throw new Error("Eagle original file was not found");
    return assertInside(join(directory, fallback), imagesRoot);
}

function sendFile(req: IncomingMessage, res: ServerResponse, filePath: string) {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return json(res, 404, { status: "error", message: "Eagle file not found" });
    const fileSize = statSync(filePath).size;
    const extension = extname(filePath).toLowerCase();
    const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : extension === ".gif" ? "image/gif" : extension === ".svg" ? "image/svg+xml" : extension === ".heic" ? "image/heic" : extension === ".heif" ? "image/heif" : extension === ".mp4" ? "video/mp4" : extension === ".webm" ? "video/webm" : extension === ".mov" ? "video/quicktime" : "application/octet-stream";
    const range = req.headers.range;
    let start = 0;
    let end = fileSize - 1;
    if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) {
            res.statusCode = 416;
            res.setHeader("Content-Range", `bytes */${fileSize}`);
            return res.end();
        }
        if (!match[1]) {
            const suffixLength = Number(match[2]);
            if (!suffixLength) {
                res.statusCode = 416;
                res.setHeader("Content-Range", `bytes */${fileSize}`);
                return res.end();
            }
            start = Math.max(fileSize - suffixLength, 0);
            end = fileSize - 1;
        } else {
            start = Number(match[1]);
            end = match[2] ? Number(match[2]) : fileSize - 1;
        }
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= fileSize || end < start) {
            res.statusCode = 416;
            res.setHeader("Content-Range", `bytes */${fileSize}`);
            return res.end();
        }
        end = Math.min(end, fileSize - 1);
        res.statusCode = 206;
        res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
    } else {
        res.statusCode = 200;
    }
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", String(end - start + 1));
    if (req.method === "HEAD") return res.end();
    const stream = createReadStream(filePath, { start, end });
    stream.on("error", (error) => {
        if (res.headersSent) {
            res.destroy();
            return;
        }
        json(res, 502, { status: "error", message: error instanceof Error ? error.message : "Eagle file could not be read" });
    });
    stream.pipe(res);
}

async function handleEagleRequest(req: IncomingMessage, res: ServerResponse, next: () => void) {
    if (!isLoopback(req)) return json(res, 403, { status: "error", message: "Eagle bridge is local-only" });
    const requestUrl = new URL(req.url || "/", "http://localhost");
    const pathname = requestUrl.pathname.replace(/\/$/, "") || "/";
    try {
        if (pathname === "/status") {
            const info = await eagleJson<{ version: string; buildVersion?: string; platform?: string }>("/api/v2/app/info");
            return json(res, 200, { status: "success", connected: true, data: info });
        }
        if (pathname === "/folders") return json(res, 200, { status: "success", data: await listEagleFolders() });
        if (pathname === "/items") {
            if (req.method === "POST") {
                const body = await readRequestBody(req);
                const tags = Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string") : undefined;
                const folders = Array.isArray(body.folders) ? body.folders.filter((folder): folder is string => typeof folder === "string") : undefined;
                const created = body.kind === "text" && typeof body.content === "string"
                    ? await addEagleText({ content: body.content, name: typeof body.name === "string" ? body.name : undefined, tags, folders, annotation: typeof body.annotation === "string" ? body.annotation : undefined })
                    : await addEagleItem({
                          base64: typeof body.base64 === "string" ? body.base64 : undefined,
                          url: typeof body.url === "string" ? body.url : undefined,
                          name: typeof body.name === "string" ? body.name : undefined,
                          tags,
                          folders,
                          annotation: typeof body.annotation === "string" ? body.annotation : undefined,
                      });
                return json(res, 200, { status: "success", data: created });
            }
            const [folders, items] = await Promise.all([listEagleFolders(), listEagleItems()]);
            const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
            const assets = (await Promise.all(items.map((item) => normalizeAsset(item, folderMap)))).filter((asset): asset is NonNullable<Awaited<ReturnType<typeof normalizeAsset>>> => Boolean(asset));
            return json(res, 200, { status: "success", data: { assets, folders } });
        }

        const itemMatch = pathname.match(/^\/items\/([^/]+)$/);
        if (itemMatch) {
            const id = decodeURIComponent(itemMatch[1]);
            if (req.method === "PATCH" || req.method === "PUT") {
                const body = await readRequestBody(req);
                const updated = await updateEagleItem(id, {
                    name: typeof body.name === "string" ? body.name : undefined,
                    tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string") : undefined,
                    annotation: typeof body.annotation === "string" ? body.annotation : undefined,
                    content: typeof body.content === "string" ? body.content : undefined,
                });
                return json(res, 200, { status: "success", data: updated });
            }
            if (req.method === "DELETE") {
                const deleted = await moveEagleItemToTrash(id);
                return json(res, 200, { status: "success", data: deleted });
            }
        }

        const match = pathname.match(/^\/items\/([^/]+)\/(file|thumbnail)$/);
        if (match) return sendFile(req, res, await eagleFilePath(decodeURIComponent(match[1]), match[2] as "file" | "thumbnail"));
        return next();
    } catch (error) {
        return json(res, 502, { status: "error", message: error instanceof Error ? error.message : "Eagle bridge failed" });
    }
}

function attachEagleBridge(server: ViteDevServer | PreviewServer) {
    server.middlewares.use("/api/eagle", (req, res, next) => void handleEagleRequest(req, res, next));
}

export function eagleBridge(): Plugin {
    return { name: "eagle-bridge", configureServer: attachEagleBridge, configurePreviewServer: attachEagleBridge };
}
