import { ModelExecutionError } from "@infinite-canvas/shared/model-http";

export type VideoScriptResult = { blob?: Blob; url?: string; mimeType?: string };

export function audioMimeType(format: string) {
    if (format === "wav") return "audio/wav";
    if (format === "opus") return "audio/opus";
    if (format === "aac") return "audio/aac";
    if (format === "flac") return "audio/flac";
    if (format === "pcm") return "audio/pcm";
    return "audio/mpeg";
}

export function videoPluginResult(result: unknown): VideoScriptResult {
    if (result instanceof Blob && (result.type.includes("json") || !result.size)) throw new ModelExecutionError("MODEL_RESULT_MISSING");
    if (result instanceof Blob) return { blob: result };
    if (typeof result === "string") return { url: result, mimeType: "video/mp4" };
    if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        if (record.blob instanceof Blob) return { blob: record.blob };
        const url = [record.url, record.video_url, record.result_url].find((value) => typeof value === "string" && value) as string | undefined;
        if (url) return { url, mimeType: "video/mp4" };
    }
    throw new ModelExecutionError("MODEL_RESULT_MISSING");
}

export async function audioPluginBlob(result: unknown, format: string, toBlob: (url: string) => Promise<Blob>): Promise<Blob> {
    if (result instanceof Blob && (result.type.includes("json") || !result.size)) throw new ModelExecutionError("MODEL_RESULT_MISSING");
    if (result instanceof Blob) return result.type.startsWith("audio/") ? result : new Blob([result], { type: audioMimeType(format) });
    let source = "";
    if (typeof result === "string") source = result;
    else if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        source = typeof record.b64_json === "string" ? record.b64_json : typeof record.data === "string" ? record.data : typeof record.url === "string" ? record.url : "";
    }
    if (!source) throw new ModelExecutionError("SCRIPT_AUDIO_RESULT_MISSING");
    const url = source.startsWith("data:") || /^https?:/i.test(source) ? source : `data:${audioMimeType(format)};base64,${source}`;
    const blob = await toBlob(url);
    if (!blob.size || blob.type.startsWith("text/") || blob.type.includes("json")) throw new ModelExecutionError("MODEL_RESULT_MISSING");
    return blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
}
