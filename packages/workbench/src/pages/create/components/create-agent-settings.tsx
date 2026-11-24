import { useState } from "react";
import { Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Input } from "@infinite-canvas/plugin-sdk/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@infinite-canvas/plugin-sdk/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@infinite-canvas/plugin-sdk/ui/select";
import { Switch } from "@infinite-canvas/plugin-sdk/ui/switch";
import type { AgentModelSettings, ReasoningEffort } from "@infinite-canvas/shared/model-execution";
import { reasoningEffortLabel } from "@workbench/components/text-settings-panel";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { findGroupModel, updateChannels, useConfigStore } from "@workbench/stores/use-config-store";

/** Agent 模式的上下文上限与自动压缩设置，保存在所选文本模型上。 */
export function CreateAgentSettings() {
    const config = useConfigStore((state) => state.config);
    const target = findGroupModel(config, config.textModel);
    const settings = target?.model?.agentSettings;
    const [draft, setDraft] = useState<string | null>(null);
    const update = (patch: Partial<AgentModelSettings>) => {
        const current = useConfigStore.getState().config;
        if (!target?.model || current.textModel !== config.textModel) return;
        const name = target.model.name;
        void updateChannels(current.channels.map((channel) => channel.id !== target.channel.id ? channel : {
            ...channel, groups: channel.groups.map((group) => group.id !== target.group.id ? group : {
                ...group, models: group.models.map((model) => model.name !== name ? model : { ...model, agentSettings: { ...model.agentSettings, ...patch } }),
            }),
        })).catch(() => toast.error("模型设置尚未保存，请检查连接后重试。", { ...workbenchMessageOptions.error, id: "create-agent-model-save" }));
    };
    const efforts: ReasoningEffort[] = target?.model?.scriptId === "gemini-text" ? ["auto", "low", "medium", "high"] : ["auto", "low", "medium", "high", "xhigh"];
    const commit = (input: HTMLInputElement) => {
        if (Number.isFinite(input.valueAsNumber)) {
            const next = Math.max(1, Math.round(input.valueAsNumber));
            if (next !== settings?.contextWindow) update({ contextWindow: next });
        }
        setDraft(null);
    };
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Agent 设置" title="上下文、思考层级与自动压缩" disabled={!target?.model}><Settings2 className="size-4" /></Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" sideOffset={6} className="w-72 space-y-3 p-3">
                <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                        <label htmlFor="create-agent-context-window" className="text-sm">上下文上限</label>
                        <div className="flex gap-1">
                            <Button type="button" variant="ghost" size="xs" onClick={() => update({ contextWindow: 200000 })}>200k</Button>
                            <Button type="button" variant="ghost" size="xs" onClick={() => update({ contextWindow: 1000000 })}>1m</Button>
                        </div>
                    </div>
                    <Input
                        id="create-agent-context-window"
                        type="number"
                        min={1}
                        step={1}
                        value={draft ?? settings?.contextWindow ?? ""}
                        placeholder="未设置，不自动压缩"
                        onChange={(event) => {
                            const input = event.currentTarget;
                            setDraft(input.value);
                            if (!input.value && !input.validity.badInput) update({ contextWindow: undefined });
                            else if (input.valueAsNumber >= 1) update({ contextWindow: input.valueAsNumber });
                        }}
                        onBlur={(event) => commit(event.currentTarget)}
                        onKeyDown={(event) => { if (event.key === "Enter") commit(event.currentTarget); }}
                    />
                    <p className="text-[11px] leading-5 text-muted-foreground">达到上限的 80% 时自动压缩较早对话，保留最近两轮原文；压缩请求的 Token 也会记录在会话里。</p>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                    <label htmlFor="create-agent-reasoning-effort">思考层级</label>
                    <Select value={settings?.reasoningEffort ?? config.reasoningEffort} onValueChange={(value) => update({ reasoningEffort: value as ReasoningEffort })}>
                        <SelectTrigger id="create-agent-reasoning-effort" className="h-8 w-28"><SelectValue /></SelectTrigger>
                        <SelectContent position="popper" align="end" side="top">
                            {efforts.map((value) => <SelectItem key={value} value={value}>{reasoningEffortLabel(value)}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <p className="text-[11px] leading-5 text-muted-foreground">选择具体层级后会请求模型的思考摘要；「自动」不强制发送 reasoning，兼容不支持该参数的网关。</p>
                <label className="flex items-center justify-between gap-3 text-sm">
                    自动压缩
                    <Switch
                        size="sm"
                        aria-label="自动压缩"
                        checked={Boolean(settings?.contextWindow) && settings?.autoCompact !== false}
                        disabled={!settings?.contextWindow}
                        onCheckedChange={(autoCompact) => update({ autoCompact })}
                    />
                </label>
            </PopoverContent>
        </Popover>
    );
}
