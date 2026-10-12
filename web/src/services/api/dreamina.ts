import { deleteDreaminaAsset, submitDreaminaVideo, uploadDreaminaAsset, type DreaminaVideoInput } from "@/services/api/canvas-agent";
import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export async function submitCanvasDreaminaVideo(
    endpoint: string,
    token: string,
    input: Omit<DreaminaVideoInput, "imageIds" | "videoIds" | "audioIds">,
    images: ReferenceImage[],
    videos: ReferenceVideo[],
    audios: ReferenceAudio[],
    signal?: AbortSignal,
) {
    const uploaded: string[] = [];
    try {
        const imageIds: string[] = [];
        for (const image of images) {
            const blob = (image.storageKey ? await getImageBlob(image.storageKey) : null) || await (await fetch(image.dataUrl)).blob();
            imageIds.push(await upload(endpoint, token, blob, image.name, image.type, uploaded, signal));
        }
        const videoIds: string[] = [];
        for (const video of videos) {
            const blob = (video.storageKey ? await getMediaBlob(video.storageKey) : null) || await (await fetch(video.url)).blob();
            videoIds.push(await upload(endpoint, token, blob, video.name, video.type, uploaded, signal));
        }
        const audioIds: string[] = [];
        for (const audio of audios) {
            const blob = (audio.storageKey ? await getMediaBlob(audio.storageKey) : null) || await (await fetch(audio.url)).blob();
            audioIds.push(await upload(endpoint, token, blob, audio.name, audio.type, uploaded, signal));
        }
        return await submitDreaminaVideo(endpoint, token, { ...input, imageIds, videoIds, audioIds });
    } finally {
        await Promise.all(uploaded.map((id) => deleteDreaminaAsset(endpoint, token, id).catch(() => undefined)));
    }
}

async function upload(endpoint: string, token: string, blob: Blob, name: string, expectedType: string, uploaded: string[], signal?: AbortSignal) {
    const mimeType = blob.type || expectedType;
    if (!mimeType || mimeType === "application/octet-stream") throw new Error("无法识别参考素材格式");
    const typedBlob = blob.type ? blob : new Blob([blob], { type: mimeType });
    const extension = extensionForMime(mimeType);
    const baseName = name.replace(/\.[^.]*$/, "").replace(/[\\/:*?"<>|]/g, "_") || "reference";
    const response = await uploadDreaminaAsset(endpoint, token, typedBlob, `${baseName}${extension}`, signal);
    if (!response.data?.id) throw new Error("即梦参考素材上传失败");
    uploaded.push(response.data.id);
    return response.data.id;
}

function extensionForMime(mimeType: string) {
    const mime = mimeType.toLowerCase().split(";")[0];
    const known: Record<string, string> = {
        "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
        "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm", "video/x-m4v": ".m4v",
        "audio/mpeg": ".mp3", "audio/mp3": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/mp4": ".m4a", "audio/x-m4a": ".m4a", "audio/aac": ".aac", "audio/ogg": ".ogg", "audio/flac": ".flac",
    };
    const extension = known[mime];
    if (!extension) throw new Error(`即梦暂不支持参考素材格式：${mimeType}`);
    return extension;
}
