import { useState } from "react";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@infinite-canvas/plugin-sdk/ui/tooltip";
import { BookOpen } from "lucide-react";

import { PromptSelectDialog } from "@workbench/components/prompts/prompt-select-dialog";
import { canvasThemes } from "@workbench/lib/canvas-theme";
import { useThemeStore } from "@workbench/stores/use-theme-store";

export function CanvasPromptLibrary({ onSelect }: { onSelect: (prompt: string) => void }) {
    const [open, setOpen] = useState(false);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <>
            <TooltipProvider delayDuration={200} skipDelayDuration={0}><Tooltip><TooltipTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    className="rounded-full bg-transparent p-0"
                    style={{ color: theme.node.text }}
                    onClick={() => setOpen(true)}
                    aria-label="提示词库"
                ><BookOpen className="size-3.5" /></Button>
            </TooltipTrigger><TooltipContent>提示词库</TooltipContent></Tooltip></TooltipProvider>
            <PromptSelectDialog open={open} onOpenChange={setOpen} onSelect={onSelect} />
        </>
    );
}
