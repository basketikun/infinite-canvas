import { useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Textarea } from "@infinite-canvas/plugin-sdk/ui/textarea";
import type { CanvasNodePanelProps } from "@infinite-canvas/plugin-sdk";
import { formatOf, formats, type Format } from "./format";

const systems: Record<Format, string> = {
    html: "你是前端工程师。根据用户需求输出一个完整、自包含的 HTML 文档，样式和脚本都写在文件内，不引用外部资源。只输出代码，不要解释，不要使用代码围栏。",
    markdown: "根据用户需求输出 Markdown 正文。只输出 Markdown，不要解释，不要用代码围栏包裹全文。",
    svg: "根据用户需求输出一个完整、自包含的 SVG，以 <svg 开头并包含 viewBox。只输出 SVG 代码，不要解释，不要使用代码围栏。",
};

// 去掉模型偶尔加上的整段代码围栏。
const stripFence = (text: string) => text.trim().replace(/^```[a-z]*\n([\s\S]*?)\n?```$/i, "$1").trim();

export function RendererPanel({ ctx }: CanvasNodePanelProps) {
    const format = formatOf(ctx.node);
    const content = (ctx.node.metadata?.content as string | undefined) ?? "";
    const [prompt, setPrompt] = useState("");
    const [running, setRunning] = useState(false);
    const [error, setError] = useState("");
    const controller = useRef<AbortController | null>(null);

    const run = async () => {
        if (!prompt.trim() || running) return;
        const upstream = ctx.getUpstream().map((node) => node.metadata?.content).filter((text): text is string => typeof text === "string" && Boolean(text)).join("\n\n");
        const parts = [prompt, content ? `当前${formats[format]}内容（请在此基础上修改）：\n${content}` : "", upstream ? `参考内容：\n${upstream}` : ""].filter(Boolean);
        const abort = new AbortController();
        controller.current = abort;
        setRunning(true);
        setError("");
        try {
            const { text } = await ctx.plugin.models.generateText({ prompt: parts.join("\n\n"), system: systems[format], signal: abort.signal });
            abort.signal.throwIfAborted();
            await ctx.updateMetadata({ content: stripFence(text), prompt, editing: false });
            setPrompt("");
        } catch (cause) {
            if (!abort.signal.aborted && !ctx.scope.signal.aborted) {
                console.error("[multi-format-renderer] generate", cause);
                setError("生成没有完成，请检查文本模型设置后重试。");
            }
        } finally {
            if (controller.current === abort) controller.current = null;
            setRunning(false);
        }
    };

    return (
        <div
            data-canvas-no-zoom
            className="rounded-2xl border p-3 shadow-2xl backdrop-blur"
            style={{ background: ctx.theme.toolbar.panel, borderColor: ctx.theme.toolbar.border, color: ctx.theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <Textarea
                rows={4}
                value={prompt}
                disabled={running}
                placeholder={content ? `描述要如何修改当前的 ${formats[format]} 内容` : `描述要生成的 ${formats[format]} 内容`}
                aria-label="生成要求"
                className="resize-none border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void run(); }
                }}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
                <span role={error ? "alert" : "status"} className="min-w-0 truncate text-xs" style={{ color: ctx.theme.node.muted }}>{error || (running ? "正在生成…" : `使用默认文本模型生成 ${formats[format]}`)}</span>
                <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="shrink-0 rounded-full"
                    aria-label={running ? "停止生成" : "开始生成"}
                    disabled={!running && !prompt.trim()}
                    onClick={() => running ? controller.current?.abort() : void run()}
                >
                    {running ? <Square className="size-4" /> : <ArrowUp className="size-4" />}
                </Button>
            </div>
        </div>
    );
}
