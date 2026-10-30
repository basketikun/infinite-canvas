import { nanoid } from "nanoid";
import { useAgentStore } from "@/stores/use-agent-store";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { imageToDataUrl } from "@/services/image-storage";
import { buildImageReferencePromptText } from "@/lib/image-reference-prompt";

export async function requestCodexImage(config: AiConfig, prompt: string, references: ReferenceImage[], signal?: AbortSignal): Promise<Array<{ id: string; dataUrl: string }>> {
    const { url, token, model } = useAgentStore.getState();
    if (!url || !token) throw new Error("請先在 Agent 面板連接本地 Codex；不會改用其他圖片 API。");
    const response = await fetch(`${url.replace(/\/$/, "")}/agent/codex/images`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", "x-canvas-agent-token": token },
        body: JSON.stringify({
            prompt: [config.systemPrompt, buildImageReferencePromptText(prompt, references)].filter(Boolean).join("\n"),
            model,
            count: config.count,
            size: config.size,
            quality: config.quality,
            background: config.background,
            references: await Promise.all(references.map((image) => imageToDataUrl(image, { signal }))),
        }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok || !Array.isArray(data.images) || !data.images.length) throw new Error(data.error || "Codex 未返回圖片；不會改用其他圖片 API。");
    return data.images.map((dataUrl: string) => ({ id: nanoid(), dataUrl }));
}
