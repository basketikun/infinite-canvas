import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import coreURL from "@ffmpeg/core?url";
import coreWasmURL from "@ffmpeg/core/wasm?url";
import i18n from "@/i18n";

type MediaProcessingStage = "loading" | "reading" | "extracting" | "processing";

let activeFFmpeg: FFmpeg | null = null;
let activeTerminate: (() => void) | null = null;
let loadedFFmpeg: FFmpeg | null = null;

export async function trimMedia(source: Blob, startSeconds: number, endSeconds: number, options: { signal: AbortSignal; onProgress?: (progress: number) => void; onStage?: (stage: MediaProcessingStage) => void; mode?: "trim" | "extract-audio" }) {
    const { signal, onProgress } = options;
    const mode = options.mode || "trim";
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || startSeconds >= endSeconds) throw new Error("Select a valid time range.");
    if (activeFFmpeg) throw new Error("A media trim is already running.");
    if (signal.aborted) throw abortError();
    const input = inputInfo(source.type);
    const ffmpeg = loadedFFmpeg ?? new FFmpeg();
    const needsLoad = loadedFFmpeg !== ffmpeg;
    activeFFmpeg = ffmpeg;
    let terminated = false;
    const terminate = () => {
        if (terminated) return;
        terminated = true;
        ffmpeg.terminate();
        if (loadedFFmpeg === ffmpeg) loadedFFmpeg = null;
        if (activeFFmpeg === ffmpeg) {
            activeFFmpeg = null;
            activeTerminate = null;
        }
    };
    activeTerminate = terminate;
    const onAbort = () => terminate();
    const onFFmpegProgress = ({ progress }: { progress: number }) => onProgress?.(Math.max(0, Math.min(1, progress)));
    const ffmpegLogs: string[] = [];
    const onFFmpegLog = ({ message }: { message: string }) => {
        ffmpegLogs.push(message);
        if (ffmpegLogs.length > 20) ffmpegLogs.shift();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    ffmpeg.on("progress", onFFmpegProgress);
    ffmpeg.on("log", onFFmpegLog);
    const inputName = `source.${input.extension}`;
    const extractingAudio = input.kind === "video" && mode === "extract-audio";
    const outputName = input.kind === "video" && !extractingAudio ? "trimmed.mp4" : "trimmed.mp3";
    try {
        options.onStage?.("loading");
        if (needsLoad) {
            await ffmpeg.load({ coreURL, wasmURL: coreWasmURL }, { signal });
            if (signal.aborted) throw abortError();
            loadedFFmpeg = ffmpeg;
        }
        options.onStage?.("reading");
        await deleteFileIfPresent(ffmpeg, inputName);
        await deleteFileIfPresent(ffmpeg, outputName);
        if (signal.aborted) throw abortError();
        await ffmpeg.writeFile(inputName, await fetchFile(source), { signal });
        const duration = endSeconds - startSeconds;
        options.onStage?.(extractingAudio ? "extracting" : "processing");
        const args = input.kind === "video"
            ? extractingAudio
                ? ["-ss", String(startSeconds), "-i", inputName, "-t", String(duration), "-map", "0:a:0", "-vn", "-c:a", "libmp3lame", "-q:a", "2", "-f", "mp3", outputName]
                : ["-i", inputName, "-ss", String(startSeconds), "-t", String(duration), "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-f", "mp4", outputName]
            : ["-i", inputName, "-ss", String(startSeconds), "-t", String(duration), "-map", "0:a:0", "-vn", "-c:a", "libmp3lame", "-q:a", "2", "-f", "mp3", outputName];
        const result = await ffmpeg.exec(args, undefined, { signal });
        if (signal.aborted) throw abortError();
        if (result !== 0) {
            const details = ffmpegLogs.slice(-8).join("\n");
            if (extractingAudio && /matches no streams|does not contain any stream/i.test(details)) {
                throw new Error(i18n.t("canvas.mediaTrim.noAudioTrack"));
            }
            throw new Error([i18n.t("canvas.mediaTrim.failed"), details].filter(Boolean).join("\n"));
        }
        const data = await ffmpeg.readFile(outputName, "binary", { signal });
        if (typeof data === "string") throw new Error("The trimmed media output was invalid.");
        const bytes = new Uint8Array(data);
        return new Blob([bytes.buffer as ArrayBuffer], { type: input.kind === "video" && !extractingAudio ? "video/mp4" : "audio/mpeg" });
    } catch (error) {
        if (signal.aborted) throw abortError();
        if (loadedFFmpeg !== ffmpeg) terminate();
        throw error;
    } finally {
        signal.removeEventListener("abort", onAbort);
        ffmpeg.off("progress", onFFmpegProgress);
        ffmpeg.off("log", onFFmpegLog);
        if (!terminated) {
            await deleteFileIfPresent(ffmpeg, inputName);
            await deleteFileIfPresent(ffmpeg, outputName);
            if (activeFFmpeg === ffmpeg) {
                activeFFmpeg = null;
                activeTerminate = null;
            }
        }
    }
}

export function terminateMediaTrim() {
    if (activeTerminate) {
        activeTerminate();
        return;
    }
    if (loadedFFmpeg) {
        loadedFFmpeg.terminate();
        loadedFFmpeg = null;
    }
}

async function deleteFileIfPresent(ffmpeg: FFmpeg, path: string) {
    try {
        await ffmpeg.deleteFile(path);
    } catch {
        // The file may not exist yet, or the worker may already have been reset.
    }
}

function inputInfo(mimeType: string): { kind: "video" | "audio"; extension: string } {
    const type = mimeType.toLowerCase().split(";")[0].trim();
    if (type === "video/mp4") return { kind: "video", extension: "mp4" };
    if (type === "video/webm") return { kind: "video", extension: "webm" };
    if (["audio/mpeg", "audio/mp3"].includes(type)) return { kind: "audio", extension: "mp3" };
    if (["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"].includes(type)) return { kind: "audio", extension: "wav" };
    if (["audio/ogg", "application/ogg", "audio/opus"].includes(type)) return { kind: "audio", extension: "ogg" };
    if (["audio/mp4", "audio/aac", "audio/x-m4a"].includes(type)) return { kind: "audio", extension: "m4a" };
    throw new Error(i18n.t("canvas.mediaTrim.unavailableFormat"));
}

function abortError() {
    return new DOMException("Media trim canceled.", "AbortError");
}
