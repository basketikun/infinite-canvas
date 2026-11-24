import type { StoredOutputAudio, StoredOutputImage, StoredOutputVideo, WorkbenchVideoTask } from "@infinite-canvas/shared/sync-records";
import type { AiConfig } from "@workbench/stores/use-config-store";
import type { ReferenceImage } from "@workbench/types/image";
import { normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceValue } from "@workbench/lib/audio-generation";

export type CreateKind = "image" | "video" | "audio";
export type CreateMode = CreateKind | "agent";

export type ImageLogConfig = Pick<AiConfig, "model" | "imageModel" | "quality" | "size" | "count">;
export type VideoLogConfig = Pick<AiConfig, "model" | "videoModel" | "size" | "vquality" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoMode">;
export type AudioLogConfig = Pick<AiConfig, "model" | "audioModel" | "audioVoice" | "audioFormat" | "audioSpeed">;

export type ImageLog = {
    kind: "image";
    id: string;
    generationId: string;
    sessionId?: string;
    slots: { id: string; error?: string }[];
    createdAt: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: ImageLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    imageCount: number;
    size: string;
    quality: string;
    status: "pending" | "success" | "failed" | "interrupted";
    tasks?: Array<{ taskId: string; error?: string }>;
    images: StoredOutputImage[];
};

export type VideoLog = {
    kind: "video";
    id: string;
    generationId: string;
    sessionId?: string;
    createdAt: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: VideoLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    size: string;
    resolution: string;
    seconds: string;
    status: "pending" | "success" | "failed" | "interrupted";
    taskId?: string;
    task?: WorkbenchVideoTask;
    video?: StoredOutputVideo;
    error?: string;
};

export type AudioLog = {
    kind: "audio";
    id: string;
    generationId: string;
    sessionId?: string;
    createdAt: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: AudioLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    size: string;
    status: "pending" | "success" | "failed" | "interrupted";
    audio?: StoredOutputAudio;
    error?: string;
};

export type CreateLog = ImageLog | VideoLog | AudioLog;

export type CreateSession = { id: string; title: string; count: number; updatedAt: number };

export function createSessionId() {
    return crypto.randomUUID();
}

/** 记录没有会话编号时各自成为一条历史，避免旧记录被并进别的对话。 */
export function sessionIdOf(log: CreateLog) {
    return log.sessionId || `record:${log.id}`;
}

export function createSessions(logs: CreateLog[]): CreateSession[] {
    const sessions = new Map<string, CreateSession>();
    for (const log of [...logs].sort((left, right) => left.createdAt - right.createdAt)) {
        const id = sessionIdOf(log);
        const current = sessions.get(id);
        if (!current) sessions.set(id, { id, title: log.title || "新对话", count: 1, updatedAt: log.createdAt });
        else sessions.set(id, { ...current, count: current.count + 1, updatedAt: Math.max(current.updatedAt, log.createdAt) });
    }
    return [...sessions.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}

/** 生成记录和 Agent 会话共用一份创作记录列表。 */
export function mergeSessions(records: CreateSession[], agents: CreateSession[]): CreateSession[] {
    const merged = new Map(records.map((session) => [session.id, session]));
    for (const session of agents) {
        const current = merged.get(session.id);
        merged.set(session.id, current
            ? { ...current, title: session.title || current.title, count: current.count + session.count, updatedAt: Math.max(current.updatedAt, session.updatedAt) }
            : session);
    }
    return [...merged.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}

export function sessionLogs(logs: CreateLog[], sessionId: string) {
    return logs.filter((log) => sessionIdOf(log) === sessionId).sort((left, right) => left.createdAt - right.createdAt);
}

export function buildImageLog(prompt: string, model: string, config: AiConfig, references: ReferenceImage[], sessionId: string, count: number): ImageLog {
    const id = crypto.randomUUID();
    return {
        kind: "image", id, generationId: crypto.randomUUID(), sessionId,
        slots: Array.from({ length: count }, () => ({ id: crypto.randomUUID() })),
        createdAt: Date.now(), title: prompt.slice(0, 18) || "未命名", prompt,
        time: new Date().toLocaleString("zh-CN", { hour12: false }),
        model,
        config: { model: config.model, imageModel: config.imageModel, quality: config.quality, size: config.size, count: config.count },
        references,
        durationMs: 0, successCount: 0, failCount: 0, imageCount: count,
        size: config.size, quality: config.quality, status: "pending",
        images: [],
    };
}

export function buildVideoLog(prompt: string, model: string, config: AiConfig, references: ReferenceImage[], sessionId: string): VideoLog {
    const logConfig: VideoLogConfig = {
        model: config.model, videoModel: config.videoModel, size: config.size,
        vquality: config.vquality, videoSeconds: config.videoSeconds,
        videoGenerateAudio: config.videoGenerateAudio, videoWatermark: config.videoWatermark,
        videoMode: config.videoMode === "reference" ? "reference" : "frames",
    };
    return {
        kind: "video", id: crypto.randomUUID(), generationId: crypto.randomUUID(), sessionId,
        createdAt: Date.now(), title: prompt.slice(0, 18) || "未命名", prompt,
        time: new Date().toLocaleString("zh-CN", { hour12: false }),
        model, config: logConfig, references, durationMs: 0,
        size: logConfig.size, resolution: logConfig.vquality, seconds: logConfig.videoSeconds,
        status: "pending",
    };
}

export function buildAudioLog(prompt: string, model: string, config: AiConfig, sessionId: string): AudioLog {
    return {
        kind: "audio", id: crypto.randomUUID(), generationId: crypto.randomUUID(), sessionId,
        createdAt: Date.now(), title: prompt.slice(0, 18) || "未命名", prompt,
        time: new Date().toLocaleString("zh-CN", { hour12: false }),
        model,
        config: {
            model: config.model, audioModel: model,
            audioVoice: normalizeAudioVoiceValue(config.audioVoice),
            audioFormat: normalizeAudioFormatValue(config.audioFormat),
            audioSpeed: normalizeAudioSpeedValue(config.audioSpeed),
        },
        references: [], durationMs: 0, size: "", status: "pending",
    };
}

/** 记录里只保留可跨设备保存的媒体引用。 */
export function serializeLog(log: CreateLog): CreateLog {
    if (log.kind === "audio") return { ...log, audio: log.audio?.storageKey ? { ...log.audio, url: undefined } : log.audio };
    if (log.kind === "image") {
        return {
            ...log,
            references: log.references.map(({ dataUrl, url, ...item }) => item.storageKey ? item : { ...item, dataUrl, url }),
            images: log.images.map(({ dataUrl, ...image }) => image.storageKey ? image : { ...image, dataUrl }),
        };
    }
    return { ...log, references: log.references.map(({ dataUrl, url, ...item }) => item.storageKey ? item : { ...item, dataUrl, url }), video: log.video?.storageKey ? { ...log.video, url: undefined } : log.video };
}
