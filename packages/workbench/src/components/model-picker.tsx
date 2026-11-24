import { modelCapabilityLabels } from "@workbench/constant/labels";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { ModelIcon } from "@workbench/components/model-icon";
import { Input } from "@infinite-canvas/plugin-sdk/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@infinite-canvas/plugin-sdk/ui/popover";
import { cn } from "@infinite-canvas/plugin-sdk/ui/utils";
import type { ModelCapability } from "@infinite-canvas/shared/models";
import { findGroupModel, modelOptionLabel, modelOptionName, selectableModelsByCapability, type AiConfig } from "@workbench/stores/use-config-store";

type ModelPickerProps = {
    id?: string;
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    fullWidth?: boolean;
    placeholder?: string;
    onMissingConfig?: () => void;
};

export function ModelPicker({ id, config, value, onChange, capability, className, fullWidth = false, placeholder, onMissingConfig }: ModelPickerProps) {
    const pickerId = useId();
    const triggerRef = useRef<HTMLButtonElement>(null);
    const searchInput = useRef<HTMLInputElement>(null);
    const list = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [side, setSide] = useState<"top" | "bottom">("bottom");
    const [align, setAlign] = useState<"start" | "end">("start");
    const [search, setSearch] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);
    const options = useMemo(() => Array.from(new Set([...(config.channelMode === "local" && !capability ? [value] : []), ...selectableModelsByCapability(config, capability)].filter((model): model is string => Boolean(model)))), [capability, config, value]);
    const keyword = search.toLowerCase();
    const visibleOptions = useMemo(() => keyword ? options.filter((model) => `${modelOptionName(model)} ${modelProviderLabel(config, model)}`.toLowerCase().includes(keyword)) : options, [config, keyword, options]);
    const current = value || "";
    const selected = current && options.includes(current) ? current : "";
    const pickerPlaceholder = placeholder || "选择模型";

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    const choose = (model: string) => {
        onChange(model);
        setOpen(false);
    };
    const moveActive = (delta: number) => {
        if (!visibleOptions.length) return;
        const next = Math.min(Math.max(activeIndex + delta, 0), visibleOptions.length - 1);
        setActiveIndex(next);
        (list.current?.children[next] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
    };

    return (
        <Popover
            open={open}
            onOpenChange={(nextOpen) => {
                if (nextOpen && !options.length && config.channelMode === "local") onMissingConfig?.();
                if (nextOpen) {
                    window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
                    setSearch("");
                    setActiveIndex(Math.max(options.indexOf(current), 0));
                    const rect = triggerRef.current?.getBoundingClientRect();
                    if (rect) {
                        // 打开时确定方向，之后筛选不再触发翻转。
                        const spaceBelow = window.innerHeight - rect.bottom;
                        const width = Math.max(320, rect.width);
                        setSide(spaceBelow >= 360 || spaceBelow >= rect.top ? "bottom" : "top");
                        setAlign(rect.left + width > window.innerWidth - 12 && rect.right - width >= 12 ? "end" : "start");
                    }
                }
                setOpen(nextOpen);
            }}
        >
            <PopoverTrigger asChild>
                <button
                    id={id}
                    ref={triggerRef}
                    type="button"
                    className={cn(
                        "flex h-8 max-w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-2.5 text-sm font-normal transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20 dark:bg-input/30 dark:hover:bg-input/50 [&_svg]:shrink-0",
                        fullWidth ? "w-full min-w-0" : "w-fit min-w-[9rem]",
                        className,
                    )}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    title={selected ? modelOptionLabel(config, selected) : pickerPlaceholder}
                >
                    <ModelIcon model={selected} />
                    <span className="min-w-0 flex-1 truncate text-left">{selected ? modelOptionName(selected) : current ? "请先选择模型" : pickerPlaceholder}</span>
                    <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                data-canvas-no-zoom
                className="z-[1200] max-w-[calc(100vw-24px)] overflow-hidden rounded-md border bg-popover p-0 shadow-md"
                style={{ width: "max(20rem, var(--radix-popover-trigger-width))" }}
                align={align}
                side={side}
                sideOffset={6}
                avoidCollisions={false}
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    searchInput.current?.focus();
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <div className="border-b border-border/60 p-1.5">
                    <Input
                        ref={searchInput}
                        value={search}
                        onChange={(event) => {
                            setSearch(event.target.value);
                            setActiveIndex(0);
                            if (list.current) list.current.scrollTop = 0;
                        }}
                        onKeyDown={(event) => {
                            if (event.key === "ArrowDown") {
                                event.preventDefault();
                                moveActive(1);
                            } else if (event.key === "ArrowUp") {
                                event.preventDefault();
                                moveActive(-1);
                            } else if (event.key === "Enter" && visibleOptions[activeIndex]) {
                                event.preventDefault();
                                choose(visibleOptions[activeIndex]);
                            }
                        }}
                        aria-label="搜索模型或渠道"
                        placeholder="搜索模型或渠道"
                        className="h-8 border-0 bg-transparent px-2 shadow-none focus-visible:ring-0 dark:bg-transparent"
                    />
                </div>
                <div ref={list} role="listbox" aria-label="模型列表" className="thin-scrollbar max-h-[min(18rem,calc(var(--radix-popover-content-available-height)_-_3rem))] overflow-y-auto overscroll-contain p-1">
                    {visibleOptions.map((model, index) => (
                        <button
                            key={model}
                            type="button"
                            role="option"
                            aria-selected={model === current}
                            className={cn("flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm outline-none", index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent hover:text-accent-foreground")}
                            onMouseEnter={() => setActiveIndex(index)}
                            onClick={() => choose(model)}
                        >
                            <ModelIcon model={model} />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate">{modelOptionName(model)}</span>
                                {modelProviderLabel(config, model) ? <span className="block truncate text-xs text-muted-foreground">{modelProviderLabel(config, model)}</span> : null}
                            </span>
                            {model === current ? <CheckIcon className="size-4 shrink-0" /> : null}
                        </button>
                    ))}
                    {visibleOptions.length ? null : <div className="px-2 py-3 text-sm text-muted-foreground">{options.length ? "没有匹配的模型" : emptyModelLabel(config, capability)}</div>}
                </div>
            </PopoverContent>
        </Popover>
    );
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability ? modelCapabilityLabels[capability] : "";
    if (capability && config.models.length) return `请先在渠道里为${label}指定模型`;
    return config.models.length ? `暂无匹配的${label}模型` : "请先到配置里添加渠道和模型";
}

function modelProviderLabel(config: AiConfig, model: string) {
    const found = findGroupModel(config, model);
    return found ? `${found.channel.name}-${found.group.name}` : "";
}
