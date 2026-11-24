import { useState } from "react";
import { useMatch } from "react-router-dom";
import { Popover as PopoverPrimitive } from "radix-ui";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Input } from "@infinite-canvas/plugin-sdk/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@infinite-canvas/plugin-sdk/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@infinite-canvas/plugin-sdk/ui/select";
import { Switch } from "@infinite-canvas/plugin-sdk/ui/switch";
import { toast } from "sonner";
import { Settings2 } from "lucide-react";

import { reasoningEffortLabel } from "@workbench/components/text-settings-panel";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { canvasThemes } from "@workbench/lib/canvas-theme";
import { sendAgentMessage } from "@workbench/services/api/agent-chat";
import { useAgentChatStore } from "@workbench/stores/use-agent-chat-store";
import { useAgentStore } from "@workbench/stores/use-agent-store";
import { findGroupModel, updateChannels, useConfigStore } from "@workbench/stores/use-config-store";
import type { AgentModelSettings, ReasoningEffort } from "@infinite-canvas/shared/model-execution";
import { useThemeStore } from "@workbench/stores/use-theme-store";
import "./agent-chat-settings.css";

export function AgentChatSettings() {
    const projectId = useMatch("/canvas/:id")!.params.id!;
    const config = useConfigStore((state) => state.config);
    const target = findGroupModel(config, config.textModel);
    const settings = target?.model?.agentSettings;
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const busy = useAgentStore((state) => Boolean(state.runningThreadId));
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const canCompact = useAgentChatStore((state) => {
        const thread = state.threads.find((thread) => thread.id === state.activeThreadIds[projectId]);
        return !state.storageError && Boolean(thread && !state.receiving.has(thread.id) && (thread.contextMessages ?? thread.messages).filter((message) => message.role === "user").length > 2);
    });
    const update = (patch: Partial<AgentModelSettings>) => {
        const current = useConfigStore.getState().config;
        if (!target?.model || current.textModel !== config.textModel) return;
        const name = target.model.name;
        void updateChannels(current.channels.map((channel) => channel.id !== target.channel.id ? channel : {
            ...channel, groups: channel.groups.map((group) => group.id !== target.group.id ? group : {
                ...group, models: group.models.map((model) => model.name !== name ? model : { ...model, agentSettings: { ...model.agentSettings, ...patch } }),
            }),
        })).catch(() => toast.error("模型设置尚未保存，请检查连接后重试。", { ...workbenchMessageOptions.error, id: "agent-model-save" }));
    };
    const efforts: ReasoningEffort[] = target?.model?.scriptId === "gemini-text" ? ["auto", "low", "medium", "high"] : ["auto", "low", "medium", "high", "xhigh"];
    const finishNumberEdit = () => {
        const input = document.activeElement;
        if (input instanceof HTMLInputElement && input.id === "agent-context-window") input.blur();
    };

    return (
        <Popover key={panelOpen ? config.textModel : null}>
            <PopoverTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" className="agent-panel-action" aria-label="助手模型设置" title="上下文与思考强度" disabled={!target?.model}><Settings2 className="size-4" /></Button>
            </PopoverTrigger>
            {panelOpen && target?.model && <PopoverContent side="top" align="start" sideOffset={4} onOpenAutoFocus={(event) => {
                if (!document.activeElement?.matches(":focus-visible")) event.preventDefault();
            }} onEscapeKeyDown={finishNumberEdit} onPointerDownOutside={finishNumberEdit} aria-label="助手模型设置" data-canvas-shortcuts-ignore
                className="agent-settings-card generation-workspace-controls workbench-dialog space-y-3" style={{ color: theme.node.text }}>
                <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                        <label htmlFor="agent-context-window" className="text-sm">上下文上限</label>
                        <div className="flex gap-1">
                            <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => update({ contextWindow: 200000 })}>200k</Button>
                            <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => update({ contextWindow: 1000000 })}>1m</Button>
                        </div>
                    </div>
                    <ContextWindowInput value={settings?.contextWindow} disabled={busy} onChange={(contextWindow) => update({ contextWindow })} />
                </div>
                <div className="flex items-center justify-between gap-3">
                    <label htmlFor="agent-reasoning-effort" className="text-sm">思考强度</label>
                    <Select disabled={busy} value={settings?.reasoningEffort ?? config.reasoningEffort} onValueChange={(value) => update({ reasoningEffort: value as ReasoningEffort })}>
                        <SelectTrigger id="agent-reasoning-effort" className="agent-settings-field w-32"><SelectValue /></SelectTrigger>
                        <SelectContent position="popper" align="start" data-canvas-shortcuts-ignore className="agent-settings-options workbench-dialog">
                            {efforts.map((value) => <SelectItem key={value} value={value}>{reasoningEffortLabel(value)}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm">
                        自动压缩
                        <Switch size="sm" aria-label="自动压缩" checked={Boolean(settings?.contextWindow) && settings?.autoCompact !== false} disabled={busy || !settings?.contextWindow} onCheckedChange={(autoCompact) => update({ autoCompact })} />
                    </label>
                    <PopoverPrimitive.Close asChild>
                        <Button type="button" variant="ghost" size="xs" disabled={busy || !canCompact} onClick={() => void sendAgentMessage(projectId, "", { compact: true })}>立即压缩</Button>
                    </PopoverPrimitive.Close>
                </div>
            </PopoverContent>}
        </Popover>
    );
}

function ContextWindowInput({ value, disabled, onChange }: { value?: number; disabled: boolean; onChange: (value: number | undefined) => void }) {
    const [draft, setDraft] = useState<string | null>(null);
    const commit = (input: HTMLInputElement) => {
        if (Number.isFinite(input.valueAsNumber)) {
            const next = Math.max(1, Math.round(input.valueAsNumber));
            if (next !== value) onChange(next);
        }
        setDraft(null);
    };
    return <div className="agent-settings-field flex items-center gap-1">
        <Input id="agent-context-window" type="number" min={1} step={1} value={draft ?? value ?? ""} placeholder="未设置" disabled={disabled}
            onChange={(event) => {
                const input = event.currentTarget;
                setDraft(input.value);
                if (!input.value && !input.validity.badInput) onChange(undefined);
                else if (input.valueAsNumber >= 1) onChange(input.valueAsNumber);
            }}
            onBlur={(event) => commit(event.currentTarget)} onKeyDown={(event) => { if (event.key === "Enter") commit(event.currentTarget); }} />
        <span>Token</span>
    </div>;
}
