import { definePlugin, useEffect, useRef } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps, CanvasNodeWorkspaceProps } from "@infinite-canvas/plugin-sdk";

type DirectorContext = CanvasNodeContentProps["ctx"];

const buttonStyle = (ctx: DirectorContext) => ({
    border: `1px solid ${ctx.theme.toolbar.border}`,
    borderRadius: 8,
    background: ctx.theme.toolbar.panel,
    color: ctx.theme.node.text,
    cursor: "pointer",
    padding: "7px 12px",
    fontSize: 12,
});

function metadataText(ctx: DirectorContext, key: string, fallback: string) {
    const value = ctx.node.metadata?.[key];
    return typeof value === "string" && value.trim() ? value : fallback;
}

function metadataNumber(ctx: DirectorContext, key: string, fallback: number) {
    const value = ctx.node.metadata?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function DirectorContent({ ctx }: CanvasNodeContentProps) {
    const scene = metadataText(ctx, "scene", "Scene 01");
    const shot = metadataText(ctx, "shot", "Shot 01");
    const duration = metadataNumber(ctx, "duration", 5);
    const fps = metadataNumber(ctx, "fps", 24);
    const focalLength = metadataNumber(ctx, "focalLength", 35);
    const thumbnail = metadataText(ctx, "thumbnail", "");

    return (
        <div data-canvas-no-zoom style={{ display: "flex", height: "100%", width: "100%", gap: 12, padding: 12, boxSizing: "border-box", color: ctx.theme.node.text }}>
            <div style={{ display: "grid", width: 108, flexShrink: 0, placeItems: "center", borderRadius: 10, background: ctx.theme.node.panel, color: ctx.theme.node.muted, overflow: "hidden" }}>
                {thumbnail ? <img src={thumbnail} alt="Director thumbnail" style={{ height: "100%", width: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 30 }}>🎬</span>}
            </div>
            <div style={{ display: "flex", minWidth: 0, flex: 1, flexDirection: "column", gap: 7 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 15, fontWeight: 650 }}>{metadataText(ctx, "projectName", "Untitled Director")}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 10px", fontSize: 11, opacity: 0.72 }}>
                    <span>{scene}</span>
                    <span>{shot}</span>
                    <span>{duration}s · {fps}fps</span>
                    <span>{focalLength}mm</span>
                </div>
                <div style={{ marginTop: "auto", fontSize: 11, opacity: 0.6 }}>上游参考：0</div>
                <button type="button" style={buttonStyle(ctx)} onMouseDown={(event) => event.stopPropagation()} onClick={() => ctx.openWorkspace()}>
                    打开导演台
                </button>
            </div>
        </div>
    );
}

const DIRECTOR_PROTOCOL = "infinite-canvas-director-v1";

function isDirectorMessage(value: unknown): value is { protocol: string; type: string } {
    if (!value || typeof value !== "object") return false;
    const message = value as { protocol?: unknown; type?: unknown };
    return message.protocol === DIRECTOR_PROTOCOL && typeof message.type === "string";
}

function DirectorWorkspace({ ctx, onClose }: CanvasNodeWorkspaceProps) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const projectId = metadataText(ctx, "projectId", `director-project-${ctx.node.id}`);
    const projectName = metadataText(ctx, "projectName", "Untitled Director");
    const blockoutWebUrl = new URL("/plugins/blockout/workbench/index.html", window.location.origin).toString();

    useEffect(() => {
        const onMessage = (event: MessageEvent<unknown>) => {
            if (event.source !== iframeRef.current?.contentWindow || !isDirectorMessage(event.data)) return;
            if (event.data.type === "READY") {
                iframeRef.current?.contentWindow?.postMessage(
                    {
                        protocol: DIRECTOR_PROTOCOL,
                        type: "INIT",
                        payload: { nodeId: ctx.node.id, projectId, projectName },
                    },
                    event.origin,
                );
            } else if (event.data.type === "CLOSE") {
                onClose();
            }
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [ctx.node.id, onClose, projectId, projectName]);

    return (
        <div style={{ display: "flex", minHeight: 0, flex: 1, flexDirection: "column", background: "#111113", color: ctx.theme.node.text }}>
            <iframe ref={iframeRef} title="Blockout Web" src={blockoutWebUrl} style={{ minHeight: 0, width: "100%", flex: 1, border: 0, background: "#111113" }} />
        </div>
    );
}

export default definePlugin({
    id: "director",
    name: "Director 导演台",
    version: "0.1.0",
    description: "Infinite Canvas Director 节点壳，加载 Blockout Web 并通过 Embed Bridge 初始化。",
    nodes: [
        {
            type: "director:blockout",
            title: "Director 导演台",
            icon: "🎬",
            description: "打开全屏 Director Workspace",
            defaultSize: { width: 360, height: 240 },
            defaultMetadata: {
                projectId: "",
                projectName: "Untitled Director",
                scene: "Scene 01",
                shot: "Shot 01",
                duration: 5,
                fps: 24,
                focalLength: 35,
            },
            minimapColor: "#f97316",
            hidePanel: true,
            Content: DirectorContent,
            Workspace: DirectorWorkspace,
        },
    ],
});
