import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@infinite-canvas/plugin-sdk/ui/tooltip";
import { Puzzle } from "lucide-react";
import type { PluginMenuItem, PluginMenuTarget } from "@infinite-canvas/plugin-sdk";
import { usePluginMenu } from "@workbench/hooks/use-plugin-menu";

export function CanvasToolbarContent({ target, items: defaults, showLabels }: { target: PluginMenuTarget; items: PluginMenuItem[]; showLabels: boolean }) {
    const { items, theme, execute, renderItemContent } = usePluginMenu(target, defaults);
    const nodeToolbar = target.location === "canvas.nodeToolbar";
    return <TooltipProvider delayDuration={200} skipDelayDuration={0}>{items.map((item) => {
        if (item.type === "separator") return <div key={item.id} role="separator" className="mx-1 h-6 w-px shrink-0" style={{ background: theme.toolbar.border }} />;
        if (item.type === "content") return <div key={item.id} className="inline-flex min-w-0 items-center" data-canvas-content={item.id}>{renderItemContent(item)}</div>;
        const button = <button
            type="button"
            data-canvas-action={item.id}
            aria-label={item.tooltip ?? item.title}
            aria-pressed={item.active}
            disabled={item.disabled}
            className={`inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg transition hover:bg-black/5 disabled:pointer-events-none disabled:opacity-40 dark:hover:bg-white/10 [&_svg]:size-4 ${nodeToolbar ? "mx-1 h-9 px-2.5 text-[15px]" : "h-8 min-w-8 px-2 text-xs"}`}
            style={{ color: item.active && target.location === "canvas.zoomControls" ? theme.toolbar.activeText : item.danger ? "var(--destructive)" : theme.toolbar.item, background: item.active ? theme.toolbar.activeBg : undefined }}
            onClick={() => execute(item)}
        >
            {item.icon ?? <Puzzle />}
            {(item.showLabel ?? showLabels) ? <span>{item.title}</span> : null}
        </button>;
        return <Tooltip key={item.id}>
            <TooltipTrigger asChild data-canvas-no-zoom>
                {item.disabled ? <span role="button" tabIndex={0} aria-disabled aria-label={item.tooltip ?? item.title} aria-pressed={item.active} className="inline-flex shrink-0 cursor-not-allowed rounded-lg">{button}</span> : button}
            </TooltipTrigger>
            <TooltipContent side="top" className="z-[1100]" data-canvas-no-zoom>{item.tooltip ?? item.title}</TooltipContent>
        </Tooltip>;
    })}</TooltipProvider>;
}
