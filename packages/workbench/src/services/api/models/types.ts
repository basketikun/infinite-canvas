import type { ModelTask, ModelTaskTarget } from "@infinite-canvas/shared/model-http";
import type { ModelCallUpstream } from "@infinite-canvas/shared/model-calls";
import type { AudioModelRequest, ImageModelRequest, ModelExecutionConfig, ModelTextEvent, TextAgentProtocol, TextModelRequest, VideoModelRequest, VideoTaskIdentity, VideoTaskQuery } from "@infinite-canvas/shared/model-execution";

export type ModelRequestOptions = { signal?: AbortSignal; taskId?: string; target?: ModelTaskTarget; beforeSubmit?: () => Promise<void>; onTaskSubmission?: (receipt: Promise<ModelTask>) => void; onTerminal?: () => void; onUpstream?: (entry: ModelCallUpstream) => void };
type ModelTaskWaitOptions = {
    signal?: AbortSignal;
    onText?: (text: string, snapshot: ModelTask) => void;
    resume?: boolean;
    target?: ModelTaskTarget;
    onTerminalFailure?: (snapshot: ModelTask) => void;
};
export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = VideoTaskIdentity & { result?: VideoGenerationResult };
export type VideoTaskSubmission = { id: string } | { result: VideoGenerationResult };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

/**
 * 页面使用的模型执行接口。取消信号、回调和媒体对象由各实现处理。
 */
export interface ModelAdapter {
    tasks?: {
        read: (taskId: string, signal?: AbortSignal) => Promise<ModelTask>;
        wait: (taskId: string, options?: ModelTaskWaitOptions) => Promise<ModelTask>;
        cancel: (taskId: string, target?: ModelTaskTarget, signal?: AbortSignal) => Promise<ModelTask | void>;
    };
    generateImages(request: ImageModelRequest, options?: ModelRequestOptions): Promise<string[]>;
    generateText(request: TextModelRequest, options: ModelRequestOptions & { onEvent: (event: ModelTextEvent) => void }): Promise<string>;
    generateAudio(request: AudioModelRequest, options?: ModelRequestOptions): Promise<Blob | string>;
    createVideoTask(request: VideoModelRequest, options?: ModelRequestOptions): Promise<VideoTaskSubmission>;
    queryVideoTask(request: VideoTaskQuery, options?: ModelRequestOptions): Promise<VideoGenerationTaskState>;
    fetchText(config: ModelExecutionConfig, protocol: TextAgentProtocol, url: string, init?: RequestInit): Promise<Response>;
}
