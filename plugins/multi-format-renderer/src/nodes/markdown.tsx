import { saveSource } from "./save-source";
// Markdown 格式:编辑与渲染 Markdown。marked 随 npm 包一起构建。
// 防闪烁:解析结果按源码模块级缓存,且只在 HTML 真正变化时写入 DOM——
//   画布任何重渲染都不会重新解析或重载 Markdown 里的图片。
import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import type { CanvasNodeContentProps } from "@infinite-canvas/plugin-sdk";

type Marked = { parse: (src: string) => string };

// 链接在新窗口打开，避免点击后离开工作台。
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer"); }
});

let marked: Marked | undefined; // 加载完成后的 marked 实例,模块级缓存,后续同步渲染
let markedPromise: Promise<Marked> | undefined;
function loadMarked(): Promise<Marked> {
    if (marked) return Promise.resolve(marked);
    if (!markedPromise) markedPromise = import("marked").then((mod) => (marked = { parse: (src) => DOMPurify.sanitize(mod.marked.parse(src, { async: false }), { FORBID_TAGS: ["style", "link", "meta", "base", "form"], FORBID_ATTR: ["style"] }) }));
    return markedPromise;
}

// 解析结果按源码缓存(模块级):同一段 Markdown 只解析一次,重复渲染/重挂载都命中缓存,
// 返回的是同一个字符串引用,配合下方「值不变不写 DOM」彻底避免图片被重新请求。
const htmlCache = new Map<string, string>();
function renderMarkdown(source: string): string {
    if (!marked) return "";
    const key = source;
    let out = htmlCache.get(key);
    if (out === undefined) {
        out = marked.parse(key);
        htmlCache.set(key, out);
    }
    return out;
}

// 预览态:用 ref 手动写 innerHTML,且仅在 html 真正变化时写入。
// 这样宿主的任何重渲染(点击、移动视角、选中态变化等)都不会触碰已渲染的 DOM,图片不会重新加载。
export function MarkdownPreview({ ctx }: CanvasNodeContentProps) {
    const [, force] = useState(0);
    const ref = useRef<HTMLDivElement>(null);
    const lastHtml = useRef<string | null>(null);

    // marked 未就绪时按需加载,加载完触发一次重渲染填充内容
    useEffect(() => {
        if (marked) return;
        let alive = true;
        loadMarked().then(() => alive && force((n) => n + 1));
        return () => {
            alive = false;
        };
    }, []);

    const source = (ctx.node.metadata?.content as string | undefined) || "";
    const html = renderMarkdown(source);

    useEffect(() => {
        const el = ref.current;
        if (!el || lastHtml.current === html) return; // 内容没变:不动 DOM,已加载的图片保持原样
        el.innerHTML = html;
        lastHtml.current = html;
    }, [html]);

    return <div ref={ref} className="cnv-md" data-canvas-no-zoom onWheel={(e) => e.stopPropagation()} style={{ height: "100%", width: "100%", color: ctx.theme.node.text }} />;
}

export function MarkdownEditor({ ctx }: CanvasNodeContentProps) {
    const value = (ctx.node.metadata?.content as string | undefined) || "";
    return (
        <textarea
            autoFocus
            value={value}
            placeholder="# 输入 Markdown"
            onChange={(event) => saveSource(ctx, event.currentTarget)}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            style={{ height: "100%", width: "100%", resize: "none", background: "transparent", boxSizing: "border-box", padding: 16, fontFamily: "monospace", fontSize: 14, outline: "none", border: "none", color: ctx.theme.node.text }}
        />
    );
}
