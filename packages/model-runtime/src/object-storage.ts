import { AwsClient } from "aws4fetch";
import ipaddr from "ipaddr.js";
import mime from "mime/lite";
import { nanoid } from "nanoid";
import type { ObjectStorageConfig } from "@infinite-canvas/shared/object-storage";

/**
 * 公网域名的可达性由存储服务保证；本地地址和非公网 IP 需要转存。
 */
export function isPublicMediaUrl(source: string) {
    if (!URL.canParse(source)) return false;
    const url = new URL(source);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (ipaddr.isValid(host)) return ipaddr.process(host).range() === "unicast";
    return host.includes(".") && !/(^|\.)(localhost|local|localdomain|internal|lan|test|invalid)\.?$/.test(host);
}

/**
 * 已有公开链接原样返回；仅上传不能被模型服务直接读取的本地素材。
 */
export async function uploadPublicMedia(source: string | Blob, storage: ObjectStorageConfig, toBlob: (source: string | Blob) => Promise<Blob>, mapUrl: (url: string) => string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (typeof source === "string" && isPublicMediaUrl(source)) return source;
    if (!storage.endpoint || !storage.region || !storage.bucket || !storage.accessKeyId || !storage.secretAccessKey || !storage.publicBaseUrl) {
        throw new Error("SCRIPT_STORAGE_REQUIRED");
    }
    if (!isPublicMediaUrl(storage.publicBaseUrl)) throw new Error("SCRIPT_STORAGE_PUBLIC_URL_REQUIRED");
    if (!URL.canParse(storage.endpoint) || !["http:", "https:"].includes(new URL(storage.endpoint).protocol)) {
        throw new Error("SCRIPT_STORAGE_UPLOAD_FAILED");
    }
    try {
        const blob = await toBlob(source);
        const extension = blob.type === "audio/mpeg" ? "mp3" : mime.getExtension(blob.type);
        const key = "references/" + nanoid() + (extension ? "." + extension : "");
        const target = new URL(storage.endpoint);
        if (storage.forcePathStyle) {
            target.pathname = target.pathname.replace(/\/$/, "") + "/" + encodeURIComponent(storage.bucket) + "/" + key;
        } else {
            target.hostname = storage.bucket + "." + target.hostname;
            target.pathname = target.pathname.replace(/\/$/, "") + "/" + key;
        }
        const client = new AwsClient({
            accessKeyId: storage.accessKeyId,
            secretAccessKey: storage.secretAccessKey,
            service: "s3",
            region: storage.region,
        });
        const body = await blob.arrayBuffer();
        const signed = await client.sign(target.href, {
            method: "PUT",
            headers: { "Content-Type": blob.type },
            body,
            signal,
        });
        const response = await fetch(mapUrl(signed.url), {
            method: "PUT",
            headers: signed.headers,
            body,
            signal,
        });
        if (!response.ok) throw new Error("Object upload failed");
        const publicUrl = new URL(storage.publicBaseUrl);
        publicUrl.pathname = publicUrl.pathname.replace(/\/$/, "") + "/" + key;
        return publicUrl.href;
    } catch (error) {
        signal?.throwIfAborted();
        throw new Error("SCRIPT_STORAGE_UPLOAD_FAILED", { cause: error });
    }
}
