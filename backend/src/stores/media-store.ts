import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { BackendDatabase, MediaFile } from "../db.js";
import { MEDIA_DIR } from "../config.js";
import { extensionForMime, mediaKindForMime, type LogFilter, type LogDeleteScope, type MediaStore, type MediaStats, type RuntimeMedia } from "./types.js";

const MAX_MEDIA_BYTES = 200 * 1024 * 1024;

/** 媒体 store：media_files 表 + runtime-media/ 文件系统。 */
export function createMediaStore(db: BackendDatabase): MediaStore {
    const kindFor = (mime: string, fileName = "") => mediaKindForMime(mime, fileName);

    return {
        /** 入库媒体（web 双写 / 生成结果落地），storageKey 由后台生成。 */
        store(data, options) {
            if (!data.length) throw new Error("媒体为空");
            if (data.length > MAX_MEDIA_BYTES) throw new Error("媒体超过 200 MB 限制");
            const mimeType = options.mimeType || "application/octet-stream";
            const name = path.basename(options.name || "media.bin");
            const storageKey = `${kindFor(mimeType, name)}:${randomUUID()}`;
            const extension = path.extname(name).replace(/[^a-z0-9.]/gi, "").slice(0, 12) || extensionForMime(mimeType);
            const filePath = path.join(MEDIA_DIR, `${randomUUID()}${extension}`);
            fs.mkdirSync(MEDIA_DIR, { recursive: true, mode: 0o700 });
            fs.writeFileSync(filePath, data, { mode: 0o600 });
            const media: MediaFile = {
                storageKey,
                filePath,
                mimeType,
                bytes: data.length,
                width: options.width ?? null,
                height: options.height ?? null,
                durationMs: options.durationMs ?? null,
                createdAt: new Date().toISOString(),
            };
            db.upsertMediaFile(media);
            return media;
        },

        /** 按 base64 dataUrl 落地（兼容旧 Agent /runtime/media 与 H3 ref 落地），返回稳定可读路径。 */
        storeDataUrl(dataUrl: string, name: string, extra: MediaStats = {}): MediaFile & { path: string; url: string } {
            const match = /^data:([^;,]+);base64,(.+)$/s.exec(String(dataUrl).trim());
            if (!match) throw new Error("媒体必须是 base64 data URL");
            const [, mimeType, b64] = match;
            const media = this.store(Buffer.from(b64, "base64"), { name, mimeType, ...extra });
            return { ...media, path: media.filePath, url: this.url(media) };
        },

        /** 按 name 幂等读写 runtime 媒体（H3 ref 落地）。 */
        storeNamed(name, data, mimeType = "application/octet-stream"): RuntimeMedia & { id: string; url: string } {
            const safeName = path.basename(name);
            if (!safeName) throw new Error("运行时媒体文件名无效");
            const id = cryptoStableId(`runtime-media:${safeName}`);
            const filePath = path.join(MEDIA_DIR, safeName);
            if (fs.existsSync(filePath) && fs.statSync(filePath).size === data.length) {
                return { id, name: safeName, path: filePath, size: data.length, bytes: data.length, mimeType, url: runtimeMediaUrl(safeName) };
            }
            fs.mkdirSync(MEDIA_DIR, { recursive: true, mode: 0o700 });
            fs.writeFileSync(filePath, data, { mode: 0o600 });
            return { id, name: safeName, path: filePath, size: data.length, bytes: data.length, mimeType, url: runtimeMediaUrl(safeName) };
        },

        meta: (storageKey) => db.getMediaFile(storageKey),
        list: () => db.listMediaFiles(),

        async read(storageKey: string): Promise<Buffer> {
            const media = db.getMediaFile(storageKey);
            if (!media) throw new Error("media not found");
            try {
                return fs.readFileSync(media.filePath);
            } catch {
                throw new Error("媒体文件丢失");
            }
        },

        /** runtime 媒体按文件名读（对应旧 Agent /runtime/media-file）。 */
        readNamed(name: string): Buffer {
            const safeName = path.basename(name);
            if (!safeName || safeName.includes("..")) throw new Error("运行时媒体文件名无效");
            return fs.readFileSync(path.join(MEDIA_DIR, safeName));
        },

        url: (m) => `/media/${encodeURIComponent(m.storageKey)}`,

        delete(storageKey: string): number {
            const media = db.getMediaFile(storageKey);
            if (!media) return 0;
            db.deleteMediaFile(storageKey);
            try { fs.unlinkSync(media.filePath); } catch { /* 文件可能已不在 */ }
            return 1;
        },
    };
}

/** 稳定 id：同名同一 id，改名换 id。 */
function cryptoStableId(source: string): string {
    // 简单稳定 hash（非加密场景够用）
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < source.length; i++) {
        const ch = source.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507) ^ Math.imul(h2 ^ h2 >>> 13, 3266489909);
    h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507) ^ Math.imul(h1 ^ h1 >>> 13, 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

function runtimeMediaUrl(name: string) {
    return `/media-file?name=${encodeURIComponent(name)}`;
}

export type { LogFilter, LogDeleteScope };
