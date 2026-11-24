import { Check } from "lucide-react";
import { Input } from "@infinite-canvas/plugin-sdk/ui/input";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Textarea } from "@infinite-canvas/plugin-sdk/ui/textarea";
import { cn } from "@infinite-canvas/plugin-sdk/ui/utils";
import { useId, useState } from "react";
import type { ModelCapability } from "@infinite-canvas/shared/models";
import { ModelPicker } from "@workbench/components/model-picker";
import { generationOptionCatalog, normalizeGenerationOptions, type GenerationOptionCategory } from "@workbench/lib/generation-options";
import { useConfigStore } from "@workbench/stores/use-config-store";
import styles from "./app-config-modal.module.css";
import { SettingsNetworkSwitch } from "./settings-network-controls";

const modelGroups: { capability: ModelCapability; modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel"; label: string }[] = [
    { capability: "image", modelKey: "imageModel", label: "默认生图模型" },
    { capability: "video", modelKey: "videoModel", label: "默认视频模型" },
    { capability: "text", modelKey: "textModel", label: "默认文本模型" },
    { capability: "audio", modelKey: "audioModel", label: "默认音频模型" },
];

export function ConfigPreferences() {
    const sectionId = useId();
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const options = normalizeGenerationOptions(config.generationOptions);
    const updateOptions = (category: GenerationOptionCategory, next: (typeof options)[GenerationOptionCategory]) => updateConfig("generationOptions", { ...options, [category]: next });
    const toggleOption = (category: GenerationOptionCategory, value: string) => {
        const current = options[category];
        const target = current.find((option) => option.value === value);
        if (!target) return;
        if (target.enabled && current.filter((option) => option.enabled).length <= 1) return;
        updateOptions(category, current.map((option) => option.value === value ? { ...option, enabled: !option.enabled } : option));
    };
    const addOption = (category: GenerationOptionCategory, value: string, label: string) => {
        const raw = value.trim();
        if (!raw) return;
        const numeric = category === "imageCount" ? Number(raw) : null;
        if (numeric !== null && (!/^\d+$/.test(raw) || numeric < 1)) return;
        const text = numeric === null ? raw : String(numeric);
        const current = options[category];
        const existing = current.find((option) => option.value === text);
        if (existing) {
            // 同名值再次新增时允许更新中文名称，便于把英文值映射成中文显示。
            const nextLabel = label.trim() || existing.label;
            if (!existing.enabled || nextLabel !== existing.label) updateOptions(category, current.map((option) => option.value === text ? { ...option, enabled: true, label: nextLabel } : option));
        } else updateOptions(category, [...current, { value: text, label: label.trim() || (category === "imageCount" ? `${text} 张` : text), enabled: true }]);
    };
    return <>
        <section aria-labelledby={sectionId} className="mb-4">
            <h3 id={sectionId} className="mb-2 text-sm font-semibold">默认模型</h3>
            <div className="grid gap-4 md:grid-cols-2">
                {modelGroups.map(({ capability, modelKey, label }) => <div key={modelKey} className="mb-6 min-w-0">
                    <label htmlFor={`${sectionId}-${modelKey}`} className="mb-2 block w-fit text-sm leading-[22px]">{label}</label>
                    <ModelPicker id={`${sectionId}-${modelKey}`} config={config} value={config[modelKey]} onChange={(model) => updateConfig(modelKey, model)} capability={capability} fullWidth />
                </div>)}
            </div>
        </section>
        <section aria-labelledby={`${sectionId}-options`} className="mb-8">
            <h3 id={`${sectionId}-options`} className="mb-1 text-sm font-semibold">生成可选项</h3>
            <p className="mb-4 text-sm leading-[22px] text-(--channel-tertiary)">决定创作页和画布参数弹窗里出现哪些选项；具体使用哪一个仍在参数弹窗里选择。点击标签即可添加或移除，至少保留一个。</p>
            <div className={`${styles.channels} grid gap-x-8 gap-y-6 md:grid-cols-2`}>
                {(Object.keys(generationOptionCatalog) as GenerationOptionCategory[]).map((category) => <OptionCategoryEditor
                    key={category}
                    label={generationOptionCatalog[category].label}
                    options={options[category]}
                    namePlaceholder={category === "quality" ? "中文名（如 超高）" : "名称（可选）"}
                    valuePlaceholder={optionValuePlaceholder(category)}
                    onToggle={(value) => toggleOption(category, value)}
                    onAdd={(value, label) => addOption(category, value, label)}
                    onRestore={() => updateOptions(category, options[category].map((option) => ({ ...option, enabled: true })))}
                />)}
            </div>
        </section>
        <section aria-labelledby={`${sectionId}-generation`} className={`${styles.channels} generation-preferences settings-network generation-workspace-controls`}>
            <h3 id={`${sectionId}-generation`} className="mb-2 text-sm font-semibold">画布与交互</h3>
            <div className="mb-6 min-w-0 max-w-[420px]">
                <label htmlFor={`${sectionId}-count`} className="mb-2 block w-fit text-sm leading-[22px]">画布默认生图张数</label>
                <Input id={`${sectionId}-count`} className="settings-network-field" type="number" min={1} max={15} aria-describedby={`${sectionId}-count-help`} value={config.canvasImageCount}
                    onChange={(event) => updateConfig("canvasImageCount", event.target.value)} onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))} />
                <p id={`${sectionId}-count-help`} className="min-h-6 text-sm leading-[22px] text-(--channel-tertiary)">新建画布图片节点时使用；创作页张数可在输入框的参数弹窗里选择。</p>
            </div>
        </section>
        <div className="settings-network generation-workspace-controls mb-6 flex min-h-8 items-center justify-between gap-3">
            <label htmlFor={`${sectionId}-focus`} className="text-sm">选中自动居中</label>
            <SettingsNetworkSwitch id={`${sectionId}-focus`} checked={config.autoFocusOnSelect} onCheckedChange={(checked) => updateConfig("autoFocusOnSelect", checked)} />
        </div>
        <div className="generation-workspace-controls">
            <label htmlFor={`${sectionId}-system-prompt`} className="mb-2 block w-fit text-sm leading-[22px]">系统提示词</label>
            <Textarea id={`${sectionId}-system-prompt`} rows={4} className="min-h-0" value={config.systemPrompt} placeholder="例如：你是一位擅长电影感写实摄影的视觉导演。" onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
        </div>
    </>;
}

