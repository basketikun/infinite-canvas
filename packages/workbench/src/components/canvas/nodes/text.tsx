import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronRight, RefreshCw, Star } from "lucide-react";
import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import type { CanvasNodeContentProps, CanvasNodeContext, ReadonlyCanvasNode } from "@infinite-canvas/plugin-sdk";
import { canvasApply, nodeRetry, nodeSetTextContent } from "@infinite-canvas/plugin-sdk/builtin";
import { getPluginErrorMessage } from "@infinite-canvas/shared/plugins";
import { CanvasResourceMentionTextarea } from "../canvas-resource-mention-textarea";
import { CanvasNodeBatchFrame } from "../canvas-node-batch-frame";
import { buildNodeMentionReferences } from "@workbench/lib/canvas/canvas-resource-references";

type TextSlot = NonNullable<NonNullable<ReadonlyCanvasNode["metadata"]>["texts"]>[number];

export function TextContent({ ctx }: CanvasNodeContentProps) {
    const { node, theme, expanded } = ctx;
    const [editing, setEditing] = useState(false);
    const textarea = useRef<HTMLTextAreaElement>(null);
    const texts = node.metadata?.texts ?? [];
    const primaryId = node.metadata?.primaryTextId ?? texts[0]?.id;
    const primary = texts.find((text) => text.id === primaryId);
    const content = primary?.content || node.metadata?.content || "";
    const fontSize = node.metadata?.fontSize || 14;
    const textStyle: CSSProperties = { fontSize, lineHeight: `${Math.round(fontSize * 1.65)}px`, color: theme.node.text, boxSizing: "border-box" };
    const padding = texts.length > 1 ? "px-4 pb-4 pt-14" : "p-4";
    const references = buildNodeMentionReferences(node, ctx.getNodes(), ctx.getConnections(), ctx.scope);

    useEffect(() => {
        if (!editing) return;
        textarea.current?.focus();
        textarea.current?.setSelectionRange(textarea.current.value.length, textarea.current.value.length);
        const outside = (event: PointerEvent) => { if (event.target instanceof Node && !textarea.current?.contains(event.target)) setEditing(false); };
        const wheel = (event: WheelEvent) => event.stopPropagation();
        const input = textarea.current;
        input?.addEventListener("wheel", wheel, { passive: false });
        window.addEventListener("pointerdown", outside, true);
        return () => { input?.removeEventListener("wheel", wheel); window.removeEventListener("pointerdown", outside, true); };
    }, [editing]);

    const update = (content: string) => {
        void ctx.commands.execute(nodeSetTextContent, { nodeId: node.id, content }, { scope: ctx.scope }).catch((error) => { if (!ctx.scope.signal.aborted) toast.error(getPluginErrorMessage(error), workbenchMessageOptions.error); });
    };

    const selectPrimary = (textId: string) => {
        const text = ctx.getNode(node.id)?.metadata?.texts?.find((item) => item.id === textId);
        if (!text?.content) return;
        void ctx.commands.execute(canvasApply, { ops: [{ type: "update_node", id: node.id, metadata: { content: text.content, primaryTextId: text.id } }] }, { scope: ctx.scope }).catch((error) => { if (!ctx.scope.signal.aborted) toast.error(getPluginErrorMessage(error), workbenchMessageOptions.error); });
    };

    if (!texts.length && !content && node.metadata?.status === "loading") return <TextSlotStatus ctx={ctx} text={{ id: node.id, content: "", status: "loading" }} />;
    if (!texts.length && node.metadata?.status === "error") return <div className="flex max-w-[260px] flex-col items-center gap-3 px-5 text-center">
        <div className="text-xs leading-5 text-destructive">{node.metadata.errorDetails || "生成失败"}</div>
        <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onClick={(event) => { event.stopPropagation(); void ctx.commands.execute(nodeRetry, { nodeId: node.id }, { scope: ctx.scope }).catch((error) => { if (!ctx.scope.signal.aborted) toast.error(getPluginErrorMessage(error), workbenchMessageOptions.error); }); }}>
            <RefreshCw className="size-3.5" />重试
        </button>
    </div>;

    return <CanvasNodeBatchFrame batchCount={texts.length} expanded={expanded}>
        {expanded ? texts.filter((text) => text.id !== primaryId).map((text, index) => <ExpandedTextCard key={text.id} ctx={ctx} text={text} index={index} onSetPrimary={() => selectPrimary(text.id)} />) : null}
        <div className="flex h-full w-full flex-col overflow-hidden rounded-3xl" onDoubleClick={(event) => { event.stopPropagation(); setEditing(true); }}>
            {editing ? <CanvasResourceMentionTextarea
                ref={textarea}
                className={`thin-scrollbar m-0 block h-full w-full resize-none appearance-none overflow-y-auto whitespace-pre-wrap break-words border-none bg-transparent font-mono outline-none select-text ${padding}`}
                style={textStyle} value={content} references={references} highlightLabels={false} onChange={update}
                onBlur={() => setEditing(false)} onKeyDown={(event) => { if (event.key === "Escape") setEditing(false); }}
                onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}
            /> : content ? <div className={`thin-scrollbar block h-full w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent font-mono ${padding}`} style={textStyle} onWheel={(event) => event.stopPropagation()}>{content}</div>
                : primary ? <TextSlotStatus ctx={ctx} text={primary} /> : <div className="p-4 font-mono" style={{ color: theme.node.placeholder }}>双击编辑文字</div>}
        </div>
        {texts.length > 1 ? <button
            type="button" className="absolute right-2.5 top-2.5 z-30 flex h-8 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-semibold shadow-[0_6px_18px_rgba(28,25,23,.12)] backdrop-blur-md transition hover:scale-[1.02]"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }} aria-label={expanded ? "备选文本已展开" : "备选文本已收起"}
            onClick={(event) => { event.stopPropagation(); ctx.setExpanded(!expanded); }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}
        ><span className="leading-none">{texts.length} 条</span><ChevronRight className={`size-3.5 opacity-80 transition-transform ${expanded ? "rotate-90" : ""}`} /></button> : null}
    </CanvasNodeBatchFrame>;
}

