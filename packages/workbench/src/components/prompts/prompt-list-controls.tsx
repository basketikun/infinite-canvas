import { Search } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { Toggle } from "radix-ui";
import { Input } from "@infinite-canvas/plugin-sdk/ui/input";
import { cn } from "@infinite-canvas/plugin-sdk/ui/utils";
import { ALL_PROMPTS_OPTION } from "@workbench/services/api/prompts";

type PromptFiltersProps = {
    categories: string[];
    tags: string[];
    selectedCategory: string;
    selectedTags: string[];
    onCategoryChange: (category: string) => void;
    onTagsChange: Dispatch<SetStateAction<string[]>>;
    className?: string;
};

export function FilterGroup({ label, options, selected, onChange }: { label: string; options: string[]; selected: string[]; onChange: (value: string) => void }) {
    return <div role="group" aria-label={label}>
        <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-stone-400 dark:text-stone-500">{label}</div>
        <div className="flex flex-wrap gap-1.5">
            {options.map((option) => {
                const pressed = selected.includes(option);
                return <Toggle.Root key={option} pressed={pressed} onPressedChange={() => onChange(option)} className={cn("prompt-filter-tag", pressed && "is-active")}>
                    {option === ALL_PROMPTS_OPTION ? "全部" : option}
                </Toggle.Root>;
            })}
        </div>
    </div>;
}

export function PromptFilters({ categories, tags, selectedCategory, selectedTags, onCategoryChange, onTagsChange, className }: PromptFiltersProps) {
    const toggleTag = (tag: string) => {
        if (tag === ALL_PROMPTS_OPTION) onTagsChange([]);
        else onTagsChange((items) => items.includes(tag) ? items.filter((item) => item !== tag) : [...items, tag]);
    };
    return <div className={className}>
        <FilterGroup label="分类" options={categories} selected={[selectedCategory]} onChange={onCategoryChange} />
        <FilterGroup label="标签" options={tags} selected={selectedTags.length ? selectedTags : [ALL_PROMPTS_OPTION]} onChange={toggleTag} />
    </div>;
}

export function PromptSearch({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
    return <label className="prompt-search flex h-10 shrink-0 items-center gap-1 rounded-[8px] border px-[11px]">
        <Search aria-hidden className="size-4 shrink-0 text-stone-400" />
        <Input value={value} aria-label={placeholder} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>;
}

export function PromptLoading({ className, small = false }: { className: string; small?: boolean }) {
    return <div role="status" aria-label="加载中" className={cn("flex items-center justify-center", className)}>
        <svg aria-hidden viewBox="0 0 20 20" className={cn("fill-current text-primary", small ? "size-3.5" : "size-5")}>
            <g className="origin-center animate-spin [animation-duration:1.2s] motion-reduce:animate-none">
                <circle cx="5" cy="5" r="4" opacity=".3" /><circle cx="15" cy="5" r="4" opacity=".5" />
                <circle cx="15" cy="15" r="4" opacity=".7" /><circle cx="5" cy="15" r="4" />
            </g>
        </svg>
    </div>;
}

