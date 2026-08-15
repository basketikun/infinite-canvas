import { useEffect } from "react";

import type { CanvasNodeContext, CanvasNodeDefinition } from "@/types/canvas-plugin";

export type CanvasPluginWorkspaceProps = {
    definition: CanvasNodeDefinition;
    ctx: CanvasNodeContext;
    onClose: () => void;
};

export function CanvasPluginWorkspace({ definition, ctx, onClose }: CanvasPluginWorkspaceProps) {
    const Workspace = definition.Workspace;

    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            onClose();
        };

        window.addEventListener("keydown", handleKeyDown, true);
        return () => {
            window.removeEventListener("keydown", handleKeyDown, true);
            document.body.style.overflow = previousOverflow;
        };
    }, [onClose]);

    if (!Workspace) return null;

    return (
        <div
            className="fixed inset-0 z-[9999] flex min-h-0 flex-col overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label={definition.title}
            style={{ background: ctx.theme.canvas.background, color: ctx.theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
        >
            <Workspace ctx={ctx} onClose={onClose} />
        </div>
    );
}
