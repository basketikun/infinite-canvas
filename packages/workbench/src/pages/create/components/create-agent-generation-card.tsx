import { CheckCircle2, Clock3, Image as ImageIcon, LoaderCircle, Music, SlidersHorizontal, Video, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@infinite-canvas/plugin-sdk/ui/popover";
import type { ModelCapability } from "@infinite-canvas/shared/models";
import { AudioSettingsPanel } from "@workbench/components/audio-settings-panel";
import { ImageThumbnail } from "@workbench/components/image-thumbnail";
import { ImageSettingsPanel, imageQualityLabel, imageSizeLabel } from "@workbench/components/image-settings-panel";
import { ModelPicker } from "@workbench/components/model-picker";
import { VideoSettingsPanel, videoResolutionLabel, videoSecondsLabel, videoSizeLabel } from "@workbench/components/video-settings-panel";
import { audioFormatLabel, audioSpeedLabel, audioVoiceLabel } from "@workbench/lib/audio-generation";
import { canvasThemes } from "@workbench/lib/canvas-theme";
import { selectableModelsByCapability, useConfigStore, type AiConfig } from "@workbench/stores/use-config-store";
import { clampVideoSeconds, computeMediaSize, computeVideoSize } from "@workbench/lib/media-size";
import { useThemeStore } from "@workbench/stores/use-theme-store";
import type { CreateAgentItem } from "@workbench/services/create/agent-logs";
import type { CreateLog } from "@workbench/services/create/logs";
import { CreateEntry, type CreateEntryActions } from "./create-entry";

type GenerationKind = "image" | "video" | "audio";
type ToolItem = Extract<CreateAgentItem, { role: "tool" }>;

const kindMeta: Record<GenerationKind, { label: string; icon: typeof ImageIcon; capability: ModelCapability; modelKey: "imageModel" | "videoModel" | "audioModel" }> = {
    image: { label: "生成图片", icon: ImageIcon, capability: "image", modelKey: "imageModel" },
    video: { label: "生成视频", icon: Video, capability: "video", modelKey: "videoModel" },
    audio: { label: "生成音频", icon: Music, capability: "audio", modelKey: "audioModel" },
};

const statusMeta = {
    running: { label: "准备中…", className: "border-border bg-background text-muted-foreground", icon: LoaderCircle, spin: true },
    waiting: { label: "待确认", className: "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-400", icon: Clock3, spin: false },
    generating: { label: "生成中…", className: "border-border bg-background text-muted-foreground", icon: LoaderCircle, spin: true },
    done: { label: "已完成", className: "border-emerald-600/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", icon: CheckCircle2, spin: false },
    failed: { label: "失败", className: "border-destructive/30 bg-destructive/10 text-destructive", icon: XCircle, spin: false },
    rejected: { label: "已拒绝", className: "border-border bg-background text-muted-foreground", icon: XCircle, spin: false },
} as const;

function kindOf(toolName: string): GenerationKind | null {
    return toolName === "generate_image" ? "image" : toolName === "generate_video" ? "video" : toolName === "generate_audio" ? "audio" : null;
}

function draftValues(kind: GenerationKind | null, input: unknown, config: AiConfig): Partial<AiConfig> {
    if (!kind) return {};
    const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const values: Partial<AiConfig> = {};
    const model = typeof raw.model === "string" ? raw.model : "";
    if (model && selectableModelsByCapability(config, kind).includes(model)) {
        if (kind === "image") values.imageModel = model;
        else if (kind === "video") values.videoModel = model;
        else values.audioModel = model;
    }
    if (kind === "image") {
        if (typeof raw.quality === "string" && raw.quality) values.quality = raw.quality;
        if (typeof raw.ratio === "string" && raw.ratio) values.size = computeMediaSize(typeof raw.scale === "string" ? raw.scale : "auto", raw.ratio);
        if (typeof raw.count === "number" && Number.isFinite(raw.count)) values.count = String(Math.max(1, Math.min(10, Math.floor(raw.count))));
    } else if (kind === "video") {
        const resolution = typeof raw.resolution === "string" ? raw.resolution : undefined;
        if (resolution) values.vquality = resolution;
        if (typeof raw.ratio === "string" && raw.ratio) values.videoSize = computeVideoSize(resolution ?? "720", raw.ratio);
        if (typeof raw.seconds === "number" && Number.isFinite(raw.seconds)) values.videoSeconds = clampVideoSeconds(String(raw.seconds));
        if (typeof raw.generateAudio === "boolean") values.videoGenerateAudio = String(raw.generateAudio);
        if (typeof raw.watermark === "boolean") values.videoWatermark = String(raw.watermark);
        if (raw.mode === "frames" || raw.mode === "reference") values.videoMode = raw.mode;
    } else {
        if (typeof raw.voice === "string" && raw.voice) values.audioVoice = raw.voice;
        if (typeof raw.format === "string" && raw.format) values.audioFormat = raw.format;
        if (typeof raw.speed === "string" && raw.speed) values.audioSpeed = raw.speed;
    }
    return values;
}

function readPrompt(input: unknown) {
    if (!input || typeof input !== "object" || !("prompt" in input)) return "";
    const prompt = (input as { prompt?: unknown }).prompt;
    return typeof prompt === "string" ? prompt.trim() : "";
}

function summary(kind: GenerationKind, config: AiConfig) {
    if (kind === "image") return `${imageQualityLabel(config.quality || "auto")} · ${imageSizeLabel(config.size || "auto")} · ${Math.max(1, Number(config.count) || 1)} 张`;
    if (kind === "video") return `${videoResolutionLabel(config.vquality)} · ${videoSizeLabel(config.videoSize)} · ${videoSecondsLabel(config.videoSeconds)}`;
    return `${audioVoiceLabel(config.audioVoice)} · ${audioFormatLabel(config.audioFormat)} · ${audioSpeedLabel(config.audioSpeed)}`;
}

export function CreateAgentGenerationCard({ item, config, log, actions, onConfirm, onReject }: {
    item: ToolItem;
    config: AiConfig;
    log?: CreateLog;
    actions: CreateEntryActions;
    onConfirm: (overrides: Partial<AiConfig>) => Promise<void>;
    onReject: () => void;
}) {
    const kind = kindOf(item.toolName);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const [values, setValues] = useState<Partial<AiConfig>>(() => draftValues(kind, item.input, config));
    const [busy, setBusy] = useState(false);
    if (!kind) return null;
    const meta = kindMeta[kind];
    const panelConfig = { ...config, ...values };
    const prompt = readPrompt(item.input);
    // 有生成记录时以记录状态为准，避免旧会话快照把已生成的卡片显示成「失败」或一直「生成中」。
    const displayStatus = log ? (log.status === "success" ? "done" : log.status === "failed" || log.status === "interrupted" ? "failed" : "generating") : item.status;
    const status = statusMeta[displayStatus];
    const compact = Boolean(log) || item.status === "rejected";
    const StatusIcon = status.icon;
    const Icon = meta.icon;
    const disabled = busy || item.status === "running" || item.status === "generating";
    const update = (key: keyof AiConfig, value: string) => setValues((current) => ({ ...current, [key]: value }));

    return (
        <div className="space-y-4">
        <section className="not-prose w-full overflow-hidden rounded-xl border bg-card">
            <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate text-sm font-medium">{meta.label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">由 Agent 发起</span>
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-5 ${status.className}`}>
                    <StatusIcon className={`size-3${status.spin ? " animate-spin" : ""}`} aria-hidden="true" />
                    {status.label}
                </span>
            </div>
            <div className={compact ? "space-y-2 p-3" : "space-y-3 p-3"}>
                {prompt ? (compact
                    ? <div className="rounded-lg bg-muted/40 px-3 py-2"><p className="line-clamp-2 overflow-hidden break-words text-sm leading-6 text-muted-foreground" style={{ maxHeight: "3rem" }} title={prompt}>{prompt.replace(/\s+/g, " ")}</p></div>
                    : <p className="whitespace-pre-wrap break-words rounded-lg bg-muted/40 px-3 py-2 text-sm leading-6">{prompt}</p>) : null}
                {item.references?.length ? <div className="flex flex-wrap items-center gap-2">
                    {item.references.map((reference) => <div key={reference.id} className={`${compact ? "size-10" : "size-12"} shrink-0 overflow-hidden rounded-lg border bg-muted`} title={reference.name}>
                        {reference.storageKey ? <ImageThumbnail storageKey={reference.storageKey} alt={reference.name} className="size-full" /> : reference.url || reference.dataUrl ? <img src={reference.url || reference.dataUrl} alt={reference.name} className="size-full object-cover" /> : null}
                    </div>)}
                </div> : null}
                {compact ? (item.status === "rejected" ? <p className="text-xs text-muted-foreground">已拒绝这张生成卡片，等 Agent 调整后续操作。</p> : null) : <>
                <div className="flex flex-wrap items-center gap-2">
                    <ModelPicker config={config} value={panelConfig[meta.modelKey]} capability={meta.capability} className="max-w-[220px]"
                        onChange={(model) => update(meta.modelKey, model)} onMissingConfig={() => openConfigDialog(true, "builtin:channels")} />
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button type="button" variant="outline" className="h-8 min-w-0 rounded-full px-3 font-normal">
                                <SlidersHorizontal data-icon="inline-start" />
                                <span className="truncate">{summary(kind, panelConfig)}</span>
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" side="top" collisionPadding={12} onOpenAutoFocus={(event) => event.preventDefault()}
                            className="thin-scrollbar max-h-[min(560px,var(--radix-popover-content-available-height,70dvh))] w-[min(520px,calc(100vw-24px))] overflow-y-auto overscroll-contain p-4">
                            {kind === "image" ? <ImageSettingsPanel config={panelConfig} onConfigChange={update} theme={theme} showTitle={false} className="w-full space-y-4" />
                                : kind === "video" ? <VideoSettingsPanel config={panelConfig} onConfigChange={update} theme={theme} showTitle={false} className="w-full space-y-4" />
                                    : <AudioSettingsPanel config={panelConfig} onConfigChange={update} theme={theme} showTitle={false} className="w-full space-y-4" />}
                        </PopoverContent>
                    </Popover>
                    <div className="ml-auto flex items-center gap-2">
                        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => { if (!busy) onReject(); }}>拒绝</Button>
                        <Button type="button" size="sm" disabled={disabled || !prompt} aria-busy={disabled} onClick={async () => {
                            if (busy) return;
                            setBusy(true);
                            try { await onConfirm(values); } finally { setBusy(false); }
                        }}>
                            {disabled ? <LoaderCircle className="size-4 animate-spin" /> : null}
                            {item.status === "generating" ? "生成中…" : "确认生成"}
                        </Button>
                    </div>
                </div>
                </>}
            </div>
        </section>
        {log ? <CreateEntry log={log} actions={actions} hidePrompt /> : null}
        </div>
    );
}
