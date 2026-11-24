import { useRef } from "react";
import { CircleX, Search } from "lucide-react";
import { Input } from "@infinite-canvas/plugin-sdk/ui/input";
import { canvasThemes } from "@workbench/lib/canvas-theme";
import { useThemeStore } from "@workbench/stores/use-theme-store";

export function SidePanelSearch({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (value: string) => void }) {
    const input = useRef<HTMLInputElement>(null);
    const theme = canvasThemes[useThemeStore(state => state.theme)];
    return <div className="flex h-6 min-w-0 flex-1 items-center gap-1 rounded border px-1.5 focus-within:ring-1" style={{ borderColor: theme.node.stroke, background: theme.toolbar.panel }}>
        <Search aria-hidden className="size-3.5 shrink-0 opacity-50" />
        <Input ref={input} aria-label={placeholder} placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)}
            className="h-full min-w-0 border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent" />
        {value && <button type="button" aria-label="清空搜索" className="grid size-4 shrink-0 place-items-center opacity-55 hover:opacity-100" onClick={() => { onChange(""); input.current?.focus(); }}><CircleX className="size-3" /></button>}
    </div>;
}