function optionValuePlaceholder(category: GenerationOptionCategory) {
    return ({
        quality: "英文值（如 xhigh）",
        imageScale: "值（如 6k）",
        imageRatio: "值（如 5:4）",
        imageCount: "数字（如 8）",
        videoResolution: "值（如 1440）",
        videoRatio: "值（如 5:4）",
        audioVoice: "值（如 luna）",
        audioFormat: "值（如 m4a）",
        audioSpeed: "值（如 2）",
    } as Record<GenerationOptionCategory, string>)[category];
}

function OptionCategoryEditor({ label, options, namePlaceholder, valuePlaceholder, onToggle, onAdd, onRestore }: {
    label: string;
    options: { value: string; label: string; enabled: boolean }[];
    namePlaceholder: string;
    valuePlaceholder: string;
    onToggle: (value: string) => void;
    onAdd: (value: string, label: string) => void;
    onRestore: () => void;
}) {
    const [adding, setAdding] = useState(false);
    const [name, setName] = useState("");
    const [value, setValue] = useState("");
    const enabled = options.filter((option) => option.enabled).length;
    const submit = (event: React.FormEvent) => {
        event.preventDefault();
        if (!value.trim()) return;
        onAdd(value, name);
        setAdding(false);
        setName("");
        setValue("");
    };
    return <div className="min-w-0">
        <div className="mb-2 flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-medium">{label}<span className="ml-1.5 text-xs font-normal text-(--channel-tertiary)">{enabled}/{options.length}</span></span>
            <div className="flex shrink-0 items-center gap-1">
                <Button type="button" variant="ghost" size="xs" onClick={() => setAdding((current) => !current)}>{adding ? "取消" : "新增"}</Button>
                <Button type="button" variant="ghost" size="xs" disabled={enabled === options.length} onClick={onRestore}>恢复全部</Button>
            </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
            {options.map((option) => <button
                key={option.value}
                type="button"
                aria-pressed={option.enabled}
                disabled={option.enabled && enabled <= 1}
                title={option.enabled ? enabled <= 1 ? "至少保留一个可选项" : "点击移除" : "点击添加"}
                className={cn(
                    "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-60",
                    option.enabled ? "border-foreground/25 bg-muted text-foreground" : "border-dashed text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                )}
                onClick={() => onToggle(option.value)}
            >
                {option.enabled ? <Check className="size-3" aria-hidden="true" /> : null}
                {option.label}
            </button>)}
        </div>
        {adding ? <form className="mt-2 flex flex-wrap items-center gap-1.5" onSubmit={submit}>
            <Input className="h-8 w-32" aria-label={`${label}选项名称`} placeholder={namePlaceholder} value={name} onChange={(event) => setName(event.target.value)} />
            <Input className="h-8 w-32" aria-label={`${label}选项值`} placeholder={valuePlaceholder} value={value} onChange={(event) => setValue(event.target.value)} />
            <Button type="submit" size="xs" disabled={!value.trim()}>添加</Button>
        </form> : null}
    </div>;
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3))));
}
