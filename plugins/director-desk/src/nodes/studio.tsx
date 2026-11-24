import { Box } from "lucide-react";
import type { CanvasNodeDefinition } from "@infinite-canvas/plugin-sdk";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Studio } from "../components/studio";
export const studio: CanvasNodeDefinition = {
    type: "director-desk:studio", title: "3D 导演台", description: "搭建 3D 场景，拍照或录制视频", icon: <Box />, defaultSize: { width: 350, height: 350 },
    appearance: { background: "fill", border: "normal", bottomGradient: false },
    panelPresentation: "fullscreen",
    Content: ({ ctx }) => <div className="flex h-full w-full flex-col items-center justify-center gap-4" style={{ color: ctx.theme.node.text }}>
        <Box size={36} aria-hidden style={{ color: ctx.theme.node.muted }} />
        <p className="text-sm">搭建 3D 场景，拍照或录制视频</p>
        <Button type="button" variant="outline" onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); ctx.openPanel(); }}>打开导演台</Button>
    </div>,
    Panel: ({ ctx, onClose }) => <Studio ctx={ctx.plugin} node={ctx} onClose={onClose} />,
};
