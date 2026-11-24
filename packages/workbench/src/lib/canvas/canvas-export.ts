import { saveAs } from "file-saver";
import { serializeStorageData } from "@infinite-canvas/shared/storage-data";
import type { ReadonlyCanvasNode } from "@infinite-canvas/plugin-sdk";
import type { ReadonlySnapshot } from "@infinite-canvas/plugin-sdk/readonly-snapshot";

import { createZip } from "@workbench/lib/zip";
import { readMediaBlob } from "@workbench/services/file-storage";
import { readImageBlob } from "@workbench/services/image-storage";
import { exportProjectArchive } from "./work-archive";
import type { CanvasProject } from "@workbench/stores/canvas/use-canvas-store";
import type { readNodeResource } from "./node-registry";

export async function exportCanvasProjects(projects: readonly ReadonlySnapshot<CanvasProject>[], fileName = "无限画布", signal = new AbortController().signal) {
    signal.throwIfAborted();
    const zip = await exportProjectArchive(projects, signal);
    signal.throwIfAborted();
    saveAs(zip, `${safeFileName(fileName)}.zip`);
}

export async function exportCanvasNodes(targets: readonly { node: ReadonlyCanvasNode; resource: ReturnType<typeof readNodeResource> }[], signal: AbortSignal) {
    signal.throwIfAborted();
    const used = new Set<string>();
    const uniqueName = (base: string, ext: string) => {
        const safe = safeFileName(base) || "元素";
        let name = `${safe}.${ext}`;
        for (let i = 1; used.has(name); i += 1) name = `${safe}-${i}.${ext}`;
        used.add(name);
        return name;
    };

    const results = await Promise.allSettled(targets.map(async ({ node, resource }) => {
        signal.throwIfAborted();
        const title = node.title || node.type;
        if (!resource) return { title, ext: "json", data: JSON.stringify(serializeStorageData(node), null, 2) };
        if (resource.kind === "text") return { title, ext: "txt", data: resource.text! };
        const blob = resource.kind === "image"
            ? await readImageBlob(resource.storageKey, resource.url, { signal })
            : await readMediaBlob(resource.storageKey, resource.url, { signal });
        return { title, ext: fileExtension(blob.type, resource.storageKey ?? ""), data: blob };
    }));
    signal.throwIfAborted();
    const files = results.map((result) => {
        if (result.status === "rejected") throw result.reason;
        const { title, ext, data } = result.value;
        return { name: uniqueName(title, ext), data };
    });
    const zip = await createZip(files);
    signal.throwIfAborted();
    saveAs(zip, `画布元素-${targets.length}个.zip`);
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string, storageKey: string) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("ogg")) return "ogg";
    return storageKey.startsWith("image:") ? "png" : "bin";
}
