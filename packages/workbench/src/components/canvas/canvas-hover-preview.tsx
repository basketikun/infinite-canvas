import { useRef, useState, useSyncExternalStore } from "react";
import { Image as ImageIcon, Video } from "lucide-react";
import type { ReadonlyCanvasNode } from "@infinite-canvas/plugin-sdk";
import { CanvasNodeType } from "@infinite-canvas/shared/canvas/schema/canvas";
import { canvasThemes } from "@workbench/lib/canvas-theme";
import { fitNodeSize } from "@workbench/lib/canvas/canvas-node-size";
import { hasNodeMedia } from "@workbench/lib/media-source";
import { getImagePreviewRevision, previewUrlFor, subscribeImagePreviews } from "@workbench/services/image-storage";
import { useThemeStore } from "@workbench/stores/use-theme-store";

export function CanvasHoverPreview({ node, size }: { node: ReadonlyCanvasNode | null; size: { width: number; height: number } }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    const media = node && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) && hasNodeMedia(node) ? node : null;
    const retainedPreviewRef = useRef<{ video: boolean; src?: string; title: string; width: number; height: number } | null>(null);
    // 收起时保留最后的画面，让原有透明度与缩放动画完整结束。
    if (media) {
        const previewSize = fitNodeSize(media.metadata?.naturalWidth || media.width, media.metadata?.naturalHeight || media.height, size.width * 0.9, size.height * 0.9);
        retainedPreviewRef.current = { video: media.type === CanvasNodeType.Video, src: media.type === CanvasNodeType.Image ? previewUrlFor(media.metadata?.storageKey) : undefined, title: media.title, ...previewSize };
    }
    const retained = retainedPreviewRef.current;
    const Placeholder = retained?.video ? Video : ImageIcon;
    return (
        <div
            className="pointer-events-none absolute inset-0 z-[80] flex items-center justify-center transition-opacity duration-200 ease-out"
            style={{ background: `color-mix(in srgb, ${theme.canvas.background} 76%, transparent)`, opacity: media ? 1 : 0 }}
        >
            <div
                className="flex flex-col overflow-hidden rounded-2xl border transition-transform duration-200 ease-out"
                style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, boxShadow: "0 24px 60px rgba(0,0,0,.32)", transform: media ? "scale(1)" : "scale(0.95)" }}
            >
                {retained ? (
                    <>
                        <div className="max-w-full truncate px-3.5 py-2 text-sm font-medium" style={{ color: theme.node.text }}>
                            {retained.title || (retained.video ? "视频" : "图片")}
                        </div>
                        <div className="overflow-hidden" style={{ width: retained.width, height: retained.height }}>
                            {retained.src && retained.src !== failedUrl ? (
                                <img src={retained.src} alt={retained.title} className="size-full object-contain" onError={() => setFailedUrl(retained.src!)} />
                            ) : (
                                <div className="flex size-full flex-col items-center justify-center gap-2 opacity-50" style={{ color: theme.node.text }}>
                                    <Placeholder className="size-8" />
                                    <span className="text-sm">暂无预览</span>
                                </div>
                            )}
                        </div>
                    </>
                ) : null}
            </div>
        </div>
    );
}
