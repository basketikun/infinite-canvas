// 内容渲染节点:同一个节点按 metadata.format 渲染 HTML、Markdown 或 SVG,格式在编辑态顶部切换。
import { FileCode } from "lucide-react";
import type { CanvasNodeContentProps, CanvasNodeDefinition } from "@infinite-canvas/plugin-sdk";
import { formatOf, formats, type Format } from "./format";
import { RendererPanel } from "./panel";
import { HtmlEditor, HtmlPreview } from "./html";
import { MarkdownEditor, MarkdownPreview } from "./markdown";
import { EmptyHint, SvgEditor, SvgPreview } from "./svg";

function FormatTabs({ ctx, format }: CanvasNodeContentProps & { format: Format }) {
    return (
        <div role="tablist" aria-label="内容格式" style={{ display: "inline-flex", gap: 2, padding: 2, borderRadius: 8, background: ctx.theme.toolbar.itemHover }} onMouseDown={(e) => e.stopPropagation()}>
            {(Object.keys(formats) as Format[]).map((key) => (
                <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={key === format}
                    onClick={() => void ctx.updateMetadata({ format: key }).catch((error) => { if (!ctx.scope.signal.aborted) console.error("[multi-format-renderer] switch format", error); })}
                    style={{ padding: "2px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, lineHeight: "20px", background: key === format ? ctx.theme.toolbar.panel : "transparent", color: key === format ? ctx.theme.node.text : ctx.theme.node.placeholder, boxShadow: key === format ? "0 1px 2px rgba(0,0,0,.18)" : "none" }}
                >
                    {formats[key]}
                </button>
            ))}
        </div>
    );
}

function DocumentContent({ ctx }: CanvasNodeContentProps) {
    const format = formatOf(ctx.node);
    const content = (ctx.node.metadata?.content as string | undefined) || "";
    if (ctx.node.metadata?.status === "loading") return <p role="status">正在生成…</p>;
    if (ctx.node.metadata?.status === "error") return <p>内容未生成，请重试。</p>;
    if (ctx.node.metadata?.editing) {
        const editor = format === "html" ? <HtmlEditor ctx={ctx} value={content} /> : format === "markdown" ? <MarkdownEditor ctx={ctx} /> : <SvgEditor ctx={ctx} />;
        return (
            <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", overflow: "hidden", borderRadius: 16, background: ctx.theme.node.fill, border: `1px solid ${ctx.theme.node.stroke}`, boxSizing: "border-box" }}>
                <div style={{ flex: "0 0 auto", padding: "8px 10px", borderBottom: `1px solid ${ctx.theme.node.stroke}` }}><FormatTabs ctx={ctx} format={format} /></div>
                <div style={{ flex: "1 1 auto", minHeight: 0 }}>{editor}</div>
            </div>
        );
    }
    if (!content && format !== "svg") return <EmptyHint ctx={ctx} />;
    return format === "html" ? <HtmlPreview ctx={ctx} /> : format === "markdown" ? <MarkdownPreview ctx={ctx} /> : <SvgPreview ctx={ctx} />;
}

export const renderer: CanvasNodeDefinition = {
    type: "multi-format-renderer:document",
    title: "内容渲染",
    icon: <FileCode />,
    description: "HTML、Markdown 或 SVG",
    defaultSize: { width: 380, height: 320 },
    defaultMetadata: { content: "", format: "markdown" },
    minimapColor: "#6366f1",
    // 单击节点即打开下方对话框，用文本模型生成当前格式的内容
    autoOpenPanel: true,
    Panel: RendererPanel,
    // SVG 背景与边框透明,矢量图直接融入画布
    appearance: (node) => formatOf(node) === "svg" ? { background: "transparent", border: "none", bottomGradient: false } : { background: "fill", border: "normal", bottomGradient: true },
    // 宿主统一提供「交互 ⇄ 移动」开关;编辑态强制可交互并隐藏该开关
    interactionToggle: true,
    forceInteractive: (node) => Boolean(node.metadata?.editing),
    Content: DocumentContent,
};
