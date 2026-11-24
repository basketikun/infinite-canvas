import { ModelExecutionError, modelAssetUrl, type ModelAsset } from "@infinite-canvas/shared/model-http";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { notifyCreateSessionsChanged } from "@workbench/lib/create-sessions-events";
import { models } from "@workbench/services/api/models/runtime";
import { requestAudioGeneration } from "@workbench/services/api/audio";
import { requestEdit, requestGeneration } from "@workbench/services/api/image";
import { createVideoGenerationTask, isLocalVideoPending, isVideoTaskFailed, videoChannelFingerprint, waitForLocalVideo, waitForVideoGenerationTask } from "@workbench/services/api/video";
import type { VideoGenerationResult, VideoGenerationTask } from "@workbench/services/api/models/types";
import { storage } from "@workbench/services/storage/runtime";
import { hasUnverifiedVideoTask, submittingRecords, updateGenerationRecord } from "@workbench/services/generation-records";
import { registerMediaAsset } from "@workbench/stores/use-asset-store";
import { boolConfig, channelWrites, getModelConfigIssue, useConfigStore, type AiConfig } from "@workbench/stores/use-config-store";
import { clampVideoSeconds } from "@workbench/lib/media-size";
import { normalizeVideoResolutionValue, normalizeVideoSizeValue } from "@workbench/components/video-settings-panel";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import type { ReferenceImage } from "@workbench/types/image";
import { buildAudioLog, buildImageLog, buildVideoLog, serializeLog, type AudioLog, type CreateLog, type ImageLog, type VideoLog } from "@workbench/services/create/logs";
import { prepareImageResult } from "./image-result";
import { prepareVideoResult, saveVideoChange, type VideoChange, type VideoDelivery } from "./video-result";
import { prepareAudioResult, saveAudioChange } from "./audio-result";

type RecordsApi = {
    upsert: (log: CreateLog) => void;
    update: (id: string, updater: (log: CreateLog) => CreateLog) => void;
    remove: (ids: string[]) => void;
};

export type LogOptions = { prompt: string; sessionId: string; references: ReferenceImage[]; onStarted?: () => void; onLog?: (log: CreateLog) => void; overrides?: Partial<AiConfig> };
type ImageOutcome = { image: ImageLog["images"][number] } | { error: string };
const savingVideoResults = new Set<string>();

function applyImageOutcome(log: ImageLog, slotId: string, outcome: ImageOutcome, durationMs: number): ImageLog {
    const slots = log.slots.map((slot) => slot.id === slotId ? ("error" in outcome ? { ...slot, error: outcome.error } : { id: slot.id }) : slot);
    const images = slots.flatMap((slot) => "image" in outcome && outcome.image.id === slot.id ? [outcome.image] : log.images.filter((image) => image.id === slot.id));
    const successCount = images.length, failCount = slots.filter((slot) => slot.error).length;
    return {
        ...log, slots, images, successCount, failCount, durationMs: Math.max(log.durationMs, durationMs),
        status: successCount + failCount < slots.length ? "pending" : successCount ? "success" : "failed",
    };
}

function buildVideoConfig(config: AiConfig, model: string): AiConfig {
    return {
        ...config, model, videoModel: model,
        size: normalizeVideoSizeValue(config.size),
        videoSeconds: normalizeVideoSeconds(config.videoSeconds),
        vquality: normalizeResolution(config.vquality),
        videoGenerateAudio: String(boolConfig(config.videoGenerateAudio, true)),
        videoWatermark: String(boolConfig(config.videoWatermark, false)),
        videoMode: config.videoMode === "reference" ? "reference" : "frames",
    };
}

function normalizeVideoSeconds(value: string) {
    if (String(value) === "-1") return "-1";
    return clampVideoSeconds(value);
}

function normalizeResolution(value: string) {
    return normalizeVideoResolutionValue(value);
}

