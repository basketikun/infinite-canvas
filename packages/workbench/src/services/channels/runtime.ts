import type { ModelChannel, ModelGroup, ModelListFormat } from "@infinite-canvas/shared/channels";

export interface ChannelAdapter {
    load(): Promise<ModelChannel[] | null>;
    save(channels: ModelChannel[]): Promise<ModelChannel[]>;
    listModels(channel: ModelChannel, group: ModelGroup, format: ModelListFormat, signal?: AbortSignal): Promise<string[]>;
}

export let channels: ChannelAdapter;

export function initializeChannels(adapter: ChannelAdapter) {
    if (channels) throw new Error("CHANNELS_ALREADY_INITIALIZED");
    channels = adapter;
}
