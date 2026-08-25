import type { SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { modelOptionAlias, modelOptionChannelName, useConfigStore } from "@/stores/use-config-store";

export function ImageChannelBadge({ model, pinned, onPinnedChange, className }: { model?: string; pinned: boolean; onPinnedChange: (pinned: boolean) => void; className?: string }) {
    const { t } = useTranslation();
    const config = useConfigStore((state) => state.config);
    const channels = config.channels;
    const channelName = modelOptionChannelName(channels, model || "");
    if (!channelName || !model) return null;

    const modelName = modelOptionAlias(config, model);
    const title = t(pinned ? "imageChannelBadge.autoHide" : "imageChannelBadge.showAlways", { channel: channelName, model: modelName });
    const stopPropagation = (event: SyntheticEvent) => event.stopPropagation();

    return (
        <button
            type="button"
            className={cn(
                "pointer-events-none absolute bottom-2 right-2 z-40 max-w-[calc(100%-16px)] truncate rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium leading-none text-white opacity-0 shadow-sm backdrop-blur-sm transition-[opacity,background-color] duration-150 hover:bg-black/70 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 group-hover/channel:pointer-events-auto group-hover/channel:opacity-100 group-focus-within/channel:pointer-events-auto group-focus-within/channel:opacity-100",
                pinned && "pointer-events-auto opacity-100",
                className,
            )}
            title={title}
            aria-label={title}
            aria-pressed={pinned}
            onClick={(event) => {
                event.stopPropagation();
                onPinnedChange(!pinned);
            }}
            onMouseDown={stopPropagation}
            onPointerDown={stopPropagation}
        >
            {channelName}
        </button>
    );
}
