import type { ChannelSnapshot } from "@infinite-canvas/shared/channels";
import { ModelExecutionError, modelErrorMessages } from "@infinite-canvas/shared/model-http";
import { StorageError } from "@infinite-canvas/shared/storage-data";
import { requestStorage } from "@workbench/lib/storage-request";
import type { ChannelAdapter } from "./runtime";

export function createHttpChannels(): ChannelAdapter {
    const clientId = crypto.randomUUID();
    return {
        async load() {
            const result = await (await requestStorage("/api/channels")).json() as ChannelSnapshot | null;
            return result?.channels ?? null;
        },
        async save(channels) {
            const result = await (await requestStorage("/api/channels", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ channels, clientId }) })).json() as ChannelSnapshot;
            return result.channels;
        },
        async listModels(channel, group, format, signal) {
            try {
                const response = await fetch("/api/channels/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId: group.id, format }), signal });
                const data = await response.json();
                if (response.ok && Array.isArray(data) && data.every((item) => typeof item === "string")) return data;
                const code = data?.error?.code;
                if (code === "STORAGE_UNAVAILABLE" || code === "STORAGE_INVALID") throw new StorageError(code);
                throw new ModelExecutionError(Object.hasOwn(modelErrorMessages, code) ? code : "MODEL_LIST_FAILED");
            } catch (error) {
                signal?.throwIfAborted();
                if (error instanceof ModelExecutionError || error instanceof StorageError) throw error;
                throw new ModelExecutionError("MODEL_UNAVAILABLE");
            }
        },
    };
}
