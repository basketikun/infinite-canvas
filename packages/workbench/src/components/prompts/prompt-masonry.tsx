import { useEffect, useState } from "react";

import { PromptCard } from "@workbench/components/prompts/prompt-card";
import type { Prompt } from "@workbench/services/api/prompts";

const breakpoints = [["(min-width: 80rem)", 4], ["(min-width: 64rem)", 3], ["(min-width: 40rem)", 2]] as const;

/** 提示词瀑布流：按顺序轮流放入各列，加载更多时已有卡片不会换位置。 */
export function PromptMasonry({ items, onOpen, onCopy, onSave }: { items: Prompt[]; onOpen: (item: Prompt) => void; onCopy: (item: Prompt) => void; onSave: (item: Prompt) => void }) {
    const [columnCount, setColumnCount] = useState(2);
    useEffect(() => {
        const queries = breakpoints.map(([query, count]) => [window.matchMedia(query), count] as const);
        const update = () => setColumnCount(queries.find(([query]) => query.matches)?.[1] ?? 1);
        update();
        queries.forEach(([query]) => query.addEventListener("change", update));
        return () => queries.forEach(([query]) => query.removeEventListener("change", update));
    }, []);
    return <div className="flex items-start gap-4">
        {Array.from({ length: columnCount }, (_, column) => <div key={column} className="flex min-w-0 flex-1 flex-col gap-4">
            {items.filter((_, index) => index % columnCount === column).map((item) => <PromptCard key={`${item.sourceId}:${item.id}`} item={item} onOpen={() => onOpen(item)} onCopy={() => onCopy(item)} onSave={() => onSave(item)} />)}
        </div>)}
    </div>;
}
