import { useLayoutEffect, useMemo, useState } from "react";
import { imageBlobDimensions, saveImageBlob } from "@workbench/services/image-storage";
import { holdChatDraft, useAgentChatStore, type AgentChatImage } from "@workbench/stores/use-agent-chat-store";

type Draft = { controller: AbortController; images: AgentChatImage[]; adding: boolean };

export function useAgentImages(projectId: string, threadId?: string, draftThread = threadId) {
    const view = useMemo<{ draft?: Draft }>(() => ({}), [projectId, draftThread]);
    const [images, setImages] = useState<AgentChatImage[]>([]);
    const [adding, setAdding] = useState(false);
    const [error, setError] = useState("");
    useLayoutEffect(() => {
        const draft: Draft = { controller: new AbortController(), images: [], adding: false };
        view.draft = draft;
        setImages([]); setAdding(false); setError("");
        return () => {
            view.draft = undefined;
            draft.controller.abort();
        };
    }, [view]);

    function removeImage(key: string) {
        const draft = view.draft;
        if (!draft) return;
        draft.images = draft.images.filter((image) => image.storageKey !== key);
        setImages((current) => current.filter((image) => image.storageKey !== key));
    }

    async function addImages(files: File[]) {
        const draft = view.draft, inputs = files.filter((file) => file.type.startsWith("image/"));
        const history = useAgentChatStore.getState();
        if (!draft || !inputs.length || draft.adding || history.run || threadId && (history.receiving.has(threadId) || history.deletions.has(threadId))) return;
        const release = threadId && holdChatDraft(threadId), signal = draft.controller.signal;
        draft.adding = true;
        setAdding(true); setError("");
        try {
            for (const file of inputs) {
                const { width, height } = await imageBlobDimensions(file, signal);
                signal.throwIfAborted();
                const image = { storageKey: await saveImageBlob(file), name: file.name, width, height, bytes: file.size, mimeType: file.type };
                signal.throwIfAborted();
                draft.images.push(image);
                setImages((current) => [...current, image]);
            }
        } catch (cause) {
            if (!signal.aborted) { console.error("[agent] add attachment", cause); setError("图片添加失败，请检查图片与存储空间后重试。"); }
        } finally {
            if (release) release();
            draft.adding = false;
            if (!signal.aborted) setAdding(false);
        }
    }

    function capture() {
        const draft = view.draft;
        if (!draft) return;
        const sent = draft.images;
        return { signal: draft.controller.signal, received() {
            if (view.draft === draft) for (const image of sent) removeImage(image.storageKey);
        } };
    }

    return { images, adding, error, addImages, removeImage, capture };
}
