import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const MEDIA_DIR = path.join(os.homedir(), ".infinite-canvas", "runtime-media");
const MAX_MEDIA_BYTES = 200 * 1024 * 1024;

export async function storeRuntimeMedia(name: string, dataUrl: string) {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl.trim());
    if (!match) throw new Error("媒体必须是 base64 data URL");
    const data = Buffer.from(match[2], "base64");
    if (!data.length || data.length > MAX_MEDIA_BYTES) throw new Error("媒体为空或超过 200 MB 限制");
    const extension = path.extname(name).replace(/[^a-z0-9.]/gi, "").slice(0, 12) || extensionForMime(match[1]);
    const id = crypto.randomUUID();
    const file = path.join(MEDIA_DIR, `${id}${extension}`);
    await mkdir(MEDIA_DIR, { recursive: true, mode: 0o700 });
    await writeFile(file, data, { mode: 0o600 });
    return { id, path: file, name: path.basename(name) || `${id}${extension}`, mimeType: match[1], bytes: data.length };
}

export function runtimeMediaFile(name: string) {
    const safe = path.basename(name);
    if (!safe || safe !== name || safe.includes("..")) throw new Error("运行时媒体文件名无效");
    return path.join(MEDIA_DIR, safe);
}

function extensionForMime(mime: string) {
    if (mime.includes("png")) return ".png";
    if (mime.includes("jpeg")) return ".jpg";
    if (mime.includes("webp")) return ".webp";
    if (mime.includes("mp4")) return ".mp4";
    if (mime.includes("webm")) return ".webm";
    return ".bin";
}
