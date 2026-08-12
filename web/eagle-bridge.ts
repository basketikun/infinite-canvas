import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";

const EAGLE_ORIGIN = "http://127.0.0.1:41595";
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "heic", "heif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "m4v", "avi", "mkv", "wmv", "flv", "mpeg", "mpg", "3gp"]);

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

async function eagleJson<T>(path: string): Promise<T> {
    const response = await fetch(`${EAGLE_ORIGIN}${path}`);
    const payload = (await response.json()) as EagleApiResponse<T>;
    if (!response.ok || payload.status === "error") throw new Error(payload.message || `Eagle API returned HTTP ${response.status}`);
    return payload.data;
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
    return null;
}

function normalizeAsset(item: EagleItem, folderMap: Map<string, EagleFolder>) {
    const kind = assetKind(item);
    if (!kind) return null;
    const folderIds = item.folders || [];
    const folderNames = folderIds.map((id) => folderMap.get(id)?.name).filter((name): name is string => Boolean(name));
    const encodedId = encodeURIComponent(item.id);
    const fileUrl = `/api/eagle/items/${encodedId}/file`;
    const thumbnailUrl = `/api/eagle/items/${encodedId}/thumbnail`;
    const timestamp = item.btime || item.mtime || item.modificationTime || Date.now();
    const extension = item.ext.replace(/^\./, "").toLowerCase();
    const mimeType = `${kind}/${extension || (kind === "image" ? "png" : "mp4")}`;
    return {
        id: `eagle:${item.id}`,
        kind,
        title: item.name,
        coverUrl: thumbnailUrl,
        tags: item.tags || [],
        source: `Eagle · ${folderNames.join(" / ") || "未分类"}`,
        note: item.annotation || undefined,
        createdAt: new Date(timestamp).toISOString(),
        updatedAt: new Date(item.mtime || item.modificationTime || timestamp).toISOString(),
        metadata: { source: "eagle", provider: "eagle", eagleItemId: item.id, eagleFolderIds: folderIds, eagleFolderNames: folderNames },
        data:
            kind === "image"
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

function sendFile(res: ServerResponse, filePath: string) {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return json(res, 404, { status: "error", message: "Eagle file not found" });
    const extension = extname(filePath).toLowerCase();
    const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : extension === ".gif" ? "image/gif" : extension === ".svg" ? "image/svg+xml" : extension === ".mp4" ? "video/mp4" : extension === ".webm" ? "video/webm" : extension === ".mov" ? "video/quicktime" : "application/octet-stream";
    res.statusCode = 200;
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "no-store");
    createReadStream(filePath).pipe(res);
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
            const [folders, items] = await Promise.all([listEagleFolders(), listEagleItems()]);
            const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
            const assets = items.map((item) => normalizeAsset(item, folderMap)).filter((asset): asset is NonNullable<ReturnType<typeof normalizeAsset>> => Boolean(asset));
            return json(res, 200, { status: "success", data: { assets, folders } });
        }

        const match = pathname.match(/^\/items\/([^/]+)\/(file|thumbnail)$/);
        if (match) return sendFile(res, await eagleFilePath(decodeURIComponent(match[1]), match[2] as "file" | "thumbnail"));
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
