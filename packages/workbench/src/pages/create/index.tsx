import { History, Plus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { saveAs } from "file-saver";
import mime from "mime";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";

import type { CanvasAssetInput } from "@infinite-canvas/plugin-sdk";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import type { StoredOutputAudio, StoredOutputImage, StoredOutputVideo } from "@infinite-canvas/shared/sync-records";
import { GenerationWorkspaceSheet } from "@workbench/components/generation-history";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { ImagePreviewGroup } from "@workbench/components/ui/image-preview-group";
import { PromptSelectDialog } from "@workbench/components/prompts/prompt-select-dialog";
import { AssetPickerModal } from "@workbench/components/canvas/asset-picker-modal";
import { useGroupedImagePreview } from "@workbench/hooks/use-grouped-image-preview";
import { useReferenceImages } from "@workbench/hooks/use-reference-images";
import { useReferencePaste } from "@workbench/hooks/use-reference-paste";
import { useCreateGeneration } from "./use-create-generation";
import { isRuntimeOptionKey, type RuntimeOptions } from "./create-runtime-config";
import { GenerationRecordDeletion, readGenerationRecords } from "@workbench/services/generation-records";
import { storage } from "@workbench/services/storage/runtime";
import { readImageBlob } from "@workbench/services/image-storage";
import { readMediaBlob } from "@workbench/services/file-storage";
import { saveGeneratedAsset } from "@workbench/stores/use-asset-store";
import { findGroupModel, useConfigStore, useEffectiveConfig, type AiConfig } from "@workbench/stores/use-config-store";
import { nanoid } from "nanoid";
import { takeCreateDraft } from "@workbench/services/create/draft";
import type { ReferenceImage } from "@workbench/types/image";
import { greeting } from "@workbench/lib/greeting";
import { createSessionId, createSessions, mergeSessions, sessionIdOf, sessionLogs, type AudioLog, type CreateKind, type CreateLog, type CreateMode, type ImageLog, type VideoLog } from "@workbench/services/create/logs";
import { agentSession, type CreateAgentItem } from "@workbench/services/create/agent-logs";
import { useCreateAgent } from "./use-create-agent";
import { CreateAgentConversation } from "./components/create-agent-conversation";
import { CreateComposer } from "./components/create-composer";
import { CreateEntry, type CreateEntryActions } from "./components/create-entry";
import { CreateHistory } from "./components/create-history";

const PRESET_PROMPTS = [
    "画一张赛博朋克城市夜景海报，霓虹灯与雨后街道",
    "设计一张极简风格的音乐节海报，大面积留白",
    "生成一个 10 秒的产品展示短片，镜头缓慢推进",
    "写一段温暖自然的中文旁白，介绍一杯手冲咖啡",
    "为我的咖啡品牌设计一套视觉方案，先出 4 张方向图",
    "规划一个三幕短片的故事大纲和分镜清单",
];

export default function CreatePage() {
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const [logs, setLogs] = useState<CreateLog[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string>(() => createSessionId());
    const [type, setType] = useState<CreateMode>("agent");
    const [prompt, setPrompt] = useState("");
    const [loaded, setLoaded] = useState(false);
    const [searchParams, setSearchParams] = useSearchParams();
    const sessionParam = searchParams.get("session");
    const promptParam = searchParams.get("prompt");
    const runParam = searchParams.get("run");
    const appliedPrompt = useRef<string | null>(null);
    const [referenceFilesReady, setReferenceFilesReady] = useState(true);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const feed = useRef<HTMLDivElement>(null);
    const touched = useRef(false);
    const pageSignal = useRef(new AbortController());
    const pageAbort = () => pageSignal.current.signal;
    const { references, setReferences, acceptReferences, addReferenceFiles, pasteReferenceImages, readReference } = useReferenceImages(undefined, { registerAssets: true });
    const { preview, open: openPreview } = useGroupedImagePreview();
    useReferencePaste((files) => void addReferenceFiles(files, pageAbort()), () => void pasteReferenceImages(pageAbort()));

    const upsert = useCallback((log: CreateLog) => setLogs((items) => [log, ...items.filter((item) => item.id !== log.id)]), []);
    const update = useCallback((id: string, updater: (log: CreateLog) => CreateLog) => setLogs((items) => items.map((item) => item.id === id ? updater(item) : item)), []);
    const remove = useCallback((ids: string[]) => setLogs((items) => items.filter((item) => !ids.includes(item.id))), []);
    const [runtimeOptions, setRuntimeOptions] = useState<RuntimeOptions>({});
    const generationConfig = useMemo(() => ({ ...effectiveConfig, ...runtimeOptions }), [effectiveConfig, runtimeOptions]);
    const updateCreateConfig = useCallback(<K extends Exclude<keyof AiConfig, "channels">>(key: K, value: AiConfig[K]) => {
        if (isRuntimeOptionKey(key)) setRuntimeOptions((current) => ({ ...current, [key]: value }));
        else updateConfig(key, value);
    }, [updateConfig]);
    const generation = useCreateGeneration({ upsert, update, remove }, pageSignal, generationConfig);
    const agent = useCreateAgent({ config: generationConfig, openConfigDialog });
    const agentThread = agent.threads.find((thread) => thread.id === activeSessionId);
    const sessions = useMemo(() => mergeSessions(createSessions(logs), agent.threads.map(agentSession)), [logs, agent.threads]);
    const entries = useMemo(() => sessionLogs(logs, activeSessionId), [logs, activeSessionId]);
    const agentRunning = agent.runningSession === activeSessionId;
    const contextWindow = findGroupModel(effectiveConfig, effectiveConfig.textModel)?.model?.agentSettings?.contextWindow;
    const running = Boolean(generation.runningSessions[activeSessionId]) || Boolean(agent.runningSession);

    const applySessionMode = useCallback((id: string) => {
        if (agent.threads.some((thread) => thread.id === id)) setType("agent");
        else {
            const target = sessionLogs(logs, id)[0];
            if (target) setType(target.kind);
        }
    }, [agent.threads, logs]);

    useLayoutEffect(() => {
        const controller = new AbortController();
        pageSignal.current = controller;
        return () => controller.abort();
    }, []);

    useEffect(() => {
        const pending = takeCreateDraft();
        if (!pending) return;
        if (pending.type) setType(pending.type);
        if (!pending.files.length) return;
        setReferenceFilesReady(false);
        void addReferenceFiles(pending.files, pageAbort()).finally(() => {
            if (!pageAbort().aborted) setReferenceFilesReady(true);
        });
        // 首页带入的参考图只消费一次。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!loaded) return;
        for (const log of logs) generation.resume(log);
    }, [loaded]);

    useEffect(() => {
        feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "smooth" });
    }, [entries.length, agentThread?.updatedAt]);

    useEffect(() => {
        const controller = new AbortController();
        void Promise.all([
            readGenerationRecords<ImageLog>("image", controller.signal),
            readGenerationRecords<VideoLog>("video", controller.signal),
            readGenerationRecords<AudioLog>("audio", controller.signal),
        ]).then(([images, videos, audios]) => {
            if (controller.signal.aborted) return;
            const merged: CreateLog[] = [
                ...images.map((log) => ({ ...log, kind: "image" as const })),
                ...videos.map((log) => ({ ...log, kind: "video" as const })),
                ...audios.map((log) => ({ ...log, kind: "audio" as const })),
            ];
            setLogs((current) => {
                const next = new Map<string, CreateLog>();
                for (const log of merged) next.set(log.id, log);
                for (const log of current) if (!next.has(log.id)) next.set(log.id, log);
                return [...next.values()];
            });
            setLoaded(true);
        }).catch((error) => {
            if (controller.signal.aborted) return;
            console.error("[create] read records", error);
            toast.error("暂时无法读取创作记录。", workbenchMessageOptions.error);
            setLoaded(true);
        });
        return () => controller.abort();
    }, []);

    useEffect(() => {
        if (!promptParam) { appliedPrompt.current = null; return; }
        if (appliedPrompt.current === promptParam) return;
        appliedPrompt.current = promptParam;
        setPrompt(promptParam);
        const requestedType = searchParams.get("type");
        if (requestedType === "agent" || requestedType === "image" || requestedType === "video" || requestedType === "audio") setType(requestedType);
        const next = new URLSearchParams(searchParams);
        next.delete("prompt");
        next.delete("type");
        if (!next.has("session")) {
            touched.current = true;
            next.set("session", activeSessionId);
        }
        setSearchParams(next, { replace: true });
        // 首页提交的提示词只消费一次，避免刷新后覆盖当前输入。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [promptParam]);

    useEffect(() => {
        if (sessionParam || promptParam || runParam) return;
        const id = createSessionId();
        setActiveSessionId(id);
        setSearchParams({ session: id }, { replace: true });
        // 创作页没有指定对话时始终从空白对话开始，不自动打开最近记录。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionParam, promptParam, runParam]);

    useEffect(() => {
        if (!sessionParam || !loaded || !agent.ready || sessionParam === activeSessionId) return;
        touched.current = true;
        preview?.close();
        setActiveSessionId(sessionParam);
        applySessionMode(sessionParam);
        // 侧栏切换对话时只按地址中的会话加载，不重新挑选最近记录。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionParam, loaded, agent.ready, activeSessionId, applySessionMode]);

    const runGeneration = async (kind: CreateKind, text: string, onStarted?: () => void) => {
        touched.current = true;
        const options = { prompt: text, sessionId: activeSessionId, references: kind === "audio" ? [] : references, onStarted };
        if (kind === "image") await generation.generateImage(options);
        else if (kind === "video") await generation.generateVideo(options);
        else await generation.generateAudio(options);
    };

    const confirmAgentGeneration = async (item: Extract<CreateAgentItem, { role: "tool" }>, overrides: Partial<AiConfig>) => {
        if (!agentThread) return;
        const input = item.input && typeof item.input === "object" && "prompt" in item.input ? (item.input as { prompt?: unknown }).prompt : "";
        const text = typeof input === "string" ? input.trim() : "";
        if (!text) return;
        const kind = item.toolName === "generate_video" ? "video" : item.toolName === "generate_audio" ? "audio" : "image";
        touched.current = true;
        const patch = (updater: (current: Extract<CreateAgentItem, { role: "tool" }>) => Extract<CreateAgentItem, { role: "tool" }>) => agent.patchItem(agentThread.id, item.id, (current) => current.role === "tool" ? updater(current) : current);
        patch((current) => ({ ...current, status: "generating" }));
        let logId: string | undefined;
        const options = {
            prompt: text, sessionId: agentThread.id, references: item.references ?? [], overrides,
            onLog: (log: CreateLog) => { logId = log.id; patch((current) => ({ ...current, logId: log.id })); },
        };
        try {
            if (kind === "image") await generation.generateImage(options);
            else if (kind === "video") await generation.generateVideo(options);
            else await generation.generateAudio(options);
            if (!logId) {
                patch((current) => ({ ...current, status: "waiting" }));
                return;
            }
            const stored = pageSignal.current.signal.aborted ? null : kind === "image" ? await storage.imageRecords.getItem<ImageLog>(logId)
                : kind === "video" ? await storage.videoRecords.getItem<VideoLog>(logId)
                    : await storage.audioRecords.getItem<AudioLog>(logId);
            const image = kind === "image" ? (stored as ImageLog | null)?.images?.[0] : undefined;
            const label = kind === "image" ? "图片" : kind === "video" ? "视频" : "音频";
            const imageLog = stored as ImageLog | null;
            const videoLog = stored as VideoLog | null;
            const audioLog = stored as AudioLog | null;
            const completed = kind === "image" ? Boolean(imageLog?.images.length) : kind === "video" ? Boolean(videoLog?.video) : Boolean(audioLog?.audio);
            const failureMessage = kind === "image"
                ? imageLog?.slots.flatMap((slot) => slot.error ? [slot.error] : [])[0]
                : kind === "video" ? videoLog?.error : audioLog?.error;
            const failed = kind === "image" ? imageLog?.status === "failed" || (Boolean(failureMessage) && !imageLog?.images.length) : videoLog?.status === "failed" || audioLog?.status === "failed";
            // 先把卡片状态落盘，再启动续跑；续跑会以当前会话为快照，晚到的状态更新会被旧快照覆盖。
            patch((current) => ({ ...current, status: "done" }));
            if (!pageSignal.current.signal.aborted && (completed || failed)) {
                const references = completed && image ? [{ id: image.id, name: "生成结果.png", type: image.mimeType, storageKey: image.storageKey, ...(image.storageKey ? {} : { dataUrl: image.dataUrl }) }] : item.references ?? [];
                const note = completed
                    ? `用户已确认并完成了这次${label}生成，结果已写入创作记录${image ? "，生成结果已作为参考图带入" : ""}。请继续执行规划中的后续步骤；需要继续生成时直接创建新的待确认卡片。`
                    : `用户确认了这次${label}生成，但生成失败了${failureMessage ? `：${failureMessage}` : ""}。请向用户说明原因并给出可执行的下一步（调整参数、更换模型或重试）；需要重试时重新创建待确认卡片，不要声称已经生成。`;
                void agent.continueGeneration(agentThread.id, note, { references });
            }
        } catch (error) {
            console.error("[create-agent] confirm generation", error);
            patch((current) => ({ ...current, status: logId ? "done" : "failed" }));
        }
    };

    const rejectAgentGeneration = (item: Extract<CreateAgentItem, { role: "tool" }>) => {
        if (!agentThread) return;
        const patch = (updater: (current: Extract<CreateAgentItem, { role: "tool" }>) => Extract<CreateAgentItem, { role: "tool" }>) => agent.patchItem(agentThread.id, item.id, (current) => current.role === "tool" ? updater(current) : current);
        const note = "用户拒绝了这个生成卡片，没有生成任何内容。请根据用户意图调整提示词、参数或方式；需要时可以重新创建待确认卡片，或先询问用户。";
        // 先写入拒绝状态，避免续跑用旧快照把卡片覆盖回待确认。
        patch((current) => ({ ...current, status: "rejected" }));
        void agent.continueGeneration(agentThread.id, note, { references: item.references ?? [] });
    };

    // 发送成功后输入框整体清空；本次生成使用清空前的参考图。
    const clearComposer = () => {
        setPrompt("");
        setReferences([]);
    };

    const generate = () => {
        if (!prompt || running) return;
        if (type === "agent") {
            touched.current = true;
            const text = prompt;
            const sent = references;
            clearComposer();
            void agent.send(activeSessionId, text, { references: sent });
            return;
        }
        void runGeneration(type, prompt, clearComposer);
    };

    const autoRun = useRef(false);
    useEffect(() => {
        if (!runParam || autoRun.current || !loaded || !agent.ready || !prompt || !referenceFilesReady) return;
        autoRun.current = true;
        const next = new URLSearchParams(searchParams);
        next.delete("run");
        setSearchParams(next, { replace: true });
        generate();
        // 首页发送后直接提交，只执行一次。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [runParam, loaded, agent.ready, prompt, referenceFilesReady]);

    const saveImage = async (log: ImageLog, image: StoredOutputImage) => {
        try {
            const saved = await saveGeneratedAsset({
                kind: "image", title: log.title || "生成结果", coverUrl: "", source: "创作",
                data: { dataUrl: image.dataUrl, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType },
                metadata: { source: "create-page", prompt: log.prompt },
            });
            if (saved) toast.success("已加入我的资产", workbenchMessageOptions.success);
            else toast.error("资产已发生变化，请重新确认。", workbenchMessageOptions.error);
        } catch {
            toast.error("图片尚未保存到我的资产，请重试。", workbenchMessageOptions.error);
        }
    };

    const saveVideo = async (log: VideoLog, video: StoredOutputVideo) => {
        try {
            const saved = await saveGeneratedAsset({
                kind: "video", title: log.title || "生成视频", coverUrl: "", source: "创作",
                data: { url: video.url, storageKey: video.storageKey, width: video.width, height: video.height, bytes: video.bytes, mimeType: video.mimeType },
                metadata: { source: "create-page", prompt: log.prompt },
            });
            if (saved) toast.success("已加入我的资产", workbenchMessageOptions.success);
            else toast.error("资产已发生变化，请重新确认。", workbenchMessageOptions.error);
        } catch {
            toast.error("视频尚未保存到我的资产，请重试。", workbenchMessageOptions.error);
        }
    };

    const downloadImage = async (image: StoredOutputImage) => {
        const signal = pageAbort();
        try {
            const blob = await readImageBlob(image.storageKey, image.dataUrl, { signal });
            signal.throwIfAborted();
            saveAs(blob, `image-${image.id.slice(0, 8)}.png`);
        } catch {
            if (!signal.aborted) toast.error("图片暂时无法下载，请重试。", workbenchMessageOptions.error);
        }
    };

    const downloadAudio = async (audio: StoredOutputAudio) => {
        const signal = pageAbort();
        try {
            const blob = await readMediaBlob(audio.storageKey, audio.url, { signal });
            signal.throwIfAborted();
            const extension = mime.getExtension(blob.type || audio.mimeType) || "mp3";
            saveAs(blob, `audio-${audio.id.slice(0, 8)}.${extension}`);
        } catch {
            if (!signal.aborted) toast.error("音频暂时无法下载，请重试。", workbenchMessageOptions.error);
        }
    };

    const downloadVideo = async (video: StoredOutputVideo) => {
        const signal = pageAbort();
        try {
            const blob = await readMediaBlob(video.storageKey, video.url, { signal });
            signal.throwIfAborted();
            const extension = mime.getExtension(blob.type || video.mimeType);
            saveAs(blob, extension ? `video-${video.id.slice(0, 8)}.${extension}` : "video");
        } catch {
            if (!signal.aborted) toast.error("视频暂时无法下载，请重试。", workbenchMessageOptions.error);
        }
    };

    const addReference = async (image: StoredOutputImage) => {
        const accepted = await acceptReferences([{ id: nanoid(), name: "生成结果.png", type: image.mimeType || "image/png", dataUrl: image.dataUrl, storageKey: image.storageKey }], pageAbort(), "append");
        if (accepted) toast.success("已加入参考图", workbenchMessageOptions.success);
    };

    const insertPickedAsset = async (payload: CanvasAssetInput) => {
        if (payload.kind === "text") setPrompt(payload.content);
        else if (payload.kind === "image") await acceptReferences([{ id: nanoid(), name: payload.title, type: payload.mimeType, dataUrl: payload.url, storageKey: payload.storageKey }], pageAbort(), "append");
        else toast.warning("创作页只能使用文本或图片资产。", workbenchMessageOptions.warning);
    };

    const reuse = async (log: CreateLog) => {
        setType(log.kind);
        setPrompt(log.prompt);
        await acceptReferences(log.references, pageAbort(), "replace");
    };

    const regenerate = async (log: CreateLog) => {
        if (running) return;
        touched.current = true;
        setType(log.kind);
        setPrompt(log.prompt);
        if (log.kind === "image") await generation.generateImage({ prompt: log.prompt, sessionId: activeSessionId, references: log.references });
        else if (log.kind === "video") await generation.generateVideo({ prompt: log.prompt, sessionId: activeSessionId, references: log.references });
        else await generation.generateAudio({ prompt: log.prompt, sessionId: activeSessionId, references: [] });
    };

    const createSession = () => {
        touched.current = true;
        preview?.close();
        const id = createSessionId();
        setActiveSessionId(id);
        setPrompt("");
        setReferences([]);
        setSearchParams({ session: id }, { replace: true });
    };

    const openSession = (id: string) => {
        touched.current = true;
        preview?.close();
        setActiveSessionId(id);
        applySessionMode(id);
        setSearchParams({ session: id }, { replace: true });
    };

    const deleteSession = async (id: string) => {
        const targets = logs.filter((log) => sessionIdOf(log) === id);
        try {
            for (const kind of ["image", "video", "audio"] as const) {
                const ids = targets.filter((log) => log.kind === kind).map((log) => log.id);
                if (ids.length) await new GenerationRecordDeletion(kind, ids).remove(pageAbort());
            }
            remove(targets.map((log) => log.id));
            await agent.remove(id);
            if (activeSessionId === id) createSession();
        } catch (error) {
            console.error("[create] delete session", error);
            toast.error("创作记录暂时无法删除，请稍后重试。", workbenchMessageOptions.error);
        }
    };

    const actions: CreateEntryActions = {
        signal: pageSignal.current.signal,
        onPreviewImage: (image, images = [image]) => {
            // 预览覆盖当前会话的全部生成图片，单张结果也能继续看上一张或下一张。
            const sessionImages = sessionLogs(logs, activeSessionId).flatMap((log) => log.kind === "image" ? log.images : []);
            const list = sessionImages.length ? sessionImages : images.length ? images : [image];
            const index = Math.max(0, list.findIndex((item) => item.id === image.id));
            void openPreview(list.map((item, order) => ({ id: `result:${item.id}`, alt: `生成结果 ${order + 1}`, storageKey: item.storageKey, url: item.dataUrl, signal: pageAbort() })), index);
        },
        onPreviewReference: (reference, references = [reference]) => {
            const list = references.length ? references : [reference];
            const index = Math.max(0, list.findIndex((item) => item.id === reference.id));
            void openPreview(list.map((item, order) => ({ id: `log-reference:${item.id}`, alt: `参考图 ${order + 1}`, storageKey: item.storageKey, url: item.url || item.dataUrl, signal: pageAbort() })), index);
        },
        onAddReference: addReference,
        onSaveImage: saveImage,
        onDownloadImage: downloadImage,
        onSaveVideo: saveVideo,
        onDownloadVideo: downloadVideo,
        onDownloadAudio: downloadAudio,
        onReuse: (log) => void reuse(log),
        onRegenerate: (log) => void regenerate(log),
        onWaitVideo: (log) => generation.waitVideoResult(log),
    };

    const session = sessions.find((item) => item.id === activeSessionId);
    const blank = !agentThread && !entries.length;
    const composerProps = {
        type,
        onTypeChange: setType,
        prompt,
        onPromptChange: setPrompt,
        references,
        running,
        config: generationConfig,
        updateConfig: updateCreateConfig,
        onGenerate: generate,
        onAddFiles: (files: File[]) => void addReferenceFiles(files, pageAbort()),
        onRemoveReference: (id: string) => setReferences((items) => items.filter((item) => item.id !== id)),
        onPreviewReference: (item: ReferenceImage, items: ReferenceImage[] = references) => {
            const list = items.length ? items : [item];
            const index = Math.max(0, list.findIndex((reference) => reference.id === item.id));
            void openPreview(list.map((reference, order) => ({
                id: `reference:${reference.id}`,
                alt: `参考图 ${order + 1}`,
                storageKey: reference.storageKey,
                url: reference.url || reference.dataUrl,
                signal: pageAbort(),
                read: (signal: AbortSignal) => readReference(reference, signal),
            })), index);
        },
        onOpenPrompts: () => setPromptDialogOpen(true),
        onOpenAssets: () => setAssetPickerOpen(true),
        openConfigDialog,
        onStop: agentRunning ? agent.stop : undefined,
    };
    const composer = <CreateComposer {...composerProps} />;

    return (
        <main className="flex h-full min-w-0 overflow-hidden bg-background text-foreground">
            <section className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)]">
                {blank ? <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-10">
                    <Button type="button" variant="ghost" size="sm" className="absolute right-4 top-4 lg:hidden" onClick={() => setHistoryOpen(true)}><History data-icon="inline-start" />创作记录</Button>
                    <h2 className="text-balance text-center text-3xl font-semibold tracking-tight sm:text-[38px]">{greeting()}，今天想要创作什么？</h2>
                    <div className="mt-6 flex w-full max-w-[900px] flex-wrap items-center justify-center gap-2">
                        {PRESET_PROMPTS.map((preset) => (
                            <button key={preset} type="button" title="点击填入输入框" aria-label={`填入提示词：${preset}`} onClick={() => setPrompt(preset)}
                                className="rounded-full border border-border/70 bg-card px-4 py-2 text-sm text-muted-foreground shadow-sm transition-colors hover:border-foreground/20 hover:text-foreground">
                                {preset}
                            </button>
                        ))}
                    </div>
                    <div className="mt-8 w-full max-w-[1000px]"><CreateComposer {...composerProps} inline /></div>
                </div> : <>
                    <div ref={feed} className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-6 pb-72 pt-8 lg:px-10 lg:pt-10">
                        <div className="mx-auto w-full max-w-[1000px]">
                            <div className="mb-10 flex items-center justify-between gap-4">
                                <h2 className="min-w-0 truncate text-[26px] font-semibold tracking-[-0.03em]">{session?.title || "新对话"}</h2>
                                <div className="flex shrink-0 items-center gap-2">
                                    <Button variant="outline" size="sm" onClick={createSession}><Plus data-icon="inline-start" />新建对话</Button>
                                    <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}><History data-icon="inline-start" />创作记录</Button>
                                </div>
                            </div>
                            {agentThread ? (
                                <CreateAgentConversation thread={agentThread} logs={entries} actions={actions} running={agentRunning} agentMode={type === "agent"} compacting={agent.compacting} contextWindow={contextWindow} config={generationConfig} onConfirmGeneration={confirmAgentGeneration} onRejectGeneration={rejectAgentGeneration} />
                            ) : (
                                <div className="flex flex-col gap-10">
                                    {entries.map((log) => <CreateEntry key={log.id} log={log} actions={actions} />)}
                                </div>
                            )}
                        </div>
                    </div>
                    {composer}
                </>}
            </section>
            <GenerationWorkspaceSheet title="创作记录" open={historyOpen} onOpenChange={setHistoryOpen} height="min(736px, 100dvh)">
                <CreateHistory sessions={sessions} activeId={activeSessionId} onSelect={(id) => { openSession(id); setHistoryOpen(false); }} onCreate={() => { createSession(); setHistoryOpen(false); }} onDelete={(id) => void deleteSession(id)} className="border-r-0 p-0" />
            </GenerationWorkspaceSheet>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <AssetPickerModal open={assetPickerOpen} parentSignal={pageSignal.current.signal} onInsert={insertPickedAsset} onClose={() => setAssetPickerOpen(false)} />
            {preview ? <ImagePreviewGroup items={preview.items} current={preview.index} open onChange={preview.select} onOpenChange={(open) => { if (!open) preview.close(); }} /> : null}
        </main>
    );
}

