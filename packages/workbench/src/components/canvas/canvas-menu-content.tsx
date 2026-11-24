import { Puzzle, X } from "lucide-react";
import type { PluginMenuItem, PluginMenuTarget } from "@infinite-canvas/plugin-sdk";
import { usePluginMenu } from "@workbench/hooks/use-plugin-menu";

export function CanvasMenuContent({ target, items: defaults, title, onClose }: { target: PluginMenuTarget; items: PluginMenuItem[]; title?: string; onClose: () => void }) {
    const { items, theme, execute, renderItemContent } = usePluginMenu(target, defaults, onClose);
    return <>
        {title ? <div className="mb-1 flex min-h-8 items-center justify-between pl-2.5 pr-1">
            <span className="text-xs font-medium" style={{ color: theme.node.muted }}>{title}</span>
            <button type="button" className="grid size-7 place-items-center rounded-md opacity-55 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10" onClick={onClose} aria-label="关闭"><X className="size-4" /></button>
        </div> : null}
        <div className="grid min-w-0 grid-cols-1 gap-0.5">
            {items.map((item) => item.type === "separator" ? <div key={item.id} role="separator" className="my-1 border-t" style={{ borderColor: theme.toolbar.border }} /> : item.type === "content" ? <div key={item.id} className="min-w-0" data-canvas-content={item.id}>{renderItemContent(item)}</div> : <button
                key={item.id}
                type="button"
                disabled={item.disabled}
                title={item.tooltip}
                className={`flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-black/5 focus-visible:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10 dark:focus-visible:bg-white/10 ${item.description ? "min-h-14" : "min-h-9"}`}
                style={{ color: item.danger ? "var(--destructive)" : theme.node.text }}
                onClick={() => execute(item)}
            >
                <span className="grid size-5 shrink-0 place-items-center text-sm leading-5 [&>svg]:size-4" style={{ color: item.danger ? "inherit" : theme.node.muted }}>{item.icon ?? <Puzzle />}</span>
                <span className="min-w-0 flex-1">
                    <span className={`block break-words font-medium leading-5 ${title ? "text-sm" : "text-xs"}`}>{item.title}</span>
                    {item.description ? <span className="mt-0.5 block whitespace-normal break-words text-xs leading-4" style={{ color: theme.node.muted }}>{item.description}</span> : null}
                </span>
                {item.shortcut ? <span className="ml-6 shrink-0 text-xs leading-5 opacity-45">{item.shortcut}</span> : null}
            </button>)}
        </div>
    </>;
}
