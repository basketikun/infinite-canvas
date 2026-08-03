import { useRef, type ReactNode } from "react";
import { Button, Dropdown, Tooltip } from "antd";
import { ArrowUp, Check, ChevronUp, Cpu, Hand, ImagePlus, LoaderCircle, RefreshCw, ShieldAlert, ShieldCheck, ShieldOff, Square, X } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { canvasThemes } from "@/lib/canvas-theme";
import { isPlainEnterKey } from "@/lib/keyboard-event";
import type { AgentModel, AgentPermissionMode, AgentReasoningEffort } from "@/stores/use-agent-store";
import type { AgentChatAttachment } from "./agent-chat-message";

export function AgentChatComposer({
    prompt,
    attachments = [],
    disabled,
    sending,
    placeholder,
    theme,
    onPromptChange,
    onSubmit,
    onStop,
    onAddFiles,
    onRemoveAttachment,
    confirmTools,
    onConfirmToolsChange,
    permissionMode,
    onPermissionModeChange,
    models,
    model,
    reasoningEffort,
    onModelChange,
    onReasoningEffortChange,
    left,
}: {
    prompt: string;
    attachments?: AgentChatAttachment[];
    disabled?: boolean;
    sending?: boolean;
    placeholder: string;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onPromptChange: (value: string) => void;
    onSubmit: () => void;
    onStop?: () => void;
    onAddFiles?: (files: FileList | File[] | null) => void | Promise<void>;
    onRemoveAttachment?: (id: string) => void;
    confirmTools?: boolean;
    onConfirmToolsChange?: (confirmTools: boolean) => void;
    permissionMode?: AgentPermissionMode;
    onPermissionModeChange?: (permissionMode: AgentPermissionMode) => void;
    models?: AgentModel[];
    model?: string;
    reasoningEffort?: AgentReasoningEffort | "";
    onModelChange?: (model: string) => void;
    onReasoningEffortChange?: (effort: AgentReasoningEffort) => void;
    left?: ReactNode;
}) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const canSubmit = !disabled && !sending && Boolean(prompt.trim() || attachments.length);
    return (
        <div className="px-2 pb-2 pt-2" onWheelCapture={(event) => event.stopPropagation()}>
            <div className="rounded-[24px] border px-3 pb-3 pt-3 shadow-lg" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}>
                {attachments.length ? (
                    <div className="thin-scrollbar mb-2 flex gap-2 overflow-x-auto pb-1">
                        {attachments.map((item) => (
                            <div key={item.id} className="group relative size-14 shrink-0 overflow-hidden rounded-xl border" style={{ borderColor: theme.node.stroke }} title={item.name}>
                                <img src={item.url} alt={item.name} className="size-full object-cover" />
                                {onRemoveAttachment ? (
                                    <button type="button" className="absolute right-1 top-1 grid size-5 place-items-center rounded-full border opacity-0 shadow-sm transition group-hover:opacity-100" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text }} onClick={() => onRemoveAttachment(item.id)} aria-label="移除图片">
                                        <X className="size-3" />
                                    </button>
                                ) : null}
                            </div>
                        ))}
                    </div>
                ) : null}
                <textarea
                    value={prompt}
                    onChange={(event) => onPromptChange(event.target.value)}
                    onPaste={(event) => {
                        if (!onAddFiles) return;
                        const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
                        if (!images.length) return;
                        event.preventDefault();
                        void onAddFiles(images);
                    }}
                    onKeyDown={(event) => {
                        if (!isPlainEnterKey(event)) return;
                        event.preventDefault();
                        if (!canSubmit) return;
                        void onSubmit();
                    }}
                    className="thin-scrollbar max-h-32 min-h-20 w-full resize-none border-0 bg-transparent px-1 py-1 text-sm leading-5 outline-none placeholder:opacity-45"
                    style={{ color: theme.node.text }}
                    placeholder={placeholder}
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1">
                        {onAddFiles ? (
                            <>
                                <input ref={fileInputRef} hidden type="file" accept="image/*" multiple onChange={(event) => {
                                    void onAddFiles(event.target.files);
                                    event.target.value = "";
                                }} />
                                <Tooltip title="上传图片">
                                    <Button type="text" shape="circle" className="!h-9 !w-9 !min-w-9" disabled={disabled || sending} style={{ color: theme.node.muted }} icon={<ImagePlus className="size-4" />} onClick={() => fileInputRef.current?.click()} />
                                </Tooltip>
                            </>
                        ) : null}
                        {onConfirmToolsChange ? <ToolConfirmationMenu confirmTools={Boolean(confirmTools)} theme={theme} onChange={onConfirmToolsChange} /> : null}
                        {permissionMode && onPermissionModeChange ? <PermissionModeMenu permissionMode={permissionMode} theme={theme} onChange={onPermissionModeChange} /> : null}
                        {models?.length && model && reasoningEffort && onModelChange && onReasoningEffortChange ? <AgentModelControls models={models} model={model} reasoningEffort={reasoningEffort} onModelChange={onModelChange} onReasoningEffortChange={onReasoningEffortChange} /> : null}
                        {left}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                        {sending && onStop ? (
                            <Button danger shape="circle" className="!h-10 !w-10 !min-w-10" icon={<Square className="size-4" />} onClick={() => void onStop()} aria-label="停止" />
                        ) : (
                            <Button type="primary" shape="circle" className="!h-10 !w-10 !min-w-10" disabled={!canSubmit} icon={sending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />} onClick={() => void onSubmit()} aria-label="发送" />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function AgentModelControls({ models, model, reasoningEffort, onModelChange, onReasoningEffortChange }: { models: AgentModel[]; model: string; reasoningEffort: AgentReasoningEffort; onModelChange: (model: string) => void; onReasoningEffortChange: (effort: AgentReasoningEffort) => void }) {
    const current = models.find((item) => item.model === model) || models[0];
    return (
        <div className="flex min-w-0 items-center gap-1">
            <Select value={model} onValueChange={onModelChange}>
                <SelectTrigger className="h-9 min-w-0 max-w-36 rounded-full border-0 bg-transparent px-2.5 text-xs font-medium shadow-none hover:bg-black/5 focus:ring-0 dark:bg-transparent dark:hover:bg-white/10" title={current.displayName || current.model} aria-label="选择 Codex 模型">
                    <Cpu className="size-3.5 shrink-0 opacity-70" />
                    <span className="min-w-0 flex-1 truncate text-left">{current.displayName || current.model}</span>
                </SelectTrigger>
                <SelectContent data-canvas-no-zoom position="popper" side="top" align="start" sideOffset={6} className="z-[1200] w-64 rounded-xl border border-border/70 bg-popover p-1 shadow-xl">
                    {models.map((item) => <SelectItem key={item.model} value={item.model}>{item.displayName || item.model}</SelectItem>)}
                </SelectContent>
            </Select>
            <Select value={reasoningEffort} onValueChange={(value) => onReasoningEffortChange(value as AgentReasoningEffort)}>
                <SelectTrigger className="h-9 rounded-full border-0 bg-transparent px-2.5 text-xs font-medium shadow-none hover:bg-black/5 focus:ring-0 dark:bg-transparent dark:hover:bg-white/10" aria-label="选择推理强度">
                    <span>{effortLabels[reasoningEffort]}</span>
                </SelectTrigger>
                <SelectContent data-canvas-no-zoom position="popper" side="top" align="start" sideOffset={6} className="z-[1200] min-w-32 rounded-xl border border-border/70 bg-popover p-1 shadow-xl">
                    {current.supportedReasoningEfforts.map((item) => <SelectItem key={item.reasoningEffort} value={item.reasoningEffort}>{effortLabels[item.reasoningEffort]}</SelectItem>)}
                </SelectContent>
            </Select>
        </div>
    );
}

const effortLabels: Record<AgentReasoningEffort, string> = {
    minimal: "最低",
    low: "轻度",
    medium: "中",
    high: "高",
    xhigh: "极高",
    max: "最高",
    ultra: "Ultra",
};

function PermissionModeMenu({ permissionMode, theme, onChange }: { permissionMode: AgentPermissionMode; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onChange: (permissionMode: AgentPermissionMode) => void }) {
    const current = permissionOptions.find((item) => item.key === permissionMode) || permissionOptions[0];
    return (
        <Dropdown
            trigger={["click"]}
            placement="topLeft"
            menu={{
                items: permissionOptions.map((item) => ({
                    key: item.key,
                    label: <ConfirmationOption icon={item.icon} title={item.title} description={item.description} selected={permissionMode === item.key} />,
                    onClick: () => onChange(item.key),
                })),
            }}
        >
            <button type="button" className="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: permissionMode === "full" ? "#ea580c" : theme.node.text }} aria-label="选择 Codex 权限模式">
                {current.icon}
                <span>{current.shortTitle}</span>
                <ChevronUp className="size-3 opacity-50" />
            </button>
        </Dropdown>
    );
}

const permissionOptions: Array<{ key: AgentPermissionMode; title: string; shortTitle: string; description: string; icon: ReactNode }> = [
    { key: "request", title: "请求批准", shortTitle: "请求批准", description: "编辑工作区外文件或联网时始终询问", icon: <ShieldAlert className="size-3.5" /> },
    { key: "automatic", title: "自动审查", shortTitle: "自动审查", description: "由 Codex 审查风险操作，必要时再询问", icon: <ShieldCheck className="size-3.5" /> },
    { key: "full", title: "完全访问权限", shortTitle: "完全访问", description: "不受限制地访问网络和本机文件", icon: <ShieldOff className="size-3.5" /> },
];

function ToolConfirmationMenu({ confirmTools, theme, onChange }: { confirmTools: boolean; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onChange: (confirmTools: boolean) => void }) {
    return (
        <Dropdown
            trigger={["click"]}
            placement="topLeft"
            menu={{
                items: [
                    {
                        key: "manual",
                        label: <ConfirmationOption icon={<Hand className="size-4" />} title="手动确认" description="Agent 执行画布写入前会请求确认" selected={confirmTools} />,
                        onClick: () => onChange(true),
                    },
                    {
                        key: "automatic",
                        label: <ConfirmationOption icon={<RefreshCw className="size-4" />} title="自动确认" description="Agent 会自动执行画布写入操作" selected={!confirmTools} />,
                        onClick: () => onChange(false),
                    },
                ],
            }}
        >
            <button type="button" className="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} aria-label="选择工具确认模式">
                {confirmTools ? <Hand className="size-3.5" /> : <RefreshCw className="size-3.5" />}
                <span>{confirmTools ? "手动确认" : "自动确认"}</span>
                <ChevronUp className="size-3 opacity-50" />
            </button>
        </Dropdown>
    );
}

function ConfirmationOption({ icon, title, description, selected }: { icon: ReactNode; title: string; description: string; selected: boolean }) {
    return (
        <div className="flex min-w-64 items-start gap-3 py-1">
            <span className="mt-0.5 shrink-0">{icon}</span>
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{title}</span>
                <span className="mt-0.5 block text-xs leading-5 opacity-60">{description}</span>
            </span>
            {selected ? <Check className="mt-0.5 size-4 shrink-0" /> : null}
        </div>
    );
}
