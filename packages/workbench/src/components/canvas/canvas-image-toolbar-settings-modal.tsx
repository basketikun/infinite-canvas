import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Switch } from "@infinite-canvas/plugin-sdk/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@infinite-canvas/plugin-sdk/ui/tooltip";
import { CanvasDialog } from "./canvas-dialog";
import { Ellipsis, Image as ImageIcon, Settings2 } from "lucide-react";

import type { CanvasNodeToolbarItem } from "@infinite-canvas/plugin-sdk";
import { isImageToolbarToolVisible } from "./canvas-image-toolbar-preferences";

type PreviewTool = Omit<CanvasNodeToolbarItem, "onClick">;

type PreviewScroll = {
    left: number;
    max: number;
    viewport: number;
    content: number;
};

type ImageToolSettingsModalProps = {
    open: boolean;
    tools: CanvasNodeToolbarItem[];
    visibility: Record<string, boolean>;
    showLabels: boolean;
    onToggle: (id: string, visible: boolean) => void;
    onShowLabelsChange: (value: boolean) => void;
    onCancel: () => void;
    onSave: () => void;
};

export function ImageToolSettingsModal({ open, tools, visibility, showLabels, onToggle, onShowLabelsChange, onCancel, onSave }: ImageToolSettingsModalProps) {

    const previewToolbarRef = useRef<HTMLDivElement>(null);
    const scrollbarTrackRef = useRef<HTMLInputElement>(null);
    const [previewScroll, setPreviewScroll] = useState<PreviewScroll>({ left: 0, max: 0, viewport: 1, content: 1 });
    const selectedTools = useMemo(() => tools.filter((tool) => isImageToolbarToolVisible(tool, visibility)), [tools, visibility]);
    const previewTools: PreviewTool[] = [
        ...selectedTools,
        { id: "more", title: "配置快捷工具", label: "更多", icon: <Ellipsis className="size-4" />, active: true },
    ];

    const syncPreviewScroll = useCallback(() => {
        const toolbar = previewToolbarRef.current;
        if (!toolbar) return;
        setPreviewScroll({
            left: toolbar.scrollLeft,
            max: Math.max(0, toolbar.scrollWidth - toolbar.clientWidth),
            viewport: Math.max(1, toolbar.clientWidth),
            content: Math.max(1, toolbar.scrollWidth),
        });
    }, []);

    const setPreviewScrollLeft = useCallback(
        (left: number) => {
            const toolbar = previewToolbarRef.current;
            if (!toolbar) return;
            toolbar.scrollLeft = left;
            syncPreviewScroll();
        },
        [syncPreviewScroll],
    );

    useEffect(() => {
        if (!open) return;
        const toolbar = previewToolbarRef.current;
        const sync = () => syncPreviewScroll();
        const frames: number[] = [];
        const firstFrame = window.requestAnimationFrame(() => {
            sync();
            frames.push(window.requestAnimationFrame(sync));
        });
        frames.push(firstFrame);
        const timer = window.setTimeout(sync, 120);
        const resizeObserver = typeof ResizeObserver !== "undefined" && toolbar ? new ResizeObserver(sync) : null;
        if (resizeObserver && toolbar) {
            resizeObserver.observe(toolbar);
            toolbar.childNodes.forEach((child) => {
                if (child instanceof Element) resizeObserver.observe(child);
            });
        }
        sync();
        window.addEventListener("resize", syncPreviewScroll);
        return () => {
            frames.forEach((frame) => window.cancelAnimationFrame(frame));
            window.clearTimeout(timer);
            resizeObserver?.disconnect();
            window.removeEventListener("resize", syncPreviewScroll);
        };
    }, [open, selectedTools, showLabels, previewTools.length, syncPreviewScroll]);

    const scrollbarWidth = scrollbarTrackRef.current?.clientWidth || previewScroll.viewport;
    const scrollbarThumbWidth = previewScroll.max > 0 ? Math.min(scrollbarWidth, Math.max(64, (previewScroll.viewport / previewScroll.content) * scrollbarWidth)) : scrollbarWidth;

    return (
        <CanvasDialog title="自定义工具栏" open={open} width={760} onClose={onCancel}>
            <p className="mb-4 text-sm text-muted-foreground">选择你想在图片节点编辑栏中使用的快捷工具。</p>
            <section className="mb-4 overflow-hidden rounded-lg border border-border text-sm">
                <h3 className="flex items-center gap-1.5 border-b border-border px-3 py-2 font-semibold"><Settings2 className="size-4" />节点预览</h3>
                <div className="relative m-3 flex min-h-[300px] justify-center pt-20 pb-9">
                    <div
                        ref={previewToolbarRef}
                        className="hide-scrollbar absolute left-2 right-2 top-3 z-10 flex h-12 items-center overflow-x-auto rounded-[18px] border border-border bg-(--workbench-elevated-panel) px-1 text-[13px] shadow-lg"
                        onScroll={syncPreviewScroll}
                    >
                        {previewTools.map((tool) => (
                            <PreviewToolbarItem key={tool.id} tool={tool} showLabels={showLabels} />
                        ))}
                    </div>
                    <div
                        className="flex h-48 w-full max-w-[360px] flex-col items-center justify-center rounded-xl border border-border bg-muted/50 text-muted-foreground"
                    >
                        <ImageIcon className="mb-2 size-8" />
                        <span>图片节点</span>
                    </div>
                    <input
                        ref={scrollbarTrackRef}
                        type="range"
                        aria-label="预览工具栏滚动位置"
                        min={0}
                        max={Math.max(previewScroll.max, 1)}
                        value={Math.min(previewScroll.left, Math.max(previewScroll.max, 1))}
                        disabled={previewScroll.max <= 0}
                        className="absolute bottom-4 left-10 right-10 h-2.5 cursor-pointer appearance-none bg-transparent disabled:cursor-default [&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:w-[var(--preview-scrollbar-thumb-width)] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[#8d9498] [&::-moz-range-track]:h-2.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-[#bdc4c8] [&::-webkit-slider-runnable-track]:h-2.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[#bdc4c8] [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-[var(--preview-scrollbar-thumb-width)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#8d9498]"
                        style={{ "--preview-scrollbar-thumb-width": `${scrollbarThumbWidth}px` } as CSSProperties}
                        onInput={(event) => setPreviewScrollLeft(Number(event.currentTarget.value))}
                        onChange={(event) => setPreviewScrollLeft(Number(event.target.value))}
                    />
                </div>
            </section>
            <fieldset className="mb-4">
                <legend className="mb-2 flex items-center gap-2 text-sm">快捷工具 <span className="rounded border border-border px-1.5 text-xs">{selectedTools.length}/{tools.length}</span></legend>
                <div className="grid w-full gap-3 md:grid-cols-3">
                    {tools.map(tool => <label key={tool.id} className="inline-flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={isImageToolbarToolVisible(tool, visibility)} onChange={event => onToggle(tool.id, event.target.checked)} />
                        {tool.icon}{tool.label}
                    </label>)}
                </div>
            </fieldset>
            <footer className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm">显示按钮文字<Switch checked={showLabels} onCheckedChange={onShowLabelsChange} /></label>
                <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={onCancel}>取消</Button>
                    <Button type="button" size="sm" onClick={onSave}>保存</Button>
                </div>
            </footer>
        </CanvasDialog>
    );
}

function PreviewToolbarItem({ tool, showLabels }: { tool: PreviewTool; showLabels: boolean }) {
    return (
        <Tooltip><TooltipTrigger asChild>
            <span className="flex h-12 shrink-0 items-center px-1.5" style={{ color: tool.danger ? "#ef4444" : undefined }}>
                <span className={`flex h-9 items-center rounded-lg px-2 ${showLabels ? "gap-2" : "justify-center"}`}>
                    {tool.icon}
                    {showLabels ? <span className="whitespace-nowrap">{tool.label}</span> : null}
                </span>
            </span>
        </TooltipTrigger><TooltipContent className="z-[1100]">{tool.title}</TooltipContent></Tooltip>
    );
}
