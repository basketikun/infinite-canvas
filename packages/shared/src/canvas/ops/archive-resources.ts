import type { ArchiveResource } from "../../work-archive.js";
import { CanvasNodeType, type CanvasDocument, type CanvasNodeData, type PluginProjectDomainRecord, type PluginStandaloneWork } from "../schema/canvas.js";

type MapResource = (resource: ArchiveResource) => string;
type NodeMedia = Extract<ArchiveResource, { collection: "images" | "media" }>;
const builtinTypes = new Set<string>(Object.values(CanvasNodeType));

/** 作品域的槽位属于持久协议；域正文属于插件，即使插件已停用也完整保留。 */
function mapDomainFiles(records: PluginProjectDomainRecord[], map: MapResource) {
    for (const record of records) for (const ref of record.resources) {
        ref.key = map({ collection: "plugin-files", owner: ref.owner, key: ref.key });
    }
}

// 只处理宿主媒体字段。data: 自包含，只有已保存原件时才可省略。
function withoutTemporaryUrl(url: string, hasFile: boolean, requireFiles: boolean) {
    if (url.startsWith("blob:")) {
        if (requireFiles && !hasFile) throw new Error("ARCHIVE_RESOURCE_MISSING");
        return "";
    }
    return hasFile && url.startsWith("data:") ? "" : url;
}

export function visitNodeMedia(node: CanvasNodeData, visit: (resource: NodeMedia, field: { storageKey?: string }) => void) {
    const meta = node.metadata;
    if (!meta) return;
    const kind = builtinTypes.has(node.type) ? node.type : meta.mediaKind;
    if (meta.storageKey && (kind === "image" || kind === "video" || kind === "audio")) {
        visit({ collection: kind === "image" ? "images" : "media", key: meta.storageKey }, meta);
    }
    for (const file of meta.attachments ?? []) visit({ collection: "media", key: file.storageKey }, file);
    for (const image of meta.images ?? []) if (image.storageKey) visit({ collection: "images", key: image.storageKey }, image);
    for (const ref of meta.references ?? []) if ("storageKey" in ref) visit({ collection: ref.kind === "image" ? "images" : "media", key: ref.storageKey }, ref);
}

export function canvasNodeMedia(nodes: readonly CanvasNodeData[]): NodeMedia[] {
    const resources: NodeMedia[] = [];
    for (const node of nodes) visitNodeMedia(node, (resource) => resources.push(resource));
    return resources;
}

export function mapCanvasResources<T extends CanvasDocument>(doc: T, map: MapResource, requireFiles = true): T {
    const result = structuredClone(doc);
    for (const node of result.nodes) {
        const meta = node.metadata;
        if (!meta) continue;
        const kind = builtinTypes.has(node.type) ? node.type : meta.mediaKind;
        if (kind === "image" || kind === "video" || kind === "audio") {
            if (meta.content !== undefined) meta.content = withoutTemporaryUrl(meta.content, !!meta.storageKey, requireFiles);
        }
        for (const image of meta.images ?? []) {
            image.content = withoutTemporaryUrl(image.content, !!image.storageKey, requireFiles);
        }
        if (meta.references) meta.references = meta.references.filter((ref) => {
            if ("storageKey" in ref) return true;
            return !!withoutTemporaryUrl(ref.url, false, requireFiles);
        });
        visitNodeMedia(node, (resource, field) => { field.storageKey = map(resource); });
    }
    if (result.pluginDomains) mapDomainFiles(result.pluginDomains, map);
    return result;
}

export function mapWorkResources(work: PluginStandaloneWork, map: MapResource): PluginStandaloneWork {
    const result = structuredClone(work);
    mapDomainFiles(result.pluginDomains, map);
    return result;
}
