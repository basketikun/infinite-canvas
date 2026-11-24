import { saveSource } from "./save-source";
// HTML 格式:沙箱 iframe 渲染 HTML,{{input}} 会替换为上游文本节点内容。
import { useMemo, useState } from "react";
import type { CanvasNodeContentProps } from "@infinite-canvas/plugin-sdk";

// 源码编辑器行高/字号,行号槽与文本域必须完全一致才能对齐
const EDITOR_FONT = 12;
const EDITOR_LINE = 20;

export function HtmlEditor({ ctx, value }: { ctx: CanvasNodeContentProps["ctx"]; value: string }) {
    // 行数:按换行统计,至少 1 行;value 变化时重算
    const lineCount = useMemo(() => Math.max(1, value.split("\n").length), [value]);
    const [scrollTop, setScrollTop] = useState(0);

    const codeStyle = { fontFamily: "monospace", fontSize: EDITOR_FONT, lineHeight: `${EDITOR_LINE}px`, boxSizing: "border-box" } as const;

    return (
        <div data-canvas-no-zoom style={{ height: "100%", width: "100%", display: "flex", overflow: "hidden" }} onMouseDown={(e) => e.stopPropagation()}>
            {/* 行号槽:跟随文本域滚动,不可单独滚动 */}
            <div
                aria-hidden
                style={{
                    ...codeStyle,
                    flex: "0 0 auto",
                    padding: "16px 8px 16px 12px",
                    textAlign: "right",
                    color: ctx.theme.node.placeholder,
                    background: `${ctx.theme.toolbar.panel}66`,
                    borderRight: `1px solid ${ctx.theme.node.stroke}`,
                    overflow: "hidden",
                    userSelect: "none",
                    whiteSpace: "pre",
                }}
            >
                {/* 用负 margin 让整列跟随 scrollTop 平移,和 textarea 同步 */}
                <div style={{ transform: `translateY(${-scrollTop}px)` }}>
                    {Array.from({ length: lineCount }, (_, i) => (
                        <div key={i}>{i + 1}</div>
                    ))}
                </div>
            </div>
            <textarea
                autoFocus
                value={value}
                placeholder="<div>Hello, {{input}}</div>"
                spellCheck={false}
                wrap="off"
                onChange={(event) => saveSource(ctx, event.currentTarget)}
                onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
                onMouseDown={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
                style={{ ...codeStyle, flex: "1 1 auto", minWidth: 0, height: "100%", resize: "none", background: "transparent", padding: "16px 16px 16px 12px", outline: "none", border: "none", color: ctx.theme.node.text, whiteSpace: "pre", overflow: "auto" }}
            />
        </div>
    );
}

export function HtmlPreview({ ctx }: CanvasNodeContentProps) {
    const value = ctx.node.metadata?.content || "";
    const upstreamText = useMemo(
        () =>
            ctx
                .getUpstream()
                .map((node) => node.metadata?.content)
                .filter(Boolean)
                .join("\n"),
        [ctx],
    );
    const html = value.replace(/\{\{\s*input\s*\}\}/g, () => upstreamText);
    // 预览态 iframe 的鼠标交互由宿主「交互 ⇄ 移动」开关统一控制；data-canvas-no-zoom 保证交互时滚动作用于页面而非缩放画布。
    return (
        <div data-canvas-no-zoom style={{ position: "relative", height: "100%", width: "100%" }}>
            <iframe
                title="html-preview"
                sandbox="allow-scripts allow-forms"
                srcDoc={html}
                style={{ height: "100%", width: "100%", border: 0, borderRadius: 16, background: "#fff", display: "block" }}
            />
        </div>
    );
}
