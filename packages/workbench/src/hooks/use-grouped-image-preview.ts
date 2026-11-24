import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { readImageBlob } from "@workbench/services/image-storage";

export type GroupedPreviewSource = {
    id: string;
    alt?: string;
    storageKey?: string;
    url?: string;
    signal?: AbortSignal;
    read?: (signal: AbortSignal) => Promise<Blob>;
};

type GroupedPreviewItem = { id: string; alt: string; src?: string };

type GroupedPreview = {
    id: string;
    items: GroupedPreviewItem[];
    index: number;
    close: () => void;
    select: (index: number) => void;
};

/**
 * 同一组图片共用一个预览层，支持上一张/下一张。
 * 只按需读取当前图片，切换时保留弹层；关闭或重新打开时释放已读取的原图。
 */
export function useGroupedImagePreview() {
    const [preview, setPreview] = useState<GroupedPreview | null>(null);
    const current = useRef<{ id: string; controller: AbortController; urls: string[] } | null>(null);

    const close = useCallback(() => {
        const record = current.current;
        current.current = null;
        record?.controller.abort();
        for (const url of record?.urls ?? []) URL.revokeObjectURL(url);
        setPreview(null);
    }, []);

    useLayoutEffect(() => () => {
        const record = current.current;
        current.current = null;
        record?.controller.abort();
        for (const url of record?.urls ?? []) URL.revokeObjectURL(url);
    }, []);

    const open = useCallback((sources: GroupedPreviewSource[], start = 0) => {
        if (!sources.length) return;
        const previous = current.current;
        current.current = null;
        previous?.controller.abort();
        for (const url of previous?.urls ?? []) URL.revokeObjectURL(url);

        const id = crypto.randomUUID();
        const controller = new AbortController();
        const urls: string[] = [];
        const cache = new Map<number, string>();
        current.current = { id, controller, urls };
        const startIndex = Math.min(Math.max(Math.trunc(start) || 0, 0), sources.length - 1);
        let loading: AbortController | undefined;

        const load = async (order: number) => {
            const source = sources[order];
            if (!source || cache.has(order)) return;
            loading?.abort();
            const request = new AbortController();
            loading = request;
            const signals = [controller.signal, request.signal, ...(source.signal ? [source.signal] : [])];
            const signal = AbortSignal.any(signals);
            try {
                const blob = source.read ? await source.read(signal) : await readImageBlob(source.storageKey, source.url, { signal });
                signal.throwIfAborted();
                const url = URL.createObjectURL(blob);
                if (signal.aborted || current.current?.id !== id) {
                    URL.revokeObjectURL(url);
                    return;
                }
                cache.set(order, url);
                urls.push(url);
                setPreview((value) => value?.id === id
                    ? { ...value, items: value.items.map((item, index) => index === order ? { ...item, src: url } : item) }
                    : value);
            } catch (error) {
                if (signal.aborted) return;
                console.error("[create] preview image", error);
                toast.error("这张图片暂时无法读取，请稍后重试。", workbenchMessageOptions.error);
            }
        };

        const select = (next: number) => {
            const target = Math.min(Math.max(next, 0), sources.length - 1);
            setPreview((value) => value?.id === id ? { ...value, index: target } : value);
            if (!cache.has(target)) void load(target);
        };

        setPreview({
            id,
            items: sources.map((source, order) => ({ id: source.id, alt: source.alt || `图片 ${order + 1}` })),
            index: startIndex,
            close,
            select,
        });
        void load(startIndex);
    }, [close]);

    return { preview, open, close };
}
