import { Puzzle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@infinite-canvas/plugin-sdk/ui/tooltip";
import type { PluginMenuItem } from "@infinite-canvas/plugin-sdk";

import { nodeBounds } from "@infinite-canvas/shared/canvas/ops/groups";
import { usePluginMenu } from "@workbench/hooks/use-plugin-menu";
import type { CanvasNodeData } from "@infinite-canvas/shared/canvas/schema/canvas";
import type { ViewportTransform } from "@workbench/types/canvas";

const SELECTION_PAD = 14;

export function CanvasSelectionToolbar({ nodes, viewport, showToolbar }: { nodes: CanvasNodeData[]; viewport: ViewportTransform; showToolbar: boolean }) {
    const { items, theme, execute, renderItemContent } = usePluginMenu({ location: "canvas.selectionToolbar", nodeIds: nodes.map((node) => node.id) }, []);
    if (nodes.length < 2) return null;

    const bounds = nodeBounds(nodes);
    const left = viewport.x + bounds.left * viewport.k - SELECTION_PAD;
    const top = viewport.y + bounds.top * viewport.k - SELECTION_PAD;
    const width = (bounds.right - bounds.left) * viewport.k + SELECTION_PAD * 2;
    const height = (bounds.bottom - bounds.top) * viewport.k + SELECTION_PAD * 2;
    const showActions = showToolbar && (items.length > 0);

    return (
        <>
            <svg className="pointer-events-none absolute z-[65] overflow-visible" style={{ left, top, width, height }}>
                <rect
                    x={1}
                    y={1}
                    width={Math.max(width - 2, 0)}
                    height={Math.max(height - 2, 0)}
                    rx={16}
                    ry={16}
                    fill={theme.canvas.selectionFill}
                    stroke={theme.canvas.selectionStroke}
                    strokeOpacity={0.55}
                    strokeWidth={1.5}
                    strokeDasharray="7 5"
                    strokeLinecap="round"
                />
            </svg>
            {showActions ? (
                <div
                    className="absolute z-[70] flex h-12 -translate-x-1/2 -translate-y-full items-center overflow-visible rounded-[18px] border text-[15px] shadow-[0_8px_28px_rgba(15,23,42,.12)]"
                    style={{ left: left + width / 2, top: top - 8, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <TooltipProvider delayDuration={200} skipDelayDuration={0}>{items.map((item) => item.type === "separator"
                        ? <div key={item.id} role="separator" className="mx-1 h-5 border-l" style={{ borderColor: theme.toolbar.border }} />
                        : item.type === "content" ? <div key={item.id} className="inline-flex min-w-0 items-center" data-canvas-content={item.id}>{renderItemContent(item)}</div>
                        : <SelectionAction key={item.id} item={item} onClick={() => execute(item)} />)}</TooltipProvider>
                </div>
            ) : null}
        </>
    );
}

function SelectionAction({ item, onClick }: { item: Extract<PluginMenuItem, { type: "action" }>; onClick: () => void }) {
    const label = item.tooltip ?? item.title;
    const button = <button type="button" className="group relative flex h-12 items-center whitespace-nowrap px-1.5 disabled:pointer-events-none disabled:opacity-40" onClick={onClick} disabled={item.disabled} aria-label={label} aria-pressed={item.active} data-canvas-action={item.id} style={{ color: item.danger ? "var(--destructive)" : undefined }}>
        <span className="flex h-9 items-center gap-2 rounded-lg px-2.5 transition group-hover:bg-black/5 group-aria-pressed:bg-black/5 dark:group-hover:bg-white/10 dark:group-aria-pressed:bg-white/10 [&>svg]:size-4">
            {item.icon ?? <Puzzle className="size-4" />}
            {item.showLabel !== false ? <span>{item.title}</span> : null}
        </span>
    </button>;
    return (
        <Tooltip>
            <TooltipTrigger asChild data-canvas-no-zoom>
                {item.disabled ? <span role="button" tabIndex={0} aria-disabled aria-label={label} aria-pressed={item.active} className="inline-flex cursor-not-allowed rounded-lg">{button}</span> : button}
            </TooltipTrigger>
            <TooltipContent side="top" className="z-[1100] text-[13px] font-medium" data-canvas-no-zoom>{label}</TooltipContent>
        </Tooltip>
    );
}