export function useCreateGeneration(records: RecordsApi, pageSignal: { current: AbortController }, config: AiConfig) {
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const [runningSessions, setRunningSessions] = useState<Record<string, number>>({});
    const unconfirmed = useRef(new Map<string, VideoDelivery>());
    const generating = useRef(false);
    const activeVideoLogs = useRef(new Set<string>());

    const startSession = useCallback((sessionId: string) => setRunningSessions((value) => ({ ...value, [sessionId]: (value[sessionId] || 0) + 1 })), []);
    const finishSession = useCallback((sessionId: string) => setRunningSessions((value) => {
        const count = (value[sessionId] || 0) - 1;
        const next = { ...value };
        if (count > 0) next[sessionId] = count;
        else delete next[sessionId];
        return next;
    }), []);

    const readImageLog = async (id: string) => {
        const stored = await storage.imageRecords.getItem<ImageLog>(id);
        return stored ? { ...stored, kind: "image" as const } : null;
    };
    const readVideoLog = async (id: string) => {
        const stored = await storage.videoRecords.getItem<VideoLog>(id);
        return stored ? { ...stored, kind: "video" as const } : null;
    };
    const readAudioLog = async (id: string) => {
        const stored = await storage.audioRecords.getItem<AudioLog>(id);
        return stored ? { ...stored, kind: "audio" as const } : null;
    };
    const syncLog = async (log: CreateLog) => {
        const stored = log.kind === "image" ? await readImageLog(log.id) : log.kind === "video" ? await readVideoLog(log.id) : await readAudioLog(log.id);
        if (stored) records.upsert(stored);
        else records.remove([log.id]);
    };

    async function runImageLog(log: ImageLog, submit: ((slotId: string, signal: AbortSignal | undefined) => Promise<string>) | undefined, onStarted?: () => void) {
        const signal = pageSignal.current.signal;
        startSession(log.sessionId || "");
        records.upsert(log);
        submittingRecords.add(log.id);
        try {
            try {
                await storage.imageRecords.setItem(log.id, serializeLog(log));
                notifyCreateSessionsChanged();
                onStarted?.();
            } catch {
                if (!signal.aborted) {
                    const error = "生成记录尚未确认，尚未请求生成。请检查存储后重试。";
                    records.update(log.id, (current) => current.kind === "image" ? { ...current, status: "failed", slots: current.slots.map((slot) => ({ ...slot, error: slot.error || error })) } : current);
                    toast.error(error, workbenchMessageOptions.error);
                }
                return;
            }
            await Promise.allSettled(log.slots.map(async (slot) => {
                if (slot.error || log.images.some((image) => image.id === slot.id)) return;
                const started = performance.now();
                let outcome: ImageOutcome;
                try {
                    const observation = log.tasks ? signal : undefined;
                    observation?.throwIfAborted();
                    const url = submit
                        ? await submit(slot.id, observation)
                        : modelAssetUrl(((await models.tasks!.wait(slot.id, { signal, target: { page: "image", recordId: log.id } })).result as ModelAsset[])[0]);
                    outcome = { image: await prepareImageResult(slot.id, url, started, observation) };
                } catch (error) {
                    if (log.tasks && signal.aborted) return;
                    const text = error instanceof ModelExecutionError ? error.message : "图片生成未完成，请检查生成设置后重试。";
                    if (log.tasks && error instanceof ModelExecutionError && error.code === "MODEL_UNAVAILABLE") {
                        records.update(log.id, (current) => current.kind === "image" ? applyImageOutcome(current, slot.id, { error: text }, current.durationMs) : current);
                        return;
                    }
                    outcome = { error: text };
                }
                const durationMs = Date.now() - log.createdAt;
                try {
                    if (!await updateGenerationRecord<ImageLog>("image", log.id, log.generationId, (row) => applyImageOutcome(row, slot.id, outcome, durationMs))) {
                        records.remove([log.id]);
                        return;
                    }
                    await syncLog(log);
                    if ("image" in outcome) await registerMediaAsset({
                        kind: "image", storageKey: outcome.image.storageKey, url: outcome.image.dataUrl,
                        width: outcome.image.width, height: outcome.image.height, bytes: outcome.image.bytes, mimeType: outcome.image.mimeType,
                        title: log.title || "生成图片", source: "创作", metadata: { source: "create-page", prompt: log.prompt, recordId: log.id },
                    }).catch((error) => console.error("[assets] register generated image", error));
                } catch (error) {
                    console.error("[create] save image result", error);
                    records.update(log.id, (current) => current.kind === "image" ? applyImageOutcome(current, slot.id, { error: "生成结果尚未保存，请重新生成。" }, durationMs) : current);
                }
            }));
            if (signal.aborted) return;
            if (!log.tasks) {
                const stored = await readImageLog(log.id).catch(() => null);
                if (stored?.images.length) toast.success("图片已生成", workbenchMessageOptions.success);
                else toast.error("图片生成未完成。", workbenchMessageOptions.error);
            }
        } finally {
            submittingRecords.delete(log.id);
            finishSession(log.sessionId || "");
        }
    }

    async function generateImage(options: LogOptions) {
        const activeConfig = { ...config, ...options.overrides };
        const model = activeConfig.imageModel || activeConfig.model;
        if (getModelConfigIssue(activeConfig, model)) {
            openConfigDialog(true, "builtin:channels", model);
            return;
        }
        const count = Math.max(1, Math.min(10, Number(activeConfig.count) || 1));
        const log = buildImageLog(options.prompt, model, activeConfig, options.references, options.sessionId, count);
        options.onLog?.(log);
        if (models.tasks) log.tasks = log.slots.map((slot) => ({ taskId: slot.id }));
        await runImageLog(log, async (slotId, signal) => {
            const requestOptions = log.tasks ? { taskId: slotId, signal, target: { page: "image" as const, recordId: log.id } } : undefined;
            const requestConfig = { ...activeConfig, model, count: "1" };
            const images = log.references.length
                ? await requestEdit(requestConfig, options.prompt, log.references, requestOptions)
                : await requestGeneration(requestConfig, options.prompt, requestOptions);
            return images[0].dataUrl;
        }, options.onStarted);
    }

    async function pollVideoLog(log: VideoLog, justSubmitted = false, immediate?: VideoGenerationResult) {
        const signal = pageSignal.current.signal;
        if ((!immediate && (signal.aborted || !(log.taskId && models.tasks || log.task))) || activeVideoLogs.current.has(log.id) || savingVideoResults.has(log.id)) return false;
        if (hasUnverifiedVideoTask(log)) return false;
        activeVideoLogs.current.add(log.id);
        startSession(log.sessionId || "");
        let received = false;
        try {
            let delivery: VideoDelivery;
            try {
                const result = immediate ?? (log.taskId
                    ? await waitForLocalVideo(log.taskId, { signal, resume: !justSubmitted, target: { page: "video", recordId: log.id } })
                    : await waitForVideoGenerationTask(async () => {
                        await channelWrites.flush();
                        const next = buildVideoConfig({ ...useConfigStore.getState().config, ...log.config }, log.task!.model);
                        if (await videoChannelFingerprint(next, log.task!.model, log.generationId) !== log.task!.channelFingerprint) throw new ModelExecutionError("MODEL_VIDEO_CONNECTION_CHANGED");
                        return next;
                    }, log.task!, { signal }));
                savingVideoResults.add(log.id);
                received = true;
                delivery = makeVideoDelivery(log, { status: "success", video: await prepareVideoResult(log.generationId, result, log.createdAt) });
            } catch (error) {
                if (signal.aborted && !received) return false;
                const pending = Boolean(log.task && !isVideoTaskFailed(error)) || Boolean(log.taskId && (received || isLocalVideoPending(error)));
                const detail = error instanceof ModelExecutionError ? error.message : "视频生成未完成，请检查生成设置后重试。";
                delivery = makeVideoDelivery(log, pending ? { status: "waiting", error: detail } : { status: "failed", error: detail });
            }
            const persisted = await deliverVideo(log, delivery);
            if (!persisted) return false;
            const { change } = delivery;
            if (change.status === "success") {
                await registerMediaAsset({
                    kind: "video", storageKey: change.video.storageKey, url: change.video.url,
                    width: change.video.width, height: change.video.height, bytes: change.video.bytes, mimeType: change.video.mimeType,
                    title: log.title || "生成视频", source: "创作", metadata: { source: "create-page", prompt: log.prompt, recordId: log.id },
                }).catch((error) => console.error("[assets] register generated video", error));
                toast.success("视频已生成", workbenchMessageOptions.success);
            }
            else if (change.status !== "submitted") toast.error(change.error, workbenchMessageOptions.error);
            return true;
        } catch (error) {
            console.error("[create] save video result", error);
            toast.error("视频生成记录未能保存，请重新打开页面查看。", workbenchMessageOptions.error);
            return false;
        } finally {
            activeVideoLogs.current.delete(log.id);
            if (received) savingVideoResults.delete(log.id);
            if (!signal.aborted) finishSession(log.sessionId || "");
        }
    }

    async function deliverVideo(log: VideoLog, delivery: VideoDelivery) {
        try {
            const accepted = await saveVideoChange(delivery);
            unconfirmed.current.delete(log.id);
            await syncLog(log);
            return accepted;
        } catch (error) {
            console.error("[create] save video receipt", error);
            unconfirmed.current.set(log.id, delivery);
            records.update(log.id, (current) => current.kind === "video" ? { ...current, error: "视频生成记录尚未确认，请重试保存。" } : current);
            return false;
        }
    }

    async function generateVideo(options: LogOptions) {
        const activeConfig = { ...config, ...options.overrides };
        const model = activeConfig.videoModel || activeConfig.model;
        if (getModelConfigIssue(activeConfig, model)) {
            openConfigDialog(true, "builtin:channels", model);
            return;
        }
        if (generating.current) return;
        const requestConfig = buildVideoConfig({ ...activeConfig, size: activeConfig.videoSize }, model);
        const log = buildVideoLog(options.prompt, model, requestConfig, options.references, options.sessionId);
        options.onLog?.(log);
        generating.current = true;
        startSession(log.sessionId || "");
        const signal = models.tasks ? pageSignal.current.signal : undefined;
        const taskId = models.tasks ? log.id : undefined;
        log.taskId = taskId;
        records.upsert(log);
        submittingRecords.add(log.id);
        try {
            await storage.videoRecords.setItem(log.id, serializeLog(log));
            notifyCreateSessionsChanged();
            records.upsert(log);
            options.onStarted?.();
            const fingerprint = taskId ? undefined : await videoChannelFingerprint(requestConfig, requestConfig.model, log.generationId);
            let task: VideoGenerationTask;
            try {
                task = await createVideoGenerationTask(requestConfig, options.prompt, options.references, { signal, taskId, target: { page: "video", recordId: log.id } });
            } catch (error) {
                if (signal?.aborted) return;
                const pending = models.tasks && isLocalVideoPending(error);
                const detail = error instanceof ModelExecutionError ? error.message : "视频生成未完成，请检查生成设置后重试。";
                await deliverVideo(log, makeVideoDelivery(log, pending ? { status: "waiting", error: detail } : { status: "failed", error: detail }));
                toast.error(detail, workbenchMessageOptions.error);
                return;
            }
            if (!taskId && !task.result) {
                const remote = { id: task.id, model: task.model, scriptId: task.scriptId, script: task.script, channelFingerprint: fingerprint! };
                await deliverVideo(log, makeVideoDelivery(log, { status: "submitted", task: remote }));
                log.task = remote;
                records.update(log.id, (current) => current.kind === "video" ? { ...current, task: remote } : current);
            }
            if (!task.result) submittingRecords.delete(log.id);
            await pollVideoLog(log, true, task.result);
        } catch (error) {
            if (!pageSignal.current.signal.aborted) {
                console.error("[create] save video submission", error);
                records.update(log.id, (current) => current.kind === "video" ? { ...current, status: "failed", error: "生成记录尚未确认，请重新生成。" } : current);
                toast.error("视频生成记录未能保存，请重新打开页面查看。", workbenchMessageOptions.error);
            }
        } finally {
            generating.current = false;
            submittingRecords.delete(log.id);
            finishSession(log.sessionId || "");
        }
    }

    async function generateAudio(options: LogOptions) {
        const activeConfig = { ...config, ...options.overrides };
        const model = activeConfig.audioModel || activeConfig.model;
        if (getModelConfigIssue(activeConfig, model)) {
            openConfigDialog(true, "builtin:channels", model);
            return;
        }
        if (generating.current) return;
        const log = buildAudioLog(options.prompt, model, activeConfig, options.sessionId);
        options.onLog?.(log);
        generating.current = true;
        startSession(log.sessionId || "");
        records.upsert(log);
        submittingRecords.add(log.id);
        const signal = pageSignal.current.signal;
        try {
            await storage.audioRecords.setItem(log.id, serializeLog(log));
            notifyCreateSessionsChanged();
            options.onStarted?.();
            const result = await requestAudioGeneration({ ...activeConfig, model }, options.prompt, { signal });
            const audio = await prepareAudioResult(log.generationId, result);
            await saveAudioChange(log.id, log.generationId, Date.now() - log.createdAt, { status: "success", audio });
            await syncLog(log);
            await registerMediaAsset({
                kind: "audio", storageKey: audio.storageKey, url: audio.url,
                width: audio.width, height: audio.height, bytes: audio.bytes, mimeType: audio.mimeType,
                title: log.title || "生成音频", source: "创作", metadata: { source: "create-page", prompt: log.prompt, recordId: log.id },
            }).catch((error) => console.error("[assets] register generated audio", error));
            if (!signal.aborted) toast.success("音频已生成", workbenchMessageOptions.success);
        } catch (error) {
            if (signal.aborted) return;
            const detail = error instanceof ModelExecutionError ? error.message : "音频生成未完成，请检查生成设置后重试。";
            try {
                await saveAudioChange(log.id, log.generationId, Date.now() - log.createdAt, { status: "failed", error: detail });
                await syncLog(log);
            } catch (saveError) {
                console.error("[create] save audio result", saveError);
            }
            toast.error(detail, workbenchMessageOptions.error);
        } finally {
            generating.current = false;
            submittingRecords.delete(log.id);
            finishSession(log.sessionId || "");
        }
    }

    function resume(log: CreateLog) {
        if (log.status !== "pending" || submittingRecords.has(log.id) || unconfirmed.current.has(log.id)) return;
        if (log.kind === "image") {
            if (!log.tasks?.length || !models.tasks) return;
            void runImageLog(log, undefined);
            return;
        }
        if (log.kind === "audio") return;
        if (!(log.taskId && models.tasks || log.task)) return;
        void pollVideoLog(log);
    }

    return {
        runningSessions,
        generateImage,
        generateVideo,
        generateAudio,
        resume,
        waitVideoResult(log: VideoLog) { void pollVideoLog(log); },
    };
}

function makeVideoDelivery(log: VideoLog, change: VideoChange): VideoDelivery {
    return { id: log.id, generationId: log.generationId, durationMs: Date.now() - log.createdAt, change };
}

export type CreateGeneration = ReturnType<typeof useCreateGeneration>;
