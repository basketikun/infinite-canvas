import { definePlugin } from "@infinite-canvas/plugin-sdk";
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

function escapeHtml(value: string) {
    return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);
}

function buildDirectorTestDocument(ctx: DirectorContext) {
    const projectId = metadataText(ctx, "projectId", `director-project-${ctx.node.id}`);
    const projectName = metadataText(ctx, "projectName", "Untitled Director");
    return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Director Workspace Test</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; background: #fafaf9; color: #292524; }
      main { box-sizing: border-box; min-height: 100vh; padding: 32px; }
      .eyebrow { color: #78716c; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; }
      h1 { margin: 10px 0 8px; font-size: 30px; }
      p { color: #57534e; line-height: 1.6; }
      .card { max-width: 720px; margin-top: 28px; padding: 20px; border: 1px solid #d6d3d1; border-radius: 16px; background: white; box-shadow: 0 12px 30px rgba(28,25,23,.08); }
      code { padding: 2px 6px; border-radius: 5px; background: #f5f5f4; }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">Director iframe test surface</div>
      <h1>${escapeHtml(projectName)}</h1>
      <p>这是 Phase 2 的 iframe 测试页面。下一阶段会将这里替换为 Blockout Web。</p>
      <div class="card">
        <div>当前 nodeId：<code>${escapeHtml(ctx.node.id)}</code></div>
        <div>当前 projectId：<code>${escapeHtml(projectId)}</code></div>
        <p>当前 iframe 只验证 Workspace 能区分不同 Director 节点，尚未接入 postMessage Bridge。</p>
      </div>
    </main>
  </body>
</html>`;
}

function DirectorWorkspace({ ctx, onClose }: CanvasNodeWorkspaceProps) {
    return (
        <div style={{ display: "flex", minHeight: 0, flex: 1, flexDirection: "column", color: ctx.theme.node.text }}>
            <header style={{ display: "flex", flexShrink: 0, alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 18px", borderBottom: `1px solid ${ctx.theme.node.stroke}`, background: ctx.theme.node.panel }}>
                <div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>Director Workspace</div>
                    <div style={{ marginTop: 3, fontSize: 11, opacity: 0.62 }}>Phase 2 · iframe 测试壳</div>
                </div>
                <button type="button" style={buttonStyle(ctx)} onClick={onClose}>← 返回画布</button>
            </header>
            <iframe title="Director iframe test surface" srcDoc={buildDirectorTestDocument(ctx)} style={{ minHeight: 0, width: "100%", flex: 1, border: 0, background: "#fafaf9" }} />
        </div>
    );
}

export default definePlugin({
    id: "director",
    name: "Director 导演台",
    version: "0.1.0",
    description: "Infinite Canvas Director 节点壳，当前加载 iframe 测试页面。",
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
