/**
 * 视频抽帧工具：从可加载的视频 URL 均匀抽取 N 帧，输出 JPEG dataURL。
 *
 * 用于"视频 → 反推提示词"链路：画布文本模型只能消费图片，把视频归一化成帧图后，
 * 复用现有 requestImageQuestion（多 image_url）即可实现后端无关的视频反推。
 *
 * 关键约束（见 docs/content/docs/progress/video-reverse-prompt-plan.zh-CN.mdx 审查补充）：
 * - 跨域视频会污染 canvas，`toDataURL()` 抛 SecurityError → 只允许 blob:/asset:/同源 URL；
 * - 抽帧依赖 loadedmetadata → seek → seeked → drawImage 事件链，必须按序等待；
 * - 帧数按时长自适应，总帧数上限 12。
 */

export type ExtractVideoFramesOptions = {
    /** 目标帧数；缺省按时长自适应（resolveFrameCount）。 */
    count?: number;
    /** 帧图最大宽度（默认 512）。 */
    maxWidth?: number;
    /** JPEG 质量（默认 0.8）。 */
    quality?: number;
    /** 每抽完一帧回调（current, total）。 */
    onProgress?: (current: number, total: number) => void;
};

const FRAME_MAX_WIDTH = 512;
const FRAME_QUALITY = 0.8;
const MAX_FRAMES = 12;
const BLACK_BRIGHTNESS_THRESHOLD = 8;

/** 视频源白名单：上传的 blob:、画布内部 asset:、同源 http(s)。跨域 URL 会污染 canvas，直接拒绝。 */
export function isFrameExtractableUrl(url: string): boolean {
    if (!url) return false;
    if (url.startsWith("blob:") || url.startsWith("asset:")) return true;
    if (/^https?:/i.test(url)) {
        try {
            return new URL(url).origin === window.location.origin;
        } catch {
            return false;
        }
    }
    return false;
}

/** 按时长自适应帧数：≤15s → 5；≤60s → 7；更长 → 9（单视频反推默认档）。 */
export function resolveFrameCount(durationSeconds: number): number {
    if (durationSeconds <= 15) return 5;
    if (durationSeconds <= 60) return 7;
    return 9;
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
    return new Promise((resolve, reject) => {
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        video.crossOrigin = "anonymous";
        const cleanup = () => {
            video.removeAttribute("src");
            video.load();
        };
        video.onerror = () => {
            cleanup();
            reject(new Error("视频加载失败，请确认视频文件可用"));
        };
        video.onloadedmetadata = () => {
            if (!Number.isFinite(video.duration) || video.duration <= 0) {
                cleanup();
                reject(new Error("无法读取视频时长"));
                return;
            }
            resolve(video);
        };
        video.src = url;
    });
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
    return new Promise((resolve) => {
        const onSeeked = () => {
            video.removeEventListener("seeked", onSeeked);
            resolve();
        };
        video.addEventListener("seeked", onSeeked);
        video.currentTime = time;
    });
}

function drawFrame(video: HTMLVideoElement, maxWidth: number, quality: number): { dataUrl: string; brightness: number } {
    const scale = Math.min(1, maxWidth / (video.videoWidth || 1));
    const width = Math.max(1, Math.round((video.videoWidth || 1) * scale));
    const height = Math.max(1, Math.round((video.videoHeight || 1) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建画布上下文");
    ctx.drawImage(video, 0, 0, width, height);
    return { dataUrl: canvas.toDataURL("image/jpeg", quality), brightness: sampleBrightness(ctx, width, height) };
}

/** 均匀采样亮度（3×3 网格），用于黑帧自检。 */
function sampleBrightness(ctx: CanvasRenderingContext2D, width: number, height: number): number {
    let data: Uint8ClampedArray;
    try {
        data = ctx.getImageData(0, 0, width, height).data;
    } catch {
        return 255; // 读取失败（罕见）按非黑处理
    }
    let sum = 0;
    let count = 0;
    const stepX = Math.max(1, Math.floor(width / 3));
    const stepY = Math.max(1, Math.floor(height / 3));
    for (let y = stepY >> 1; y < height; y += stepY) {
        for (let x = stepX >> 1; x < width; x += stepX) {
            const i = (y * width + x) * 4;
            sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
            count += 1;
        }
    }
    return count ? sum / count : 255;
}

/**
 * 从视频 URL 抽取均匀 N 帧。
 * @throws 来源不可抽帧 / 加载失败 / 时长无效时抛错（带中文提示）。
 */
export async function extractVideoFrames(url: string, options: ExtractVideoFramesOptions = {}): Promise<string[]> {
    if (!isFrameExtractableUrl(url)) {
        throw new Error("该视频来源无法在浏览器中抽帧（仅支持上传到画布的视频），请改用原生支持视频的模型（如 Gemini）或重新上传视频");
    }
    const maxWidth = options.maxWidth || FRAME_MAX_WIDTH;
    const quality = options.quality ?? FRAME_QUALITY;
    const video = await loadVideo(url);
    try {
        const duration = video.duration;
        const count = Math.max(1, Math.min(MAX_FRAMES, Math.floor(options.count ?? resolveFrameCount(duration))));
        const frames: string[] = [];
        for (let i = 0; i < count; i++) {
            // 均匀取每段中点，避开首尾可能存在的黑帧
            const base = (duration * (i + 0.5)) / count;
            let frame = drawFrame(await seekedAt(video, base), maxWidth, quality);
            if (frame.brightness < BLACK_BRIGHTNESS_THRESHOLD) {
                // 疑似黑帧：偏移 0.3s 重试一次（钳制在有效范围内，避免超短视频算出负时间）
                const retryTime = Math.max(0.1, Math.min(duration - 0.1, base + 0.3));
                if (Math.abs(retryTime - base) > 0.01) {
                    frame = drawFrame(await seekedAt(video, retryTime), maxWidth, quality);
                }
            }
            frames.push(frame.dataUrl);
            options.onProgress?.(i + 1, count);
        }
        return frames;
    } finally {
        video.removeAttribute("src");
        video.load();
    }
}

async function seekedAt(video: HTMLVideoElement, time: number): Promise<HTMLVideoElement> {
    await seekTo(video, time);
    return video;
}
