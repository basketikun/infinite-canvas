import { saveSource } from "./save-source";
// SVG 格式:渲染 SVG,透明背景直接融入画布;无自身内容时预览上游文本节点里的 SVG 源码。
import type { CanvasNodeContentProps } from "@infinite-canvas/plugin-sdk";

export function SvgPreview({ ctx }: CanvasNodeContentProps) {
    const stored = ctx.node.metadata?.content as string | undefined;
    const upstream = ctx
        .getUpstream()
        .map((node) => node.metadata?.content)
        .find((text): text is string => typeof text === "string" && text.trim().startsWith("<svg"));
    const svg = stored?.trim() || upstream || "";

    // pointerEvents:none 让整块可拖动移动
    return svg
        // 用图片加载矢量图：脚本与样式都被隔离，不会影响画布页面
        ? <img alt="" draggable={false} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} style={{ height: "100%", width: "100%", objectFit: "contain", padding: 12, boxSizing: "border-box", pointerEvents: "none" }} />
        : <EmptyHint ctx={ctx} />;
}

export function SvgEditor({ ctx }: CanvasNodeContentProps) {
    const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
    return (
        <textarea
            autoFocus
            value={(ctx.node.metadata?.content as string | undefined) ?? ""}
            placeholder="粘贴 SVG 源码,如 <svg …>…</svg>"
            onChange={(event) => saveSource(ctx, event.currentTarget)}
            onMouseDown={stop}
            onPointerDown={stop}
            onWheel={stop}
            style={{ height: "100%", width: "100%", resize: "none", background: "transparent", padding: 16, boxSizing: "border-box", fontFamily: "monospace", fontSize: 12, outline: "none", border: "none", color: ctx.theme.node.text }}
        />
    );
}

export function EmptyHint({ ctx }: CanvasNodeContentProps) {
    return <div style={{ height: "100%", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, boxSizing: "border-box", color: ctx.theme.node.placeholder, fontSize: 13, textAlign: "center", pointerEvents: "none" }}>选中节点,点上方工具条的「编辑」,可选择 HTML、Markdown 或 SVG</div>;
}
