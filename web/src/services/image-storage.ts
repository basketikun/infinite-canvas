"use client";

import localforage from "localforage";

import { readImageMeta } from "@/lib/image-utils";
import { useUserStore } from "@/stores/use-user-store";

export type UploadedImage = {
  url: string; // 可直接喂给 <img src>：本地刚上传的会拿到 ObjectURL，否则是 /api/images/{id}
  storageKey: string; // 服务器返回的 image id（形如 "img-xxxx"）
  width: number;
  height: number;
  bytes: number;
  mimeType: string;
};

// storageKey → ObjectURL 本地缓存，仅用于刚上传后的即时渲染避免多一次往返。
const objectUrls = new Map<string, string>();

// 旧的 IndexedDB 桶（image_files_{userId}）只用于兜底读取迁移前已经写入的 Blob，
// 新代码不再往这里写。以后所有图片走服务器。
const legacyStoreCache = new Map<string, LocalForage>();
function getLegacyStore() {
  const userId = (typeof window === "undefined" ? "" : useUserStore.getState().user?.id) || "guest";
  let store = legacyStoreCache.get(userId);
  if (!store) {
    store = localforage.createInstance({ name: "infinite-canvas", storeName: `image_files_${userId}` });
    legacyStoreCache.set(userId, store);
  }
  return store;
}

function authHeader(): Record<string, string> {
  const token = typeof window === "undefined" ? "" : useUserStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function isLegacyKey(key: string) {
  return key.startsWith("image:");
}

// imageUrl 把服务端 storageKey 拼成可直接渲染的相对 URL。
// 因为后端 GET /api/images/:id 已经做了公开访问（id 是 uuid 不可枚举），
// <img src> 不需要再带 Authorization。
export function imageUrl(storageKey: string) {
  return `/api/images/${encodeURIComponent(storageKey)}`;
}

// 上传体积上限：与服务器 nginx `client_max_body_size 50M` 保持一致，超出直接前端拒绝。
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const OVERSIZE_TIP = "图片素材太大了（最多 50MB），请压缩或裁剪后再上传";

// uploadImage 把任意输入（dataURL 字符串 / Blob）上传到后端 /api/images，
// 返回包含新 storageKey 和可直接喂给 <img> 的 url。
export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
  const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error(OVERSIZE_TIP);
  }
  const mimeType = blob.type || "image/png";
  const ext = mimeType.split("/")[1]?.split(";")[0] || "png";
  const formData = new FormData();
  formData.append("file", blob, `upload.${ext}`);

  const response = await fetch("/api/images", {
    method: "POST",
    headers: authHeader(),
    body: formData,
  });
  if (!response.ok) {
    if (response.status === 413) {
      throw new Error(OVERSIZE_TIP);
    }
    // 后端业务异常时仍可能返 4xx/5xx + JSON envelope，尽量取其中的中文 msg
    let backendMsg = "";
    try {
      const text = await response.text();
      if (text) {
        const parsed = JSON.parse(text) as { msg?: string };
        backendMsg = parsed?.msg || "";
      }
    } catch {
      // 非 JSON body，忽略
    }
    throw new Error(backendMsg || `图片上传失败（HTTP ${response.status}）`);
  }
  const envelope = (await response.json()) as {
    code: number;
    data: { id: string; url?: string; mimeType: string; size: number };
    msg?: string;
  };
  if (envelope.code !== 0) {
    throw new Error(envelope.msg || "图片上传失败");
  }
  const storageKey = envelope.data.id;
  // 本地 blob → ObjectURL 缓存，刚上传完渲染走它，避免立即再回服务器拉一次
  const localUrl = URL.createObjectURL(blob);
  objectUrls.set(storageKey, localUrl);
  const meta = await readImageMeta(localUrl);
  return {
    url: localUrl,
    storageKey,
    width: meta.width,
    height: meta.height,
    bytes: envelope.data.size,
    mimeType: envelope.data.mimeType || mimeType,
  };
}

// resolveImageUrl 把 storageKey 还原成可在 <img> 中使用的 URL。
// - 新 key 优先用本地 ObjectURL 缓存（刚上传过），否则返回相对 URL 让浏览器原生加载
// - 老 "image:" 前缀走 IndexedDB 兜底
export async function resolveImageUrl(storageKey?: string, fallback = ""): Promise<string> {
  if (!storageKey) return fallback;
  const cached = objectUrls.get(storageKey);
  if (cached) return cached;
  if (isLegacyKey(storageKey)) {
    try {
      const blob = await getLegacyStore().getItem<Blob>(storageKey);
      if (!blob) return fallback;
      const url = URL.createObjectURL(blob);
      objectUrls.set(storageKey, url);
      return url;
    } catch {
      return fallback;
    }
  }
  return imageUrl(storageKey);
}

// imageToDataUrl 仍然需要把图片转成 data: URL，用于发到 OpenAI 的 multipart 图生图。
// 这里不走 ObjectURL/相对 URL，直接 fetch 拿 blob 再转 base64。
export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
  if (image.dataUrl?.startsWith("data:")) return image.dataUrl;
  const source = image.storageKey
    ? imageUrl(image.storageKey)
    : image.url || "";
  if (!source) return "";
  if (source.startsWith("data:")) return source;
  return blobToDataUrl(await (await fetch(source)).blob());
}

// deleteStoredImages 撤销本地 ObjectURL 缓存并通知服务器删除（老的 IndexedDB key 本地清掉就好）。
export async function deleteStoredImages(keys: Iterable<string>) {
  await Promise.all(Array.from(new Set(keys)).map(async (key) => {
    const url = objectUrls.get(key);
    if (url) URL.revokeObjectURL(url);
    objectUrls.delete(key);
    if (isLegacyKey(key)) {
      try {
        await getLegacyStore().removeItem(key);
      } catch {
        // ignore
      }
      return;
    }
    try {
      await fetch(`/api/images/${encodeURIComponent(key)}`, {
        method: "DELETE",
        headers: authHeader(),
      });
    } catch {
      // ignore
    }
  }));
}

// cleanupUnusedImages 历史上用于 IndexedDB 孤儿清理；图片上云后由服务端归属判断接管，
// 这里保留导出但作为空操作，调用点不需要改动。
export async function cleanupUnusedImages(usedData: unknown) {
  void usedData;
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
  if (!value || typeof value !== "object") return keys;
  if ("storageKey" in value && typeof (value as { storageKey?: unknown }).storageKey === "string") {
    keys.add((value as { storageKey: string }).storageKey);
  }
  Object.values(value).forEach((item) => Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys));
  return keys;
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(blob);
  });
}
