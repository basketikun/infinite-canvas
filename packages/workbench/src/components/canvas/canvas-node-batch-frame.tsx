import type { ReactNode } from "react";
import { canvasThemes } from "@workbench/lib/canvas-theme";
import { useThemeStore } from "@workbench/stores/use-theme-store";

export function CanvasNodeBatchFrame({ batchCount, expanded, children }: { batchCount: number; expanded: boolean; children: ReactNode }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return <div className="group/batch relative h-full w-full overflow-visible">
        {batchCount > 1 ? <div className="pointer-events-none absolute inset-0 overflow-visible">
            {Array.from({ length: Math.min(batchCount - 1, 3) }).map((_, index) => <div
                key={index}
                className="absolute rounded-[inherit] border shadow-[0_10px_24px_rgba(68,64,60,.12)] transition-all duration-300 group-hover/batch:translate-x-1"
                style={{ inset: 0, background: `linear-gradient(135deg, ${theme.node.panel}, ${theme.node.fill})`, borderColor: theme.node.stroke, opacity: expanded ? 0 : 1, transform: `translate(${10 + index * 6}px, ${4 + index * 3}px) rotate(${1.5 + index}deg)`, zIndex: -index - 1 }}
            />)}
        </div> : null}
        {children}
    </div>;
}
