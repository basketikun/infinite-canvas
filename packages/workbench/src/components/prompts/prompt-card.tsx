import { Copy, FileText, FolderPlus } from "lucide-react";
import { useState } from "react";

import { cn } from "@infinite-canvas/plugin-sdk/ui/utils";

import type { Prompt } from "@workbench/services/api/prompts";

type PromptCardProps = {
    item: Prompt;
    onOpen: () => void;
    onCopy: () => void;
    onSave?: () => void;
    compact?: boolean;
};

export function PromptCard({ item, onOpen, onCopy, onSave, compact = false }: PromptCardProps) {
    const [imageState, setImageState] = useState<"loading" | "loaded" | "failed">("loading");
    if (!compact) return imageState === "failed" ? null : (
        <article className="prompt-card group relative overflow-hidden rounded-lg">
            <button type="button" aria-label={item.title} className={cn("block w-full cursor-pointer text-left", item.coverUrl && imageState === "loading" && "aspect-[3/4] animate-pulse bg-stone-200 dark:bg-stone-800")} onClick={onOpen}>
                {item.coverUrl ? <img src={item.coverUrl} alt={item.title} className={cn("block h-auto w-full transition-opacity duration-300", imageState === "loading" && "opacity-0")} loading="lazy" onLoad={() => setImageState("loaded")} onError={() => setImageState("failed")} />
                    : <span className="grid aspect-[4/3] w-full place-items-center bg-stone-100 p-4 text-stone-400 dark:bg-stone-900 dark:text-stone-600"><FileText className="size-8" /></span>}
            </button>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-black/75 via-black/40 to-transparent p-3 pt-10 opacity-0 transition-opacity duration-200 group-focus-within:opacity-100 group-hover:opacity-100">
                <h2 className="line-clamp-2 text-sm font-semibold text-white">{item.title}</h2>
                <div className="pointer-events-auto flex gap-1.5">
                    <button type="button" className="inline-flex h-7 items-center gap-1 rounded bg-white/15 px-2 text-xs text-white backdrop-blur transition hover:bg-white/30" onClick={onCopy}><Copy className="size-3.5" />复制</button>
                    {onSave ? <button type="button" className="inline-flex h-7 items-center gap-1 rounded bg-white/15 px-2 text-xs text-white backdrop-blur transition hover:bg-white/30" onClick={onSave}><FolderPlus className="size-3.5" />加入资产</button> : null}
                </div>
            </div>
        </article>
    );
    return (
        <article className="prompt-card group cursor-pointer overflow-hidden transition-transform duration-200 hover:-translate-y-1">
            <button type="button" aria-label={item.title} className="prompt-card-cover block cursor-pointer text-left" onClick={onOpen}>
                {item.coverUrl ? <img src={item.coverUrl} alt={item.title} className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" loading="lazy" />
                    : <span className="grid aspect-square w-full place-items-center bg-stone-100 text-stone-400 dark:bg-stone-900 dark:text-stone-600"><FileText className="size-8" /></span>}
            </button>
            <button type="button" className="block w-full cursor-pointer text-left" onClick={onOpen}>
                <div className="px-3 py-2.5"><h2 className="line-clamp-1 text-sm font-semibold text-stone-950 dark:text-stone-100">{item.title}</h2></div>
            </button>
        </article>
    );
}
