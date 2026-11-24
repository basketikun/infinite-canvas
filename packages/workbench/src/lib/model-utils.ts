import type { ModelCapability } from "@infinite-canvas/shared/models";

const VIDEO_KEYWORDS = ["video", "sora", "veo", "kling", "hailuo", "seedance", "vidu", "runway", "luma", "pixverse", "gemini-omni", "即梦", "可灵", "海螺"];
const AUDIO_KEYWORDS = ["audio", "tts", "speech", "voice", "music", "sound", "suno", "lyria"];
const IMAGE_KEYWORDS = ["seedream", "gpt-image", "image", "dall-e", "dalle", "imagen", "flux", "sdxl", "stable-diffusion", "midjourney", "t2i", "i2i", "nano-banana", "nano_banana", "nano banana", "nanobanana"];

/**
 * 按名称预选新增模型的用途，保存后的用途由用户选择决定。
 */
export function guessCapability(name: string): ModelCapability {
    const value = name.toLowerCase();
    if (VIDEO_KEYWORDS.some((keyword) => value.includes(keyword))) return "video";
    if (AUDIO_KEYWORDS.some((keyword) => value.includes(keyword))) return "audio";
    if (IMAGE_KEYWORDS.some((keyword) => value.includes(keyword))) return "image";
    if (/(?:^|[\/_-])wanx?\d/.test(value)) return "video";
    return "text";
}

/**
 * 新增模型或切换用途时，按名称和用途预选调用脚本。
 */
export function defaultCallScriptId(name: string, capability: ModelCapability) {
    if (capability === "image" && /gemini|nano[-_ ]?banana/i.test(name)) return "gemini-image";
    if (capability === "image" && /grok.*image/i.test(name)) return "grok-image";
    if (capability === "video" && /grok.*video/i.test(name)) return "grok-video-generations";
    if (capability === "audio") return "openai-chat-audio";
    return `openai-${capability}`;
}

/**
 * 为手动添加和拉取的模型生成初始配置。
 */
export function detectChannelModel(name: string) {
    const capability = guessCapability(name);
    return { name, capability, scriptId: defaultCallScriptId(name, capability) };
}

/**
 * 按模型名称识别品牌图标，未识别时由展示组件使用通用图标。
 */
export function resolveModelIcon(model: string) {
    const name = model.toLowerCase();
    if (name.includes("claude") || name.includes("anthropic")) return "/icons/claude.svg";
    if (name.includes("gemini") || name.includes("google") || name.includes("lyria")) return "/icons/gemini.svg";
    if (name.includes("gpt") || name.includes("openai")) return "/icons/openai.svg";
    if (name.includes("grok")) return "/icons/grok.svg";
    if (name.includes("suno")) return "/icons/suno.svg";
    if (name.includes("deepseek")) return "/icons/deepseek.svg";
    if (name.includes("glm")) return "/icons/glm.svg";
    return "";
}

/** 只有 currentColor 的单色图标在暗色下反色；带品牌色的图标保持原色。 */
const MONOCHROME_ICONS = new Set(["/icons/openai.svg", "/icons/grok.svg", "/icons/suno.svg"]);

export function isMonochromeModelIcon(icon: string) {
    return MONOCHROME_ICONS.has(icon);
}
