import { type UIEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import { PromptMasonry } from "@workbench/components/prompts/prompt-masonry";
import { FilterGroup, PromptLoading, PromptSearch } from "@workbench/components/prompts/prompt-list-controls";
import { ListEmpty } from "@workbench/components/ui/list-empty";
import { usePromptList } from "@workbench/components/prompts/use-prompt-list";
import { PromptDetailDialog } from "@workbench/components/prompts/prompt-detail-dialog";
import { useCopyText } from "@workbench/hooks/use-copy-text";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { ALL_PROMPTS_OPTION, type Prompt } from "@workbench/services/api/prompts";
import { savePromptAssets } from "@workbench/services/prompt-assets";

export default function PromptsPage() {
    const [titleKeyword, setTitleKeyword] = useState("");
    const [selectedCategory, setSelectedCategory] = useState(ALL_PROMPTS_OPTION);
    const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
    const copyText = useCopyText();
    const { query, items: promptItems, categories: promptCategoryOptions, total: totalPrompts } = usePromptList({ keyword: titleKeyword, tags: [], category: selectedCategory });

    useEffect(() => {
        if (query.isError) {
            console.error("[提示词] 读取列表失败", query.error);
            toast.error("获取提示词失败", workbenchMessageOptions.error);
        }
    }, [query.error, query.isError]);

    const savePromptAsset = async (item: Prompt) => {
        try {
            const result = await savePromptAssets(item);
            if (result.imageFailed) toast.warning("文本已加入，封面图片暂时无法保存。", workbenchMessageOptions.warning);
            else toast.success("已加入我的资产", workbenchMessageOptions.success);
        } catch (error) {
            console.error("[提示词] 加入资产失败", error);
            toast.error("暂时无法保存素材，请重试。", workbenchMessageOptions.error);
        }
    };

    const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
        const target = event.currentTarget;
        if (query.hasNextPage && !query.isFetchingNextPage && target.scrollTop + target.clientHeight >= target.scrollHeight - 160) void query.fetchNextPage();
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-800 dark:text-stone-100">
            <main className="min-h-0 flex-1 overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-4 py-6 [background-size:16px_16px] sm:px-6 lg:py-8 dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)]" onScroll={handleListScroll}>
                <div className="mx-auto max-w-7xl">
                    <div className="text-center">
                        <h1 className="text-2xl font-semibold text-stone-950 dark:text-stone-100">提示词中心</h1>
                        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{`当前共 ${totalPrompts} 条提示词`}</p>
                    </div>
                    <div className="mt-6 min-w-0">
                        <PromptSearch value={titleKeyword} onChange={setTitleKeyword} placeholder="搜索标题、内容或标签" />
                        <div className="mt-4"><FilterGroup label="分类" options={promptCategoryOptions} selected={[selectedCategory]} onChange={setSelectedCategory} /></div>
                        <section className="min-w-0">
                            {query.isLoading ? <PromptLoading className="h-60" /> : <div className="mt-5">
                                <PromptMasonry items={promptItems} onOpen={setSelectedPrompt} onCopy={(item) => copyText(item.prompt, "提示词已复制")} onSave={(item) => void savePromptAsset(item)} />
                                {!promptItems.length && <ListEmpty className="py-16" text="没有找到匹配的提示词" />}
                            </div>}
                            <div className="mt-6 text-center text-xs text-stone-500 dark:text-stone-400">{query.isFetchingNextPage ? "加载中..." : query.hasNextPage ? "继续向下滚动加载更多" : promptItems.length > 0 ? "已经到底了" : null}</div>
                        </section>
                    </div>
                </div>
            </main>

            <PromptDetailDialog prompt={selectedPrompt} onClose={() => setSelectedPrompt(null)} onCopy={(prompt) => copyText(prompt, "提示词已复制")} onSaveAsset={savePromptAsset} />
        </div>
    );
}

