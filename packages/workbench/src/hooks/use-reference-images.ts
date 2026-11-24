import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { nanoid } from "nanoid";
import { imageBlobDimensions, readImageBlob, saveImageBlob } from "@workbench/services/image-storage";
import type { ReferenceImage } from "@workbench/types/image";
import { registerMediaAsset } from "@workbench/stores/use-asset-store";

export function useReferenceImages(limit?: number, options?: { registerAssets?: boolean }) {
    const [references, display] = useState<ReferenceImage[]>([]);
    const current = useRef(references);
    const history = useRef<AbortController | null>(null);
    useEffect(() => () => history.current?.abort(), []);
    const setReferences = useCallback((update: SetStateAction<ReferenceImage[]>) => {
        current.current = typeof update === "function" ? update(current.current) : update;
        display(current.current);
    }, []);

    /** 本地文件写入新键后成为参考图，已有图片沿用原键。 */
    async function saveReferences(inputs: (ReferenceImage | File)[], signal: AbortSignal) {
        const items = await Promise.all(inputs.map(async (input): Promise<ReferenceImage> => {
            if (!(input instanceof File)) return input;
            const { width, height } = await imageBlobDimensions(input, signal);
            signal.throwIfAborted();
            const storageKey = await saveImageBlob(input);
            if (options?.registerAssets) await registerMediaAsset({ kind: "image", storageKey, width, height, bytes: input.size, mimeType: input.type || "image/png", title: input.name, source: "参考图" })
                .catch((error) => console.error("[assets] register reference image", error));
            return { id: nanoid(), name: input.name, type: input.type, storageKey };
        }));
        signal.throwIfAborted();
        return items;
    }

    function readReference(item: ReferenceImage, signal: AbortSignal) {
        return readImageBlob(item.storageKey, item.url || item.dataUrl, { signal });
    }


    async function acceptReferences(items: ReferenceImage[], signal: AbortSignal, mode: "append" | "replace", expected?: ReferenceImage[]) {
        if (signal.aborted || (expected && expected !== current.current)) return false;
        if (mode === "replace") {
            history.current?.abort();
            history.current = new AbortController();
            signal = AbortSignal.any([signal, history.current.signal]);
        }
        const before = current.current;
        const fits = () => limit === undefined || (mode === "append" ? current.current.length : 0) + items.length <= limit;
        try {
            if (fits()) {
                const saved = await saveReferences(items, signal);
                const valid = !signal.aborted && (mode !== "replace" || before === current.current);
                if (valid && fits()) {
                    setReferences(mode === "append" ? [...current.current, ...saved] : saved);
                    return true;
                }
                if (!valid) return false;
            }
            toast.warning("参考图数量已达上限，请先移除参考图。", workbenchMessageOptions.warning);
        } catch (error) {
            if (!signal.aborted) {
                console.error("[references] accept images", error);
                toast.error("参考图片暂时无法添加，请检查原图后重试。", workbenchMessageOptions.error);
            }
        }
        return false;
    }

    async function add(files: File[], signal: AbortSignal) {
        signal.throwIfAborted();
        const room = () => limit === undefined ? files.length : Math.max(0, limit - current.current.length);
        const saved = (await saveReferences(files.slice(0, room()), signal)).slice(0, room());
        if (saved.length) setReferences([...current.current, ...saved]);
        return saved.length;
    }

    async function addReferenceFiles(files: File[], signal: AbortSignal) {
        try {
            const count = await add(files.filter((file) => file.type.startsWith("image/")), signal);
            if (count && options?.registerAssets && !signal.aborted) toast.success(`已添加 ${count} 张参考图，可在「我的资产 / 默认素材」查看`, workbenchMessageOptions.success);
        } catch (error) { if (!signal.aborted) toast.error("参考图片未能添加，请确认可以读取并保存文件。", workbenchMessageOptions.error); }
    }

    async function pasteReferenceImages(signal: AbortSignal) {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            signal.throwIfAborted();
            if (!blobs.length) { toast.error("剪切板里的图片无法读取，请点击 + 添加图片", workbenchMessageOptions.error); return; }
            const files = blobs.map((blob, index) => new File([blob], `clipboard-${index + 1}.png`, { type: blob.type }));
            const count = await add(files, signal);
            if (!signal.aborted) toast.success(options?.registerAssets ? `已读取 ${count} 张参考图，可在「我的资产 / 默认素材」查看` : `已读取 ${count} 张参考图`, workbenchMessageOptions.success);
        } catch (error) { if (!signal.aborted) toast.error("剪切板图片未能添加，请确认可以读取并保存文件。", workbenchMessageOptions.error); }
    }
    return { references, setReferences, acceptReferences, addReferenceFiles, pasteReferenceImages, readReference };
}
