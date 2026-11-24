import type { Prompt } from "./api/prompts";
import { saveMediaAsset } from "./asset-upload";
import { flushAssetWrites, useAssetStore } from "@workbench/stores/use-asset-store";

export type PromptAssetResult = { textId: string; imageId?: string; imageFailed: boolean };
const savingPrompts = new Map<string, Promise<PromptAssetResult>>();

/** 提示词同时保留文本与封面图片；重复加入时按提示词和来源去重。 */
export function savePromptAssets(item: Prompt, signal?: AbortSignal): Promise<PromptAssetResult> {
    const key = `${item.sourceId}:${item.id}`;
    const pending = savingPrompts.get(key);
    if (pending) return pending;
    const task = savePromptAssetsOnce(item, signal).finally(() => { if (savingPrompts.get(key) === task) savingPrompts.delete(key); });
    savingPrompts.set(key, task);
    return task;
}

async function savePromptAssetsOnce(item: Prompt, signal?: AbortSignal): Promise<PromptAssetResult> {
    const store = useAssetStore.getState();
    const metadata = { source: "prompt-library", promptId: item.id, sourceId: item.sourceId, githubUrl: item.githubUrl };
    const existingText = store.assets.find((asset) => asset.kind === "text" && asset.metadata?.source === "prompt-library" && asset.metadata?.promptId === item.id && asset.metadata?.sourceId === item.sourceId);
    const textId = existingText?.id ?? store.addAsset({
        kind: "text", title: item.title, coverUrl: "", source: item.category, data: { content: item.prompt }, metadata,
    });
    let imageId: string | undefined, imageFailed = false;
    if (item.coverUrl) {
        const existingImage = store.assets.find((asset) => asset.kind === "image" && asset.metadata?.source === "prompt-library" && asset.metadata?.promptId === item.id && asset.metadata?.sourceId === item.sourceId && asset.metadata?.cover === true);
        if (existingImage) imageId = existingImage.id;
        else {
            try {
                imageId = await saveMediaAsset(item.coverUrl, "image", { title: item.title, source: item.category, metadata: { ...metadata, cover: true } }, signal);
            } catch (error) {
                if (signal?.aborted) throw error;
                console.error("[prompts] save cover image", error);
                imageFailed = true;
            }
        }
    }
    await flushAssetWrites();
    return { textId, imageId, imageFailed };
}
