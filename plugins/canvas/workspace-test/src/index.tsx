import { definePlugin } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps, CanvasNodeWorkspaceProps } from "@infinite-canvas/plugin-sdk";

const buttonStyle = (ctx: CanvasNodeContentProps["ctx"]) => ({
    border: `1px solid ${ctx.theme.toolbar.border}`,
    borderRadius: 8,
    background: ctx.theme.toolbar.panel,
    color: ctx.theme.node.text,
    cursor: "pointer",
    padding: "7px 12px",
    fontSize: 12,
});

function WorkspaceTestContent({ ctx }: CanvasNodeContentProps) {
    return (
        <div
            data-canvas-no-zoom
            style={{ display: "flex", height: "100%", width: "100%", flexDirection: "column", gap: 10, padding: 16, boxSizing: "border-box", color: ctx.theme.node.text }}
        >
            <div style={{ fontSize: 15, fontWeight: 600 }}>Plugin Workspace 测试</div>
            <div style={{ flex: 1, fontSize: 12, lineHeight: 1.6, opacity: 0.72 }}>
                双击节点，或点击按钮，打开通用全屏 Workspace。
                <br />
                当前节点：{ctx.node.title}
            </div>
            <button type="button" style={buttonStyle(ctx)} onMouseDown={(event) => event.stopPropagation()} onClick={() => ctx.openWorkspace()}>
                打开 Workspace
            </button>
        </div>
    );
}

function WorkspaceTestWorkspace({ ctx, onClose }: CanvasNodeWorkspaceProps) {
    return (
        <div style={{ display: "flex", minHeight: 0, flex: 1, flexDirection: "column", padding: 24, boxSizing: "border-box", color: ctx.theme.node.text }}>
            <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                <div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>Fullscreen Plugin Workspace</div>
                    <div style={{ marginTop: 4, fontSize: 12, opacity: 0.68 }}>这是 Phase 1 的通用 Workspace 测试页，不包含 Blockout 逻辑。</div>
                </div>
                <button type="button" style={buttonStyle(ctx)} onClick={onClose}>
                    返回画布
                </button>
            </header>
            <div style={{ display: "grid", maxWidth: 720, gap: 12, marginTop: 32, padding: 20, border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 16, background: ctx.theme.node.panel }}>
                <div>节点标题：{ctx.node.title}</div>
                <div>节点 ID：{ctx.node.id}</div>
                <div>当前缩放：{ctx.scale.toFixed(2)}</div>
                <div>节点仍由原 Canvas 管理；关闭后应保留原来的节点、选区和 viewport。</div>
            </div>
            <div style={{ marginTop: "auto", paddingTop: 24, fontSize: 12, opacity: 0.58 }}>也可以直接按 Escape 返回画布。</div>
        </div>
    );
}

export default definePlugin({
    id: "workspace-test",
    name: "Workspace 测试插件",
    version: "0.1.0",
    description: "验证全屏 Plugin Workspace 的打开、关闭和 Canvas 状态保持。",
    nodes: [
        {
            type: "workspace-test:node",
            title: "Workspace 测试",
            icon: "🧪",
            description: "Phase 1 全屏 Workspace 验证节点",
            defaultSize: { width: 300, height: 190 },
            minimapColor: "#0ea5e9",
            hidePanel: true,
            Content: WorkspaceTestContent,
            Workspace: WorkspaceTestWorkspace,
        },
    ],
});
