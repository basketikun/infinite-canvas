import { Cpu } from "lucide-react";

import { isMonochromeModelIcon, resolveModelIcon } from "@workbench/lib/model-utils";
import { cn } from "@infinite-canvas/plugin-sdk/ui/utils";
import { modelOptionName } from "@workbench/stores/use-config-store";

export function ModelIcon({ model, className }: { model: string; className?: string }) {
    const icon = resolveModelIcon(modelOptionName(model));
    if (!icon) return <Cpu aria-hidden="true" className={cn("size-4 shrink-0 opacity-70", className)} />;
    return <img src={icon} alt="" className={cn("size-4 shrink-0 object-contain", isMonochromeModelIcon(icon) && "dark:invert", className)} />;
}