function ExpandedTextCard({ ctx, text, index, onSetPrimary }: { ctx: CanvasNodeContext; text: TextSlot; index: number; onSetPrimary: () => void }) {
    const { node, theme } = ctx;
    const count = node.metadata?.texts?.length || 0;
    const columns = Math.min(count, 4);
    const rows = Math.ceil(count / columns);
    const slot = index >= (rows - 1) * columns ? index + 1 : index;
    const x = (slot % columns) * (node.width + 18);
    const y = (Math.floor(slot / columns) - rows + 1) * (node.height + 18);
    return <div className="absolute z-20 overflow-hidden rounded-3xl border shadow-[0_18px_50px_rgba(28,25,23,.14)]" style={{ left: x, top: y, width: node.width, height: node.height, background: theme.node.panel, borderColor: theme.node.stroke, "--batch-from-x": `${-x}px`, "--batch-from-y": `${-y}px`, "--batch-from-rotate": `${4 + index * 2}deg`, animation: `canvas-batch-child-in 320ms ${index * 35}ms cubic-bezier(.2,.85,.18,1) both` } as CSSProperties} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
        {text.content ? <><div className="thin-scrollbar h-full overflow-y-auto whitespace-pre-wrap break-words px-4 pb-4 pt-14 font-mono text-sm leading-6" style={{ color: theme.node.text }} onWheel={(event) => event.stopPropagation()}>{text.content}</div>
            <button type="button" className="pointer-events-none absolute right-2.5 top-2.5 flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium opacity-0 transition duration-150 hover:bg-black/5 group-hover/node:pointer-events-auto group-hover/node:opacity-100 dark:hover:bg-white/10" style={{ color: theme.node.text }} onClick={(event) => { event.stopPropagation(); onSetPrimary(); }}><Star className="size-3.5" style={{ color: theme.node.activeStroke }} />设为主文本</button></>
            : <TextSlotStatus ctx={ctx} text={text} />}
    </div>;
}

function TextSlotStatus({ ctx, text }: { ctx: CanvasNodeContext; text: TextSlot }) {
    const { theme } = ctx;
    const failed = text.status === "error";
    const loading = text.status === "loading";
    return <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center" style={{ background: theme.node.fill, color: failed ? theme.node.text : theme.node.activeStroke }}>
        {failed ? <span className="text-xs leading-5">{text.errorDetails || "生成失败"}</span> : loading ? <div className="size-10 animate-spin rounded-full border-2" style={{ borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke }} /> : <span className="text-xs">没有返回内容</span>}
        {loading ? <span className="text-[10px] tracking-[0.2em]">生成中</span> : null}
    </div>;
}
