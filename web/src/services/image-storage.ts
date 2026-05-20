"use client";

import localforage from "localforage";

import { createId } from "@/lib/id";
import { readImageMeta } from "@/lib/image-utils";
import { useUserStore } from "@/stores/use-user-store";

export type UploadedImage = {
  url: string;
  storageKey: string;
  width: number;
  height: number;
  bytes: number;
  mimeType: string;
};

const storeCache = new Map<string, LocalForage>();
const objectUrls = new Map<string, string>();

function currentUserId() {
  if (typeof window === "undefined") return "guest";
  return useUserStore.getState().user?.id || "guest";
}

function getStore() {
  const userId = currentUserId();
  let store = storeCache.get(userId);
  if (!store) {
    store = localforage.createInstance({ name: "infinite-canvas", storeName: `image_files_${userId}` });
    storeCache.set(userId, store);
  }
  return store;
}

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
  const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
  const storageKey = `image:${createId()}`;
  await getStore().setItem(storageKey, blob);
  const url = URL.createObjectURL(blob);
  objectUrls.set(storageKey, url);
  const meta = await readImageMeta(url);
  return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType };
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
  if (!storageKey) return fallback;
  const cached = objectUrls.get(storageKey);
  if (cached) return cached;
  const blob = await getStore().getItem<Blob>(storageKey);
  if (!blob) return fallback;
  const url = URL.createObjectURL(blob);
  objectUrls.set(storageKey, url);
  return url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
  const url = image.dataUrl || await resolveImageUrl(image.storageKey, image.url || "");
  if (!url || url.startsWith("data:")) return url;
  return blobToDataUrl(await (await fetch(url)).blob());
}

export async function deleteStoredImages(keys: Iterable<string>) {
  const store = getStore();
  await Promise.all(Array.from(new Set(keys)).map(async (key) => {
    const url = objectUrls.get(key);
    if (url) URL.revokeObjectURL(url);
    objectUrls.delete(key);
    await store.removeItem(key);
  }));
}

export async function cleanupUnusedImages(usedData: unknown) {
  const usedKeys = collectImageStorageKeys(usedData);
  const unused: string[] = [];
  await getStore().iterate((_value, key) => {
    if (!usedKeys.has(key)) unused.push(key);
  });
  await deleteStoredImages(unused);
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
  if (!value || typeof value !== "object") return keys;
  if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith("image:")) keys.add(value.storageKey);
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
