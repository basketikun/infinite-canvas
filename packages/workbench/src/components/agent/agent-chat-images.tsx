import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { ImageIcon, X } from "lucide-react";

import { ImagePreviewGroup } from "@workbench/components/ui/image-preview-group";
import { getImagePreviewRevision, loadImagePreview, previewUrlFor, readImageBlob, subscribeImagePreviews } from "@workbench/services/image-storage";
import type { AgentChatImage } from "@workbench/stores/use-agent-chat-store";
import { useAgentStore } from "@workbench/stores/use-agent-store";
import { canvasThemes } from "@workbench/lib/canvas-theme";
import { useThemeStore } from "@workbench/stores/use-theme-store";

type ImagePreviewRequest = { storageKey: string; controller: AbortController; trigger: HTMLButtonElement; url?: string; close: () => void };

export function AgentChatImages({ images, activePreview, onRemove, removeDisabled }: { images: AgentChatImage[]; activePreview: RefObject<(() => void) | null>; onRemove?: (storageKey: string) => void; removeDisabled?: boolean }) {
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const current = useRef<ImagePreviewRequest | null>(null);
    const [preview, setPreview] = useState<Pick<ImagePreviewRequest, "storageKey" | "url"> | null>(null);
    const restoreFocus = useRef<HTMLButtonElement | null>(null);
    const [failed, setFailed] = useState(false);
    const [failedPreviews, setFailedPreviews] = useState<Record<string, string>>({});
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    useEffect(() => {
        let active = true;
        for (const { storageKey } of images) void loadImagePreview(storageKey).catch((error) => { if (active) console.error("[agent] image preview cache", error); });
        return () => { active = false; };
    }, [images]);
    useLayoutEffect(() => {
        if (!preview && restoreFocus.current) {
            restoreFocus.current.focus({ preventScroll: true });
            restoreFocus.current = null;
        }
    }, [preview]);
    useLayoutEffect(() => {
        const request = current.current;
        if (request && !images.some((image) => image.storageKey === request.storageKey)) request.close();
    }, [images]);
    useLayoutEffect(() => {
        const unsubscribe = useAgentStore.subscribe((state) => { if (!state.panelOpen) current.current?.close(); });
        return () => {
            unsubscribe();
            const request = current.current;
            current.current = null;
            request?.close();
        };
    }, []);

    const fail = (request: ImagePreviewRequest, error: unknown) => {
        if (request.controller.signal.aborted || current.current !== request) return;
        console.error("[agent] read image", error);
        if (preview) restoreFocus.current = request.trigger;
        request.close();
        setFailed(true);
    };

    const open = async (storageKey: string, trigger: HTMLButtonElement) => {
        const controller = new AbortController();
        const request: ImagePreviewRequest = {
            storageKey, controller, trigger,
            close: () => {
                if (controller.signal.aborted) return;
                controller.abort();
                if (request.url) URL.revokeObjectURL(request.url);
                if (activePreview.current === request.close) activePreview.current = null;
                if (current.current !== request) return;
                current.current = null;
                setPreview(null);
            },
        };
        activePreview.current?.();
        current.current = request;
        activePreview.current = request.close;
        // 切图时保留弹层，等所选原图回执，同时允许继续切换或关闭。
        setPreview(preview ? { storageKey } : null);
        setFailed(false);
        try {
            const blob = await readImageBlob(storageKey, undefined, { signal: controller.signal });
            controller.signal.throwIfAborted();
            if (current.current !== request) return;
            request.url = URL.createObjectURL(blob);
            setPreview({ storageKey, url: request.url });
        } catch (error) { fail(request, error); }
    };

    const index = preview ? images.findIndex((image) => image.storageKey === preview.storageKey) : -1;
    const cached = preview && previewUrlFor(preview.storageKey);
    const displayedUrl = preview?.url ?? (preview && cached && failedPreviews[preview.storageKey] !== cached ? cached : undefined);
    return (
        <div className={`flex flex-wrap gap-2 ${onRemove ? "py-2" : "justify-end"}`} onErrorCapture={(event) => {
            const request = current.current;
            if (request?.url && event.target instanceof HTMLImageElement && event.target.src === request.url) fail(request, event);
        }}>
            {images.map((image) => {
                const url = previewUrlFor(image.storageKey);
                return <div key={image.storageKey} className="relative">
                    <button type="button" className="flex size-16 cursor-pointer items-center justify-center overflow-hidden rounded-lg" title={image.name} aria-label={`查看参考图：${image.name}`} onClick={(event) => void open(image.storageKey, event.currentTarget)}>
                        {url && failedPreviews[image.storageKey] !== url ? <img src={url} alt={image.name} className="size-full object-contain" onError={() => setFailedPreviews((value) => ({ ...value, [image.storageKey]: url }))} /> : <ImageIcon className="size-5 opacity-60" />}
                    </button>
                    {onRemove ? <button type="button" disabled={removeDisabled} className="absolute -right-1 -top-1 cursor-pointer rounded-full p-0.5" style={{ background: theme.toolbar.panel, color: theme.node.text }} aria-label={`移除参考图：${image.name}`} onClick={() => {
                        if (current.current?.storageKey === image.storageKey) current.current.close();
                        onRemove(image.storageKey);
                    }}><X className="size-3.5" /></button> : null}
                </div>;
            })}
            {failed ? <p role="status" className="w-full text-xs opacity-60">图片暂时无法读取，请重新添加。</p> : null}
            {preview && index >= 0 && <ImagePreviewGroup current={index} open
                items={images.map((image) => ({ alt: image.name, src: image.storageKey === preview.storageKey ? displayedUrl : undefined }))}
                onChange={(next) => { if (current.current) void open(images[next].storageKey, current.current.trigger); }}
                onOpenChange={(visible) => {
                    const request = current.current;
                    if (!visible && request) {
                        restoreFocus.current = request.trigger;
                        request.close();
                    }
                }} />}
        </div>
    );
}
