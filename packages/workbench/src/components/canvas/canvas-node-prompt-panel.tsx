import { useEffect, useState } from "react";
import { ArrowUp, LoaderCircle, Maximize2, Square } from "lucide-react";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@infinite-canvas/plugin-sdk/ui/tooltip";
import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { CanvasDialog } from "./canvas-dialog";

import { ModelPicker } from "@workbench/components/model-picker";
import { defaultConfig, resolveModelForCapability, useConfigStore, useEffectiveConfig, type AiConfig } from "@workbench/stores/use-config-store";
import { canvasThemes } from "@workbench/lib/canvas-theme";
import { computeMediaSize, inferMediaScale } from "@workbench/lib/media-size";
import { getNodeDefinition } from "@workbench/lib/canvas/node-registry";
import { useThemeStore } from "@workbench/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasPromptChipInput } from "./canvas-prompt-chip-input";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasTextSettingsPopover } from "./canvas-text-settings-popover";
import { type CanvasGenerationMode, type CanvasNodeData } from "@infinite-canvas/shared/canvas/schema/canvas";
import type { CanvasNodeContext, ReadonlyCanvasNode } from "@infinite-canvas/plugin-sdk";
import { canvasApply, nodeGenerate, nodeStop } from "@infinite-canvas/plugin-sdk/builtin";
import { hostActions } from "@workbench/lib/canvas/host-actions";
import { getPluginErrorMessage } from "@infinite-canvas/shared/plugins";
import { buildNodeMentionReferences } from "@workbench/lib/canvas/canvas-resource-references";
import { applyNodeConfigPatch } from "@workbench/lib/canvas/canvas-node-factory";
import { isNodeGenerationStopped } from "@workbench/lib/canvas/confirm-node-stop";
import { CanvasNodeReferenceBar } from "./canvas-node-reference-bar";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    ctx: CanvasNodeContext;
    mode: CanvasNodeGenerationMode;
    onImageSettingsOpenChange?: (open: boolean) => void;
};

