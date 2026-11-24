import { X } from "lucide-react";
import { type UIEvent, useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { toast } from "sonner";

import { ALL_PROMPTS_OPTION } from "@workbench/services/api/prompts";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { PromptCard } from "./prompt-card";
import { PromptFilters, PromptLoading, PromptSearch } from "./prompt-list-controls";
import { ListEmpty } from "@workbench/components/ui/list-empty";
import { usePromptList } from "./use-prompt-list";

export function PromptSelectDialog({ open, onOpenChange, onSelect }: { open: boolean; onOpenChange: (open: boolean) => void; onSelect: (prompt: string) => void }) {
    const trigger = useRef<HTMLElement | null>(null);
    const filterPane = useRef<HTMLElement>(null);
    const resultPane = useRef<HTMLDivElement>(null);
    const scroll = useRef({ filters: 0, results: 0 });
    const [keyword, setKeyword] = useState("");
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [selectedCategory, setSelectedCategory] = useState(ALL_PROMPTS_OPTION);
    const { query, items, tags: promptTags, categories: promptCategories } = usePromptList({ keyword, tags: selectedTags, category: selectedCategory, enabled: open });
    const selectPrompt = (prompt: string) => {
        if (!open) return;
        onSelect(prompt);
        onOpenChange(false);
    };

    useEffect(() => {
        if (open && query.isError) {
            console.error("[选词器] 读取提示词失败", query.error);
            toast.error("获取提示词失败", workbenchMessageOptions.error);
        }
    }, [open, query.error, query.isError]);

    const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
        const target = event.currentTarget;
        scroll.current.results = target.scrollTop;
        if (open && query.hasNextPage && !query.isFetchingNextPage && target.scrollTop + target.clientHeight >= target.scrollHeight - 160) void query.fetchNextPage();
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-[1000] bg-black/45 duration-300 motion-safe:data-open:animate-in motion-safe:data-open:fade-in-0 motion-safe:data-closed:animate-out motion-safe:data-closed:fade-out-0" />
                <Dialog.Content aria-describedby={undefined} data-canvas-no-zoom
                    className="workbench-dialog fixed top-1/2 left-1/2 z-[1000] w-[calc(100%_-_16px)] max-w-[880px] -translate-x-1/2 -translate-y-1/2 rounded-[8px] bg-(--workbench-elevated-panel) px-6 py-5 text-(--workbench-elevated-text) outline-none duration-300 motion-safe:data-open:animate-in motion-safe:data-open:fade-in-0 motion-safe:data-open:zoom-in-95 motion-safe:data-closed:animate-out motion-safe:data-closed:fade-out-0 motion-safe:data-closed:zoom-out-95"
                    onOpenAutoFocus={() => {
                        trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                        if (filterPane.current) filterPane.current.scrollTop = scroll.current.filters;
                        if (resultPane.current) resultPane.current.scrollTop = scroll.current.results;
                    }}
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        if (trigger.current?.isConnected && (document.activeElement === document.body || event.currentTarget instanceof HTMLElement && event.currentTarget.contains(document.activeElement))) {
                            trigger.current.focus({ preventScroll: true });
                        }
                    }}>
                    <Dialog.Close aria-label="关闭" className="absolute right-3 top-3 grid size-8 cursor-pointer place-items-center rounded text-current/50 transition hover:bg-muted hover:text-current">
                        <X aria-hidden className="size-5" />
                    </Dialog.Close>
                    <Dialog.Title className="mb-2 text-base font-semibold leading-6">提示词库</Dialog.Title>
                    <div className="grid h-[62dvh] min-h-0 gap-5 sm:grid-cols-[200px_minmax(0,1fr)]" onWheelCapture={(event) => event.stopPropagation()}>
                        <aside ref={filterPane} onScroll={(event) => { scroll.current.filters = event.currentTarget.scrollTop; }} className="thin-scrollbar min-h-0 overflow-y-auto border-r border-stone-200 pr-4 dark:border-stone-800">
                            <PromptFilters className="space-y-5" categories={promptCategories} tags={promptTags} selectedCategory={selectedCategory} selectedTags={selectedTags}
                                onCategoryChange={setSelectedCategory} onTagsChange={setSelectedTags} />
                        </aside>
                        <section className="flex min-h-0 min-w-0 flex-col">
                            <PromptSearch value={keyword} onChange={setKeyword} placeholder="按标题查询" />
                            <div ref={resultPane} className="thin-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto pr-2" onScroll={handleListScroll}>
                                {query.isLoading && <PromptLoading className="h-40" />}
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                                    {items.map((item) => <PromptCard key={`${item.sourceId}:${item.id}`} item={item} onOpen={() => selectPrompt(item.prompt)} onCopy={() => selectPrompt(item.prompt)} compact />)}
                                </div>
                                {!query.isLoading && !items.length && <ListEmpty className="py-8" text="没有找到匹配的提示词" />}
                                {query.isFetchingNextPage && <PromptLoading className="py-4" small />}
                            </div>
                        </section>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
