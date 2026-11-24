import type { ReactNode } from "react";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@infinite-canvas/plugin-sdk/ui/tooltip";

export function ImageEditorAction({ label, hint = label, disabled, onClick, children }: { label: string; hint?: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
    return <Tooltip>
        <TooltipTrigger asChild><span className="inline-flex">
            <Button type="button" variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick}>{children}</Button>
        </span></TooltipTrigger>
        <TooltipContent className="z-[1100]">{hint}</TooltipContent>
    </Tooltip>;
}