export function CanvasNodePromptPanel({ ctx, mode, onImageSettingsOpenChange }: CanvasNodePromptPanelProps) {
    const { node, isGenerating: isRunning } = ctx;
    const nodes = ctx.getNodes();
    const connectedNodes = ctx.getUpstream();
    const mentionReferences = buildNodeMentionReferences(node, nodes, ctx.getConnections(), ctx.scope);
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const fixedRatio = mode === "image" ? getNodeDefinition(node.type)?.useBuiltinPanel?.imageAspectRatio : undefined;
    const nodeConfig = buildNodeConfig(globalConfig, node, mode);
    // 固定宽高比的节点只保留分辨率选择，尺寸统一按该比例换算，一次生成一张。
    const config = fixedRatio ? { ...nodeConfig, size: computeMediaSize(inferMediaScale(nodeConfig.size) === "auto" ? "2k" : inferMediaScale(nodeConfig.size), fixedRatio), count: "1" } : nodeConfig;
    const hasTextContent = mode === "text" && Boolean(node.metadata?.content);
    const hasImageContent = mode === "image" && Boolean(node.metadata?.storageKey || node.metadata?.content);
    const canUseReferences = mentionReferences.some((reference) => reference.nodeId !== node.id && (mode === "audio" ? reference.kind === "text" : mode !== "text" || reference.kind === "text" || reference.kind === "image"));
    const [prompt, setPrompt] = useState(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");
    const [expanded, setExpanded] = useState(false);
    const report = (error: unknown) => { if (!ctx.scope.signal.aborted) void toast.error(getPluginErrorMessage(error), workbenchMessageOptions.error); };
    const onConfigChange = (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => {
        const current = ctx.getNode(nodeId);
        if (!current) return;
        const next = applyNodeConfigPatch(structuredClone(current) as CanvasNodeData, patch);
        const size = next.width !== current.width || next.height !== current.height ? { width: next.width, height: next.height, position: next.position } : undefined;
        void ctx.commands.execute(canvasApply, { ops: [{ type: "update_node", id: nodeId, metadata: patch, patch: size }] }, { scope: ctx.scope }).catch(report);
    };
    const onStartReferenceSelection = (nodeId: string) => { void hostActions.nodeSelectReferences({ nodeId }, ctx.scope.signal).catch(report); };
    const onDisconnectReference = (fromNodeId: string, toNodeId: string) => {
        const ids = ctx.getConnections().filter((edge) => edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId).map((edge) => edge.id);
        void ctx.commands.execute(canvasApply, { ops: [{ type: "delete_connections", ids }] }, { scope: ctx.scope }).catch(report);
    };

    // Restore prompts only when switching nodes; preserve the current input after generation on the same node.
    useEffect(() => {
        setPrompt(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node.id]);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        onConfigChange(node.id, { composerContent: value });
    };

    const submit = () => {
        const text = prompt;
        if ((!text && !canUseReferences) || isRunning) return;
        void ctx.commands.execute(nodeGenerate, { nodeId: node.id, mode, prompt: text }, { scope: ctx.scope }).catch((error) => {
            if (!isNodeGenerationStopped(error)) report(error);
        });
    };

    const openExpandedEditor = () => {
        setExpanded(true);
    };

    const promptPlaceholder = ({ "image": "描述要生成的图片内容", "video": "描述要生成的视频内容", "audio": "描述要生成的音频内容", "text": "请输入你想要生成的文本内容", "editImage": "请输入你想要把这张图修改成什么", "editText": "请输入你想要将本段文本修改成什么" } as Record<string, string>)[mode === "image" && hasImageContent ? "editImage" : mode === "text" && hasTextContent ? "editText" : mode];

    return (
        <div
            data-canvas-no-zoom
            className="rounded-2xl border p-3 shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <CanvasNodeReferenceBar nodeId={node.id} scope={ctx.scope} nodes={nodes} connectedNodes={connectedNodes} onDisconnect={onDisconnectReference} onStartSelection={onStartReferenceSelection} />
            <CanvasPromptChipInput
                value={prompt}
                references={mentionReferences}
                onChange={updatePrompt}
                onSubmit={submit}
                className="thin-scrollbar h-40 w-full cursor-text resize-none rounded-xl px-3 py-2 text-sm leading-5 outline-none"
                style={{ background: "transparent", color: theme.node.text }}
                placeholder={promptPlaceholder}
            />

            <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <Tooltip><TooltipTrigger asChild>
                        <Button type="button" variant="ghost" size="icon-sm" className="shrink-0 rounded-full" style={{ color: theme.node.text }} onClick={openExpandedEditor} aria-label="放大编辑"><Maximize2 className="size-3.5" /></Button>
                    </TooltipTrigger><TooltipContent>放大编辑</TooltipContent></Tooltip>
                    <CanvasPromptLibrary onSelect={updatePrompt} />
                    {mode === "image" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="image" onMissingConfig={() => openConfigDialog(true)} className="max-w-[190px]" />
                            <CanvasImageSettingsPopover
                                config={config}
                                fixedRatio={fixedRatio}
                                placement="topLeft"
                                buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                                onMissingConfig={() => openConfigDialog(true)}
                                onOpenChange={onImageSettingsOpenChange}
                            />
                        </>
                    ) : mode === "video" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="video" onMissingConfig={() => openConfigDialog(true)} className="max-w-[190px]" />
                            <CanvasVideoSettingsPopover config={config} buttonClassName="!h-10 !max-w-[220px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                        </>
                    ) : mode === "audio" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="audio" onMissingConfig={() => openConfigDialog(true)} className="max-w-[190px]" />
                            <CanvasAudioSettingsPopover config={config} buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />
                        </>
                    ) : (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="text" onMissingConfig={() => openConfigDialog(true)} className="max-w-[190px]" />
                            <CanvasTextSettingsPopover config={config} count={node.metadata?.textCount || 1} onConfigChange={(_, value) => onConfigChange(node.id, { reasoningEffort: value })} onCountChange={(textCount) => onConfigChange(node.id, { textCount })} />
                        </>
                    )}
                </div>
                <Button
                    type="button" variant={isRunning ? "destructive" : "default"}
                    className="h-10 min-w-16 shrink-0 rounded-full px-3"
                    disabled={!isRunning && !prompt && !canUseReferences}
                    onClick={() => (isRunning ? void ctx.commands.execute(nodeStop, { nodeId: node.id, confirm: true }, { scope: ctx.scope }).catch(report) : submit())}
                    aria-label={(isRunning ? "停止生成" : "生成")}
                >
                    <span className="flex items-center gap-1.5">
                        {isRunning ? (
                            <>
                                <LoaderCircle className="size-4 animate-spin" />
                                <Square className="size-3.5 fill-current" />
                                <span className="text-xs font-medium">停止</span>
                            </>
                        ) : (
                            <ArrowUp className="size-4" />
                        )}
                    </span>
                </Button>
            </div>
            <CanvasDialog title="编辑提示词" open={expanded} width={760} onClose={() => setExpanded(false)}>
                <div data-canvas-no-zoom className="pt-2" onWheelCapture={(event) => event.stopPropagation()}>
                    <CanvasNodeReferenceBar nodeId={node.id} scope={ctx.scope} nodes={nodes} connectedNodes={connectedNodes} onDisconnect={onDisconnectReference} onStartSelection={(nodeId) => { setExpanded(false); onStartReferenceSelection?.(nodeId); }} />
                    <CanvasPromptChipInput
                        value={prompt}
                        references={mentionReferences}
                        onChange={updatePrompt}
                        className="thin-scrollbar h-[52dvh] min-h-80 w-full cursor-text overflow-y-auto rounded-xl border p-4 text-[15px] leading-6 outline-none"
                        style={{ background: "transparent", borderColor: theme.toolbar.border, color: theme.node.text }}
                        placeholder={promptPlaceholder}
                    />
                </div>
            </CanvasDialog>
        </div>
    );
}

function buildNodeConfig(globalConfig: AiConfig, node: ReadonlyCanvasNode, mode: CanvasNodeGenerationMode): AiConfig {
    return {
        ...globalConfig,
        model: resolveModelForCapability(globalConfig, node.metadata?.model, mode),
        reasoningEffort: node.metadata?.reasoningEffort || globalConfig.reasoningEffort || defaultConfig.reasoningEffort,
        quality: node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        size: node.metadata?.size || (mode === "video" ? globalConfig.videoSize : globalConfig.size) || defaultConfig.size,
        videoSize: node.metadata?.size || globalConfig.videoSize || defaultConfig.videoSize,
        background: node.metadata?.background ?? globalConfig.background ?? defaultConfig.background,
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality,
        videoGenerateAudio: node.metadata?.generateAudio || globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node.metadata?.watermark || globalConfig.videoWatermark || defaultConfig.videoWatermark,
        videoMode: node.metadata?.videoMode || globalConfig.videoMode || defaultConfig.videoMode,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        count: String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
    };
}

function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSize") return { size: value };
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    if (key === "videoMode") return { videoMode: value };
    return { [key]: value };
}

function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    return { audioInstructions: value };
}
