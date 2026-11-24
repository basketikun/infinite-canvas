import type { ModelChannel } from "@infinite-canvas/shared/channels";
import { StorageError } from "@infinite-canvas/shared/storage-data";
import type { FsStorage } from "../storage/fs-storage.js";

export function publicChannels(channels: ModelChannel[]): ModelChannel[] {
    return channels.map((channel) => ({ ...channel, groups: channel.groups.map((group) => ({ ...group, apiKey: "", hasApiKey: Boolean(group.apiKey) })) }));
}

export async function saveChannels(storage: FsStorage, channels: ModelChannel[], clientId: string) {
    const previous = await storage.read<ModelChannel[]>("privateChannels", "channels");
    const value = channels.map((channel) => ({ ...channel, groups: channel.groups.map((group) => {
        const saved = previous?.value?.find((item) => item.id === channel.id)?.groups.find((item) => item.id === group.id);
        if (!group.apiKey && group.hasApiKey && !saved?.apiKey) throw new StorageError("STORAGE_INVALID");
        return { ...group, apiKey: group.apiKey || (group.hasApiKey ? saved!.apiKey : ""), hasApiKey: undefined };
    }) }));
    await storage.save("privateChannels", "channels", value, clientId);
    return { channels: publicChannels(value) };
}

export async function findChannelGroup(storage: FsStorage, groupId: string) {
    const record = await storage.read<ModelChannel[]>("privateChannels", "channels");
    for (const channel of record?.value ?? []) {
        const group = channel.groups.find((item) => item.id === groupId);
        if (group) return { channel, group };
    }
    throw new Error("MODEL_CONFIG_MISSING");
}
