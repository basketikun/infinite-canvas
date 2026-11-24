import { appDatabase } from "@workbench/utils/indexed-db";
import { network } from "@workbench/services/network/runtime";
import localforage from "localforage";
import { fetchChannelModels } from "@infinite-canvas/model-runtime/channels";

import type { ChannelAdapter } from "./runtime";
import type { ModelChannel } from "@infinite-canvas/shared/channels";

export function createBrowserChannels(): ChannelAdapter {
    const store = localforage.createInstance({ name: appDatabase, storeName: "channels", driver: localforage.INDEXEDDB });
    return {
        load: () => store.getItem<ModelChannel[]>("channels"),
        async save(channels) {
            await store.setItem("channels", channels);
            return channels;
        },
        listModels: (channel, group, format, signal) => fetchChannelModels(channel.baseUrl, group.apiKey, format, network.url, signal),
    };
}
