import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { readImageBlob } from "@workbench/services/image-storage";

type ImageSource = { id: string; storageKey?: string; url?: string; signal?: AbortSignal; read?: (signal: AbortSignal) => Promise<Blob> };
type ImagePreview = { source: ImageSource; signal: AbortSignal; url: string; close: () => void };

export function useImagePreview() {
    const current = useRef<ImagePreview | null>(null);
    const [preview, setPreview] = useState<ImagePreview | null>(null);
    useLayoutEffect(() => () => {
        const record = current.current;
        current.current = null;
        record?.close();
    }, []);
    const openImage = useCallback(async (source: ImageSource) => {
        if (source.signal?.aborted) return;
        const controller = new AbortController();
        const signal = source.signal ? AbortSignal.any([source.signal, controller.signal]) : controller.signal;
        let closed = false;
        const record: ImagePreview = {
            source, signal, url: "",
            close: () => {
                if (closed) return;
                closed = true;
                signal.removeEventListener("abort", record.close);
                controller.abort();
                if (record.url) URL.revokeObjectURL(record.url);
                if (current.current !== record) return;
                current.current = null;
                setPreview(null);
            },
        };
        const previous = current.current;
        current.current = record;
        previous?.close();
        setPreview({ ...record });
        signal.addEventListener("abort", record.close, { once: true });
        try {
            const blob = source.read ? await source.read(signal) : await readImageBlob(source.storageKey, source.url, { signal });
            signal.throwIfAborted();
            if (current.current !== record) return;
            record.url = URL.createObjectURL(blob);
            setPreview({ ...record });
        } catch (error) {
            if (signal.aborted || current.current !== record) return;
            console.error("[images] preview read", error);
            record.close();
            toast.error("图片暂时无法读取，请重新添加。", workbenchMessageOptions.error);
        }
    }, []);
    return { preview, openImage };
}
